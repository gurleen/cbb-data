"""Phase 2-5 R2 documents: D-I ranks, conferences, team game logs, players, search.

All inputs are the per-season DuckDB tables built by the SQL in etl/sql/. Shapes are
mirrored by web/src/lib/api-types.ts.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from typing import Any

from .. import keys

Row = dict[str, Any]


def _r(v: float | None, nd: int) -> float | None:
    return None if v is None else round(float(v), nd)


def slugify(text: str | None) -> str:
    if not text:
        return ""
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")


def team_slug(t: Row) -> str:
    return t.get("slug") or slugify(t.get("display_name"))


def competition_ranks(
    rows: list[Row], key: str, higher_is_better: bool, eligible=lambda r: True
) -> dict[Any, int]:
    """Standard competition ranks (1, 2, 2, 4) over rows with a non-null value."""
    vals = [(r["_id"], r[key]) for r in rows if r.get(key) is not None and eligible(r)]
    vals.sort(key=lambda x: x[1], reverse=higher_is_better)
    out: dict[Any, int] = {}
    prev, prev_rank = None, 0
    for i, (rid, v) in enumerate(vals, start=1):
        rank = prev_rank if v == prev else i
        out[rid] = rank
        prev, prev_rank = v, rank
    return out


# stat -> higher is better
TEAM_RANKED = {
    "win_pct": True,
    "ortg": True,
    "drtg": False,
    "net_rtg": True,
    "pace": True,
    "ppg": True,
    "opp_ppg": False,
    "fg_pct": True,
    "fg3_pct": True,
    "ft_pct": True,
    "opp_fg_pct": False,
    "opp_fg3_pct": False,
    "rpg": True,
    "apg": True,
    "topg": False,
    "spg": True,
    "bpg": True,
}

PLAYER_RANKED = {
    "ppg": True,
    "rpg": True,
    "apg": True,
    "spg": True,
    "bpg": True,
    "mpg": True,
    "topg": False,
    "fg_pct": True,
    "fg3_pct": True,
    "ft_pct": True,
    "efg_pct": True,
    "ts_pct": True,
    "usg_pct": True,
}


def team_ranks(teams: list[Row], stats: dict[int, Row]) -> tuple[dict[int, dict], int]:
    """D-I ranks per team (teams with box games), plus the field size."""
    pool = [
        {"_id": t["team_id"], **stats[t["team_id"]]}
        for t in teams
        if t["division_i"] and t["team_id"] in stats and stats[t["team_id"]]["box_games"]
    ]
    by_team: dict[int, dict] = defaultdict(dict)
    for stat, hib in TEAM_RANKED.items():
        for tid, rank in competition_ranks(pool, stat, hib).items():
            by_team[tid][stat] = rank
    return by_team, len(pool)


def _opponent(t: Row | None, opp_id: int) -> Row:
    if t is None:
        return {
            "id": opp_id,
            "name": None,
            "abbreviation": None,
            "logo": None,
            "division_i": False,
            "slug": None,
        }
    return {
        "id": t["team_id"],
        "name": t["display_name"],
        "short_name": t["short_display_name"],
        "abbreviation": t["abbreviation"],
        "logo": t["logo"],
        "division_i": bool(t["division_i"]),
        "slug": team_slug(t),
    }


def _iso(epoch: float | None) -> str | None:
    """UTC ISO timestamp from epoch seconds (DuckDB TIMESTAMPTZ -> epoch() in SQL)."""
    if epoch is None:
        return None
    from datetime import UTC, datetime

    return datetime.fromtimestamp(epoch, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def team_game_docs(
    sport: str, season: int, teams_by_id: dict[int, Row], games: list[Row]
) -> dict[str, Any]:
    by_team: dict[int, list[Row]] = defaultdict(list)
    for g in games:
        by_team[g["team_id"]].append(g)
    docs = {}
    for tid, rows in by_team.items():
        if tid not in teams_by_id:
            continue
        out = []
        for g in rows:
            has_box = g["fga"] is not None
            out.append(
                {
                    "game_id": g["game_id"],
                    "date": _iso(g["game_epoch"]),
                    "postseason": g["season_type"] == 3,
                    "status": g["status"],
                    "completed": bool(g["completed"]),
                    "site": g["site"],
                    "conference_game": bool(g["conference_game"]),
                    "opponent": _opponent(teams_by_id.get(g["opponent_id"]), g["opponent_id"]),
                    "result": g["result"],
                    "pts": g["pts"],
                    "opp_pts": g["opp_pts"],
                    "box": None
                    if not has_box
                    else {
                        **{
                            k: g[k]
                            for k in (
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
                            )
                        },
                        "poss": _r(g["poss"], 1),
                        "ortg": _r(g["ortg"], 1),
                        "drtg": _r(g["drtg"], 1),
                    },
                }
            )
        docs[keys.team_games_key(sport, season, tid)] = {
            "sport": sport,
            "season": season,
            "team_id": tid,
            "count": len(out),
            "games": out,
        }
    return docs


def conference_docs(
    sport: str,
    season: int,
    label: str,
    confs: list[Row],
    teams_by_id: dict[int, Row],
    board_by_team: dict[int, Row],
    stats: dict[int, Row],
) -> dict[str, Any]:
    rows = []
    for rank, c in enumerate(confs, start=1):
        best = teams_by_id.get(c["best_team_id"]) if c["best_team_id"] is not None else None
        rows.append(
            {
                "id": c["conference_id"],
                "name": c["conference_name"],
                "short_name": c["conference_short_name"],
                "rank": rank if c["avg_net_rtg"] is not None else None,
                "teams": c["teams"],
                "avg_ortg": _r(c["avg_ortg"], 1),
                "avg_drtg": _r(c["avg_drtg"], 1),
                "avg_net_rtg": _r(c["avg_net_rtg"], 1),
                "avg_pace": _r(c["avg_pace"], 1),
                "nonconf_wins": c["nonconf_wins"],
                "nonconf_losses": c["nonconf_losses"],
                "best_team": None
                if best is None
                else {
                    "id": best["team_id"],
                    "name": best["display_name"],
                    "abbreviation": best["abbreviation"],
                    "logo": best["logo"],
                    "slug": team_slug(best),
                    "net_rtg": _r(stats.get(best["team_id"], {}).get("net_rtg"), 1),
                },
            }
        )
    docs: dict[str, Any] = {
        keys.conferences_key(sport, season): {
            "sport": sport,
            "season": season,
            "season_label": label,
            "count": len(rows),
            "conferences": rows,
        }
    }
    for c in rows:
        members = []
        for tid, t in teams_by_id.items():
            if not t["division_i"] or t["conference_id"] != c["id"] or tid not in board_by_team:
                continue
            s = stats[tid]
            cw, cl = s["conf_wins"], s["conf_losses"]
            members.append(
                {
                    **board_by_team[tid],
                    "slug": team_slug(t),
                    "conf_win_pct": _r(cw / (cw + cl), 3) if cw + cl else None,
                    "home_wins": s["home_wins"],
                    "home_losses": s["home_losses"],
                    "away_wins": s["away_wins"],
                    "away_losses": s["away_losses"],
                    "neutral_wins": s["neutral_wins"],
                    "neutral_losses": s["neutral_losses"],
                }
            )
        members.sort(key=lambda m: (-(m["conf_win_pct"] or 0), -(m["win_pct"] or 0)))
        docs[keys.conference_key(sport, season, c["id"])] = {
            "sport": sport,
            "season": season,
            "season_label": label,
            "conference": c,
            "teams": members,
        }
    return docs


def _player_line(p: Row) -> Row:
    return {
        "g": p["g"],
        "gs": p["gs"],
        "mpg": _r(p["mpg"], 1),
        "ppg": _r(p["ppg"], 1),
        "rpg": _r(p["rpg"], 1),
        "orpg": _r(p["orpg"], 1),
        "apg": _r(p["apg"], 1),
        "spg": _r(p["spg"], 1),
        "bpg": _r(p["bpg"], 1),
        "topg": _r(p["topg"], 1),
        "fgm": _r(p["fgm"] / p["g"], 1) if p["g"] else None,
        "fga": _r(p["fga"] / p["g"], 1) if p["g"] else None,
        "fg3m": _r(p["fg3m"] / p["g"], 1) if p["g"] else None,
        "fg3a": _r(p["fg3a"] / p["g"], 1) if p["g"] else None,
        "ftm": _r(p["ftm"] / p["g"], 1) if p["g"] else None,
        "fta": _r(p["fta"] / p["g"], 1) if p["g"] else None,
        "fg_pct": _r(p["fg_pct"], 3),
        "fg3_pct": _r(p["fg3_pct"], 3),
        "ft_pct": _r(p["ft_pct"], 3),
        "efg_pct": _r(p["efg_pct"], 3),
        "ts_pct": _r(p["ts_pct"], 3),
        "usg_pct": _r(p["usg_pct"], 1),
        "min_pct": _r(p["min_pct"], 3),
    }


def player_slug(p: Row) -> str:
    return slugify(p.get("name")) or str(p["athlete_id"])


def _player_ident(p: Row, team: Row | None) -> Row:
    return {
        "player_id": p["athlete_id"],
        "name": p["name"],
        "slug": player_slug(p),
        "jersey": p["jersey"],
        "position": p["position"],
        "class": p["class"],
        "height": p["height"],
        "team_id": p["team_id"],
        "team": None if team is None else team["abbreviation"],
        "team_name": None if team is None else team["display_name"],
        "team_slug": None if team is None else team_slug(team),
        "team_logo": None if team is None else team["logo"],
        "conference_id": None if team is None else team["conference_id"],
        "conference": None if team is None else team["conference_short_name"],
    }


def ranks_doc(sport: str, season: int, field: int, ranks: dict[int, dict]) -> Row:
    """All ranks for a season in one document, keyed by id (as a string, for JSON)."""
    return {
        "sport": sport,
        "season": season,
        "field": field,
        "ranks": {str(k): v for k, v in sorted(ranks.items()) if v},
    }


def player_docs(
    sport: str,
    season: int,
    label: str,
    players: list[Row],
    games: list[Row],
    teams_by_id: dict[int, Row],
) -> tuple[dict[str, Any], dict[int, list[Row]]]:
    """Leaderboards, per-player docs, and roster entries by team."""
    d1 = [p for p in players if p["division_i"]]
    for p in d1:
        p["_id"] = p["athlete_id"]
        g = p["g"] or 1
        p["_fg3a_pg"], p["_fta_pg"] = p["fg3a"] / g, p["fta"] / g
    qualified = [p for p in d1 if p["qualified"]]
    eligible = {
        "fg3_pct": lambda r: r["_fg3a_pg"] >= 1.0,
        "ft_pct": lambda r: r["_fta_pg"] >= 1.0,
    }
    ranks: dict[int, dict] = defaultdict(dict)
    for stat, hib in PLAYER_RANKED.items():
        pool_ranks = competition_ranks(qualified, stat, hib, eligible.get(stat, lambda r: True))
        for pid, rank in pool_ranks.items():
            ranks[pid][stat] = rank

    rows_all = []
    for p in d1:
        team = teams_by_id.get(p["team_id"])
        rows_all.append(
            {**_player_ident(p, team), "qualified": bool(p["qualified"]), **_player_line(p)}
        )
    rows_all.sort(key=lambda r: -(r["ppg"] or 0))
    columns = list(rows_all[0]) if rows_all else []

    def columnar(rows: list[Row], qualified_only: bool) -> Row:
        # Columnar ({columns, data}) halves the size vs. an array of objects; these are
        # the biggest documents (thousands of rows).
        return {
            "sport": sport,
            "season": season,
            "season_label": label,
            "qualified_only": qualified_only,
            "field": len(qualified),
            "count": len(rows),
            "columns": columns,
            "data": [[r[c] for c in columns] for r in rows],
        }

    docs: dict[str, Any] = {
        keys.players_key(sport, season): columnar([r for r in rows_all if r["qualified"]], True),
        keys.players_all_key(sport, season): columnar(rows_all, False),
    }

    log_by_player: dict[int, list[Row]] = defaultdict(list)
    for g in games:
        log_by_player[g["athlete_id"]].append(g)

    rosters: dict[int, list[Row]] = defaultdict(list)
    for p in d1:
        team = teams_by_id.get(p["team_id"])
        log = []
        for g in sorted(log_by_player.get(p["athlete_id"], []), key=lambda x: x["game_epoch"] or 0):
            opp = teams_by_id.get(g["opponent_id"])
            res = None
            if g["team_pts"] is not None and g["opp_pts"] is not None:
                res = "W" if g["team_pts"] > g["opp_pts"] else "L"
            log.append(
                {
                    "game_id": g["game_id"],
                    "date": _iso(g["game_epoch"]),
                    "team_id": g["team_id"],
                    "site": g["home_away"],
                    "opponent": _opponent(opp, g["opponent_id"]),
                    "result": res,
                    "team_pts": g["team_pts"],
                    "opp_pts": g["opp_pts"],
                    "starter": bool(g["starter"]),
                    **{
                        k: g[k]
                        for k in (
                            "min",
                            "pts",
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
                            "stl",
                            "blk",
                            "tov",
                            "pf",
                        )
                    },
                }
            )
        totals = {
            k: p[k]
            for k in (
                "min",
                "pts",
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
                "stl",
                "blk",
                "tov",
                "pf",
            )
        }
        docs[keys.player_key(sport, season, p["athlete_id"])] = {
            "sport": sport,
            "season": season,
            "season_label": label,
            "player": {
                **_player_ident(p, team),
                "weight": p["weight"],
                "headshot": p["headshot"],
                "teams_played_for": p["teams_played_for"],
            },
            "qualified": bool(p["qualified"]),
            # field + ranks live in ranks/players.json (see keys.player_ranks_key)
            "line": _player_line(p),
            "totals": totals,
            "games": log,
        }
        rosters[p["team_id"]].append(
            {
                "player_id": p["athlete_id"],
                "name": p["name"],
                "slug": player_slug(p),
                "jersey": p["jersey"],
                "position": p["position"],
                "class": p["class"],
                "height": p["height"],
                "qualified": bool(p["qualified"]),
                "g": p["g"],
                "gs": p["gs"],
                "mpg": _r(p["mpg"], 1),
                "ppg": _r(p["ppg"], 1),
                "rpg": _r(p["rpg"], 1),
                "apg": _r(p["apg"], 1),
                "fg_pct": _r(p["fg_pct"], 3),
                "fg3_pct": _r(p["fg3_pct"], 3),
                "ft_pct": _r(p["ft_pct"], 3),
            }
        )
    for r in rosters.values():
        r.sort(key=lambda x: -(x["mpg"] or 0))
    docs[keys.player_ranks_key(sport, season)] = ranks_doc(sport, season, len(qualified), ranks)
    return docs, rosters


def search_doc(
    sport: str, season: int, teams: list[Row], players: list[Row], teams_by_id: dict[int, Row]
) -> dict[str, Any]:
    """Compact search index: arrays instead of objects to keep it small."""
    team_rows = [
        [
            t["team_id"],
            t["display_name"],
            t["abbreviation"],
            team_slug(t),
            t["conference_short_name"],
        ]
        for t in teams
        if t["division_i"]
    ]
    player_rows = []
    for p in players:
        if not p["division_i"]:
            continue
        team = teams_by_id.get(p["team_id"])
        player_rows.append(
            [
                p["athlete_id"],
                p["name"],
                player_slug(p),
                team["abbreviation"] if team else None,
                p["team_id"],
            ]
        )
    return {
        "sport": sport,
        "season": season,
        "teams_columns": ["id", "name", "abbreviation", "slug", "conference"],
        "players_columns": ["id", "name", "slug", "team", "team_id"],
        "teams": team_rows,
        "players": player_rows,
    }
