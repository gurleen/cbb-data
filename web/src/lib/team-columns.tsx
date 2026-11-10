import { LimitedBadge } from "@/components/coverage-notice";
import type { StatColumn } from "@/components/stat-table";
import { TeamLink } from "@/components/team";
import type { Sport, TeamStatsRow } from "./api-types";
import { fmt1, fmtInt, fmtPct, fmtRecord, fmtSigned, fmtWinPct } from "./format";

export const TEAM_GROUPS = [
  { id: "record", label: "Record" },
  { id: "ratings", label: "Ratings" },
  { id: "scoring", label: "Scoring" },
  { id: "shooting", label: "Shooting" },
  { id: "other", label: "Other" },
] as const;
export type TeamGroup = (typeof TEAM_GROUPS)[number]["id"];
export const DEFAULT_TEAM_GROUPS: TeamGroup[] = ["record", "ratings", "scoring"];

type R = TeamStatsRow & { slug?: string };
const n = (v: unknown) => v as number | null;

/** Leaf columns, each tagged with its group id (for visibility toggles). */
export function teamColumns(
  sport: Sport,
  season: number,
  extra: StatColumn<R>[] = [],
): (StatColumn<R> & { groupId?: TeamGroup })[] {
  const num = (
    groupId: TeamGroup,
    group: string,
    id: string,
    header: string,
    title: string,
    value: (r: R) => number | null,
    format: (v: number | null) => string = fmt1,
    lowerIsBetter = false,
  ): StatColumn<R> & { groupId: TeamGroup } => ({
    id,
    header,
    title,
    group,
    groupId,
    numeric: true,
    lowerIsBetter,
    value,
    format: (v) => format(n(v)),
  });
  return [
    {
      id: "team",
      header: "Team",
      value: (r) => r.name,
      width: 220,
      cell: (r) => (
        <span className="inline-flex items-center">
          <TeamLink
            sport={sport}
            season={season}
            id={r.team_id}
            name={r.short_name ?? r.name}
            slug={r.slug}
            logo={r.logo}
            subtitle={r.conference}
          />
          {r.box_games < 5 ? <LimitedBadge /> : null}
        </span>
      ),
    },
    ...extra,
    num("record", "Record", "games", "G", "Games", (r) => r.games, fmtInt),
    {
      id: "record",
      header: "W-L",
      title: "Overall record",
      group: "Record",
      groupId: "record",
      numeric: true,
      value: (r) => r.win_pct,
      format: (_v, r) => fmtRecord(r.wins, r.losses),
    },
    num("record", "Record", "win_pct", "Win%", "Win percentage", (r) => r.win_pct, fmtWinPct),
    {
      id: "conf_record",
      header: "Conf",
      title: "Conference record",
      group: "Record",
      groupId: "record",
      numeric: true,
      value: (r) =>
        r.conf_wins + r.conf_losses ? r.conf_wins / (r.conf_wins + r.conf_losses) : null,
      format: (_v, r) => fmtRecord(r.conf_wins, r.conf_losses),
    },
    num(
      "ratings",
      "Ratings",
      "ortg",
      "ORtg",
      "Offensive rating: points per 100 possessions",
      (r) => r.ortg,
    ),
    num(
      "ratings",
      "Ratings",
      "drtg",
      "DRtg",
      "Defensive rating: points allowed per 100 possessions",
      (r) => r.drtg,
      fmt1,
      true,
    ),
    num(
      "ratings",
      "Ratings",
      "net_rtg",
      "Net",
      "Net rating: ORtg - DRtg",
      (r) => r.net_rtg,
      fmtSigned,
    ),
    num("ratings", "Ratings", "pace", "Pace", "Possessions per game", (r) => r.pace),
    num("scoring", "Scoring", "ppg", "PPG", "Points per game", (r) => r.ppg),
    num(
      "scoring",
      "Scoring",
      "opp_ppg",
      "Opp",
      "Opponent points per game",
      (r) => r.opp_ppg,
      fmt1,
      true,
    ),
    num("shooting", "Shooting", "fgm", "FGM", "Field goals made per game", (r) => r.fgm),
    num("shooting", "Shooting", "fga", "FGA", "Field goals attempted per game", (r) => r.fga),
    num("shooting", "Shooting", "fg_pct", "FG%", "Field goal percentage", (r) => r.fg_pct, fmtPct),
    num("shooting", "Shooting", "fg3m", "3PM", "3-pointers made per game", (r) => r.fg3m),
    num("shooting", "Shooting", "fg3a", "3PA", "3-pointers attempted per game", (r) => r.fg3a),
    num("shooting", "Shooting", "fg3_pct", "3P%", "3-point percentage", (r) => r.fg3_pct, fmtPct),
    num("shooting", "Shooting", "ftm", "FTM", "Free throws made per game", (r) => r.ftm),
    num("shooting", "Shooting", "fta", "FTA", "Free throws attempted per game", (r) => r.fta),
    num("shooting", "Shooting", "ft_pct", "FT%", "Free throw percentage", (r) => r.ft_pct, fmtPct),
    num("other", "Other", "rpg", "RPG", "Rebounds per game", (r) => r.rpg),
    num("other", "Other", "apg", "APG", "Assists per game", (r) => r.apg),
    num("other", "Other", "topg", "TOV", "Turnovers per game", (r) => r.topg, fmt1, true),
    num("other", "Other", "spg", "SPG", "Steals per game", (r) => r.spg),
    num("other", "Other", "bpg", "BPG", "Blocks per game", (r) => r.bpg),
  ];
}

export function hiddenColumns(
  cols: (StatColumn<R> & { groupId?: TeamGroup })[],
  visibleGroups: string[],
): string[] {
  return cols.filter((c) => c.groupId && !visibleGroups.includes(c.groupId)).map((c) => c.id);
}
