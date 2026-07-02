import type { Route } from "../../lib/types.ts";

/**
 * Explicit TanStack routes over URLs owned by the canonical Scout parser.
 * Adopting a new prefix means adding one entry here.
 */
export const ADOPTED_SCOUT_PREFIXES: ReadonlyArray<{ path: string; view: Route["view"] }> = [
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
  { path: "ops", view: "ops" },
  { path: "ops/$mode", view: "ops" },
  { path: "channels", view: "channels" },
  { path: "channels/$channelId", view: "channels" },
  { path: "work/$workId", view: "work" },
  { path: "settings", view: "settings" },
  { path: "settings/agents", view: "settings" },
  { path: "settings/agents/$agentId", view: "settings" },
  { path: "projects", view: "agents-v2" },
  { path: "projects/$projectSlug", view: "agents-v2" },
  { path: "projects/$projectSlug/agents", view: "agents-v2" },
  { path: "projects/$projectSlug/agents/$agentId", view: "agents-v2" },
  { path: "projects/$projectSlug/agents/$agentId/c/$conversationId", view: "agents-v2" },
  { path: "projects/$projectSlug/agents/$agentId/sessions/$sessionId", view: "agents-v2" },
  { path: "projects/$projectSlug/sessions", view: "agents-v2" },
  { path: "projects/$projectSlug/sessions/$sessionId", view: "agents-v2" },
  { path: "agents", view: "agents-v2" },
  { path: "agents/$agentId", view: "agents-v2" },
  { path: "agents/$agentId/c/$conversationId", view: "agents-v2" },
  { path: "agents/$agentId/sessions/$sessionId", view: "agents-v2" },
  { path: "agents-v2", view: "agents-v2" },
  { path: "agents-v2/$agentId", view: "agents-v2" },
  { path: "agents-v2/sessions/$sessionId", view: "agents-v2" },
  { path: "agents.deprecated", view: "agents" },
  { path: "agents.deprecated/$agentId", view: "agents" },
  { path: "agents.deprecated/$agentId/c/$conversationId", view: "agents" },
  { path: "agents.deprecated/$agentId/sessions/$sessionId", view: "sessions" },
  { path: "sessions", view: "sessions" },
  { path: "sessions/$sessionId", view: "sessions" },
  { path: "messages", view: "messages" },
  { path: "messages/$conversationId", view: "messages" },
  { path: "c/$conversationId", view: "conversation" },
  { path: "agent/$agentId", view: "agent-info" },
  { path: "follow", view: "follow" },
  { path: "terminal", view: "terminal" },
  { path: "terminal/$agentId", view: "terminal" },
  { path: "terminal/$backend/$sessionName", view: "terminal" },
];

/** routeId -> the Route view the canonical parser must produce for that match. */
export const EXPECTED_SCOUT_VIEW_BY_ROUTE_ID: Record<string, Route["view"]> =
  Object.fromEntries(
    ADOPTED_SCOUT_PREFIXES.map(({ path, view }) => [`/${path}`, view]),
  );
