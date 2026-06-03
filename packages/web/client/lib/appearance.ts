// Appearance / look-and-feel preferences.
//
// Self-contained, localStorage-backed. Applies to document.documentElement so
// the Scout theme aliases (--accent, --accent-soft, density, motion) and the
// hudsonkit chrome tokens (--hud-accent*) all pick up operator preferences.
//
// No server endpoint, no operator-profile coupling — this is purely client
// presentation state.

export type ThemePref = "system" | "dark" | "light";
export type DensityPref = "comfortable" | "compact";
export type AccentId = "lime" | "blue" | "violet" | "amber" | "rose";

export type AppearancePrefs = {
  theme: ThemePref;
  density: DensityPref;
  accent: AccentId;
  reduceMotion: boolean;
  markdownPreview: boolean;
};

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  theme: "system",
  density: "comfortable",
  accent: "lime",
  reduceMotion: false,
  markdownPreview: false,
};

const STORAGE_KEY = "openscout.appearance.v1";

// Accent swatches. Hue/chroma chosen to sit in the same oklch family as the
// shipped default (--hud-accent: oklch(0.86 0.17 125)) so chrome stays legible.
export const ACCENTS: { id: AccentId; label: string; hue: number; chroma: number }[] = [
  { id: "lime", label: "Lime", hue: 125, chroma: 0.17 },
  { id: "blue", label: "Blue", hue: 248, chroma: 0.15 },
  { id: "violet", label: "Violet", hue: 300, chroma: 0.15 },
  { id: "amber", label: "Amber", hue: 75, chroma: 0.15 },
  { id: "rose", label: "Rose", hue: 15, chroma: 0.16 },
];

export function accentColor(id: AccentId): string {
  const a = ACCENTS.find((x) => x.id === id) ?? ACCENTS[0];
  return `oklch(0.86 ${a.chroma} ${a.hue})`;
}

function accentSoft(id: AccentId): string {
  const a = ACCENTS.find((x) => x.id === id) ?? ACCENTS[0];
  return `oklch(0.86 ${a.chroma} ${a.hue} / 0.08)`;
}

function isAccentId(v: unknown): v is AccentId {
  return typeof v === "string" && ACCENTS.some((a) => a.id === v);
}

export function loadAppearance(): AppearancePrefs {
  if (typeof window === "undefined") return { ...DEFAULT_APPEARANCE };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    const parsed = JSON.parse(raw) as Partial<AppearancePrefs>;
    return {
      theme:
        parsed.theme === "dark" || parsed.theme === "light" || parsed.theme === "system"
          ? parsed.theme
          : DEFAULT_APPEARANCE.theme,
      density:
        parsed.density === "compact" || parsed.density === "comfortable"
          ? parsed.density
          : DEFAULT_APPEARANCE.density,
      accent: isAccentId(parsed.accent) ? parsed.accent : DEFAULT_APPEARANCE.accent,
      reduceMotion:
        typeof parsed.reduceMotion === "boolean" ? parsed.reduceMotion : DEFAULT_APPEARANCE.reduceMotion,
      markdownPreview:
        typeof parsed.markdownPreview === "boolean"
          ? parsed.markdownPreview
          : DEFAULT_APPEARANCE.markdownPreview,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(prefs: AppearancePrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable (private mode / quota) — keep in-memory prefs */
  }
}

function resolveTheme(theme: ThemePref): "dark" | "light" {
  if (theme === "dark" || theme === "light") return theme;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

/**
 * Write appearance prefs onto <html>. CSS in settings-appearance.css reads
 * these dataset/custom-prop hooks; the accent vars use !important to win over
 * the inline --hud-accent set on the [data-scout-theme] wrapper.
 */
export function applyAppearance(prefs: AppearancePrefs): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const theme = resolveTheme(prefs.theme);

  // Theme: mirror lib/theme.ts contract (data-scout-theme-mode + color-scheme)
  // and expose the operator preference + resolved value as data hooks.
  root.dataset.appTheme = prefs.theme;
  root.dataset.scoutThemeMode = theme;
  root.style.colorScheme = theme;

  // Density + motion + markdown-preview as data hooks.
  root.dataset.appDensity = prefs.density;
  root.dataset.appReduceMotion = prefs.reduceMotion ? "on" : "off";
  root.dataset.appMarkdownPreview = prefs.markdownPreview ? "on" : "off";

  // Accent: drive both the Scout alias bridge and the hudsonkit chrome token.
  const accent = accentColor(prefs.accent);
  const soft = accentSoft(prefs.accent);
  const a = ACCENTS.find((x) => x.id === prefs.accent) ?? ACCENTS[0];
  root.dataset.appAccent = prefs.accent;
  root.style.setProperty("--app-accent", accent);
  root.style.setProperty("--app-accent-soft", soft);
  root.style.setProperty("--app-accent-hue", String(a.hue));
  root.style.setProperty("--hud-accent", accent);
  root.style.setProperty("--hud-accent-soft", soft);
}

let mediaListenerBound = false;

/**
 * Apply once on boot and keep "system" theme in sync with the OS. Returns a
 * cleanup function. Safe to call multiple times — only one media listener is
 * registered per process.
 */
export function initAppearance(): () => void {
  if (typeof window === "undefined") return () => {};
  const prefs = loadAppearance();
  applyAppearance(prefs);

  if (mediaListenerBound || !window.matchMedia) return () => {};
  const mql = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => {
    const current = loadAppearance();
    if (current.theme === "system") applyAppearance(current);
  };
  mql.addEventListener("change", onChange);
  mediaListenerBound = true;
  return () => {
    mql.removeEventListener("change", onChange);
    mediaListenerBound = false;
  };
}
