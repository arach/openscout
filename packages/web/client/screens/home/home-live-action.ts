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
  const text = event.text?.trim();
  if (text && isNonActionObserveDiagnostic(text)) return null;
  if (event.kind === "tool" && event.tool) {
    const arg = event.arg?.trim();
    return arg ? `${event.tool} · ${summarize(arg, 88)}` : event.tool;
  }
  if (event.kind === "message" || event.kind === "think" || event.kind === "note" || event.kind === "ask") {
    return text ? summarize(text, 120) : null;
  }
  if (event.kind === "system" || event.kind === "boot") {
    return text ? summarize(text, 100) : null;
  }
  return null;
}

function isNonActionObserveDiagnostic(text: string): boolean {
  return [
    /^no session trace is available for this agent yet\.?$/i,
    /^no session trace is available\b/i,
    /^no trace source\b/i,
    /^this session has no observable transcript attached\b/i,
    /^no token-window usage yet\.?$/i,
  ].some((pattern) => pattern.test(text.trim()));
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
