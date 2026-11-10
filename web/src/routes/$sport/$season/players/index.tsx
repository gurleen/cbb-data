import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { CoverageNotice } from "@/components/coverage-notice";
import { ColumnGroupMenu, MultiSelectMenu, Segmented } from "@/components/filters";
import { PageHeader } from "@/components/page";
import { Pager } from "@/components/pager";
import { StatTable, sortLike } from "@/components/stat-table";
import { ExportButtons, ShadeToggle } from "@/components/table-tools";
import { playersQuery } from "@/lib/api";
import type { Sport } from "@/lib/api-types";
import {
  CLASS_SHORT,
  DEFAULT_PLAYER_GROUPS,
  PLAYER_GROUPS,
  playerColumns,
} from "@/lib/player-columns";
import { SPORT_LABEL } from "@/lib/season-context";
import { parseSortParam, sortParam } from "@/lib/sort-param";
import { hiddenColumns } from "@/lib/team-columns";
import { useSeasonRoute } from "@/lib/use-season";

const PAGE_SIZE = 100;
const DEFAULTS = {
  sort: "-ppg",
  conf: "",
  pos: "",
  cls: "",
  cols: DEFAULT_PLAYER_GROUPS.join(","),
  pool: "qualified" as "qualified" | "all",
  page: 1,
  shade: 0,
};
const search = z.object({
  sort: z.coerce.string().default(DEFAULTS.sort).catch(DEFAULTS.sort),
  conf: z.coerce.string().default(DEFAULTS.conf).catch(DEFAULTS.conf),
  pos: z.coerce.string().default(DEFAULTS.pos).catch(DEFAULTS.pos),
  cls: z.coerce.string().default(DEFAULTS.cls).catch(DEFAULTS.cls),
  cols: z.coerce.string().default(DEFAULTS.cols).catch(DEFAULTS.cols),
  pool: z.enum(["qualified", "all"]).default(DEFAULTS.pool).catch(DEFAULTS.pool),
  page: z.coerce.number().int().min(1).default(DEFAULTS.page).catch(DEFAULTS.page),
  shade: z.coerce.number().int().min(0).max(1).default(DEFAULTS.shade).catch(DEFAULTS.shade),
});

export const Route = createFileRoute("/$sport/$season/players/")({
  validateSearch: search,
  search: { middlewares: [stripSearchParams(DEFAULTS)] },
  loader: async ({ context, params }) => {
    const sport = params.sport as Sport;
    const current =
      context.queryClient.getQueryData<{ current_season: number }>(["seasons", sport])
        ?.current_season ?? 0;
    // SSR renders the qualified leaderboard; the full list loads in the browser.
    await context.queryClient.ensureQueryData(playersQuery(sport, Number(params.season), current));
    return { crumb: "Players" };
  },
  head: ({ params }) => ({
    meta: [
      { title: `Player stats · ${SPORT_LABEL[params.sport as Sport]} ${params.season} · cbb` },
      {
        name: "description",
        content: `Per-game, shooting and advanced stats for D-I players, ${params.season}.`,
      },
    ],
  }),
  component: PlayersPage,
});

const list = (s: string) => s.split(",").filter(Boolean);

function PlayersPage() {
  const { sport, season, current, entry } = useSeasonRoute();
  const sp = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const set = (patch: Partial<typeof sp>, keepPage = false) =>
    navigate({
      search: (prev) => ({ ...prev, ...patch, ...(keepPage ? {} : { page: 1 }) }),
      replace: true,
      resetScroll: false,
    });

  const { data: qualified } = useSuspenseQuery(playersQuery(sport, season, current));
  const all = useQuery({
    ...playersQuery(sport, season, current, true),
    enabled: sp.pool === "all",
  });
  const doc = sp.pool === "all" && all.data ? all.data : qualified;

  const columns = useMemo(() => playerColumns(sport, season), [sport, season]);
  const hidden = useMemo(() => hiddenColumns(columns as never, list(sp.cols)), [columns, sp.cols]);
  const confs = list(sp.conf);
  const poss = list(sp.pos);
  const classes = list(sp.cls);

  const options = useMemo(() => {
    const conf = new Map<string, string>();
    const pos = new Set<string>();
    for (const r of doc.rows) {
      if (r.conference_id !== null) conf.set(String(r.conference_id), r.conference ?? "");
      if (r.position) pos.add(r.position);
    }
    return {
      conf: [...conf]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
      pos: [...pos].sort().map((p) => ({ value: p, label: p })),
    };
  }, [doc.rows]);

  const rows = useMemo(
    () =>
      doc.rows.filter(
        (r) =>
          (confs.length === 0 || confs.includes(String(r.conference_id))) &&
          (poss.length === 0 || (r.position !== null && poss.includes(r.position))) &&
          (classes.length === 0 ||
            (r.class !== null && classes.includes(CLASS_SHORT[r.class] ?? r.class))),
      ),
    [doc.rows, confs, poss, classes],
  );
  const sorting = parseSortParam(sp.sort, [{ id: "ppg", desc: true }]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(sp.page, pages);

  return (
    <>
      <PageHeader
        title="Players"
        subtitle={`${entry.label} · ${rows.length.toLocaleString()} ${sp.pool === "all" ? "D-I players" : "qualified D-I players"}`}
        actions={
          <>
            <Segmented
              label="Player pool"
              value={sp.pool}
              onChange={(pool) => set({ pool })}
              options={[
                { value: "qualified", label: "Qualified" },
                { value: "all", label: all.isFetching ? "All…" : "All" },
              ]}
            />
            <MultiSelectMenu
              label="Conferences"
              options={options.conf}
              selected={confs}
              onChange={(v) => set({ conf: v.join(",") })}
            />
            <MultiSelectMenu
              label="Positions"
              options={options.pos}
              selected={poss}
              onChange={(v) => set({ pos: v.join(",") })}
            />
            <MultiSelectMenu
              label="Classes"
              options={["Fr", "So", "Jr", "Sr"].map((c) => ({ value: c, label: c }))}
              selected={classes}
              onChange={(v) => set({ cls: v.join(",") })}
            />
            <ColumnGroupMenu
              groups={[...PLAYER_GROUPS]}
              visible={list(sp.cols)}
              onChange={(v) => set({ cols: v.join(",") }, true)}
            />
            <ShadeToggle on={sp.shade === 1} onChange={(on) => set({ shade: on ? 1 : 0 }, true)} />
            <ExportButtons
              columns={columns}
              rows={sortLike(rows, columns, sorting)}
              hidden={hidden}
              filename={`cbb-${sport}-${season}-players`}
            />
          </>
        }
      />
      <CoverageNotice coverage={entry.box_coverage} />
      <StatTable
        data={rows}
        columns={columns}
        rowKey={(r) => String(r.player_id)}
        sorting={sorting}
        onSortingChange={(s) => set({ sort: sortParam(s) })}
        hidden={hidden}
        rank
        shade={sp.shade === 1}
        page={{ index: page - 1, size: PAGE_SIZE }}
        caption={`Player stats, ${entry.label}`}
      />
      <Pager
        page={page}
        pages={pages}
        total={rows.length}
        size={PAGE_SIZE}
        onPage={(p) => set({ page: p }, true)}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        Qualified: played at least 40% of team minutes (or 50% of games where minutes are missing).
        Class data is only available from recent rosters.
      </p>
    </>
  );
}
