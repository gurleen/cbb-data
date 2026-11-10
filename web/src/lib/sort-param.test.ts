import { describe, expect, it } from "vitest";
import { parseSortParam, sortParam } from "./sort-param";

describe("sort param", () => {
  const fallback = [{ id: "net_rtg", desc: true }];
  it("round-trips", () => {
    const s = [
      { id: "net_rtg", desc: true },
      { id: "ppg", desc: false },
    ];
    expect(sortParam(s)).toBe("-net_rtg,ppg");
    expect(parseSortParam("-net_rtg,ppg", fallback)).toEqual(s);
  });
  it("falls back on empty or junk", () => {
    expect(parseSortParam(undefined, fallback)).toBe(fallback);
    expect(parseSortParam("DROP TABLE;", fallback)).toBe(fallback);
  });
});
