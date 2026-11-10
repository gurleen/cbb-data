import { QueryClient } from "@tanstack/react-query";
import { createRouter, parseSearchWith, stringifySearchWith } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { ErrorPage } from "./components/error-page";
import { NotFound } from "./components/not-found";
import { ApiError } from "./lib/api";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // One QueryClient per request on the server; the integration dehydrates it into the
  // HTML and hydrates it on the client.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // 404s are answers, not failures: don't retry them.
        retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
        refetchOnWindowFocus: false,
      },
    },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    // Let React Query own caching; loaders just ensure data is present.
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 150,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: ErrorPage,
    // Plain query strings (?conf=4,7&page=2): every search param here is a flat string or
    // number, and route schemas coerce them. The default JSON encoding would quote
    // number-like strings (conf="4").
    parseSearch: parseSearchWith((v) => v),
    stringifySearch: stringifySearchWith(JSON.stringify),
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
