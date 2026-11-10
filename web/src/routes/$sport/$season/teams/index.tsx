import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { CoverageNotice } from "@/components/coverage-notice";
import { ColumnGroupMenu, MultiSelectMenu, NumberFilter } from "@/components/filters";
import { PageHeader } from "@/components/page";
import { StatTable } from "@/components/stat-table";
import { teamStatsQuery } from "@/lib/api";
import type { Sport } from "@/lib/api-types";
import { SPORT_LABEL } from "@/lib/season-context";
import { parseSortParam, sortParam } from "@/lib/sort-param";
import { DEFAULT_TEAM_GROUPS, hiddenColumns, TEAM_GROUPS, teamColumns } from "@/lib/team-columns";
import { useSeasonRoute } from "@/lib/use-season";

const DEFAULTS = { sort: "-net_rtg", conf: "", cols: DEFAULT_TEAM_GROUPS.join(","), min: 0 };
const search = z.object({
  sort: z.coerce.string().default(DEFAULTS.sort).catch(DEFAULTS.sort),
  conf: z.coerce.string().default(DEFAULTS.conf).catch(DEFAULTS.conf),
  cols: z.coerce.string().default(DEFAULTS.cols).catch(DEFAULTS.cols),
  min: z.coerce.number().int().min(0).max(45).default(DEFAULTS.min).catch(DEFAULTS.min),
});

export const Route = createFileRoute("/$sport/$season/teams/")({
  validateSearch: search,
  search: { middlewares: [stripSearchParams(DEFAULTS)] },
  loader: async ({ context, params }) => {
    const { queryClient } = context;
    const sport = params.sport as Sport;
    const seasons = queryClient.getQueryData<{ current_season: number }>(["seasons", sport]);
    await queryClient.ensureQueryData(
      teamStatsQuery(sport, Number(params.season), seasons?.current_season ?? 0),
    );
    return { crumb: "Teams" };
  },
  head: ({ params }) => ({
    meta: [
      { title: `Team stats · ${SPORT_LABEL[params.sport as Sport]} ${params.season} · cbb` },
      {
        name: "description",
        content: `Ratings, scoring and shooting for every D-I team in the ${params.season} season.`,
      },
    ],
  }),
  component: TeamsPage,
});

function TeamsPage() {
  const { sport, season, current, entry } = useSeasonRoute();
  const { data } = useSuspenseQuery(teamStatsQuery(sport, season, current));
  const sp = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const set = (patch: Partial<typeof sp>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });

  const columns = useMemo(() => teamColumns(sport, season), [sport, season]);
  const visibleGroups = sp.cols.split(",").filter(Boolean);
  const hidden = useMemo(() => hiddenColumns(columns, visibleGroups), [columns, visibleGroups]);
  const confs = sp.conf.split(",").filter(Boolean);
  const sorting = parseSortParam(sp.sort, [{ id: "net_rtg", desc: true }]);

  const conferenceOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of data.rows)
      if (r.conference_id !== null) m.set(r.conference_id, r.conference ?? "");
    return [...m]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([v, l]) => ({ value: String(v), label: l }));
  }, [data.rows]);

  const rows = useMemo(
    () =>
      data.rows.filter(
        (r) => (confs.length === 0 || confs.includes(String(r.conference_id))) && r.games >= sp.min,
      ),
    [data.rows, confs, sp.min],
  );

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle={`${entry.label} · ${rows.length} of ${data.rows.length} D-I teams`}
        actions={
          <>
            <MultiSelectMenu
              label="Conferences"
              options={conferenceOptions}
              selected={confs}
              onChange={(v) => set({ conf: v.join(",") })}
            />
            <NumberFilter label="Min G" value={sp.min} max={45} onChange={(min) => set({ min })} />
            <ColumnGroupMenu
              groups={[...TEAM_GROUPS]}
              visible={visibleGroups}
              onChange={(v) => set({ cols: v.join(",") })}
            />
          </>
        }
      />
      <CoverageNotice coverage={entry.box_coverage} />
      <StatTable
        data={rows}
        columns={columns}
        rowKey={(r) => String(r.team_id)}
        sorting={sorting}
        onSortingChange={(s) => set({ sort: sortParam(s) })}
        hidden={hidden}
        rank
        caption={`Team stats, ${entry.label}`}
      />
    </>
  );
}
