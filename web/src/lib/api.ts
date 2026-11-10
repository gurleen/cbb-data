import { queryOptions } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import type { SeasonsDoc, Sport, TeamDoc, TeamStatsDoc, TeamsDoc } from "./api-types";

/** Public API origin (browser requests, and SSR in dev). */
export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "https://cbb-api.gurleens1628.workers.dev";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
  ) {
    super(`API ${status} for ${path}`);
  }
}

/**
 * Fetch an API path.
 * - Browser: straight to the public API (CDN-cached, gzip).
 * - Server (production): through the `API` service binding. A Worker can't fetch
 *   another Worker's workers.dev URL on the same account (error 1042), and the
 *   binding skips the public network hop anyway.
 * - Server (dev): the public URL, since the binding's target isn't running locally.
 */
const rawFetch = createIsomorphicFn()
  .server(async (path: string): Promise<Response> => {
    if (import.meta.env.PROD) {
      const { env } = await import("cloudflare:workers");
      const binding = (env as { API?: Fetcher }).API;
      if (binding) return binding.fetch(`https://cbb-api.internal${path}`);
    }
    return fetch(`${API_URL}${path}`);
  })
  .client((path: string) => fetch(`${API_URL}${path}`));

export async function apiGet<T>(path: string): Promise<T> {
  const res = await rawFetch(path);
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as T;
}

// -- query options (shared by loaders and components) -------------------------------------
// Data changes at most daily (current season) or never (past seasons).
const CURRENT_STALE = 10 * 60_000;
const PAST_STALE = 24 * 60 * 60_000;

export const seasonsQuery = (sport: Sport) =>
  queryOptions({
    queryKey: ["seasons", sport],
    queryFn: () => apiGet<SeasonsDoc>(`/v1/${sport}/seasons`),
    staleTime: CURRENT_STALE,
  });

const staleFor = (season: number, current: number) =>
  season < current ? PAST_STALE : CURRENT_STALE;

export const teamsQuery = (sport: Sport, season: number, current: number) =>
  queryOptions({
    queryKey: ["teams", sport, season],
    queryFn: () => apiGet<TeamsDoc>(`/v1/${sport}/${season}/teams`),
    staleTime: staleFor(season, current),
  });

export const teamQuery = (sport: Sport, season: number, teamId: number, current: number) =>
  queryOptions({
    queryKey: ["team", sport, season, teamId],
    queryFn: () => apiGet<TeamDoc>(`/v1/${sport}/${season}/teams/${teamId}`),
    staleTime: staleFor(season, current),
  });

export const teamStatsQuery = (sport: Sport, season: number, current: number) =>
  queryOptions({
    queryKey: ["team-stats", sport, season],
    queryFn: () => apiGet<TeamStatsDoc>(`/v1/${sport}/${season}/team-stats`),
    staleTime: staleFor(season, current),
  });
