import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon, PageHeader } from "@/components/page";

export const Route = createFileRoute("/methodology")({
  head: () => ({ meta: [{ title: "Methodology · cbb" }] }),
  component: () => (
    <div className="max-w-2xl">
      <PageHeader title="Methodology" />
      <ComingSoon phase={6}>
        Formulas and coverage notes (docs/metrics.md) will render here.
      </ComingSoon>
    </div>
  ),
});
