"""Build team metadata + basic season stats for one sport-season (locally, in DuckDB),
validate them, and shape the R2 documents."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import duckdb

from .. import keys, log
from ..seasons import season_label
from ..validate import require_columns, validate_players, validate_season
from . import documents as d

logger = log.get(__name__)

_EMPTY_ROSTERS = """
CREATE OR REPLACE VIEW rosters AS
SELECT NULL::VARCHAR AS athlete_id, NULL::VARCHAR AS display_name,
       NULL::VARCHAR AS position_abbreviation, NULL::VARCHAR AS height,
       NULL::VARCHAR AS weight, NULL::VARCHAR AS experience_display_value,
       NULL::VARCHAR AS jersey, NULL::VARCHAR AS headshot_href
WHERE false
"""

_EMPTY_STANDINGS = """
CREATE OR REPLACE VIEW standings AS
SELECT NULL::INTEGER AS team_id, NULL::VARCHAR AS group_id, NULL::VARCHAR AS group_name,
       NULL::VARCHAR AS group_short_name
WHERE false
"""


class SeasonNotStarted(Exception):
    pass


def transform_fingerprint() -> str:
    """Hash of the SQL + this module, so transform changes force a rebuild."""
    import hashlib

    h = hashlib.sha256()
    for p in sorted(sql_dir().glob("*")):
        h.update(p.name.encode() + p.read_bytes())
    h.update(Path(__file__).read_bytes())
    return h.hexdigest()[:16]


def sql_dir() -> Path:
    """`etl/sql` in a checkout; `cbb_etl/sql` inside an installed wheel."""
    here = Path(__file__).resolve()
    for cand in (here.parents[1] / "sql", here.parents[3] / "sql"):
        if cand.is_dir():
            return cand
    raise FileNotFoundError("sql directory not found")


def run_sql_file(con: duckdb.DuckDBPyConnection, name: str) -> None:
    con.execute((sql_dir() / name).read_text())


@dataclass
class SeasonBuild:
    sport: str
    season: int
    con: duckdb.DuckDBPyConnection
    documents: dict[str, Any] = field(default_factory=dict)  # R2 key -> JSON-able object
    summary: dict[str, Any] = field(default_factory=dict)  # entry for seasons.json
    warnings: list[str] = field(default_factory=list)
    r2_needed: bool = True
    md_needed: bool = False
    has_players: bool = False

    def export_derived(self, folder: Path) -> dict[str, Path]:
        """Write derived tables (lake / MotherDuck) to parquet; returns table -> path."""
        folder.mkdir(parents=True, exist_ok=True)
        queries = {
            "team_season_stats": f"""
                SELECT {self.season}::INTEGER AS season, t.team_id, t.display_name,
                       t.abbreviation, t.division_i, t.conference_id, t.conference_name,
                       t.conference_short_name, s.* EXCLUDE (team_id)
                FROM team_season_stats s JOIN teams t USING (team_id)
                ORDER BY t.team_id""",
            "conference_stats": f"""
                SELECT {self.season}::INTEGER AS season, * FROM conference_stats""",
        }
        if self.has_players:
            queries["player_season_stats"] = f"""
                SELECT {self.season}::INTEGER AS season, p.*,
                       t.display_name AS team_name, t.abbreviation AS team_abbreviation,
                       t.logo AS team_logo, t.conference_id, t.conference_short_name
                FROM player_season_stats p LEFT JOIN teams t USING (team_id)
                ORDER BY p.athlete_id"""
        out = {}
        for table, q in queries.items():
            path = folder / f"{table}.parquet"
            self.con.execute(f"COPY ({q}) TO '{path.as_posix()}' (FORMAT parquet)")
            out[table] = path
        return out


# -- document shaping ----------------------------------------------------------------------


def _r(v: float | None, nd: int) -> float | None:
    return None if v is None else round(float(v), nd)


def _color(c: str | None) -> str | None:
    if not c:
        return None
    return c if c.startswith("#") else f"#{c.lower()}"


def _team_meta(t: dict[str, Any]) -> dict[str, Any]:
    conf = None
    if t["conference_id"] is not None:
        conf = {
            "id": t["conference_id"],
            "name": t["conference_name"],
            "short_name": t["conference_short_name"],
        }
    return {
        "id": t["team_id"],
        "name": t["display_name"],
        "short_name": t["short_display_name"],
        "location": t["location"],
        "mascot": t["mascot"],
        "abbreviation": t["abbreviation"],
        "slug": d.team_slug(t),
        "division_i": bool(t["division_i"]),
        "conference": conf,
        "color": _color(t["color"]),
        "alternate_color": _color(t["alternate_color"]),
        "logo": t["logo"],
    }


_TOTAL_COLS = (
    "pts",
    "opp_pts",
    "fgm",
    "fga",
    "fg3m",
    "fg3a",
    "ftm",
    "fta",
    "orb",
    "drb",
    "trb",
    "ast",
    "tov",
    "stl",
    "blk",
    "pf",
    "opp_fgm",
    "opp_fga",
    "opp_fg3m",
    "opp_fg3a",
    "opp_ftm",
    "opp_fta",
    "opp_orb",
    "opp_drb",
    "opp_trb",
    "opp_ast",
    "opp_tov",
    "opp_stl",
    "opp_blk",
)


def _per_game(s: dict[str, Any], col: str) -> float | None:
    g = s["box_games"]
    return None if not g or s[col] is None else round(s[col] / g, 1)


def _team_doc(
    sport: str,
    season: int,
    t: dict,
    s: dict | None,
    ranks: dict | None = None,
    field: int = 0,
    roster: list | None = None,
) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "sport": sport,
        "season": season,
        "season_label": season_label(season),
        "team": _team_meta(t),
        "ranks": ranks or {},
        "rank_field": field,
        "roster": roster or [],
    }
    if s is None:  # team appears only in unfinished/canceled games
        doc.update(record=None, box=None, totals=None, per_game=None, shooting=None, ratings=None)
        return doc

    def wl(wins: str, losses: str) -> dict[str, int]:
        return {"wins": s[wins], "losses": s[losses]}

    doc["record"] = {
        "games": s["games"],
        "wins": s["wins"],
        "losses": s["losses"],
        "win_pct": _r(s["win_pct"], 3),
        "conference": wl("conf_wins", "conf_losses"),
        "home": wl("home_wins", "home_losses"),
        "away": wl("away_wins", "away_losses"),
        "neutral": wl("neutral_wins", "neutral_losses"),
    }
    doc["box"] = {"games": s["box_games"], "coverage": _r(s["box_coverage"], 3)}
    doc["totals"] = (
        {c: s[c] for c in _TOTAL_COLS} | {"possessions": _r(s["possessions"], 1)}
        if s["box_games"]
        else None
    )
    doc["per_game"] = (
        None
        if not s["box_games"]
        else {
            "ppg": _r(s["ppg"], 1),
            "opp_ppg": _r(s["opp_ppg"], 1),
            "fgm": _per_game(s, "fgm"),
            "fga": _per_game(s, "fga"),
            "fg3m": _per_game(s, "fg3m"),
            "fg3a": _per_game(s, "fg3a"),
            "ftm": _per_game(s, "ftm"),
            "fta": _per_game(s, "fta"),
            "rpg": _r(s["rpg"], 1),
            "orpg": _r(s["orpg"], 1),
            "drpg": _r(s["drpg"], 1),
            "apg": _r(s["apg"], 1),
            "topg": _r(s["topg"], 1),
            "spg": _r(s["spg"], 1),
            "bpg": _r(s["bpg"], 1),
        }
    )
    doc["shooting"] = (
        None
        if not s["box_games"]
        else {k: _r(s[k], 3) for k in ("fg_pct", "fg3_pct", "ft_pct", "opp_fg_pct", "opp_fg3_pct")}
    )
    doc["ratings"] = (
        None
        if not s["box_games"]
        else {
            "ortg": _r(s["ortg"], 1),
            "drtg": _r(s["drtg"], 1),
            "net_rtg": _r(s["net_rtg"], 1),
            "pace": _r(s["pace"], 1),
        }
    )
    return doc


def _leaderboard_row(t: dict, s: dict) -> dict[str, Any]:
    return {
        "team_id": t["team_id"],
        "name": t["display_name"],
        "short_name": t["short_display_name"],
        "slug": d.team_slug(t),
        "abbreviation": t["abbreviation"],
        "logo": t["logo"],
        "conference_id": t["conference_id"],
        "conference": t["conference_short_name"],
        "games": s["games"],
        "wins": s["wins"],
        "losses": s["losses"],
        "win_pct": _r(s["win_pct"], 3),
        "conf_wins": s["conf_wins"],
        "conf_losses": s["conf_losses"],
        "box_games": s["box_games"],
        "box_coverage": _r(s["box_coverage"], 3),
        "ppg": _r(s["ppg"], 1),
        "opp_ppg": _r(s["opp_ppg"], 1),
        "fgm": _per_game(s, "fgm"),
        "fga": _per_game(s, "fga"),
        "fg_pct": _r(s["fg_pct"], 3),
        "fg3m": _per_game(s, "fg3m"),
        "fg3a": _per_game(s, "fg3a"),
        "fg3_pct": _r(s["fg3_pct"], 3),
        "ftm": _per_game(s, "ftm"),
        "fta": _per_game(s, "fta"),
        "ft_pct": _r(s["ft_pct"], 3),
        "rpg": _r(s["rpg"], 1),
        "apg": _r(s["apg"], 1),
        "topg": _r(s["topg"], 1),
        "spg": _r(s["spg"], 1),
        "bpg": _r(s["bpg"], 1),
        "ortg": _r(s["ortg"], 1),
        "drtg": _r(s["drtg"], 1),
        "net_rtg": _r(s["net_rtg"], 1),
        "pace": _r(s["pace"], 1),
    }


def _rows(con: duckdb.DuckDBPyConnection, sql: str) -> list[dict[str, Any]]:
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row, strict=True)) for row in cur.fetchall()]


def build_documents(
    con: duckdb.DuckDBPyConnection, sport: str, season: int, has_players: bool = False
):
    teams = _rows(con, "SELECT * FROM teams ORDER BY team_id")
    stats = {r["team_id"]: r for r in _rows(con, "SELECT * FROM team_season_stats")}
    teams_by_id = {t["team_id"]: t for t in teams}
    docs: dict[str, Any] = {}
    label = season_label(season)
    ranks, field = d.team_ranks(teams, stats)

    rosters: dict[int, list] = {}
    players: list[dict] = []
    if has_players:
        players = _rows(con, "SELECT * FROM player_season_stats")
        pgames = _rows(
            con,
            "SELECT * EXCLUDE (game_date_time), epoch(game_date_time) AS game_epoch "
            "FROM player_games",
        )
        pdocs, rosters = d.player_docs(sport, season, label, players, pgames, teams_by_id)
        docs.update(pdocs)
    docs[keys.search_key(sport, season)] = d.search_doc(sport, season, teams, players, teams_by_id)
    docs.update(
        d.team_game_docs(
            sport,
            season,
            teams_by_id,
            _rows(
                con,
                "SELECT * EXCLUDE (game_date_time), epoch(game_date_time) AS game_epoch "
                "FROM team_games",
            ),
        )
    )

    docs[keys.teams_key(sport, season)] = {
        "sport": sport,
        "season": season,
        "season_label": label,
        "count": len(teams),
        "teams": [_team_meta(t) for t in teams],
    }
    for t in teams:
        docs[keys.team_key(sport, season, t["team_id"])] = _team_doc(
            sport,
            season,
            t,
            stats.get(t["team_id"]),
            ranks.get(t["team_id"]),
            field,
            rosters.get(t["team_id"]),
        )
    board = [
        _leaderboard_row(t, stats[t["team_id"]])
        for t in teams
        if t["division_i"] and t["team_id"] in stats
    ]
    docs[keys.team_stats_key(sport, season)] = {
        "sport": sport,
        "season": season,
        "season_label": label,
        "count": len(board),
        "rows": board,
    }
    docs.update(
        d.conference_docs(
            sport,
            season,
            label,
            _rows(con, "SELECT * FROM conference_stats"),
            teams_by_id,
            {r["team_id"]: r for r in board},
            stats,
        )
    )

    d1_stats = [stats[t["team_id"]] for t in teams if t["division_i"] and t["team_id"] in stats]
    games = sum(s["games"] for s in stats.values()) // 2
    box_games = sum(s["box_games"] for s in d1_stats)
    d1_games = sum(s["games"] for s in d1_stats)
    summary = {
        "season": season,
        "label": label,
        "division_i_teams": sum(1 for t in teams if t["division_i"]),
        "games": games,
        "box_coverage": round(box_games / d1_games, 3) if d1_games else 0.0,
        "players": sum(1 for p in players if p["division_i"]),
        "qualified_players": sum(1 for p in players if p["division_i"] and p["qualified"]),
    }
    return docs, summary


def build_season(
    sport: str, season: int, paths: dict[str, Path | None], min_division_i: int = 250
) -> SeasonBuild:
    """`paths` maps dataset key -> local parquet path (standings, rosters and
    player_boxscores may be None)."""
    ctx = f"{sport}/{season}"
    con = duckdb.connect()
    con.execute(f"CREATE VIEW schedules AS SELECT * FROM read_parquet('{paths['schedules']}')")
    con.execute(f"CREATE VIEW team_box AS SELECT * FROM read_parquet('{paths['team_boxscores']}')")
    if paths.get("standings"):
        con.execute(f"CREATE VIEW standings AS SELECT * FROM read_parquet('{paths['standings']}')")
        require_columns(con, "standings", "standings", ctx)
    else:
        logger.warning(
            "standings missing; conference names from schedules only", extra={"context": ctx}
        )
        con.execute(_EMPTY_STANDINGS)
    if paths.get("rosters"):
        con.execute(f"CREATE VIEW rosters AS SELECT * FROM read_parquet('{paths['rosters']}')")
    else:
        con.execute(_EMPTY_ROSTERS)
    has_players = bool(paths.get("player_boxscores"))
    if has_players:
        con.execute(
            f"CREATE VIEW player_box AS SELECT * FROM read_parquet('{paths['player_boxscores']}')"
        )
        require_columns(con, "player_box", "player_boxscores", ctx)
    require_columns(con, "schedules", "schedules", ctx)
    require_columns(con, "team_box", "team_boxscores", ctx)

    (completed,) = con.execute(
        "SELECT count(*) FROM schedules WHERE status_type_completed"
    ).fetchone()
    if completed == 0:
        raise SeasonNotStarted(f"{ctx}: no completed games yet")

    seed = sql_dir() / "conference_names.csv"
    con.execute(
        f"CREATE VIEW conference_names AS SELECT * FROM read_csv('{seed.as_posix()}', "
        "header=true, columns={'conference_id': 'INTEGER', 'conference_name': 'VARCHAR', "
        "'conference_short_name': 'VARCHAR'})"
    )
    run_sql_file(con, "teams.sql")
    run_sql_file(con, "team_season_stats.sql")
    warnings = validate_season(con, ctx, min_division_i=min_division_i)
    run_sql_file(con, "games.sql")
    run_sql_file(con, "conferences.sql")
    run_sql_file(con, "team_games.sql")
    if has_players:
        run_sql_file(con, "players.sql")
        warnings += validate_players(con, ctx)

    docs, summary = build_documents(con, sport, season, has_players)
    logger.info("built season", extra={"context": ctx, "objects": len(docs), **summary})
    return SeasonBuild(sport, season, con, docs, summary, warnings, has_players=has_players)
