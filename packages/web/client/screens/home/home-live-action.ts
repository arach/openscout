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
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;
    const formatted = formatObserveAction(event);
    if (formatted) return formatted;
  }

  if (input.observeLive && input.fallbackTask?.trim()) {
    return summarize(input.fallbackTask, 140);
  }
  return input.fallbackTask?.trim() ? summarize(input.fallbackTask, 140) : null;
}

export type HomeCardAction = "profile" | "observe" | "peek";

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
  }
}

export function homeCardPeekEnabled(agent: Agent): boolean {
  return Boolean(agent.terminalSurface?.backend === "tmux" || agent.harnessSessionId);
}