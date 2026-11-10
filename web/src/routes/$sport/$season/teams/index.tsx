import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { ComingSoon, PageHeader } from "@/components/page";
import type { Sport } from "@/lib/api-types";
import { SPORT_LABEL } from "@/lib/season-context";

const seasonRoute = getRouteApi("/$sport/$season");

export const Route = createFileRoute("/$sport/$season/teams/")({
  loader: () => ({ crumb: "Teams" }),
  head: ({ params }) => ({
    meta: [{ title: `Teams · ${SPORT_LABEL[params.sport as Sport]} ${params.season} · cbb` }],
  }),
  component: Page,
});

function Page() {
  const { entry } = seasonRoute.useLoaderData();
  return (
    <>
      <PageHeader title="Teams" subtitle={entry.label} />
      <ComingSoon phase={2} />
    </>
  );
}
