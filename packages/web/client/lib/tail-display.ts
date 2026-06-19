import type { TailAttribution, TailEvent } from "./types.ts";

/** Consumer-side tail presentation policy — the firehose stays complete upstream. */
export type TailDisplayMode = "work" | "all";

/** Grok lifecycle phases that flood the tail during streaming without adding signal. */
const GROK_STREAMING_PHASES = new Set([
  "streaming_reasoning",
  "streaming_text",
  "tool_execution",
  "permission_prompt",
]);

export function isTailNoiseEvent(event: TailEvent): boolean {
  if (event.source !== "grok") return false;

  const summary = event.summary.trim().toLowerCase();
  if (summary === "first token" || summary.startsWith("loop ")) {
    return true;
  }

  if (!summary.startsWith("phase ·")) return false;
  const phase = summary.slice("phase ·".length).trim();
  return GROK_STREAMING_PHASES.has(phase);
}

export function tailDisplayModeLabel(mode: TailDisplayMode): string {
  return mode === "work" ? "work" : "all";
}

export function filterTailEventsForDisplay(
  events: TailEvent[],
  mode: TailDisplayMode,
): TailEvent[] {
  if (mode === "all") return events;
  return events.filter((event) => !isTailNoiseEvent(event));
}

export const TAIL_ATTRIBUTION_LABEL: Record<TailAttribution, string> = {
  "scout-managed": "scout",
  "hudson-managed": "hudson",
  unattributed: "native",
};

export function tailAttributionLabel(harness: TailAttribution): string {
  return TAIL_ATTRIBUTION_LABEL[harness] ?? harness;
}

type TailObserveContext = {
  project?: string | null;
  cwd?: string | null;
};

/** Context line for observe/lane traces built from tail events. */
export function tailObserveEventDetail(
  event: Pick<TailEvent, "kind" | "source" | "harness" | "project" | "cwd">,
  context?: TailObserveContext | null,
): string | undefined {
  if (event.kind === "tool" || event.kind === "tool-result") {
    return undefined;
  }

  const workspace = context?.project?.trim()
    || context?.cwd?.trim()
    || event.project?.trim()
    || event.cwd?.trim();
  const origin = tailAttributionLabel(event.harness);
  return workspace ? `${workspace} · ${origin}` : `${event.source} · ${origin}`;
}

export type TailObserveToolFields = {
  tool?: string;
  arg?: string;
  result?: Record<string, string>;
};

const GROK_TOOL_STARTED = /^([A-Za-z][\w-]*) started$/;
const GROK_TOOL_COMPLETED = /^([A-Za-z][\w-]*) completed(?: · (.+))?$/;
const GROK_TOOL_WITH_ARG = /^([A-Za-z][\w-]*) · (.+?)(?: · (success|error|failed))?$/;
const CODEX_TOOL_CALL = /^([A-Za-z_][\w.-]*)\((.*)\)$/s;

export function observeToolName(tool: string | undefined): string {
  return (tool ?? "").trim().toLowerCase();
}

export function observeToolIsRead(tool: string | undefined): boolean {
  return observeToolName(tool) === "read";
}

export function observeToolIsEdit(tool: string | undefined): boolean {
  const name = observeToolName(tool);
  return name === "edit" || name === "write";
}

/** Map a tail tool line into observe tool/arg/result fields for lane and mission traces. */
export function observeToolFieldsFromTailEvent(event: TailEvent): TailObserveToolFields {
  if (event.kind !== "tool" && event.kind !== "tool-result") return {};

  const summary = event.summary.trim();
  if (!summary) return {};

  if (event.source === "grok") {
    const enriched = summary.match(GROK_TOOL_WITH_ARG);
    if (enriched?.[1] && enriched[2]) {
      const fields: TailObserveToolFields = { tool: enriched[1], arg: enriched[2] };
      if (enriched[3]) fields.result = { outcome: enriched[3] };
      return fields;
    }
    const started = summary.match(GROK_TOOL_STARTED);
    if (started?.[1]) {
      return { tool: started[1], arg: "started" };
    }
    const completed = summary.match(GROK_TOOL_COMPLETED);
    if (completed?.[1]) {
      const fields: TailObserveToolFields = { tool: completed[1], arg: "completed" };
      if (completed[2]) fields.result = { outcome: completed[2] };
      return fields;
    }
  }

  const fnCall = summary.match(CODEX_TOOL_CALL);
  if (fnCall?.[1]) {
    return { tool: fnCall[1], arg: fnCall[2]?.trim() || undefined };
  }

  const dotSep = summary.match(/^([A-Za-z_][\w.-]*) · (.+)$/);
  if (dotSep?.[1]) {
    return { tool: dotSep[1], arg: dotSep[2] };
  }

  const first = summary.split(/\s+/)[0];
  if (first && first.toLowerCase() !== event.source.toLowerCase()) {
    return { tool: first };
  }

  return {};
}

export type TailDisplayRow<TMeta = undefined> = {
  event: TailEvent;
  repeatCount: number;
  meta: TMeta;
};

export function collapseTailDisplayRows<TMeta>(
  rows: Array<{ event: TailEvent; meta: TMeta }>,
): TailDisplayRow<TMeta>[] {
  const out: TailDisplayRow<TMeta>[] = [];

  for (const row of rows) {
    const prev = out[out.length - 1];
    if (
      prev
      && prev.event.sessionId === row.event.sessionId
      && prev.event.source === row.event.source
      && prev.event.kind === row.event.kind
      && prev.event.summary === row.event.summary
    ) {
      prev.repeatCount += 1;
      prev.event = row.event;
      prev.meta = row.meta;
      continue;
    }
    out.push({ event: row.event, repeatCount: 1, meta: row.meta });
  }

  return out;
}