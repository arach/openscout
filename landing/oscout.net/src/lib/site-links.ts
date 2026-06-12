export const siteBaseUrl = "https://oscout.net";
export const legacySiteBaseUrl = "https://openscout.app";

export const productionSiteHosts = [
  "oscout.net",
  "www.oscout.net",
  "openscout.app",
  "www.openscout.app",
] as const;

export const productionSiteHostSuffixes = [
  ".oscout.net",
  ".openscout.app",
] as const;

export const githubRepoUrl = "https://github.com/arach/openscout";
export const githubRawBaseUrl = "https://raw.githubusercontent.com/arach/openscout/main";
export const githubReleasesUrl = `${githubRepoUrl}/releases`;
export const githubIssuesUrl = `${githubRepoUrl}/issues`;
export const npmPackageUrl = "https://www.npmjs.com/package/@openscout/scout";

export const meshFrontDoorBaseUrl = normalizeBaseUrl(
  process.env.NEXT_PUBLIC_OPENSCOUT_MESH_FRONT_DOOR_URL,
  "https://mesh.oscout.net",
);

export const nativeAuthReturnToPath = "/v1/auth/native/complete";
export const githubNativeAuthStartUrl = buildNativeAuthStartUrl();

export function absoluteSiteUrl(path = "/") {
  return new URL(path, siteBaseUrl).toString();
}

export function isOpenScoutProductionHost(host: string | null | undefined) {
  const normalizedHost = normalizeHost(host);
  return (
    productionSiteHosts.includes(normalizedHost as (typeof productionSiteHosts)[number])
    || productionSiteHostSuffixes.some((suffix) => normalizedHost.endsWith(suffix))
  );
}

function buildNativeAuthStartUrl() {
  const url = new URL("/v1/auth/github/start", meshFrontDoorBaseUrl);
  url.searchParams.set("return_to", nativeAuthReturnToPath);
  return url.toString();
}

function normalizeBaseUrl(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim() || fallback;
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function normalizeHost(host: string | null | undefined) {
  return (host ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}
