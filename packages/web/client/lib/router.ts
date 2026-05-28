import { useCallback, useEffect, useRef, useState } from "react";
import { isOpsEnabled } from "./feature-flags.ts";
import type {
  AgentTab,
  FollowPreferredView,
  MessagesFilter,
  MessagesSort,
  OpsMode,
  Route,
} from "./types.ts";

/* ── URL ↔ Route mapping ── */

function parseAgentTab(value: string | null): AgentTab | undefined {
  switch (value) {
    case "profile":
    case "observe":
    case "message":
      return value;
    default:
      return undefined;
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

const MACHINE_SCOPE_PARAM = "machineId";
const MACHINE_SCOPED_VIEWS = new Set<Route["view"]>([
  "inbox",
  "conversation",
  "agents",
  "fleet",
  "conversations",
  "messages",
  "sessions",
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
  const url = new URL(urlLike.toString());
  const parts = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  const machineId = parseMachineId(url);
  const scoped = <T extends Route>(route: T): T => withMachineScope(route, machineId);
  const composeMode =
    url.searchParams.get("compose") === "ask" ? "ask" : undefined;
  const agentTab = parseAgentTab(url.searchParams.get("tab"));
  if (parts[0] === "agent" && parts[1]) {
    return { view: "agent-info", conversationId: decodeURIComponent(parts[1]) };
  }
  // /agents/{agentId}/c/{conversationId} → agent detail with inline conversation
  if (parts[0] === "agents" && parts[1] && parts[2] === "c" && parts[3]) {
    return scoped({
      view: "agents",
      agentId: decodeURIComponent(parts[1]),
      conversationId: decodeURIComponent(parts[3]),
      tab: agentTab ?? "message",
    });
  }
  // /agents/{agentId} → agents view with selected agent
  if (parts[0] === "agents" && parts[1]) {
    const agentId = decodeURIComponent(parts[1]);
    // When tab=message, the DM conversation is implied from the agentId.
    if (agentTab === "message") {
      return scoped({
        view: "agents",
        agentId,
        conversationId: conversationForAgent(agentId),
        tab: "message",
      });
    }
    return scoped({
      view: "agents",
      agentId,
      ...(agentTab ? { tab: agentTab } : {}),
    });
  }
  if (parts[0] === "agents") return scoped({ view: "agents" });
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
    return {
      view: "terminal",
      ...(parts[1] ? { agentId: decodeURIComponent(parts[1]) } : {}),
      ...(mode ? { mode } : {}),
    };
  }
  if (parts[0] === "ops") {
    if (!isOpsEnabledForUrl(url)) {
      return scoped({ view: "inbox" });
    }
    const mode = parseOpsMode(parts[1]) ?? "mission";
    const tailQuery = mode === "tail" ? url.searchParams.get("q")?.trim() : "";
    return { view: "ops", mode, ...(tailQuery ? { tailQuery } : {}) };
  }
  return scoped({ view: "inbox" });
}

function routeFromPath(): Route {
  return routeFromUrl(window.location.href);
}

export function routePath(r: Route): string {
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
      const isDmConv =
        !!r.agentId &&
        !!r.conversationId &&
        r.conversationId === conversationForAgent(r.agentId);
      const defaultTab = isDmConv
        ? "profile"
        : r.conversationId
          ? "message"
          : "profile";
      if (isDmConv) {
        // DM conversation is implied by `?tab=message`; omit /c/ segment.
        params.set("tab", r.tab ?? "message");
      } else if (r.tab && r.tab !== defaultTab) {
        params.set("tab", r.tab);
      }
      appendMachineScope(params, r);
      const path = r.agentId
        ? isDmConv
          ? `/agents/${encodeURIComponent(r.agentId)}`
          : r.conversationId
            ? `/agents/${encodeURIComponent(r.agentId)}/c/${encodeURIComponent(r.conversationId)}`
            : `/agents/${encodeURIComponent(r.agentId)}`
        : "/agents";
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
      return pathWithMachineScope(r.sessionId
        ? `/sessions/${encodeURIComponent(r.sessionId)}`
        : "/sessions", r);
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
      if (r.mode === "tail" && r.tailQuery) {
        return `/ops/${opsModePath(r.mode)}?q=${encodeURIComponent(r.tailQuery)}`;
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
      if (!r.mode) {
        return r.agentId ? `/terminal/${encodeURIComponent(r.agentId)}` : "/terminal";
      }
      return `${r.agentId ? `/terminal/${encodeURIComponent(r.agentId)}` : "/terminal"}?mode=${r.mode}`;
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
      return r.conversationId
        ? `agent-conv:${r.conversationId}:${r.tab ?? "message"}${scope}`
        : r.agentId
          ? `agent:${r.agentId}:${r.tab ?? "profile"}${scope}`
          : `agents${scope}`;
    case "sessions":
      return r.sessionId ? `session:${r.sessionId}${scope}` : `sessions${scope}`;
    case "messages":
      return r.conversationId ? `messages:${r.conversationId}${scope}` : `messages${scope}`;
    case "channels":
      return r.channelId ? `channel:${r.channelId}${scope}` : `channels${scope}`;
    case "work":
      return `work:${r.workId}${scope}`;
    case "ops":
      return `ops:${r.mode ?? "plan"}:${r.tailQuery ?? ""}`;
    case "follow":
      return `follow:${r.flightId ?? r.invocationId ?? r.conversationId ?? r.workId ?? r.sessionId ?? r.targetAgentId ?? ""}:${r.preferredView ?? ""}`;
    case "terminal":
      return `terminal:${r.agentId ?? ""}:${r.mode ?? "takeover"}`;
    default:
      return `${r.view}${scope}`;
  }
}

/* ── Router hook ── */

export function useRouter() {
  const [route, setRouteState] = useState<Route>(routeFromPath);
  const scrollMap = useRef<Record<string, number>>({});

  useEffect(() => {
    const onPop = () => {
      const r = routeFromPath();
      setRouteState(r);
      requestAnimationFrame(() => {
        window.scrollTo(0, scrollMap.current[routeKey(r)] ?? 0);
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((r: Route) => {
    const requestedRoute: Route = r.view === "ops" && !isOpsEnabled()
      ? { view: "inbox" }
      : r;
    const currentRoute = routeFromPath();
    const nextRoute = resolveNavigatedMachineScope(requestedRoute, currentRoute);
    scrollMap.current[routeKey(currentRoute)] = window.scrollY;
    window.history.pushState(null, "", routePath(nextRoute));
    setRouteState(nextRoute);
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollMap.current[routeKey(nextRoute)] ?? 0);
    });
  }, []);

  return { route, navigate };
}

/* ── Helpers ── */

/** Extract agent ID from a dm.operator.{agentId} conversation ID. */
export function agentIdFromConversation(cid: string): string | null {
  const m = cid.match(/^dm\.operator\.(.+)$/);
  return m ? m[1] : null;
}

/** Derive a conversation ID from an agent ID. */
export function conversationForAgent(agentId: string): string {
  return `dm.operator.${agentId}`;
}
