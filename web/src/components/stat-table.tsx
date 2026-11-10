// Shared stats table (spec §7.1). Typed column config -> TanStack Table v9.
// Sticky header + sticky first (entity) column; sort state is controlled by the caller
// (pages keep it in the URL); nulls always sort last; numeric columns sort descending
// first unless `lowerIsBetter`.
import {
  type ColumnDef,
  columnVisibilityFeature,
  createPaginatedRowModel,
  createSortedRowModel,
  type RowData,
  rowPaginationFeature,
  rowSortingFeature,
  type SortingState,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { DASH } from "@/lib/format";
import { cn } from "@/lib/utils";

const features = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

export interface StatColumn<T extends RowData> {
  id: string;
  /** Short header label, e.g. "ORtg". */
  header: string;
  /** Tooltip / screen-reader description, e.g. "Offensive rating (pts per 100 poss.)". */
  title?: string;
  /** Header-group label; consecutive columns with the same group share a group header. */
  group?: string;
  value: (row: T) => number | string | null | undefined;
  /** Display formatter for the value (defaults to String / dash). */
  format?: (value: number | string | null | undefined, row: T) => ReactNode;
  /** Custom cell renderer (overrides format), e.g. the entity column with a logo. */
  cell?: (row: T) => ReactNode;
  align?: "left" | "right";
  /** For numeric stats where lower is better (DRtg, opponent PPG, turnovers). */
  lowerIsBetter?: boolean;
  /** Column is a number (mono font, right-aligned, sorts descending first). */
  numeric?: boolean;
  sortable?: boolean;
  /** Fixed width in px (use for the sticky entity column). */
  width?: number;
  /** Exclude from rank shading even when numeric (counts, records, ranks). */
  noShade?: boolean;
}

export interface StatTableProps<T extends RowData> {
  data: T[];
  columns: StatColumn<T>[];
  rowKey: (row: T) => string;
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  /** Column ids to hide. */
  hidden?: string[];
  /** Show a leading rank column that reflects the current sort. */
  rank?: boolean;
  /** Pin the first configured column. */
  stickyFirst?: boolean;
  caption?: string;
  className?: string;
  /** Client-side pagination applied after sorting (0-based page index). */
  page?: { index: number; size: number };
  /** Tint numeric cells by percentile within `data` (spec §3.3 rank shading). */
  shade?: boolean;
}

function toColumnDefs<T extends RowData>(
  cols: StatColumn<T>[],
): ColumnDef<typeof features, T, unknown>[] {
  const leaf = (c: StatColumn<T>): ColumnDef<typeof features, T, unknown> => ({
    id: c.id,
    // undefined (not null) so `sortUndefined: "last"` keeps missing values at the bottom
    accessorFn: (row: T) => c.value(row) ?? undefined,
    header: c.header,
    enableSorting: c.sortable !== false,
    sortUndefined: "last",
    sortDescFirst: c.numeric ? !c.lowerIsBetter : false,
    // numeric columns use the built-in comparator (no key at all; undefined warns)
    ...(c.numeric ? {} : { sortFn: "alphanumeric" as const }),
    meta: c,
  });
  const out: ColumnDef<typeof features, T, unknown>[] = [];
  let i = 0;
  while (i < cols.length) {
    const g = cols[i].group;
    if (!g) {
      out.push(leaf(cols[i]));
      i++;
      continue;
    }
    const members: StatColumn<T>[] = [];
    while (i < cols.length && cols[i].group === g) members.push(cols[i++]);
    out.push({ id: `group:${g}:${out.length}`, header: g, columns: members.map(leaf) });
  }
  return out;
}

function ariaSort(dir: false | "asc" | "desc"): "ascending" | "descending" | "none" {
  return dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none";
}

export function StatTable<T extends RowData>({
  data,
  columns,
  rowKey,
  sorting,
  onSortingChange,
  hidden = [],
  rank = false,
  stickyFirst = true,
  caption,
  className,
  page,
  shade = false,
}: StatTableProps<T>) {
  const defs = useMemo(() => toColumnDefs(columns), [columns]);
  const columnVisibility = useMemo(
    () => Object.fromEntries(hidden.map((id) => [id, false])),
    [hidden],
  );
  const firstId = columns[0]?.id;
  const percentiles = useMemo(
    () => (shade ? percentileFns(columns, data, hidden) : null),
    [shade, columns, data, hidden],
  );

  const table = useTable({
    features,
    columns: defs,
    data,
    getRowId: (row: T) => rowKey(row),
    state: {
      sorting,
      columnVisibility,
      pagination: page
        ? { pageIndex: page.index, pageSize: page.size }
        : { pageIndex: 0, pageSize: Math.max(1, data.length) },
    },
    onSortingChange: (updater) =>
      onSortingChange(typeof updater === "function" ? updater(sorting) : updater),
    enableSortingRemoval: false,
    enableMultiSort: true,
    isMultiSortEvent: (e: unknown) => (e as MouseEvent).shiftKey,
  });

  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;

  const stickyCls = "sticky left-0 z-10 bg-background group-hover:bg-surface-hover";

  return (
    <div className={cn("relative overflow-auto rounded-md border", className)}>
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="sticky top-0 z-20 bg-surface">
          {headerGroups.map((hg, depth) => (
            <tr key={hg.id} className="border-b">
              {rank ? (
                depth === headerGroups.length - 1 ? (
                  <th
                    scope="col"
                    className="h-7 w-8 px-2 text-right text-xs font-medium tracking-[0.02em] text-muted-foreground uppercase"
                  >
                    #
                  </th>
                ) : (
                  <th className="w-8" />
                )
              ) : null}
              {hg.headers.map((header) => {
                const meta = header.column.columnDef.meta as StatColumn<T> | undefined;
                const isLeaf = !header.subHeaders?.length;
                const isFirst = meta?.id === firstId && stickyFirst;
                const right = meta
                  ? (meta.align ?? (meta.numeric ? "right" : "left")) === "right"
                  : false;
                if (!isLeaf || header.isPlaceholder) {
                  // group header row
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      scope="colgroup"
                      className={cn(
                        "h-6 border-l px-2 text-center text-xs font-medium tracking-[0.02em] text-muted-foreground uppercase first:border-l-0",
                        header.isPlaceholder && "border-l-0",
                        isFirst && stickyCls,
                      )}
                    >
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                    </th>
                  );
                }
                const sorted = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={canSort ? ariaSort(sorted) : undefined}
                    title={meta?.title}
                    style={meta?.width ? { width: meta.width, minWidth: meta.width } : undefined}
                    className={cn(
                      "h-7 px-2 text-xs font-medium tracking-[0.02em] whitespace-nowrap text-muted-foreground uppercase",
                      right ? "text-right" : "text-left",
                      isFirst && stickyCls,
                      isFirst && "bg-surface",
                    )}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "inline-flex items-center gap-0.5 uppercase hover:text-foreground",
                          right && "flex-row-reverse",
                          sorted && "text-foreground",
                        )}
                      >
                        {meta?.header}
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3" aria-hidden />
                        ) : (
                          <span className="inline-block size-3" aria-hidden />
                        )}
                      </button>
                    ) : (
                      meta?.header
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id}
              className="group h-[var(--row-h)] border-b last:border-b-0 hover:bg-surface-hover"
            >
              {rank ? (
                <td className="px-2 text-right font-mono text-muted-foreground">
                  {(page ? page.index * page.size : 0) + i + 1}
                </td>
              ) : null}
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta as StatColumn<T>;
                const right = (meta.align ?? (meta.numeric ? "right" : "left")) === "right";
                const value = cell.getValue() as number | string | undefined;
                const content = meta.cell
                  ? meta.cell(row.original)
                  : meta.format
                    ? meta.format(value, row.original)
                    : (value ?? DASH);
                const isFirst = meta.id === firstId && stickyFirst;
                const tint = percentiles?.get(meta.id)?.(value);
                return (
                  <td
                    key={cell.id}
                    style={tint ? { background: tint } : undefined}
                    className={cn(
                      "px-2 py-1 whitespace-nowrap",
                      right ? "text-right" : "text-left",
                      meta.numeric && "font-mono",
                      value === undefined && "text-muted-foreground",
                      isFirst && stickyCls,
                    )}
                  >
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={table.getVisibleLeafColumns().length + (rank ? 1 : 0)}
                className="px-2 py-6 text-center text-muted-foreground"
              >
                No rows
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Per-column percentile -> background tint. Diverging scale (negative .. neutral ..
 * positive), max 18% opacity so text stays readable; reversed for lowerIsBetter.
 */
export function percentileFns<T extends RowData>(
  columns: StatColumn<T>[],
  data: T[],
  hidden: string[],
): Map<string, (v: unknown) => string | undefined> {
  const out = new Map<string, (v: unknown) => string | undefined>();
  for (const c of columns) {
    if (!c.numeric || c.noShade || hidden.includes(c.id)) continue;
    const vals = data
      .map((r) => c.value(r))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (vals.length < 5) continue;
    out.set(c.id, (v) => {
      if (typeof v !== "number") return undefined;
      // fraction of values strictly below v (binary search)
      let lo = 0;
      let hi = vals.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (vals[mid] < v) lo = mid + 1;
        else hi = mid;
      }
      let p = lo / (vals.length - 1 || 1);
      if (c.lowerIsBetter) p = 1 - p;
      const d = p - 0.5;
      if (Math.abs(d) < 0.1) return undefined;
      const alpha = Math.min(18, Math.round(Math.abs(d) * 36));
      const color = d > 0 ? "var(--chart-good)" : "var(--chart-bad)";
      return `color-mix(in srgb, ${color} ${alpha}%, transparent)`;
    });
  }
  return out;
}

/** Rows -> delimited text (raw values, visible columns), for copy/CSV export. */
export function toDelimited<T extends RowData>(
  columns: StatColumn<T>[],
  rows: T[],
  hidden: string[],
  sep: "," | "\t",
): string {
  const cols = columns.filter((c) => !hidden.includes(c.id));
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return sep === "," && /[",\n]/.test(s)
      ? `"${s.replace(/"/g, '""')}"`
      : s.replace(/[\t\n]/g, " ");
  };
  const header = cols.map((c) => esc(c.group ? `${c.group} ${c.header}` : c.header)).join(sep);
  return [header, ...rows.map((r) => cols.map((c) => esc(c.value(r))).join(sep))].join("\n");
}

/** Sort rows like the table does (multi-sort, nulls last) — for exports. */
export function sortLike<T extends RowData>(
  rows: T[],
  columns: StatColumn<T>[],
  sorting: SortingState,
): T[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  return [...rows].sort((a, b) => {
    for (const s of sorting) {
      const c = byId.get(s.id);
      if (!c) continue;
      const x = c.value(a);
      const y = c.value(b);
      if (x === y) continue;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const cmp =
        typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      if (cmp) return s.desc ? -cmp : cmp;
    }
    return 0;
  });
}
