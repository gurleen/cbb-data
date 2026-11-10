import { createFileRoute, redirect } from "@tanstack/react-router";
import { seasonsQuery } from "@/lib/api";
import type { Sport } from "@/lib/api-types";

export const Route = createFileRoute("/$sport/")({
  loader: async ({ context, params }) => {
    const doc = await context.queryClient.ensureQueryData(seasonsQuery(params.sport as Sport));
    throw redirect({
      to: "/$sport/$season",
      params: { sport: params.sport, season: String(doc.current_season) },
    });
  },
});
