import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { ComingSoon, PageHeader, Stat } from "@/components/page";
import type { Sport } from "@/lib/api-types";
import { fmtDate, fmtInt, fmtPct } from "@/lib/format";
import { SPORT_LABEL, SPORT_NAME } from "@/lib/season-context";

const seasonRoute = getRouteApi("/$sport/$season");

export const Route = createFileRoute("/$sport/$season/")({
  head: ({ params }) => ({
    meta: [{ title: `${SPORT_LABEL[params.sport as Sport]} ${params.season} · cbb` }],
  }),
  component: SeasonOverview,
});

function SeasonOverview() {
  const { sport } = Route.useParams();
  const { entry } = seasonRoute.useLoaderData();
  return (
    <>
      <PageHeader title={`${entry.label} season`} subtitle={SPORT_NAME[sport as Sport]} />
      <div className="mb-4 flex flex-wrap gap-6 rounded-md border bg-surface px-3 py-2">
        <Stat label="D-I teams" value={fmtInt(entry.division_i_teams)} />
        <Stat label="Games" value={fmtInt(entry.games)} />
        <Stat label="Box coverage" value={`${fmtPct(entry.box_coverage)}%`} />
        <Stat label="Updated" value={fmtDate(entry.updated_at)} />
      </div>
      <ComingSoon phase={2}>Top teams, conference strength and stat leaders land here.</ComingSoon>
    </>
  );
}
