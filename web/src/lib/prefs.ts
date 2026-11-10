// Theme + density preferences (spec §3.2-3.3). Stored in cookies so SSR renders the
// right <html> class with no flash and no inline script. No cookie => dark + compact.
import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

export type Theme = "dark" | "light";
export type Density = "compact" | "comfortable";
export interface Prefs {
  theme: Theme;
  density: Density;
}

const ONE_YEAR = 60 * 60 * 24 * 365;

export function parsePrefs(get: (name: string) => string | undefined): Prefs {
  return {
    theme: get("theme") === "light" ? "light" : "dark",
    density: get("density") === "comfortable" ? "comfortable" : "compact",
  };
}

function readDocumentCookie(name: string): string | undefined {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

export const getPrefs = createIsomorphicFn()
  .server((): Prefs => parsePrefs((n) => getCookie(n)))
  .client((): Prefs => parsePrefs(readDocumentCookie));

function writeCookie(name: string, value: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: tiny preference cookie, read by SSR
  document.cookie = `${name}=${value}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`;
}

/** Apply a theme immediately (no reload) and persist it for the next SSR. */
export function setTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(theme);
  writeCookie("theme", theme);
}

export function setDensity(density: Density) {
  document.documentElement.dataset.density = density;
  writeCookie("density", density);
}
