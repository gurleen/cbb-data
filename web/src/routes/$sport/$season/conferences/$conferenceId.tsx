import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { CoverageNotice } from "@/components/coverage-notice";
import { PageHeader } from "@/components/page";
import { RatingCard, Section } from "@/components/stat-card";
import { type StatColumn, StatTable } from "@/components/stat-table";
import { TeamLink } from "@/components/team";
import { ApiError, conferenceQuery, conferencesQuery } from "@/lib/api";
import type { ConferenceTeamRow, Sport } from "@/lib/api-types";
import { fmt1, fmtRecord, fmtSigned, fmtWinPct } from "@/lib/format";
import { SPORT_LABEL } from "@/lib/season-context";
import { DEFAULT_TEAM_GROUPS, hiddenColumns, teamColumns } from "@/lib/team-columns";
import { useSeasonRoute } from "@/lib/use-season";

export const Route = createFileRoute("/$sport/$season/conferences/$conferenceId")({
  loader: async ({ context, params }) => {
    if (!/^\d{1,6}$/.test(params.conferenceId)) throw notFound();
    const sport = params.sport as Sport;
    const season = Number(params.season);
    const current =
      context.queryClient.getQueryData<{ current_season: number }>(["seasons", sport])
        ?.current_season ?? 0;
    try {
      const [doc] = await Promise.all([
        context.queryClient.ensureQueryData(
          conferenceQuery(sport, season, Number(params.conferenceId), current),
        ),
        context.queryClient.ensureQueryData(conferencesQuery(sport, season, current)),
      ]);
      return {
        crumb: doc.conference.short_name ?? doc.conference.name ?? "Conference",
        name: doc.conference.name,
      };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) throw notFound();
      throw e;
    }
  },
  head: ({ params, loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.name ?? "Conference"} ${params.season} · ${SPORT_LABEL[params.sport as Sport]} · cbb`,
      },
      {
        name: "description",
        content: `${loaderData?.name ?? "Conference"} ${params.season}: standings and team ratings.`,
      },
    ],
  }),
  component: ConferencePage,
});

function ConferencePage() {
  const { sport, season, current, entry } = useSeasonRoute();
  const confId = Number(Route.useParams().conferenceId);
  const { data } = useSuspenseQuery(conferenceQuery(sport, season, confId, current));
  const { data: all } = useSuspenseQuery(conferencesQuery(sport, season, current));
  const c = data.conference;
  const ranked = all.conferences.filter((x) => x.rank !== null).length;
  const [standSort, setStandSort] = useState<SortingState>([{ id: "conf_win_pct", desc: true }]);
  const [rateSort, setRateSort] = useState<SortingState>([{ id: "net_rtg", desc: true }]);

  const standings = useMemo<StatColumn<ConferenceTeamRow>[]>(() => {
    const wl = (
      id: string,
      header: string,
      w: (r: ConferenceTeamRow) => number,
      l: (r: ConferenceTeamRow) => number,
      group?: string,
    ): StatColumn<ConferenceTeamRow> => ({
      id,
      header,
      group,
      numeric: true,
      value: (r) => (w(r) + l(r) ? w(r) / (w(r) + l(r)) : null),
      format: (_v, r) => fmtRecord(w(r), l(r)),
    });
    return [
      {
        id: "team",
        header: "Team",
        value: (r) => r.name,
        width: 220,
        cell: (r) => (
          <TeamLink
            sport={sport}
            season={season}
            id={r.team_id}
            name={r.short_name ?? r.name}
            slug={r.slug}
            logo={r.logo}
          />
        ),
      },
      wl(
        "conf",
        "W-L",
        (r) => r.conf_wins,
        (r) => r.conf_losses,
        "Conference",
      ),
      {
        id: "conf_win_pct",
        header: "Win%",
        group: "Conference",
        numeric: true,
        value: (r) => r.conf_win_pct,
        format: (v) => fmtWinPct(v as number | null),
      },
      wl(
        "overall",
        "W-L",
        (r) => r.wins,
        (r) => r.losses,
        "Overall",
      ),
      {
        id: "win_pct",
        header: "Win%",
        group: "Overall",
        numeric: true,
        value: (r) => r.win_pct,
        format: (v) => fmtWinPct(v as number | null),
      },
      wl(
        "home",
        "Home",
        (r) => r.home_wins,
        (r) => r.home_losses,
        "Splits",
      ),
      wl(
        "away",
        "Away",
        (r) => r.away_wins,
        (r) => r.away_losses,
        "Splits",
      ),
      wl(
        "neutral",
        "Neutral",
        (r) => r.neutral_wins,
        (r) => r.neutral_losses,
        "Splits",
      ),
    ];
  }, [sport, season]);

  const ratingCols = useMemo(() => teamColumns(sport, season), [sport, season]);
  const hidden = useMemo(
    () =>
      hiddenColumns(
        ratingCols,
        DEFAULT_TEAM_GROUPS.filter((g) => g !== "record"),
      ),
    [ratingCols],
  );

  return (
    <>
      <PageHeader
        title={c.name ?? c.short_name ?? "Conference"}
        subtitle={`${entry.label} · ${c.teams} teams`}
      />
      <CoverageNotice coverage={entry.box_coverage} />
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <RatingCard
          label="Avg. net"
          value={fmtSigned(c.avg_net_rtg)}
          rank={c.rank}
          field={ranked}
          title="Average net rating; rank among conferences"
        />
        <RatingCard label="Avg. ORtg" value={fmt1(c.avg_ortg)} />
        <RatingCard label="Avg. DRtg" value={fmt1(c.avg_drtg)} />
        <RatingCard label="Avg. pace" value={fmt1(c.avg_pace)} />
        <RatingCard
          label="Non-conf"
          value={fmtRecord(c.nonconf_wins, c.nonconf_losses)}
          title="Record vs. other D-I conferences"
        />
      </div>
      <Section title="Standings">
        <StatTable
          data={data.teams}
          columns={standings}
          rowKey={(r) => String(r.team_id)}
          sorting={standSort}
          onSortingChange={setStandSort}
          rank
          caption="Standings"
        />
      </Section>
      <Section title="Team ratings">
        <StatTable
          data={data.teams}
          columns={ratingCols}
          rowKey={(r) => String(r.team_id)}
          sorting={rateSort}
          onSortingChange={setRateSort}
          hidden={hidden}
          rank
          caption="Team ratings"
        />
      </Section>
    </>
  );
}
