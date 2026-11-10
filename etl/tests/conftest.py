"""Tiny hand-built fixture season (see docs/metrics.md for the worked numbers).

Teams: 1 = Alpha (D-I, conf 10), 2 = Beta (D-I, conf 10), 3 = Gamma (non-D-I).
  game 101  Alpha 70 - 60 Beta    at Alpha, conference game, box scores for both
  game 102  Beta  80 - 50 Gamma   at Beta, box scores for both
  game 103  Gamma 65 - 75 Alpha   at Gamma, NO box scores (tests coverage)
  game 104  Alpha vs Beta          canceled (not completed, no scores)
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

SCHEDULE_TYPES = {
    "game_id": "INTEGER",
    "season": "INTEGER",
    "status_type_completed": "BOOLEAN",
    "game_date_time": "TIMESTAMPTZ",
    "neutral_site": "BOOLEAN",
    "conference_competition": "BOOLEAN",
    "groups_id": "INTEGER",
    "groups_name": "VARCHAR",
    "groups_short_name": "VARCHAR",
    "groups_is_conference": "BOOLEAN",
    **{
        f"{side}_{c}": t
        for side in ("home", "away")
        for c, t in (
            ("id", "INTEGER"),
            ("score", "INTEGER"),
            ("location", "VARCHAR"),
            ("name", "VARCHAR"),
            ("abbreviation", "VARCHAR"),
            ("display_name", "VARCHAR"),
            ("short_display_name", "VARCHAR"),
            ("color", "VARCHAR"),
            ("alternate_color", "VARCHAR"),
            ("logo", "VARCHAR"),
            ("conference_id", "INTEGER"),
        )
    },
}

BOX_STATS = (
    "team_score",
    "field_goals_made",
    "field_goals_attempted",
    "three_point_field_goals_made",
    "three_point_field_goals_attempted",
    "free_throws_made",
    "free_throws_attempted",
    "offensive_rebounds",
    "defensive_rebounds",
    "total_rebounds",
    "assists",
    "total_turnovers",
    "steals",
    "blocks",
    "fouls",
)
BOX_TYPES = {
    "game_id": "INTEGER",
    "season": "INTEGER",
    "game_date_time": "TIMESTAMPTZ",
    "team_id": "INTEGER",
    "team_slug": "VARCHAR",
    "team_location": "VARCHAR",
    "team_name": "VARCHAR",
    "team_abbreviation": "VARCHAR",
    "team_display_name": "VARCHAR",
    "team_short_display_name": "VARCHAR",
    "team_color": "VARCHAR",
    "team_alternate_color": "VARCHAR",
    "team_logo": "VARCHAR",
    "opponent_team_id": "INTEGER",
    **{c: "INTEGER" for c in BOX_STATS},
}

TEAMS = {
    1: dict(location="Alpha", name="Aces", abbreviation="ALP", color="112233", conf=10),
    2: dict(location="Beta", name="Bees", abbreviation="BET", color="445566", conf=10),
    3: dict(location="Gamma", name="Goats", abbreviation="GAM", color="778899", conf=None),
}

# pts, fgm, fga, 3pm, 3pa, ftm, fta, orb, drb, trb, ast, tov, stl, blk, pf
BOX = {
    (101, 1): (70, 25, 60, 8, 20, 12, 16, 10, 25, 35, 15, 12, 6, 4, 18),
    (101, 2): (60, 22, 58, 6, 22, 10, 14, 8, 22, 30, 12, 14, 5, 3, 17),
    (102, 2): (80, 30, 62, 10, 25, 10, 12, 12, 28, 40, 20, 10, 8, 5, 15),
    (102, 3): (50, 18, 55, 4, 18, 10, 15, 9, 20, 29, 8, 16, 4, 2, 14),
}

GAMES = [  # game_id, home, away, home_score, away_score, completed, conference, date
    (101, 1, 2, 70, 60, True, True, "2025-11-05 19:00:00+00"),
    (102, 2, 3, 80, 50, True, False, "2025-11-08 19:00:00+00"),
    (103, 3, 1, 65, 75, True, False, "2025-11-12 19:00:00+00"),
    (104, 1, 2, None, None, False, True, "2025-11-15 19:00:00+00"),
]


def _write(path: Path, types: dict[str, str], rows: list[dict]) -> Path:
    con = duckdb.connect()
    cols = ", ".join(f'"{c}" {t}' for c, t in types.items())
    con.execute(f"CREATE TABLE t ({cols})")
    for r in rows:
        names = list(r)
        con.execute(
            f"INSERT INTO t ({', '.join(names)}) VALUES ({', '.join('?' for _ in names)})",
            [r[n] for n in names],
        )
    con.execute(f"COPY t TO '{path}' (FORMAT parquet)")
    return path


def _side(prefix: str, tid: int) -> dict:
    t = TEAMS[tid]
    return {
        f"{prefix}_id": tid,
        f"{prefix}_location": t["location"],
        f"{prefix}_name": t["name"],
        f"{prefix}_abbreviation": t["abbreviation"],
        f"{prefix}_display_name": f"{t['location']} {t['name']}",
        f"{prefix}_short_display_name": t["location"],
        f"{prefix}_color": t["color"],
        f"{prefix}_logo": f"https://example.test/{tid}.png",
        f"{prefix}_conference_id": t["conf"],
    }


def make_fixture(tmp: Path, box: dict | None = None, games: list | None = None):
    box = BOX if box is None else box
    games = GAMES if games is None else games
    sched_rows = []
    for gid, h, a, hs, as_, done, conf, ts in games:
        sched_rows.append(
            {
                "game_id": gid,
                "season": 2026,
                "status_type_completed": done,
                "game_date_time": ts,
                "neutral_site": False,
                "conference_competition": conf,
                "groups_id": 10 if conf else None,
                "groups_name": "Test Conference" if conf else None,
                "groups_short_name": "TC" if conf else None,
                "groups_is_conference": conf or None,
                "home_score": hs,
                "away_score": as_,
                **_side("home", h),
                **_side("away", a),
            }
        )
    box_rows = []
    game_teams = {g[0]: (g[1], g[2], g[7]) for g in games}
    for (gid, tid), stats in box.items():
        h, a, ts = game_teams[gid]
        t = TEAMS[tid]
        box_rows.append(
            {
                "game_id": gid,
                "season": 2026,
                "game_date_time": ts,
                "team_id": tid,
                "team_slug": t["location"].lower(),
                "team_location": t["location"],
                "team_name": t["name"],
                "team_abbreviation": t["abbreviation"],
                "team_display_name": f"{t['location']} {t['name']}",
                "team_short_display_name": t["location"],
                "team_color": t["color"],
                "team_logo": f"https://example.test/{tid}.png",
                "opponent_team_id": a if tid == h else h,
                **dict(zip(BOX_STATS, stats, strict=True)),
            }
        )
    return {
        "schedules": _write(tmp / "sched.parquet", SCHEDULE_TYPES, sched_rows),
        "team_boxscores": _write(tmp / "box.parquet", BOX_TYPES, box_rows),
        "standings": None,
    }


@pytest.fixture
def fixture_paths(tmp_path: Path):
    return make_fixture(tmp_path)
