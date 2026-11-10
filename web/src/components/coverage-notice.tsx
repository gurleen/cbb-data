import { Info } from "lucide-react";
import { fmtPct } from "@/lib/format";

/** Spec §7.3: shown when box scores cover < 95% of games. */
export function CoverageNotice({ coverage }: { coverage: number | null | undefined }) {
  if (coverage === null || coverage === undefined || coverage >= 0.95) return null;
  return (
    <div className="mb-3 flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p>
        Box scores cover <span className="font-mono text-foreground">{fmtPct(coverage)}%</span> of
        games this season; per-game stats and ratings are based on those games only.
      </p>
    </div>
  );
}

export function LimitedBadge() {
  return (
    <span
      className="ml-1 rounded-sm border px-1 font-sans text-[10px] text-muted-foreground uppercase"
      title="Fewer than 5 box-score games"
    >
      limited
    </span>
  );
}
