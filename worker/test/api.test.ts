import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { acceptsGzip, etagMatches } from "../src/http";
import { currentSeason } from "../src/seasons";
import { parseLimit, parseSort, sortRows } from "../src/teamStats";

const CUR = currentSeason();
const PAST = 2026 < CUR ? 2026 : CUR - 1;

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function put(key: string, obj: unknown) {
  await env.DATA.put(key, await gzip(JSON.stringify(obj)), {
    httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
  });
}

const rows = [
  { team_id: 1, name: "Alpha", ppg: 70.1, net_rtg: 5.5, conference: "TC" },
  { team_id: 2, name: "Beta", ppg: 80.2, net_rtg: 12.0, conference: "TC" },
  { team_id: 3, name: "Gamma", ppg: 65.0, net_rtg: null, conference: null },
];

beforeEach(async () => {
  await put("v1/mbb/seasons.json", { sport: "mbb", current_season: CUR, seasons: [] });
  for (const season of [PAST, CUR]) {
    await put(`v1/mbb/${season}/teams.json`, { season, count: 1, teams: [{ id: 1 }] });
    await put(`v1/mbb/${season}/teams/1.json`, { season, team: { id: 1, name: "Alpha" } });
    await put(`v1/mbb/${season}/team-stats.json`, { season, count: rows.length, rows });
  }
});

function get(path: string, headers: Record<string, string> = {}) {
  return exports.default.fetch(new Request(`https://api.test${path}`, { headers }));
}

