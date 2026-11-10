## Findings that shape the transforms

Checked 2026-11-10 against seasons 2004, 2010, 2016, 2021, 2026 and 2027.

* **File names** follow the official `sportsdataverse` Python loader:
  `{sport}_schedule_{s}` (schedules is the only dataset with a sport prefix), `team_box_{s}`,
  `player_box_{s}`, `rosters_{s}`, `standings_{s}`, `play_by_play_{s}`, `shots_{s}`, etc.
* **WBB has the same 12 releases as MBB** (not a smaller set), but coverage is thinner.
  Rosters only exist from 2025 (MBB) / 2026 (WBB). WBB standings are missing for 2005, 2024
  and 2025.
* **Box-score coverage is sparse in early seasons.** D-I box coverage (box games / schedule
  games), from a full dry run:
  * MBB: about 0% in 2003-04, 87% in 2005, 95-96% in 2006-07, and 99% or more from 2008.
  * WBB: 1-9% in 2004-07, and 14-34% in 2008-16. It jumps to 95% in 2017 and is 99% or
    more from 2020.

  So W-L comes from schedules, and every stats object carries `box_games` / `box_coverage`.
* **Stale schedule rows:** a few games have box scores but are not completed in the
  schedule. Examples: 1 game in MBB 2025 (listed as "scheduled 0-0") and 18 in WBB 2017.
  They are excluded from both the record and the box stats, and logged.
* **Non-Division-I opponents** appear in both schedules and box scores (about 250 MBB teams
  with 1-3 games). They have no `home/away_conference_id`, and that is how we tell D-I apart:
  in 2026 the teams with a conference id match the standings teams exactly (365 MBB, 363 WBB).
* **No conference name in team_box.** Names come from the schedule's conference-game
  `groups_id` / `groups_name`, then standings `group_name`, then `sql/conference_names.csv`
  (latest name per id across all seasons). Standings also contain non-conference groups,
  such as `104` "College Basketball Crown".
* **Turnovers:** `total_turnovers` = `turnovers` (both already include team turnovers);
  `team_turnovers` is a subset. **Rebounds:** `total_rebounds` = offensive + defensive.
* **Percent columns** (`field_goal_pct` etc.) are on a 0-100 scale. We recompute all
  percentages from makes/attempts as 0-1 fractions.
* A handful of box rows per season have `team_score != 2*FGM + 3PM + FTM` (e.g. 12 in MBB
  2026). Logged as a warning; points come from `team_score`.
* **Type drift between sports:** `rosters.athlete_id` is VARCHAR in MBB and INTEGER in WBB,
  and `standings.group_id` is VARCHAR in MBB but INTEGER in WBB 2026+. Sports live in
  separate schemas, and the MotherDuck views use `union_by_name`.
* **Column drift between seasons:** newer seasons add columns (e.g. `fast_break_points`,
  `points_in_paint`, `lead_changes` in team_box; `*_logo_dark`, broadcast and ranking
  fields in schedules) and drop `venue_capacity`. WBB 2026+ team_box drops
  `flagrant_fouls`.
* `timestamp.json` is `{"last_updated": "YYYY-MM-DD HH:MM:SS EST"}`, one per release (not
  per season). Per-season change detection uses asset size + `updated_at` from the releases
  API.
