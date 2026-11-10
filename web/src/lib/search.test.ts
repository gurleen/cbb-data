import { describe, expect, it } from "vitest";
import type { SearchDoc } from "./api-types";
import { scoreName, search } from "./search";

const doc: SearchDoc = {
  sport: "mbb",
  season: 2026,
  teams: [
    [41, "UConn Huskies", "CONN", "uconn-huskies", "Big East"],
    [150, "Duke Blue Devils", "DUKE", "duke-blue-devils", "ACC"],
    [2509, "Purdue Boilermakers", "PUR", "purdue-boilermakers", "Big Ten"],
  ],
  players: [
    [1, "Cooper Flagg", "cooper-flagg", "DUKE", 150],
    [2, "Ömer Yurtseven", "omer-yurtseven", "GTWN", 46],
    [3, "Alex Karaban", "alex-karaban", "CONN", 41],
  ],
};

describe("search", () => {
  it("ranks exact/prefix/word matches", () => {
    expect(scoreName("Duke Blue Devils", "duke")).toBe(80);
    expect(scoreName("Duke Blue Devils", "blue")).toBe(60);
    expect(scoreName("Duke Blue Devils", "evil")).toBe(40);
    expect(scoreName("Duke Blue Devils", "dbd")).toBe(30);
    expect(scoreName("Duke Blue Devils", "zzz")).toBe(0);
  });
  it("matches abbreviations and accents", () => {
    const [teams] = search(doc, "conn");
    expect(teams[0].id).toBe(41);
    const [, players] = search(doc, "omer");
    expect(players.map((p) => p.id)).toEqual([2]);
  });
  it("returns nothing for empty queries", () => {
    expect(search(doc, "  ")).toEqual([[], []]);
  });
});
