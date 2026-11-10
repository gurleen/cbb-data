import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { isSport, SPORT_LABEL } from "@/lib/season-context";

export const Route = createFileRoute("/$sport")({
  beforeLoad: ({ params }) => {
    if (!isSport(params.sport)) throw notFound();
  },
  loader: ({ params }) => ({ crumb: SPORT_LABEL[params.sport as "mbb" | "wbb"] }),
  component: Outlet,
});
