export type ScoutTheme = "dark" | "light";

type ScoutBootstrap = {
  theme?: ScoutTheme;
};

declare global {
  interface Window {
    __OPENSCOUT_WEB_BOOTSTRAP__?: ScoutBootstrap;
  }
}

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

  const bootstrapTheme = normalizeScoutTheme(window.__OPENSCOUT_WEB_BOOTSTRAP__?.theme);
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
