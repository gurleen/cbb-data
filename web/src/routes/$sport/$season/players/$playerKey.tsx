import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { CoverageNotice } from "@/components/coverage-notice";
import { playerGameColumns } from "@/components/game-columns";
import { RatingCard, Section } from "@/components/stat-card";
import { type StatColumn, StatTable } from "@/components/stat-table";
import { TeamLogo } from "@/components/team";
import { ApiError, careerQuery, entityKey, parseEntityKey, playerQuery } from "@/lib/api";
import type { CareerSeason, PlayerDoc, Sport } from "@/lib/api-types";
import { fmt1, fmtInt, fmtPct } from "@/lib/format";
import { SPORT_LABEL } from "@/lib/season-context";
import { useSeasonRoute } from "@/lib/use-season";

export const Route = createFileRoute("/$sport/$season/players/$playerKey")({
  loader: async ({ context, params }) => {
    const id = parseEntityKey(params.playerKey);
    if (id === null) throw notFound();
    const sport = params.sport as Sport;
    const season = Number(params.season);
    const current =
      context.queryClient.getQueryData<{ current_season: number }>(["seasons", sport])
        ?.current_season ?? 0;
    let doc: PlayerDoc;
    try {
      [doc] = await Promise.all([
        context.queryClient.ensureQueryData(playerQuery(sport, season, id, current)),
        context.queryClient.ensureQueryData(careerQuery(sport, id)).catch(() => null),
      ]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) throw notFound();
      throw e;
    }
    const canonical = entityKey(id, doc.player.slug);
    if (params.playerKey !== canonical) {
      throw redirect({
        to: "/$sport/$season/players/$playerKey",
        params: { ...params, playerKey: canonical },
        statusCode: 301,
      });
    }
    return { crumb: doc.player.name, name: doc.player.name, team: doc.player.team_name, id };
  },
  head: ({ params, loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.name ?? "Player"} ${params.season} stats · ${SPORT_LABEL[params.sport as Sport]} · cbb`,
      },
      {
        name: "description",
        content: `${loaderData?.name ?? "Player"} (${loaderData?.team ?? ""}) ${params.season}: per-game, shooting and advanced stats, game log and career.`,
      },
    ],
  }),
  component: PlayerPage,
});

function PlayerPage() {
  const { sport, season, current, entry } = useSeasonRoute();
  const { id } = Route.useLoaderData();
  const { data: doc } = useSuspenseQuery(playerQuery(sport, season, id, current));
  const p = doc.player;
  const l = doc.line;
  const r = doc.ranks;
  const f = doc.qualified ? doc.field : null;
  const bio = [p.jersey ? `#${p.jersey}` : null, p.position, p.class, p.height, p.weight].filter(
    Boolean,
  );
  return (
    <>
      <header className="mb-4 flex flex-wrap items-center gap-3">
        {p.headshot ? (
          <img
            src={p.headshot}
            alt=""
            width={56}
            height={56}
            className="size-14 rounded-md border bg-surface object-cover"
          />
        ) : (
          <div className="flex size-14 items-center justify-center rounded-md border bg-surface text-muted-foreground">
            <UserRound className="size-6" aria-hidden />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <Link
              to="/$sport/$season/teams/$teamKey"
              params={{ sport, season: String(season), teamKey: entityKey(p.team_id, p.team_slug) }}
              className="inline-flex items-center gap-1.5"
            >
              <TeamLogo src={p.team_logo} />
              {p.team_name}
            </Link>
            {bio.length ? <span>· {bio.join(" · ")}</span> : null}
          </p>
        </div>
      </header>
      <CoverageNotice coverage={entry.box_coverage} />
      {!doc.qualified ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Not qualified for leaderboards (under 40% of team minutes), so no D-I ranks are shown.
        </p>
      ) : null}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <RatingCard label="PPG" value={fmt1(l.ppg)} rank={r.ppg} field={f} />
        <RatingCard label="RPG" value={fmt1(l.rpg)} rank={r.rpg} field={f} />
        <RatingCard label="APG" value={fmt1(l.apg)} rank={r.apg} field={f} />
        <RatingCard
          label="TS%"
          value={fmtPct(l.ts_pct)}
          rank={r.ts_pct}
          field={f}
          title="True shooting percentage"
        />
        <RatingCard
          label="USG%"
          value={fmt1(l.usg_pct)}
          rank={r.usg_pct}
          field={f}
          title="Usage rate"
        />
        <RatingCard label="MPG" value={fmt1(l.mpg)} rank={r.mpg} field={f} />
      </div>
      <SeasonLine doc={doc} />
      <GameLog doc={doc} />
      <Career />
    </>
  );
}

function SeasonLine({ doc }: { doc: PlayerDoc }) {
  const l = doc.line;
  const cells: [string, string, number | undefined][] = [
    ["G", fmtInt(l.g), undefined],
    ["GS", fmtInt(l.gs), undefined],
    ["MPG", fmt1(l.mpg), doc.ranks.mpg],
    ["PPG", fmt1(l.ppg), doc.ranks.ppg],
    ["FG", `${fmt1(l.fgm)}-${fmt1(l.fga)}`, undefined],
    ["FG%", fmtPct(l.fg_pct), doc.ranks.fg_pct],
    ["3P", `${fmt1(l.fg3m)}-${fmt1(l.fg3a)}`, undefined],
    ["3P%", fmtPct(l.fg3_pct), doc.ranks.fg3_pct],
    ["FT", `${fmt1(l.ftm)}-${fmt1(l.fta)}`, undefined],
    ["FT%", fmtPct(l.ft_pct), doc.ranks.ft_pct],
    ["ORB", fmt1(l.orpg), undefined],
    ["RPG", fmt1(l.rpg), doc.ranks.rpg],
    ["APG", fmt1(l.apg), doc.ranks.apg],
    ["SPG", fmt1(l.spg), doc.ranks.spg],
    ["BPG", fmt1(l.bpg), doc.ranks.bpg],
    ["TOV", fmt1(l.topg), doc.ranks.topg],
    ["eFG%", fmtPct(l.efg_pct), doc.ranks.efg_pct],
    ["Min%", fmtPct(l.min_pct), undefined],
  ];
  return (
    <Section title="Season line (per game)">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-xs text-muted-foreground uppercase">
            <tr className="h-7 border-b">
              {cells.map(([h]) => (
                <th key={h} scope="col" className="px-2 text-right font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="h-[var(--row-h)]">
              {cells.map(([h, v, rank]) => (
                <td key={h} className="px-2 text-right font-mono whitespace-nowrap">
                  {v}
                  {rank ? (
                    <div className="text-[10px] leading-3 text-muted-foreground">{rank}</div>
                  ) : null}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {doc.qualified ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Small numbers are ranks among {doc.field.toLocaleString()} qualified D-I players.
        </p>
      ) : null}
    </Section>
  );
}

function GameLog({ doc }: { doc: PlayerDoc }) {
  const { sport, season } = useSeasonRoute();
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: false }]);
  const columns = useMemo(() => playerGameColumns(sport, season), [sport, season]);
  return (
    <Section title={`Game log (${doc.games.length})`}>
      <StatTable
        data={doc.games}
        columns={columns}
        rowKey={(g) => String(g.game_id)}
        sorting={sorting}
        onSortingChange={setSorting}
        caption="Game log"
      />
      <p className="mt-1 text-xs text-muted-foreground">* started</p>
    </Section>
  );
}

function Career() {
  const { sport, season } = useSeasonRoute();
  const { id } = Route.useLoaderData();
  const { data } = useQuery(careerQuery(sport, id));
  const [sorting, setSorting] = useState<SortingState>([{ id: "season", desc: false }]);
  const columns = useMemo<StatColumn<CareerSeason>[]>(() => {
    const n = (k: keyof CareerSeason, header: string, pct = false): StatColumn<CareerSeason> => ({
      id: k,
      header,
      numeric: true,
      value: (r) => r[k] as number | null,
      format: (v) => (pct ? fmtPct(v as number | null) : fmt1(v as number | null)),
    });
    return [
      {
        id: "season",
        header: "Season",
        numeric: true,
        value: (r) => r.season,
        cell: (r) =>
          r.season === season ? (
            <span className="font-mono">{r.label}</span>
          ) : (
            <Link
              to="/$sport/$season/players/$playerKey"
              params={{ sport, season: String(r.season), playerKey: entityKey(id, data?.slug) }}
              className="font-mono"
            >
              {r.label}
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
            params={{ sport, season: String(r.season), teamKey: entityKey(r.team_id, r.team_slug) }}
            className="inline-flex items-center gap-1.5 text-foreground hover:text-primary hover:no-underline"
          >
            <TeamLogo src={r.team_logo} />
            {r.team}
          </Link>
        ),
      },
      { id: "conference", header: "Conf", value: (r) => r.conference },
      {
        id: "g",
        header: "G",
        numeric: true,
        value: (r) => r.g,
        format: (v) => fmtInt(v as number),
      },
      n("mpg", "MPG"),
      n("ppg", "PPG"),
      n("rpg", "RPG"),
      n("apg", "APG"),
      n("spg", "SPG"),
      n("bpg", "BPG"),
      n("fg_pct", "FG%", true),
      n("fg3_pct", "3P%", true),
      n("ft_pct", "FT%", true),
      n("ts_pct", "TS%", true),
      n("usg_pct", "USG%"),
    ];
  }, [sport, season, id, data?.slug]);
  if (!data || data.seasons.length === 0) return null;
  return (
    <Section title="Career">
      <StatTable
        data={data.seasons}
        columns={columns}
        rowKey={(r) => String(r.season)}
        sorting={sorting}
        onSortingChange={setSorting}
        caption="Career"
      />
    </Section>
  );
}
