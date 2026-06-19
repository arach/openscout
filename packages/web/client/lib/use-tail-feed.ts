import { useCallback, useEffect, useState } from "react";

import { api } from "./api.ts";
import { useTailEvents } from "./tail-events.ts";
import type { TailDiscoverySnapshot, TailEvent } from "./types.ts";

const DEFAULT_RECENT_LIMIT = 500;
const DEFAULT_DISCOVERY_INTERVAL_MS = 30_000;

export function useTailFeed(options?: {
  recentLimit?: number;
  discoveryIntervalMs?: number;
  includeTranscriptReplay?: boolean;
}): {
  discovery: TailDiscoverySnapshot | null;
  events: TailEvent[];
  refreshDiscovery: () => Promise<void>;
} {
  const recentLimit = options?.recentLimit ?? DEFAULT_RECENT_LIMIT;
  const discoveryIntervalMs = options?.discoveryIntervalMs ?? DEFAULT_DISCOVERY_INTERVAL_MS;
  const includeTranscriptReplay = options?.includeTranscriptReplay ?? false;

  const [discovery, setDiscovery] = useState<TailDiscoverySnapshot | null>(null);
  const [events, setEvents] = useState<TailEvent[]>([]);

  useTailEvents((event) => {
    setEvents((previous) => {
      const next = previous.length >= recentLimit
        ? [...previous.slice(previous.length - recentLimit + 1), event]
        : [...previous, event];
      return next;
    });
  });

  const refreshDiscovery = useCallback(async () => {
    try {
      const snap = await api<TailDiscoverySnapshot>("/api/tail/discover");
      setDiscovery(snap);
    } catch {
      setDiscovery(null);
    }
  }, []);

  useEffect(() => {
    void refreshDiscovery();
    const timer = setInterval(() => void refreshDiscovery(), discoveryIntervalMs);
    return () => clearInterval(timer);
  }, [discoveryIntervalMs, refreshDiscovery]);

  useEffect(() => {
    let cancelled = false;
    const loadRecent = async () => {
      try {
        const params = new URLSearchParams({ limit: String(recentLimit) });
        if (includeTranscriptReplay) {
          params.set("transcripts", "true");
        }
        const result = await api<{ events: TailEvent[] }>(
          `/api/tail/recent?${params.toString()}`,
        );
        if (!cancelled) {
          setEvents(result.events ?? []);
        }
      } catch {
        if (!cancelled) setEvents([]);
      }
    };
    void loadRecent();
    return () => {
      cancelled = true;
    };
  }, [includeTranscriptReplay, recentLimit]);

  return { discovery, events, refreshDiscovery };
}