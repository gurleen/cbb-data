-- Conference summaries for one sport-season.
-- Inputs: teams, team_season_stats, completed_games. Output: table `conference_stats`.
--
-- * Averages are simple means over the conference's D-I teams that have box games.
-- * Non-conference record: games against D-I teams from a different conference
--   (independents count as their own group).

CREATE OR REPLACE TABLE conference_stats AS
WITH d1 AS (
    SELECT t.team_id, t.conference_id, t.conference_name, t.conference_short_name,
           s.games, s.wins, s.losses, s.box_games, s.ortg, s.drtg, s.net_rtg, s.pace
    FROM teams t
    JOIN team_season_stats s USING (team_id)
    WHERE t.division_i
),
conf_of AS (SELECT team_id, conference_id FROM teams WHERE division_i),
nonconf AS (
    SELECT hc.conference_id AS conference_id, g.home_score > g.away_score AS won
    FROM completed_games g
    JOIN conf_of hc ON hc.team_id = g.home_id
    JOIN conf_of ac ON ac.team_id = g.away_id
    WHERE hc.conference_id <> ac.conference_id
    UNION ALL
    SELECT ac.conference_id, g.away_score > g.home_score
    FROM completed_games g
    JOIN conf_of hc ON hc.team_id = g.home_id
    JOIN conf_of ac ON ac.team_id = g.away_id
    WHERE hc.conference_id <> ac.conference_id
),
nc AS (
    SELECT conference_id,
           count(*) FILTER (WHERE won) AS nonconf_wins,
           count(*) FILTER (WHERE NOT won) AS nonconf_losses
    FROM nonconf GROUP BY 1
)
SELECT
    d1.conference_id,
    any_value(d1.conference_name)        AS conference_name,
    any_value(d1.conference_short_name)  AS conference_short_name,
    count(*)                             AS teams,
    avg(d1.ortg) FILTER (WHERE d1.box_games > 0)    AS avg_ortg,
    avg(d1.drtg) FILTER (WHERE d1.box_games > 0)    AS avg_drtg,
    avg(d1.net_rtg) FILTER (WHERE d1.box_games > 0) AS avg_net_rtg,
    avg(d1.pace) FILTER (WHERE d1.box_games > 0)    AS avg_pace,
    arg_max(d1.team_id, d1.net_rtg) FILTER (WHERE d1.box_games > 0) AS best_team_id,
    coalesce(any_value(nc.nonconf_wins), 0)   AS nonconf_wins,
    coalesce(any_value(nc.nonconf_losses), 0) AS nonconf_losses
FROM d1
LEFT JOIN nc USING (conference_id)
WHERE d1.conference_id IS NOT NULL
GROUP BY d1.conference_id
ORDER BY avg_net_rtg DESC NULLS LAST;
