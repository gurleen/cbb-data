-- Player games + season stats for one sport-season. Formulas: docs/metrics.md.
-- Inputs: player_box, rosters (may be empty), team_box, completed_games, teams.
-- Outputs: tables `player_games`, `player_season_stats`.
--
-- * A player game = a player_box row for a completed game where the player did not
--   have did_not_play set. Rows are deduplicated by (game_id, athlete_id).
-- * A player's team is the team they played the most games for (a handful of players
--   appear for two teams in a season).
-- * Usage uses team totals from the games the player played in.
-- * `qualified` (leaderboards, ranks): >= 40% of the team's minutes, or >= 50% of its
--   games when minutes are missing (some early seasons).

CREATE OR REPLACE TABLE player_games AS
WITH pb AS (
    SELECT *
    FROM player_box
    WHERE athlete_id IS NOT NULL AND team_id IS NOT NULL
      AND NOT coalesce(did_not_play, false)
      AND game_id IN (SELECT game_id FROM completed_games)
    QUALIFY row_number() OVER (PARTITION BY game_id, athlete_id ORDER BY game_date_time DESC) = 1
),
team_game AS (  -- team context per (game, team)
    SELECT game_id, team_id,
           sum(coalesce(minutes, 0)) AS tm_min,
           sum(field_goals_attempted) AS tm_fga,
           sum(free_throws_attempted) AS tm_fta,
           sum(turnovers) AS tm_tov
    FROM pb GROUP BY 1, 2
)
SELECT
    pb.athlete_id, pb.game_id, pb.team_id, pb.opponent_team_id AS opponent_id,
    pb.game_date_time, pb.home_away,
    pb.team_score AS team_pts, pb.opponent_team_score AS opp_pts,
    coalesce(pb.starter, false) AS starter,
    coalesce(pb.minutes, 0) AS min,
    pb.points AS pts,
    pb.field_goals_made AS fgm, pb.field_goals_attempted AS fga,
    pb.three_point_field_goals_made AS fg3m, pb.three_point_field_goals_attempted AS fg3a,
    pb.free_throws_made AS ftm, pb.free_throws_attempted AS fta,
    pb.offensive_rebounds AS orb, pb.defensive_rebounds AS drb, pb.rebounds AS trb,
    pb.assists AS ast, pb.steals AS stl, pb.blocks AS blk, pb.turnovers AS tov,
    pb.fouls AS pf,
    tg.tm_min, tg.tm_fga, tg.tm_fta, tg.tm_tov,
    pb.athlete_display_name, pb.athlete_short_name, pb.athlete_jersey,
    pb.athlete_position_abbreviation, pb.athlete_headshot_href
FROM pb
JOIN team_game tg USING (game_id, team_id);

