import { createFileRoute, redirect } from "@tanstack/react-router";
import { seasonsQuery } from "@/lib/api";
import { DEFAULT_SPORT } from "@/lib/season-context";

// v1: no landing page yet; send visitors to the current MBB season.
export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    const doc = await context.queryClient.ensureQueryData(seasonsQuery(DEFAULT_SPORT));
    throw redirect({
      to: "/$sport/$season",
      params: { sport: DEFAULT_SPORT, season: String(doc.current_season) },
    });
  },
});
