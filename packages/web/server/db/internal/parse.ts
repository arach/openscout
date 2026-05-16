/**
 * Small value parsers used across the read-side queries. Lifted from
 * db-queries.ts as part of SCO-031 Phase A.
 */

export function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function coerceNumber(value: number | string | null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeTimestampMs(value: number | string | null): number | null {
  const numeric = coerceNumber(value);
  if (numeric === null) {
    return null;
  }
  return numeric < 1e12 ? numeric * 1000 : numeric;
}
