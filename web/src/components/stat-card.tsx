import type { ReactNode } from "react";
import { fmtOrdinal } from "@/lib/format";

/** Value + D-I rank + percentile bar (spec §6.5). Rank 1 = best. */
export function RatingCard({
  label,
  value,
  rank,
  field,
  title,
  neutral = false,
}: {
  label: string;
  value: ReactNode;
  rank?: number | null;
  field?: number | null;
  title?: string;
  /** For stats with no "good" direction (pace): muted bar instead of green/red. */
  neutral?: boolean;
}) {
  const pct = rank && field && field > 1 ? 1 - (rank - 1) / (field - 1) : null;
  return (
    <div className="rounded-md border bg-surface px-3 py-2" title={title}>
      <div className="text-xs tracking-[0.02em] text-muted-foreground uppercase">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xl">{value}</span>
        {rank ? (
          <span className="font-mono text-xs text-muted-foreground">
            {fmtOrdinal(rank)}
            {field ? <span className="opacity-70"> / {field}</span> : null}
          </span>
        ) : null}
      </div>
      {pct !== null ? (
        <div className="mt-1.5 h-1 rounded-full bg-border" aria-hidden>
          <div
            className="h-1 rounded-full"
            style={{
              width: `${Math.max(2, pct * 100)}%`,
              background: neutral
                ? "var(--muted-foreground)"
                : pct >= 0.5
                  ? "var(--chart-good)"
                  : "var(--chart-bad)",
              opacity: neutral ? 0.6 : 0.35 + Math.abs(pct - 0.5) * 1.3,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
