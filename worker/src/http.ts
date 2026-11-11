import type { Context } from "hono";
import type { DataSource, StoredObject } from "./datasource";
import { stripEtag } from "./datasource";
import type { AppEnv } from "./env";

/** Cache policy: the current season changes daily, past seasons are effectively frozen. */
export const TTL = {
  current: { browser: 600, edge: 900 }, // 10 min / 15 min
  past: { browser: 86_400, edge: 604_800 }, // 1 day / 7 days
} as const;

export function cacheControl(kind: keyof typeof TTL): string {
  const t = TTL[kind];
  return kind === "past"
    ? `public, max-age=${t.browser}, s-maxage=${t.edge}, immutable`
    : `public, max-age=${t.browser}, s-maxage=${t.edge}`;
}

export function jsonError(c: Context<AppEnv>, status: 400 | 404 | 429 | 500, message: string) {
  return c.json({ error: { status, message } }, status, { "Cache-Control": "no-store" });
}

export function acceptsGzip(header: string | undefined | null): boolean {
  if (!header) return false;
  return header.split(",").some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (name !== "gzip" && name !== "*") return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return !q || Number(q.slice(2)) > 0;
  });
}

export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  const want = stripEtag(etag);
  return ifNoneMatch.split(",").some((t) => stripEtag(t) === want);
}

// -- Cache API ----------------------------------------------------------------------------
// The cache stores the raw bytes exactly as they sit in R2 (gzip) with a private
// `x-stored-encoding` header instead of Content-Encoding, so the cached entry is never
// re-encoded or transparently decoded. The client response is built per request.

const STORED_ENCODING = "x-stored-encoding";

export interface Entry {
  bytes: ArrayBuffer;
  etag: string;
  encoding: string | null;
  lastModified: string;
  cacheStatus: "HIT" | "MISS";
}

/** Cache entries are keyed by R2 object key, so routes that share an object share it. */
function cacheKey(objectKey: string): Request {
  return new Request(`https://cbb-cache.internal/${objectKey}`, { method: "GET" });
}

/**
 * Load an object via cache -> data source. Returns:
 *  - an Entry,
 *  - "not-modified" if the client's If-None-Match matched (no body read),
 *  - null if the object doesn't exist.
 */
export async function loadEntry(
  c: Context<AppEnv>,
  key: string,
  ttl: keyof typeof TTL,
  ifNoneMatch: string | undefined,
): Promise<Entry | "not-modified" | null> {
  const cache = typeof caches !== "undefined" ? caches.default : undefined;
  const ck = cacheKey(key);
  const hit = cache ? await cache.match(ck) : undefined;
  if (hit) {
    const etag = hit.headers.get("ETag") ?? "";
    if (etagMatches(ifNoneMatch, etag)) {
      c.header("ETag", etag);
      return "not-modified";
    }
    return {
      bytes: await hit.arrayBuffer(),
      etag,
      encoding: hit.headers.get(STORED_ENCODING),
      lastModified: hit.headers.get("Last-Modified") ?? "",
      cacheStatus: "HIT",
    };
  }

  const data: DataSource = c.get("data");
  const res = await data.getObject(key, { ifNoneMatch });
  if (res === null) return null;
  if (res.kind === "not-modified") {
    c.header("ETag", res.etag);
    return "not-modified";
  }
  const entry = await toEntry(res);
  if (cache) {
    const stored = new Response(entry.bytes.slice(0), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": `public, s-maxage=${TTL[ttl].edge}`,
        ETag: entry.etag,
        "Last-Modified": entry.lastModified,
        ...(entry.encoding ? { [STORED_ENCODING]: entry.encoding } : {}),
      },
    });
    c.executionCtx.waitUntil(cache.put(ck, stored));
  }
  return entry;
}

async function toEntry(obj: StoredObject): Promise<Entry> {
  return {
    bytes: await new Response(obj.body).arrayBuffer(),
    etag: obj.etag,
    encoding: obj.contentEncoding,
    lastModified: obj.uploaded.toUTCString(),
    cacheStatus: "MISS",
  };
}

/**
 * Client response: pass gzip bytes through if accepted, otherwise decompress.
 * Note: on Cloudflare (and in `wrangler dev`) the runtime normalises the incoming
 * Accept-Encoding to "br, gzip", and the edge itself decodes for clients that can't take
 * gzip, so passthrough is the normal path; the decompress branch covers other callers
 * (tests, service bindings).
 */
export function respondWithEntry(c: Context<AppEnv>, entry: Entry, ttl: keyof typeof TTL) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheControl(ttl),
    ETag: entry.etag,
    "Last-Modified": entry.lastModified,
    Vary: "Accept-Encoding",
    "X-Cache": entry.cacheStatus,
  });
  copyHeaders(c, headers);
  const gz = entry.encoding === "gzip";
  if (gz && acceptsGzip(c.req.header("Accept-Encoding"))) {
    headers.set("Content-Encoding", "gzip");
    // encodeBody: "manual" = the bytes are already gzip; don't compress them again
    return new Response(entry.bytes, { headers, encodeBody: "manual" });
  }
  const body = gz ? decompress(entry.bytes) : entry.bytes;
  return new Response(body, { headers });
}

export function notModified(c: Context<AppEnv>, ttl: keyof typeof TTL) {
  const headers = new Headers({ "Cache-Control": cacheControl(ttl), Vary: "Accept-Encoding" });
  copyHeaders(c, headers);
  return new Response(null, { status: 304, headers });
}

/** Copy headers already set on the context (CORS, ETag, rate-limit info). */
function copyHeaders(c: Context<AppEnv>, into: Headers) {
  c.res.headers.forEach((v, k) => {
    if (!into.has(k)) into.set(k, v);
  });
}

export function decompress(bytes: ArrayBuffer): ReadableStream<Uint8Array> {
  return new Response(bytes).body!.pipeThrough(new DecompressionStream("gzip"));
}

export async function decodeJson<T>(entry: Entry): Promise<T> {
  const text =
    entry.encoding === "gzip"
      ? await new Response(decompress(entry.bytes)).text()
      : new TextDecoder().decode(entry.bytes);
  return JSON.parse(text) as T;
}
