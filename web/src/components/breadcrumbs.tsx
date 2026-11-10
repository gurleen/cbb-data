import { Link, useMatches } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

/** Breadcrumbs from route loader data: any match whose loaderData has `crumb`. */
export function Breadcrumbs() {
  const matches = useMatches();
  // On 404/error renders the server and client disagree about parent loader data;
  // the error page has its own "go home" link, so skip crumbs there.
  const failed = matches.some((m) => m.status === "notFound" || m.status === "error");
  const crumbs = matches
    .map((m) => ({
      id: m.id,
      pathname: m.pathname,
      crumb: (m.loaderData as { crumb?: string } | undefined)?.crumb,
    }))
    .filter((c): c is { id: string; pathname: string; crumb: string } => !!c.crumb)
    // a layout and its index route share a pathname; keep the first
    .filter((c, i, all) => all.findIndex((o) => o.crumb === c.crumb) === i);

  if (failed || crumbs.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-xs text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        {crumbs.map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
            <li>
              {i === crumbs.length - 1 ? (
                <span aria-current="page" className="text-foreground">
                  {c.crumb}
                </span>
              ) : (
                <Link to={c.pathname} className="text-muted-foreground hover:text-foreground">
                  {c.crumb}
                </Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
