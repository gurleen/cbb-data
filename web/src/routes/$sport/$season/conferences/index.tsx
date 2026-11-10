import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { CoverageNotice } from "@/components/coverage-notice";
import { PageHeader } from "@/components/page";
import { type StatColumn, StatTable } from "@/components/stat-table";
import { TeamLink } from "@/components/team";
import { conferencesQuery } from "@/lib/api";
import type { ConferenceRow, Sport } from "@/lib/api-types";
import { fmt1, fmtInt, fmtRecord, fmtSigned, fmtWinPct } from "@/lib/format";
import { SPORT_LABEL } from "@/lib/season-context";
import { parseSortParam, sortParam } from "@/lib/sort-param";
import { useSeasonRoute } from "@/lib/use-season";

const DEFAULTS = { sort: "-avg_net_rtg" };

export const Route = createFileRoute("/$sport/$season/conferences/")({
  validateSearch: z.object({ sort: z.coerce.string().default(DEFAULTS.sort).catch(DEFAULTS.sort) }),
  search: { middlewares: [stripSearchParams(DEFAULTS)] },
  loader: async ({ context, params }) => {
    const sport = params.sport as Sport;
    const current =
      context.queryClient.getQueryData<{ current_season: number }>(["seasons", sport])
        ?.current_season ?? 0;
    await context.queryClient.ensureQueryData(
      conferencesQuery(sport, Number(params.season), current),
    );
    return { crumb: "Conferences" };
  },
  head: ({ params }) => ({
    meta: [
      { title: `Conferences · ${SPORT_LABEL[params.sport as Sport]} ${params.season} · cbb` },
      { name: "description", content: `D-I conference strength for the ${params.season} season.` },
    ],
  }),
  component: ConferencesPage,
});

function ConferencesPage() {
  const { sport, season, current, entry } = useSeasonRoute();
  const { data } = useSuspenseQuery(conferencesQuery(sport, season, current));
  const sp = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const columns = useMemo<StatColumn<ConferenceRow>[]>(() => {
    const n = (v: unknown) => v as number | null;
    return [
      {
        id: "name",
        header: "Conference",
        value: (c) => c.name,
        width: 240,
        cell: (c) => (
          <Link
            to="/$sport/$season/conferences/$conferenceId"
            params={{ sport, season: String(season), conferenceId: String(c.id) }}
            className="text-foreground hover:text-primary hover:no-underline"
          >
            {c.short_name ?? c.name}
            <span className="ml-1.5 text-xs text-muted-foreground">
              {c.short_name ? c.name : ""}
            </span>
          </Link>
        ),
      },
      {
        id: "teams",
        header: "Teams",
        numeric: true,
        value: (c) => c.teams,
        format: (v) => fmtInt(n(v)),
      },
      {
        id: "avg_ortg",
        header: "ORtg",
        title: "Average offensive rating",
        group: "Avg. ratings",
        numeric: true,
        value: (c) => c.avg_ortg,
        format: (v) => fmt1(n(v)),
      },
      {
        id: "avg_drtg",
        header: "DRtg",
        title: "Average defensive rating",
        group: "Avg. ratings",
        numeric: true,
        lowerIsBetter: true,
        value: (c) => c.avg_drtg,
        format: (v) => fmt1(n(v)),
      },
      {
        id: "avg_net_rtg",
        header: "Net",
        title: "Average net rating",
        group: "Avg. ratings",
        numeric: true,
        value: (c) => c.avg_net_rtg,
        format: (v) => fmtSigned(n(v)),
      },
      {
        id: "avg_pace",
        header: "Pace",
        title: "Average pace",
        group: "Avg. ratings",
        numeric: true,
        value: (c) => c.avg_pace,
        format: (v) => fmt1(n(v)),
      },
      {
        id: "nonconf",
        header: "W-L",
        title: "Record vs. other D-I conferences",
        group: "Non-conference",
        numeric: true,
        value: (c) =>
          c.nonconf_wins + c.nonconf_losses
            ? c.nonconf_wins / (c.nonconf_wins + c.nonconf_losses)
            : null,
        format: (_v, c) => fmtRecord(c.nonconf_wins, c.nonconf_losses),
      },
      {
        id: "nonconf_pct",
        header: "Win%",
        group: "Non-conference",
        numeric: true,
        value: (c) =>
          c.nonconf_wins + c.nonconf_losses
            ? c.nonconf_wins / (c.nonconf_wins + c.nonconf_losses)
            : null,
        format: (v) => fmtWinPct(n(v)),
      },
      {
        id: "best",
        header: "Best team",
        value: (c) => c.best_team?.net_rtg ?? null,
        sortable: false,
        cell: (c) =>
          c.best_team ? (
            <TeamLink
              sport={sport}
              season={season}
              id={c.best_team.id}
              name={c.best_team.name}
              slug={c.best_team.slug}
              logo={c.best_team.logo}
              subtitle={fmtSigned(c.best_team.net_rtg)}
            />
          ) : null,
      },
    ];
  }, [sport, season]);

  return (
    <>
      <PageHeader title="Conferences" subtitle={`${entry.label} · ${data.count} conferences`} />
      <CoverageNotice coverage={entry.box_coverage} />
      <StatTable
        data={data.conferences}
        columns={columns}
        rowKey={(c) => String(c.id)}
        sorting={parseSortParam(sp.sort, [{ id: "avg_net_rtg", desc: true }])}
        onSortingChange={(s) =>
          navigate({ search: { sort: sortParam(s) }, replace: true, resetScroll: false })
        }
        rank
        caption={`Conferences, ${entry.label}`}
      />
      <p className="mt-1 text-xs text-muted-foreground">
        Averages are plain means over member teams; non-conference records count games against other
        D-I conferences.
      </p>
    </>
  );
}
