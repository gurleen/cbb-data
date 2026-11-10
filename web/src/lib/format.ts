// Number formatting rules: docs/frontend-spec.md §3.4. Every displayed stat goes through
// here so precision stays consistent across the site.

export const DASH = "—";

type N = number | null | undefined;

const isNum = (v: N): v is number => typeof v === "number" && Number.isFinite(v);

/** Per-game values, ratings, pace: 1 decimal. */
export function fmt1(v: N): string {
  return isNum(v) ? v.toFixed(1) : DASH;
}

/** Integer counts (games, totals). */
export function fmtInt(v: N): string {
  return isNum(v) ? Math.round(v).toLocaleString("en-US") : DASH;
}

/** Percentages stored as 0-1 fractions, shown as 47.2 (the % sign lives in the header). */
export function fmtPct(v: N): string {
  return isNum(v) ? (v * 100).toFixed(1) : DASH;
}

/** Win %: 3 decimals, no leading zero (.850, 1.000). */
export function fmtWinPct(v: N): string {
  if (!isNum(v)) return DASH;
  const s = v.toFixed(3);
  return s.startsWith("0") ? s.slice(1) : s;
}

/** Signed 1-decimal value for net ratings (+17.2, -3.4, 0.0). */
export function fmtSigned(v: N): string {
  if (!isNum(v)) return DASH;
  const s = v.toFixed(1);
  if (s === "0.0" || s === "-0.0") return "0.0";
  return v > 0 ? `+${s}` : s;
}

/** W-L record. */
export function fmtRecord(wins: N, losses: N): string {
  return isNum(wins) && isNum(losses) ? `${wins}-${losses}` : DASH;
}

/** Ordinal rank: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 112th. */
export function fmtOrdinal(n: N): string {
  if (!isNum(n)) return DASH;
  const i = Math.trunc(n);
  const mod100 = i % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[i % 10] ?? "th");
  return `${i}${suffix}`;
}

/** Made-attempted pair (per-game or total): 27.8-58.9 or 1,112-2,354. */
export function fmtMadeAtt(made: N, att: N, perGame: boolean): string {
  if (!isNum(made) || !isNum(att)) return DASH;
  return perGame ? `${made.toFixed(1)}-${att.toFixed(1)}` : `${fmtInt(made)}-${fmtInt(att)}`;
}

/** "2025-26" from an ending-year season. */
export function seasonLabel(season: number): string {
  return `${season - 1}-${String(season % 100).padStart(2, "0")}`;
}

/** "Nov 10, 2026" from an ISO timestamp (UTC, so SSR and client agree). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Game date in US Eastern time ("Nov 4"); fixed zone so SSR and client agree. */
export function fmtGameDate(iso: string | null | undefined, withYear = false): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "America/New_York",
  });
}
