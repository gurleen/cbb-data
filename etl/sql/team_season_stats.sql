-- Basic season stats for one sport-season. Formulas: docs/metrics.md.
-- Inputs (views): schedules, team_box. Output: table `team_season_stats`.
--
-- * Record (games / W-L / splits) comes from completed schedule games, which are complete
--   for every season. Box-score stats come from team_box, which is sparse in early seasons;
--   `box_games` and `box_coverage` say how many games the box stats cover.
-- * Box stats use only games where BOTH teams' box rows exist (needed for possessions and
--   opponent stats) AND that count in the record (completed in the schedule). The schedule
--   is occasionally stale (e.g. MBB 2025 game 401726454 is "scheduled" 0-0 but has box
--   scores); such games are left out of both, so box_games <= games always holds.

CREATE OR REPLACE TABLE team_season_stats AS
WITH games AS (
    SELECT *
    FROM schedules
    WHERE status_type_completed
      AND home_score IS NOT NULL AND away_score IS NOT NULL
      AND home_score <> away_score
      AND home_id IS NOT NULL AND away_id IS NOT NULL
    QUALIFY row_number() OVER (PARTITION BY game_id ORDER BY game_date_time DESC) = 1
),
results AS (
    SELECT home_id AS team_id, home_score > away_score AS won,
           coalesce(conference_competition, false) AS conf,
           CASE WHEN coalesce(neutral_site, false) THEN 'neutral' ELSE 'home' END AS site
    FROM games
    UNION ALL
    SELECT away_id, away_score > home_score, coalesce(conference_competition, false),
           CASE WHEN coalesce(neutral_site, false) THEN 'neutral' ELSE 'away' END
    FROM games
),
record AS (
    SELECT team_id,
           count(*)                                         AS games,
           count(*) FILTER (WHERE won)                      AS wins,
           count(*) FILTER (WHERE NOT won)                  AS losses,
           count(*) FILTER (WHERE conf AND won)             AS conf_wins,
           count(*) FILTER (WHERE conf AND NOT won)         AS conf_losses,
           count(*) FILTER (WHERE site = 'home' AND won)    AS home_wins,
           count(*) FILTER (WHERE site = 'home' AND NOT won) AS home_losses,
           count(*) FILTER (WHERE site = 'away' AND won)    AS away_wins,
           count(*) FILTER (WHERE site = 'away' AND NOT won) AS away_losses,
           count(*) FILTER (WHERE site = 'neutral' AND won) AS neutral_wins,
           count(*) FILTER (WHERE site = 'neutral' AND NOT won) AS neutral_losses
    FROM results
    GROUP BY team_id
),
box AS (
    SELECT *
    FROM team_box
    WHERE team_score IS NOT NULL
    QUALIFY row_number() OVER (PARTITION BY game_id, team_id ORDER BY game_date_time DESC) = 1
),
paired AS (
    SELECT
        t.team_id,
        t.team_score AS pts, o.team_score AS opp_pts,
        t.field_goals_made AS fgm, t.field_goals_attempted AS fga,
        t.three_point_field_goals_made AS fg3m, t.three_point_field_goals_attempted AS fg3a,
        t.free_throws_made AS ftm, t.free_throws_attempted AS fta,
        t.offensive_rebounds AS orb, t.defensive_rebounds AS drb, t.total_rebounds AS trb,
        t.assists AS ast, t.total_turnovers AS tov, t.steals AS stl, t.blocks AS blk,
        t.fouls AS pf,
        o.field_goals_made AS opp_fgm, o.field_goals_attempted AS opp_fga,
        o.three_point_field_goals_made AS opp_fg3m, o.three_point_field_goals_attempted AS opp_fg3a,
        o.free_throws_made AS opp_ftm, o.free_throws_attempted AS opp_fta,
        o.offensive_rebounds AS opp_orb, o.defensive_rebounds AS opp_drb,
        o.total_rebounds AS opp_trb, o.assists AS opp_ast, o.total_turnovers AS opp_tov,
        o.steals AS opp_stl, o.blocks AS opp_blk,
        -- possessions: average of both teams' estimates (FGA - ORB + TOV + 0.475*FTA)
        0.5 * ((t.field_goals_attempted - t.offensive_rebounds + t.total_turnovers
                + 0.475 * t.free_throws_attempted)
             + (o.field_goals_attempted - o.offensive_rebounds + o.total_turnovers
                + 0.475 * o.free_throws_attempted)) AS poss
    FROM box t
    JOIN box o ON o.game_id = t.game_id AND o.team_id = t.opponent_team_id
    WHERE t.game_id IN (SELECT game_id FROM games)
),
box_totals AS (
    SELECT team_id, count(*) AS box_games,
           sum(pts) AS pts, sum(opp_pts) AS opp_pts,
           sum(fgm) AS fgm, sum(fga) AS fga, sum(fg3m) AS fg3m, sum(fg3a) AS fg3a,
           sum(ftm) AS ftm, sum(fta) AS fta, sum(orb) AS orb, sum(drb) AS drb, sum(trb) AS trb,
           sum(ast) AS ast, sum(tov) AS tov, sum(stl) AS stl, sum(blk) AS blk, sum(pf) AS pf,
           sum(opp_fgm) AS opp_fgm, sum(opp_fga) AS opp_fga,
           sum(opp_fg3m) AS opp_fg3m, sum(opp_fg3a) AS opp_fg3a,
           sum(opp_ftm) AS opp_ftm, sum(opp_fta) AS opp_fta,
           sum(opp_orb) AS opp_orb, sum(opp_drb) AS opp_drb, sum(opp_trb) AS opp_trb,
           sum(opp_ast) AS opp_ast, sum(opp_tov) AS opp_tov,
           sum(opp_stl) AS opp_stl, sum(opp_blk) AS opp_blk,
           sum(poss) AS possessions
    FROM paired
    GROUP BY team_id
)
SELECT
    r.team_id,
    r.games, r.wins, r.losses,
    r.wins / nullif(r.games, 0)::DOUBLE AS win_pct,
    r.conf_wins, r.conf_losses, r.home_wins, r.home_losses,
    r.away_wins, r.away_losses, r.neutral_wins, r.neutral_losses,
    coalesce(b.box_games, 0) AS box_games,
    coalesce(b.box_games, 0) / nullif(r.games, 0)::DOUBLE AS box_coverage,
    b.pts, b.opp_pts, b.fgm, b.fga, b.fg3m, b.fg3a, b.ftm, b.fta,
    b.orb, b.drb, b.trb, b.ast, b.tov, b.stl, b.blk, b.pf,
    b.opp_fgm, b.opp_fga, b.opp_fg3m, b.opp_fg3a, b.opp_ftm, b.opp_fta,
    b.opp_orb, b.opp_drb, b.opp_trb, b.opp_ast, b.opp_tov, b.opp_stl, b.opp_blk,
    b.possessions,
    b.pts / nullif(b.box_games, 0)::DOUBLE     AS ppg,
    b.opp_pts / nullif(b.box_games, 0)::DOUBLE AS opp_ppg,
    b.fgm / nullif(b.fga, 0)::DOUBLE           AS fg_pct,
    b.fg3m / nullif(b.fg3a, 0)::DOUBLE         AS fg3_pct,
    b.ftm / nullif(b.fta, 0)::DOUBLE           AS ft_pct,
    b.opp_fgm / nullif(b.opp_fga, 0)::DOUBLE   AS opp_fg_pct,
    b.opp_fg3m / nullif(b.opp_fg3a, 0)::DOUBLE AS opp_fg3_pct,
    b.trb / nullif(b.box_games, 0)::DOUBLE     AS rpg,
    b.orb / nullif(b.box_games, 0)::DOUBLE     AS orpg,
    b.drb / nullif(b.box_games, 0)::DOUBLE     AS drpg,
    b.ast / nullif(b.box_games, 0)::DOUBLE     AS apg,
    b.tov / nullif(b.box_games, 0)::DOUBLE     AS topg,
    b.stl / nullif(b.box_games, 0)::DOUBLE     AS spg,
    b.blk / nullif(b.box_games, 0)::DOUBLE     AS bpg,
    b.possessions / nullif(b.box_games, 0)::DOUBLE      AS pace,
    100.0 * b.pts / nullif(b.possessions, 0)            AS ortg,
    100.0 * b.opp_pts / nullif(b.possessions, 0)        AS drtg,
    100.0 * (b.pts - b.opp_pts) / nullif(b.possessions, 0) AS net_rtg
FROM record r
LEFT JOIN box_totals b USING (team_id)
ORDER BY r.team_id;
