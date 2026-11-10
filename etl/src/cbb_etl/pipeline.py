"""Orchestrates extract -> transform -> validate -> load for a run.

Targets:
  r2          API JSON objects (v1/...) served by the Worker
  lake        upstream parquet + derived team_season_stats copied to R2 (parquet/v1/...)
  motherduck  views over the lake (default --md-mode views; implies `lake`), or native
              tables with --md-mode tables

Every requested season is built and validated before anything is written, so a failing
season never leaves partially published data behind. The manifest is written last.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from . import keys, log
from .config import (
    DERIVED_TABLE,
    LAKE_DATASETS,
    OPTIONAL_DATASETS,
    R2_SOURCE_DATASETS,
    SPORT_CONFIG,
    Settings,
)
from .extract import Asset, AssetNotFound, ReleaseClient
from .load_motherduck import GB, MotherDuckLoader
from .load_r2 import LocalStore, Publisher, R2Store
from .seasons import current_season, parse_seasons
from .transform import SeasonBuild, SeasonNotStarted, build_season, transform_fingerprint

logger = log.get(__name__)

TARGETS = ("r2", "lake", "motherduck")


@dataclass(frozen=True)
class RunOptions:
    sports: tuple[str, ...]
    seasons: str = "current"
    targets: tuple[str, ...] = TARGETS
    dry_run: bool = False
    out_dir: Path = Path("out")
    include_pbp: bool = False
    max_seasons: int | None = None
    force: bool = False
    md_mode: str = "views"  # "views" | "tables"
    md_storage_limit_gb: float = 9.0


def _digest(obj: object) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()[:16]


def _resolve(client: ReleaseClient, sport: str, dataset: str, season: int) -> Asset | None:
    sp = SPORT_CONFIG[sport]
    try:
        return client.resolve(sp, sp.dataset(dataset), season)
    except AssetNotFound:
        if dataset in OPTIONAL_DATASETS or dataset == "pbp":
            logger.info(
                "optional dataset missing",
                extra={"sport": sport, "season": season, "dataset": dataset},
            )
            return None
        raise


def run(opts: RunOptions, settings: Settings | None = None) -> int:
    settings = settings or Settings.from_env()
    if opts.md_mode not in ("views", "tables"):
        raise ValueError("md_mode must be 'views' or 'tables'")
    client = ReleaseClient(settings.cache_dir, settings.github_token)
    want_r2 = "r2" in opts.targets
    want_md = "motherduck" in opts.targets
    md_views = want_md and opts.md_mode == "views"
    md_tables = want_md and opts.md_mode == "tables"
    want_lake = "lake" in opts.targets or md_views
    cur = current_season()
    tfp = transform_fingerprint()

    publisher: Publisher | None = None
    if want_r2 or want_lake:
        store = LocalStore(opts.out_dir) if opts.dry_run else R2Store(settings.require_r2())
        publisher = Publisher(store, dry_run_label="local" if opts.dry_run else "r2")
    loader: MotherDuckLoader | None = None
    if want_md:
        loader = MotherDuckLoader(
            database=settings.motherduck_database,
            token=None if opts.dry_run else settings.require_motherduck(),
            local_path=opts.out_dir / "cbb.duckdb" if opts.dry_run else None,
            storage_limit_gb=opts.md_storage_limit_gb,
        )

    table_datasets = list(LAKE_DATASETS) + (["pbp"] if opts.include_pbp else [])
    builds: dict[tuple[str, int], SeasonBuild] = {}
    fingerprints: dict[tuple[str, int], dict[str, str]] = {}
    upstream: dict[str, dict[str, str | None]] = {}
    table_plan: list[tuple[str, int]] = []  # sport-seasons that go to the lake / MD tables

    def derived_needed(sport: str, season: int, fp: str) -> bool:
        if opts.force:
            return True
        if want_lake and not publisher.file_unchanged(
            keys.lake_key(sport, DERIVED_TABLE, season), fp
        ):
            return True
        return md_tables and loader.loaded_fingerprint(sport, season, DERIVED_TABLE) != fp

    # 1. extract + transform + validate everything first
    for sport in opts.sports:
        sp = SPORT_CONFIG[sport]
        seasons = parse_seasons(opts.seasons, sp.first_season)
        upstream[sport] = {
            ds: client.timestamp(sp.dataset(ds).tag(sp)) for ds in R2_SOURCE_DATASETS
        }
        tabled = set(seasons[-opts.max_seasons :] if opts.max_seasons else seasons)
        if want_lake or md_tables:
            table_plan += [(sport, s) for s in seasons if s in tabled]

        for season in seasons:
            ctx = {"sport": sport, "season": season}
            assets = {ds: _resolve(client, sport, ds, season) for ds in R2_SOURCE_DATASETS}
            fps = {ds: (a.fingerprint if a else "missing") for ds, a in assets.items()}
            fps["_transform"] = tfp
            fingerprints[(sport, season)] = fps
            r2_needed = want_r2 and (
                opts.force or not publisher.season_unchanged(sport, season, fps)
            )
            d_needed = (sport, season) in table_plan and derived_needed(sport, season, _digest(fps))
            if not (r2_needed or d_needed):
                logger.info("season unchanged upstream; skipping build", extra=ctx)
                continue
            paths = {ds: (client.fetch(a) if a else None) for ds, a in assets.items()}
            try:
                b = build_season(sport, season, paths)
            except SeasonNotStarted as e:
                if season == cur:
                    logger.warning(
                        "current season has no completed games; skipping",
                        extra={**ctx, "detail": str(e)},
                    )
                    table_plan = [p for p in table_plan if p != (sport, season)]
                    continue
                raise
            b.r2_needed, b.md_needed = r2_needed, d_needed
            builds[(sport, season)] = b

    staging = settings.cache_dir.parent / "staging"

    def derived_path(b: SeasonBuild) -> Path:
        return b.export_derived(staging / b.sport / str(b.season) / f"{DERIVED_TABLE}.parquet")

    # 2. parquet lake (upstream files copied as-is + derived table)
    if want_lake:
        for sport, season in table_plan:
            for ds in table_datasets:
                asset = _resolve(client, sport, ds, season)
                key = keys.lake_key(sport, ds, season)
                if asset is None or (
                    not opts.force and publisher.file_unchanged(key, asset.fingerprint)
                ):
                    continue
                publisher.sync_file(key, client.fetch(asset), asset.fingerprint)
            b = builds.get((sport, season))
            if b is not None and b.md_needed:
                publisher.sync_file(
                    keys.lake_key(sport, DERIVED_TABLE, season),
                    derived_path(b),
                    _digest(fingerprints[(sport, season)]),
                )

    # 3. API JSON objects, then the manifest (last)
    if publisher:
        r2_builds = [b for b in builds.values() if b.r2_needed]
        if r2_builds:
            publisher.publish(r2_builds, fingerprints, upstream)
        elif publisher.dirty:
            publisher.save()
        else:
            logger.info("r2: nothing to publish")
        lake_bytes = sum(
            v.get("bytes", 0)
            for k, v in publisher.manifest.objects.items()
            if k.startswith(keys.LAKE_PREFIX)
        )
        logger.info("lake size", extra={"r2_parquet_gb": round(lake_bytes / GB, 3)})

    # 4. MotherDuck
    if loader:
        try:
            if md_views:
                _refresh_views(loader, publisher, settings, opts)
            else:
                _load_tables(
                    loader,
                    client,
                    builds,
                    fingerprints,
                    table_plan,
                    table_datasets,
                    derived_path,
                    opts.force,
                )
            logger.info("motherduck done", extra={"estimated_storage": loader.storage_report()})
        finally:
            loader.close()
    return 0


def _refresh_views(
    loader: MotherDuckLoader, publisher: Publisher, settings: Settings, opts: RunOptions
) -> None:
    if opts.dry_run:
        base = (opts.out_dir.resolve() / keys.LAKE_PREFIX).as_posix()
    else:
        r2 = settings.require_r2()
        key_id = r2.read_access_key_id or r2.access_key_id
        secret = r2.read_secret_access_key or r2.secret_access_key
        if not r2.read_access_key_id:
            logger.warning("R2_READ_ACCESS_KEY_ID not set; giving MotherDuck the write keys")
        loader.ensure_r2_secret(r2.account_id, key_id, secret)
        base = f"r2://{r2.bucket}/{keys.LAKE_PREFIX}"
    for sport in opts.sports:
        prefix = f"{keys.LAKE_PREFIX}/{sport}/"
        tables = sorted(
            {k[len(prefix) :].split("/", 1)[0] for k in publisher.keys_with_prefix(prefix)}
        )
        for table in tables:
            loader.refresh_view(sport, table, f"{base}/{sport}/{table}/*/*.parquet")


def _load_tables(
    loader, client, builds, fingerprints, table_plan, table_datasets, derived_path, force: bool
) -> None:
    for sport, season in table_plan:
        for ds in table_datasets:
            asset = _resolve(client, sport, ds, season)
            if asset is None or (
                not force and loader.loaded_fingerprint(sport, season, ds) == asset.fingerprint
            ):
                continue
            loader.load(sport, season, ds, client.fetch(asset), asset.fingerprint, force=True)
        b = builds.get((sport, season))
        if b is not None and b.md_needed:
            loader.load(
                sport,
                season,
                DERIVED_TABLE,
                derived_path(b),
                _digest(fingerprints[(sport, season)]),
                force=True,
            )
