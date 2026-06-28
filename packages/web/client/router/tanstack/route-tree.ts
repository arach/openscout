import { createRootRoute, createRoute, redirect } from "@tanstack/react-router";
import { canonicalizeScopePathname } from "../../scope/paths.ts";
import { ScoutAppRoot } from "./ScoutAppRoot.tsx";

/**
 * TanStack route tree for OpenScout.
 *
 * Scope product URLs are explicit children under /scope. Everything else is
 * handled by the root splat ($) and parsed by routeFromUrl() in lib/router.ts.
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
  scoutLegacyRoute,
  scoutSplatRoute,
]);

export type ScoutRouteTree = typeof scoutRouteTree;