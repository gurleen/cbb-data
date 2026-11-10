# Metrics

These are the derived `team_season_stats` table and the R2 stat objects. They are computed
the same way for MBB and WBB, from `schedules` and `team_boxscores` only. SQL:
`etl/sql/team_season_stats.sql` (stats) and `etl/sql/teams.sql` (metadata).

## Derived table schema (`team_season_stats`)

There is one row per `(season, team_id)`. In MotherDuck it is the view
`cbb.{mbb,wbb}.team_season_stats` over `parquet/v1/{sport}/team_season_stats/season=YYYY/`.

| group | columns |
|---|---|
| key | `season`, `team_id` |
| metadata | `display_name`, `abbreviation`, `division_i`, `conference_id`, `conference_name`, `conference_short_name` |
| record (schedule) | `games`, `wins`, `losses`, `win_pct`, `conf_wins`, `conf_losses`, `home_wins`, `home_losses`, `away_wins`, `away_losses`, `neutral_wins`, `neutral_losses` |
| coverage | `box_games`, `box_coverage` |
| totals (box) | `pts`, `opp_pts`, `fgm`, `fga`, `fg3m`, `fg3a`, `ftm`, `fta`, `orb`, `drb`, `trb`, `ast`, `tov`, `stl`, `blk`, `pf`, and `opp_*` for each, plus `possessions` |
| rates (box) | `ppg`, `opp_ppg`, `fg_pct`, `fg3_pct`, `ft_pct`, `opp_fg_pct`, `opp_fg3_pct`, `rpg`, `orpg`, `drpg`, `apg`, `topg`, `spg`, `bpg`, `pace`, `ortg`, `drtg`, `net_rtg` |

The table keeps full precision. The R2 JSON rounds per-game values, ratings and pace to 1
decimal, and percentages to 3 decimals (as 0-1 fractions, not 0-100).

## Which games count

* **Record** (games, W-L, splits): schedule games with `status_type_completed`, both scores
  present and not tied. Postponed and canceled games are excluded. Rows are deduplicated by
  `game_id`. Schedules are complete for every season, so records are always full.
* **Box stats:** a game counts only when **both** teams' `team_boxscores` rows exist
  (opponent stats and possessions need both). Rows are deduplicated by `(game_id, team_id)`.
* Box games must also count in the record. A few box scores belong to games the schedule
  still lists as not completed; those are dropped from both and logged.
* `box_games` = box-counted games; `box_coverage = box_games / games`. Box data is sparse
  before 2006 (MBB) and before 2017 (WBB: 14-34% coverage in 2008-16), so check coverage
  before comparing early seasons.
* Regular season, postseason and games against non-D-I opponents are all included.
* **Division I:** a team is D-I if the schedule gives it a conference id. Non-D-I teams get
  `teams/{id}.json` objects (built from their games against D-I opponents) but are left
  out of `team-stats.json`.

## Formulas

Sums run over box-counted games (`G = box_games`). `opp_*` is the opponent's line in the
same games.

| metric | formula |
|---|---|
| `win_pct` | wins / games |
| `ppg`, `opp_ppg` | pts / G, opp_pts / G |
| `fg_pct` | fgm / fga |
| `fg3_pct` | fg3m / fg3a |
| `ft_pct` | ftm / fta |
| `rpg`, `orpg`, `drpg`, `apg`, `topg`, `spg`, `bpg` | total / G |
| possessions (per team, per game) | `FGA - ORB + TOV + 0.475 * FTA` |
| possessions (game) | mean of the two teams' estimates |
| `possessions` | sum of game possessions |
| `pace` | possessions / G (per game, not normalized for overtime) |
| `ortg` | 100 * pts / possessions |
| `drtg` | 100 * opp_pts / possessions |
| `net_rtg` | ortg - drtg = 100 * (pts - opp_pts) / possessions |

Notes:

* **0.475 FTA coefficient.** This is the common college estimate (used by KenPom). The NBA
  version uses 0.44.
