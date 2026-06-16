import { resolveHost, resolveWebPort } from "@openscout/runtime/local-config";

import type { ScoutCommandContext } from "./context.ts";
import { ScoutCliError } from "./errors.ts";

export function resolveScoutWebApiBaseUrl(env: NodeJS.ProcessEnv): string {
  const configured = env.OPENSCOUT_WEB_URL?.trim() || env.SCOUT_WEB_URL?.trim();
  if (configured) return configured.replace(/\/+$/u, "");
  return `http://${resolveHost()}:${resolveWebPort()}`;
}

export async function readScoutWebJson<T>(
  context: ScoutCommandContext,
  path: string,
): Promise<T> {
  const baseUrl = resolveScoutWebApiBaseUrl(context.env);
  const response = await fetch(new URL(path, baseUrl));
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`.trim();
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) detail = body.error.trim();
    } catch {
      // Keep the HTTP status detail.
    }
    throw new ScoutCliError(`Scout web API request failed: ${detail}`);
  }
  return await response.json() as T;
}