CREATE OR REPLACE TABLE player_season_stats AS
WITH team_counts AS (
    SELECT athlete_id, team_id, count(*) AS n, max(game_date_time) AS last_ts
    FROM player_games GROUP BY 1, 2
),
primary_team AS (
    SELECT athlete_id, arg_max(team_id, n * 1e12 + epoch(last_ts)) AS team_id,
           count(*) AS teams_played_for
    FROM team_counts GROUP BY 1
),
team_minutes AS (  -- team's total player-minutes / 5 = team minutes, over all its games
    SELECT team_id, sum(tm_min) / 5.0 AS team_min, count(*) AS team_g
    FROM (SELECT DISTINCT game_id, team_id, tm_min FROM player_games) GROUP BY 1
),
agg AS (
    SELECT athlete_id,
           count(*) AS g, count(*) FILTER (WHERE starter) AS gs,
           sum(min) AS min, sum(pts) AS pts,
           sum(fgm) AS fgm, sum(fga) AS fga, sum(fg3m) AS fg3m, sum(fg3a) AS fg3a,
           sum(ftm) AS ftm, sum(fta) AS fta, sum(orb) AS orb, sum(drb) AS drb,
           sum(trb) AS trb, sum(ast) AS ast, sum(stl) AS stl, sum(blk) AS blk,
           sum(tov) AS tov, sum(pf) AS pf,
           sum(tm_min) / 5.0 AS tm_min_on, sum(tm_fga) AS tm_fga, sum(tm_fta) AS tm_fta,
           sum(tm_tov) AS tm_tov,
           arg_max(athlete_display_name, game_date_time) AS box_name,
           arg_max(athlete_short_name, game_date_time) AS box_short_name,
           arg_max(athlete_jersey, game_date_time) FILTER (WHERE athlete_jersey IS NOT NULL) AS box_jersey,
           arg_max(athlete_position_abbreviation, game_date_time)
               FILTER (WHERE athlete_position_abbreviation IS NOT NULL) AS box_position,
           arg_max(athlete_headshot_href, game_date_time)
               FILTER (WHERE athlete_headshot_href IS NOT NULL) AS box_headshot
    FROM player_games GROUP BY 1
),
roster AS (
    SELECT CAST(athlete_id AS VARCHAR) AS rid,
           any_value(display_name) AS name, any_value(position_abbreviation) AS position,
           any_value(height) AS height, any_value(weight) AS weight,
           any_value(experience_display_value) AS class, any_value(jersey) AS jersey,
           any_value(headshot_href) AS headshot
    FROM rosters GROUP BY 1
)
SELECT
    a.athlete_id,
    coalesce(r.name, a.box_name) AS name,
    a.box_short_name AS short_name,
    p.team_id, p.teams_played_for,
    coalesce(t.division_i, false) AS division_i,
    coalesce(r.jersey, a.box_jersey) AS jersey,
    coalesce(r.position, a.box_position) AS position,
    r.height, r.weight, r.class,
    coalesce(r.headshot, a.box_headshot) AS headshot,
    a.* EXCLUDE (athlete_id, box_name, box_short_name, box_jersey, box_position, box_headshot,
                 tm_min_on, tm_fga, tm_fta, tm_tov),
    a.min / nullif(a.g, 0)  AS mpg,
    a.pts / nullif(a.g, 0)  AS ppg,
    a.trb / nullif(a.g, 0)  AS rpg,
    a.orb / nullif(a.g, 0)  AS orpg,
    a.ast / nullif(a.g, 0)  AS apg,
    a.stl / nullif(a.g, 0)  AS spg,
    a.blk / nullif(a.g, 0)  AS bpg,
    a.tov / nullif(a.g, 0)  AS topg,
    a.fgm / nullif(a.fga, 0)::DOUBLE   AS fg_pct,
    a.fg3m / nullif(a.fg3a, 0)::DOUBLE AS fg3_pct,
    a.ftm / nullif(a.fta, 0)::DOUBLE   AS ft_pct,
    (a.fgm + 0.5 * a.fg3m) / nullif(a.fga, 0)       AS efg_pct,
    a.pts / nullif(2 * (a.fga + 0.44 * a.fta), 0)   AS ts_pct,
    100.0 * (a.fga + 0.44 * a.fta + a.tov) * a.tm_min_on
        / nullif(a.min * (a.tm_fga + 0.44 * a.tm_fta + a.tm_tov), 0) AS usg_pct,
    a.min / nullif(tm.team_min, 0) AS min_pct,
    -- leaderboard qualifier: >= 40% of team minutes; old seasons without minutes data
    -- fall back to playing >= 50% of the team's games
    CASE WHEN tm.team_min > 0 THEN a.min / tm.team_min >= 0.4
         ELSE a.g >= 0.5 * tm.team_g END AS qualified
FROM agg a
JOIN primary_team p USING (athlete_id)
LEFT JOIN teams t ON t.team_id = p.team_id
LEFT JOIN team_minutes tm ON tm.team_id = p.team_id
LEFT JOIN roster r ON r.rid = CAST(a.athlete_id AS VARCHAR)
ORDER BY a.athlete_id;
