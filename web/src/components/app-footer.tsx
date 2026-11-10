import { Link } from "@tanstack/react-router";
import { fmtDate } from "@/lib/format";
import { findSeason, useSeasons, useSportSeason } from "@/lib/season-context";

export function AppFooter() {
  const { sport, season } = useSportSeason();
  const seasons = useSeasons(sport);
  const entry = findSeason(seasons?.seasons, season ?? seasons?.current_season ?? null);
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-xs text-muted-foreground lg:px-6">
        <span>
          Data: ESPN via{" "}
          <a href="https://github.com/sportsdataverse/sportsdataverse-data" rel="noreferrer">
            sportsdataverse
          </a>
        </span>
        {entry ? <span>· Updated {fmtDate(entry.updated_at)}</span> : null}
        <span className="ml-auto flex gap-3">
          <Link to="/about">About</Link>
          <Link to="/methodology">Methodology</Link>
        </span>
      </div>
    </footer>
  );
}
