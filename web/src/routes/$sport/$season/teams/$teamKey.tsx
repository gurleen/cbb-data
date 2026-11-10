import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { MarginChart } from "@/components/charts";
import { CoverageNotice } from "@/components/coverage-notice";
import { rosterColumns, teamGameColumns } from "@/components/game-columns";
import { RatingCard, Section } from "@/components/stat-card";
import { StatTable } from "@/components/stat-table";
import { TeamLogo } from "@/components/team";
import { ApiError, entityKey, parseEntityKey, teamGamesQuery, teamQuery } from "@/lib/api";
import type { Sport, TeamDocFull } from "@/lib/api-types";
import { fmt1, fmtPct, fmtRecord, fmtSigned, fmtWinPct } from "@/lib/format";
import { SPORT_LABEL } from "@/lib/season-context";
import { useSeasonRoute } from "@/lib/use-season";

export const Route = createFileRoute("/$sport/$season/teams/$teamKey")({
  loader: async ({ context, params }) => {
    const id = parseEntityKey(params.teamKey);
    if (id === null) throw notFound();
    const sport = params.sport as Sport;
    const season = Number(params.season);
    const current =
      context.queryClient.getQueryData<{ current_season: number }>(["seasons", sport])
        ?.current_season ?? 0;
    let team: TeamDocFull;
    try {
      [team] = await Promise.all([
        context.queryClient.ensureQueryData(teamQuery(sport, season, id, current)),
        context.queryClient
          .ensureQueryData(teamGamesQuery(sport, season, id, current))
          .catch(() => null),
      ]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) throw notFound();
      throw e;
    }
    const canonical = entityKey(id, team.team.slug);
    if (params.teamKey !== canonical) {
      throw redirect({
        to: "/$sport/$season/teams/$teamKey",
        params: { ...params, teamKey: canonical },
        statusCode: 301,
      });
    }
    return { crumb: team.team.short_name ?? team.team.name, name: team.team.name, id };
  },
  head: ({ params, loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.name ?? "Team"} ${params.season} stats · ${SPORT_LABEL[params.sport as Sport]} · cbb`,
      },
      {
        name: "description",
        content: `${loaderData?.name ?? "Team"} ${params.season}: ratings, splits, game log and roster.`,
      },
    ],
  }),
  component: TeamPage,
});

function TeamPage() {
  const { sport, season, current } = useSeasonRoute();
  const { id } = Route.useLoaderData();
  const { data: doc } = useSuspenseQuery(teamQuery(sport, season, id, current));
  const t = doc.team;
  return (
    <>
      <header
        className="mb-4 flex flex-wrap items-center gap-3 border-l-[3px] pl-3"
        style={{ borderColor: t.color ?? "var(--border)" }}
      >
        <TeamLogo src={t.logo} size={40} />
        <div>
          <h1 className="text-2xl font-semibold">{t.name}</h1>
          <p className="text-sm text-muted-foreground">
            {t.conference ? (
              <Link
                to="/$sport/$season/conferences/$conferenceId"
                params={{ sport, season: String(season), conferenceId: String(t.conference.id) }}
              >
                {t.conference.name ?? t.conference.short_name}
              </Link>
            ) : (
              "Non-Division I"
            )}
            {doc.record ? (
              <span className="ml-2 font-mono text-foreground">
                {fmtRecord(doc.record.wins, doc.record.losses)}
                <span className="ml-1.5 text-muted-foreground">
                  ({fmtRecord(doc.record.conference.wins, doc.record.conference.losses)} conf)
                </span>
              </span>
            ) : null}
          </p>
        </div>
      </header>
      <CoverageNotice coverage={doc.box?.coverage} />
      {doc.ratings ? <Ratings doc={doc} /> : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {doc.record ? <Splits doc={doc} /> : null}
        {doc.per_game && doc.shooting ? <VsOpponents doc={doc} /> : null}
      </div>
      <GameLog />
      {doc.roster.length ? <Roster doc={doc} /> : null}
    </>
  );
}

function Ratings({ doc }: { doc: TeamDocFull }) {
  const r = doc.ratings!;
  const f = doc.rank_field;
  return (
    <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <RatingCard
        label="ORtg"
        value={fmt1(r.ortg)}
        rank={doc.ranks.ortg}
        field={f}
        title="Points per 100 possessions"
      />
      <RatingCard
        label="DRtg"
        value={fmt1(r.drtg)}
        rank={doc.ranks.drtg}
        field={f}
        title="Points allowed per 100 possessions"
      />
      <RatingCard
        label="Net"
        value={fmtSigned(r.net_rtg)}
        rank={doc.ranks.net_rtg}
        field={f}
        title="ORtg - DRtg"
      />
      <RatingCard
        label="Pace"
        value={fmt1(r.pace)}
        rank={doc.ranks.pace}
        field={f}
        title="Possessions per game (rank 1 = fastest)"
        neutral
      />
    </div>
  );
}

function Splits({ doc }: { doc: TeamDocFull }) {
  const r = doc.record!;
  const rows: [string, number, number][] = [
    ["Overall", r.wins, r.losses],
    ["Conference", r.conference.wins, r.conference.losses],
    ["Home", r.home.wins, r.home.losses],
    ["Away", r.away.wins, r.away.losses],
    ["Neutral", r.neutral.wins, r.neutral.losses],
  ];
  return (
    <Section title="Record">
      <table className="w-full rounded-md border text-sm">
        <thead className="bg-surface text-xs text-muted-foreground uppercase">
          <tr className="h-7 border-b">
            <th className="px-2 text-left font-medium">Split</th>
            <th className="px-2 text-right font-medium">W-L</th>
            <th className="px-2 text-right font-medium">Win%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, w, l]) => (
            <tr key={label} className="h-[var(--row-h)] border-b last:border-b-0">
              <td className="px-2">{label}</td>
              <td className="px-2 text-right font-mono">{fmtRecord(w, l)}</td>
              <td className="px-2 text-right font-mono">{fmtWinPct(w + l ? w / (w + l) : null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function VsOpponents({ doc }: { doc: TeamDocFull }) {
  const pg = doc.per_game!;
  const sh = doc.shooting!;
  const tot = doc.totals ?? {};
  const g = doc.box?.games || 1;
  const per = (k: string) =>
    tot[k] === null || tot[k] === undefined ? null : (tot[k] as number) / g;
  const rows: [string, string, string, string?, string?][] = [
    ["Points", fmt1(pg.ppg), fmt1(pg.opp_ppg), "ppg", "opp_ppg"],
    ["FG%", fmtPct(sh.fg_pct), fmtPct(sh.opp_fg_pct), "fg_pct", "opp_fg_pct"],
    ["3P%", fmtPct(sh.fg3_pct), fmtPct(sh.opp_fg3_pct), "fg3_pct", "opp_fg3_pct"],
    [
      "FT%",
      fmtPct(sh.ft_pct),
      fmtPct(
        per("opp_ftm") !== null && per("opp_fta")
          ? (tot.opp_ftm as number) / (tot.opp_fta as number)
          : null,
      ),
    ],
    ["Rebounds", fmt1(pg.rpg), fmt1(per("opp_trb")), "rpg"],
    ["Off. rebounds", fmt1(pg.orpg), fmt1(per("opp_orb"))],
    ["Assists", fmt1(pg.apg), fmt1(per("opp_ast")), "apg"],
    ["Turnovers", fmt1(pg.topg), fmt1(per("opp_tov")), "topg"],
    ["Steals", fmt1(pg.spg), fmt1(per("opp_stl")), "spg"],
    ["Blocks", fmt1(pg.bpg), fmt1(per("opp_blk")), "bpg"],
  ];
  const rank = (k?: string) =>
    k && doc.ranks[k as keyof typeof doc.ranks] ? (
      <span className="ml-1 text-[10px] text-muted-foreground">
        {doc.ranks[k as keyof typeof doc.ranks]}
      </span>
    ) : null;
  return (
    <Section title="Team vs. opponents">
      <table className="w-full rounded-md border text-sm">
        <thead className="bg-surface text-xs text-muted-foreground uppercase">
          <tr className="h-7 border-b">
            <th className="px-2 text-left font-medium">Per game</th>
            <th className="px-2 text-right font-medium">Team</th>
            <th className="px-2 text-right font-medium">Opp</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b, ka, kb]) => (
            <tr key={label} className="h-[var(--row-h)] border-b last:border-b-0">
              <td className="px-2">{label}</td>
              <td className="px-2 text-right font-mono">
                {a}
                {rank(ka)}
              </td>
              <td className="px-2 text-right font-mono">
                {b}
                {rank(kb)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-muted-foreground">Small numbers are D-I ranks.</p>
    </Section>
  );
}

function GameLog() {
  const { sport, season, current } = useSeasonRoute();
  const { id } = Route.useLoaderData();
  // Optional: older builds may lack a game log, so don't suspend on errors.
  const { data } = useQuery(teamGamesQuery(sport, season, id, current));
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: false }]);
  const columns = useMemo(() => teamGameColumns(sport, season), [sport, season]);
  if (!data) return null;
  return (
    <Section title={`Game log (${data.games.filter((g) => g.completed).length} played)`}>
      <div className="mb-2">
        <MarginChart games={data.games} />
      </div>
      <StatTable
        data={data.games}
        columns={columns}
        rowKey={(g) => String(g.game_id)}
        sorting={sorting}
        onSortingChange={setSorting}
        caption="Game log"
      />
      <p className="mt-1 text-xs text-muted-foreground">C = conference game · P = postseason</p>
    </Section>
  );
}

function Roster({ doc }: { doc: TeamDocFull }) {
  const { sport, season } = useSeasonRoute();
  const [sorting, setSorting] = useState<SortingState>([{ id: "mpg", desc: true }]);
  const columns = useMemo(() => rosterColumns(sport, season), [sport, season]);
  return (
    <Section title="Roster">
      <StatTable
        data={doc.roster}
        columns={columns}
        rowKey={(r) => String(r.player_id)}
        sorting={sorting}
        onSortingChange={setSorting}
        caption="Roster"
      />
    </Section>
  );
}
