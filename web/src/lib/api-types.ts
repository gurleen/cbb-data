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
