import { api } from "../../lib/api.ts";
import type { RepoDiffLayerKind, ScoutRepoDiffSnapshot } from "./types.ts";

export type RepoDiffCacheRecord = {
  snapshot: ScoutRepoDiffSnapshot;
  fetchedAt: number;
  cacheHit: boolean;
};

export type RepoDiffCacheRead = Omit<RepoDiffCacheRecord, "cacheHit"> & {
  ageMs: number;
  fresh: boolean;
};

const DEFAULT_LAYERS: RepoDiffLayerKind[] = ["unstaged", "staged"];
const DEFAULT_MAX_AGE_MS = 30_000;
const MAX_CACHE_ENTRIES = 24;
const MAX_PREFETCH_PER_BATCH = 4;

const cache = new Map<string, Omit<RepoDiffCacheRecord, "cacheHit">>();
const inFlight = new Map<string, Promise<RepoDiffCacheRecord>>();
const queuedPrefetches = new Set<string>();
let prefetchQueue = Promise.resolve();

export function buildRepoDiffUrl(
  path: string,
  layers: readonly RepoDiffLayerKind[] = DEFAULT_LAYERS,
): string {
  const params = new URLSearchParams();
  params.set("path", path);
  for (const layer of layers) params.append("layer", layer);
  return `/api/repo-diff/worktree?${params.toString()}`;
}

function cacheKey(path: string, layers: readonly RepoDiffLayerKind[]): string {
  return buildRepoDiffUrl(path, layers);
}

function trimCache(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export function readRepoDiffCache(
  path: string,
  layers: readonly RepoDiffLayerKind[] = DEFAULT_LAYERS,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): RepoDiffCacheRead | null {
  const record = cache.get(cacheKey(path, layers));
  if (!record) return null;
  const ageMs = Math.max(0, Date.now() - record.fetchedAt);
  return {
    ...record,
    ageMs,
    fresh: ageMs <= maxAgeMs,
  };
}

export async function fetchRepoDiffSnapshot(
  path: string,
  layers: readonly RepoDiffLayerKind[] = DEFAULT_LAYERS,
  options: { force?: boolean } = {},
): Promise<RepoDiffCacheRecord> {
  const key = cacheKey(path, layers);
  if (!options.force) {
    const existing = cache.get(key);
    if (existing && Date.now() - existing.fetchedAt <= DEFAULT_MAX_AGE_MS) {
      return { ...existing, cacheHit: true };
    }
    const active = inFlight.get(key);
    if (active) return active;
  }

  const request = api<ScoutRepoDiffSnapshot>(key).then((snapshot) => {
    const record = { snapshot, fetchedAt: Date.now() };
    cache.delete(key);
    cache.set(key, record);
    trimCache();
    return { ...record, cacheHit: false };
  });

  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}

export function prefetchRepoDiffSnapshot(
  path: string,
  layers: readonly RepoDiffLayerKind[] = DEFAULT_LAYERS,
): void {
  const key = cacheKey(path, layers);
  if (readRepoDiffCache(path, layers)?.fresh) return;
  if (inFlight.has(key) || queuedPrefetches.has(key)) return;
  queuedPrefetches.add(key);
  prefetchQueue = prefetchQueue
    .catch(() => undefined)
    .then(() => fetchRepoDiffSnapshot(path, layers).then(
      () => undefined,
      () => undefined,
    ))
    .finally(() => {
      queuedPrefetches.delete(key);
    });
}

export function prefetchRepoDiffSnapshots(
  paths: readonly string[],
  layers: readonly RepoDiffLayerKind[] = DEFAULT_LAYERS,
): void {
  for (const path of paths.slice(0, MAX_PREFETCH_PER_BATCH)) {
    prefetchRepoDiffSnapshot(path, layers);
  }
}

export function repoDiffCacheAgeLabel(ageMs: number): string {
  if (ageMs < 5_000) return "just now";
  const seconds = Math.round(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}
