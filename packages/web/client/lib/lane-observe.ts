import { fullTimestamp, timeAgo } from "./time.ts";
import { observeToolIsEdit, observeToolIsRead } from "./tail-display.ts";
import type { ObserveEvent, ObserveFile, ObserveData } from "./types.ts";

export type LaneTraceWindowStats = {
  eventCount: number;
  spanMs: number;
  oldestAt: number | null;
  newestAt: number | null;
  /** Oldest loaded event starts after the horizon cutoff — earlier window may be missing. */
  truncatedBefore: boolean;
  /** Events in source data that fell before the horizon cutoff. */
  hiddenBeforeCount: number;
};

const LANE_WALL_GAP_MIN_MS = 2 * 60_000;
const LANE_TRUNCATION_SLACK_MS = 90_000;

/** Lane trace age label — always reads as wall-clock age, never session elapsed. */
export function fmtLaneAgeLabel(wallMs: number, nowMs = Date.now()): string {
  const ago = timeAgo(wallMs, nowMs);
  return ago === "now" ? "now" : `${ago} ago`;
}

export function fmtLaneAgeTitle(wallMs: number): string {
  return fullTimestamp(wallMs);
}

/** Compact duration for trace span summaries (e.g. "18m", "2h 5m"). */
export function fmtTraceSpanMs(spanMs: number): string {
  if (!Number.isFinite(spanMs) || spanMs <= 0) return "0s";
  if (spanMs < 60_000) {
    return `${Math.max(1, Math.round(spanMs / 1000))}s`;
  }
  if (spanMs < 3_600_000) {
    return `${Math.max(1, Math.round(spanMs / 60_000))}m`;
  }
  const hours = Math.floor(spanMs / 3_600_000);
  const minutes = Math.round((spanMs % 3_600_000) / 60_000);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** Wall-clock gap label between lane events (null when gap is too small to show). */
export function fmtLaneWallGapLabel(gapMs: number): string | null {
  if (!Number.isFinite(gapMs) || gapMs < LANE_WALL_GAP_MIN_MS) return null;
  const totalSeconds = Math.floor(gapMs / 1000);
  if (totalSeconds < 3_600) {
    return `+${Math.floor(totalSeconds / 60)}m gap`;
  }
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return minutes > 0 ? `+${hours}h ${minutes}m gap` : `+${hours}h gap`;
}

export function laneTraceWindowStats(
  events: ObserveEvent[],
  sessionStartMs: number | undefined,
  nowMs: number,
  windowMs: number,
  hiddenBeforeCount = 0,
): LaneTraceWindowStats {
  const cutoff = nowMs - windowMs;

  const wallTimes = events
    .map((event) => observeEventWallMs(event, sessionStartMs))
    .filter((value): value is number => value !== null);

  if (wallTimes.length === 0) {
    return {
      eventCount: 0,
      spanMs: 0,
      oldestAt: null,
      newestAt: null,
      truncatedBefore: false,
      hiddenBeforeCount,
    };
  }

  const oldestAt = Math.min(...wallTimes);
  const newestAt = Math.max(...wallTimes);
  return {
    eventCount: events.length,
    spanMs: Math.max(0, newestAt - oldestAt),
    oldestAt,
    newestAt,
    truncatedBefore: oldestAt > cutoff + LANE_TRUNCATION_SLACK_MS,
    hiddenBeforeCount,
  };
}

export function observeEventWallMs(
  event: ObserveEvent,
  sessionStartMs: number | undefined,
): number | null {
  if (typeof event.at === "number" && Number.isFinite(event.at)) {
    return event.at;
  }
  if (!Number.isFinite(event.t) || event.t < 0) return null;
  if (typeof sessionStartMs !== "number" || !Number.isFinite(sessionStartMs)) return null;
  return sessionStartMs + event.t * 1000;
}

export function filterObserveEventsForHorizon(
  events: ObserveEvent[],
  sessionStartMs: number | undefined,
  now: number,
  windowMs: number,
): ObserveEvent[] {
  const cutoff = now - windowMs;
  return events.filter((event) => {
    const wallMs = observeEventWallMs(event, sessionStartMs);
    if (wallMs === null) return false;
    return wallMs >= cutoff;
  });
}

export function countObserveEventsBeforeHorizon(
  events: ObserveEvent[],
  sessionStartMs: number | undefined,
  nowMs: number,
  windowMs: number,
): number {
  const cutoff = nowMs - windowMs;
  return events.reduce((count, event) => {
    const wallMs = observeEventWallMs(event, sessionStartMs);
    if (wallMs === null || wallMs >= cutoff) return count;
    return count + 1;
  }, 0);
}

export function filterObserveDataForHorizon(
  data: ObserveData | null | undefined,
  now: number,
  windowMs: number,
): ObserveData | null {
  if (!data) return null;

  const sessionStart = data.metadata?.session?.sessionStart;
  const events = filterObserveEventsForHorizon(data.events, sessionStart, now, windowMs);
  if (events.length === data.events.length) return data;

  const cutoff = now - windowMs;
  const files = data.files.filter((file) => {
    if (typeof sessionStart !== "number" || !Number.isFinite(sessionStart)) return true;
    if (!Number.isFinite(file.lastT) || file.lastT < 0) return true;
    return sessionStart + file.lastT * 1000 >= cutoff;
  });

  return {
    ...data,
    events,
    files,
  };
}

export const LANE_SNIPPET_MAX_CHARS = 180;
export const LANE_SNIPPET_MAX_LINES = 3;

export function laneSnippetText(
  text: string,
  maxChars = LANE_SNIPPET_MAX_CHARS,
  maxLines = LANE_SNIPPET_MAX_LINES,
): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const lineLimited = lines.slice(0, maxLines).join("\n");
  if (lineLimited.length <= maxChars && lines.length <= maxLines) {
    return lineLimited;
  }

  const clipped = lineLimited.slice(0, maxChars).trimEnd();
  const boundary = Math.max(
    clipped.lastIndexOf(" "),
    clipped.lastIndexOf("\n"),
    clipped.lastIndexOf("."),
  );
  const soft = boundary > maxChars * 0.55 ? clipped.slice(0, boundary) : clipped;
  return `${soft.trimEnd()}…`;
}

