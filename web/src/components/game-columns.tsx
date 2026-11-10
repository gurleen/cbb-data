import { Link } from "@tanstack/react-router";
import type { StatColumn } from "@/components/stat-table";
import { TeamLink } from "@/components/team";
import { entityKey } from "@/lib/api";
import type { PlayerGame, RosterEntry, Sport, TeamGame } from "@/lib/api-types";
import { DASH, fmt1, fmtGameDate, fmtInt, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

const SITE = { home: "vs", away: "@", neutral: "vs" } as const;

function Result({
  result,
  a,
  b,
}: {
  result: "W" | "L" | null;
  a: number | null;
  b: number | null;
}) {
  if (!result) return <span className="text-muted-foreground">{DASH}</span>;
  return (
    <span>
      <span className={cn("font-medium", result === "W" ? "text-positive" : "text-negative")}>
        {result}
      </span>{" "}
      {a}-{b}
    </span>
  );
}

const made = (m: number | null | undefined, a: number | null | undefined) =>
  m === null || m === undefined || a === null || a === undefined ? DASH : `${m}-${a}`;

export function teamGameColumns(sport: Sport, season: number): StatColumn<TeamGame>[] {
  const box = (
    id: string,
    header: string,
    title: string,
    v: (g: TeamGame) => number | null | undefined,
  ) =>
    ({
      id,
      header,
      title,
      group: "Box",
      numeric: true,
      value: (g: TeamGame) => v(g) ?? null,
      format: (x: unknown) => (x === null || x === undefined ? DASH : fmtInt(x as number)),
    }) satisfies StatColumn<TeamGame>;
  return [
    {
      id: "date",
      header: "Date",
      value: (g) => g.date,
      width: 64,
      format: (_v, g) => <span className="font-mono">{fmtGameDate(g.date)}</span>,
    },
    {
      id: "opponent",
      header: "Opponent",
      value: (g) => g.opponent.name,
      width: 220,
      cell: (g) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 text-xs text-muted-foreground">{SITE[g.site]}</span>
          <TeamLink
            sport={sport}
            season={season}
            id={g.opponent.id}
            name={g.opponent.short_name ?? g.opponent.name}
            slug={g.opponent.slug}
            logo={g.opponent.logo}
            linked={g.opponent.division_i}
          />
          {g.conference_game ? <span className="text-[10px] text-muted-foreground">C</span> : null}
          {g.postseason ? <span className="text-[10px] text-muted-foreground">P</span> : null}
        </span>
      ),
    },
    {
      id: "result",
      header: "Result",
      value: (g) => (g.pts !== null && g.opp_pts !== null ? g.pts - g.opp_pts : null),
      numeric: true,
      cell: (g) =>
        g.completed ? (
          <span className="font-mono">
            <Result result={g.result} a={g.pts} b={g.opp_pts} />
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {g.status?.replace("STATUS_", "").toLowerCase() ?? ""}
          </span>
        ),
    },
    {
      id: "fg",
      header: "FG",
      title: "Field goals made-attempted",
      group: "Box",
      numeric: true,
      value: (g) => g.box?.fgm ?? null,
      format: (_v, g) => made(g.box?.fgm, g.box?.fga),
    },
    {
      id: "fg3",
      header: "3P",
      title: "3-pointers made-attempted",
      group: "Box",
      numeric: true,
      value: (g) => g.box?.fg3m ?? null,
      format: (_v, g) => made(g.box?.fg3m, g.box?.fg3a),
    },
    {
      id: "ft",
      header: "FT",
      title: "Free throws made-attempted",
      group: "Box",
      numeric: true,
      value: (g) => g.box?.ftm ?? null,
      format: (_v, g) => made(g.box?.ftm, g.box?.fta),
    },
    box("orb", "ORB", "Offensive rebounds", (g) => g.box?.orb),
    box("trb", "REB", "Total rebounds", (g) => g.box?.trb),
    box("ast", "AST", "Assists", (g) => g.box?.ast),
    box("tov", "TOV", "Turnovers", (g) => g.box?.tov),
    box("stl", "STL", "Steals", (g) => g.box?.stl),
    box("blk", "BLK", "Blocks", (g) => g.box?.blk),
    {
      id: "poss",
      header: "Poss",
      title: "Possessions",
      group: "Ratings",
      numeric: true,
      value: (g) => g.box?.poss ?? null,
      format: (v) => fmt1(v as number | null),
    },
    {
      id: "ortg",
      header: "ORtg",
      title: "Offensive rating",
      group: "Ratings",
      numeric: true,
      value: (g) => g.box?.ortg ?? null,
      format: (v) => fmt1(v as number | null),
    },
    {
      id: "drtg",
      header: "DRtg",
      title: "Defensive rating",
      group: "Ratings",
      numeric: true,
      lowerIsBetter: true,
      value: (g) => g.box?.drtg ?? null,
      format: (v) => fmt1(v as number | null),
    },
  ];
}

