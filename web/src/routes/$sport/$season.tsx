import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { seasonsQuery } from "@/lib/api";
import type { Sport } from "@/lib/api-types";

// Cache policy mirrors the API (spec §8): past seasons are frozen, the current one
// refreshes daily.
const PAST = "public, max-age=3600, s-maxage=86400";
const CURRENT = "public, max-age=300, s-maxage=600";

export const Route = createFileRoute("/$sport/$season")({
  loader: async ({ context, params }) => {
    if (!/^\d{4}$/.test(params.season)) throw notFound();
    const doc = await context.queryClient.ensureQueryData(seasonsQuery(params.sport as Sport));
    const entry = doc.seasons.find((s) => s.season === Number(params.season));
    if (!entry) throw notFound();
    return { entry, current: doc.current_season, crumb: entry.label };
  },
  headers: ({ loaderData }) =>
    loaderData
      ? { "Cache-Control": loaderData.entry.season < loaderData.current ? PAST : CURRENT }
      : undefined,
  component: Outlet,
});
