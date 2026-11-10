import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { ComingSoon, PageHeader } from "@/components/page";
import type { Sport } from "@/lib/api-types";
import { SPORT_LABEL } from "@/lib/season-context";

const seasonRoute = getRouteApi("/$sport/$season");

export const Route = createFileRoute("/$sport/$season/players/")({
  loader: () => ({ crumb: "Players" }),
  head: ({ params }) => ({
    meta: [{ title: `Players · ${SPORT_LABEL[params.sport as Sport]} ${params.season} · cbb` }],
  }),
  component: Page,
});

function Page() {
  const { entry } = seasonRoute.useLoaderData();
  return (
    <>
      <PageHeader title="Players" subtitle={entry.label} />
      <ComingSoon phase={5} />
    </>
  );
}
