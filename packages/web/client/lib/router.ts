import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useRouter as useTanStackRouter } from "@tanstack/react-router";
import { isOpsEnabled } from "./feature-flags.ts";
import { isScoutFlagEnabled } from "./scout-flags.ts";
import {
  parseScopeRouteFromUrl,
  preserveLocationSearch,
  scopeRoutePath,
} from "../scope/index.ts";
import { normalizeRoute } from "./synthetic-agent-routing.ts";
import { surfaceKeyFromParts, surfacePartsFromKey } from "./terminal-sessions.ts";
import type {
  AgentTab,
  FollowPreferredView,
  MessagesFilter,
  MessagesSort,
  OpsMode,
  Route,
  SearchMode,
} from "./types.ts";

/* ── URL ↔ Route mapping ── */

const APP_URL_BASE = typeof window !== "undefined" ? window.location.href : "http://scout.local/";

/** TanStack location.href is often path-only; resolve against the active document. */
function resolveAppUrl(hrefOrPath: string | URL): URL {
  const value = hrefOrPath.toString();
  return new URL(value, APP_URL_BASE);
}

function parseAgentTab(value: string | null): AgentTab | undefined {
  switch (value) {
    case "profile":
    case "config":
    case "definitions":
      return value === "definitions" ? "config" : value;
    case "observe":
    case "message":
      return value;
    default:
      return undefined;
  }
}

