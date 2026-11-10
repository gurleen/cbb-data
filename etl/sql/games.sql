-- Shared game-level views for one sport-season (used by conferences.sql,
-- team_games.sql and players.sql).
-- Inputs: schedules, team_box. Same game rules as team_season_stats.sql.

-- Completed, non-tied schedule games (one row per game).
CREATE OR REPLACE VIEW completed_games AS
SELECT *
FROM schedules
WHERE status_type_completed
  AND home_score IS NOT NULL AND away_score IS NOT NULL
  AND home_score <> away_score
  AND home_id IS NOT NULL AND away_id IS NOT NULL
QUALIFY row_number() OVER (PARTITION BY game_id ORDER BY game_date_time DESC) = 1;

-- Box line per (game, team) where both teams' rows exist and the game counts.
CREATE OR REPLACE VIEW box_pairs AS
WITH box AS (
    SELECT *
    FROM team_box
    WHERE team_score IS NOT NULL
    QUALIFY row_number() OVER (PARTITION BY game_id, team_id ORDER BY game_date_time DESC) = 1
)
SELECT
    t.game_id, t.team_id,
    t.field_goals_made AS fgm, t.field_goals_attempted AS fga,
    t.three_point_field_goals_made AS fg3m, t.three_point_field_goals_attempted AS fg3a,
    t.free_throws_made AS ftm, t.free_throws_attempted AS fta,
    t.offensive_rebounds AS orb, t.defensive_rebounds AS drb, t.total_rebounds AS trb,
    t.assists AS ast, t.total_turnovers AS tov, t.steals AS stl, t.blocks AS blk,
    t.fouls AS pf,
    0.5 * ((t.field_goals_attempted - t.offensive_rebounds + t.total_turnovers
            + 0.475 * t.free_throws_attempted)
         + (o.field_goals_attempted - o.offensive_rebounds + o.total_turnovers
            + 0.475 * o.free_throws_attempted)) AS poss
FROM box t
JOIN box o ON o.game_id = t.game_id AND o.team_id = t.opponent_team_id
WHERE t.game_id IN (SELECT game_id FROM completed_games);
