import { useCallback, useEffect, useState } from "react";

import { api } from "./api.ts";
import { useTailEvents } from "./tail-events.ts";
import { appendLiveTailEvent, mergeHydratedTailEvents } from "./tail-event-merge.ts";
import type { TailDiscoverySnapshot, TailEvent } from "./types.ts";

const DEFAULT_RECENT_LIMIT = 500;
const DEFAULT_DISCOVERY_INTERVAL_MS = 30_000;

type TailDiscoveryScope = "hot" | "shallow" | "deep";

function emptyTailDiscoverySnapshot(): TailDiscoverySnapshot {
  return {
    generatedAt: Date.now(),
    processes: [],
    transcripts: [],
    totals: {
      total: 0,
      scoutManaged: 0,
      hudsonManaged: 0,
      unattributed: 0,
      transcripts: 0,
    },
  };
}

async function fetchRecentTailEvents(
  recentLimit: number,
  includeTranscriptReplay: boolean,
): Promise<TailEvent[]> {
  const params = new URLSearchParams({ limit: String(recentLimit) });
  if (includeTranscriptReplay) {
    params.set("transcripts", "true");
  }
  const result = await api<{ events: TailEvent[] }>(
    `/api/tail/recent?${params.toString()}`,
  );
  return result.events ?? [];
}

function tailDiscoveryPath(scope?: TailDiscoveryScope, limit?: number): string {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    params.set("limit", String(Math.floor(limit)));
  }
  const query = params.toString();
  return query ? `/api/tail/discover?${query}` : "/api/tail/discover";
}

function documentIsHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function useTailFeed(options?: {
  recentLimit?: number;
  discoveryIntervalMs?: number;
  includeTranscriptReplay?: boolean;
  hydrateOnDiscovery?: boolean;
  discoveryScope?: TailDiscoveryScope;
  discoveryLimit?: number;
  pauseWhenHidden?: boolean;
}): {
  discovery: TailDiscoverySnapshot | null;
  events: TailEvent[];
  refreshDiscovery: () => Promise<void>;
} {
  const recentLimit = options?.recentLimit ?? DEFAULT_RECENT_LIMIT;
  const discoveryIntervalMs = options?.discoveryIntervalMs ?? DEFAULT_DISCOVERY_INTERVAL_MS;
  const includeTranscriptReplay = options?.includeTranscriptReplay ?? false;
  const hydrateOnDiscovery = options?.hydrateOnDiscovery ?? includeTranscriptReplay;
  const discoveryScope = options?.discoveryScope;
  const discoveryLimit = options?.discoveryLimit;
  const pauseWhenHidden = options?.pauseWhenHidden ?? false;

  const [discovery, setDiscovery] = useState<TailDiscoverySnapshot | null>(null);
  const [events, setEvents] = useState<TailEvent[]>([]);

  useTailEvents((event) => {
    setEvents((previous) => appendLiveTailEvent(previous, event, recentLimit));
  });

  const refreshDiscovery = useCallback(async () => {
    if (pauseWhenHidden && documentIsHidden()) return;
    try {
      const snap = await api<TailDiscoverySnapshot>(tailDiscoveryPath(discoveryScope, discoveryLimit));
      setDiscovery(snap);
      if (hydrateOnDiscovery && ((snap.transcripts?.length ?? 0) > 0 || snap.processes.length > 0)) {
        void fetchRecentTailEvents(recentLimit, includeTranscriptReplay)
          .then((hydrated) => {
            setEvents((previous) => mergeHydratedTailEvents(previous, hydrated, recentLimit));
          })
          .catch(() => {});
      }
    } catch {
      setDiscovery((previous) => previous ?? emptyTailDiscoverySnapshot());
    }
  }, [discoveryLimit, discoveryScope, hydrateOnDiscovery, includeTranscriptReplay, pauseWhenHidden, recentLimit]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void refreshDiscovery();
    };
    const handleVisibilityChange = () => {
      if (!documentIsHidden()) tick();
    };
    tick();
    const timer = setInterval(tick, discoveryIntervalMs);
    if (pauseWhenHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (pauseWhenHidden && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [discoveryIntervalMs, pauseWhenHidden, refreshDiscovery]);

  useEffect(() => {
    if (pauseWhenHidden && documentIsHidden()) return;
    let cancelled = false;
    void fetchRecentTailEvents(recentLimit, includeTranscriptReplay)
      .then((hydrated) => {
        if (!cancelled) {
          // One-shot hydration of history. Merge (not replace) so any live event
          // that streamed in during the fetch survives, and dedupe the overlap.
          setEvents((previous) => mergeHydratedTailEvents(previous, hydrated, recentLimit));
        }
      })
      .catch(() => {
        // Keep live events already streamed through the firehose; tail history is
        // an enrichment path and should not blank the lane UI when unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [includeTranscriptReplay, pauseWhenHidden, recentLimit]);

  return { discovery, events, refreshDiscovery };
}