function hashMessageId(hash: string): string | null {
  const raw = hash.trim().replace(/^#/, "");
  if (!raw.startsWith("msg-")) return null;
  const id = raw.slice("msg-".length).trim();
  if (!id) return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

function parseOpsMode(value: string | undefined): OpsMode | undefined {
  switch (value) {
    case "control":
    case "mission":
    // Command/Conductor views retired — fold legacy URLs into Control.
    case "command":
    case "warroom":
    case "conduct":
    case "conductor":
      return "mission";
    case "plan":
      return "plan";
    case "issues":
    case "errors":
    case "warnings":
      return "issues";
    case "agents":
    case "tail":
    case "atop":
    case "lanes":
      return value;
    default:
      return undefined;
  }
}

function parseMessagesFilter(value: string | null): MessagesFilter | undefined {
  return value === "dm" || value === "channel" || value === "all" ? value : undefined;
}

function parseMessagesSort(value: string | null): MessagesSort | undefined {
  return value === "recent" || value === "name" || value === "unread" ? value : undefined;
}

function parseSearchMode(value: string | undefined): SearchMode | undefined {
  return value === "indexer" || value === "knowledge" ? value : undefined;
}

function parseFollowPreferredView(value: string | null): FollowPreferredView | undefined {
  switch (value) {
    case "tail":
    case "session":
    case "chat":
    case "work":
      return value;
    default:
      return undefined;
  }
}

function parseTerminalMode(value: string | null): "observe" | "takeover" | undefined {
  const normalized = value?.trim().replace(/\.+$/u, "");
  return normalized === "observe" || normalized === "takeover" ? normalized : undefined;
}

function parseDiffInclude(value: string | null): "changed" | "all" | undefined {
  return value === "all" || value === "touched" ? "all" : value === "changed" ? "changed" : undefined;
}

function opsModePath(mode: OpsMode): string {
  switch (mode) {
    case "mission":
      return "control";
    default:
      return mode;
  }
}

function isOpsEnabledForUrl(url: URL): boolean {
  if (url.searchParams.has("no-ops")) {
    return false;
  }
  if (typeof window === "undefined") {
    return true;
  }
  return isOpsEnabled();
}

// Tail (ops?mode=tail) is promoted to the primary nav by `nav.clean` and is part
// of the lean core, so it stays reachable even when the broader Ops cluster
// (ops.control) is gated off. Other Ops modes still follow the ops gate.
function isTailCoreSurface(mode: string | undefined): boolean {
  return mode === "tail" && isScoutFlagEnabled("nav.clean");
}



const MACHINE_SCOPE_PARAM = "machineId";
const MACHINE_SCOPED_VIEWS = new Set<Route["view"]>([
  "inbox",
  "conversation",
  "agents",
  "agents-v2",
  "fleet",
  "conversations",
  "messages",
  "sessions",
  "repos",
  "harnesses",
  "channels",
  "mesh",
  "activity",
  "work",
]);

function parseMachineId(url: URL): string | undefined {
  return url.searchParams.get(MACHINE_SCOPE_PARAM)?.trim() || undefined;
}

function withMachineScope<T extends Route>(route: T, machineId: string | undefined): T {
  if (!machineId || !MACHINE_SCOPED_VIEWS.has(route.view)) return route;
  return { ...route, machineId } as T;
}

export function routeSupportsMachineScope(route: Pick<Route, "view">): boolean {
  return MACHINE_SCOPED_VIEWS.has(route.view);
}

export function routeMachineId(route: Route): string | null {
  return "machineId" in route && route.machineId ? route.machineId : null;
}

export function setRouteMachineScope(route: Route, machineId: string | null): Route {
  if (!routeSupportsMachineScope(route)) return route;
  const scoped = { ...route } as Route & { machineId?: string };
  const value = machineId?.trim();
  if (value) {
    scoped.machineId = value;
  } else {
    delete scoped.machineId;
  }
  return scoped;
}

export function clearRouteMachineScope(route: Route): Route {
  if (!routeSupportsMachineScope(route)) return route;
  return { ...route, machineId: "" } as Route;
}

function resolveNavigatedMachineScope(nextRoute: Route, currentRoute: Route): Route {
  if (!routeSupportsMachineScope(nextRoute)) return nextRoute;
  if ("machineId" in nextRoute) {
    return setRouteMachineScope(nextRoute, nextRoute.machineId ?? null);
  }
  return setRouteMachineScope(nextRoute, routeMachineId(currentRoute));
}

function appendMachineScope(params: URLSearchParams, route: Route): void {
  if ("machineId" in route && route.machineId) {
    params.set(MACHINE_SCOPE_PARAM, route.machineId);
  }
}

function searchSuffix(params: URLSearchParams): string {
  const search = params.toString();
  return search ? `?${search}` : "";
}

function pathWithMachineScope(path: string, route: Route): string {
  const params = new URLSearchParams();
  appendMachineScope(params, route);
  return `${path}${searchSuffix(params)}`;
}

function routeScopeKey(route: Route): string {
  return "machineId" in route && route.machineId ? `:machine:${route.machineId}` : "";
}

export function routeFromUrl(urlLike: string | URL): Route {
  const url = resolveAppUrl(urlLike);
  const parts = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  const machineId = parseMachineId(url);
  const scoped = <T extends Route>(route: T): T => withMachineScope(route, machineId);
  const scopeRoute = parseScopeRouteFromUrl(parts, url, scoped);
  if (scopeRoute) return scopeRoute;
  const composeMode =
    url.searchParams.get("compose") === "ask" ? "ask" : undefined;
  const messageHashId = hashMessageId(url.hash);
  const agentTab = parseAgentTab(url.searchParams.get("tab"))
    ?? (messageHashId ? "message" : undefined);
  const agentProjectSlug = url.searchParams.get("project")?.trim() || undefined;
  if (parts[0] === "agent" && parts[1]) {
    return { view: "agent-info", conversationId: decodeURIComponent(parts[1]) };
  }
  const agentsV2Project = url.searchParams.get("project")?.trim() || undefined;
  const agentsV2Harness = url.searchParams.get("harness")?.trim() || undefined;
  const agentsV2Node = url.searchParams.get("node")?.trim() || undefined;
  const agentsV2SetRaw = url.searchParams.get("set")?.trim();
  const agentsV2Set =
    agentsV2SetRaw === "live" || agentsV2SetRaw === "ephemeral" || agentsV2SetRaw === "archived"
      ? agentsV2SetRaw
      : undefined;
  const agentsV2IndexRaw = url.searchParams.get("view")?.trim();
  const agentsV2IndexView =
    agentsV2IndexRaw === "sessions" ? "sessions" : agentsV2IndexRaw === "agents" ? "agents" : undefined;
  const agentsV2StateRaw = url.searchParams.get("state")?.trim();
  const agentsV2StateFilter =
    agentsV2StateRaw === "needs" || agentsV2StateRaw === "live" || agentsV2StateRaw === "idle"
      ? agentsV2StateRaw
      : undefined;
  const agentsV2ShowEphemeral = url.searchParams.get("ephemeral") === "1";
  const agentsV2SessionParam = url.searchParams.get("session")?.trim() || undefined;
  const agentsV2Select = url.searchParams.get("select")?.trim() || undefined;
  const agentsV2Common = {
    ...(agentsV2Harness ? { harness: agentsV2Harness } : {}),
    ...(agentsV2Node ? { node: agentsV2Node } : {}),
    ...(agentsV2Set ? { set: agentsV2Set } : {}),
    ...(agentsV2IndexView ? { indexView: agentsV2IndexView } : {}),
    ...(agentsV2StateFilter ? { stateFilter: agentsV2StateFilter } : {}),
    ...(agentsV2ShowEphemeral ? { showEphemeral: true } : {}),
  };
  if (parts[0] === "projects") {
    const projectSlug = parts[1] ? decodeURIComponent(parts[1]) : undefined;
    if (!projectSlug) {
      return scoped({
        view: "agents-v2",
        ...(agentsV2Select ? { selectedAgentId: agentsV2Select } : {}),
        ...agentsV2Common,
      });
    }
    if (parts[2] === "agents") {
      const agentId = parts[3] ? decodeURIComponent(parts[3]) : undefined;
      if (agentId) {
        if (parts[4] === "c" && parts[5]) {
          return scoped({
            view: "agents-v2",
            projectSlug,
            agentId,
            conversationId: decodeURIComponent(parts[5]),
            tab: agentTab ?? "message",
            ...agentsV2Common,
          });
        }
        const sessionId = parts[4] === "sessions" && parts[5]
          ? decodeURIComponent(parts[5])
          : agentsV2SessionParam;
        return scoped({
          view: "agents-v2",
          projectSlug,
          agentId,
          ...(sessionId ? { sessionId } : {}),
          ...(agentTab ? { tab: agentTab } : {}),
          ...agentsV2Common,
        });
      }
      return scoped({
        view: "agents-v2",
        projectSlug,
        indexView: "agents",
        ...(agentsV2Select ? { selectedAgentId: agentsV2Select } : {}),
        ...agentsV2Common,
      });
    }
    if (parts[2] === "sessions") {
      return scoped({
        view: "agents-v2",
        projectSlug,
        indexView: "sessions",
        ...(parts[3] ? { sessionId: decodeURIComponent(parts[3]) } : {}),
        ...(agentsV2Select ? { selectedAgentId: agentsV2Select } : {}),
        ...agentsV2Common,
      });
    }
    return scoped({
      view: "agents-v2",
      projectSlug,
      ...(agentsV2Select ? { selectedAgentId: agentsV2Select } : {}),
      ...agentsV2Common,
    });
  }
  if (parts[0] === "agents-v2" && parts[1] === "sessions" && parts[2]) {
    return scoped({
      view: "agents-v2",
      sessionId: decodeURIComponent(parts[2]),
      ...(agentsV2Select ? { selectedAgentId: agentsV2Select } : {}),
      ...(agentsV2Project ? { projectSlug: agentsV2Project } : {}),
      ...agentsV2Common,
    });
  }
  if (parts[0] === "agents-v2" && parts[1]) {
    const agentId = decodeURIComponent(parts[1]);
    return scoped({
      view: "agents-v2",
      agentId,
      ...(agentTab ? { tab: agentTab } : {}),
      ...(agentsV2SessionParam ? { sessionId: agentsV2SessionParam } : {}),
      ...(agentsV2Project ? { projectSlug: agentsV2Project } : {}),
      ...agentsV2Common,
    });
  }
  if (parts[0] === "agents-v2") {
    return scoped({
      view: "agents-v2",
      ...(agentsV2Select ? { selectedAgentId: agentsV2Select } : {}),
      ...(agentsV2Project ? { projectSlug: agentsV2Project } : {}),
      ...agentsV2Common,
    });
  }
  if (parts[0] === "agents" && parts[1]) {
    const agentId = decodeURIComponent(parts[1]);
    const sessionId = parts[2] === "sessions" && parts[3]
      ? decodeURIComponent(parts[3])
      : agentsV2SessionParam;
    if (parts[2] === "c" && parts[3]) {
      return scoped({
        view: "agents-v2",
        agentId,
        conversationId: decodeURIComponent(parts[3]),
        tab: agentTab ?? "message",
        ...agentsV2Common,
      });
    }
    return scoped({
      view: "agents-v2",
      agentId,
      ...(sessionId ? { sessionId } : {}),
      ...(agentTab ? { tab: agentTab } : {}),
      ...agentsV2Common,
    });
  }
  if (parts[0] === "agents") {
    return scoped({
      view: "agents-v2",
      ...(agentsV2Select ? { selectedAgentId: agentsV2Select } : {}),
      ...(agentsV2Project ? { projectSlug: agentsV2Project } : {}),
      ...agentsV2Common,
    });
  }
  // /agents/{agentId}/sessions/{sessionId} → session observe scoped to an exact agent/session pair.
  if (parts[0] === "agents.deprecated" && parts[1] && parts[2] === "sessions" && parts[3]) {
    return scoped({
      view: "sessions",
      agentId: decodeURIComponent(parts[1]),
      sessionId: decodeURIComponent(parts[3]),
    });
  }
  // /agents/{agentId}/c/{conversationId} → agent detail with inline conversation
  if (parts[0] === "agents.deprecated" && parts[1] && parts[2] === "c" && parts[3]) {
    return scoped({
      view: "agents",
      agentId: decodeURIComponent(parts[1]),
      conversationId: decodeURIComponent(parts[3]),
      tab: agentTab ?? "message",
    });
  }
  // /agents/{agentId} → agents view with selected agent. With ?project=… and no
  // tab it is a directory-selection (master-detail): the project stays the
  // primary object and the agent only drives the right inspector.
  if (parts[0] === "agents.deprecated" && parts[1]) {
    const agentId = decodeURIComponent(parts[1]);
    return scoped({
      view: "agents",
      agentId,
      ...(agentTab ? { tab: agentTab } : {}),
      ...(!agentTab && agentProjectSlug ? { projectSlug: agentProjectSlug } : {}),
    });
  }
  if (parts[0] === "agents.deprecated") {
    return scoped({
      view: "agents",
      ...(agentProjectSlug ? { projectSlug: agentProjectSlug } : {}),
    });
  }
  if (parts[0] === "fleet") return scoped({ view: "fleet" });
  // /c/{conversationId} always opens the conversation surface directly.
  if (parts[0] === "c" && parts[1]) {
    return scoped({
      view: "conversation",
      conversationId: decodeURIComponent(parts[1]),
      ...(composeMode ? { composeMode } : {}),
    });
  }
  if (parts[0] === "sessions" && parts[1]) {
    return scoped({ view: "sessions", sessionId: decodeURIComponent(parts[1]) });
  }
  if (parts[0] === "conversations") return scoped({ view: "conversations" });
  if (parts[0] === "messages") {
    const filter = parseMessagesFilter(url.searchParams.get("filter"));
    const sort = parseMessagesSort(url.searchParams.get("sort"));
    const base: Extract<Route, { view: "messages" }> = {
      view: "messages",
      ...(parts[1] ? { conversationId: decodeURIComponent(parts[1]) } : {}),
      ...(filter ? { filter } : {}),
      ...(sort ? { sort } : {}),
    };
    return scoped(base);
  }
  if (parts[0] === "sessions") return scoped({ view: "sessions" });
  if (parts[0] === "repos") return scoped({ view: "repos" });
  if (parts[0] === "harnesses") return scoped({ view: "harnesses" });
  if (parts[0] === "repo-diff") {
    const path = url.searchParams.get("path")?.trim();
    if (path) {
      const layers = url.searchParams
        .getAll("layer")
        .filter(
          (v): v is "unstaged" | "staged" | "branch" =>
            v === "unstaged" || v === "staged" || v === "branch",
        );
      const files = url.searchParams.getAll("file").map((v) => v.trim()).filter(Boolean);
      const sessionId = url.searchParams.get("sessionId")?.trim() || undefined;
      const agentId = url.searchParams.get("agentId")?.trim() || undefined;
      const include = parseDiffInclude(url.searchParams.get("include"));
      return {
        view: "repo-diff",
        path,
        ...(layers.length > 0 ? { layers } : {}),
        ...(files.length > 0 ? { files } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(agentId ? { agentId } : {}),
        ...(include ? { include } : {}),
      };
    }
    // No path → fall through to the default route below.
  }
  if (parts[0] === "search") {
    const mode = parseSearchMode(parts[1]);
    return { view: "search", ...(mode && mode !== "knowledge" ? { mode } : {}) };
  }
  if (parts[0] === "channels" && parts[1]) {
    return scoped({ view: "channels", channelId: decodeURIComponent(parts[1]) });
  }
  if (parts[0] === "channels") return scoped({ view: "channels" });
  if (parts[0] === "mesh") return scoped({ view: "mesh" });
  if (parts[0] === "broker") return { view: "broker" };
  if (parts[0] === "briefings" && parts[1]) {
    return { view: "briefings", briefingId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "briefings") return { view: "briefings" };
  if (parts[0] === "activity") return scoped({ view: "activity" });
  if (parts[0] === "work" && parts[1]) {
    return scoped({ view: "work", workId: decodeURIComponent(parts[1]) });
  }
  if (parts[0] === "follow") {
    const preferredView = parseFollowPreferredView(url.searchParams.get("view"));
    const route: Extract<Route, { view: "follow" }> = {
      view: "follow",
      ...(preferredView ? { preferredView } : {}),
    };
    const kind = parts[1];
    const id = parts[2] ? decodeURIComponent(parts[2]) : "";
    if (kind === "flight" && id) route.flightId = id;
    if (kind === "invocation" && id) route.invocationId = id;
    if (kind === "conversation" && id) route.conversationId = id;
    if (kind === "work" && id) route.workId = id;
    if (kind === "session" && id) route.sessionId = id;
    if (kind === "agent" && id) route.targetAgentId = id;
    const flightId = url.searchParams.get("flightId");
    const invocationId = url.searchParams.get("invocationId");
    const conversationId = url.searchParams.get("conversationId");
    const workId = url.searchParams.get("workId");
    const sessionId = url.searchParams.get("sessionId");
    const targetAgentId = url.searchParams.get("targetAgentId");
    if (flightId) route.flightId = flightId;
    if (invocationId) route.invocationId = invocationId;
    if (conversationId) route.conversationId = conversationId;
    if (workId) route.workId = workId;
    if (sessionId) route.sessionId = sessionId;
    if (targetAgentId) route.targetAgentId = targetAgentId;
    return route;
  }
  if (parts[0] === "settings") {
    if (parts[1] === "agents") {
      return {
        view: "settings",
        section: "agents",
        ...(parts[2] ? { agentId: decodeURIComponent(parts[2]) } : {}),
      };
    }
    return { view: "settings" };
  }
  if (parts[0] === "terminal") {
    const mode = parseTerminalMode(url.searchParams.get("mode"));
    const terminalSessionId = url.searchParams.get("session")?.trim() || undefined;
    const terminalSurfaceKey = url.searchParams.get("surface")?.trim() || undefined;
    const pathSurfaceKey = surfaceKeyFromParts(
      parts[1] ? decodeURIComponent(parts[1]) : undefined,
      parts[2] ? decodeURIComponent(parts.slice(2).join("/")) : undefined,
    );
    if (pathSurfaceKey) {
      return {
        view: "terminal",
        terminalSurfaceKey: pathSurfaceKey,
        ...(terminalSessionId ? { terminalSessionId } : {}),
        ...(mode ? { mode } : {}),
      };
    }
    return {
      view: "terminal",
      ...(parts[1] ? { agentId: decodeURIComponent(parts[1]) } : {}),
      ...(mode ? { mode } : {}),
      ...(!parts[1] && terminalSessionId ? { terminalSessionId } : {}),
      ...(!parts[1] && terminalSurfaceKey ? { terminalSurfaceKey } : {}),
    };
  }
  if (parts[0] === "ops") {
    const mode = parseOpsMode(parts[1]) ?? "mission";
    if (!isTailCoreSurface(mode) && !isOpsEnabledForUrl(url)) {
      return scoped({ view: "inbox" });
    }
    const tailQuery = mode === "tail" ? url.searchParams.get("q")?.trim() : "";
    const planDocumentId = mode === "plan" ? url.searchParams.get("plan")?.trim() : "";
    const flightId = url.searchParams.get("flightId")?.trim();
    const invocationId = url.searchParams.get("invocationId")?.trim();
    const conversationId = url.searchParams.get("conversationId")?.trim();
    const workId = url.searchParams.get("workId")?.trim();
    const sessionId = url.searchParams.get("sessionId")?.trim();
    const targetAgentId = url.searchParams.get("targetAgentId")?.trim()
      ?? url.searchParams.get("agentId")?.trim();
    return {
      view: "ops",
      mode,
      ...(tailQuery ? { tailQuery } : {}),
      ...(planDocumentId ? { planDocumentId } : {}),
      ...(flightId ? { flightId } : {}),
      ...(invocationId ? { invocationId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(workId ? { workId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(targetAgentId ? { targetAgentId } : {}),
    };
  }
  return scoped({ view: "inbox" });
}

export function routePath(r: Route, pathname?: string): string {
  const scopePath = scopeRoutePath(r, pathname);
  if (scopePath) return scopePath;

  switch (r.view) {
    case "inbox":
      return pathWithMachineScope("/", r);
    case "conversation": {
      const params = new URLSearchParams();
      if (r.composeMode === "ask") {
        params.set("compose", "ask");
      }
      appendMachineScope(params, r);
      return `/c/${encodeURIComponent(r.conversationId)}${searchSuffix(params)}`;
    }
    case "agent-info":
      return `/agent/${encodeURIComponent(r.conversationId)}`;
    case "agents": {
      const params = new URLSearchParams();
      const defaultTab = r.conversationId
          ? "message"
          : "profile";
      if (r.tab && r.tab !== defaultTab) {
        params.set("tab", r.tab);
      }
      // The project rides the URL whenever no tab is engaged — both the bare
      // directory (no agent) and a directory-selection (agent in the inspector,
      // center still the directory). A tab means the agent owns the center.
      if (r.projectSlug && !r.tab) {
        params.set("project", r.projectSlug);
      }
      appendMachineScope(params, r);
      const path = r.agentId
        ? r.conversationId
            ? `/agents.deprecated/${encodeURIComponent(r.agentId)}/c/${encodeURIComponent(r.conversationId)}`
            : `/agents.deprecated/${encodeURIComponent(r.agentId)}`
        : "/agents.deprecated";
      return `${path}${searchSuffix(params)}`;
    }
    case "agents-v2": {
      const params = new URLSearchParams();
      if (r.harness) params.set("harness", r.harness);
      if (r.node) params.set("node", r.node);
      if (r.set) params.set("set", r.set);
      if (!r.projectSlug && r.indexView && r.indexView !== "agents") params.set("view", r.indexView);
      if (r.stateFilter) params.set("state", r.stateFilter);
      if (r.showEphemeral) params.set("ephemeral", "1");
      if (r.selectedAgentId && !r.agentId) params.set("select", r.selectedAgentId);
      const defaultTab = r.conversationId ? "message" : "profile";
      if (r.agentId && r.tab && r.tab !== defaultTab) params.set("tab", r.tab);
      appendMachineScope(params, r);
      const projectPath = r.projectSlug ? `/projects/${encodeURIComponent(r.projectSlug)}` : null;
      const path = projectPath
        ? r.agentId
          ? r.conversationId
            ? `${projectPath}/agents/${encodeURIComponent(r.agentId)}/c/${encodeURIComponent(r.conversationId)}`
            : r.sessionId
            ? `${projectPath}/agents/${encodeURIComponent(r.agentId)}/sessions/${encodeURIComponent(r.sessionId)}`
            : `${projectPath}/agents/${encodeURIComponent(r.agentId)}`
          : r.sessionId
            ? `${projectPath}/sessions/${encodeURIComponent(r.sessionId)}`
            : r.indexView === "sessions"
              ? `${projectPath}/sessions`
              : r.indexView === "agents"
                ? `${projectPath}/agents`
                : projectPath
        : r.agentId
          ? r.conversationId
            ? `/agents/${encodeURIComponent(r.agentId)}/c/${encodeURIComponent(r.conversationId)}`
            : r.sessionId
            ? `/agents/${encodeURIComponent(r.agentId)}/sessions/${encodeURIComponent(r.sessionId)}`
            : `/agents/${encodeURIComponent(r.agentId)}`
          : r.sessionId
            ? `/sessions/${encodeURIComponent(r.sessionId)}`
            : "/projects";
      return `${path}${searchSuffix(params)}`;
    }
    case "fleet":
      return pathWithMachineScope("/fleet", r);
    case "conversations":
      return pathWithMachineScope("/conversations", r);
    case "messages": {
      const params = new URLSearchParams();
      if (r.filter && r.filter !== "all") params.set("filter", r.filter);
      if (r.sort && r.sort !== "recent") params.set("sort", r.sort);
      appendMachineScope(params, r);
      const base = r.conversationId
        ? `/messages/${encodeURIComponent(r.conversationId)}`
        : "/messages";
      return `${base}${searchSuffix(params)}`;
    }
    case "sessions":
      return pathWithMachineScope(
        r.agentId && r.sessionId
          ? `/agents/${encodeURIComponent(r.agentId)}/sessions/${encodeURIComponent(r.sessionId)}`
          : r.sessionId
          ? `/sessions/${encodeURIComponent(r.sessionId)}`
          : "/sessions",
        r,
      );
    case "repos":
      return pathWithMachineScope("/repos", r);
    case "harnesses":
      return pathWithMachineScope("/harnesses", r);
    case "repo-diff": {
      const params = new URLSearchParams();
      params.set("path", r.path);
      for (const layer of r.layers ?? []) params.append("layer", layer);
      for (const file of r.files ?? []) params.append("file", file);
      if (r.sessionId) params.set("sessionId", r.sessionId);
      if (r.agentId) params.set("agentId", r.agentId);
      if (r.include) params.set("include", r.include);
      return `/repo-diff${searchSuffix(params)}`;
    }
    case "search":
      return r.mode === "indexer" ? "/search/indexer" : "/search";
    case "channels":
      return pathWithMachineScope(r.channelId
        ? `/channels/${encodeURIComponent(r.channelId)}`
        : "/channels", r);
    case "mesh":
      return pathWithMachineScope("/mesh", r);
    case "broker":
      return "/broker";
    case "briefings":
      return r.briefingId
        ? `/briefings/${encodeURIComponent(r.briefingId)}`
        : "/briefings";
    case "activity":
      return pathWithMachineScope("/activity", r);
    case "work":
      return pathWithMachineScope(`/work/${encodeURIComponent(r.workId)}`, r);
    case "settings":
      if (r.section === "agents") {
        return r.agentId
          ? `/settings/agents/${encodeURIComponent(r.agentId)}`
          : "/settings/agents";
      }
      return "/settings";
    case "ops":
      if (!r.mode) return "/ops";
      if (r.mode === "tail" || r.mode === "plan") {
        const params = new URLSearchParams();
        if (r.mode === "tail" && r.tailQuery) params.set("q", r.tailQuery);
        if (r.mode === "plan" && r.planDocumentId) params.set("plan", r.planDocumentId);
        if (r.flightId) params.set("flightId", r.flightId);
        if (r.invocationId) params.set("invocationId", r.invocationId);
        if (r.conversationId) params.set("conversationId", r.conversationId);
        if (r.workId) params.set("workId", r.workId);
        if (r.sessionId) params.set("sessionId", r.sessionId);
        if (r.targetAgentId) params.set("targetAgentId", r.targetAgentId);
        return `/ops/${opsModePath(r.mode)}${searchSuffix(params)}`;
      }
      return `/ops/${opsModePath(r.mode)}`;
    case "follow": {
      const params = new URLSearchParams();
      if (r.preferredView) params.set("view", r.preferredView);
      if (r.flightId) params.set("flightId", r.flightId);
      if (r.invocationId) params.set("invocationId", r.invocationId);
      if (r.conversationId) params.set("conversationId", r.conversationId);
      if (r.workId) params.set("workId", r.workId);
      if (r.sessionId) params.set("sessionId", r.sessionId);
      if (r.targetAgentId) params.set("targetAgentId", r.targetAgentId);
      const search = params.toString();
      return `/follow${search ? `?${search}` : ""}`;
    }
    case "terminal":
      if (r.agentId) {
        const params = new URLSearchParams();
        if (r.mode) params.set("mode", r.mode);
        return `/terminal/${encodeURIComponent(r.agentId)}${searchSuffix(params)}`;
      }
      {
        const params = new URLSearchParams();
        if (r.mode) params.set("mode", r.mode);
        const surfaceParts = surfacePartsFromKey(r.terminalSurfaceKey);
        if (surfaceParts) {
          return `/terminal/${encodeURIComponent(surfaceParts.backend)}/${encodeURIComponent(surfaceParts.sessionName)}${searchSuffix(params)}`;
        }
        if (r.terminalSessionId) params.set("session", r.terminalSessionId);
        if (r.terminalSurfaceKey) params.set("surface", r.terminalSurfaceKey);
        return `/terminal${searchSuffix(params)}`;
      }
  }
}

function routeKey(r: Route): string {
  const scope = routeScopeKey(r);
  switch (r.view) {
    case "conversation":
      return `conv:${r.conversationId}${scope}`;
    case "agent-info":
      return `agent-info:${r.conversationId}`;
    case "settings":
      return r.section === "agents"
        ? `settings:agents:${r.agentId ?? ""}`
        : "settings";
    case "agents":
      // Directory-selection (projectSlug, no tab) shares the directory's scroll
      // key whether or not an agent is picked, so selecting agents into the
      // inspector never jumps the master list's scroll.
      return r.conversationId
        ? `agent-conv:${r.conversationId}:${r.tab ?? "message"}${scope}`
        : r.projectSlug && !r.tab
          ? `agents-project:${r.projectSlug}${scope}`
          : r.agentId
            ? `agent:${r.agentId}:${r.tab ?? "profile"}${scope}`
            : `agents${scope}`;
    case "agents-v2":
      return [
        "agents-v2",
        r.projectSlug ?? "",
        r.harness ?? "",
        r.node ?? "",
        r.set ?? "",
        r.indexView ?? "agents",
        r.stateFilter ?? "",
        r.showEphemeral ? "eph" : "",
        r.agentId ?? "",
        r.sessionId ?? "",
        scope,
      ].join(":");
    case "sessions":
      return r.sessionId ? `session:${r.agentId ?? ""}:${r.sessionId}${scope}` : `sessions${scope}`;
    case "messages":
      return r.conversationId ? `messages:${r.conversationId}${scope}` : `messages${scope}`;
    case "channels":
      return r.channelId ? `channel:${r.channelId}${scope}` : `channels${scope}`;
    case "work":
      return `work:${r.workId}${scope}`;
    case "ops":
      return `ops:${r.mode ?? "plan"}:${r.tailQuery ?? ""}:${r.planDocumentId ?? ""}:${r.flightId ?? ""}:${r.invocationId ?? ""}:${r.workId ?? ""}:${r.conversationId ?? ""}:${r.sessionId ?? ""}:${r.targetAgentId ?? ""}`;
    case "search":
      return `search:${r.mode ?? "knowledge"}`;
    case "follow":
      return `follow:${r.flightId ?? r.invocationId ?? r.conversationId ?? r.workId ?? r.sessionId ?? r.targetAgentId ?? ""}:${r.preferredView ?? ""}`;
    case "terminal":
      return `terminal:${r.agentId ?? ""}:${r.terminalSessionId ?? ""}:${r.terminalSurfaceKey ?? ""}:${r.mode ?? "detail"}`;
    case "repo-diff":
      return `repo-diff:${r.path}`;
    default:
      return `${r.view}${scope}`;
  }
}

/* ── Router hook ── */

function routeFromLocation(pathname: string, searchStr: string): Route {
  return normalizeRoute(routeFromUrl(`${pathname}${searchStr}`));
}

function locationHashSuffix(hash: string): string {
  return hash ? `#${hash}` : "";
}

function canonicalHrefForRoute(pathname: string, searchStr: string, hash: string): string | null {
  const routeUrl = `${pathname}${searchStr}`;
  const raw = routeFromUrl(routeUrl);
  const normalized = normalizeRoute(raw);
  const canonicalPath = preserveLocationSearch(routePath(normalized, pathname), searchStr);
  const shouldCanonicalize =
    routeKey(raw) !== routeKey(normalized)
    || raw.view === "agents"
    || normalized.view === "agents-v2"
    || routeUrl !== canonicalPath;
  if (!shouldCanonicalize || routeUrl === canonicalPath) return null;
  return `${canonicalPath}${locationHashSuffix(hash)}`;
}

export function useRouter() {
  const tanstackRouter = useTanStackRouter();
  const { pathname, searchStr, hash } = useLocation();
  const routeUrl = `${pathname}${searchStr}`;
  const route = useMemo(() => routeFromLocation(pathname, searchStr), [pathname, searchStr]);
  const scrollMap = useRef<Record<string, number>>({});
  const prevRouteUrl = useRef(routeUrl);

  useEffect(() => {
    const canonicalHref = canonicalHrefForRoute(pathname, searchStr, hash);
    if (canonicalHref) {
      void tanstackRouter.navigate({ href: canonicalHref, replace: true });
    }
  }, [pathname, searchStr, hash, tanstackRouter]);

  useEffect(() => {
    if (prevRouteUrl.current === routeUrl) return;
    const r = routeFromLocation(pathname, searchStr);
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollMap.current[routeKey(r)] ?? 0);
    });
    prevRouteUrl.current = routeUrl;
  }, [routeUrl, pathname, searchStr]);

  const navigate = useCallback((r: Route) => {
    const requestedRoute: Route = normalizeRoute(
      r.view === "ops" && !isOpsEnabled() && !isTailCoreSurface(r.mode)
        ? { view: "inbox" }
        : r,
    );
    const currentRoute = routeFromLocation(pathname, searchStr);
    const nextRoute = resolveNavigatedMachineScope(requestedRoute, currentRoute);
    scrollMap.current[routeKey(currentRoute)] = window.scrollY;
    const canonicalPath = preserveLocationSearch(routePath(nextRoute, pathname), searchStr);
    void tanstackRouter.navigate({ href: `${canonicalPath}${locationHashSuffix(hash)}` });
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollMap.current[routeKey(nextRoute)] ?? 0);
    });
  }, [pathname, searchStr, hash, tanstackRouter]);

  return { route, navigate };
}
