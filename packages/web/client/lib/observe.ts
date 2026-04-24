import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api.ts";
import { normalizeAgentState } from "./agent-state.ts";
import type { Agent, AgentObservePayload, ObserveEvent } from "./types.ts";

const ACTIVE_POLL_INTERVAL_MS = 2500;
const IDLE_POLL_INTERVAL_MS = 10000;

export type ObserveCacheEntry = Omit<AgentObservePayload, "agentId">;
export type ObserveCache = Record<string, ObserveCacheEntry>;

export function useObservePolling(agents: Agent[]): ObserveCache {
  const [cache, setCache] = useState<ObserveCache>({});
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const agentIds = agents
    .map((agent) => agent.id.trim())
    .filter((agentId) => agentId.length > 0)
    .join(",");
  const pollIntervalMs = agents.some((agent) => normalizeAgentState(agent.state) === "working")
    ? ACTIVE_POLL_INTERVAL_MS
    : IDLE_POLL_INTERVAL_MS;

  const fetchAll = useCallback(async () => {
    if (agents.length === 0) {
      setCache({});
      return;
    }
    if (inFlightRef.current) {
      queuedRef.current = true;
      return;
    }
    inFlightRef.current = true;

    try {
      const query = agentIds ? `?ids=${encodeURIComponent(agentIds)}` : "";
      const results = await api<AgentObservePayload[]>(`/api/observe/agents${query}`);

      if (!mountedRef.current) {
        return;
      }

      setCache((previous) => {
        const next: ObserveCache = {};
        for (const agent of agents) {
          next[agent.id] = previous[agent.id];
        }
        for (const result of results) {
          const { agentId, ...entry } = result;
          next[agentId] = entry;
        }
        return next;
      });
    } finally {
      inFlightRef.current = false;
      if (queuedRef.current) {
        queuedRef.current = false;
        void fetchAll();
      }
    }
  }, [agentIds, agents]);

  useEffect(() => {
    mountedRef.current = true;
    if (agents.length === 0) {
      setCache({});
      return () => {
        mountedRef.current = false;
      };
    }
    void fetchAll();
    const timer = setInterval(() => void fetchAll(), pollIntervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [agents.length, fetchAll, pollIntervalMs]);
  return cache;
}

export function summarizeObserveEvent(event: ObserveEvent): string {
  switch (event.kind) {
    case "tool":
      return `${event.tool ?? "tool"} ${event.arg ?? ""}`.trim();
    case "think":
      return event.text.slice(0, 120);
    case "ask":
      return `ask: ${event.text}`.slice(0, 120);
    case "message":
      return event.text.slice(0, 100);
    case "note":
      return event.text.slice(0, 100);
    case "system":
    case "boot":
      return event.text.slice(0, 100);
  }
}
