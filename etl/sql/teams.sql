-- Team metadata for one sport-season.
-- Inputs (views): schedules, team_box, standings (standings may be empty).
-- Output: table `teams`, one row per team_id.
--
-- * Every team that appears in the season's schedule or box scores is included.
-- * division_i: the team carries a conference id in the schedule (ESPN only assigns
--   conference ids to Division I teams; matches the standings team set exactly in 2026).
-- * Metadata (names, colors, logo) = most recent non-null value by game time.
-- * Conference name comes from the schedule's own conference-game groups
--   (groups_id/groups_name), falling back to standings group names, then to the
--   cross-season seed `conference_names` (sql/conference_names.csv; latest name per id).

CREATE OR REPLACE TABLE teams AS
WITH sides AS (
    SELECT home_id AS team_id, game_date_time AS ts, home_location AS location,
           home_name AS mascot, home_abbreviation AS abbreviation,
           home_display_name AS display_name, home_short_display_name AS short_display_name,
           home_color AS color, home_alternate_color AS alternate_color, home_logo AS logo,
           NULL::VARCHAR AS slug, home_conference_id AS conference_id
    FROM schedules
    UNION ALL
    SELECT away_id, game_date_time, away_location, away_name, away_abbreviation,
           away_display_name, away_short_display_name, away_color, away_alternate_color,
           away_logo, NULL::VARCHAR, away_conference_id
    FROM schedules
    UNION ALL
    SELECT team_id, game_date_time, team_location, team_name, team_abbreviation,
           team_display_name, team_short_display_name, team_color, team_alternate_color,
           team_logo, team_slug, NULL::INTEGER
    FROM team_box
),
latest AS (
    SELECT
        team_id,
        arg_max(location, ts) FILTER (WHERE location IS NOT NULL)                     AS location,
        arg_max(mascot, ts) FILTER (WHERE mascot IS NOT NULL)                         AS mascot,
        arg_max(abbreviation, ts) FILTER (WHERE abbreviation IS NOT NULL)             AS abbreviation,
        arg_max(display_name, ts) FILTER (WHERE display_name IS NOT NULL)             AS display_name,
        arg_max(short_display_name, ts) FILTER (WHERE short_display_name IS NOT NULL) AS short_display_name,
        arg_max(color, ts) FILTER (WHERE color IS NOT NULL AND color <> '')           AS color,
        arg_max(alternate_color, ts) FILTER (WHERE alternate_color IS NOT NULL AND alternate_color <> '') AS alternate_color,
        arg_max(logo, ts) FILTER (WHERE logo IS NOT NULL AND logo <> '')              AS logo,
        arg_max(slug, ts) FILTER (WHERE slug IS NOT NULL)                             AS slug,
        -- most recent conference id (handles mid-season data fixes)
        arg_max(conference_id, ts) FILTER (WHERE conference_id IS NOT NULL)           AS conference_id
    FROM sides
    WHERE team_id IS NOT NULL
    GROUP BY team_id
),
sched_conf_names AS (
    SELECT groups_id AS conference_id,
           mode(groups_name) AS conference_name,
           mode(groups_short_name) AS conference_short_name
    FROM schedules
    WHERE groups_is_conference AND groups_id IS NOT NULL
    GROUP BY 1
),
standings_conf_names AS (
    SELECT TRY_CAST(group_id AS INTEGER) AS conference_id,
           mode(group_name) AS conference_name,
           mode(group_short_name) AS conference_short_name
    FROM standings
    GROUP BY 1
)
SELECT
    l.team_id,
    l.display_name,
    l.short_display_name,
    l.location,
    l.mascot,
    l.abbreviation,
    l.slug,
    l.conference_id IS NOT NULL AS division_i,
    l.conference_id,
    coalesce(s.conference_name, st.conference_name, seed.conference_name) AS conference_name,
    coalesce(s.conference_short_name, st.conference_short_name,
             seed.conference_short_name)                             AS conference_short_name,
    l.color,
    l.alternate_color,
    l.logo
FROM latest l
LEFT JOIN sched_conf_names s USING (conference_id)
LEFT JOIN standings_conf_names st USING (conference_id)
LEFT JOIN conference_names seed USING (conference_id)
ORDER BY l.team_id;
