// Client-side search over the per-season index (spec §7.2).
import type { SearchDoc } from "./api-types";

export interface SearchHit {
  kind: "team" | "player";
  id: number;
  name: string;
  slug: string;
  sub: string | null;
  score: number;
}

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Score a name against a query: exact > prefix > word prefix > substring > initials. */
export function scoreName(name: string, q: string): number {
  const n = norm(name);
  if (!q) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  const words = n.split(/[\s.'-]+/);
  if (words.some((w) => w.startsWith(q))) return 60;
  if (n.includes(q)) return 40;
  const initials = words.map((w) => w[0] ?? "").join("");
  if (q.length >= 2 && initials.startsWith(q)) return 30;
  return 0;
}

export function search(doc: SearchDoc, query: string, limit = 8): SearchHit[][] {
  const q = norm(query.trim());
  if (!q) return [[], []];
  const teams: SearchHit[] = [];
  for (const [id, name, abbr, slug, conf] of doc.teams) {
    const s = Math.max(scoreName(name, q), abbr && norm(abbr) === q ? 90 : 0);
    if (s) teams.push({ kind: "team", id, name, slug, sub: conf, score: s });
  }
  const players: SearchHit[] = [];
  for (const [id, name, slug, team] of doc.players) {
    const s = scoreName(name, q);
    if (s) players.push({ kind: "player", id, name, slug, sub: team, score: s });
  }
  const by = (a: SearchHit, b: SearchHit) => b.score - a.score || a.name.localeCompare(b.name);
  return [teams.sort(by).slice(0, limit), players.sort(by).slice(0, limit)];
}
