import { readScoutBootstrapTheme } from "./runtime-config.ts";

export type ScoutTheme = "dark" | "light";
export type ScoutThemePreference = "dark" | "light" | "system";
export type ScoutThemeTemplate = "hudson" | "editorial" | "drafting";

export const SCOUT_THEME_STORAGE_KEY = "openscout.theme";
export const SCOUT_DEFAULT_THEME_TEMPLATE: ScoutThemeTemplate = "hudson";

export function normalizeScoutThemePreference(
  value: string | null | undefined,
): ScoutThemePreference | null {
  if (value === "dark" || value === "light" || value === "system") {
    return value;
  }

  return null;
}

export function normalizeScoutThemeTemplate(
  value: string | null | undefined,
): ScoutThemeTemplate | null {
  if (value === "hudson" || value === "editorial" || value === "drafting") {
    return value;
  }

  return null;
}

function readStoredAppearance(): {
  theme?: ScoutThemePreference;
  template?: ScoutThemeTemplate;
} {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SCOUT_THEME_STORAGE_KEY) || "{}") as {
      theme?: string;
      template?: string;
    };
    return {
      theme: normalizeScoutThemePreference(parsed.theme) ?? undefined,
      template: normalizeScoutThemeTemplate(parsed.template) ?? undefined,
    };
  } catch {
    return {};
  }
}

export function resolveScoutThemePreference(
  preference: ScoutThemePreference,
  prefersDark = typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : true,
): ScoutTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

export function resolveScoutStartupTheme(): ScoutTheme {
  if (typeof window === "undefined") {
    return "dark";
  }

  const queryTheme = normalizeScoutThemePreference(
    new URLSearchParams(window.location.search).get("theme"),
  );
  if (queryTheme) {
    return resolveScoutThemePreference(queryTheme);
  }

  const storedTheme = readStoredAppearance().theme;
  if (storedTheme) {
    return resolveScoutThemePreference(storedTheme);
  }

  const bootstrapTheme = normalizeScoutThemePreference(readScoutBootstrapTheme());
  if (bootstrapTheme) {
    return resolveScoutThemePreference(bootstrapTheme);
  }

  return "dark";
}

export function resolveScoutStartupTemplate(): ScoutThemeTemplate {
  if (typeof window === "undefined") return SCOUT_DEFAULT_THEME_TEMPLATE;
  const queryTemplate = normalizeScoutThemeTemplate(
    new URLSearchParams(window.location.search).get("template"),
  );
  return queryTemplate
    ?? readStoredAppearance().template
    ?? SCOUT_DEFAULT_THEME_TEMPLATE;
}

export function applyScoutThemeToDocument(
  theme: ScoutTheme,
  template: ScoutThemeTemplate = resolveScoutStartupTemplate(),
): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.scoutThemeMode = theme;
  document.documentElement.dataset.hudsonTheme = theme;
  document.documentElement.dataset.hudsonTemplate = template;
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
