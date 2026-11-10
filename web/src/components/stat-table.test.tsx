import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fmt1 } from "@/lib/format";
import { type StatColumn, StatTable } from "./stat-table";

type Row = { id: number; name: string; ortg: number | null; drtg: number | null };
const rows: Row[] = [
  { id: 1, name: "Alpha", ortg: 110.2, drtg: 99.1 },
  { id: 2, name: "Beta", ortg: null, drtg: 95.0 },
  { id: 3, name: "Gamma", ortg: 120.5, drtg: 101.3 },
];
const columns: StatColumn<Row>[] = [
  { id: "name", header: "Team", value: (r) => r.name },
  {
    id: "ortg",
    header: "ORtg",
    group: "Ratings",
    numeric: true,
    value: (r) => r.ortg,
    format: (v) => fmt1(v as number),
  },
  {
    id: "drtg",
    header: "DRtg",
    group: "Ratings",
    numeric: true,
    lowerIsBetter: true,
    value: (r) => r.drtg,
    format: (v) => fmt1(v as number),
  },
];

function render(sorting: { id: string; desc: boolean }[], hidden: string[] = []) {
  return renderToString(
    <StatTable
      data={rows}
      columns={columns}
      rowKey={(r) => String(r.id)}
      sorting={sorting}
      onSortingChange={() => {}}
      hidden={hidden}
      rank
    />,
  );
}
const order = (html: string) => [...html.matchAll(/(Alpha|Beta|Gamma)/g)].map((m) => m[1]);

describe("StatTable (SSR)", () => {
  it("sorts descending with nulls last", () => {
    expect(order(render([{ id: "ortg", desc: true }]))).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  it("keeps nulls last ascending too", () => {
    expect(order(render([{ id: "ortg", desc: false }]))).toEqual(["Alpha", "Gamma", "Beta"]);
  });

  it("renders group headers, aria-sort and formatted cells", () => {
    const html = render([{ id: "drtg", desc: false }]);
    expect(html).toContain("Ratings");
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain("120.5");
    expect(html).toContain("—"); // null ORtg
    expect(order(html)).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("hides columns", () => {
    const html = render([{ id: "ortg", desc: true }], ["drtg"]);
    expect(html).not.toContain("DRtg");
    expect(html).toContain("ORtg");
  });
});

import { percentileFns, toDelimited } from "./stat-table";

describe("shading and export", () => {
  const many: Row[] = Array.from({ length: 11 }, (_, i) => ({
    id: i,
    name: `T${i}`,
    ortg: 100 + i,
    drtg: 100 + i,
  }));
  it("tints high values positive, reversed when lower is better", () => {
    const fns = percentileFns(columns, many, []);
    expect(fns.get("ortg")?.(110)).toContain("--chart-good");
    expect(fns.get("ortg")?.(100)).toContain("--chart-bad");
    expect(fns.get("drtg")?.(100)).toContain("--chart-good");
    expect(fns.get("ortg")?.(105)).toBeUndefined(); // median: no tint
    expect(fns.has("name")).toBe(false);
  });
  it("exports raw values with grouped headers", () => {
    const csv = toDelimited(columns, rows.slice(0, 2), [], ",");
    expect(csv.split("\n")).toEqual([
      "Team,Ratings ORtg,Ratings DRtg",
      "Alpha,110.2,99.1",
      "Beta,,95",
    ]);
    expect(toDelimited(columns, rows.slice(0, 1), ["drtg"], "\t")).toBe(
      "Team\tRatings ORtg\nAlpha\t110.2",
    );
  });
});
