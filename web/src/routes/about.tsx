import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page";

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [{ title: "About · cbb" }] }),
  component: About,
});

function About() {
  return (
    <div className="max-w-2xl">
      <PageHeader title="About" />
      <p className="mb-2">
        Team and player analytics for NCAA Division I men's and women's college basketball.
      </p>
      <p className="text-muted-foreground">
        Data comes from ESPN via the{" "}
        <a href="https://github.com/sportsdataverse/sportsdataverse-data" rel="noreferrer">
          sportsdataverse
        </a>{" "}
        releases and is refreshed daily during the season.
      </p>
    </div>
  );
}