describe("routing and validation", () => {
  it("health", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it.each([
    ["/v1/nba/seasons", "unknown sport"],
    ["/v1/mbb/26/teams", "4-digit"],
    ["/v1/mbb/2026x/teams", "4-digit"],
    ["/v1/mbb/2026/teams/abc", "numeric"],
    ["/v1/mbb/2026/team-stats?limit=0", "limit"],
    ["/v1/mbb/2026/team-stats?limit=abc", "limit"],
    ["/v1/mbb/2026/team-stats?sort=DROP%20TABLE", "sort"],
  ])("400 for %s", async (path, msg) => {
    const res = await get(path);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain(msg);
  });

  it("404 JSON for missing objects and routes", async () => {
    for (const path of [
      "/v1/wbb/seasons",
      "/v1/mbb/1999/teams",
      "/v1/mbb/2026/teams/999",
      "/nope",
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      expect(((await res.json()) as { error: { status: number } }).error.status).toBe(404);
    }
  });
});

describe("serving precomputed objects", () => {
  it("decompresses when the client does not accept gzip", async () => {
    const res = await get(`/v1/mbb/${PAST}/teams/1`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(await res.json()).toEqual({ season: PAST, team: { id: 1, name: "Alpha" } });
  });

  it("passes gzip bytes through when accepted", async () => {
    const res = await get(`/v1/mbb/${PAST}/teams`, { "Accept-Encoding": "gzip" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Encoding")).toBe("gzip");
    expect(res.headers.get("Vary")).toBe("Accept-Encoding");
    // the runtime's fetch transparently decodes; content must still be the JSON
    expect(await res.json()).toMatchObject({ season: PAST, count: 1 });
  });

  it("sets ETag and honours If-None-Match", async () => {
    const first = await get(`/v1/mbb/${PAST}/teams`);
    const etag = first.headers.get("ETag");
    expect(etag).toMatch(/^"/);
    await first.arrayBuffer();
    const second = await get(`/v1/mbb/${PAST}/teams`, { "If-None-Match": etag! });
    expect(second.status).toBe(304);
    expect(second.headers.get("ETag")).toBe(etag);
  });

  it("long immutable TTL for past seasons, short for the current one", async () => {
    const past = await get(`/v1/mbb/${PAST}/teams`);
    expect(past.headers.get("Cache-Control")).toContain("immutable");
    expect(past.headers.get("Cache-Control")).toContain("max-age=86400");
    const cur = await get(`/v1/mbb/${CUR}/teams`);
    expect(cur.headers.get("Cache-Control")).toContain("max-age=600");
    expect(cur.headers.get("Cache-Control")).not.toContain("immutable");
    const seasons = await get("/v1/mbb/seasons");
    expect(seasons.headers.get("Cache-Control")).toContain("max-age=600");
  });

  it("second request is served from the Cache API", async () => {
    const path = `/v1/mbb/${PAST}/teams/1`;
    const urlKey = new Request(`https://cbb-cache.internal${path}`);
    await caches.default.delete(urlKey);
    const first = await get(path, { "Accept-Encoding": "gzip" });
    expect(first.headers.get("X-Cache")).toBe("MISS");
    await first.arrayBuffer();
    // cache.put runs in waitUntil; wait for it to land
    for (let i = 0; i < 20 && !(await caches.default.match(urlKey)); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const second = await get(path, { "Accept-Encoding": "gzip" });
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect(second.headers.get("Content-Encoding")).toBe("gzip");
    expect(await second.json()).toEqual({ season: PAST, team: { id: 1, name: "Alpha" } });
    const plain = await get(path);
    expect(plain.headers.get("X-Cache")).toBe("HIT");
    expect(plain.headers.get("Content-Encoding")).toBeNull();
    expect(await plain.json()).toEqual({ season: PAST, team: { id: 1, name: "Alpha" } });
  });

  it("permissive CORS", async () => {
    const res = await get(`/v1/mbb/${PAST}/teams`, { Origin: "https://example.com" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const pre = await exports.default.fetch(
      new Request(`https://api.test/v1/mbb/${PAST}/teams`, {
        method: "OPTIONS",
        headers: { Origin: "https://example.com", "Access-Control-Request-Method": "GET" },
      }),
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});

describe("team-stats sort/limit", () => {
  it("sorts descending with nulls last and limits", async () => {
    const res = await get(`/v1/mbb/${PAST}/team-stats?sort=-net_rtg&limit=2`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: typeof rows; count: number; total: number };
    expect(body.rows.map((r) => r.team_id)).toEqual([2, 1]);
    expect(body.count).toBe(2);
    expect(body.total).toBe(3);
    expect(res.headers.get("ETag")).toMatch(/^W\//);
  });

  it("ascending sort keeps nulls last", async () => {
    const res = await get(`/v1/mbb/${PAST}/team-stats?sort=net_rtg`);
    const body = (await res.json()) as { rows: typeof rows };
    expect(body.rows.map((r) => r.team_id)).toEqual([1, 2, 3]);
  });

  it("rejects unknown sort fields", async () => {
    const res = await get(`/v1/mbb/${PAST}/team-stats?sort=nope`);
    expect(res.status).toBe(400);
  });

  it("variant ETag supports 304", async () => {
    const first = await get(`/v1/mbb/${PAST}/team-stats?sort=ppg`);
    const etag = first.headers.get("ETag")!;
    await first.arrayBuffer();
    const again = await get(`/v1/mbb/${PAST}/team-stats?sort=ppg`, { "If-None-Match": etag });
    expect(again.status).toBe(304);
    const other = await get(`/v1/mbb/${PAST}/team-stats?sort=-ppg`, { "If-None-Match": etag });
    expect(other.status).toBe(200);
    await other.arrayBuffer();
  });

  it("no params = passthrough of the stored object", async () => {
    const res = await get(`/v1/mbb/${PAST}/team-stats`);
    expect(res.headers.get("ETag")).toMatch(/^"/);
    expect(((await res.json()) as { rows: unknown[] }).rows).toHaveLength(3);
  });
});

describe("helpers", () => {
  it("acceptsGzip", () => {
    expect(acceptsGzip("gzip, deflate, br")).toBe(true);
    expect(acceptsGzip("br;q=1.0, gzip;q=0.8")).toBe(true);
    expect(acceptsGzip("gzip;q=0")).toBe(false);
    expect(acceptsGzip("identity")).toBe(false);
    expect(acceptsGzip(undefined)).toBe(false);
  });

  it("etagMatches handles weak and lists", () => {
    expect(etagMatches('W/"abc", "def"', '"def"')).toBe(true);
    expect(etagMatches('"abc"', 'W/"abc"')).toBe(true);
    expect(etagMatches("*", '"x"')).toBe(true);
    expect(etagMatches('"nope"', '"x"')).toBe(false);
  });

  it("parsers", () => {
    expect(parseSort("-ppg")).toEqual({ field: "ppg", desc: true });
    expect(parseSort("ppg")).toEqual({ field: "ppg", desc: false });
    expect(parseSort("a;b")).toBe("invalid");
    expect(parseLimit("25")).toBe(25);
    expect(parseLimit("1001")).toBe("invalid");
    expect(sortRows([{ a: "b" }, { a: "a" }], { field: "a", desc: false })).toEqual([
      { a: "a" },
      { a: "b" },
    ]);
  });
});
