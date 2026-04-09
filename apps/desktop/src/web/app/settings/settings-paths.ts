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
export type ParsedSettingsPath = {
  section: SettingsSectionId;
  agentId: string | null;
};

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}

/** Path for a settings subsection, e.g. /settings/agents or /settings/agents/:id */
export function settingsPath(section: SettingsSectionId, options?: { agentId?: string | null }): string {
  const agentId = options?.agentId?.trim();
  if (section === "agents" && agentId) {
    return `/settings/agents/${encodeURIComponent(agentId)}`;
  }
  return `/settings/${section}`;
}

/**
 * Parse /settings, /settings/:section, and /settings/agents/:id.
 * Unknown segments yield null (caller may redirect).
 */
export function parseSettingsPath(pathname: string): ParsedSettingsPath | null {
  if (pathname === "/settings" || pathname === "/settings/") {
    return { section: "profile", agentId: null };
  }
  if (!pathname.startsWith("/settings/")) {
    return null;
  }
  const segments = pathname.slice("/settings/".length).split("/").filter(Boolean);
  const segment = segments[0] ?? "";
  if (!segment) {
    return { section: "profile", agentId: null };
  }
  if (!isSettingsSectionId(segment)) {
    return null;
  }
  if (segment !== "agents") {
    return segments.length === 1 ? { section: segment, agentId: null } : null;
  }
  if (segments.length === 1) {
    return { section: "agents", agentId: null };
  }
  if (segments.length === 2) {
    try {
      return { section: "agents", agentId: decodeURIComponent(segments[1] ?? "") || null };
    } catch {
      return null;
    }
  }
  return null;
}
