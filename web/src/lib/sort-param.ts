// URL <-> TanStack Table sorting. "-net_rtg,ppg" = net_rtg desc, then ppg asc.
import type { SortingState } from "@tanstack/react-table";

export function parseSortParam(param: string | undefined, fallback: SortingState): SortingState {
  if (!param) return fallback;
  const out: SortingState = [];
  for (const part of param.split(",")) {
    const desc = part.startsWith("-");
    const id = desc ? part.slice(1) : part;
    if (/^[a-z0-9_]{1,40}$/.test(id)) out.push({ id, desc });
  }
  return out.length ? out : fallback;
}

export function sortParam(sorting: SortingState): string {
  return sorting.map((s) => `${s.desc ? "-" : ""}${s.id}`).join(",");
}
