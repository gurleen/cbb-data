"""Pre-publish validation. Any failure raises ValidationError and aborts the run before
anything is written."""

from __future__ import annotations

import duckdb

from . import log

logger = log.get(__name__)


class ValidationError(Exception):
    pass


REQUIRED_COLUMNS: dict[str, tuple[str, ...]] = {
    "schedules": (
        "game_id",
        "season",
        "status_type_completed",
        "game_date_time",
        "neutral_site",
        "conference_competition",
        "groups_id",
        "groups_name",
        "groups_short_name",
        "groups_is_conference",
        *(
            f"{side}_{c}"
            for side in ("home", "away")
            for c in (
                "id",
                "score",
                "location",
                "name",
                "abbreviation",
                "display_name",
                "short_display_name",
                "color",
                "alternate_color",
                "logo",
                "conference_id",
            )
        ),
    ),
    "team_boxscores": (
        "game_id",
        "season",
        "game_date_time",
        "team_id",
        "team_slug",
        "team_location",
        "team_name",
        "team_abbreviation",
        "team_display_name",
        "team_short_display_name",
        "team_color",
        "team_alternate_color",
        "team_logo",
        "team_score",
        "opponent_team_id",
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
    ),
    "standings": ("team_id", "group_id", "group_name", "group_short_name"),
}


def columns_of(con: duckdb.DuckDBPyConnection, relation: str) -> list[str]:
    return [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {relation}").fetchall()]


def require_columns(
    con: duckdb.DuckDBPyConnection, relation: str, dataset: str, context: str
) -> None:
    have = set(columns_of(con, relation))
    missing = [c for c in REQUIRED_COLUMNS.get(dataset, ()) if c not in have]
    if missing:
        raise ValidationError(f"{context}: {dataset} missing required columns {missing}")


def _one(con: duckdb.DuckDBPyConnection, sql: str):
    return con.execute(sql).fetchone()


def validate_season(
    con: duckdb.DuckDBPyConnection, context: str, min_division_i: int = 250
) -> list[str]:
    """Checks on the `teams` and `team_season_stats` tables. Returns warnings."""
    errors: list[str] = []
    warnings: list[str] = []

    n_sched, n_box = _one(
        con, "SELECT (SELECT count(*) FROM schedules), (SELECT count(*) FROM team_box)"
    )
    if n_sched == 0:
        errors.append("schedules has 0 rows")
    if n_box == 0:
        errors.append("team_boxscores has 0 rows")

    n_teams, n_d1, dup_teams = _one(
        con,
        """
        SELECT count(*), count(*) FILTER (WHERE division_i),
               count(*) - count(DISTINCT team_id) FROM teams""",
    )
    if n_teams == 0:
        errors.append("teams has 0 rows")
    if dup_teams:
        errors.append(f"teams has {dup_teams} duplicate team_id rows")
    if not min_division_i <= n_d1 <= 400:
        errors.append(f"implausible Division I team count: {n_d1}")

    n_stats, dup_stats = _one(
        con, "SELECT count(*), count(*) - count(DISTINCT team_id) FROM team_season_stats"
    )
    if n_stats == 0:
        errors.append("team_season_stats has 0 rows")
    if dup_stats:
        errors.append(f"team_season_stats has {dup_stats} duplicate team_id rows")

    # Every game has exactly one winner and one loser.
    wins, losses, games, completed = _one(
        con,
        """
        SELECT sum(wins), sum(losses), sum(games),
               (SELECT count(DISTINCT game_id) FROM schedules
                WHERE status_type_completed AND home_score IS NOT NULL
                  AND away_score IS NOT NULL AND home_score <> away_score
                  AND home_id IS NOT NULL AND away_id IS NOT NULL)
        FROM team_season_stats""",
    )
    if wins != losses:
        errors.append(f"total wins ({wins}) != total losses ({losses})")
    if games != 2 * completed:
        errors.append(f"team-games ({games}) != 2 x completed games ({completed})")

    bad = _one(
        con,
        """
        SELECT count(*) FILTER (WHERE wins + losses <> games),
               count(*) FILTER (WHERE games > 45),
               count(*) FILTER (WHERE box_games > games),
               count(*) FILTER (WHERE fgm > fga OR fg3m > fg3a OR ftm > fta OR fg3m > fgm),
               count(*) FILTER (WHERE t.division_i AND box_games >= 5
                                AND ppg NOT BETWEEN 30 AND 130),
               count(*) FILTER (WHERE t.division_i AND box_games >= 5
                                AND pace NOT BETWEEN 45 AND 100)
        FROM team_season_stats s JOIN teams t USING (team_id)""",
    )
    labels = (
        "wins+losses != games",
        "more than 45 games",
        "box_games > games",
        "made > attempted",
        "D-I ppg outside 30-130",
        "D-I pace outside 45-100",
    )
    for label, n in zip(labels, bad, strict=True):
        if n:
            errors.append(f"{n} teams with {label}")

    # Soft checks: logged, never fatal.
    (score_mismatch,) = _one(
        con,
        """
        SELECT count(*) FROM team_box WHERE team_score <>
            2 * field_goals_made + three_point_field_goals_made + free_throws_made""",
    )
    if score_mismatch:
        warnings.append(f"{score_mismatch} box rows where points != 2*FGM + 3PM + FTM")
    (box_not_final,) = _one(
        con,
        """
        SELECT count(DISTINCT game_id) FROM team_box WHERE game_id NOT IN (
            SELECT game_id FROM schedules WHERE status_type_completed
              AND home_score IS NOT NULL AND away_score IS NOT NULL
              AND home_score <> away_score)""",
    )
    if box_not_final:
        warnings.append(f"{box_not_final} box-score games not completed in the schedule (excluded)")
    (d1_no_conf_name,) = _one(
        con, "SELECT count(*) FROM teams WHERE division_i AND conference_name IS NULL"
    )
    if d1_no_conf_name:
        warnings.append(f"{d1_no_conf_name} Division I teams without a conference name")

    if errors:
        raise ValidationError(f"{context}: " + "; ".join(errors))
    for w in warnings:
        logger.warning(w, extra={"context": context})
    return warnings
