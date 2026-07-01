import { createRootRoute, createRoute, redirect } from "@tanstack/react-router";
import { canonicalizeScopePathname } from "../../scope/paths.ts";
import { scoutRouteFromLocation } from "../../lib/router.ts";
import type { Route } from "../../lib/types.ts";
import { ScoutAppRoot } from "./ScoutAppRoot.tsx";

/**
 * TanStack route tree for OpenScout.
 *
 * Scope product URLs are explicit children under /scope. Scout prefixes are
 * being adopted as explicit routes the same way (see the adopted block below);
 * anything not yet adopted is handled by the root splat ($) and parsed by
 * routeFromUrl() in lib/router.ts.
 */
const rootRoute = createRootRoute({
  component: ScoutAppRoot,
  beforeLoad: ({ location }) => {
    const pathname = canonicalizeScopePathname(location.pathname);
    if (pathname !== location.pathname) {
      throw redirect({
        href: `${pathname}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
      });
    }
  },
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
});

const scopeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "scope",
});

const scopeIndexRoute = createRoute({
  getParentRoute: () => scopeRoute,
  path: "/",
});

const scopeLanesRoute = createRoute({
  getParentRoute: () => scopeRoute,
  path: "lanes",
});

const scopeSessionsRoute = createRoute({
  getParentRoute: () => scopeRoute,
  path: "sessions",
});

const scopeSessionDetailRoute = createRoute({
  getParentRoute: () => scopeRoute,
  path: "sessions/$sessionId",
});

const scopeTailRoute = createRoute({
  getParentRoute: () => scopeRoute,
  path: "tail",
});

const scopeAgentsRoute = createRoute({
  getParentRoute: () => scopeRoute,
  path: "agents",
});

/**
 * Adopted Scout prefixes — explicit TanStack routes over the same URLs the
 * canonical parser owns. beforeLoad parses the canonical Route and exposes it
 * in router context; the dev parity oracle in router.ts asserts TanStack's
 * match and routeFromUrl() agree. When adopting a new prefix, add its routes
 * here and its expected view to EXPECTED_SCOUT_VIEW_BY_ROUTE_ID.
 */
const briefingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "briefings",
  beforeLoad: ({ location }) => ({
    scoutRoute: scoutRouteFromLocation(location.pathname, location.searchStr),
  }),
});

const briefingDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "briefings/$briefingId",
  beforeLoad: ({ location }) => ({
    scoutRoute: scoutRouteFromLocation(location.pathname, location.searchStr),
  }),
});

/** routeId → the Route view the canonical parser must produce for that match. */
export const EXPECTED_SCOUT_VIEW_BY_ROUTE_ID: Record<string, Route["view"]> = {
  "/briefings": "briefings",
  "/briefings/$briefingId": "briefings",
};

/** Legacy /scout/* → canonical /scope/* */
const scoutLegacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "scout/$",
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `${canonicalizeScopePathname(location.pathname)}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
    });
  },
});

/** Catch-all Scout URLs (/projects, /c, /sessions, /ops, …). */
const scoutSplatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
});

export const scoutRouteTree = rootRoute.addChildren([
  indexRoute,
  scopeRoute.addChildren([
    scopeIndexRoute,
    scopeLanesRoute,
    scopeSessionsRoute,
    scopeSessionDetailRoute,
    scopeTailRoute,
    scopeAgentsRoute,
  ]),
  briefingsRoute,
  briefingDetailRoute,
  scoutLegacyRoute,
  scoutSplatRoute,
]);

export type ScoutRouteTree = typeof scoutRouteTree;