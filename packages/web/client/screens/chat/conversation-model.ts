import type {
  ScoutDispatchRecord,
} from "@openscout/protocol";
import {
  compactAgentId,
  minimalAgentHandle,
} from "../../lib/agent-labels.ts";
import {
  isAgentCallable,
  isAgentOnline,
  normalizeAgentState,
} from "../../lib/agent-state.ts";
import { stateColor } from "../../lib/colors.ts";
import {
  isActiveConversationFlight,
  isConversationWorkingTurnWithoutRecentUpdateAnswered,
  isQueuedUntilOnlineConversationFlight,
} from "../../lib/conversations.ts";
import {
  compareTimestampsAsc,
  compareTimestampsDesc,
  normalizeTimestampMs,
  timeAgo,
} from "../../lib/time.ts";
import type {
  Agent,
  Flight,
  FleetActivity,
  FleetAsk,
  FleetState,
  Message,
  SessionEntry,
} from "../../lib/types.ts";

export type SlashCommand = {
  command: string;
  label: string;
  description: string;
  insert: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: "/route", label: "/route", description: "Route this to another agent", insert: "/route @" },
  { command: "/inbox", label: "/inbox", description: "Go to the inbox", insert: "/inbox" },
  { command: "/agents", label: "/agents", description: "Open the agents list", insert: "/agents" },
  { command: "/fleet", label: "/fleet", description: "Open the fleet view", insert: "/fleet" },
  { command: "/sessions", label: "/sessions", description: "Browse sessions", insert: "/sessions" },
  { command: "/mesh", label: "/mesh", description: "Open the mesh view", insert: "/mesh" },
  { command: "/activity", label: "/activity", description: "Open activity feed", insert: "/activity" },
  { command: "/settings", label: "/settings", description: "Open settings", insert: "/settings" },
];

export type SlashSuggestState = {
  open: boolean;
  query: string;
  triggerStart: number;
  index: number;
};

export type MentionSuggestState = {
  open: boolean;
  query: string;
  triggerStart: number;
  index: number;
};

export type MentionCandidate = {
  id: string;
  label: string;
  name: string;
  handle: string;
};

export type EventMessageRecord = {
  id: string;
  conversationId: string;
  actorId: string;
  body: string;
  createdAt: number;
  class: string;
  attachments?: Message["attachments"];
  metadata?: Record<string, unknown> | null;
  replyToMessageId?: string | null;
  /** Compact broker field name for the reply-to message id. */
  n?: string | null;
};

