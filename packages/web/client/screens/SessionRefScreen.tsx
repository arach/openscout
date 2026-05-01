import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { useTailEvents } from "../lib/tail-events.ts";
import type {
  AgentObservePayload,
  ObserveData,
  Route,
  SessionEntry,
} from "../lib/types.ts";
import { ConversationScreen } from "./ConversationScreen.tsx";
import { SessionObserve } from "./SessionObserve.tsx";
import "./inbox-thread-redesign.css";

type SessionRefObservePayload =
  | ({
      kind: "agent";
      refId: string;
      agentId: string;
    } & Omit<AgentObservePayload, "agentId">)
  | {
      kind: "history";
      refId: string;
      agentId: null;
      source: "history";
      fidelity: "timestamped" | "synthetic";
      historyPath: string;
      sessionId: string;
      updatedAt: number;
      data: ObserveData;
    };

type SessionRefLookup =
  | {
      kind: "conversation";
      refId: string;
      conversationId: string;
      session: SessionEntry;
    }
  | {
      kind: "observe";
      refId: string;
      session: SessionEntry | null;
      observe: SessionRefObservePayload;
    };

function normalizeSessionRef(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  const leaf = trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? trimmed;
  return leaf.endsWith(".jsonl") ? leaf.slice(0, -".jsonl".length) : leaf;
}

export function SessionRefScreen({
  sessionRef,
  navigate,
}: {
  sessionRef: string;
  navigate: (r: Route) => void;
}) {
  const [lookup, setLookup] = useState<SessionRefLookup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api<SessionRefLookup>(
        `/api/session-ref/${encodeURIComponent(sessionRef)}`,
      );
      setLookup(result);
    } catch (e) {
      setLookup(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionRef]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useBrokerEvents(() => {
    void load();
  });

  useTailEvents((event) => {
    const eventRef = normalizeSessionRef(event.sessionId);
    const routeRef = normalizeSessionRef(sessionRef);
    const observeRef = lookup?.kind === "observe"
      ? normalizeSessionRef(lookup.observe.sessionId ?? lookup.observe.refId)
      : "";
    const externalRef = lookup?.kind === "observe"
      ? normalizeSessionRef(lookup.observe.data.metadata?.session?.externalSessionId)
      : "";
    if (
      eventRef !== routeRef
      && (!observeRef || eventRef !== observeRef)
      && (!externalRef || eventRef !== externalRef)
    ) {
      return;
    }

    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void load();
    }, 150);
  });

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  if (lookup?.kind === "conversation") {
    return (
      <ConversationScreen
        conversationId={lookup.conversationId}
        navigate={navigate}
      />
    );
  }

  if (lookup?.kind === "observe") {
    return (
      <SessionObserve
        data={lookup.observe.data}
        agentId={lookup.observe.agentId ?? lookup.session?.agentId ?? undefined}
        sessionId={lookup.observe.sessionId ?? lookup.observe.refId}
      />
    );
  }

  return (
    <div className="s-sessions-screen s-inbox-thread-redesign">
      <section className="s-thread-overview">
        <div className="s-thread-overview-copy">
          <div className="s-sessions-header s-thread-overview-heading">
            <h2 className="s-page-title">Session</h2>
            <span className="s-meta s-tabular">{sessionRef.slice(0, 8)}</span>
          </div>
          <p className="s-thread-overview-summary">
            {loading
              ? "Resolving session reference..."
              : error
                ? "No matching conversation, agent session, or Claude history file."
                : "No matching session reference."}
          </p>
        </div>
      </section>
    </div>
  );
}
