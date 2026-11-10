"""Stat formulas against the hand-computed fixture in conftest.py / docs/metrics.md."""

import pytest

from cbb_etl import keys
from cbb_etl.transform import build_season

# Possessions (hand-computed):
#   game 101: Alpha 60-10+12+0.475*16 = 69.6 ; Beta 58-8+14+0.475*14 = 70.65 -> 70.125
#   game 102: Beta  62-12+10+0.475*12 = 65.7 ; Gamma 55-9+16+0.475*15 = 69.125 -> 67.4125
POSS_101 = 70.125
POSS_102 = 67.4125


@pytest.fixture
def built(fixture_paths):
    return build_season("mbb", 2026, fixture_paths, min_division_i=2)


def stats(built, team_id):
    cur = built.con.execute("SELECT * FROM team_season_stats WHERE team_id = ?", [team_id])
    cols = [d[0] for d in cur.description]
    return dict(zip(cols, cur.fetchone(), strict=True))


def test_records_come_from_schedule(built):
    a, b, g = stats(built, 1), stats(built, 2), stats(built, 3)
    assert (a["games"], a["wins"], a["losses"]) == (2, 2, 0)  # canceled game 104 excluded
    assert (b["games"], b["wins"], b["losses"]) == (2, 1, 1)
    assert (g["games"], g["wins"], g["losses"]) == (2, 0, 2)
    assert (a["conf_wins"], a["conf_losses"]) == (1, 0)
    assert (b["conf_wins"], b["conf_losses"]) == (0, 1)
    assert (a["home_wins"], a["away_wins"]) == (1, 1)
    assert (b["home_wins"], b["away_losses"]) == (1, 1)


def test_box_coverage(built):
    a = stats(built, 1)
    assert a["box_games"] == 1 and a["box_coverage"] == pytest.approx(0.5)


def test_alpha_rates(built):
    a = stats(built, 1)
    assert a["possessions"] == pytest.approx(POSS_101)
    assert a["ppg"] == 70 and a["opp_ppg"] == 60
    assert a["fg_pct"] == pytest.approx(25 / 60)
    assert a["ortg"] == pytest.approx(100 * 70 / POSS_101)  # 99.82
    assert a["drtg"] == pytest.approx(100 * 60 / POSS_101)  # 85.56
    assert a["net_rtg"] == pytest.approx(100 * 10 / POSS_101)
    assert a["pace"] == pytest.approx(POSS_101)


def test_beta_aggregates(built):
    b = stats(built, 2)
    poss = POSS_101 + POSS_102
    assert b["box_games"] == 2
    assert (b["pts"], b["opp_pts"]) == (140, 120)
    assert b["ppg"] == 70 and b["opp_ppg"] == 60
    assert b["fg_pct"] == pytest.approx(52 / 120)
    assert b["fg3_pct"] == pytest.approx(16 / 47)
    assert b["ft_pct"] == pytest.approx(20 / 26)
    assert b["opp_fg_pct"] == pytest.approx(43 / 115)
    assert b["rpg"] == 35 and b["apg"] == 16 and b["topg"] == 12
    assert b["spg"] == 6.5 and b["bpg"] == 4
    assert b["ortg"] == pytest.approx(100 * 140 / poss)  # 101.79
    assert b["drtg"] == pytest.approx(100 * 120 / poss)  # 87.25
    assert b["pace"] == pytest.approx(poss / 2)  # 68.77


def test_team_metadata(built):
    rows = built.con.execute(
        "SELECT team_id, display_name, division_i, conference_name FROM teams ORDER BY 1"
    ).fetchall()
    assert rows == [
        (1, "Alpha Aces", True, "Test Conference"),
        (2, "Beta Bees", True, "Test Conference"),
        (3, "Gamma Goats", False, None),
    ]


def test_documents(built):
    docs = built.documents
    assert set(docs) == {
        keys.teams_key("mbb", 2026),
        keys.team_stats_key("mbb", 2026),
        *(keys.team_key("mbb", 2026, t) for t in (1, 2, 3)),
    }
    board = docs[keys.team_stats_key("mbb", 2026)]
    assert [r["team_id"] for r in board["rows"]] == [1, 2]  # D-I only
    beta = docs[keys.team_key("mbb", 2026, 2)]
    assert beta["ratings"] == {"ortg": 101.8, "drtg": 87.2, "net_rtg": 14.5, "pace": 68.8}
    assert beta["team"]["color"] == "#445566"
    assert beta["team"]["conference"] == {"id": 10, "name": "Test Conference", "short_name": "TC"}
    assert built.summary["games"] == 3
