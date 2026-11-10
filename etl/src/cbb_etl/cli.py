"""cbb-etl run --sport mbb|wbb|all --seasons current|2024,2025|all --targets r2,lake,motherduck

Targets: r2 = API JSON; lake = parquet in R2; motherduck = views over the lake (implies
lake) or, with --md-mode tables, native tables."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import log
from .config import SPORTS
from .pipeline import TARGETS, RunOptions, run
from .validate import ValidationError


def _csv(choices: tuple[str, ...]):
    def parse(value: str) -> tuple[str, ...]:
        items = tuple(v.strip() for v in value.split(",") if v.strip())
        bad = [v for v in items if v not in choices]
        if bad or not items:
            raise argparse.ArgumentTypeError(f"choose from {', '.join(choices)}")
        return items

    return parse


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="cbb-etl")
    sub = p.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run", help="extract, transform, validate and load")
    r.add_argument("--sport", default="all", choices=(*SPORTS, "all"))
    r.add_argument(
        "--seasons",
        default="current",
        help="current | all | 2024,2025 | 2020-2024 (season = ending year)",
    )
    r.add_argument(
        "--targets",
        default=TARGETS,
        type=_csv(TARGETS),
        help="comma list of r2,lake,motherduck (motherduck implies lake in views mode)",
    )
    r.add_argument(
        "--md-mode",
        default="views",
        choices=("views", "tables"),
        help="views over the R2 parquet lake (default) or native MotherDuck tables",
    )
    r.add_argument(
        "--dry-run",
        action="store_true",
        help="write R2 objects to --out-dir and MotherDuck views/tables to "
        "<out-dir>/cbb.duckdb instead of the real services",
    )
    r.add_argument("--out-dir", type=Path, default=Path("out"))
    r.add_argument(
        "--include-pbp",
        action="store_true",
        help="also copy play-by-play to the lake / MotherDuck (~90 MB/season/sport)",
    )
    r.add_argument(
        "--max-seasons",
        type=int,
        default=None,
        help="lake/MotherDuck get at most the N most recent selected seasons",
    )
    r.add_argument(
        "--md-storage-limit-gb",
        type=float,
        default=9.0,
        help="--md-mode tables: refuse loads past this storage estimate (free: 10)",
    )
    r.add_argument(
        "--force",
        action="store_true",
        help="ignore manifest/load-log fingerprints and rebuild everything",
    )
    r.add_argument("--log-level", default="INFO")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    log.setup(args.log_level)
    logger = log.get("cbb_etl")
    sports = SPORTS if args.sport == "all" else (args.sport,)
    opts = RunOptions(
        sports=sports,
        seasons=args.seasons,
        targets=args.targets,
        dry_run=args.dry_run,
        out_dir=args.out_dir,
        include_pbp=args.include_pbp,
        max_seasons=args.max_seasons,
        force=args.force,
        md_mode=args.md_mode,
        md_storage_limit_gb=args.md_storage_limit_gb,
    )
    logger.info("run start", extra={"options": {k: str(v) for k, v in opts.__dict__.items()}})
    try:
        return run(opts)
    except ValidationError as e:
        logger.error("validation failed; nothing published", extra={"error": str(e)})
        return 2
    except Exception:
        logger.exception("run failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
