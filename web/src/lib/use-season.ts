import { getRouteApi } from "@tanstack/react-router";
import type { Sport } from "./api-types";

const seasonRoute = getRouteApi("/$sport/$season");

/** Sport, season, current season and the seasons.json entry for pages under a season. */
export function useSeasonRoute() {
  const { sport, season } = seasonRoute.useParams();
  const { entry, current } = seasonRoute.useLoaderData();
  return { sport: sport as Sport, season: Number(season), current, entry };
}
