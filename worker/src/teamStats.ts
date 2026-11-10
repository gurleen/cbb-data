export type Row = Record<string, string | number | boolean | null>;

export interface SortSpec {
  field: string;
  desc: boolean;
}

export const MAX_LIMIT = 1000;

/** `?sort=-net_rtg` (desc) or `?sort=ppg` (asc). */
export function parseSort(raw: string | undefined): SortSpec | null | "invalid" {
  if (raw === undefined || raw === "") return null;
  const desc = raw.startsWith("-");
  const field = desc ? raw.slice(1) : raw;
  if (!/^[a-z0-9_]{1,40}$/.test(field)) return "invalid";
  return { field, desc };
}

export function parseLimit(raw: string | undefined): number | null | "invalid" {
  if (raw === undefined || raw === "") return null;
  if (!/^\d{1,4}$/.test(raw)) return "invalid";
  const n = Number(raw);
  return n >= 1 && n <= MAX_LIMIT ? n : "invalid";
}

/** Stable sort; nulls always last; numbers numerically, everything else as strings. */
export function sortRows(rows: Row[], spec: SortSpec): Row[] {
  const dir = spec.desc ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const x = a.row[spec.field];
      const y = b.row[spec.field];
      if (x === null || x === undefined) return y === null || y === undefined ? a.i - b.i : 1;
      if (y === null || y === undefined) return -1;
      const cmp =
        typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return cmp === 0 ? a.i - b.i : cmp * dir;
    })
    .map(({ row }) => row);
}
