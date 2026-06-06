import { type FileHandle, open, stat } from "node:fs/promises";

/** Default size of the tail window we read from each transcript. */
export const TAIL_READ_BYTES = 64 * 1024;
/** Default size of the head window for fallback scans. */
export const HEAD_READ_BYTES = 32 * 1024;

/**
 * Read the trailing `bytes` of a file as a string and return the complete
 * lines, last-first. Drops the leading partial line if we did not start at
 * offset 0. Returns `[]` on any I/O error so callers can treat it as "no
 * usable tail".
 */
export async function readTailLines(
  path: string,
  bytes = TAIL_READ_BYTES,
): Promise<string[]> {
  let handle: FileHandle | null = null;
  try {
    const stats = await stat(path);
    if (stats.size <= 0) return [];
    const start = Math.max(0, stats.size - bytes);
    const length = stats.size - start;
    const buffer = Buffer.alloc(length);
    handle = await open(path, "r");
    await handle.read(buffer, 0, length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) {
      lines.shift();
    }
    const trimmed = lines.map((line) => line.trim()).filter(Boolean);
    trimmed.reverse();
    return trimmed;
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Read the leading `bytes` of a file (first-first). Drops the trailing partial
 * line. Returns `[]` on any I/O error.
 */
export async function readHeadLines(
  path: string,
  bytes = HEAD_READ_BYTES,
): Promise<string[]> {
  let handle: FileHandle | null = null;
  try {
    const stats = await stat(path);
    if (stats.size <= 0) return [];
    const length = Math.min(bytes, stats.size);
    const buffer = Buffer.alloc(length);
    handle = await open(path, "r");
    await handle.read(buffer, 0, length, 0);
    const lines = buffer.toString("utf8").split("\n");
    if (length < stats.size) {
      lines.pop();
    }
    return lines.map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => {});
  }
}

export function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
