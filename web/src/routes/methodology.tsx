import { createFileRoute } from "@tanstack/react-router";
import { marked } from "marked";
import { PageHeader } from "@/components/page";
// Single source of truth: the repo's docs/metrics.md, bundled at build time.
import metrics from "../../../docs/metrics.md?raw";

// Trusted, repo-authored content, rendered once at module load.
const html = marked.parse(metrics.replace(/^# .*\n/, ""), { async: false }) as string;

export const Route = createFileRoute("/methodology")({
  head: () => ({
    meta: [
      { title: "Methodology · cbb" },
      {
        name: "description",
        content: "How cbb computes possessions, ratings, player stats and ranks.",
      },
    ],
  }),
  component: () => (
    <div className="max-w-3xl">
      <PageHeader title="Methodology" subtitle="Formulas, game rules and data caveats" />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static markdown from this repo */}
      <article className="prose-cbb" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  ),
});
