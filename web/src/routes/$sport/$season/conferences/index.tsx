import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { ComingSoon, PageHeader } from "@/components/page";
import type { Sport } from "@/lib/api-types";
import { SPORT_LABEL } from "@/lib/season-context";

const seasonRoute = getRouteApi("/$sport/$season");

export const Route = createFileRoute("/$sport/$season/conferences/")({
  loader: () => ({ crumb: "Conferences" }),
  head: ({ params }) => ({
    meta: [{ title: `Conferences · ${SPORT_LABEL[params.sport as Sport]} ${params.season} · cbb` }],
  }),
  component: Page,
});

function Page() {
  const { entry } = seasonRoute.useLoaderData();
  return (
    <>
      <PageHeader title="Conferences" subtitle={entry.label} />
      <ComingSoon phase={3} />
    </>
  );
}
