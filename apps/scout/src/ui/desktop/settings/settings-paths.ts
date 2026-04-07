/**
 * URL layout for Settings (desktop). Keep in sync with SettingsSectionId usage in App.
 * Other app surfaces still use in-memory activeView until migrated.
 */
export const SETTINGS_SECTION_IDS = [
  "profile",
  "knowledge",
  "agents",
  "workspaces",
  "communication",
  "database",
  "appearance",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}

/** Path for a settings subsection, e.g. /settings/agents */
export function settingsPath(section: SettingsSectionId): string {
  return `/settings/${section}`;
}

/**
 * Parse /settings and /settings/:section. Unknown segments yield null (caller may redirect).
 */
export function parseSettingsPath(pathname: string): SettingsSectionId | null {
  if (pathname === "/settings" || pathname === "/settings/") {
    return "profile";
  }
  if (!pathname.startsWith("/settings/")) {
    return null;
  }
  const segment = pathname.slice("/settings/".length).split("/")[0] ?? "";
  if (!segment) {
    return "profile";
  }
  return isSettingsSectionId(segment) ? segment : null;
}
