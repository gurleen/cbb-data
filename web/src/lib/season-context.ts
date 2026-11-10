// Sport/season resolution shared by the shell and routes.
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { seasonsQuery } from "./api";
import { type SeasonEntry, SPORTS, type Sport } from "./api-types";

export const DEFAULT_SPORT: Sport = "mbb";

export function isSport(v: unknown): v is Sport {
  return typeof v === "string" && (SPORTS as readonly string[]).includes(v);
}

export const SPORT_LABEL: Record<Sport, string> = { mbb: "MBB", wbb: "WBB" };
export const SPORT_NAME: Record<Sport, string> = {
  mbb: "Men's basketball",
  wbb: "Women's basketball",
};

/** Sport + season from the URL (either may be absent, e.g. on /about). */
export function useSportSeason(): { sport: Sport; season: number | null } {
  const params = useParams({ strict: false }) as { sport?: string; season?: string };
  const sport = isSport(params.sport) ? params.sport : DEFAULT_SPORT;
  const season = params.season && /^\d{4}$/.test(params.season) ? Number(params.season) : null;
  return { sport, season };
}

/** The seasons doc for a sport (prefetched by the root loader, so this is synchronous). */
export function useSeasons(sport: Sport) {
  return useQuery(seasonsQuery(sport)).data;
}

export function findSeason(
  seasons: SeasonEntry[] | undefined,
  season: number | null,
): SeasonEntry | undefined {
  return season === null ? undefined : seasons?.find((s) => s.season === season);
}
