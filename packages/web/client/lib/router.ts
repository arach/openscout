import { useCallback, useEffect, useRef, useState } from "react";
import { isOpsEnabled } from "./feature-flags.ts";
import type { AgentTab, Route } from "./types.ts";

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
  if (parts[0] === "mesh") return { view: "mesh" };
  if (parts[0] === "activity") return { view: "activity" };
  if (parts[0] === "work" && parts[1]) {
    return { view: "work", workId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "settings") return { view: "settings" };
  if (parts[0] === "terminal") {
    return { view: "terminal", ...(parts[1] ? { agentId: decodeURIComponent(parts[1]) } : {}) };
  }
  if (parts[0] === "ops") {
    if (!isOpsEnabled()) {
      return { view: "inbox" };
    }
    const mode = parts[1];
    if (mode === "conductor" || mode === "warroom" || mode === "plan" || mode === "mission") {
      return { view: "ops", mode };
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
        params.set("tab", "message");
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
    case "mesh":
      return "/mesh";
    case "activity":
      return "/activity";
    case "work":
      return `/work/${encodeURIComponent(r.workId)}`;
    case "settings":
      return "/settings";
    case "ops":
      return r.mode && r.mode !== "plan" ? `/ops/${r.mode}` : "/ops";
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
    case "work":
      return `work:${r.workId}`;
    case "ops":
      return `ops:${r.mode ?? "plan"}`;
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
