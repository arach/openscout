export type SiteTheme = "light" | "dark";
export type SiteThemePreference = SiteTheme | "auto";

export const SITE_THEME_COOKIE = "openscout-site-theme";
export const SITE_THEME_QUERY_PARAM = "theme";

function normalizeHost(host: string | null | undefined) {
  return (host ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

export function normalizeThemePreference(
  value: string | null | undefined,
): SiteThemePreference {
  if (value === "light" || value === "dark" || value === "auto") {
    return value;
  }

  return "auto";
}

export function isProductionSiteHost(host: string | null | undefined) {
  const normalizedHost = normalizeHost(host);
  return (
    normalizedHost === "openscout.app"
    || normalizedHost === "www.openscout.app"
    || normalizedHost.endsWith(".openscout.app")
  );
}

export function defaultSiteThemeForHost(
  host: string | null | undefined,
): SiteTheme {
  return isProductionSiteHost(host) ? "dark" : "light";
}

export function resolveSiteTheme(
  host: string | null | undefined,
  preference: string | null | undefined,
): SiteTheme {
  const normalizedPreference = normalizeThemePreference(preference);
  if (normalizedPreference === "auto") {
    return defaultSiteThemeForHost(host);
  }

  return normalizedPreference;
}

export const SITE_THEME_INIT_SCRIPT = `(() => {
  const cookieName = ${JSON.stringify(SITE_THEME_COOKIE)};
  const queryParamName = ${JSON.stringify(SITE_THEME_QUERY_PARAM)};
  const readCookie = (name) => {
    const match = document.cookie
      .split("; ")
      .find((part) => part.startsWith(name + "="));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
  };
  const normalizeHost = (host) =>
    (host || "")
      .trim()
      .toLowerCase()
      .replace(/:\\d+$/, "");
  const normalizePreference = (value) =>
    value === "light" || value === "dark" || value === "auto" ? value : "auto";
  const isProductionSiteHost = (host) => {
    const normalizedHost = normalizeHost(host);
    return normalizedHost === "openscout.app"
      || normalizedHost === "www.openscout.app"
      || normalizedHost.endsWith(".openscout.app");
  };
  const params = new URLSearchParams(window.location.search);
  const defaultTheme = isProductionSiteHost(window.location.host) ? "dark" : "light";
  const preference = normalizePreference(
    params.get(queryParamName) ?? readCookie(cookieName),
  );
  document.documentElement.dataset.siteThemePreference = preference;
  document.documentElement.dataset.siteTheme =
    preference === "auto" ? defaultTheme : preference;
})();`;
