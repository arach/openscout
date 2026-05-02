import { useCallback, useEffect, useRef, useState } from "react";
import { isOpsEnabled } from "./feature-flags.ts";
import type { AgentTab, FollowPreferredView, OpsMode, Route } from "./types.ts";

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
    case "command":
      return "command";
    case "warroom":
      return "command";
    case "control":
    case "mission":
      return "mission";
    case "conduct":
    case "conductor":
      return "conductor";
    case "plan":
    case "agents":
    case "tail":
    case "atop":
      return value;
    default:
      return undefined;
  }
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

function opsModePath(mode: OpsMode): string {
  switch (mode) {
    case "command":
      return "command";
    case "mission":
      return "control";
    case "conductor":
      return "conduct";
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

export function routeFromUrl(urlLike: string | URL): Route {
  const url = new URL(urlLike.toString());
  const parts = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  const composeMode =
    url.searchParams.get("compose") === "ask" ? "ask" : undefined;
  const agentTab = parseAgentTab(url.searchParams.get("tab"));
  if (parts[0] === "agent" && parts[1]) {
    return { view: "agent-info", conversationId: decodeURIComponent(parts[1]) };
  }
  // /agents/{agentId}/c/{conversationId} → agent detail with inline conversation
  if (parts[0] === "agents" && parts[1] && parts[2] === "c" && parts[3]) {
    return {
      view: "agents",
      agentId: decodeURIComponent(parts[1]),
      conversationId: decodeURIComponent(parts[3]),
      tab: agentTab ?? "message",
    };
  }
  // /agents/{agentId} → agents view with selected agent
  if (parts[0] === "agents" && parts[1]) {
    const agentId = decodeURIComponent(parts[1]);
    // When tab=message, the DM conversation is implied from the agentId.
    if (agentTab === "message") {
      return {
        view: "agents",
        agentId,
        conversationId: conversationForAgent(agentId),
        tab: "message",
      };
    }
    return {
      view: "agents",
      agentId,
      ...(agentTab ? { tab: agentTab } : {}),
    };
  }
  if (parts[0] === "agents") return { view: "agents" };
  if (parts[0] === "fleet") return { view: "fleet" };
  // /c/{conversationId} always opens the conversation surface directly.
  if (parts[0] === "c" && parts[1]) {
    return {
      view: "conversation",
      conversationId: decodeURIComponent(parts[1]),
      ...(composeMode ? { composeMode } : {}),
    };
  }
  if (parts[0] === "sessions" && parts[1]) {
    return { view: "sessions", sessionId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "sessions") return { view: "sessions" };
  if (parts[0] === "channels" && parts[1]) {
    return { view: "channels", channelId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "channels") return { view: "channels" };
  if (parts[0] === "mesh") return { view: "mesh" };
  if (parts[0] === "broker") return { view: "broker" };
  if (parts[0] === "activity") return { view: "activity" };
  if (parts[0] === "work" && parts[1]) {
    return { view: "work", workId: decodeURIComponent(parts[1]) };
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
  if (parts[0] === "settings") return { view: "settings" };
  if (parts[0] === "terminal") {
    return { view: "terminal", ...(parts[1] ? { agentId: decodeURIComponent(parts[1]) } : {}) };
  }
  if (parts[0] === "ops") {
    if (!isOpsEnabledForUrl(url)) {
      return { view: "inbox" };
    }
    const mode = parseOpsMode(parts[1]);
    if (mode) {
      const tailQuery = mode === "tail" ? url.searchParams.get("q")?.trim() : "";
      return { view: "ops", mode, ...(tailQuery ? { tailQuery } : {}) };
    }
    return { view: "ops" };
  }
  return { view: "inbox" };
}

function routeFromPath(): Route {
  return routeFromUrl(window.location.href);
}

export function routePath(r: Route): string {
  switch (r.view) {
    case "inbox":
      return "/";
    case "conversation": {
      const params = new URLSearchParams();
      if (r.composeMode === "ask") {
        params.set("compose", "ask");
      }
      const search = params.toString();
      return `/c/${encodeURIComponent(r.conversationId)}${search ? `?${search}` : ""}`;
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
      const search = params.toString();
      const path = r.agentId
        ? isDmConv
          ? `/agents/${encodeURIComponent(r.agentId)}`
          : r.conversationId
            ? `/agents/${encodeURIComponent(r.agentId)}/c/${encodeURIComponent(r.conversationId)}`
            : `/agents/${encodeURIComponent(r.agentId)}`
        : "/agents";
      return `${path}${search ? `?${search}` : ""}`;
    }
    case "fleet":
      return "/fleet";
    case "sessions":
      return r.sessionId
        ? `/sessions/${encodeURIComponent(r.sessionId)}`
        : "/sessions";
    case "channels":
      return r.channelId
        ? `/channels/${encodeURIComponent(r.channelId)}`
        : "/channels";
    case "mesh":
      return "/mesh";
    case "broker":
      return "/broker";
    case "activity":
      return "/activity";
    case "work":
      return `/work/${encodeURIComponent(r.workId)}`;
    case "settings":
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
      return r.agentId ? `/terminal/${encodeURIComponent(r.agentId)}` : "/terminal";
  }
}

function routeKey(r: Route): string {
  switch (r.view) {
    case "conversation":
      return `conv:${r.conversationId}`;
    case "agent-info":
      return `agent-info:${r.conversationId}`;
    case "agents":
      return r.conversationId
        ? `agent-conv:${r.conversationId}:${r.tab ?? "message"}`
        : r.agentId
          ? `agent:${r.agentId}:${r.tab ?? "profile"}`
          : "agents";
    case "sessions":
      return r.sessionId ? `session:${r.sessionId}` : "sessions";
    case "channels":
      return r.channelId ? `channel:${r.channelId}` : "channels";
    case "work":
      return `work:${r.workId}`;
    case "ops":
      return `ops:${r.mode ?? "plan"}:${r.tailQuery ?? ""}`;
    case "follow":
      return `follow:${r.flightId ?? r.invocationId ?? r.conversationId ?? r.workId ?? r.sessionId ?? r.targetAgentId ?? ""}:${r.preferredView ?? ""}`;
    default:
      return r.view;
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
    const nextRoute: Route = r.view === "ops" && !isOpsEnabled()
      ? { view: "inbox" }
      : r;
    scrollMap.current[routeKey(routeFromPath())] = window.scrollY;
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
