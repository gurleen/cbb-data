// Response shapes of the cbb-api Worker (v1). Mirrors what etl/src/cbb_etl/transform
// writes. To be moved to a shared packages/api-types workspace (spec §10).

export type Sport = "mbb" | "wbb";
export const SPORTS: readonly Sport[] = ["mbb", "wbb"];

export interface SeasonEntry {
  season: number;
  label: string; // "2025-26"
  current: boolean;
  division_i_teams: number;
  games: number;
  box_coverage: number; // 0-1
  updated_at: string; // ISO timestamp
}

export interface SeasonsDoc {
  sport: Sport;
  current_season: number;
  seasons: SeasonEntry[]; // newest first
}

export interface Conference {
  id: number;
  name: string | null;
  short_name: string | null;
}

export interface TeamMeta {
  id: number;
  name: string;
  short_name: string | null;
  location: string | null;
  mascot: string | null;
  abbreviation: string | null;
  slug: string | null;
  division_i: boolean;
  conference: Conference | null;
  color: string | null; // "#rrggbb"
  alternate_color: string | null;
  logo: string | null;
}

export interface TeamsDoc {
  sport: Sport;
  season: number;
  season_label: string;
  count: number;
  teams: TeamMeta[];
}

export interface WinLoss {
  wins: number;
  losses: number;
}

export interface TeamDoc {
  sport: Sport;
  season: number;
  season_label: string;
  team: TeamMeta;
  record: {
    games: number;
    wins: number;
    losses: number;
    win_pct: number | null;
    conference: WinLoss;
    home: WinLoss;
    away: WinLoss;
    neutral: WinLoss;
  } | null;
  box: { games: number; coverage: number | null } | null;
  totals: Record<string, number | null> | null;
  per_game: Record<string, number | null> | null;
  shooting: {
    fg_pct: number | null;
    fg3_pct: number | null;
    ft_pct: number | null;
    opp_fg_pct: number | null;
    opp_fg3_pct: number | null;
  } | null;
  ratings: {
    ortg: number | null;
    drtg: number | null;
    net_rtg: number | null;
    pace: number | null;
  } | null;
}

export interface TeamStatsRow {
  team_id: number;
  name: string;
  short_name: string | null;
  slug?: string;
  abbreviation: string | null;
  logo: string | null;
  conference_id: number | null;
  conference: string | null;
  games: number;
  wins: number;
  losses: number;
  win_pct: number | null;
  conf_wins: number;
  conf_losses: number;
  box_games: number;
  box_coverage: number | null;
  ppg: number | null;
  opp_ppg: number | null;
  fgm: number | null;
  fga: number | null;
  fg_pct: number | null;
  fg3m: number | null;
  fg3a: number | null;
  fg3_pct: number | null;
  ftm: number | null;
  fta: number | null;
  ft_pct: number | null;
  rpg: number | null;
  apg: number | null;
  topg: number | null;
  spg: number | null;
  bpg: number | null;
  ortg: number | null;
  drtg: number | null;
  net_rtg: number | null;
  pace: number | null;
}

export interface TeamStatsDoc {
  sport: Sport;
  season: number;
  season_label: string;
  count: number;
  rows: TeamStatsRow[];
}

// -- phase 2-5 documents --------------------------------------------------------------------

export interface TeamDocFull extends TeamDoc {
  ranks: Partial<Record<TeamRankStat, number>>;
  rank_field: number;
  roster: RosterEntry[];
}

export type TeamRankStat =
  | "win_pct"
  | "ortg"
  | "drtg"
  | "net_rtg"
  | "pace"
  | "ppg"
  | "opp_ppg"
  | "fg_pct"
  | "fg3_pct"
  | "ft_pct"
  | "opp_fg_pct"
  | "opp_fg3_pct"
  | "rpg"
  | "apg"
  | "topg"
  | "spg"
  | "bpg";

export interface RosterEntry {
  player_id: number;
  name: string;
  slug: string;
  jersey: string | null;
  position: string | null;
  class: string | null;
  height: string | null;
  qualified: boolean;
  g: number;
  gs: number;
  mpg: number | null;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  fg_pct: number | null;
  fg3_pct: number | null;
  ft_pct: number | null;
}

export interface OpponentRef {
  id: number;
  name: string | null;
  short_name?: string | null;
  abbreviation: string | null;
  logo: string | null;
  division_i: boolean;
  slug: string | null;
}

export interface TeamGame {
  game_id: number;
  date: string | null;
  postseason: boolean;
  status: string | null;
  completed: boolean;
  site: "home" | "away" | "neutral";
  conference_game: boolean;
  opponent: OpponentRef;
  result: "W" | "L" | null;
  pts: number | null;
  opp_pts: number | null;
  box: {
    fgm: number;
    fga: number;
    fg3m: number;
    fg3a: number;
    ftm: number;
    fta: number;
    orb: number;
    drb: number;
    trb: number;
    ast: number;
    tov: number;
    stl: number;
    blk: number;
    pf: number;
    poss: number | null;
    ortg: number | null;
    drtg: number | null;
  } | null;
}

