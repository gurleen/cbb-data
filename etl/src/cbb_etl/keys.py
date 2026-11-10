"""R2 object key layout (versioned so the format can change later)."""

from __future__ import annotations

VERSION = "v1"
MANIFEST_KEY = f"{VERSION}/manifest.json"


def _sport(sport: str) -> str:
    if sport not in ("mbb", "wbb"):
        raise ValueError(f"bad sport: {sport}")
    return sport


def _season(season: int) -> int:
    if not (1000 <= int(season) <= 9999):
        raise ValueError(f"bad season: {season}")
    return int(season)


def seasons_key(sport: str) -> str:
    return f"{VERSION}/{_sport(sport)}/seasons.json"


def teams_key(sport: str, season: int) -> str:
    return f"{VERSION}/{_sport(sport)}/{_season(season)}/teams.json"


def team_key(sport: str, season: int, team_id: int) -> str:
    return f"{VERSION}/{_sport(sport)}/{_season(season)}/teams/{int(team_id)}.json"


def team_stats_key(sport: str, season: int) -> str:
    return f"{VERSION}/{_sport(sport)}/{_season(season)}/team-stats.json"


def season_prefix(sport: str, season: int) -> str:
    return f"{VERSION}/{_sport(sport)}/{_season(season)}/"


# -- parquet lake (queried by MotherDuck views) ---------------------------------------------
LAKE_PREFIX = "parquet/v1"


def lake_key(sport: str, table: str, season: int) -> str:
    """Hive-partitioned: parquet/v1/{sport}/{table}/season={season}/data.parquet"""
    if not table.replace("_", "").isalnum():
        raise ValueError(f"bad table name: {table}")
    return f"{LAKE_PREFIX}/{_sport(sport)}/{table}/season={_season(season)}/data.parquet"


def lake_table_prefix(sport: str, table: str) -> str:
    return f"{LAKE_PREFIX}/{_sport(sport)}/{table}/"
