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
  teamRanks: (sport: string, season: string) => `v1/${sport}/${season}/ranks/teams.json`,
  player: (sport: string, season: string, id: string) => `v1/${sport}/${season}/players/${id}.json`,
  playerRanks: (sport: string, season: string) => `v1/${sport}/${season}/ranks/players.json`,
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

// -- rank merging -------------------------------------------------------------------------
// D-I ranks shift for every team/player whenever anyone plays, so the ETL keeps them in one
// per-season document (ranks/teams.json, ranks/players.json) instead of inside each page;
// otherwise every page would be rewritten to R2 daily. These routes merge them back so the
// response shape is unchanged. Seasons published before the split have no ranks document
// (their pages still embed ranks) and are served as-is.

interface RanksDoc {
  field: number;
  ranks: Record<string, Record<string, number>>;
}

const parsedRanks = new Map<string, RanksDoc>(); // etag -> parsed doc (per isolate)

async function ranksFor(entry: Entry): Promise<RanksDoc> {
  const hit = parsedRanks.get(entry.etag);
  if (hit) return hit;
  const doc = await decodeJson<RanksDoc>(entry);
  if (parsedRanks.size >= 8) parsedRanks.delete(parsedRanks.keys().next().value as string);
  parsedRanks.set(entry.etag, doc);
  return doc;
}

async function serveWithRanks(
  c: Context<AppEnv>,
  docKey: string,
  ranksKey: string,
  id: string,
  season: string,
  fieldName: "rank_field" | "field",
  what: string,
) {
  const ttl = ttlFor(season);
  const [doc, ranks] = await Promise.all([
    loadEntry(c, docKey, ttl, undefined),
    loadEntry(c, ranksKey, ttl, undefined),
  ]);
  if (doc === null) return jsonError(c, 404, `${what} not found`);
  if (doc === "not-modified" || ranks === "not-modified") throw new Error("unreachable");
  if (ranks === null) {
    if (etagMatches(c.req.header("If-None-Match"), doc.etag)) {
      c.header("ETag", doc.etag);
      return notModified(c, ttl);
    }
    return respondWithEntry(c, doc, ttl);
  }

  const etag = `W/"${stripQuotes(doc.etag)}.${stripQuotes(ranks.etag)}"`;
  if (etagMatches(c.req.header("If-None-Match"), etag)) {
    c.header("ETag", etag);
    return notModified(c, ttl);
  }
  const [body, rk] = await Promise.all([decodeJson<Record<string, unknown>>(doc), ranksFor(ranks)]);
  const newer = Date.parse(doc.lastModified) >= Date.parse(ranks.lastModified) ? doc : ranks;
  return c.json({ ...body, ranks: rk.ranks[id] ?? {}, [fieldName]: rk.field }, 200, {
    "Cache-Control": cacheControl(ttl),
    ETag: etag,
    "Last-Modified": newer.lastModified,
    Vary: "Accept-Encoding",
    "X-Cache": doc.cacheStatus === "HIT" && ranks.cacheStatus === "HIT" ? "HIT" : "MISS",
  });
}

v1.get("/:sport/:season/teams/:teamId", async (c) => {
  const bad = checkParams(c);
  if (bad) return bad;
  const { sport, season, teamId } = c.req.param();
  if (!/^\d{1,10}$/.test(teamId)) return jsonError(c, 400, "teamId must be numeric");
  return serveWithRanks(
    c,
    KEYS.team(sport, season, teamId),
    KEYS.teamRanks(sport, season),
    teamId,
    season,
    "rank_field",
    `team ${teamId} in ${season}`,
  );
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
v1.get("/:sport/:season/players/:playerId", async (c) => {
  const bad = checkParams(c);
  if (bad) return bad;
  const { sport, season, playerId } = c.req.param();
  if (!ID.test(playerId)) return jsonError(c, 400, "playerId must be numeric");
  return serveWithRanks(
    c,
    KEYS.player(sport, season, playerId),
    KEYS.playerRanks(sport, season),
    playerId,
    season,
    "field",
    "player",
  );
});
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
