import type { Context } from "hono";
import { Hono } from "hono";
import type { AppEnv } from "./env";
import {
  cacheControl,
  decodeJson,
  type Entry,
  etagMatches,
  jsonError,
  loadEntry,
  notModified,
  respondWithEntry,
} from "./http";
import { currentSeason, isSeason, isSport } from "./seasons";
import { MAX_LIMIT, parseLimit, parseSort, type Row, sortRows } from "./teamStats";

export const v1 = new Hono<AppEnv>();

const KEYS = {
  seasons: (sport: string) => `v1/${sport}/seasons.json`,
  teams: (sport: string, season: string) => `v1/${sport}/${season}/teams.json`,
  team: (sport: string, season: string, id: string) => `v1/${sport}/${season}/teams/${id}.json`,
  teamStats: (sport: string, season: string) => `v1/${sport}/${season}/team-stats.json`,
};

function ttlFor(season: string | null): "current" | "past" {
  return season !== null && Number(season) < currentSeason() ? "past" : "current";
}

/** Validates :sport (and :season if present); returns an error response or null. */
function checkParams(c: Context<AppEnv>): Response | null {
  const { sport, season } = c.req.param() as { sport: string; season?: string };
  if (!isSport(sport)) return jsonError(c, 400, `unknown sport '${sport}' (use mbb or wbb)`);
  if (season !== undefined && !isSeason(season))
    return jsonError(c, 400, `season must be a 4-digit year (the season's ending year)`);
  return null;
}

async function serve(c: Context<AppEnv>, key: string, season: string | null, what: string) {
  const ttl = ttlFor(season);
  const res = await loadEntry(c, key, ttl, c.req.header("If-None-Match"));
  if (res === null) return jsonError(c, 404, `${what} not found`);
  if (res === "not-modified") return notModified(c, ttl);
  return respondWithEntry(c, res, ttl);
}

v1.get("/:sport/seasons", async (c) => {
  const bad = checkParams(c);
  if (bad) return bad;
  return serve(c, KEYS.seasons(c.req.param("sport")), null, "seasons");
});

v1.get("/:sport/:season/teams", async (c) => {
  const bad = checkParams(c);
  if (bad) return bad;
  const { sport, season } = c.req.param();
  return serve(c, KEYS.teams(sport, season), season, `season ${season}`);
});

v1.get("/:sport/:season/teams/:teamId", async (c) => {
  const bad = checkParams(c);
  if (bad) return bad;
  const { sport, season, teamId } = c.req.param();
  if (!/^\d{1,10}$/.test(teamId)) return jsonError(c, 400, "teamId must be numeric");
  return serve(c, KEYS.team(sport, season, teamId), season, `team ${teamId} in ${season}`);
});

// -- simple passthrough routes (precomputed objects) ----------------------------------------
const ID = /^\d{1,12}$/;

/** Season-scoped object: `v1/{sport}/{season}/{suffix}`; `:id` params must be numeric. */
function seasonObject(path: string, suffix: (p: Record<string, string>) => string, what: string) {
  v1.get(path, async (c) => {
    const bad = checkParams(c);
    if (bad) return bad;
    const p = c.req.param() as Record<string, string>;
    for (const [k, v] of Object.entries(p)) {
      if (k.endsWith("Id") && !ID.test(v)) return jsonError(c, 400, `${k} must be numeric`);
    }
    return serve(c, `v1/${p.sport}/${p.season}/${suffix(p)}`, p.season, what);
  });
}

seasonObject("/:sport/:season/conferences", () => "conferences.json", "conferences");
seasonObject(
  "/:sport/:season/conferences/:conferenceId",
  (p) => `conferences/${p.conferenceId}.json`,
  "conference",
);
seasonObject(
  "/:sport/:season/teams/:teamId/games",
  (p) => `teams/${p.teamId}/games.json`,
  "team games",
);
seasonObject("/:sport/:season/players", () => "players.json", "players");
seasonObject("/:sport/:season/players-all", () => "players-all.json", "players");
seasonObject("/:sport/:season/players/:playerId", (p) => `players/${p.playerId}.json`, "player");
seasonObject("/:sport/:season/search", () => "search.json", "search index");

// Season-independent player career.
v1.get("/:sport/players/:playerId", async (c) => {
  const bad = checkParams(c);
  if (bad) return bad;
  const { sport, playerId } = c.req.param();
  if (!ID.test(playerId)) return jsonError(c, 400, "playerId must be numeric");
  return serve(c, `v1/${sport}/players/${playerId}.json`, null, `player ${playerId}`);
});

v1.get("/:sport/:season/team-stats", async (c) => {
  const bad = checkParams(c);
  if (bad) return bad;
  const { sport, season } = c.req.param();
  const sort = parseSort(c.req.query("sort"));
  const limit = parseLimit(c.req.query("limit"));
  if (sort === "invalid") return jsonError(c, 400, "sort must look like 'net_rtg' or '-net_rtg'");
  if (limit === "invalid") return jsonError(c, 400, `limit must be an integer 1-${MAX_LIMIT}`);

  // No query: pass the precomputed object straight through.
  if (sort === null && limit === null) {
    return serve(c, KEYS.teamStats(sport, season), season, `season ${season}`);
  }

  const ttl = ttlFor(season);
  const variant = `${sort ? `${sort.desc ? "-" : ""}${sort.field}` : ""}:${limit ?? ""}`;
  const clientEtag = c.req.header("If-None-Match");
  // Don't forward If-None-Match: it refers to the derived (weak) ETag, not the R2 one.
  const entry = await loadEntry(c, KEYS.teamStats(sport, season), ttl, undefined);
  if (entry === null) return jsonError(c, 404, `season ${season} not found`);
  if (entry === "not-modified") throw new Error("unreachable");
  const etag = `W/"${stripQuotes(entry.etag)}-${variant}"`;
  if (etagMatches(clientEtag, etag)) {
    c.header("ETag", etag);
    return notModified(c, ttl);
  }

  const doc = await decodeJson<{ rows: Row[]; [k: string]: unknown }>(entry as Entry);
  let rows = doc.rows;
  if (sort) {
    if (rows.length > 0 && !(sort.field in rows[0])) {
      return jsonError(
        c,
        400,
        `unknown sort field '${sort.field}'; one of: ${Object.keys(rows[0]).join(", ")}`,
      );
    }
    rows = sortRows(rows, sort);
  }
  if (limit !== null) rows = rows.slice(0, limit);
  return c.json({ ...doc, count: rows.length, total: doc.rows.length, rows }, 200, {
    "Cache-Control": cacheControl(ttl),
    ETag: etag,
    "Last-Modified": entry.lastModified,
    Vary: "Accept-Encoding",
    "X-Cache": entry.cacheStatus,
  });
});

/*
 * Future (MotherDuck-backed; not implemented in v1):
 *
 * v1.get("/:sport/query", async (c) => {
 *   // Parameterised, allow-listed queries only (never raw SQL from the client), run
 *   // through a QuerySource (see datasource.ts) against the cbb.{sport}.* views.
 *   // Needs a MOTHERDUCK_TOKEN secret, short timeouts, and its own rate limit.
 *   return jsonError(c, 404, "not implemented");
 * });
 */

function stripQuotes(etag: string): string {
  return etag.replace(/^W\//, "").replace(/^"|"$/g, "");
}