export type EventFlightRecord = {
  id: string;
  invocationId: string;
  targetAgentId: string;
  state: string;
  summary?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type EventInvocationRecord = {
  id: string;
  targetAgentId: string;
  conversationId?: string | null;
};

export type SendResult = {
  chatId?: string;
  conversationId?: string;
  messageId?: string;
  runIds?: string[];
  flight?: EventFlightRecord | null;
};

export type ComposeAction = "message" | "invoke" | "steer";

export function resolveComposeAction(input: {
  isDm: boolean;
  hasOutstandingReply: boolean;
}): ComposeAction {
  if (!input.isDm) return "message";
  return input.hasOutstandingReply ? "steer" : "invoke";
}

export type ConversationPresence = {
  label: string;
  detail: string;
  tone: "idle" | "pending" | "working" | "quiet" | "offline";
  showStrip: boolean;
  showTyping: boolean;
};

export type TurnSnapshot = {
  latest: string;
  activityLabel: string;
  elapsedLabel: string;
  lastActivityLabel: string;
};

export type MotionTone = "idle" | "pending" | "working" | "quiet" | "offline";

export type RailWorkspaceGroup = {
  workspace: string;
  sessions: SessionEntry[];
};

function isWordBoundaryBefore(value: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = value[index - 1];
  return !prev || /\s/.test(prev);
}

export function matchSlashTrigger(value: string, caret: number): { start: number; query: string } | null {
  if (caret === 0) return null;
  let start = caret - 1;
  while (start >= 0) {
    const ch = value[start];
    if (ch === "/") break;
    if (!ch || /\s/.test(ch)) return null;
    start -= 1;
  }
  if (start < 0 || value[start] !== "/") return null;
  if (!isWordBoundaryBefore(value, start)) return null;
  const query = value.slice(start + 1, caret);
  if (/[^a-zA-Z0-9_-]/.test(query)) return null;
  return { start, query };
}

export function matchMentionTrigger(value: string, caret: number): { start: number; query: string } | null {
  if (caret === 0) return null;
  let start = caret - 1;
  while (start >= 0) {
    const ch = value[start];
    if (ch === "@") break;
    if (!ch || /\s/.test(ch)) return null;
    start -= 1;
  }
  if (start < 0 || value[start] !== "@") return null;
  if (!isWordBoundaryBefore(value, start)) return null;
  const query = value.slice(start + 1, caret);
  if (/[^a-zA-Z0-9._/:-]/.test(query)) return null;
  return { start, query };
}

export function pathLeaf(path: string | null | undefined): string | null {
  if (!path) return null;
  const normalized = path.replace(/[\\/]+$/, "");
  if (!normalized) return null;
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

export function deriveDisplayTitle(session: SessionEntry): string {
  if (session.kind === "direct" && session.agentName) return session.agentName;
  if (session.kind === "direct" && session.agentId) {
    return compactAgentId(session.agentId) ?? session.agentId;
  }
  return session.title.replace(/\s*<>\s*/g, " · ");
}

export function messageClassLabel(kind: string): string | null {
  switch (kind) {
    case "status":
      return "Status";
    case "system":
      return "System";
    case "scout.dispatch":
      return "Dispatch";
    default:
      return null;
  }
}

export function sortMessages(messages: Message[]): Message[] {
  return [...messages].sort((left, right) =>
    compareTimestampsAsc(left.createdAt, right.createdAt),
  );
}

export function selectCurrentFlight(flights: Flight[]): Flight | null {
  return (
    flights
      .filter(isActiveConversationFlight)
      .sort((left, right) =>
        compareTimestampsDesc(left.startedAt, right.startedAt),
      )[0] ?? null
  );
}

export function keepPreviousIfJsonEqual<T>(previous: T, next: T): T {
  try {
    return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
  } catch {
    return next;
  }
}

export function keepPreviousSetIfEqual<T>(previous: Set<T>, next: Set<T>): Set<T> {
  if (previous.size !== next.size) return next;
  for (const item of next) {
    if (!previous.has(item)) return next;
  }
  return previous;
}

function readFlightDispatchOutcome(
  metadata: Record<string, unknown> | null | undefined,
): Flight["dispatchOutcome"] {
  const value = metadata?.["dispatchOutcome"];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status.trim() : "";
  if (!status) return null;
  const reason = typeof record.reason === "string" ? record.reason : null;
  const checkedAt =
    typeof record.checkedAt === "number"
      ? record.checkedAt
      : typeof record.checkedAt === "string" && Number.isFinite(Number(record.checkedAt))
        ? Number(record.checkedAt)
        : null;
  return { status, reason, checkedAt };
}

export function mapEventFlight(
  flight: EventFlightRecord,
  conversationId: string,
  fallbackAgentId: string,
): Flight {
  return {
    id: flight.id,
    invocationId: flight.invocationId,
    agentId: flight.targetAgentId || fallbackAgentId,
    agentName: null,
    conversationId,
    collaborationRecordId: null,
    state: flight.state,
    summary: flight.summary ?? null,
    startedAt: flight.startedAt ?? null,
    completedAt: flight.completedAt ?? null,
    dispatchOutcome: readFlightDispatchOutcome(flight.metadata),
  };
}

export function fleetAttentionIds(fleet: FleetState): Set<string> {
  const ids = new Set<string>();
  for (const item of fleet.needsAttention) {
    if (item.conversationId) ids.add(item.conversationId);
    if (item.agentId) ids.add(item.agentId);
  }
  for (const ask of fleet.activeAsks) {
    if (ask.status === "needs_attention" && ask.conversationId) {
      ids.add(ask.conversationId);
    }
  }
  return ids;
}

export function emptyFleetState(): FleetState {
  return {
    generatedAt: Date.now(),
    totals: { active: 0, recentCompleted: 0, needsAttention: 0, activity: 0 },
    activeAsks: [],
    recentCompleted: [],
    needsAttention: [],
    activity: [],
  };
}

export function selectTurnActivity(
  activity: FleetActivity[],
  flight: Flight | null,
  conversationId: string,
  agentId: string | null,
): FleetActivity[] {
  if (!flight) return [];
  const startedAt = normalizeTimestampMs(flight.startedAt) ?? 0;
  const seen = new Set<string>();
  return activity
    .filter((item) => {
      if (item.flightId === flight.id) return true;
      if (item.invocationId === flight.invocationId) return true;
      if (!agentId || item.agentId !== agentId) return false;
      if (item.conversationId !== conversationId) return false;
      const ts = normalizeTimestampMs(item.ts) ?? 0;
      return ts >= startedAt;
    })
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((left, right) => compareTimestampsDesc(left.ts, right.ts));
}

export function selectTurnAsk(
  asks: FleetAsk[],
  flight: Flight | null,
  conversationId: string,
  agentId: string | null,
): FleetAsk | null {
  if (!flight) return null;
  return (
    asks.find(
      (ask) =>
        ask.flightId === flight.id ||
        ask.invocationId === flight.invocationId,
    ) ??
    asks.find(
      (ask) =>
        ask.conversationId === conversationId &&
        (!agentId || ask.agentId === agentId) &&
        (ask.status === "queued" || ask.status === "working"),
    ) ??
    null
  );
}

// The `[ask:<flightId>]` correlation tag agents echo (and the broker matches
// on) leaks into the stored message body. We strip it from the rendered prose
// and, when the turn replies to a known message, lift it into a backlink.
const ASK_REPLY_TAG_FIRST = /\[ask:([^\]]+)\]/i;
const ASK_REPLY_TAG_ALL = /\[ask:[^\]]+\]\s*/gi;

