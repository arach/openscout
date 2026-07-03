import {
  isSyntheticAgentId,
  sessionRefFromSyntheticAgent,
} from "../../lib/synthetic-agent-routing.ts";
import type { Agent, ObserveData, Route } from "../../lib/types.ts";

function summarize(text: string, max = 120): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

const PLACEHOLDER_TEXT_MARKERS = [
  "no session trace",
  "waiting for events",
  "waiting for a live session",
];

function isPlaceholderText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return PLACEHOLDER_TEXT_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * A bare protocol token like `[turn_ended]` — a raw lifecycle marker that
 * leaked into the trace text (e.g. an unmapped grok event type). We never want
 * to surface the raw bracket in card copy: return calm human words instead
 * ("turn ended"), or null if it isn't a bare token.
 */
function humanizeProtocolToken(text: string): string | null {
  const match = text.trim().match(/^\[\s*([a-z0-9]+(?:[_\-.\s][a-z0-9]+)*)\s*\]$/iu);
  if (!match) return null;
  return match[1]!.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim() || null;
}

function formatObserveAction(event: ObserveData["events"][number]): string | null {
  if (event.kind === "tool" && event.tool) {
    const arg = event.arg?.trim();
    return arg ? `${event.tool} · ${summarize(arg, 88)}` : event.tool;
  }
  if (event.kind === "message" || event.kind === "think" || event.kind === "note" || event.kind === "ask") {
    const text = event.text?.trim();
    return text ? summarize(text, 120) : null;
  }
  if (event.kind === "system" || event.kind === "boot") {
    const text = event.text?.trim();
    return text ? summarize(text, 100) : null;
  }
  return null;
}

export function liveActionSummary(input: {
  observeData?: ObserveData | null;
  checkpoint?: string | null;
  fallbackTask?: string | null;
  observeLive?: boolean;
}): string | null {
  if (input.checkpoint?.trim()) {
    return summarize(input.checkpoint, 140);
  }

  const events = input.observeData?.events ?? [];
  // A bare protocol token (e.g. `[turn_ended]`) is a last-resort line: prefer
  // any real meaningful line behind it, but keep the humanized token so the
  // card never surfaces the raw bracket or falls all the way back to the task.
  let humanizedToken: string | null = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;
    const formatted = formatObserveAction(event);
    if (!formatted) continue;
    if (isPlaceholderText(formatted)) continue;
    const token = humanizeProtocolToken(formatted);
    if (token) {
      if (!humanizedToken) humanizedToken = token;
      continue;
    }
    return formatted;
  }
  if (humanizedToken) return summarize(humanizedToken, 140);

  const fallback = input.fallbackTask?.trim();
  if (input.observeLive && fallback) {
    return isPlaceholderText(fallback) ? null : summarize(fallback, 140);
  }
  if (!fallback || isPlaceholderText(fallback)) return null;
  return summarize(fallback, 140);
}

export type HomeCardAction = "profile" | "observe" | "peek" | "terminal";

export function homeCardRoute(agent: Agent, action: HomeCardAction): Route {
  if (isSyntheticAgentId(agent.id)) {
    const sessionId = sessionRefFromSyntheticAgent(agent);
    if (sessionId) {
      return { view: "sessions", sessionId };
    }
    return { view: "ops", mode: "lanes" };
  }

  switch (action) {
    case "profile":
      return { view: "agents-v2", agentId: agent.id, tab: "profile" };
    case "observe":
      return { view: "agents-v2", agentId: agent.id, tab: "observe" };
    case "peek":
      return { view: "agents-v2", selectedAgentId: agent.id };
    case "terminal":
      return { view: "terminal", agentId: agent.id, mode: "observe" };
  }
}

export function homeCardPeekEnabled(agent: Agent): boolean {
  return Boolean(agent.terminalSurface?.backend === "tmux" || agent.harnessSessionId);
}

export function homeCardTerminalEnabled(agent: Agent): boolean {
  return Boolean(agent.terminalSurface);
}
