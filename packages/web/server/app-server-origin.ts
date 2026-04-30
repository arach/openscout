import { hostname as osHostname } from "node:os";

import { resolveScoutWebMdnsHostname } from "@openscout/runtime/local-config";

export type OpenScoutWebApplicationServerIdentity = {
  advertisedHost: string;
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
  machineHostname = osHostname(),
): OpenScoutWebApplicationServerIdentity {
  const advertisedHost =
    env.OPENSCOUT_WEB_ADVERTISED_HOST?.trim()
    || resolveScoutWebMdnsHostname(machineHostname);
  const publicOrigin = env.OPENSCOUT_WEB_PUBLIC_ORIGIN?.trim() || undefined;
  const publicOriginHost = hostFromOrigin(publicOrigin);

  return {
    advertisedHost,
    publicOrigin,
    trustedHosts: uniq([
      advertisedHost,
      publicOriginHost,
      ...splitList(env.OPENSCOUT_WEB_TRUSTED_HOSTS),
    ]),
    trustedOrigins: uniq([
      publicOrigin,
      ...splitList(env.OPENSCOUT_WEB_TRUSTED_ORIGINS),
    ]),
  };
}