export function parseAskReplyTag(
  body: string,
): { flightId: string; body: string } | null {
  const match = body.match(ASK_REPLY_TAG_FIRST);
  if (!match) return null;
  return {
    flightId: match[1]?.trim() ?? "",
    body: body.replace(ASK_REPLY_TAG_ALL, "").trim(),
  };
}

export type AskReplyContext = {
  flightId: string;
  originatingMessageId: string;
  title: string;
  from: string;
  status: "working" | "done";
};

function askReplyTitle(body: string): string {
  const firstLine =
    body
      .replace(ASK_REPLY_TAG_ALL, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  const max = 72;
  return firstLine.length > max
    ? `${firstLine.slice(0, max - 1).trimEnd()}…`
    : firstLine;
}

// Resolve an ask-reply turn back to its originating message via the structured
// replyToMessageId. The `[ask:<flightId>]` id itself is an ephemeral runtime
// correlation token (not in the flights/asks payloads), so it is the trigger,
// not the lookup key.
export function resolveAskReplyContext(input: {
  flightId: string;
  replyToMessageId: string | null | undefined;
  messagesById: Map<string, Message>;
  agents: Agent[];
  operatorName: string;
}): AskReplyContext | null {
  const { flightId, replyToMessageId, messagesById, agents, operatorName } =
    input;
  if (!replyToMessageId) return null;
  const origin = messagesById.get(replyToMessageId);
  if (!origin) return null;
  const title = askReplyTitle(origin.body);
  if (!title) return null;
  const from = isOperatorMessage(origin, operatorName)
    ? operatorName
    : displayNameForActor(origin.actorId, agents, operatorName);
  return {
    flightId,
    originatingMessageId: replyToMessageId,
    title,
    from,
    // The reply is the answer, so a resolved reply-context is settled work.
    status: "done",
  };
}

// The originating ask in this conversation that is now waiting on the operator
// (operator-initiated ask the agent bounced back). Feeds the pinned-ask band.
export function selectOperatorPendingAsk(
  asks: FleetAsk[],
  conversationId: string,
  agentId: string | null,
): FleetAsk | null {
  return (
    asks.find(
      (ask) =>
        ask.status === "needs_attention" &&
        ask.conversationId === conversationId,
    ) ??
    asks.find(
      (ask) =>
        ask.status === "needs_attention" &&
        !ask.conversationId &&
        !!agentId &&
        ask.agentId === agentId,
    ) ?? null
  );
}

export function turnActivityText(item: FleetActivity): string | null {
  const summary = item.summary?.trim();
  if (summary) return summary;
  const title = item.title?.trim();
  if (title) return title;
  return null;
}

function pluralizeActivityUpdate(count: number): string {
  return count === 1 ? "1 update" : `${count} updates`;
}

export function buildTurnSnapshot(input: {
  currentFlight: Flight | null;
  presence: ConversationPresence;
  turnActivity: FleetActivity[];
  turnAsk: FleetAsk | null;
  awaitingResponseSince?: number | null;
  nowMs: number;
}): TurnSnapshot {
  const { currentFlight, presence, turnActivity, turnAsk, awaitingResponseSince, nowMs } = input;
  const latestActivity = turnActivity.find((item) => turnActivityText(item));
  const queuedForPickup = isQueuedUntilOnlineConversationFlight(currentFlight);
  const latest =
    (latestActivity ? turnActivityText(latestActivity) : null) ??
    (queuedForPickup ? null : turnAsk?.summary?.trim()) ??
    turnAsk?.task?.trim() ??
    (queuedForPickup ? null : currentFlight?.summary?.trim()) ??
    presence.detail;
  const startedAt =
    normalizeTimestampMs(currentFlight?.startedAt) ??
    normalizeTimestampMs(turnAsk?.startedAt) ??
    normalizeTimestampMs(awaitingResponseSince);
  const lastActivityAt =
    normalizeTimestampMs(latestActivity?.ts) ??
    normalizeTimestampMs(turnAsk?.updatedAt) ??
    startedAt;
  const activityCount = Math.max(
    turnActivity.length,
    turnAsk?.acknowledgedAt ? 1 : 0,
    currentFlight ? 1 : 0,
    awaitingResponseSince ? 1 : 0,
  );

  return {
    latest,
    activityLabel: pluralizeActivityUpdate(activityCount),
    elapsedLabel: startedAt ? timeAgo(startedAt, nowMs) : "now",
    lastActivityLabel: lastActivityAt ? timeAgo(lastActivityAt, nowMs) : "now",
  };
}

export function readScoutDispatch(message: Message): ScoutDispatchRecord | null {
  const value = message.metadata?.["scoutDispatch"];
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ScoutDispatchRecord>;
  if (!record.id || !record.kind || !Array.isArray(record.candidates))
    return null;
  return record as ScoutDispatchRecord;
}

export function isOperatorMessage(message: Message, operatorName: string): boolean {
  if (message.class === "operator") return true;
  if (message.actorId === "operator") return true;
  const actor = message.actorName?.toLowerCase() ?? "";
  return (
    actor === operatorName.toLowerCase() ||
    actor === "operator" ||
    actor === "you"
  );
}

function readMessageReturnAddressActorId(message: Message): string | null {
  const returnAddress = message.metadata?.["returnAddress"];
  if (!returnAddress || typeof returnAddress !== "object") return null;
  const actorId = (returnAddress as { actorId?: unknown }).actorId;
  return typeof actorId === "string" && actorId.trim().length > 0
    ? actorId.trim()
    : null;
}

function readMessageReturnAddressField(message: Message, key: string): string | null {
  const returnAddress = message.metadata?.["returnAddress"];
  if (!returnAddress || typeof returnAddress !== "object") return null;
  const value = (returnAddress as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeAgentLookupValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^@+/, "").toLowerCase();
}

function agentLookupValues(agent: Agent): Set<string> {
  return new Set(
    [
      agent.id,
      agent.handle,
      agent.selector,
      agent.defaultSelector,
      agent.conversationId,
    ]
      .map(normalizeAgentLookupValue)
      .filter((value): value is string => value !== null),
  );
}

export function resolveAgentByIdentity(
  agents: Agent[],
  identities: Array<string | null | undefined>,
): Agent | null {
  for (const identity of identities) {
    const normalized = normalizeAgentLookupValue(identity);
    if (!normalized) continue;
    const matches = agents.filter((agent) => agentLookupValues(agent).has(normalized));
    if (matches.length === 1) return matches[0]!;
  }
  return null;
}

export function resolveMessageAgent(
  message: Message,
  agents: Agent[],
  fallbackAgentId: string | null | undefined,
): Agent | null {
  const actorId = message.actorId ?? readMessageReturnAddressActorId(message);
  const identityMatch = resolveAgentByIdentity(agents, [
    actorId,
    readMessageReturnAddressField(message, "selector"),
    readMessageReturnAddressField(message, "defaultSelector"),
    readMessageReturnAddressField(message, "handle"),
  ]);
  if (identityMatch) return identityMatch;

  if (fallbackAgentId) {
    const fallback = resolveAgentByIdentity(agents, [fallbackAgentId]);
    if (fallback) return fallback;
  }

  if (!message.actorName) return null;
  const named = agents.filter((agent) => agent.name === message.actorName);
  return named.length === 1 ? named[0]! : null;
}

export function latestAgentMessageAt(
  messages: Message[],
  operatorName: string,
): number | null {
  return messages.reduce<number | null>((latest, message) => {
    if (isOperatorMessage(message, operatorName)) return latest;
    const createdAt = normalizeTimestampMs(message.createdAt);
    if (createdAt === null) return latest;
    return latest === null || createdAt > latest ? createdAt : latest;
  }, null);
}

function defaultFlightDetail(agentName: string, state: string): string {
  switch (state) {
    case "queued":
      return `${agentName} has your message and is waiting to start.`;
    case "waking":
      return `${agentName} is waking up now.`;
    case "waiting":
      return `${agentName} is thinking through the request.`;
    case "running":
      return `${agentName} is working on your request.`;
    default:
      return `${agentName} is working on it.`;
  }
}

export function displayNameForActor(
  actorId: string | null | undefined,
  agents: Agent[],
  operatorName: string,
): string {
  if (!actorId || actorId === "operator") return operatorName;
  const agent = agents.find((candidate) => candidate.id === actorId);
  return agent?.name ?? compactAgentId(actorId) ?? actorId;
}

export function describePresence(input: {
  agentName: string;
  agentState: string | null;
  sending: boolean;
  currentFlight: Flight | null;
  showWorkingTurn: boolean;
  awaitingResponse: boolean;
  workingTurnIsGone: boolean;
  workingTurnHasNoRecentUpdate: boolean;
  nowMs: number;
}): ConversationPresence {
  const {
    agentName,
    agentState,
    sending,
    currentFlight,
    showWorkingTurn,
    awaitingResponse,
    workingTurnIsGone,
    workingTurnHasNoRecentUpdate,
    nowMs,
  } = input;

  if (sending && !currentFlight) {
    return {
      label: "Sending",
      detail: `Handing your message to ${agentName}.`,
      tone: "pending",
      showStrip: true,
      showTyping: false,
    };
  }

  if (!currentFlight && awaitingResponse) {
    return {
      label: "Starting",
      detail: `${agentName} is opening the session and routing your request.`,
      tone: "pending",
      showStrip: true,
      showTyping: true,
    };
  }

  if (currentFlight && showWorkingTurn && isQueuedUntilOnlineConversationFlight(currentFlight)) {
    return {
      label: "Not delivered",
      detail: `${agentName} could not receive this request.`,
      tone: "offline",
      showStrip: true,
      showTyping: true,
    };
  }

  if (currentFlight && showWorkingTurn && workingTurnHasNoRecentUpdate) {
    const quietAge = timeAgo(currentFlight.startedAt, nowMs);
    const quietDetail = quietAge
      ? `No update from ${agentName} for ${quietAge}.`
      : `No recent update from ${agentName}.`;
    return {
      label: workingTurnIsGone ? "Gone" : "No recent update",
      detail: workingTurnIsGone
        ? `${quietDetail} Agent is offline.`
        : quietDetail,
      tone: "quiet",
      showStrip: true,
      showTyping: true,
    };
  }

  if (currentFlight && showWorkingTurn) {
    const detail =
      currentFlight.summary?.trim() ||
      defaultFlightDetail(agentName, currentFlight.state);
    switch (currentFlight.state) {
      case "queued":
        return {
          label: "Queued",
          detail,
          tone: "pending",
          showStrip: true,
          showTyping: true,
        };
      case "waking":
        return {
          label: "Coming online",
          detail,
          tone: "working",
          showStrip: true,
          showTyping: true,
        };
      case "waiting":
        return {
          label: "Thinking",
          detail,
          tone: "working",
          showStrip: true,
          showTyping: true,
        };
      default:
        return {
          label: "Working",
          detail,
          tone: "working",
          showStrip: true,
          showTyping: true,
        };
    }
  }

  if (isAgentOnline(agentState)) {
    return {
      label: "Ready",
      detail: `${agentName} is ready.`,
      tone: "idle",
      showStrip: false,
      showTyping: false,
    };
  }

  return {
    label: "Not ready",
    detail: `${agentName} is not ready right now. Sending a message will try to wake it up.`,
    tone: "offline",
    showStrip: true,
    showTyping: false,
  };
}

export function presenceColor(
  presence: ConversationPresence,
  agentState: string | null,
): string {
  switch (presence.tone) {
    case "pending":
      return "var(--accent)";
    case "working":
      return "var(--green)";
    case "quiet":
      return "var(--amber)";
    case "offline":
      return "var(--dim)";
    default:
      return stateColor(agentState);
  }
}

export function shortConversationIdentity(id: string): string {
  if (id.startsWith("c.")) {
    return `c.${id.slice("c.".length, "c.".length + 8)}`;
  }
  return id.length > 22 ? `${id.slice(0, 10)}...${id.slice(-7)}` : id;
}

export function conversationIdentityLabel(_id: string): string {
  return "Chat ID";
}

export function groupSessionsByWorkspace(
  sessions: SessionEntry[],
): RailWorkspaceGroup[] {
  const groups = new Map<string, SessionEntry[]>();
  for (const session of sessions) {
    const key = pathLeaf(session.workspaceRoot) ?? "General";
    const list = groups.get(key) ?? [];
    list.push(session);
    groups.set(key, list);
  }
  return Array.from(groups.entries()).map(([workspace, sessionList]) => ({
    workspace,
    sessions: sessionList.sort(
      (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0),
    ),
  }));
}

export function deriveParticipantActivity(
  agent: Agent | null,
  flights: Flight[],
  conversationId: string,
): string | null {
  if (!agent) return null;
  const state = normalizeAgentState(agent.state);
  const hasFlight = flights.some(
    (f) =>
      f.agentId === agent.id &&
      f.conversationId === conversationId &&
      isActiveConversationFlight(f),
  );
  if (hasFlight) {
    const flight = flights.find(
      (f) =>
        f.agentId === agent.id &&
        f.conversationId === conversationId &&
        isActiveConversationFlight(f),
    );
    if (flight?.state === "running") return "running tool";
    if (flight?.state === "waiting") return "thinking";
    return "working";
  }
  if (state === "in_turn" || state === "in_flight") return "typing";
  return null;
}

export function activityKindLabel(kind: string): string {
  switch (kind) {
    case "tool-result":
      return "Result";
    case "tool":
      return "Tool";
    case "assistant":
      return "Agent";
    case "user":
      return "User";
    case "message":
      return "Message";
    default:
      return kind.replace(/[-_]/g, " ");
  }
}

export {
  isAgentCallable,
  isConversationWorkingTurnWithoutRecentUpdateAnswered,
};
