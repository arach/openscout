import type { Agent, OpsMode, Route } from "./types.ts";

export const DEFAULT_SCOUTBOT_AGENT_ID = "scoutbot";

const SCOUTBOT_AGENT_IDS = new Set([
  DEFAULT_SCOUTBOT_AGENT_ID,
  "scoutbot",
  "@scoutbot",
]);

const OPS_MODES = new Set([
  "plan",
  "conductor",
  "conduct",
  "warroom",
  "command",
  "mission",
  "control",
  "issues",
  "errors",
  "warnings",
  "agents",
  "tail",
  "atop",
]);

const ONLINE_SCOUTBOT_STATES = new Set([
  "available",
  "working",
  "active",
  "idle",
  "waiting",
  "registered",
]);

export type ScoutbotUiAction =
  | { type: "navigate"; route: Route; reason?: string }
  | { type: "open-scoutbot"; mode?: "ask" | "tell"; reason?: string }
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

export function isScoutbotAgent(agent: Agent): boolean {
  const candidates = [
    agent.id,
    agent.name,
    agent.handle ?? "",
    agent.selector ?? "",
    agent.role ?? "",
  ].map((value) => value.trim().toLowerCase());

  return candidates.some((value) =>
    SCOUTBOT_AGENT_IDS.has(value) ||
    value === "scoutbot" ||
    value.startsWith("scoutbot.") ||
    value.includes(".scoutbot.") ||
    value.includes(" scoutbot")
  );
}

function isOnlineScoutbotAgent(agent: Agent): boolean {
  return ONLINE_SCOUTBOT_STATES.has(agent.state?.trim().toLowerCase() ?? "");
}

function scoutbotAgentScore(agent: Agent): number {
  if (!isScoutbotAgent(agent)) {
    return Number.NEGATIVE_INFINITY;
  }
  let score = 0;
  if (isOnlineScoutbotAgent(agent)) {
    score += 100;
  }
  if (agent.handle?.trim().toLowerCase() === "scoutbot") {
    score += 20;
  }
  if (agent.selector?.trim().toLowerCase() === "@scoutbot") {
    score += 20;
  }
  if (agent.role?.trim().toLowerCase() === "scoutbot") {
    score += 10;
  }
  if (agent.id === DEFAULT_SCOUTBOT_AGENT_ID) {
    score += 1;
  }
  return score;
}

export function resolveScoutbotAgent(agents: Agent[]): Agent | null {
  return agents
    .filter(isScoutbotAgent)
    .sort((left, right) => {
      const scoreDelta = scoutbotAgentScore(right) - scoutbotAgentScore(left);
      if (scoreDelta !== 0) return scoreDelta;
      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    })[0] ?? null;
}

export function resolveScoutbotAgentId(agents: Agent[]): string {
  return resolveScoutbotAgent(agents)?.id ?? DEFAULT_SCOUTBOT_AGENT_ID;
}

export function isScoutbotActorId(actorId: string, scoutbotAgentId = DEFAULT_SCOUTBOT_AGENT_ID): boolean {
  const normalized = actorId.trim().toLowerCase();
  const scoutbot = scoutbotAgentId.trim().toLowerCase();
  return normalized === scoutbot ||
    normalized === "scoutbot" ||
    normalized.startsWith("scoutbot.") ||
    normalized.includes(".scoutbot.");
}

const SCOUTBOT_FENCE_TAGS = new Set(["scout-ui", "scout-ui-action", "scoutbot-ui"]);
const FENCE_PATTERN = /```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```/g;

type FenceScan = {
  stripped: string;
  actions: ScoutbotUiAction[];
};

function scanScoutbotFences(body: string): FenceScan {
  const actions: ScoutbotUiAction[] = [];
  let stripped = "";
  let cursor = 0;

  FENCE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_PATTERN.exec(body)) !== null) {
    const [fullMatch, tagRaw, payloadRaw] = match;
    const tag = (tagRaw ?? "").toLowerCase();
    const payload = payloadRaw ?? "";

    let parsedActions: ScoutbotUiAction[] = [];
    let isScoutbotFence = false;

    if (SCOUTBOT_FENCE_TAGS.has(tag)) {
      isScoutbotFence = true;
      parsedActions = parseActionJson(payload);
    } else if (tag === "json" || tag === "") {
      parsedActions = parseActionJson(payload);
      if (parsedActions.length > 0) {
        isScoutbotFence = true;
      }
    }

    if (isScoutbotFence) {
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

export function extractScoutbotUiActions(body: string): ScoutbotUiAction[] {
  return scanScoutbotFences(body).actions;
}

export function stripScoutbotUiFences(body: string): string {
  return scanScoutbotFences(body).stripped;
}

function parseActionJson(raw: string): ScoutbotUiAction[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .map((entry) => normalizeScoutbotUiAction(entry))
      .filter((entry): entry is ScoutbotUiAction => Boolean(entry));
  } catch {
    return [];
  }
}

export function normalizeScoutbotUiAction(raw: unknown): ScoutbotUiAction | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const nested = record.scoutUi ?? record.scout_ui ?? record.scoutbotUi ?? record.scoutbot_ui;
  if (nested) return normalizeScoutbotUiAction(nested);

  const type = typeof record.type === "string"
    ? record.type
    : typeof record.action === "string"
      ? record.action
      : "";
  const reason = typeof record.reason === "string" ? record.reason : undefined;

  if (type === "open-scoutbot" || type === "open_scoutbot") {
    const mode = record.mode === "tell" ? "tell" : record.mode === "ask" ? "ask" : undefined;
    return { type: "open-scoutbot", ...(mode ? { mode } : {}), ...(reason ? { reason } : {}) };
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
      // Deprecated alias of Home — steer scoutbot navigations to the real route.
      return { view: "inbox" };
    case "agents":
    case "agents-v2":
      return {
        view: "agents-v2",
        ...(typeof record.agentId === "string" ? { agentId: record.agentId } : {}),
        ...(typeof record.conversationId === "string" ? { conversationId: record.conversationId } : {}),
        ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
        ...(typeof record.projectSlug === "string" ? { projectSlug: record.projectSlug } : {}),
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
      return "plan";
    case "issues":
    case "errors":
    case "warnings":
      return "issues";
    case "agents":
    case "tail":
    case "atop":
    case "lanes":
      return mode;
    default:
      return undefined;
  }
}
