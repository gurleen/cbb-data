"""Season-independent player career documents (v1/{sport}/players/{id}.json).

Built from the derived `player_season_stats` parquet of every season (this run's builds
plus the lake), but only for players who appear in a season rebuilt this run: past-only
players never change, and active players are refreshed by every current-season run.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import duckdb

from .. import keys
from ..seasons import season_label
from .documents import _r, player_slug, slugify


def build_careers(sport: str, season_files: list[Path], athlete_ids: set[int]) -> dict[str, Any]:
    if not season_files or not athlete_ids:
        return {}
    con = duckdb.connect()
    files = ", ".join(f"'{p.as_posix()}'" for p in season_files)
    con.execute(f"CREATE VIEW pss AS SELECT * FROM read_parquet([{files}], union_by_name=true)")
    con.execute("CREATE TEMP TABLE wanted (athlete_id BIGINT)")
    con.executemany("INSERT INTO wanted VALUES (?)", [(a,) for a in athlete_ids])
    cur = con.execute("""
        SELECT p.season, p.athlete_id, p.name, p.headshot, p.position, p.team_id, p.team_name,
               p.team_abbreviation, p.team_logo, p.conference_short_name, p.qualified,
               p.g, p.gs, p.mpg, p.ppg, p.rpg, p.apg, p.spg, p.bpg, p.fg_pct, p.fg3_pct,
               p.ft_pct, p.ts_pct, p.usg_pct
        FROM pss p JOIN wanted w USING (athlete_id)
        WHERE p.division_i
        ORDER BY p.athlete_id, p.season""")
    cols = [d[0] for d in cur.description]
    by_player: dict[int, list[dict]] = {}
    for row in cur.fetchall():
        r = dict(zip(cols, row, strict=True))
        by_player.setdefault(r["athlete_id"], []).append(r)

    docs: dict[str, Any] = {}
    for pid, rows in by_player.items():
        last = rows[-1]
        docs[keys.career_key(sport, pid)] = {
            "sport": sport,
            "player_id": pid,
            "name": last["name"],
            "slug": player_slug({"name": last["name"], "athlete_id": pid}),
            "headshot": next((r["headshot"] for r in reversed(rows) if r["headshot"]), None),
            "position": last["position"],
            "seasons": [
                {
                    "season": r["season"],
                    "label": season_label(r["season"]),
                    "team_id": r["team_id"],
                    "team": r["team_abbreviation"],
                    "team_name": r["team_name"],
                    "team_slug": slugify(r["team_name"]),
                    "team_logo": r["team_logo"],
                    "conference": r["conference_short_name"],
                    "qualified": bool(r["qualified"]),
                    "g": r["g"],
                    "gs": r["gs"],
                    **{
                        k: _r(r[k], 1)
                        for k in ("mpg", "ppg", "rpg", "apg", "spg", "bpg", "usg_pct")
                    },
                    **{k: _r(r[k], 3) for k in ("fg_pct", "fg3_pct", "ft_pct", "ts_pct")},
                }
                for r in rows
            ],
        }
    return docs
