# Frontend spec (`web/`)

This is a public analytics site for D-I men's and women's college basketball, built on the
`cbb-api` Worker. The first release covers list and detail pages for **conferences**,
**teams** and **players**.

Status: phases 1-6 are implemented (see §12 for where the build deviated from this
plan). Phases are listed at the end.

---

## 1. Principles

* **Dense first.** Tables are the product. Fit more rows and columns on screen than a
  typical marketing site would, and avoid decorative whitespace, oversized cards and hero
  sections.
* **Numbers are first-class.** Use monospaced figures, right-aligned columns and consistent
  precision. Show D-I ranks next to values wherever they help.
* **Every view has a URL.** Sport, season, sort, filters and visible column groups all
  live in the URL, so any view can be shared and cached.
* **Be honest about the data.** Seasons and pages with partial box-score coverage say so
  (see §7.3).
* **Server-rendered and fast.** Pages render on the server (TanStack Start on Workers) from
  cached API objects. Client JS adds interactivity; the core content doesn't depend on it.

## 2. Stack

| Concern | Choice |
|---|---|
| Framework | TanStack Start (React 19, SSR on Cloudflare Workers), already scaffolded |
| Routing | TanStack Router, file-based, type-safe search params (validated with zod) |
| Data | TanStack Query, prefetched in route loaders and hydrated on the client |
| UI primitives | shadcn/ui (Radix underneath), copied into `src/components/ui` |
| Styling | Tailwind CSS v4, design tokens as CSS variables |
| Tables | TanStack Table (headless), with TanStack Virtual only where row counts call for it |
| Charts | Recharts for standard charts (via shadcn chart wrappers); visx for custom visuals |
| Fonts | IBM Plex Sans and IBM Plex Mono, self-hosted via `@fontsource` (no third-party font requests) |
| Icons | lucide-react |

## 3. Design system

### 3.1 Typography

* **IBM Plex Sans** for UI text: weights 400, 500 and 600, Latin subset only.
* **IBM Plex Mono** for every number in tables, stat cards, ranks and records (`24-9`).
  It guarantees alignment and gives the site its look. Weights 400 and 500.
* Type scale (compact):

| Token | Size / line height | Use |
|---|---|---|
| `text-xs` | 11 / 16 px | table headers, captions, badges |
| `text-sm` | 12 / 16 px | **table cells (default)**, secondary text |
| `text-base` | 13 / 20 px | body / UI default |
| `text-lg` | 15 / 22 px | section titles |
| `text-xl` | 18 / 24 px | page titles |
| `text-2xl` | 22 / 28 px | entity header name (team/player) |

* Table headers are uppercase `text-xs`, letter-spacing `0.02em`, 500 weight, muted color.
* Use `font-variant-numeric: tabular-nums` everywhere numbers appear, including Plex Sans
  contexts.

### 3.2 Density

| Element | Size |
|---|---|
| Base spacing unit | 4 px |
| Table row height | **28 px** (compact) / 36 px (comfortable, user toggle) |
| Table cell padding | 4 px vertical, 8 px horizontal |
| Header bar height | 44 px |
| Controls (inputs, selects, buttons) | 28 px high (shadcn `size="sm"` as the default) |
| Card padding | 12 px |
| Page gutter | 16 px (mobile), 24 px (desktop) |
| Max content width | 1440 px; tables may go full width |

A density toggle (compact / comfortable) lives in the settings menu and persists in a
cookie, the same way as the theme.

### 3.3 Color and theme

* **Themes:** dark (**default**) and light. There's no "system" mode in v1. The toggle in
  the header switches between the two.
* **Persistence:** a `theme` cookie, read on the server so SSR renders the right class on
  `<html>`. That avoids a flash of the wrong theme, and needs no inline script and no
  `localStorage`. No cookie means dark.
