import { useCallback, useEffect, useRef, useState } from "react";
import type { Route } from "./types.ts";

/* ── URL ↔ Route mapping ── */

function routeFromPath(): Route {
  const parts = window.location.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts[0] === "c" && parts[1] && parts[2] === "info") {
    return { view: "agent-info", conversationId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "c" && parts[1]) {
    return { view: "conversation", conversationId: decodeURIComponent(parts[1]) };
  }
  // Legacy: /agents/{agentId} → redirect to conversation
  if (parts[0] === "agents" && parts[1]) {
    return { view: "conversation", conversationId: `dm.operator.${decodeURIComponent(parts[1])}` };
  }
  if (parts[0] === "flights") return { view: "flights" };
  if (parts[0] === "asks") return { view: "asks" };
  if (parts[0] === "settings") return { view: "settings" };
  return { view: "inbox" };
}

function routePath(r: Route): string {
  switch (r.view) {
    case "inbox": return "/";
    case "conversation": return `/c/${encodeURIComponent(r.conversationId)}`;
    case "agent-info": return `/c/${encodeURIComponent(r.conversationId)}/info`;
    case "flights": return "/flights";
    case "asks": return "/asks";
    case "settings": return "/settings";
  }
}

function routeKey(r: Route): string {
  switch (r.view) {
    case "conversation": return `conv:${r.conversationId}`;
    case "agent-info": return `info:${r.conversationId}`;
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
    // Save current scroll before navigating
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