export interface TeamGamesDoc {
  sport: Sport;
  season: number;
  team_id: number;
  count: number;
  games: TeamGame[];
}

export interface ConferenceRow {
  id: number;
  name: string | null;
  short_name: string | null;
  rank: number | null;
  teams: number;
  avg_ortg: number | null;
  avg_drtg: number | null;
  avg_net_rtg: number | null;
  avg_pace: number | null;
  nonconf_wins: number;
  nonconf_losses: number;
  best_team: {
    id: number;
    name: string;
    abbreviation: string | null;
    logo: string | null;
    slug: string;
    net_rtg: number | null;
  } | null;
}

export interface ConferencesDoc {
  sport: Sport;
  season: number;
  season_label: string;
  count: number;
  conferences: ConferenceRow[];
}

export interface ConferenceTeamRow extends TeamStatsRow {
  slug: string;
  conf_win_pct: number | null;
  home_wins: number;
  home_losses: number;
  away_wins: number;
  away_losses: number;
  neutral_wins: number;
  neutral_losses: number;
}

export interface ConferenceDoc {
  sport: Sport;
  season: number;
  season_label: string;
  conference: ConferenceRow;
  teams: ConferenceTeamRow[];
}

export interface PlayerLine {
  g: number;
  gs: number;
  mpg: number | null;
  ppg: number | null;
  rpg: number | null;
  orpg: number | null;
  apg: number | null;
  spg: number | null;
  bpg: number | null;
  topg: number | null;
  fgm: number | null;
  fga: number | null;
  fg3m: number | null;
  fg3a: number | null;
  ftm: number | null;
  fta: number | null;
  fg_pct: number | null;
  fg3_pct: number | null;
  ft_pct: number | null;
  efg_pct: number | null;
  ts_pct: number | null;
  usg_pct: number | null;
  min_pct: number | null;
}

export interface PlayerIdent {
  player_id: number;
  name: string;
  slug: string;
  jersey: string | null;
  position: string | null;
  class: string | null;
  height: string | null;
  team_id: number;
  team: string | null;
  team_name: string | null;
  team_slug: string | null;
  team_logo: string | null;
  conference_id: number | null;
  conference: string | null;
}

export type PlayerRow = PlayerIdent & PlayerLine & { qualified: boolean };

/** Columnar leaderboard as stored (`columns` + `data`). */
export interface PlayersDocRaw {
  sport: Sport;
  season: number;
  season_label: string;
  qualified_only: boolean;
  field: number;
  count: number;
  columns: (keyof PlayerRow)[];
  data: unknown[][];
}

export interface PlayerGame {
  game_id: number;
  date: string | null;
  team_id: number;
  site: string | null;
  opponent: OpponentRef;
  result: "W" | "L" | null;
  team_pts: number | null;
  opp_pts: number | null;
  starter: boolean;
  min: number | null;
  pts: number | null;
  fgm: number | null;
  fga: number | null;
  fg3m: number | null;
  fg3a: number | null;
  ftm: number | null;
  fta: number | null;
  orb: number | null;
  drb: number | null;
  trb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  tov: number | null;
  pf: number | null;
}

export type PlayerRankStat =
  | "ppg"
  | "rpg"
  | "apg"
  | "spg"
  | "bpg"
  | "mpg"
  | "topg"
  | "fg_pct"
  | "fg3_pct"
  | "ft_pct"
  | "efg_pct"
  | "ts_pct"
  | "usg_pct";

export interface PlayerDoc {
  sport: Sport;
  season: number;
  season_label: string;
  player: PlayerIdent & {
    weight: string | null;
    headshot: string | null;
    teams_played_for: number;
  };
  qualified: boolean;
  field: number;
  line: PlayerLine;
  totals: Record<string, number | null>;
  ranks: Partial<Record<PlayerRankStat, number>>;
  games: PlayerGame[];
}

export interface CareerSeason {
  season: number;
  label: string;
  team_id: number;
  team: string | null;
  team_name: string | null;
  team_slug: string;
  team_logo: string | null;
  conference: string | null;
  qualified: boolean;
  g: number;
  gs: number;
  mpg: number | null;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  spg: number | null;
  bpg: number | null;
  usg_pct: number | null;
  fg_pct: number | null;
  fg3_pct: number | null;
  ft_pct: number | null;
  ts_pct: number | null;
}

export interface CareerDoc {
  sport: Sport;
  player_id: number;
  name: string;
  slug: string;
  headshot: string | null;
  position: string | null;
  seasons: CareerSeason[];
}

export interface SearchDoc {
  sport: Sport;
  season: number;
  teams: [number, string, string | null, string, string | null][];
  players: [number, string, string, string | null, number][];
}
