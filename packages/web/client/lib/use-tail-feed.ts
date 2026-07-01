import { useCallback, useEffect, useState } from "react";

import { api } from "./api.ts";
import { useTailEvents } from "./tail-events.ts";
import { appendLiveTailEvent, mergeHydratedTailEvents } from "./tail-event-merge.ts";
import type { TailDiscoverySnapshot, TailEvent } from "./types.ts";

const DEFAULT_RECENT_LIMIT = 500;
const DEFAULT_DISCOVERY_INTERVAL_MS = 30_000;

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
    setEvents((previous) => appendLiveTailEvent(previous, event, recentLimit));
  });

  const refreshDiscovery = useCallback(async () => {
    try {
      const snap = await api<TailDiscoverySnapshot>("/api/tail/discover");
      setDiscovery(snap);
      if (includeTranscriptReplay && ((snap.transcripts?.length ?? 0) > 0 || snap.processes.length > 0)) {
        void fetchRecentTailEvents(recentLimit, includeTranscriptReplay)
          .then((hydrated) => {
            setEvents((previous) => mergeHydratedTailEvents(previous, hydrated, recentLimit));
          })
          .catch(() => {});
      }
    } catch {
      setDiscovery((previous) => previous ?? emptyTailDiscoverySnapshot());
    }
  }, [includeTranscriptReplay, recentLimit]);

  useEffect(() => {
    void refreshDiscovery();
    const timer = setInterval(() => void refreshDiscovery(), discoveryIntervalMs);
    return () => clearInterval(timer);
  }, [discoveryIntervalMs, refreshDiscovery]);

  useEffect(() => {
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
  }, [includeTranscriptReplay, recentLimit]);

  return { discovery, events, refreshDiscovery };
}
