import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { CoverageNotice } from "@/components/coverage-notice";
import { BarList, LeaderCard, type LeaderItem } from "@/components/leaders";
import { PageHeader, Stat } from "@/components/page";
import { Section } from "@/components/stat-card";
import { type StatColumn, StatTable } from "@/components/stat-table";
import { conferencesQuery, playersQuery, teamStatsQuery } from "@/lib/api";
import type { PlayerRow, Sport, TeamStatsRow } from "@/lib/api-types";
import { fmt1, fmtDate, fmtInt, fmtPct, fmtSigned } from "@/lib/format";
import { SPORT_LABEL, SPORT_NAME } from "@/lib/season-context";
import { teamColumns } from "@/lib/team-columns";
import { useSeasonRoute } from "@/lib/use-season";

export const Route = createFileRoute("/$sport/$season/")({
  loader: async ({ context, params }) => {
    const sport = params.sport as Sport;
    const season = Number(params.season);
    const current =
      context.queryClient.getQueryData<{ current_season: number }>(["seasons", sport])
        ?.current_season ?? 0;
    await Promise.all([
      context.queryClient.ensureQueryData(teamStatsQuery(sport, season, current)),
      context.queryClient
        .ensureQueryData(conferencesQuery(sport, season, current))
        .catch(() => null),
    ]);
  },
  head: ({ params }) => ({
    meta: [
      { title: `${SPORT_LABEL[params.sport as Sport]} ${params.season} season · cbb` },
      {
        name: "description",
        content: `Top teams, conference strength and stat leaders for the ${params.season} season.`,
      },
    ],
  }),
  component: SeasonOverview,
});

const TOP25_COLS = new Set(["team", "record", "ortg", "drtg", "net_rtg", "pace"]);

function SeasonOverview() {
  const { sport, season, current, entry } = useSeasonRoute();
  const { data: stats } = useSuspenseQuery(teamStatsQuery(sport, season, current));
  const { data: confs } = useQuery(conferencesQuery(sport, season, current));
  // Player leaders load client-side (the leaderboard is the largest document).
  const { data: players } = useQuery(playersQuery(sport, season, current));
  const [sorting, setSorting] = useState<SortingState>([{ id: "net_rtg", desc: true }]);

  const columns = useMemo(
    () =>
      teamColumns(sport, season)
        .filter((c) => TOP25_COLS.has(c.id))
        .map(({ group, ...c }) => c),
    [sport, season],
  ) as StatColumn<TeamStatsRow>[];
  const top25 = useMemo(
    () =>
      [...stats.rows]
        .filter((r) => r.net_rtg !== null)
        .sort((a, b) => (b.net_rtg ?? 0) - (a.net_rtg ?? 0))
        .slice(0, 25),
    [stats.rows],
  );

  const teamLeaders = (
    key: keyof TeamStatsRow,
    fmt: (v: number | null) => string,
    asc = false,
  ): LeaderItem[] =>
    [...stats.rows]
      .filter((r) => r[key] !== null && r.box_games >= 5)
      .sort((a, b) => ((a[key] as number) - (b[key] as number)) * (asc ? 1 : -1))
      .slice(0, 5)
      .map((r) => ({
        key: String(r.team_id),
        label: r.short_name ?? r.name,
        logo: r.logo,
        to: { kind: "team", id: r.team_id, slug: r.slug },
        value: fmt(r[key] as number),
      }));

  const playerLeaders = (key: keyof PlayerRow): LeaderItem[] =>
    (players?.rows ?? [])
      .filter((r) => r[key] !== null)
      .sort((a, b) => (b[key] as number) - (a[key] as number))
      .slice(0, 5)
      .map((r) => ({
        key: String(r.player_id),
        label: (
          <>
            {r.name} <span className="text-xs text-muted-foreground">{r.team}</span>
          </>
        ),
        logo: r.team_logo,
        to: { kind: "player", id: r.player_id, slug: r.slug },
        value: fmt1(r[key] as number),
      }));

  const params = { sport, season: String(season) };
  return (
    <>
      <PageHeader title={`${entry.label} season`} subtitle={SPORT_NAME[sport]} />
      <div className="mb-4 flex flex-wrap gap-6 rounded-md border bg-surface px-3 py-2">
        <Stat label="D-I teams" value={fmtInt(entry.division_i_teams)} />
        <Stat label="Games" value={fmtInt(entry.games)} />
        <Stat label="Box coverage" value={`${fmtPct(entry.box_coverage)}%`} />
        <Stat label="Updated" value={fmtDate(entry.updated_at)} />
      </div>
      <CoverageNotice coverage={entry.box_coverage} />
      <div className="grid gap-x-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section
          title="Top 25 by net rating"
          actions={
            <Link to="/$sport/$season/teams" params={params} className="text-xs">
              All teams →
            </Link>
          }
        >
          <StatTable
            data={top25}
            columns={columns}
            rowKey={(r) => String(r.team_id)}
            sorting={sorting}
            onSortingChange={setSorting}
            rank
            caption="Top 25 teams by net rating"
          />
        </Section>
        {confs ? (
          <Section
            title="Conference strength"
            actions={
              <Link to="/$sport/$season/conferences" params={params} className="text-xs">
                All conferences →
              </Link>
            }
          >
            <BarList
              items={confs.conferences
                .filter((c) => c.avg_net_rtg !== null)
                .map((c) => ({
                  key: String(c.id),
                  label: (
                    <Link
                      to="/$sport/$season/conferences/$conferenceId"
                      params={{ ...params, conferenceId: String(c.id) }}
                      className="text-foreground hover:text-primary hover:no-underline"
                    >
                      {c.short_name ?? c.name}
                    </Link>
                  ),
                  value: c.avg_net_rtg,
                  display: fmtSigned(c.avg_net_rtg),
                }))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Average net rating of member teams.
            </p>
          </Section>
        ) : null}
      </div>
      <Section title="Team leaders">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <LeaderCard
            title="Points per game"
            items={teamLeaders("ppg", fmt1)}
            sport={sport}
            season={season}
          />
          <LeaderCard
            title="Opp. points per game"
            items={teamLeaders("opp_ppg", fmt1, true)}
            sport={sport}
            season={season}
          />
          <LeaderCard
            title="3-point %"
            items={teamLeaders("fg3_pct", fmtPct)}
            sport={sport}
            season={season}
          />
          <LeaderCard
            title="Pace"
            items={teamLeaders("pace", fmt1)}
            sport={sport}
            season={season}
          />
          <LeaderCard
            title="Net rating"
            items={teamLeaders("net_rtg", fmtSigned)}
            sport={sport}
            season={season}
          />
        </div>
      </Section>
      {players?.rows.length ? (
        <Section
          title="Player leaders"
          actions={
            <Link to="/$sport/$season/players" params={params} className="text-xs">
              All players →
            </Link>
          }
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <LeaderCard
              title="Points per game"
              items={playerLeaders("ppg")}
              sport={sport}
              season={season}
            />
            <LeaderCard
              title="Rebounds per game"
              items={playerLeaders("rpg")}
              sport={sport}
              season={season}
            />
            <LeaderCard
              title="Assists per game"
              items={playerLeaders("apg")}
              sport={sport}
              season={season}
            />
          </div>
        </Section>
      ) : null}
    </>
  );
}
