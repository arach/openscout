import type { Route } from "../lib/types.ts";
import { SCOPE_BRAND_LABEL, SCOPE_ROUTE_SEGMENTS } from "../../shared/scope-integration.js";
import type { TopNavItem, TopNavKey } from "../scout/topNavConfig.ts";
import { routeToScopeSegment, segmentToRoute, type ScopeRouteSegment } from "./paths.ts";

const SCOPE_NAV_REGISTRY: ReadonlyArray<{
  key: TopNavKey;
  label: string;
  segment: ScopeRouteSegment;
}> = [
  { key: "lanes", label: "Lanes", segment: SCOPE_ROUTE_SEGMENTS.lanes },
  { key: "sessions", label: "Sessions", segment: SCOPE_ROUTE_SEGMENTS.sessions },
  { key: "tail", label: "Tail", segment: SCOPE_ROUTE_SEGMENTS.tail },
  { key: "agents", label: "Agents", segment: SCOPE_ROUTE_SEGMENTS.agents },
];

export const SCOPE_TOP_NAV_ITEMS: TopNavItem[] = SCOPE_NAV_REGISTRY.map((entry) => ({
  key: entry.key,
  label: entry.label,
  route: segmentToRoute(entry.segment),
}));

export function scopeTopNavKeyForRoute(route: Route): TopNavKey {
  const segment = routeToScopeSegment(route);
  return SCOPE_NAV_REGISTRY.find((entry) => entry.segment === segment)?.key ?? "lanes";
}

/** Active Scope section label derived from the route→segment mapping. */
export function scopePresentationTitle(route: Route): string {
  const segment = routeToScopeSegment(route);
  return SCOPE_NAV_REGISTRY.find((entry) => entry.segment === segment)?.label ?? SCOPE_BRAND_LABEL;
}