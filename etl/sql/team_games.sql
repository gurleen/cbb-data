-- Per-team game log for one sport-season: every schedule game (completed or not).
-- Inputs: schedules, box_pairs. Output: table `team_games`.

CREATE OR REPLACE TABLE team_games AS
WITH sched AS (
    SELECT *
    FROM schedules
    WHERE home_id IS NOT NULL AND away_id IS NOT NULL
    QUALIFY row_number() OVER (PARTITION BY game_id ORDER BY game_date_time DESC) = 1
),
sides AS (
    SELECT game_id, game_date_time, season_type, status_type_completed AS completed,
           status_type_name AS status, coalesce(neutral_site, false) AS neutral,
           coalesce(conference_competition, false) AS conference_game,
           home_id AS team_id, away_id AS opponent_id, home_score AS pts,
           away_score AS opp_pts, 'home' AS side
    FROM sched
    UNION ALL
    SELECT game_id, game_date_time, season_type, status_type_completed,
           status_type_name, coalesce(neutral_site, false),
           coalesce(conference_competition, false),
           away_id, home_id, away_score, home_score, 'away'
    FROM sched
)
SELECT
    s.team_id, s.game_id, s.game_date_time, s.season_type, s.status, s.completed,
    s.conference_game, s.opponent_id,
    CASE WHEN s.neutral THEN 'neutral' ELSE s.side END AS site,
    CASE WHEN s.completed AND s.pts IS NOT NULL AND s.opp_pts IS NOT NULL
              AND s.pts <> s.opp_pts
         THEN CASE WHEN s.pts > s.opp_pts THEN 'W' ELSE 'L' END END AS result,
    CASE WHEN s.completed THEN s.pts END     AS pts,
    CASE WHEN s.completed THEN s.opp_pts END AS opp_pts,
    b.fgm, b.fga, b.fg3m, b.fg3a, b.ftm, b.fta, b.orb, b.drb, b.trb, b.ast, b.tov,
    b.stl, b.blk, b.pf, b.poss,
    100.0 * s.pts / nullif(b.poss, 0)     AS ortg,
    100.0 * s.opp_pts / nullif(b.poss, 0) AS drtg
FROM sides s
LEFT JOIN box_pairs b ON b.game_id = s.game_id AND b.team_id = s.team_id
ORDER BY s.team_id, s.game_date_time;
