import { useCallback, useEffect, useState } from "react";

import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import type { AgentObservePayload } from "../lib/types.ts";
import { SessionObserve } from "./sessions/SessionObserve.tsx";

type ObserveEmbedScreenProps = {
  agentId: string;
};

const EMBED_REFRESH_INTERVAL_MS = 2_500;

function shortSessionId(value: string | null | undefined): string {
  if (!value) return "no session";
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

export function ObserveEmbedScreen({ agentId }: ObserveEmbedScreenProps) {
  const [observe, setObserve] = useState<AgentObservePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setError(null);
    try {
      const result = await api<AgentObservePayload>(
        `/api/agents/${encodeURIComponent(agentId)}/observe`,
      );
      setObserve(result);
    } catch (err) {
      if (!background) setObserve(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      void load(true);
    }, EMBED_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  useBrokerEvents(() => {
    void load(true);
  });

  if (error && !observe) {
    return (
      <div className="s-observe-embed-page">
        <div className="s-observe-embed-empty">
          <div className="s-observe-embed-empty-title">Observe unavailable</div>
          <div className="s-observe-embed-empty-detail">{error}</div>
        </div>
      </div>
    );
  }

  if (loading && !observe) {
    return (
      <div className="s-observe-embed-page">
        <div className="s-observe-embed-empty">
          <div className="s-observe-embed-empty-title">Resolving trace</div>
          <div className="s-observe-embed-empty-detail">{agentId}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="s-observe-embed-page">
      {observe && (
        <div className="s-observe-embed-status">
          <span className="s-observe-embed-status-source">{observe.source}</span>
          <span>{observe.fidelity}</span>
          <span title={observe.sessionId ?? undefined}>{shortSessionId(observe.sessionId)}</span>
          <span>{observe.data.events.length} events</span>
          {observe.data.live && <span className="s-observe-embed-status-live">Live</span>}
        </div>
      )}
      <SessionObserve
        data={observe?.data}
        agentId={agentId}
        sessionId={observe?.sessionId}
        showRail={false}
      />
    </div>
  );
}
