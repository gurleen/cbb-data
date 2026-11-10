import { queryOptions } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import type {
  CareerDoc,
  ConferenceDoc,
  ConferencesDoc,
  PlayerDoc,
  PlayerRow,
  PlayersDocRaw,
  SearchDoc,
  SeasonsDoc,
  Sport,
  TeamDoc,
  TeamDocFull,
  TeamGamesDoc,
  TeamStatsDoc,
  TeamsDoc,
} from "./api-types";

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
    // Defaults keep older objects (built before ranks/rosters existed) renderable.
    queryFn: async () => {
      const doc = await apiGet<Partial<TeamDocFull> & TeamDoc>(
        `/v1/${sport}/${season}/teams/${teamId}`,
      );
      return {
        ...doc,
        ranks: doc.ranks ?? {},
        rank_field: doc.rank_field ?? 0,
        roster: doc.roster ?? [],
      };
    },
    staleTime: staleFor(season, current),
  });

export const teamStatsQuery = (sport: Sport, season: number, current: number) =>
  queryOptions({
    queryKey: ["team-stats", sport, season],
    queryFn: () => apiGet<TeamStatsDoc>(`/v1/${sport}/${season}/team-stats`),
    staleTime: staleFor(season, current),
  });

export const teamGamesQuery = (sport: Sport, season: number, teamId: number, current: number) =>
  queryOptions({
    queryKey: ["team-games", sport, season, teamId],
    queryFn: () => apiGet<TeamGamesDoc>(`/v1/${sport}/${season}/teams/${teamId}/games`),
    staleTime: staleFor(season, current),
  });

export const conferencesQuery = (sport: Sport, season: number, current: number) =>
  queryOptions({
    queryKey: ["conferences", sport, season],
    queryFn: () => apiGet<ConferencesDoc>(`/v1/${sport}/${season}/conferences`),
    staleTime: staleFor(season, current),
  });

export const conferenceQuery = (sport: Sport, season: number, id: number, current: number) =>
  queryOptions({
    queryKey: ["conference", sport, season, id],
    queryFn: () => apiGet<ConferenceDoc>(`/v1/${sport}/${season}/conferences/${id}`),
    staleTime: staleFor(season, current),
  });

export interface PlayersDoc extends Omit<PlayersDocRaw, "columns" | "data"> {
  rows: PlayerRow[];
}

/** Expand the columnar leaderboard into row objects. */
export function expandPlayers(raw: PlayersDocRaw): PlayersDoc {
  const { columns, data, ...rest } = raw;
  const rows = data.map((r) => {
    const o: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) o[columns[i]] = r[i];
    return o as unknown as PlayerRow;
  });
  return { ...rest, rows };
}

export const playersQuery = (sport: Sport, season: number, current: number, all = false) =>
  queryOptions({
    queryKey: ["players", sport, season, all],
    queryFn: async () =>
      expandPlayers(
        await apiGet<PlayersDocRaw>(`/v1/${sport}/${season}/${all ? "players-all" : "players"}`),
      ),
    staleTime: staleFor(season, current),
  });

export const playerQuery = (sport: Sport, season: number, id: number, current: number) =>
  queryOptions({
    queryKey: ["player", sport, season, id],
    queryFn: () => apiGet<PlayerDoc>(`/v1/${sport}/${season}/players/${id}`),
    staleTime: staleFor(season, current),
  });

export const careerQuery = (sport: Sport, id: number) =>
  queryOptions({
    queryKey: ["career", sport, id],
    queryFn: () => apiGet<CareerDoc>(`/v1/${sport}/players/${id}`),
    staleTime: CURRENT_STALE,
  });

export const searchQuery = (sport: Sport, season: number, current: number) =>
  queryOptions({
    queryKey: ["search", sport, season],
    queryFn: () => apiGet<SearchDoc>(`/v1/${sport}/${season}/search`),
    staleTime: staleFor(season, current),
  });

/** Resolve "41-uconn-huskies" -> 41 (null if no leading id). */
export function parseEntityKey(key: string): number | null {
  const m = /^(\d{1,12})(?:-|$)/.exec(key);
  return m ? Number(m[1]) : null;
}

export function entityKey(id: number, slug: string | null | undefined): string {
  return slug ? `${id}-${slug}` : String(id);
}
