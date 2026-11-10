// Seed the local R2 bucket used by `wrangler dev` from an ETL --dry-run output folder.
//
//   cd etl && uv run cbb-etl run --seasons 2026 --targets r2 --dry-run --out-dir out
//   cd worker && npm run seed:local          # defaults to ../etl/out
//   npm run dev
//
// Uses wrangler's getPlatformProxy, which persists to the same .wrangler/state directory
// that `wrangler dev` reads. Objects keep their gzip bytes and Content-Encoding.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { getPlatformProxy } from "wrangler";

const root = process.argv[2] ?? "../etl/out";

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith(".json") && !entry.name.endsWith(".meta.json")) yield p;
  }
}

const { env, dispose } = await getPlatformProxy({ persist: true });
let n = 0;
const batch = [];
for await (const file of walk(join(root, "v1"))) {
  const key = relative(root, file).split(sep).join("/");
  batch.push(
    (async () => {
      let meta = { content_type: "application/json", content_encoding: "gzip" };
      try {
        meta = JSON.parse(await readFile(`${file}.meta.json`, "utf8"));
      } catch {}
      await env.DATA.put(key, await readFile(file), {
        httpMetadata: {
          contentType: meta.content_type,
          ...(meta.content_encoding ? { contentEncoding: meta.content_encoding } : {}),
        },
      });
    })(),
  );
  if (batch.length >= 64) await Promise.all(batch.splice(0));
  n++;
}
await Promise.all(batch);
await dispose();
console.log(`seeded ${n} objects from ${root} into local R2 binding DATA`);
