/** Season = ENDING year. Aug-Dec -> next year, Jan-Jul -> this year (matches the ETL). */
export function currentSeason(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 7 ? year + 1 : year;
}

export const SPORTS = ["mbb", "wbb"] as const;
export type Sport = (typeof SPORTS)[number];

export function isSport(value: string): value is Sport {
  return (SPORTS as readonly string[]).includes(value);
}

export function isSeason(value: string): boolean {
  return /^\d{4}$/.test(value);
}