export function rosterColumns(sport: Sport, season: number): StatColumn<RosterEntry>[] {
  const v1 = (
    id: keyof RosterEntry,
    header: string,
    title: string,
    pct = false,
  ): StatColumn<RosterEntry> => ({
    id,
    header,
    title,
    numeric: true,
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
          {r.jersey ? (
            <span className="mr-1.5 font-mono text-xs text-muted-foreground">{r.jersey}</span>
          ) : null}
          {r.name}
        </Link>
      ),
    },
    { id: "position", header: "Pos", value: (r) => r.position },
    {
      id: "class",
      header: "Class",
      value: (r) =>
        r.class
          ?.replace("Freshman", "Fr")
          .replace("Sophomore", "So")
          .replace("Junior", "Jr")
          .replace("Senior", "Sr") ?? null,
    },
    { id: "height", header: "Ht", value: (r) => r.height },
    { id: "g", header: "G", numeric: true, value: (r) => r.g, format: (v) => fmtInt(v as number) },
    {
      id: "gs",
      header: "GS",
      numeric: true,
      value: (r) => r.gs,
      format: (v) => fmtInt(v as number),
    },
    v1("mpg", "MPG", "Minutes per game"),
    v1("ppg", "PPG", "Points per game"),
    v1("rpg", "RPG", "Rebounds per game"),
    v1("apg", "APG", "Assists per game"),
    v1("fg_pct", "FG%", "Field goal percentage", true),
    v1("fg3_pct", "3P%", "3-point percentage", true),
    v1("ft_pct", "FT%", "Free throw percentage", true),
  ];
}

export function playerGameColumns(sport: Sport, season: number): StatColumn<PlayerGame>[] {
  const int = (id: keyof PlayerGame, header: string, title: string): StatColumn<PlayerGame> => ({
    id,
    header,
    title,
    numeric: true,
    value: (g) => g[id] as number | null,
    format: (v) => fmtInt(v as number | null),
  });
  return [
    {
      id: "date",
      header: "Date",
      value: (g) => g.date,
      width: 64,
      format: (_v, g) => <span className="font-mono">{fmtGameDate(g.date)}</span>,
    },
    {
      id: "opponent",
      header: "Opponent",
      value: (g) => g.opponent.name,
      width: 200,
      cell: (g) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 text-xs text-muted-foreground">
            {g.site === "away" ? "@" : "vs"}
          </span>
          <TeamLink
            sport={sport}
            season={season}
            id={g.opponent.id}
            name={g.opponent.short_name ?? g.opponent.name}
            slug={g.opponent.slug}
            logo={g.opponent.logo}
            linked={g.opponent.division_i}
          />
        </span>
      ),
    },
    {
      id: "result",
      header: "Result",
      numeric: true,
      value: (g) => (g.team_pts !== null && g.opp_pts !== null ? g.team_pts - g.opp_pts : null),
      cell: (g) => (
        <span className="font-mono">
          <Result result={g.result} a={g.team_pts} b={g.opp_pts} />
        </span>
      ),
    },
    {
      id: "min",
      header: "MIN",
      numeric: true,
      value: (g) => g.min,
      format: (v, g) => (
        <>
          {fmtInt(v as number | null)}
          {g.starter ? <span className="ml-0.5 text-[10px] text-muted-foreground">*</span> : null}
        </>
      ),
    },
    int("pts", "PTS", "Points"),
    {
      id: "fg",
      header: "FG",
      numeric: true,
      value: (g) => g.fgm,
      format: (_v, g) => made(g.fgm, g.fga),
    },
    {
      id: "fg3",
      header: "3P",
      numeric: true,
      value: (g) => g.fg3m,
      format: (_v, g) => made(g.fg3m, g.fg3a),
    },
    {
      id: "ft",
      header: "FT",
      numeric: true,
      value: (g) => g.ftm,
      format: (_v, g) => made(g.ftm, g.fta),
    },
    int("orb", "ORB", "Offensive rebounds"),
    int("trb", "REB", "Rebounds"),
    int("ast", "AST", "Assists"),
    int("stl", "STL", "Steals"),
    int("blk", "BLK", "Blocks"),
    int("tov", "TOV", "Turnovers"),
    int("pf", "PF", "Fouls"),
  ];
}
