import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { NotFound } from "@/components/not-found";
import { TooltipProvider } from "@/components/ui/tooltip";
import { seasonsQuery } from "@/lib/api";
import { SPORTS } from "@/lib/api-types";
import { getPrefs } from "@/lib/prefs";
import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: () => ({ prefs: getPrefs() }),
  // Both seasons docs are tiny and needed by the header on every page.
  loader: ({ context }) =>
    Promise.all(SPORTS.map((s) => context.queryClient.ensureQueryData(seasonsQuery(s)))),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "cbb · college basketball analytics" },
      {
        name: "description",
        content: "Team and player analytics for NCAA Division I men's and women's basketball.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootDocument({ children }: { children: ReactNode }) {
  const { prefs } = Route.useRouteContext();
  return (
    <html lang="en" className={prefs.theme} data-density={prefs.density}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  const { prefs } = Route.useRouteContext();
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-screen flex-col">
        <AppHeader prefs={prefs} />
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-4 lg:px-6">
          <Breadcrumbs />
          <Outlet />
        </main>
        <AppFooter />
      </div>
    </TooltipProvider>
  );
}
