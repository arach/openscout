import { useCallback, useEffect, useRef, useState } from "react";
import type { Route } from "./types.ts";

/* ── URL ↔ Route mapping ── */

function routeFromPath(): Route {
  const parts = window.location.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts[0] === "agent" && parts[1]) {
    return { view: "agent-info", conversationId: decodeURIComponent(parts[1]) };
  }
  // /agents/{agentId} → agents view with selected agent
  if (parts[0] === "agents" && parts[1]) {
    return { view: "agents", agentId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "agents") return { view: "agents" };
  // /c/{conversationId} → operator DMs go to agents, everything else to sessions
  if (parts[0] === "c" && parts[1]) {
    const cid = decodeURIComponent(parts[1]);
    const agentId = agentIdFromConversation(cid);
    if (agentId) return { view: "agents", agentId };
    return { view: "sessions", sessionId: cid };
  }
  if (parts[0] === "sessions" && parts[1]) {
    return { view: "sessions", sessionId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "sessions") return { view: "sessions" };
  if (parts[0] === "mesh") return { view: "mesh" };
  if (parts[0] === "activity") return { view: "activity" };
  if (parts[0] === "settings") return { view: "settings" };
  return { view: "inbox" };
}

function routePath(r: Route): string {
  switch (r.view) {
    case "inbox": return "/";
    case "conversation": return `/c/${encodeURIComponent(r.conversationId)}`;
    case "agent-info": return `/agent/${encodeURIComponent(r.conversationId)}`;
    case "agents": return r.agentId ? `/agents/${encodeURIComponent(r.agentId)}` : "/agents";
    case "sessions": return r.sessionId ? `/sessions/${encodeURIComponent(r.sessionId)}` : "/sessions";
    case "mesh": return "/mesh";
    case "activity": return "/activity";
    case "settings": return "/settings";
  }
}

function routeKey(r: Route): string {
  switch (r.view) {
    case "conversation": return `conv:${r.conversationId}`;
    case "agent-info": return `agent-info:${r.conversationId}`;
    case "agents": return r.agentId ? `agent:${r.agentId}` : "agents";
    case "sessions": return r.sessionId ? `session:${r.sessionId}` : "sessions";
    default: return r.view;
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
    scrollMap.current[routeKey(routeFromPath())] = window.scrollY;
    window.history.pushState(null, "", routePath(r));
    setRouteState(r);
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollMap.current[routeKey(r)] ?? 0);
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