* **Tokens:** CSS variables (shadcn convention), redefined under `.light` and `.dark`.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--background` | `#0b0d10` | `#ffffff` | page |
| `--surface` | `#12151a` | `#f6f7f9` | cards, table header, sticky column |
| `--surface-hover` | `#1a1e24` | `#eef0f3` | row hover |
| `--border` | `#232830` | `#e3e6ea` | dividers, table grid |
| `--foreground` | `#e6e8eb` | `#111418` | primary text |
| `--muted-foreground` | `#8b929c` | `#5b636e` | secondary text, headers |
| `--primary` | `#3b82f6` | `#2563eb` | links, focus, selected (shadcn's `--accent` is the hover surface) |
| `--positive` | `#22c55e` | `#15803d` | wins (W/L text) |
| `--negative` | `#ef4444` | `#b91c1c` | losses (W/L text) |
| `--chart-good` / `--chart-bad` | `#3b82f6` / `#ef4444` | `#2563eb` / `#dc2626` | charts, rank shading, percentile bars (CVD-validated) |

* **Team colors** are an accent only: a 3 px left border on the entity header and an
  optional chip next to the name. Never use them as text or background, because many
  ESPN team colors fail contrast in one theme or the other.
* **Rank shading (optional per column):** a background tint based on D-I percentile, on a
  diverging scale from `--negative` through neutral to `--positive` at low opacity (at
  most 18%) so the text stays readable. "Good" is reversed for stats where lower is better
  (DRtg, opponent FG%, turnovers).
* All text must meet WCAG AA contrast in both themes.

### 3.4 Number formatting

| Kind | Format | Example |
|---|---|---|
| Per-game, ratings, pace | 1 decimal | `76.6`, `115.8` |
| Percentages (data is 0-1) | 1 decimal, `%` in the header, not the cell | `47.2` |
| Win % | 3 decimals with no leading zero | `.850` |
| Record | `W-L` | `34-6` |
| Net rating | signed | `+17.2`, `-3.4` |
| Ranks | ordinal, muted | `12th` |
| Missing | em dash, muted | `—` |

Put all of these in a single `format.ts`, with unit tests.

## 4. App shell

```
┌──────────────────────────────────────────────────────────────────────────┐
│ cbb   [MBB|WBB]  [2025-26 ▾]   Conferences  Teams  Players   [⌘K]  [☾] [⚙] │  44px
├──────────────────────────────────────────────────────────────────────────┤
│ MBB › 2025-26 › Teams › UConn Huskies                                    │  breadcrumb
│                                                                          │
│                              page content                                │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ Data: ESPN via sportsdataverse · Updated Nov 10, 2026 · About · Methodology │
└──────────────────────────────────────────────────────────────────────────┘
```

* **Header** (sticky):
  * The wordmark links home.
  * **Sport toggle**: a segmented control.
  * **Season picker**: a select listing seasons from `seasons.json`, with labels like
    `2025-26` and the current season marked.
  * Primary nav.
  * **Search** (⌘K / `/`).
  * Theme toggle.
  * Settings: density, plus per-game vs. totals as the default.
* **Context-preserving switches.** Changing sport or season keeps the page type and
  entity where possible: `/mbb/2026/teams/41-…` becomes `/mbb/2025/teams/41-…`. If the
  entity doesn't exist in the target season, go to that season's list page and show a
  toast.
* **Breadcrumbs** on every page below the season level.
* **Footer:**
  * The data source and attribution.
  * "Updated" time, taken from the season's `updated_at`.
  * Links to About and Methodology (`/about`, `/methodology`; the latter renders
    `docs/metrics.md` content).
* **Mobile (< 768 px):**
  * The nav collapses into a sheet; the sport toggle and season picker stay visible.
  * Tables scroll sideways with the first column pinned.
  * Detail pages stack their sections.

## 5. Routes

| Path | Page |
|---|---|
| `/` | Redirect to `/mbb/{current}` (v1). A landing page can come later. |
| `/:sport` | Redirect to `/:sport/{current}` |
| `/:sport/:season` | Season overview |
| `/:sport/:season/conferences` | Conference list |
| `/:sport/:season/conferences/:confId` | Conference detail |
| `/:sport/:season/teams` | Team list |
| `/:sport/:season/teams/:teamKey` | Team detail (`teamKey` = `41-uconn-huskies`) |
| `/:sport/:season/players` | Player list |
| `/:sport/:season/players/:playerKey` | Player detail (`playerKey` = `{id}-{slug}`) |
| `/about`, `/methodology` | Static content |

* `:sport` must be `mbb` or `wbb`. `:season` must be a 4-digit year present in
  `seasons.json`. Anything else returns a 404 page.
* **Entity keys:** parse the leading numeric ID and ignore the slug for lookup. If the slug
  doesn't match the canonical one, issue a 301 to the canonical URL.
* **Search params** are typed and validated per route: `sort`, `dir`, `conf`, `cols`,
  `per` (`game` | `total`), `min` (a minimum-games or minimum-minutes threshold). Defaults
  are omitted from the URL.

## 6. Pages

Every list page shares one `<StatTable>` component (§7.1).

### 6.1 Season overview `/:sport/:season`

* A compact summary strip: D-I team count, games played, box coverage, last updated.
* **Top 25 by net rating**: a small table with rank, team, record, ORtg, DRtg, Net and
  pace, linking to the full teams list.
* **Conference strength**: conferences ranked by average net rating, shown as a bar
  list.
* **Stat leaders**: small cards for teams (PPG, opponent PPG, 3P%, pace, net rating) and,
  once players exist, players (PPG, RPG, APG). Each shows the top 5.

### 6.2 Conference list `/:sport/:season/conferences`

* One row per conference: name, number of teams, average ORtg / DRtg / Net, average pace,
  best team (by net), and conference-game record vs. other conferences (later).
* Default sort: average Net, descending.

### 6.3 Conference detail `/:sport/:season/conferences/:confId`

* Header: conference name, short name, team count, and its rank among conferences.
* **Standings**: conference W-L and win %, overall W-L, home/away/neutral splits, and
  streak (later). Sorted by conference win %.
* **Team ratings**: the same columns as the teams list, filtered to this conference.
* A chart (phase 2): ORtg vs. DRtg scatter for the conference's teams, against the D-I
  field shown in muted color.

### 6.4 Team list `/:sport/:season/teams`

This is the main leaderboard, built on `team-stats.json`.

* **Column groups** (toggle visibility; Ratings and Record are on by default):
  * Record: G, W, L, Win%, Conf W-L
  * Ratings: ORtg, DRtg, Net, Pace
  * Scoring: PPG, OPP PPG
  * Shooting: FGM-A, FG%, 3PM-A, 3P%, FTM-A, FT%
  * Other: RPG, APG, TOPG, SPG, BPG
* Filters: conference (multi-select), and a minimum-games threshold.
* Per-game / totals toggle (`per=total` swaps in totals where it applies).
* Columns:
  * The team column is sticky and shows a logo (16 px), the name, and the conference in
    muted text.
  * A rank column comes first and reflects the current sort.
* All 365 rows render (no pagination). Virtualization is unnecessary at this size.

### 6.5 Team detail `/:sport/:season/teams/:teamKey`

* **Header:**
  * Logo (40 px), name, conference link, overall and conference record.
  * A team-color left border.
  * A season switcher scoped to this team.
* **Rating cards** in one row: ORtg, DRtg, Net and pace, each showing the value, its D-I
  rank, and a percentile bar.
* **Splits table**: overall, conference, home, away, neutral (W-L).
* **Team vs. opponents**: two columns (team / opponent) for PPG, FG%, 3P%, FT%, RPG, ORB,
  TOV, AST, STL, BLK.
* **Game log**: date, opponent (with logo and site), result, score, then the team's line
  (points, FG, 3P, FT, rebounds, TOV) and that game's possessions and ratings.
  * Phase 2. Needs `teams/{id}/games.json`.
* **Roster**: number, name (links to the player page), position, class, height, and key
  per-game stats.
  * Phase 3. Needs the player outputs.
* Box-coverage notice if `box.coverage < 0.95` (§7.3).

### 6.6 Player list `/:sport/:season/players`

* Columns: player, team, conference, position, class, G, MPG, PPG, RPG, APG, SPG, BPG,
  TOPG, FG%, 3P%, FT%, and later eFG% / TS% / usage.
* Filters: conference, team, position, class, and a minimum-minutes threshold (default:
  at least 40% of the team's minutes, so leaderboards aren't topped by small samples).
* About 5,000 D-I players per season, so this page **does** use TanStack Virtual. It also
  needs server-side pagination or a chunked JSON layout (§8).

### 6.7 Player detail `/:sport/:season/players/:playerKey`

* Header: headshot (when available), name, team link, number, position, class, height.
* The season stat line, with D-I ranks among qualified players.
* **Game log** (from `player_boxscores`).
* **Career**: one row per season with that season's team.

## 7. Shared components and behaviour

### 7.1 `<StatTable>`

* Built on TanStack Table, with column definitions in typed config.
* Sticky header, and a sticky first (entity) column.
* Sorting by clicking a header. The first click on a numeric column sorts descending
  (except columns marked `lowerIsBetter`), shift-click adds a secondary sort, and nulls
  always sort last. Sort state syncs to the URL.
* Column groups as a header row above the column headers. Visibility is toggled via the
  `cols` param.
* Optional rank shading per column (§3.3).
* Row hover and keyboard row focus; Enter opens the entity.
* Export: copy as TSV and download CSV of the current view.
* `<StatTable>` must also work with no JS: the server-rendered HTML is the default view.

### 7.2 Search (⌘K)

* shadcn `Command` dialog, searching teams (and players, once they exist) in the current
  sport and season.
* Loads a small `search.json` index on first open, then searches on the client with
  prefix and fuzzy matching.

### 7.3 Data quality notices

* If a season's `box_coverage` is below 0.95, show a muted inline banner on season, team
  and player pages: "Box scores cover N% of games this season; per-game stats and ratings
  are based on those games only."
* Show a small `limited` badge next to any value computed from fewer than 5 box games.

### 7.4 States

* **Loading:** skeleton rows at the real row height. Route-level pending UI only appears
  after 150 ms, to avoid flashes.
* **Empty:** "No games yet this season" for a current season before tip-off (the API
  reports 0 games).
* **Errors:** a 404 page for an unknown entity or season. API failures render an error
  boundary with a retry button.

## 8. Data and API

The frontend uses **only** the public API. Loaders call it through a typed client
(`src/lib/api.ts`), with response types from a shared `packages/api-types` (see §10).

| Page | Endpoints (today) | Needed additions (ETL) |
|---|---|---|
| Season overview | `seasons.json`, `team-stats.json` | `conferences.json` |
| Conference list / detail | — (derivable from `teams.json` + `team-stats.json`) | `conferences.json`, `conferences/{id}.json` (averages, ranks, standings) |
| Team list | `team-stats.json` | per-stat D-I rank fields |
| Team detail | `teams/{id}.json` | ranks; `teams/{id}/games.json`; roster |
| Players (all) | — | `player_season_stats` (derived), `players/{page}.json` or `players.json` split into chunks, `players/{id}.json`, career index |
| Search | — | `search.json` (ids, names, slugs, team for players) |

* **Caching:** the API already sets long TTLs for past seasons and short TTLs for the
  current one. Pages forward an equivalent `Cache-Control` so the web Worker's responses
  are cacheable too.
* **Hosting:** the web and API Workers stay separate deployments. Routing them under one
  custom domain (`/` to `cbb-web`, `/v1/*` to `cbb-api`) is an optional later step; it
  removes the cross-origin hop. Until then, set `VITE_API_URL` (defaulting to the API's
  workers.dev URL).

## 9. Accessibility and SEO

* Proper `<table>` semantics. Sortable headers are buttons with `aria-sort`.
* Full keyboard navigation, visible focus rings (`--primary`), and respect for
  `prefers-reduced-motion`.
* Per-page `<title>` and meta description, e.g. "UConn Huskies 2025-26 stats — cbb".
* Canonical URLs (slug redirects), plus a `sitemap.xml` generated from `seasons.json` and
  `teams.json`.
* Open Graph images later.

## 10. Repo structure

```
web/
  src/
    routes/                 file-based routes (§5)
    components/ui/          shadcn primitives
    components/             StatTable, EntityHeader, StatCard, SeasonPicker, ...
    lib/api.ts              typed API client
    lib/format.ts           number formatting (§3.4)
    lib/theme.ts            cookie-based theme and density
    styles.css              Tailwind and tokens (§3)
packages/api-types/         response types shared by worker and web (npm workspace)
```

Root `package.json` with npm workspaces: `worker`, `web`, `packages/*`.

## 11. Phases

1. **Foundation.**
   * Tailwind, shadcn, fonts, tokens, and the dark/light cookie theme.
   * App shell (header, footer, breadcrumbs, sport/season context), `format.ts`, the
     typed API client, and `<StatTable>`.
2. **Teams.**
   * Teams list and team detail (header, ratings, splits, team vs. opponents) on today's
     API.
   * Then the ETL adds ranks, and the season overview follows.
3. **Conferences.** ETL conference outputs, then the list and detail pages.
4. **Team game logs.** ETL `teams/{id}/games.json`, then the game log section.
5. **Players.**
   * ETL player outputs and search index.
   * Player list (virtualized) and player detail, rosters on team pages, and ⌘K search.
6. **Polish.** Charts, rank shading, CSV export, sitemap, and Open Graph images.

## 12. Implementation notes (deviations from the plan above)

* **Players list: pagination instead of virtualization.** The page shows 100 rows at a
  time with `?page=`, applied after sorting and filtering over the full list. Three
  reasons:
  * It server-renders cheaply: only 100 rows of HTML on Workers.
  * Every page has a shareable URL.
  * It needs no extra dependency.

  The default pool is the qualified leaderboard (~2,300 rows, ~195 KB gzipped). The
  "All" pool (`players-all.json`, ~400 KB) loads only in the browser.
* **Columnar player leaderboards.** `players.json` and `players-all.json` are stored as
  `{columns, data}`, which is about half the size of an array of objects. The client
  expands them with `expandPlayers()`.
* **Teams list has no per-game/totals toggle.** The leaderboard carries per-game values
  only, and totals rebuilt from rounded per-game numbers would be inexact. Season totals
  are on each team page.
* **Chart and shading colors.** These use a blue/red diverging pair, `--chart-good` and
  `--chart-bad`, validated for color-vision deficiency in both themes. The original
  green/red failed for deuteranopia. W/L text keeps `--positive`/`--negative`, because
  the W/L letter carries the meaning. Stats with no good direction are never shaded:
  pace and attempt volumes.
* **Search** uses our own ranking (exact > prefix > word prefix > substring > initials,
  accent-insensitive) over `search.json`. cmdk only handles keyboard navigation.
* **SSR data access** goes through the `API` service binding in production. In the
  browser it goes to the public API URL.
* **Not done yet:**
  * Open Graph images. These need an image renderer on Workers, e.g. satori/workers-og.
  * The comfortable-density default for touch devices.
  * Conference "streak" and non-conference strength by opponent.
