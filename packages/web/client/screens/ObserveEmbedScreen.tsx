import { useCallback, useEffect, useState } from "react";

import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import type { AgentObservePayload } from "../lib/types.ts";
import { SessionObserve } from "./SessionObserve.tsx";

type ObserveEmbedScreenProps = {
  agentId: string;
};

export function ObserveEmbedScreen({ agentId }: ObserveEmbedScreenProps) {
  const [observe, setObserve] = useState<AgentObservePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api<AgentObservePayload>(
        `/api/agents/${encodeURIComponent(agentId)}/observe`,
      );
      setObserve(result);
    } catch (err) {
      setObserve(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useBrokerEvents(() => {
    void load();
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
      <SessionObserve
        data={observe?.data}
        agentId={agentId}
        sessionId={observe?.sessionId}
        showRail={false}
      />
    </div>
  );
}
