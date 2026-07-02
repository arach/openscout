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
 * match and routeFromUrl() agree (via EXPECTED_SCOUT_VIEW_BY_ROUTE_ID, derived
 * from this list). Adopting a new prefix = adding one entry here.
 *
 * Note: bare /work is deliberately absent — the canonical parser sends it to
 * the inbox default, so only /work/$workId is adopted.
 */
const ADOPTED_SCOUT_PREFIXES: ReadonlyArray<{ path: string; view: Route["view"] }> = [
  { path: "briefings", view: "briefings" },
  { path: "briefings/$briefingId", view: "briefings" },
  { path: "fleet", view: "fleet" },
  { path: "conversations", view: "conversations" },
  { path: "repos", view: "repos" },
  { path: "harnesses", view: "harnesses" },
  { path: "mesh", view: "mesh" },
  { path: "broker", view: "broker" },
  { path: "activity", view: "activity" },
  { path: "search", view: "search" },
  { path: "search/$searchMode", view: "search" },
  { path: "channels", view: "channels" },
  { path: "channels/$channelId", view: "channels" },
  { path: "work/$workId", view: "work" },
  { path: "settings", view: "settings" },
  { path: "settings/agents", view: "settings" },
  { path: "settings/agents/$agentId", view: "settings" },
  // ── Round 3 — remaining deterministic top-level prefixes ──
  // Project registry: every /projects/* shape parses to view "agents-v2".
  { path: "projects", view: "agents-v2" },
  { path: "projects/$projectSlug", view: "agents-v2" },
  { path: "projects/$projectSlug/agents", view: "agents-v2" },
  { path: "projects/$projectSlug/agents/$agentId", view: "agents-v2" },
  { path: "projects/$projectSlug/agents/$agentId/c/$conversationId", view: "agents-v2" },
  { path: "projects/$projectSlug/agents/$agentId/sessions/$sessionId", view: "agents-v2" },
  { path: "projects/$projectSlug/sessions", view: "agents-v2" },
  { path: "projects/$projectSlug/sessions/$sessionId", view: "agents-v2" },
  // Canonical agent detail (the serialized form of an agents-v2 agent route).
  { path: "agents", view: "agents-v2" },
  { path: "agents/$agentId", view: "agents-v2" },
  { path: "agents/$agentId/c/$conversationId", view: "agents-v2" },
  { path: "agents/$agentId/sessions/$sessionId", view: "agents-v2" },
  // Legacy /agents-v2/* input URLs (canonicalize to /agents on serialize, but
  // the parse view is fixed at "agents-v2").
  { path: "agents-v2", view: "agents-v2" },
  { path: "agents-v2/$agentId", view: "agents-v2" },
  { path: "agents-v2/sessions/$sessionId", view: "agents-v2" },
  // Legacy /agents.deprecated/* — view is fixed per shape: the base/agent/chat
  // shapes are the "agents" surface, but the session-resource shape is a session
  // observe surface ("sessions"), so it registers with that view.
  { path: "agents.deprecated", view: "agents" },
  { path: "agents.deprecated/$agentId", view: "agents" },
  { path: "agents.deprecated/$agentId/c/$conversationId", view: "agents" },
  { path: "agents.deprecated/$agentId/sessions/$sessionId", view: "sessions" },
  // Sessions surface.
  { path: "sessions", view: "sessions" },
  { path: "sessions/$sessionId", view: "sessions" },
  // Messages surface (filter/sort ride query params; view is always "messages").
  { path: "messages", view: "messages" },
  { path: "messages/$conversationId", view: "messages" },
  // Conversation + agent-info detail (both require the id segment).
  { path: "c/$conversationId", view: "conversation" },
  { path: "agent/$agentId", view: "agent-info" },
  // Follow: every /follow parse is view "follow" (canonical form is /follow +
  // query; the /follow/{kind}/{id} path form stays on the splat for now).
  { path: "follow", view: "follow" },
  // Terminal: every /terminal/* shape parses to view "terminal".
  { path: "terminal", view: "terminal" },
  { path: "terminal/$agentId", view: "terminal" },
  { path: "terminal/$backend/$sessionName", view: "terminal" },
];

const adoptedScoutRoutes = ADOPTED_SCOUT_PREFIXES.map(({ path }) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    beforeLoad: ({ location }) => ({
      scoutRoute: scoutRouteFromLocation(location.pathname, location.searchStr),
    }),
  }),
);

/** routeId → the Route view the canonical parser must produce for that match. */
export const EXPECTED_SCOUT_VIEW_BY_ROUTE_ID: Record<string, Route["view"]> =
  Object.fromEntries(
    ADOPTED_SCOUT_PREFIXES.map(({ path, view }) => [`/${path}`, view]),
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