* **Averaging both teams' estimates** cancels most of the error in a single team's estimate,
  so both teams in a game get the same possession count.
* **TOV** is `total_turnovers`, which includes team turnovers (it equals `turnovers` upstream).
* **Points** come from `team_score`. A few box rows per season don't satisfy
  `2*FGM + 3PM + FTM = pts`. Those are logged, not corrected.
* **Division by zero** returns `null`, never `NaN`.

## Worked example (the test fixture)

From `etl/tests/conftest.py`, verified by `etl/tests/test_metrics.py`:

| game | home | away | box rows |
|---|---|---|---|
| 101 | Alpha 70 | Beta 60 | both (conference game) |
| 102 | Beta 80 | Gamma 50 | both |
| 103 | Gamma 65 | Alpha 75 | none |
| 104 | Alpha | Beta | canceled |

Game 101 possessions: Alpha `60 - 10 + 12 + 0.475*16 = 69.6`, Beta `58 - 8 + 14 + 0.475*14
= 70.65`, so the game has **70.125**.
Game 102 possessions: Beta `62 - 12 + 10 + 0.475*12 = 65.7`, Gamma `55 - 9 + 16 + 0.475*15 =
69.125`, so the game has **67.4125**.

* **Alpha:** 2-0 (game 104 excluded), 1 box game, coverage 0.5. ORtg `100*70/70.125 =
  99.8`, DRtg `100*60/70.125 = 85.6`, pace 70.1.
* **Beta:** 1-1, 2 box games, 140 points scored and 120 allowed over 137.5375 possessions.
  ORtg **101.8**, DRtg **87.2**, Net **14.5**, pace **68.8**. FG% `52/120 = .433`, 3P%
  `16/47 = .340`, FT% `20/26 = .769`.

## D-I ranks

Team pages carry `ranks` (and `rank_field`, the field size) for win %, ratings, pace,
scoring, shooting and per-game stats. Ranks cover D-I teams with at least one box game,
use competition ranking (1, 2, 2, 4), and are reversed for stats where lower is better
(DRtg, opponent PPG, opponent FG%/3P%, turnovers).

## Conferences (`conference_stats`)

* `avg_ortg`, `avg_drtg`, `avg_net_rtg`, `avg_pace` are the plain mean over the
  conference's D-I teams that have box games. They are not possession-weighted.
* The non-conference record counts games against D-I teams from a different conference.
  Independents count as one group.
* `rank` orders conferences by `avg_net_rtg`.

## Players (`player_season_stats`)

Built from `player_boxscores`, keeping only rows for games that count in the record and
excluding `did_not_play` rows. A player's team is the team they played the most games
for.

| metric | formula |
|---|---|
| `mpg`, `ppg`, `rpg`, `apg`, `spg`, `bpg`, `topg` | total / games played |
| `fg_pct`, `fg3_pct`, `ft_pct` | makes / attempts |
| `efg_pct` | (FGM + 0.5 * 3PM) / FGA |
| `ts_pct` | PTS / (2 * (FGA + 0.44 * FTA)) |
| `usg_pct` | 100 * (FGA + 0.44 * FTA + TOV) * (TmMIN / 5) / (MIN * (TmFGA + 0.44 * TmFTA + TmTOV)), using team totals from the games the player played |
| `min_pct` | player minutes / team minutes (sum of the team's player-minutes / 5) |

**Qualified** players (leaderboard `players.json`, player ranks) played at least 40% of
their team's minutes. Early seasons have no minutes data; there, a player qualifies by
playing at least 50% of the team's games. Within the qualified pool:
* 3P% is ranked only for players with at least 1.0 3PA per game.
* FT% is ranked only for players with at least 1.0 FTA per game.

`players-all.json` has every D-I player with at least one game.

## Cross-check

MBB `team_season_stats` (ESPN's own season stats) could be used to spot-check totals. We
compute from box scores instead so that MBB and WBB stay consistent, and so that coverage
is explicit.
