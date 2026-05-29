import { basename } from "node:path";

import type {
  DiscoveredProcess,
  DiscoveredTranscript,
  TailEvent,
  TailSessionPreview,
  TailSessionPreviewFact,
  TailSessionPreviewInput,
  TailSessionPreviewStats,
} from "./types.js";

const MAX_SUMMARY_LEN = 180;

function compactText(value: string | null | undefined, max = MAX_SUMMARY_LEN): string | null {
  const flat = value?.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function pathLeaf(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[\\/]+$/, "");
  return basename(cleaned) || cleaned || null;
}

function shortSessionId(value: string | null | undefined): string | null {
  const leaf = pathLeaf(value);
  if (!leaf) return null;
  const compact = leaf
    .replace(/\.jsonl$/i, "")
    .replace(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/i, "")
    .replace(/^session[_:-]?/i, "");
  return compact.length > 10 ? compact.slice(0, 8) : compact;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
}

function latestRelevantSummary(events: TailEvent[]): string | null {
  const preferred = events
    .filter((event) => event.kind === "assistant" || event.kind === "user")
    .sort((left, right) => right.ts - left.ts)[0];
  const fallback = events
    .filter((event) => event.kind !== "system")
    .sort((left, right) => right.ts - left.ts)[0];
  return compactText((preferred ?? fallback)?.summary);
}

function count(events: TailEvent[], kind: TailEvent["kind"]): number {
  return events.filter((event) => event.kind === kind).length;
}

function buildStats(
  transcript: DiscoveredTranscript,
  process: DiscoveredProcess | null,
  events: TailEvent[],
): TailSessionPreviewStats {
  const lastEventAt = events.reduce(
    (latest, event) => Math.max(latest, event.ts || 0),
    0,
  ) || null;
  const updatedAt = Math.max(transcript.mtimeMs || 0, lastEventAt ?? 0) || null;
  return {
    eventCount: events.length,
    userMessages: count(events, "user"),
    assistantMessages: count(events, "assistant"),
    toolCalls: count(events, "tool"),
    toolResults: count(events, "tool-result"),
    systemEvents: count(events, "system"),
    otherEvents: count(events, "other"),
    transcriptBytes: Number.isFinite(transcript.size) ? transcript.size : null,
    processPid: process && process.pid > 0 ? process.pid : null,
    lastEventAt,
    updatedAt,
  };
}

function buildFacts(stats: TailSessionPreviewStats): TailSessionPreviewFact[] {
  const turns = stats.userMessages + stats.assistantMessages;
  return [
    { key: "turns", label: "turns", value: turns > 0 ? String(turns) : "-" },
    { key: "tools", label: "tools", value: stats.toolCalls > 0 ? String(stats.toolCalls) : "-" },
    { key: "events", label: "events", value: stats.eventCount > 0 ? String(stats.eventCount) : "-" },
    { key: "size", label: "size", value: formatBytes(stats.transcriptBytes) },
    ...(stats.processPid
      ? [{ key: "pid", label: "pid", value: String(stats.processPid) }]
      : []),
  ];
}

export function buildTailSessionPreview(input: TailSessionPreviewInput): TailSessionPreview {
  const { transcript, process, events } = input;
  const source = transcript.source || process?.source || "session";
  const project = transcript.project?.trim()
    || pathLeaf(transcript.cwd)
    || pathLeaf(process?.cwd)
    || "unknown";
  const title = shortSessionId(transcript.sessionId)
    ?? shortSessionId(transcript.transcriptPath)
    ?? `${source} session`;
  const stats = buildStats(transcript, process, events);
  const cwd = transcript.cwd ?? process?.cwd ?? null;
  const fallbackSummary = `${process && process.pid > 0 ? "Active" : "Observed"} ${source} session${
    project && project !== "unknown" ? ` in ${project}` : ""
  }`;
  const summary = latestRelevantSummary(events)
    ?? compactText(fallbackSummary)
    ?? compactText(cwd)
    ?? compactText(transcript.transcriptPath);

  return {
    title,
    subtitle: `${source} · ${project}`,
    summary,
    detail: cwd ?? transcript.transcriptPath,
    updatedAt: stats.updatedAt,
    stats,
    facts: buildFacts(stats),
  };
}
