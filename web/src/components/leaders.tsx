import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { entityKey } from "@/lib/api";
import type { Sport } from "@/lib/api-types";
import { TeamLogo } from "./team";

export interface LeaderItem {
  key: string;
  label: ReactNode;
  logo?: string | null;
  to: { kind: "team" | "player"; id: number; slug?: string | null };
  value: string;
}

/** Compact top-N card (spec §6.1 stat leaders). */
export function LeaderCard({
  title,
  items,
  sport,
  season,
}: {
  title: string;
  items: LeaderItem[];
  sport: Sport;
  season: number;
}) {
  return (
    <div className="rounded-md border">
      <div className="border-b bg-surface px-2 py-1 text-xs tracking-[0.02em] text-muted-foreground uppercase">
        {title}
      </div>
      <ol className="text-sm">
        {items.map((it, i) => (
          <li
            key={it.key}
            className="flex h-[var(--row-h)] items-center gap-2 border-b px-2 last:border-b-0"
          >
            <span className="w-3 font-mono text-xs text-muted-foreground">{i + 1}</span>
            <TeamLogo src={it.logo} />
            {it.to.kind === "team" ? (
              <Link
                to="/$sport/$season/teams/$teamKey"
                params={{ sport, season: String(season), teamKey: entityKey(it.to.id, it.to.slug) }}
                className="truncate text-foreground hover:text-primary hover:no-underline"
              >
                {it.label}
              </Link>
            ) : (
              <Link
                to="/$sport/$season/players/$playerKey"
                params={{
                  sport,
                  season: String(season),
                  playerKey: entityKey(it.to.id, it.to.slug),
                }}
                className="truncate text-foreground hover:text-primary hover:no-underline"
              >
                {it.label}
              </Link>
            )}
            <span className="ml-auto font-mono">{it.value}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Horizontal bar list (conference strength). Values may be negative. */
export function BarList({
  items,
}: {
  items: { key: string; label: ReactNode; value: number | null; display: string }[];
}) {
  const vals = items.map((i) => i.value ?? 0);
  const max = Math.max(1, ...vals.map(Math.abs));
  return (
    <ol className="rounded-md border text-sm">
      {items.map((it, i) => {
        const v = it.value ?? 0;
        const w = (Math.abs(v) / max) * 50;
        return (
          <li
            key={it.key}
            className="grid h-[var(--row-h)] grid-cols-[1.5rem_9rem_1fr_3.5rem] items-center gap-2 border-b px-2 last:border-b-0"
          >
            <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
            <span className="truncate">{it.label}</span>
            <span className="relative h-2" aria-hidden>
              <span className="absolute top-0 left-1/2 h-2 w-px bg-border" />
              <span
                className="absolute top-0 h-2 rounded-sm"
                style={{
                  left: v >= 0 ? "50%" : `${50 - w}%`,
                  width: `${w}%`,
                  background: v >= 0 ? "var(--chart-good)" : "var(--chart-bad)",
                  opacity: 0.7,
                }}
              />
            </span>
            <span className="text-right font-mono">{it.display}</span>
          </li>
        );
      })}
    </ol>
  );
}