export function laneTextNeedsExpand(
  text: string,
  maxChars = LANE_SNIPPET_MAX_CHARS,
  maxLines = LANE_SNIPPET_MAX_LINES,
): boolean {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return false;
  return normalized.length > maxChars || normalized.split("\n").length > maxLines;
}

const PATH_LIKE = /(?:^|[\s'"`])(\/[^\s'"`]+|(?:[\w@.-]+\/)+[\w@./-]+\.\w{1,8})/g;
const SED_PATH = /\b(?:sed|cat|head|tail|nl)\s+(?:-[^\s]+\s+)*['"]?([^\s'"]+)/;
const RG_FILE = /\b(?:[\w./-]+\/)+[\w@./-]+\.\w{1,8}\b/g;
const GIT_DIFF_PATH = /\bgit\s+diff\b[\s\S]*?\s--\s+([^\n\r;&|]+)/g;
const PATCH_PATH = /^(?:\+\+\+|---)\s+(?:[ab]\/)?([^\s]+)|^\*\*\*\s+(?:Add|Update|Delete) File:\s+(.+)$/gm;

function normalizeInferredPath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed || trimmed.length < 3) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null;
  if (/^(https?:|git@)/.test(trimmed)) return null;
  if (!trimmed.includes("/") && !trimmed.includes(".")) return null;
  return trimmed;
}

function pathsFromToolArg(tool: string | undefined, arg: string | undefined): string[] {
  const paths = new Set<string>();
  const command = arg?.trim();
  if (!command) return [];

  const readJson = command.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (readJson?.[1]) {
    const path = readJson[1].replace(/\\"/g, "\"");
    const normalized = normalizeInferredPath(path);
    if (normalized) paths.add(normalized);
  }

  const sedMatch = command.match(SED_PATH);
  if (sedMatch?.[1]) {
    const normalized = normalizeInferredPath(sedMatch[1]);
    if (normalized) paths.add(normalized);
  }

  for (const match of command.matchAll(GIT_DIFF_PATH)) {
    for (const part of (match[1] ?? "").split(/\s+/)) {
      const normalized = normalizeInferredPath(part);
      if (normalized) paths.add(normalized);
    }
  }

  for (const match of command.matchAll(PATCH_PATH)) {
    const normalized = normalizeInferredPath(match[1] ?? match[2] ?? "");
    if (normalized && normalized !== "/dev/null") paths.add(normalized);
  }

  for (const match of command.matchAll(PATH_LIKE)) {
    const normalized = normalizeInferredPath(match[1] ?? "");
    if (normalized) paths.add(normalized);
  }

  if (paths.size === 0) {
    for (const match of command.matchAll(RG_FILE)) {
      const normalized = normalizeInferredPath(match[0] ?? "");
      if (normalized) paths.add(normalized);
    }
  }

  if (paths.size === 0 && observeToolIsRead(tool) && command.length < 240) {
    const normalized = normalizeInferredPath(command);
    if (normalized) paths.add(normalized);
  }

  return [...paths];
}

function fileStateForTool(tool: string | undefined): ObserveFile["state"] {
  if (observeToolIsEdit(tool)) return "modified";
  if (observeToolIsRead(tool)) return "read";
  return "read";
}

/** Infer touched files from lane trace tool events when full observe files are absent. */
export function filesFromObserveEvents(events: ObserveEvent[]): ObserveFile[] {
  const byPath = new Map<string, ObserveFile>();

  for (const event of events) {
    if (event.kind !== "tool") continue;
    const paths = [
      ...pathsFromToolArg(event.tool, event.arg ?? event.text),
      ...pathsFromToolArg(event.tool, event.detail),
    ];
    for (const path of paths) {
      const state = fileStateForTool(event.tool);
      const existing = byPath.get(path);
      if (!existing) {
        byPath.set(path, {
          path,
          state,
          touches: 1,
          lastT: event.t,
        });
        continue;
      }
      existing.touches += 1;
      existing.lastT = Math.max(existing.lastT, event.t);
      if (state === "modified") existing.state = "modified";
    }
  }

  return [...byPath.values()].sort((left, right) => right.lastT - left.lastT);
}

export function laneToolArgSnippet(arg: string | undefined, max = 96): string {
  const trimmed = arg?.trim();
  if (!trimmed) return "";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
