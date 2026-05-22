import { epochMs } from "@openscout/protocol";

export type TimestampInput = number | null | undefined;

/**
 * Convert any UI timestamp to epoch milliseconds.
 *
 * UI surfaces should call this helper rather than re-guessing seconds vs ms at
 * each call site. The seconds branch is a temporary defensive bridge for legacy
 * API payloads.
 */
export function normalizeTimestampMs(value: TimestampInput): number | null {
  return epochMs(value);
}

export function compareTimestampsAsc(
  left: TimestampInput,
  right: TimestampInput,
): number {
  return (normalizeTimestampMs(left) ?? 0) - (normalizeTimestampMs(right) ?? 0);
}

export function compareTimestampsDesc(
  left: TimestampInput,
  right: TimestampInput,
): number {
  return compareTimestampsAsc(right, left);
}

/** Relative time label: "now", "5s", "10m", "2h", "3d". */
export function timeAgo(ts: TimestampInput, nowMs = Date.now()): string {
  const tsMs = normalizeTimestampMs(ts);
  if (tsMs === null) return "";
  const diff = Math.floor((nowMs - tsMs) / 1000);
  if (diff < 5) return "now";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

/** Full human-readable timestamp. */
export function fullTimestamp(ts: TimestampInput): string {
  const tsMs = normalizeTimestampMs(ts);
  if (tsMs === null) return "";
  const d = new Date(tsMs);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit",
  });
}

/** Compact absolute timestamp for titles and thread headers. */
export function formatAbsoluteTimestamp(ts: TimestampInput): string {
  const tsMs = normalizeTimestampMs(ts);
  if (tsMs === null) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(tsMs);
}
