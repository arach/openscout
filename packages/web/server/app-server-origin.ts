import { hostname as osHostname } from "node:os";

import {
  DEFAULT_SCOUT_WEB_PORTAL_HOST,
  loadLocalConfig,
  resolveConfiguredScoutWebHostname,
  resolveScoutWebNamedHostname,
  type LocalConfig,
} from "@openscout/runtime/local-config";

export type OpenScoutWebApplicationServerIdentity = {
  advertisedHost: string;
  portalHost: string;
  publicOrigin?: string;
  trustedHosts: string[];
  trustedOrigins: string[];
};

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function hostFromOrigin(value: string | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function uniq(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function resolveOpenScoutWebApplicationServerIdentity(
  env: NodeJS.ProcessEnv = process.env,
  _machineHostname = osHostname(),
  config: Pick<LocalConfig, "webLocalName"> = loadLocalConfig(),
): OpenScoutWebApplicationServerIdentity {
  const configuredName = env.OPENSCOUT_WEB_LOCAL_NAME?.trim();
  const portalHost = resolveScoutWebNamedHostname(env.OPENSCOUT_WEB_PORTAL_HOST?.trim() || DEFAULT_SCOUT_WEB_PORTAL_HOST);
  const advertisedHost =
    env.OPENSCOUT_WEB_ADVERTISED_HOST?.trim()
    || (configuredName ? resolveScoutWebNamedHostname(configuredName) : undefined)
    || resolveConfiguredScoutWebHostname(config, _machineHostname);
  const publicOrigin = env.OPENSCOUT_WEB_PUBLIC_ORIGIN?.trim() || undefined;
  const publicOriginHost = hostFromOrigin(publicOrigin);

  return {
    advertisedHost,
    portalHost,
    publicOrigin,
    trustedHosts: uniq([
      advertisedHost,
      portalHost,
      publicOriginHost,
      ...splitList(env.OPENSCOUT_WEB_TRUSTED_HOSTS),
    ]),
    trustedOrigins: uniq([
      publicOrigin,
      ...splitList(env.OPENSCOUT_WEB_TRUSTED_ORIGINS),
    ]),
  };
}
