"""Typed configuration: sports, upstream datasets, environment settings.

File-name patterns below were verified against the release assets on 2026-11-10
(see docs/schemas.md). At runtime `extract.list_assets` re-checks them against the
GitHub releases API, so a renamed upstream file fails loudly instead of silently.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

UPSTREAM_REPO = "sportsdataverse/sportsdataverse-data"
RELEASE_DOWNLOAD_BASE = f"https://github.com/{UPSTREAM_REPO}/releases/download"
GITHUB_API = "https://api.github.com"

SPORTS = ("mbb", "wbb")


@dataclass(frozen=True)
class Dataset:
    """One upstream release (tag) with one parquet file per season."""

    key: str  # our short name, e.g. "team_boxscores"
    tag_suffix: str  # release tag suffix, e.g. "team_boxscores"
    file_stem: str  # file prefix before _{season}.parquet; "{sport}" is substituted

    def tag(self, sport: Sport) -> str:
        return f"{sport.tag_prefix}{self.tag_suffix}"

    def filename(self, sport: Sport, season: int) -> str:
        return f"{self.file_stem.format(sport=sport.code)}_{season}.parquet"


@dataclass(frozen=True)
class Sport:
    code: str  # "mbb" | "wbb"
    tag_prefix: str
    first_season: int  # earliest season with schedules + team box scores
    datasets: dict[str, Dataset] = field(default_factory=dict)

    def dataset(self, key: str) -> Dataset:
        return self.datasets[key]


def _datasets() -> dict[str, Dataset]:
    ds = [
        Dataset("schedules", "schedules", "{sport}_schedule"),
        Dataset("team_boxscores", "team_boxscores", "team_box"),
        Dataset("player_boxscores", "player_boxscores", "player_box"),
        Dataset("rosters", "rosters", "rosters"),
        Dataset("standings", "standings", "standings"),
        Dataset("team_season_stats", "team_season_stats", "team_season_stats"),
        Dataset("player_season_stats", "player_season_stats", "player_season_stats"),
        Dataset("pbp", "pbp", "play_by_play"),
        Dataset("shots", "shots", "shots"),
        Dataset("officials", "officials", "officials"),
        Dataset("game_rosters", "game_rosters", "game_rosters"),
        Dataset("player_core", "player_core", "player_core"),
    ]
    return {d.key: d for d in ds}


SPORT_CONFIG: dict[str, Sport] = {
    # Verified coverage (2026-11-10): MBB schedules 2002-2027, team_box 2003-2027.
    "mbb": Sport("mbb", "espn_mens_college_basketball_", 2003, _datasets()),
    # WBB schedules 2002-2027, team_box 2004-2027 (box coverage is sparse before ~2021).
    "wbb": Sport("wbb", "espn_womens_college_basketball_", 2004, _datasets()),
}

# Datasets needed to build the R2 outputs.
R2_SOURCE_DATASETS = ("schedules", "team_boxscores", "standings", "player_boxscores", "rosters")
# Base tables copied to the R2 parquet lake and exposed in MotherDuck (pbp is opt-in).
LAKE_DATASETS = ("schedules", "team_boxscores", "player_boxscores", "rosters", "standings")
DERIVED_TABLE = "team_season_stats"
DERIVED_TABLES = ("team_season_stats", "conference_stats", "player_season_stats")
OPTIONAL_DATASETS = frozenset(
    {"standings", "rosters", "player_boxscores"}
)  # may be missing for some seasons


@dataclass(frozen=True)
class R2Settings:
    account_id: str
    access_key_id: str
    secret_access_key: str
    bucket: str
    # Read-only token handed to MotherDuck for the lake views (falls back to the write keys)
    read_access_key_id: str | None = None
    read_secret_access_key: str | None = None

    @property
    def endpoint_url(self) -> str:
        return f"https://{self.account_id}.r2.cloudflarestorage.com"


@dataclass(frozen=True)
class Settings:
    cache_dir: Path
    github_token: str | None
    r2: R2Settings | None
    motherduck_token: str | None
    motherduck_database: str = "cbb"

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Settings:
        env = dict(os.environ if env is None else env)
        # R2 lives in the Cloudflare account, so CLOUDFLARE_ACCOUNT_ID works too.
        if not env.get("R2_ACCOUNT_ID"):
            env["R2_ACCOUNT_ID"] = env.get("CLOUDFLARE_ACCOUNT_ID", "")
        r2_keys = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
        r2 = None
        if all(env.get(k) for k in r2_keys):
            r2 = R2Settings(
                *(env[k] for k in r2_keys),
                read_access_key_id=env.get("R2_READ_ACCESS_KEY_ID") or None,
                read_secret_access_key=env.get("R2_READ_SECRET_ACCESS_KEY") or None,
            )
        return cls(
            cache_dir=Path(env.get("CBB_CACHE_DIR", ".cache/sportsdataverse")),
            github_token=env.get("GITHUB_TOKEN") or None,
            r2=r2,
            motherduck_token=env.get("MOTHERDUCK_TOKEN") or None,
            motherduck_database=env.get("MOTHERDUCK_DATABASE", "cbb"),
        )

    def require_r2(self) -> R2Settings:
        if self.r2 is None:
            raise RuntimeError(
                "R2 target needs CLOUDFLARE_ACCOUNT_ID (or R2_ACCOUNT_ID), R2_ACCESS_KEY_ID, "
                "R2_SECRET_ACCESS_KEY, R2_BUCKET"
            )
        return self.r2

    def require_motherduck(self) -> str:
        if not self.motherduck_token:
            raise RuntimeError("MotherDuck target needs MOTHERDUCK_TOKEN")
        return self.motherduck_token
