import pytest

from cbb_etl.transform import SeasonNotStarted, build_season
from cbb_etl.validate import ValidationError
from tests.conftest import BOX, GAMES, make_fixture


def test_duplicate_box_rows_are_deduped(tmp_path):
    import duckdb

    # every (game_id, team_id) twice: transform dedupes, stats are unchanged
    paths = make_fixture(tmp_path)
    doubled = tmp_path / "doubled.parquet"
    src = paths["team_boxscores"]
    duckdb.connect().execute(
        f"COPY (SELECT * FROM '{src}' UNION ALL SELECT * FROM '{src}') "
        f"TO '{doubled}' (FORMAT parquet)"
    )
    paths["team_boxscores"] = doubled
    b = build_season("mbb", 2026, paths, min_division_i=2)
    assert b.con.execute(
        "SELECT box_games, pts FROM team_season_stats WHERE team_id = 2"
    ).fetchone() == (2, 140)


def test_tie_score_game_is_excluded_and_record_balanced(tmp_path):
    games = [*GAMES, (105, 1, 2, 70, 70, True, True, "2025-11-20 19:00:00+00")]
    b = build_season("mbb", 2026, make_fixture(tmp_path, games=games), min_division_i=2)
    assert b.con.execute("SELECT sum(wins), sum(losses) FROM team_season_stats").fetchone() == (
        3,
        3,
    )


def test_made_greater_than_attempted_fails(tmp_path):
    box = dict(BOX)
    box[(101, 1)] = (70, 61, 60, *BOX[(101, 1)][3:])
    with pytest.raises(ValidationError, match="made > attempted"):
        build_season("mbb", 2026, make_fixture(tmp_path, box=box), min_division_i=2)


def test_too_few_division_i_teams_fails(fixture_paths):
    with pytest.raises(ValidationError, match="Division I team count"):
        build_season("mbb", 2026, fixture_paths)


def test_empty_box_scores_fail(tmp_path):
    with pytest.raises(ValidationError, match="team_boxscores has 0 rows"):
        build_season("mbb", 2026, make_fixture(tmp_path, box={}), min_division_i=2)


def test_missing_required_column_fails(tmp_path):
    import duckdb

    paths = make_fixture(tmp_path)
    broken = tmp_path / "broken.parquet"
    duckdb.connect().execute(
        f"COPY (SELECT * EXCLUDE (total_turnovers) FROM '{paths['team_boxscores']}') "
        f"TO '{broken}' (FORMAT parquet)"
    )
    paths["team_boxscores"] = broken
    with pytest.raises(ValidationError, match="total_turnovers"):
        build_season("mbb", 2026, paths, min_division_i=2)


def test_season_not_started(tmp_path):
    games = [(g[0], g[1], g[2], None, None, False, g[6], g[7]) for g in GAMES]
    with pytest.raises(SeasonNotStarted):
        build_season("mbb", 2026, make_fixture(tmp_path, box={}, games=games))
