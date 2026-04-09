import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

export function normalizeTimestamp(value: number | null | undefined): number {
  if (!value) return 0;
  return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
}

export function isoFromTimestamp(value: number): string {
  return new Date(normalizeTimestamp(value) * 1000).toISOString();
}

export function formatTimeLabel(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(normalizeTimestamp(value) * 1000));
}

export function formatDayLabel(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(normalizeTimestamp(value) * 1000)).toUpperCase();
}

export function formatRelativeTime(value: number): string {
  const deltaSeconds = Math.max(0, Math.floor(Date.now() / 1000) - normalizeTimestamp(value));
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}

export function formatDateTimeLabel(value: number | null | undefined): string | null {
  const normalized = normalizeTimestamp(value);
  if (!normalized) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(normalized * 1000));
}

export function compactHomePath(value: string | null | undefined): string | null {
  if (!value) return null;
  const home = homedir();
  return value.startsWith(home) ? value.replace(home, "~") : value;
}

export function expandHomePath(value: string): string {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

export function runOptionalCommand(command: string, args: string[]): string | null {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}
