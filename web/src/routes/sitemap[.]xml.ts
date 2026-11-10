// sitemap.xml (spec §9): season + list pages for every season; team and conference
// pages for the last 3 seasons; player pages for the current season.
import { createFileRoute } from "@tanstack/react-router";
import { apiGet } from "@/lib/api";
import {
  type ConferencesDoc,
  type SearchDoc,
  type SeasonsDoc,
  SPORTS,
  type TeamsDoc,
} from "@/lib/api-types";

const RECENT = 3;

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const urls: string[] = [`${origin}/about`, `${origin}/methodology`];
        for (const sport of SPORTS) {
          const seasons = await apiGet<SeasonsDoc>(`/v1/${sport}/seasons`);
          for (const s of seasons.seasons) {
            const base = `${origin}/${sport}/${s.season}`;
            urls.push(base, `${base}/teams`, `${base}/conferences`, `${base}/players`);
          }
          const recent = seasons.seasons.slice(0, RECENT).map((s) => s.season);
          const docs = await Promise.all(
            recent.map(async (season) => {
              const [teams, confs] = await Promise.all([
                apiGet<TeamsDoc>(`/v1/${sport}/${season}/teams`).catch(() => null),
                apiGet<ConferencesDoc>(`/v1/${sport}/${season}/conferences`).catch(() => null),
              ]);
              return { season, teams, confs };
            }),
          );
          for (const { season, teams, confs } of docs) {
            const base = `${origin}/${sport}/${season}`;
            for (const t of teams?.teams ?? []) {
              if (t.division_i) urls.push(`${base}/teams/${t.id}${t.slug ? `-${t.slug}` : ""}`);
            }
            for (const c of confs?.conferences ?? []) urls.push(`${base}/conferences/${c.id}`);
          }
          const search = await apiGet<SearchDoc>(
            `/v1/${sport}/${seasons.current_season}/search`,
          ).catch(() => null);
          for (const [id, , slug] of search?.players ?? []) {
            urls.push(`${origin}/${sport}/${seasons.current_season}/players/${id}-${slug}`);
          }
        }
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
          .map((u) => `<url><loc>${u.replace(/&/g, "&amp;")}</loc></url>`)
          .join("\n")}\n</urlset>\n`;
        return new Response(body, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, s-maxage=86400",
          },
        });
      },
    },
  },
});
