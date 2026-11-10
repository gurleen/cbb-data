/**
 * Data-source interface the route handlers depend on. v1 serves precomputed objects from
 * R2; MotherDuck-backed routes can add a second implementation (see QuerySource below)
 * without touching the existing handlers.
 */

export interface StoredObject {
  kind: "object";
  body: ReadableStream<Uint8Array>;
  /** Quoted strong ETag, e.g. `"abc123"`. */
  etag: string;
  /** Encoding the bytes are stored in (the ETL writes gzip). */
  contentEncoding: string | null;
  contentType: string;
  uploaded: Date;
}

export interface NotModified {
  kind: "not-modified";
  etag: string;
}

export interface DataSource {
  /** Fetch an object by key. Returns `not-modified` when `ifNoneMatch` matches. */
  getObject(
    key: string,
    opts?: { ifNoneMatch?: string },
  ): Promise<StoredObject | NotModified | null>;
}

export class R2DataSource implements DataSource {
  constructor(private readonly bucket: R2Bucket) {}

  async getObject(
    key: string,
    opts: { ifNoneMatch?: string } = {},
  ): Promise<StoredObject | NotModified | null> {
    const etag = opts.ifNoneMatch ? stripEtag(opts.ifNoneMatch) : undefined;
    // With onlyIf, R2 returns metadata without a body when the condition fails.
    const obj = (await this.bucket.get(key, etag ? { onlyIf: { etagDoesNotMatch: etag } } : {})) as
      | R2ObjectBody
      | R2Object
      | null;
    if (obj === null) return null;
    if (!("body" in obj)) return { kind: "not-modified", etag: obj.httpEtag };
    return {
      kind: "object",
      body: obj.body,
      etag: obj.httpEtag,
      contentEncoding: obj.httpMetadata?.contentEncoding ?? null,
      contentType: obj.httpMetadata?.contentType ?? "application/json",
      uploaded: obj.uploaded,
    };
  }
}

/** `W/"abc"` or `"abc"` -> `abc` (first tag only). */
export function stripEtag(value: string): string {
  const first = value.split(",")[0].trim();
  return first.replace(/^W\//, "").replace(/^"|"$/g, "");
}

/*
 * Future: MotherDuck-backed routes (e.g. GET /v1/{sport}/query) would implement
 *
 *   export interface QuerySource {
 *     query(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
 *   }
 *
 * against the MotherDuck HTTP/Postgres endpoint with a MOTHERDUCK_TOKEN secret, reading
 * the `cbb.{mbb,wbb}.*` views over the R2 parquet lake. Not implemented in v1.
 */
