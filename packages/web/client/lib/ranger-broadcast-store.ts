import { useSyncExternalStore } from "react";

import { api } from "./api.ts";
import type { Broadcast } from "./types.ts";

const HISTORY_LIMIT = 50;
const VISIBLE_LIFETIME_MS = 30_000;
const PROMOTE_LIFETIME_MS = 5 * 60_000;
const TOGGLE_RANGER_EVENT = "openscout:toggle-ranger";

type StoreSnapshot = {
  history: readonly Broadcast[];
  latest: Broadcast | null;
  promotedId: string | null;
  dismissedId: string | null;
  now: number;
};

let snapshot: StoreSnapshot = {
  history: [],
  latest: null,
  promotedId: null,
  dismissedId: null,
  now: Date.now(),
};
const listeners = new Set<() => void>();
let eventSource: EventSource | null = null;
let retryTimeout: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let seeded = false;

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function setSnapshot(updater: (prev: StoreSnapshot) => StoreSnapshot): void {
  const next = updater(snapshot);
  if (next === snapshot) return;
  snapshot = next;
  emit();
}

function appendBroadcast(broadcast: Broadcast): void {
  setSnapshot((prev) => {
    if (prev.history.some((b) => b.id === broadcast.id)) return prev;
    const merged = [...prev.history, broadcast];
    const trimmed =
      merged.length > HISTORY_LIMIT
        ? merged.slice(merged.length - HISTORY_LIMIT)
        : merged;
    return {
      ...prev,
      history: trimmed,
      latest: broadcast,
      promotedId: broadcast.id,
      dismissedId: null,
    };
  });
}

function mergeHistory(incoming: Broadcast[]): void {
  setSnapshot((prev) => {
    const seen = new Set(prev.history.map((b) => b.id));
    const merged = [...prev.history];
    for (const b of incoming) if (!seen.has(b.id)) merged.push(b);
    merged.sort((a, b) => a.ts - b.ts);
    const trimmed =
      merged.length > HISTORY_LIMIT
        ? merged.slice(merged.length - HISTORY_LIMIT)
        : merged;
    const latest = trimmed.length ? trimmed[trimmed.length - 1]! : null;
    return {
      ...prev,
      history: trimmed,
      latest,
      promotedId: prev.promotedId ?? latest?.id ?? null,
    };
  });
}

function scheduleReconnect(): void {
  if (retryTimeout || listeners.size === 0) return;
  failures++;
  const delay = Math.min(2_000 * 2 ** (failures - 1), 30_000);
  retryTimeout = setTimeout(() => {
    retryTimeout = null;
    if (listeners.size > 0) connectStream();
  }, delay);
}

function connectStream(): void {
  if (eventSource || listeners.size === 0) return;
  const es = new EventSource("/api/broadcast/stream");
  eventSource = es;
  es.onopen = () => {
    failures = 0;
  };
  es.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data) as Broadcast;
      appendBroadcast(parsed);
    } catch {
      /* swallow */
    }
  };
  es.addEventListener("ready", () => {
    failures = 0;
  });
  es.onerror = () => {
    if (eventSource === es) {
      eventSource = null;
    }
    es.close();
    scheduleReconnect();
  };
}

function tearDownStream(): void {
  eventSource?.close();
  eventSource = null;
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
  failures = 0;
}

function startTicking(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    setSnapshot((prev) => ({ ...prev, now: Date.now() }));
  }, 1_000);
}

function stopTicking(): void {
  if (!tickTimer) return;
  clearInterval(tickTimer);
  tickTimer = null;
}

async function seedFromRecent(): Promise<void> {
  if (seeded) return;
  seeded = true;
  try {
    const result = await api<{ broadcasts: Broadcast[] }>(
      `/api/broadcast/recent?limit=${HISTORY_LIMIT}`,
    );
    if (result.broadcasts?.length) mergeHistory(result.broadcasts);
  } catch {
    /* swallow */
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    connectStream();
    startTicking();
    void seedFromRecent();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      tearDownStream();
      stopTicking();
    }
  };
}

function getSnapshot(): StoreSnapshot {
  return snapshot;
}

export function useRangerBroadcastStore(): StoreSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function dismissPromotedBroadcast(): void {
  setSnapshot((prev) => {
    if (!prev.promotedId) return prev;
    return { ...prev, dismissedId: prev.promotedId, promotedId: null };
  });
}

export function selectActiveBroadcast(snap: StoreSnapshot): Broadcast | null {
  if (!snap.promotedId) return null;
  if (snap.dismissedId && snap.dismissedId === snap.promotedId) return null;
  const found = snap.history.find((b) => b.id === snap.promotedId);
  if (!found) return null;
  if (snap.now - found.ts > PROMOTE_LIFETIME_MS) return null;
  return found;
}

export function selectChipBroadcast(snap: StoreSnapshot): Broadcast | null {
  const active = selectActiveBroadcast(snap);
  if (!active) return null;
  if (snap.now - active.ts > VISIBLE_LIFETIME_MS) return null;
  return active;
}

export function toggleRanger(broadcast?: Broadcast | null): void {
  if (typeof window === "undefined") return;
  const detail = broadcast ? { broadcastId: broadcast.id } : {};
  window.dispatchEvent(new CustomEvent(TOGGLE_RANGER_EVENT, { detail }));
}

export function onToggleRanger(
  handler: (detail: { broadcastId?: string }) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail ?? {};
    handler(detail as { broadcastId?: string });
  };
  window.addEventListener(TOGGLE_RANGER_EVENT, listener);
  return () => window.removeEventListener(TOGGLE_RANGER_EVENT, listener);
}

export const TOGGLE_RANGER_EVENT_NAME = TOGGLE_RANGER_EVENT;
