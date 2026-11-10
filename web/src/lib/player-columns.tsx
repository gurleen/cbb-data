import { Link } from "@tanstack/react-router";
import type { StatColumn } from "@/components/stat-table";
import { TeamLogo } from "@/components/team";
import { entityKey } from "./api";
import type { PlayerRow, Sport } from "./api-types";
import { fmt1, fmtInt, fmtPct } from "./format";

export const PLAYER_GROUPS = [
  { id: "pergame", label: "Per game" },
  { id: "shooting", label: "Shooting" },
  { id: "advanced", label: "Advanced" },
] as const;
export type PlayerGroup = (typeof PLAYER_GROUPS)[number]["id"];
export const DEFAULT_PLAYER_GROUPS: PlayerGroup[] = ["pergame", "shooting", "advanced"];

export const CLASS_SHORT: Record<string, string> = {
  Freshman: "Fr",
  Sophomore: "So",
  Junior: "Jr",
  Senior: "Sr",
  Graduate: "Gr",
};

export function playerColumns(
  sport: Sport,
  season: number,
): (StatColumn<PlayerRow> & { groupId?: PlayerGroup })[] {
  const num = (
    groupId: PlayerGroup,
    group: string,
    id: keyof PlayerRow & string,
    header: string,
    title: string,
    pct = false,
    lowerIsBetter = false,
  ): StatColumn<PlayerRow> & { groupId: PlayerGroup } => ({
    id,
    header,
    title,
    group,
    groupId,
    numeric: true,
    lowerIsBetter,
    value: (r) => r[id] as number | null,
    format: (v) => (pct ? fmtPct(v as number | null) : fmt1(v as number | null)),
  });
  return [
    {
      id: "name",
      header: "Player",
      value: (r) => r.name,
      width: 200,
      cell: (r) => (
        <Link
          to="/$sport/$season/players/$playerKey"
          params={{ sport, season: String(season), playerKey: entityKey(r.player_id, r.slug) }}
          className="text-foreground hover:text-primary hover:no-underline"
        >
          {r.name}
        </Link>
      ),
    },
    {
      id: "team",
      header: "Team",
      value: (r) => r.team,
      cell: (r) => (
        <Link
          to="/$sport/$season/teams/$teamKey"
          params={{ sport, season: String(season), teamKey: entityKey(r.team_id, r.team_slug) }}
          className="inline-flex items-center gap-1.5 text-foreground hover:text-primary hover:no-underline"
          title={r.team_name ?? undefined}
        >
          <TeamLogo src={r.team_logo} />
          {r.team}
        </Link>
      ),
    },
    { id: "conference", header: "Conf", value: (r) => r.conference },
    { id: "position", header: "Pos", value: (r) => r.position },
    {
      id: "class",
      header: "Cl",
      title: "Class",
      value: (r) => (r.class ? (CLASS_SHORT[r.class] ?? r.class) : null),
    },
    {
      id: "g",
      header: "G",
      numeric: true,
      noShade: true,
      value: (r) => r.g,
      format: (v) => fmtInt(v as number),
    },
    num("pergame", "Per game", "mpg", "MPG", "Minutes per game"),
    num("pergame", "Per game", "ppg", "PPG", "Points per game"),
    num("pergame", "Per game", "rpg", "RPG", "Rebounds per game"),
    num("pergame", "Per game", "apg", "APG", "Assists per game"),
    num("pergame", "Per game", "spg", "SPG", "Steals per game"),
    num("pergame", "Per game", "bpg", "BPG", "Blocks per game"),
    num("pergame", "Per game", "topg", "TOV", "Turnovers per game", false, true),
    num("shooting", "Shooting", "fg_pct", "FG%", "Field goal percentage", true),
    { ...num("shooting", "Shooting", "fg3a", "3PA", "3-point attempts per game"), noShade: true },
    num("shooting", "Shooting", "fg3_pct", "3P%", "3-point percentage", true),
    num("shooting", "Shooting", "ft_pct", "FT%", "Free throw percentage", true),
    num("advanced", "Advanced", "efg_pct", "eFG%", "Effective FG%: (FGM + 0.5 x 3PM) / FGA", true),
    num(
      "advanced",
      "Advanced",
      "ts_pct",
      "TS%",
      "True shooting: PTS / (2 x (FGA + 0.44 x FTA))",
      true,
    ),
    num(
      "advanced",
      "Advanced",
      "usg_pct",
      "USG%",
      "Usage: share of team possessions used while on the floor",
    ),
    num("advanced", "Advanced", "min_pct", "Min%", "Share of team minutes played", true),
  ];
}
