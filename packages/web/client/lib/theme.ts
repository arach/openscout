import { readScoutBootstrapTheme } from "./runtime-config.ts";

export type ScoutTheme = "dark" | "light";

function normalizeScoutTheme(value: string | null | undefined): ScoutTheme | null {
  if (value === "dark" || value === "light") {
    return value;
  }

  return null;
}

export function resolveScoutStartupTheme(): ScoutTheme {
  if (typeof window === "undefined") {
    return "dark";
  }

  const bootstrapTheme = normalizeScoutTheme(readScoutBootstrapTheme());
  if (bootstrapTheme) {
    return bootstrapTheme;
  }

  const queryTheme = normalizeScoutTheme(
    new URLSearchParams(window.location.search).get("theme"),
  );
  if (queryTheme) {
    return queryTheme;
  }

  return "dark";
}

export function applyScoutThemeToDocument(theme: ScoutTheme): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.scoutThemeMode = theme;
  document.documentElement.style.colorScheme = theme;
}

/**
 * Native theme bridge. The macOS app hosts the embed routes in a `WKWebView`
 * and passes its *resolved* palette via `?themeVars=<base64url(JSON)>` so the
 * embed renders with the app's actual surfaces / accent / status colors
 * instead of the generic web light/dark. The map is keyed by `--hud-*` CSS
 * variable names; the Provider layers it over `LIGHT_THEME_VARS` /
 * `DARK_THEME_VARS`. Returns null when absent or malformed (web-standalone).
 */
export function resolveScoutNativeThemeVars(): Record<`--${string}`, string> | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = new URLSearchParams(window.location.search).get("themeVars");
  if (!raw) {
    return null;
  }

  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key.startsWith("--") && typeof value === "string") {
        vars[key] = value;
      }
    }
    return Object.keys(vars).length > 0
      ? (vars as Record<`--${string}`, string>)
      : null;
  } catch {
    return null;
  }
}
