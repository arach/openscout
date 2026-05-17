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
  | { type: "refresh"; reason?: string }
  | { type: "view-file"; path: string; reason?: string }
  | {
      type: "ask-agent";
      targetLabel: string;
      body: string;
      targetAgentId?: string;
      channel?: string;
      reason?: string;
    }
  | {
      type: "reminder";
      body: string;
      title?: string;
      dueAt?: number;
      delayMs?: number;
      delayMinutes?: number;
      reason?: string;
    };

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
  return `dm.operator.${agentId}`;
}

export function isRangerActorId(actorId: string, rangerAgentId = DEFAULT_RANGER_AGENT_ID): boolean {
  const normalized = actorId.trim().toLowerCase();
  const ranger = rangerAgentId.trim().toLowerCase();
  return normalized === ranger ||
    normalized === "ranger" ||
    normalized.startsWith("ranger.") ||
    normalized.includes(".ranger.");
}

const RANGER_FENCE_TAGS = new Set(["scout-ui", "scout-ui-action", "ranger-ui"]);
const FENCE_PATTERN = /```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```/g;

type FenceScan = {
  stripped: string;
  actions: RangerUiAction[];
};

function scanRangerFences(body: string): FenceScan {
  const actions: RangerUiAction[] = [];
  let stripped = "";
  let cursor = 0;

  FENCE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_PATTERN.exec(body)) !== null) {
    const [fullMatch, tagRaw, payloadRaw] = match;
    const tag = (tagRaw ?? "").toLowerCase();
    const payload = payloadRaw ?? "";

    let parsedActions: RangerUiAction[] = [];
    let isRangerFence = false;

    if (RANGER_FENCE_TAGS.has(tag)) {
      isRangerFence = true;
      parsedActions = parseActionJson(payload);
    } else if (tag === "json" || tag === "") {
      parsedActions = parseActionJson(payload);
      if (parsedActions.length > 0) {
        isRangerFence = true;
      }
    }

    if (isRangerFence) {
      actions.push(...parsedActions);
      stripped += body.slice(cursor, match.index);
      cursor = match.index + fullMatch.length;
    }
  }
  stripped += body.slice(cursor);

  return {
    stripped: stripped.replace(/\n{3,}/g, "\n\n").trim(),
    actions,
  };
}

export function extractRangerUiActions(body: string): RangerUiAction[] {
  return scanRangerFences(body).actions;
}

export function stripRangerUiFences(body: string): string {
  return scanRangerFences(body).stripped;
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

  if (type === "ask-agent" || type === "ask_agent" || type === "scout-ask" || type === "scout_ask") {
    const targetLabel = firstString(record.targetLabel, record.target_label, record.target, record.to, record.agent, record.handle);
    const targetAgentId = firstString(record.targetAgentId, record.target_agent_id, record.agentId, record.agent_id);
    const body = firstString(record.body, record.message, record.prompt, record.task, record.question);
    const channel = firstString(record.channel);
    if (!body?.trim() || (!targetLabel?.trim() && !targetAgentId?.trim())) {
      return null;
    }
    return {
      type: "ask-agent",
      targetLabel: (targetLabel ?? targetAgentId ?? "").trim(),
      body: body.trim(),
      ...(targetAgentId?.trim() ? { targetAgentId: targetAgentId.trim() } : {}),
      ...(channel?.trim() ? { channel: channel.trim() } : {}),
      ...(reason ? { reason } : {}),
    };
  }

  if (type === "view-file" || type === "view_file" || type === "open-file" || type === "open_file") {
    const path = firstString(record.path, record.file, record.target);
    if (!path?.trim()) {
      return null;
    }
    return { type: "view-file", path: path.trim(), ...(reason ? { reason } : {}) };
  }

  if (type === "reminder" || type === "set-reminder" || type === "set_reminder" || type === "remind") {
    const body = firstString(record.body, record.text, record.prompt, record.message);
    if (!body?.trim()) {
      return null;
    }
    const title = firstString(record.title, record.label);
    const dueAt = timestampValue(record.dueAt ?? record.due_at);
    const delayMs = numberValue(record.delayMs ?? record.delay_ms);
    const delayMinutes = numberValue(record.delayMinutes ?? record.delay_minutes);
    return {
      type: "reminder",
      body: body.trim(),
      ...(title?.trim() ? { title: title.trim() } : {}),
      ...(dueAt !== null ? { dueAt } : {}),
      ...(delayMs !== null ? { delayMs } : {}),
      ...(delayMinutes !== null ? { delayMinutes } : {}),
      ...(reason ? { reason } : {}),
    };
  }

  if (type !== "navigate" && type !== "open") {
    return null;
  }

  const route = normalizeRoute(record.route ?? record);
  return route ? { type: "navigate", route, ...(reason ? { reason } : {}) } : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampValue(value: unknown): number | null {
  const numeric = numberValue(value);
  if (numeric !== null) {
    return numeric;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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
    case "control":
    case "mission":
    // Command/Conductor views retired — legacy aliases route to Control.
    case "command":
    case "warroom":
    case "conduct":
    case "conductor":
      return "mission";
    case "plan":
    case "agents":
    case "tail":
    case "atop":
      return mode;
    default:
      return undefined;
  }
}
