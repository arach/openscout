import { conversationForAgent } from "./router.ts";
import type { Agent, OpsMode, Route } from "./types.ts";

export const DEFAULT_RANGER_AGENT_ID = "ranger.main.mini";

const RANGER_AGENT_IDS = new Set([
  DEFAULT_RANGER_AGENT_ID,
  "ranger",
  "@ranger",
]);

const OPS_MODES = new Set([
  "plan",
  "conductor",
  "conduct",
  "warroom",
  "command",
  "mission",
  "control",
  "agents",
  "tail",
  "atop",
]);

const ONLINE_RANGER_STATES = new Set([
  "available",
  "working",
  "active",
  "idle",
  "waiting",
  "registered",
]);

export type RangerUiAction =
  | { type: "navigate"; route: Route; reason?: string }
  | { type: "open-ranger"; mode?: "ask" | "tell"; reason?: string }
  | { type: "refresh"; reason?: string };

export function isRangerAgent(agent: Agent): boolean {
  const candidates = [
    agent.id,
    agent.name,
    agent.handle ?? "",
    agent.selector ?? "",
    agent.role ?? "",
  ].map((value) => value.trim().toLowerCase());

  return candidates.some((value) =>
    RANGER_AGENT_IDS.has(value) ||
    value === "ranger" ||
    value.startsWith("ranger.") ||
    value.includes(".ranger.") ||
    value.includes(" ranger")
  );
}

function isOnlineRangerAgent(agent: Agent): boolean {
  return ONLINE_RANGER_STATES.has(agent.state?.trim().toLowerCase() ?? "");
}

function rangerAgentScore(agent: Agent): number {
  if (!isRangerAgent(agent)) {
    return Number.NEGATIVE_INFINITY;
  }
  let score = 0;
  if (isOnlineRangerAgent(agent)) {
    score += 100;
  }
  if (agent.handle?.trim().toLowerCase() === "ranger") {
    score += 20;
  }
  if (agent.selector?.trim().toLowerCase() === "@ranger") {
    score += 20;
  }
  if (agent.role?.trim().toLowerCase() === "ranger") {
    score += 10;
  }
  if (agent.id === DEFAULT_RANGER_AGENT_ID) {
    score += 1;
  }
  return score;
}

export function resolveRangerAgent(agents: Agent[]): Agent | null {
  return agents
    .filter(isRangerAgent)
    .sort((left, right) => {
      const scoreDelta = rangerAgentScore(right) - rangerAgentScore(left);
      if (scoreDelta !== 0) return scoreDelta;
      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    })[0] ?? null;
}

export function resolveRangerAgentId(agents: Agent[]): string {
  return resolveRangerAgent(agents)?.id ?? DEFAULT_RANGER_AGENT_ID;
}

export function rangerConversationId(agentId: string): string {
  return conversationForAgent(agentId);
}

export function isRangerActorId(actorId: string, rangerAgentId = DEFAULT_RANGER_AGENT_ID): boolean {
  const normalized = actorId.trim().toLowerCase();
  const ranger = rangerAgentId.trim().toLowerCase();
  return normalized === ranger ||
    normalized === "ranger" ||
    normalized.startsWith("ranger.") ||
    normalized.includes(".ranger.");
}

export function extractRangerUiActions(body: string): RangerUiAction[] {
  const actions: RangerUiAction[] = [];
  const fencePattern = /```(?:scout-ui|scout-ui-action|ranger-ui)\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(body)) !== null) {
    const parsed = parseActionJson(match[1] ?? "");
    actions.push(...parsed);
  }

  return actions;
}

function parseActionJson(raw: string): RangerUiAction[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .map((entry) => normalizeRangerUiAction(entry))
      .filter((entry): entry is RangerUiAction => Boolean(entry));
  } catch {
    return [];
  }
}

export function normalizeRangerUiAction(raw: unknown): RangerUiAction | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const nested = record.scoutUi ?? record.scout_ui ?? record.rangerUi ?? record.ranger_ui;
  if (nested) return normalizeRangerUiAction(nested);

  const type = typeof record.type === "string"
    ? record.type
    : typeof record.action === "string"
      ? record.action
      : "";
  const reason = typeof record.reason === "string" ? record.reason : undefined;

  if (type === "open-ranger" || type === "open_ranger") {
    const mode = record.mode === "tell" ? "tell" : record.mode === "ask" ? "ask" : undefined;
    return { type: "open-ranger", ...(mode ? { mode } : {}), ...(reason ? { reason } : {}) };
  }

  if (type === "refresh") {
    return { type: "refresh", ...(reason ? { reason } : {}) };
  }

  if (type !== "navigate" && type !== "open") {
    return null;
  }

  const route = normalizeRoute(record.route ?? record);
  return route ? { type: "navigate", route, ...(reason ? { reason } : {}) } : null;
}

function normalizeRoute(raw: unknown): Route | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const view = typeof record.view === "string" ? record.view : "";

  switch (view) {
    case "inbox":
      return { view: "inbox" };
    case "fleet":
      return { view: "fleet" };
    case "agents":
      return {
        view: "agents",
        ...(typeof record.agentId === "string" ? { agentId: record.agentId } : {}),
        ...(typeof record.conversationId === "string" ? { conversationId: record.conversationId } : {}),
        ...(record.tab === "profile" || record.tab === "observe" || record.tab === "message" ? { tab: record.tab } : {}),
      };
    case "sessions":
      return {
        view: "sessions",
        ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
      };
    case "mesh":
      return { view: "mesh" };
    case "broker":
      return { view: "broker" };
    case "activity":
      return { view: "activity" };
    case "settings":
      return { view: "settings" };
    case "terminal":
      return {
        view: "terminal",
        ...(typeof record.agentId === "string" ? { agentId: record.agentId } : {}),
      };
    case "work":
      return typeof record.workId === "string" ? { view: "work", workId: record.workId } : null;
    case "conversation":
      return typeof record.conversationId === "string"
        ? {
            view: "conversation",
            conversationId: record.conversationId,
            ...(record.composeMode === "ask" || record.composeMode === "tell" ? { composeMode: record.composeMode } : {}),
          }
        : null;
    case "ops": {
      const mode = typeof record.mode === "string" && OPS_MODES.has(record.mode)
        ? normalizeOpsMode(record.mode)
        : undefined;
      return { view: "ops", ...(mode ? { mode } : {}) };
    }
    default:
      return null;
  }
}

function normalizeOpsMode(mode: string): OpsMode | undefined {
  switch (mode) {
    case "command":
      return "command";
    case "warroom":
      return "command";
    case "control":
    case "mission":
      return "mission";
    case "conduct":
    case "conductor":
      return "conductor";
    case "plan":
    case "agents":
    case "tail":
    case "atop":
      return mode;
    default:
      return undefined;
  }
}
