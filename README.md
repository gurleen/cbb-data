# cbb-data

ESPN men's and women's college basketball data from the
[sportsdataverse releases](https://github.com/sportsdataverse/sportsdataverse-data/releases),
turned into:

1. **Precomputed API objects** (gzip JSON) in Cloudflare R2, served by a Cloudflare Worker.
2. **A parquet lake** in the same R2 bucket, Hive-partitioned by season.
3. **MotherDuck views** over that lake for ad-hoc SQL. No data is stored in MotherDuck.

```
etl/      Python (uv): extract -> DuckDB transforms -> validate -> R2 / lake / MotherDuck
worker/   Cloudflare Worker (TypeScript, Hono): read-only API over the R2 objects
web/      Frontend: TanStack Start (React, SSR on Cloudflare Workers); scaffold only
docs/     schemas.md (upstream columns), metrics.md (formulas), format-benchmark.md
.github/  etl.yml (daily + backfill), worker.yml + web.yml (deploy), ci.yml (lint + test)
```

## How it works

```
GitHub releases (parquet, one file per season)
   │  download to local cache (re-fetched only when asset size/updated_at changes)
   ▼
DuckDB (local) ── sql/teams.sql, sql/team_season_stats.sql ── validation (fails loudly)
   │
   ├─► R2  v1/...          gzip JSON per endpoint, uploaded only if the content hash changed
   ├─► R2  parquet/v1/...  upstream files copied as-is + derived team_season_stats
   └─► MotherDuck          cbb.{mbb,wbb}.<table> = VIEW over r2://.../season=*/*.parquet
```

* **Incremental.** `v1/manifest.json` stores each object's content hash and each source's
  fingerprint. A normal run only processes the current season, and skips it entirely when
  upstream hasn't changed. Past seasons are only rebuilt when you ask for them.
* **All or nothing.** Every requested season is built and validated before anything is
  written, and the manifest is written last.
* **Why views instead of tables.** Storage lives in R2 (free egress, nothing counted against
  MotherDuck's 10 GB free tier). Loads are just parquet copies, and new seasons show up in
  the views automatically. Hive partitioning lets `WHERE season = 2026` read one file, and
  `union_by_name` absorbs schema drift between seasons. The cost is query latency: each
  query reads over the network from R2. If a hot table needs to be native,
  `--md-mode tables` loads real tables (idempotent per season: delete, then insert, in one
  transaction).
* "Season" always means the **ending** year: 2026 is the 2025-26 season. The current season
  is computed from the date (Aug-Dec means next year, Jan-Jul means this year).

## R2 key layout

```
v1/manifest.json                                hashes, source fingerprints, season summaries
v1/{sport}/seasons.json                         seasons available, with D-I team count + box coverage
v1/{sport}/{season}/teams.json                  every team in the season (D-I flag, conference, colors, logo)
v1/{sport}/{season}/teams/{team_id}.json        metadata + record, totals, per-game, shooting, ratings
v1/{sport}/{season}/team-stats.json             one row per D-I team (leaderboard)
v1/{sport}/{season}/teams/{team_id}/games.json  team game log (schedule + box line per game)
v1/{sport}/{season}/conferences.json            conference summaries (ratings, non-con record)
v1/{sport}/{season}/conferences/{id}.json       conference standings + member ratings
v1/{sport}/{season}/players.json                qualified D-I players (columnar: columns + data)
v1/{sport}/{season}/players-all.json            every D-I player with a game (columnar)
v1/{sport}/{season}/players/{player_id}.json    player season: bio, line, ranks, game log
v1/{sport}/{season}/search.json                 compact team + player search index
v1/{sport}/players/{player_id}.json             player career (all seasons)
v1/{sport}/{season}/_hashes.json                internal: content hashes for the season (not served)
parquet/v1/{sport}/{table}/season={season}/data.parquet
    tables: schedules, team_boxscores, player_boxscores, rosters, standings, pbp (opt-in),
            and derived team_season_stats, conference_stats, player_season_stats
```

JSON objects are stored with `Content-Type: application/json` and `Content-Encoding: gzip`.
The encoder sits behind one interface (`etl/src/cbb_etl/encode.py`), so MessagePack could be
swapped in later. See `docs/format-benchmark.md` for why it isn't used.

## Setup

Requirements: [uv](https://docs.astral.sh/uv/) and Node 22.

```bash
cd etl
```

```bash
uv sync
```

```bash
cd ../worker
```

```bash
npm ci
```

(`worker/.npmrc` sets `legacy-peer-deps`; npm 10 can't otherwise resolve vitest's optional peers.)

### Secrets

| name | used by | notes |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | ETL, worker.yml, web.yml | one account ID for both the R2 endpoint and Wrangler (`R2_ACCOUNT_ID` is also accepted locally) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | ETL | R2 API token with Object Read & Write on the bucket |
| `R2_READ_ACCESS_KEY_ID`, `R2_READ_SECRET_ACCESS_KEY` | ETL -> MotherDuck secret | optional **read-only** token for the lake views (falls back to the write keys, with a warning) |
| `MOTHERDUCK_TOKEN` | ETL | |
| `CLOUDFLARE_API_TOKEN` | worker.yml, web.yml | token needs Workers Scripts:Edit |

Add them as GitHub Actions secrets. For local runs, copy `.env.example` to `etl/.env` and
load it with `set -a; source .env; set +a`. The Worker itself needs no secrets in v1; the
bucket name is set in `worker/wrangler.jsonc` and must match `R2_BUCKET`.

## Local development

### ETL dry run (no cloud access needed)

`--dry-run` writes the R2 objects and the parquet lake to `--out-dir`. It writes the
"MotherDuck" views to a local DuckDB file, `out/cbb.duckdb`, pointing at the local lake.

```bash
cd etl
```

```bash
uv run cbb-etl run --sport all --seasons 2026,2027 --dry-run --out-dir out
```

```bash
uv run python -c "import duckdb; print(duckdb.connect('out/cbb.duckdb').sql('select display_name, wins, losses, net_rtg from cbb.mbb.team_season_stats where season = 2026 and division_i order by net_rtg desc limit 5'))"
```

Tests and lint:

```bash
uv run pytest -q
```

```bash
uv run ruff check . && uv run ruff format --check .
```

### Worker with a local R2 bucket

Seed the local bucket that `wrangler dev` uses (`.wrangler/state`) from the dry-run output,
then start the dev server:

```bash
cd worker
```

```bash
npm run seed:local
```

```bash
npm run dev
```

```bash
curl -s "localhost:8787/v1/mbb/2026/team-stats?sort=-net_rtg&limit=5"
```

Tests (vitest in the Workers runtime via `@cloudflare/vitest-plugin`, which is the renamed
`@cloudflare/vitest-pool-workers`, with a Miniflare R2 bucket):

```bash
npm test
```

```bash
npm run lint && npm run typecheck
```

### Frontend (`web/`)

[TanStack Start](https://tanstack.com/start) app, server-rendered in its own Worker
(`cbb-web`) through `@cloudflare/vite-plugin`. `docs/frontend-spec.md` is the plan, and
its §12 lists the implementation notes. What's in place:

* **Pages:** season overview, plus teams, conferences and players (list and detail) for
  every season. Routes are `/:sport/:season/...`, with canonical slug redirects and
  404s.
* **Tables:** the shared `<StatTable>` (TanStack Table v9) has sticky headers and first
  column, sort state in the URL, optional rank shading, and copy-as-TSV / CSV export.
* **Charts:** an ORtg vs. DRtg scatter on conference pages and point margin by game on
  team pages.
* **Search:** ⌘K or `/` searches teams and players in the current season.
* **SEO:** `/sitemap.xml`, `/robots.txt`, and per-page titles and descriptions.
  `/methodology` renders `docs/metrics.md`.
* **Design:** dark (default) and light themes, plus compact/comfortable density. Both
  are stored in cookies so SSR renders them with no flash. Fonts are IBM Plex Sans/Mono.

During SSR in production, the app reaches the API through the `API` service binding,
because a Worker can't fetch another Worker's workers.dev URL on the same account. In the
browser, and in dev, it uses `VITE_API_URL` (default: the deployed API). Routes are
file-based. `src/routeTree.gen.ts` and `worker-configuration.d.ts` (from
`npm run cf-typegen`) are generated, but they're committed so `tsc` works before the
first build.

```bash
cd web
```

```bash
npm ci
```

```bash
npm run dev
```

`npm run dev` serves on `localhost:3000`, running inside workerd, so dev behaves like
production. To point it at a local API instead, run `npm run dev` in `worker/` and
start the web app with `VITE_API_URL=http://localhost:8787 npm run dev`. Other scripts:
`npm run build`, `npm test`, `npm run typecheck`, `npm run lint`, and `npm run deploy`
(build + `wrangler deploy`). `web.yml` deploys on pushes to `main` that
touch `web/**`, using the same Cloudflare secrets as the Worker.

## CLI

```
cbb-etl run [--sport mbb|wbb|all] [--seasons current|all|2024,2025|2015-2020]
            [--targets r2,lake,motherduck] [--md-mode views|tables]
            [--include-pbp] [--max-seasons N] [--force] [--dry-run --out-dir DIR]
```

| flag | default | meaning |
|---|---|---|
| `--sport` | `all` | |
| `--seasons` | `current` | `all` = every season with box scores (MBB 2003+, WBB 2004+) |
| `--targets` | `r2,lake,motherduck` | `r2` = API JSON, `lake` = parquet copies, `motherduck` = views (implies `lake`) |
| `--md-mode` | `views` | `tables` loads native MotherDuck tables instead |
| `--include-pbp` | off | adds play-by-play to the lake (~80-90 MB per season per sport, so ~4 GB of R2 for everything) |
| `--max-seasons` | none | lake/MotherDuck get only the N most recent selected seasons (API JSON still gets all) |
| `--force` | off | ignore fingerprints and rebuild. Unchanged objects are still not re-uploaded, because hashes match. |

Exit codes: 0 ok, 2 validation failed (nothing published), 1 other error.

## Backfill

From GitHub, go to Actions, then **etl**, then **Run workflow**, and set `seasons=all`
(optionally `include_pbp`). Or locally, with secrets loaded:

```bash
uv run cbb-etl run --sport all --seasons all
```

A full backfill writes about 25 seasons × 2 sports × ~700 JSON objects (≈35k R2 Class A
operations, about $0.16), plus the parquet lake. Later daily runs touch only the current
season, and only objects whose content changed.

## Schedule

`etl.yml` runs daily at 09:00 UTC, after upstream's ~07:00 UTC refresh. The scheduled run
exits early from May to September. Before the first game of a season, the current season
is skipped with a warning rather than failing validation. A concurrency group stops runs
from overlapping.

## API

| route | notes |
|---|---|
| `GET /health` | |
| `GET /v1/{sport}/seasons` | |
| `GET /v1/{sport}/{season}/teams` | |
| `GET /v1/{sport}/{season}/teams/{teamId}` | |
| `GET /v1/{sport}/{season}/team-stats` | `?sort=-net_rtg` (a leading `-` means descending; nulls always last), `?limit=1..1000` |
| `GET /v1/{sport}/{season}/teams/{teamId}/games` | team game log |
| `GET /v1/{sport}/{season}/conferences[/{id}]` | |
| `GET /v1/{sport}/{season}/players`, `/players-all` | columnar player leaderboards |
| `GET /v1/{sport}/{season}/players/{playerId}` | player season |
| `GET /v1/{sport}/players/{playerId}` | player career |
| `GET /v1/{sport}/{season}/search` | search index |

* `sport` must be `mbb` or `wbb`, and `season` a 4-digit year. Otherwise you get a JSON
  `400`. Unknown objects or routes return a JSON `404`.
* **Compression.** Gzip bytes from R2 are passed through untouched (`encodeBody: "manual"`).
  Clients that don't accept gzip get a decompressed body.
* **ETags.** These come from R2, and `If-None-Match` returns `304`. Sorted or limited
  team-stats responses get a weak ETag for each variant.
* **Caching.** Responses go through the Cache API. Past seasons get
  `max-age=86400, s-maxage=604800, immutable`; the current season and `seasons.json` get
  `max-age=600, s-maxage=900`.
* **CORS and rate limiting.** CORS allows any origin for GET, HEAD and OPTIONS. Per-IP rate
  limiting uses the Workers Rate Limiting binding (300 requests/min; remove `ratelimits`
  from `wrangler.jsonc` to disable).
* **MotherDuck routes.** Handlers read through a `DataSource` interface
  (`worker/src/datasource.ts`), so MotherDuck-backed routes can be added later. A commented
  `/v1/{sport}/query` stub lives in `worker/src/routes.ts`.

## Data caveats

See `docs/schemas.md` for the details. In short: box scores are sparse in early seasons (MBB before 2006,
WBB before 2017; check `box_coverage`); non-D-I opponents appear in the data; and conference names fall back
through schedules, then standings, then `etl/sql/conference_names.csv` (regenerate it with
`uv run python scripts/build_conference_names.py`). `docs/schemas.md` is regenerated with
`uv run python scripts/inspect_schemas.py --write ../docs/schemas.md`.
