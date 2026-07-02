import { createRootRoute, createRoute, redirect } from "@tanstack/react-router";
import { canonicalizeScopePathname } from "../../scope/paths.ts";
import {
  canonicalScoutHrefFromLocation,
  scoutRouteFromLocation,
} from "../../lib/router.ts";
import { ScoutAppRoot } from "./ScoutAppRoot.tsx";
import { ADOPTED_SCOUT_PREFIXES } from "./adopted-scout-routes.ts";
export { EXPECTED_SCOUT_VIEW_BY_ROUTE_ID } from "./adopted-scout-routes.ts";

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
    const canonicalHref = canonicalScoutHrefFromLocation(
      location.pathname,
      location.searchStr,
      location.hash,
    );
    if (canonicalHref) {
      throw redirect({ href: canonicalHref });
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

const adoptedScoutRoutes = ADOPTED_SCOUT_PREFIXES.map(({ path }) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    beforeLoad: ({ location }) => ({
      scoutRoute: scoutRouteFromLocation(location.pathname, location.searchStr),
    }),
  }),
);

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

/** Catch-all Scout URLs (/ops, /repo-diff, /follow/{kind}/{id}, …). */
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
  ...adoptedScoutRoutes,
  scoutLegacyRoute,
  scoutSplatRoute,
]);

export type ScoutRouteTree = typeof scoutRouteTree;
