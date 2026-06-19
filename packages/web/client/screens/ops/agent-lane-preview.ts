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

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function previewHeadline(event: ObserveEvent): string {
  const text = event.text?.trim();
  switch (event.kind) {
    case "tool":
      return [event.tool, event.arg].filter(Boolean).join(" ").trim() || "Running tool";
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
): AgentLanePreviewModel | null {
  if (!observe || observe.events.length === 0) return null;

  const events = observe.events.filter(isSubstantiveEvent);
  const latest = events.length > 0 ? events[events.length - 1] : observe.events[observe.events.length - 1];
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

export function filePreviewLabel(file: ObserveFile): string {
  return basename(file.path);
}
