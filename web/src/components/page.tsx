import type { ReactNode } from "react";

/** Standard page header: title + optional subtitle and right-side actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? (
        // Wraps on narrow screens (full-width row under the title on phones).
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** Placeholder body for pages that land in a later phase (spec §11). */
export function ComingSoon({ phase, children }: { phase: number; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      {children ?? "This page is coming soon."}{" "}
      <span className="font-mono text-xs">(phase {phase})</span>
    </div>
  );
}

/** Compact label/value pair for summary strips. */
export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-24">
      <div className="text-xs tracking-[0.02em] text-muted-foreground uppercase">{label}</div>
      <div className="font-mono text-lg">{value}</div>
    </div>
  );
}
