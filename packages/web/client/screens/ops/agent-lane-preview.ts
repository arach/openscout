import { laneToolArgSnippet } from "../../lib/lane-observe.ts";
import { observeToolIsEdit, observeToolIsRead } from "../../lib/tail-display.ts";
import type { Agent, ObserveData, ObserveEvent, ObserveFile } from "../../lib/types.ts";

export type AgentLanePreviewModel = {
  headline: string;
  detail: string | null;
  model: string | null;
  branch: string | null;
  harness: string | null;
  stats: {
    tools: number;
    edits: number;
    reads: number;
    thinks: number;
    files: number;
  };
  files: ObserveFile[];
};

const PLACEHOLDER_MARKERS = [
  "transcript discovered",
  "waiting for events",
  "no session trace",
  "waiting for a live session",
];

function isSubstantiveEvent(event: ObserveEvent): boolean {
  if (event.kind === "tool" || event.kind === "think" || event.kind === "ask" || event.kind === "message") {
    return true;
  }
  if (event.kind === "note") return true;
  if (event.kind === "system" || event.kind === "boot") {
    const text = event.text.trim().toLowerCase();
    return !PLACEHOLDER_MARKERS.some((marker) => text.includes(marker));
  }
  return false;
}

function basename(path: string | null | undefined): string {
  const trimmed = path?.trim();
  if (!trimmed) return "file";
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

function isInActiveTurn(events: ObserveEvent[]): boolean {
  let lastStart = -1;
  let lastComplete = -1;
  for (const event of events) {
    if (event.kind !== "note") continue;
    const text = event.text.trim().toLowerCase();
    if (text === "turn started") lastStart = event.t;
    if (text === "turn complete") lastComplete = event.t;
  }
  return lastStart > lastComplete;
}

export function previewFocusEvent(
  events: ObserveEvent[],
  isLive: boolean,
): ObserveEvent | undefined {
  const substantive = events.filter(isSubstantiveEvent);
  if (substantive.length === 0) return undefined;

  if (isLive && isInActiveTurn(events)) {
    const latestThink = [...substantive].reverse().find((event) => event.kind === "think");
    if (latestThink) return latestThink;
  }

  const latestT = substantive.reduce((max, event) => Math.max(max, event.t), 0);
  if (isLive) {
    const latestRecentTool = [...substantive]
      .reverse()
      .find((event) => event.kind === "tool" && latestT - event.t <= 30);
    if (latestRecentTool) return latestRecentTool;
  }

  const latestHumanReadable = [...substantive]
    .reverse()
    .find((event) => event.kind === "message" || event.kind === "ask" || event.kind === "note");
  return latestHumanReadable ?? substantive[substantive.length - 1];
}

function previewHeadline(event: ObserveEvent): string {
  const text = event.text?.trim();
  switch (event.kind) {
    case "tool":
      return [
        event.tool,
        event.arg ? laneToolArgSnippet(event.arg, 72) : null,
      ].filter(Boolean).join(" · ").trim() || "Running tool";
    case "think":
      return text?.slice(0, 72) || "Thinking";
    case "ask":
      return text?.slice(0, 72) || `Ask → ${event.to ?? "operator"}`;
    case "message":
      return text?.slice(0, 72) || `Message → ${event.to ?? "operator"}`;
    case "note":
      return text?.slice(0, 72) || "Turn update";
    default:
      return text?.slice(0, 72) || event.kind;
  }
}

function previewDetail(event: ObserveEvent): string | null {
  const text = event.text?.trim();
  if (text) return text.slice(0, 220);

  if (event.kind === "tool" && event.diff?.preview) {
    return event.diff.preview.split("\n").slice(0, 4).join("\n");
  }

  if (event.kind === "tool" && event.stream?.length) {
    return event.stream.join("\n").slice(0, 220);
  }

  if (event.kind === "tool" && event.result) {
    return Object.entries(event.result)
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${value}`)
      .join(" · ");
  }

  return event.detail?.trim() ?? null;
}

export function buildAgentLanePreview(
  observe: ObserveData | null | undefined,
  agent: Agent,
  options?: { isLive?: boolean },
): AgentLanePreviewModel | null {
  if (!observe || observe.events.length === 0) return null;

  const latest = previewFocusEvent(observe.events, options?.isLive ?? observe.live === true)
    ?? observe.events[observe.events.length - 1];
  if (!latest) return null;

  const session = observe.metadata?.session;
  const tools = observe.events.filter((event) => event.kind === "tool").length;
  const edits = observe.events.filter(
    (event) => event.kind === "tool" && observeToolIsEdit(event.tool),
  ).length;
  const reads = observe.events.filter(
    (event) => event.kind === "tool" && observeToolIsRead(event.tool),
  ).length;
  const thinks = observe.events.filter((event) => event.kind === "think").length;

  const files = [...observe.files].sort((left, right) => {
    const leftChanged = left.state === "read" ? 0 : 1;
    const rightChanged = right.state === "read" ? 0 : 1;
    if (leftChanged !== rightChanged) return rightChanged - leftChanged;
    return right.lastT - left.lastT;
  }).slice(0, 5);

  return {
    headline: previewHeadline(latest),
    detail: previewDetail(latest),
    model: session?.model ?? agent.model ?? null,
    branch: session?.gitBranch ?? agent.branch ?? null,
    harness: agent.harness ?? session?.adapterType ?? null,
    stats: {
      tools,
      edits,
      reads,
      thinks,
      files: observe.files.length,
    },
    files,
  };
}

export function filePreviewLabel(file: ObserveFile | string | null | undefined): string {
  if (!file) return "file";
  return basename(typeof file === "string" ? file : file.path);
}
