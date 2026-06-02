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

export function parseElapsedDurationSeconds(value: string | null | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!match) {
    const secondsOnly = trimmed.match(/^(\d+)$/);
    return secondsOnly ? Number.parseInt(secondsOnly[1]!, 10) : null;
  }
  const [, days, hours, minutes, seconds] = match;
  let total = Number.parseInt(seconds!, 10) + Number.parseInt(minutes!, 10) * 60;
  if (hours) total += Number.parseInt(hours, 10) * 3600;
  if (days) total += Number.parseInt(days, 10) * 86400;
  return total;
}

export function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remMinutes = minutes % 60;
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function formatElapsedDuration(value: string | null | undefined): string | null {
  const seconds = parseElapsedDurationSeconds(value);
  return seconds === null ? null : formatDurationSeconds(seconds);
}
