import type { SessionEnrichment } from "./types.js";

type CacheEntry = {
  key: string;
  enrichment: SessionEnrichment;
  insertedAt: number;
};

const CACHE_MAX_ENTRIES = 512;

const cache = new Map<string, CacheEntry>();

function cacheKey(path: string, mtimeMs: number, size: number): string {
  return `${path}\0${mtimeMs}\0${size}`;
}

export function getCachedEnrichment(
  path: string,
  mtimeMs: number,
  size: number,
): SessionEnrichment | null {
  const key = cacheKey(path, mtimeMs, size);
  const hit = cache.get(key);
  if (!hit) return null;
  // Refresh insertion order so the entry survives LRU eviction.
  cache.delete(key);
  cache.set(key, hit);
  return hit.enrichment;
}

export function setCachedEnrichment(
  path: string,
  mtimeMs: number,
  size: number,
  enrichment: SessionEnrichment,
): void {
  const key = cacheKey(path, mtimeMs, size);
  cache.delete(key);
  cache.set(key, { key, enrichment, insertedAt: Date.now() });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const first = cache.keys().next();
    if (first.done) break;
    cache.delete(first.value);
  }
}

export function clearEnrichmentCache(): void {
  cache.clear();
}

export function enrichmentCacheStats(): { size: number; max: number } {
  return { size: cache.size, max: CACHE_MAX_ENTRIES };
}
