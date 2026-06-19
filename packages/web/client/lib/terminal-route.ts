import { surfacePartsFromKey } from "./terminal-sessions.ts";
import type { Route } from "./types.ts";

export type TerminalRoute = Extract<Route, { view: "terminal" }>;

export function terminalRoutePath(route: TerminalRoute): string {
  if (route.agentId) {
    const params = new URLSearchParams();
    if (route.mode) params.set("mode", route.mode);
    return `/terminal/${encodeURIComponent(route.agentId)}${searchSuffix(params)}`;
  }

  const params = new URLSearchParams();
  if (route.mode) params.set("mode", route.mode);
  const surfaceParts = surfacePartsFromKey(route.terminalSurfaceKey);
  if (surfaceParts) {
    return `/terminal/${encodeURIComponent(surfaceParts.backend)}/${encodeURIComponent(surfaceParts.sessionName)}${searchSuffix(params)}`;
  }
  if (route.terminalSessionId) params.set("session", route.terminalSessionId);
  if (route.terminalSurfaceKey) params.set("surface", route.terminalSurfaceKey);
  return `/terminal${searchSuffix(params)}`;
}

function searchSuffix(params: URLSearchParams): string {
  const search = params.toString();
  return search ? `?${search}` : "";
}
