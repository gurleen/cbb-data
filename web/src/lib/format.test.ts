import { describe, expect, it } from "vitest";
import {
  DASH,
  fmt1,
  fmtDate,
  fmtInt,
  fmtMadeAtt,
  fmtOrdinal,
  fmtPct,
  fmtRecord,
  fmtSigned,
  fmtWinPct,
  seasonLabel,
} from "./format";

describe("format", () => {
  it("1-decimal values", () => {
    expect(fmt1(76.6)).toBe("76.6");
    expect(fmt1(115)).toBe("115.0");
    expect(fmt1(null)).toBe(DASH);
    expect(fmt1(Number.NaN)).toBe(DASH);
  });

  it("integers", () => {
    expect(fmtInt(3064)).toBe("3,064");
    expect(fmtInt(undefined)).toBe(DASH);
  });

  it("percentages from fractions", () => {
    expect(fmtPct(0.472)).toBe("47.2");
    expect(fmtPct(1)).toBe("100.0");
    expect(fmtPct(0)).toBe("0.0");
    expect(fmtPct(null)).toBe(DASH);
  });

  it("win pct", () => {
    expect(fmtWinPct(0.85)).toBe(".850");
    expect(fmtWinPct(1)).toBe("1.000");
    expect(fmtWinPct(0)).toBe(".000");
  });

  it("signed", () => {
    expect(fmtSigned(17.24)).toBe("+17.2");
    expect(fmtSigned(-3.4)).toBe("-3.4");
    expect(fmtSigned(0)).toBe("0.0");
    expect(fmtSigned(-0.01)).toBe("0.0");
  });

  it("records and made-attempted", () => {
    expect(fmtRecord(34, 6)).toBe("34-6");
    expect(fmtRecord(null, 6)).toBe(DASH);
    expect(fmtMadeAtt(27.8, 58.9, true)).toBe("27.8-58.9");
    expect(fmtMadeAtt(1112, 2354, false)).toBe("1,112-2,354");
  });

  it("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111, 112, 365].map(fmtOrdinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "101st",
      "111th",
      "112th",
      "365th",
    ]);
  });

  it("season labels and dates", () => {
    expect(seasonLabel(2026)).toBe("2025-26");
    expect(seasonLabel(2000)).toBe("1999-00");
    expect(fmtDate("2026-11-10T07:02:00Z")).toBe("Nov 10, 2026");
    expect(fmtDate(null)).toBe(DASH);
  });
});
