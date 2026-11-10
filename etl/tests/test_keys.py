import pytest

from cbb_etl import keys


def test_api_layout():
    assert keys.seasons_key("mbb") == "v1/mbb/seasons.json"
    assert keys.teams_key("wbb", 2026) == "v1/wbb/2026/teams.json"
    assert keys.team_key("mbb", 2026, 41) == "v1/mbb/2026/teams/41.json"
    assert keys.team_stats_key("mbb", 2026) == "v1/mbb/2026/team-stats.json"
    assert keys.MANIFEST_KEY == "v1/manifest.json"
    assert keys.season_prefix("mbb", 2026) == "v1/mbb/2026/"


def test_lake_layout():
    assert keys.lake_key("mbb", "pbp", 2026) == "parquet/v1/mbb/pbp/season=2026/data.parquet"
    assert keys.lake_table_prefix("wbb", "schedules") == "parquet/v1/wbb/schedules/"


def test_team_keys_live_under_season_prefix():
    assert keys.team_key("mbb", 2026, 1).startswith(keys.season_prefix("mbb", 2026))
    assert not keys.lake_key("mbb", "pbp", 2026).startswith(keys.VERSION + "/")


@pytest.mark.parametrize(
    "call",
    [
        lambda: keys.teams_key("nba", 2026),
        lambda: keys.teams_key("mbb", 26),
        lambda: keys.lake_key("mbb", "../x", 2026),
    ],
)
def test_rejects_bad_parts(call):
    with pytest.raises(ValueError):
        call()
