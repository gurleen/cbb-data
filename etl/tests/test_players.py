"""Player formulas against the hand-built fixture (conftest.PLAYER_ROWS)."""

import pytest

from cbb_etl import keys
from cbb_etl.transform import build_season
from cbb_etl.transform.careers import build_careers
from cbb_etl.transform.documents import slugify


@pytest.fixture
def built(fixture_with_players):
    return build_season("mbb", 2026, fixture_with_players, min_division_i=2)


def stats(built, athlete_id):
    cur = built.con.execute("SELECT * FROM player_season_stats WHERE athlete_id = ?", [athlete_id])
    cols = [d[0] for d in cur.description]
    return dict(zip(cols, cur.fetchone(), strict=True))


def test_dnp_rows_are_excluded(built):
    cy = stats(built, 21)
    assert cy["g"] == 1 and cy["gs"] == 0 and cy["min"] == 12


def test_shooting_and_usage(built):
    bea = stats(built, 20)
    assert (bea["g"], bea["gs"], bea["min"], bea["pts"]) == (2, 2, 60, 40)
    assert bea["ppg"] == 20
    assert bea["ts_pct"] == pytest.approx(40 / (2 * (30 + 0.44 * 6)))  # 0.6127
    assert bea["efg_pct"] == pytest.approx((16 + 0.5 * 3) / 30)  # 0.5833
    # Team context in Bea's games (fixture box only has these players):
    #   g101 Beta: min 32, FGA 16, FTA 4, TOV 3   g102 Beta: min 40, FGA 19, FTA 2, TOV 3
    usg = 100 * (30 + 0.44 * 6 + 5) * ((32 + 40) / 5) / (60 * (35 + 0.44 * 6 + 6))
    assert bea["usg_pct"] == pytest.approx(usg)  # 20.70
    assert bea["team_id"] == 2 and bea["division_i"]


def test_player_documents(built):
    docs = built.documents
    board = docs[keys.players_key("mbb", 2026)]
    rows = [dict(zip(board["columns"], r, strict=True)) for r in board["data"]]
    assert [r["player_id"] for r in rows] == [10, 20, 21]  # sorted by PPG (20, 20, 4)
    bea = docs[keys.player_key("mbb", 2026, 20)]
    assert bea["player"]["slug"] == "bea-beta"
    assert bea["line"]["ppg"] == 20.0 and "ranks" not in bea
    assert docs[keys.player_ranks_key("mbb", 2026)]["ranks"]["20"]["ppg"] == 1
    assert [g["game_id"] for g in bea["games"]] == [101, 102]
    assert bea["games"][0]["result"] == "L" and bea["games"][1]["result"] == "W"
    roster = docs[keys.team_key("mbb", 2026, 2)]["roster"]
    assert [p["player_id"] for p in roster] == [20, 21]  # by MPG
    search = docs[keys.search_key("mbb", 2026)]
    assert [p[0] for p in search["players"]] == [10, 20, 21]


def test_careers(built, tmp_path):
    paths = built.export_derived(tmp_path / "derived")
    docs = build_careers("mbb", [paths["player_season_stats"]], {20})
    career = docs[keys.career_key("mbb", 20)]
    assert career["name"] == "Bea Beta"
    assert [s["season"] for s in career["seasons"]] == [2026]
    assert career["seasons"][0]["ppg"] == 20.0


def test_slugify():
    assert slugify("Jaxon Kohler-Smith Jr.") == "jaxon-kohler-smith-jr"
    assert slugify("Ömer Yurtseven") == "omer-yurtseven"
    assert slugify(None) == ""
