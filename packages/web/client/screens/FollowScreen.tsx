import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.ts";
import type { FollowPreferredView, FollowTarget, Route } from "../lib/types.ts";
import "./inbox-thread-redesign.css";

type FollowScreenProps = {
  route: Extract<Route, { view: "follow" }>;
  navigate: (r: Route) => void;
};

function firstPresent(...values: Array<string | null | undefined>): string | null {
  return values.find((value) => value && value.trim().length > 0)?.trim() ?? null;
}

function routeForFollowTarget(
  target: FollowTarget,
  preferredView: FollowPreferredView | undefined,
): Route {
  if (preferredView === "work" && target.workId) {
    return { view: "work", workId: target.workId };
  }
  if (preferredView === "session" && target.sessionId) {
    return { view: "sessions", sessionId: target.sessionId };
  }
  if (preferredView === "chat" && target.conversationId) {
    return { view: "conversation", conversationId: target.conversationId };
  }
  if (preferredView === "tail") {
    return {
      view: "ops",
      mode: "tail",
      ...(target.sessionId ? { tailQuery: target.sessionId } : {}),
    };
  }

  if (target.workId) {
    return { view: "work", workId: target.workId };
  }
  if (target.sessionId) {
    return { view: "sessions", sessionId: target.sessionId };
  }
  if (target.conversationId) {
    return { view: "conversation", conversationId: target.conversationId };
  }
  if (target.flightId || target.invocationId || target.targetAgentId) {
    return { view: "ops", mode: "tail" };
  }
  return { view: "inbox" };
}

function targetFromRoute(route: Extract<Route, { view: "follow" }>): FollowTarget {
  return {
    flightId: route.flightId ?? null,
    invocationId: route.invocationId ?? null,
    conversationId: route.conversationId ?? null,
    workId: route.workId ?? null,
    sessionId: route.sessionId ?? null,
    targetAgentId: route.targetAgentId ?? null,
  };
}

export function FollowScreen({ route, navigate }: FollowScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const fallbackTarget = useMemo(() => targetFromRoute(route), [route]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (route.flightId) params.set("flightId", route.flightId);
    if (route.invocationId) params.set("invocationId", route.invocationId);
    if (route.conversationId) params.set("conversationId", route.conversationId);
    if (route.workId) params.set("workId", route.workId);
    if (route.sessionId) params.set("sessionId", route.sessionId);
    if (route.targetAgentId) params.set("targetAgentId", route.targetAgentId);

    void (async () => {
      try {
        const query = params.toString();
        const resolved = query
          ? await api<FollowTarget>(`/api/follow?${query}`)
          : fallbackTarget;
        if (cancelled) return;
        navigate(
          routeForFollowTarget(
            {
              flightId: firstPresent(resolved.flightId, fallbackTarget.flightId),
              invocationId: firstPresent(resolved.invocationId, fallbackTarget.invocationId),
              conversationId: firstPresent(resolved.conversationId, fallbackTarget.conversationId),
              workId: firstPresent(resolved.workId, fallbackTarget.workId),
              sessionId: firstPresent(resolved.sessionId, fallbackTarget.sessionId),
              targetAgentId: firstPresent(resolved.targetAgentId, fallbackTarget.targetAgentId),
            },
            route.preferredView,
          ),
        );
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        navigate(routeForFollowTarget(fallbackTarget, route.preferredView));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fallbackTarget, navigate, route]);

  return (
    <div className="s-sessions-screen s-inbox-thread-redesign">
      <section className="s-thread-overview">
        <div className="s-thread-overview-copy">
          <div className="s-sessions-header s-thread-overview-heading">
            <h2 className="s-page-title">Follow</h2>
            <span className="s-meta s-tabular">{route.preferredView ?? "auto"}</span>
          </div>
          <p className="s-thread-overview-summary">
            {error ? "Opening the closest available Scout view." : "Resolving Scout context..."}
          </p>
        </div>
      </section>
    </div>
  );
}
