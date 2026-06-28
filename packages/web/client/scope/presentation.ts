import type { Route } from "../lib/types.ts";
import {
  SCOPE_LANE_DECK_PROFILE,
  buildScopeRoutePath,
  isScopePath,
} from "./paths.ts";

export { isScopePath, buildScopeRoutePath } from "./paths.ts";

/** True only on /scope/* (or legacy /scout/* before canonicalization). */
export function isScopePresentation(
  pathname = typeof window !== "undefined" ? window.location.pathname : "",
): boolean {
  return isScopePath(pathname);
}

export function scopeLaneDeckProfileId(): typeof SCOPE_LANE_DECK_PROFILE {
  return SCOPE_LANE_DECK_PROFILE;
}

export function scopePresentationAttrs(active = isScopePresentation()): Record<string, boolean> | undefined {
  return active ? { "data-scope-presentation": true } : undefined;
}

/** Scope URL shape when active; null → Scout paths unchanged. */
export function scopeRoutePath(route: Route): string | null {
  if (!isScopePresentation()) return null;
  return buildScopeRoutePath(route);
}

/** True when the active route should stay under /scope, not a Scout mirror path. */
export function routeBelongsInScopeNamespace(route: Route): boolean {
  return buildScopeRoutePath(route) !== null && isScopePresentation();
}
