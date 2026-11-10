import { Hono } from "hono";
import { cors } from "hono/cors";
import { R2DataSource } from "./datasource";
import type { AppEnv } from "./env";
import { jsonError } from "./http";
import { v1 } from "./routes";

const app = new Hono<AppEnv>();

// Permissive read-only CORS for now.
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "HEAD", "OPTIONS"],
    allowHeaders: ["If-None-Match"],
    exposeHeaders: ["ETag", "Last-Modified", "X-Cache"],
    maxAge: 86400,
  }),
);

// Per-IP rate limit via the Workers Rate Limiting binding (skipped if not bound).
app.use("/v1/*", async (c, next) => {
  const limiter = c.env.RATE_LIMITER;
  if (limiter) {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const { success } = await limiter.limit({ key: ip });
    if (!success) return jsonError(c, 429, "rate limit exceeded; slow down");
  }
  await next();
});

app.use("/v1/*", async (c, next) => {
  c.set("data", new R2DataSource(c.env.DATA));
  await next();
});

app.get("/health", (c) => c.json({ ok: true, service: "cbb-api", version: "v1" }));
app.route("/v1", v1);

app.notFound((c) => jsonError(c, 404, "no such route"));
app.onError((err, c) => {
  console.error(JSON.stringify({ msg: "unhandled error", error: String(err), url: c.req.url }));
  return jsonError(c, 500, "internal error");
});

export default app;
