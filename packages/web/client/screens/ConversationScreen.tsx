import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ScoutDispatchRecord,
  ScoutDispatchCandidate,
} from "@openscout/protocol";
import { api } from "../lib/api.ts";
import {
  filterAgentsByMachineScope,
} from "../lib/machine-scope.ts";
import {
  compactAgentId,
  minimalAgentDisplayName,
  minimalAgentHandle,
} from "../lib/agent-labels.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import {
  compareTimestampsAsc,
  compareTimestampsDesc,
  formatAbsoluteTimestamp,
  normalizeTimestampMs,
  timeAgo,
} from "../lib/time.ts";
import { isSameCalendarDay, formatThreadDayLabel } from "../lib/thread-days.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { isAgentOnline, normalizeAgentState } from "../lib/agent-state.ts";
import {
  TERMINAL_CONVERSATION_FLIGHT_STATES,
  conversationShortLabel,
  isActiveConversationFlight,
  isRequesterWaitTimeoutConversationFlight,
  isStaleConversationWorkingTurn,
  isStaleConversationWorkingTurnAnswered,
  shouldClearConversationWorkingStateForAgentMessage,
  shouldShowConversationWorkingTurn,
} from "../lib/conversations.ts";
import { MessageMarkup } from "../lib/message-markup.tsx";
import { queueTakeover } from "../lib/terminal-takeover.ts";
import {
  agentIdFromConversation,
  conversationForAgent,
  routeMachineId,
} from "../lib/router.ts";
import {
  loadLastViewedMap,
  isUnread,
  saveLastViewed,
  type LastViewedMap,
} from "../lib/sessionRead.ts";
import { useScout } from "../scout/Provider.tsx";
import { BackToPicker } from "../scout/slots/BackToPicker.tsx";
import { openContent } from "../scout/slots/openContent.ts";
import { useContextMenu, type MenuItem } from "../components/ContextMenu.tsx";
import { DictationMic } from "../components/DictationMic.tsx";
import { copyTextToClipboard } from "../lib/clipboard.ts";
import { MessageEmbeds } from "../components/MessageEmbeds.tsx";
import { VantageHandoffButton } from "../components/VantageHandoffButton.tsx";
import type {
  Agent,
  Flight,
  FleetActivity,
  FleetState,
  FleetAsk,
  Message,
  Route,
  SessionEntry,
  SessionCatalogWithResume,
} from "../lib/types.ts";
import "./conversation-screen.css";
import "./ops-screen.css";

const KIND_LABELS: Record<string, string> = {
  direct: "Conversation",
  channel: "Conversation",
  group_direct: "Conversation",
  thread: "Thread",
};

type SlashCommand = {
  command: string;
  label: string;
  description: string;
  insert: string;
};

const SLASH_COMMANDS: SlashCommand[] = [
  { command: "/ask", label: "/ask", description: "Ask the agent owned work with a reply", insert: "/ask " },
  { command: "/tell", label: "/tell", description: "Send a heads-up or quick message", insert: "/tell " },
  { command: "/steer", label: "/steer", description: "Steer the active turn mid-flight", insert: "/steer " },
  { command: "/route", label: "/route", description: "Route this to another agent", insert: "/route @" },
  { command: "/inbox", label: "/inbox", description: "Go to the inbox", insert: "/inbox" },
  { command: "/agents", label: "/agents", description: "Open the agents list", insert: "/agents" },
  { command: "/fleet", label: "/fleet", description: "Open the fleet view", insert: "/fleet" },
  { command: "/sessions", label: "/sessions", description: "Browse sessions", insert: "/sessions" },
  { command: "/mesh", label: "/mesh", description: "Open the mesh view", insert: "/mesh" },
  { command: "/activity", label: "/activity", description: "Open activity feed", insert: "/activity" },
  { command: "/settings", label: "/settings", description: "Open settings", insert: "/settings" },
];

type SlashSuggestState = {
  open: boolean;
  query: string;
  triggerStart: number;
  index: number;
};

type MentionSuggestState = {
  open: boolean;
  query: string;
  triggerStart: number;
  index: number;
};

type MentionCandidate = {
  id: string;
  label: string;
  name: string;
  handle: string;
};

function isWordBoundaryBefore(value: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = value[index - 1];
  return !prev || /\s/.test(prev);
}

function matchSlashTrigger(value: string, caret: number): { start: number; query: string } | null {
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

function matchMentionTrigger(value: string, caret: number): { start: number; query: string } | null {
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

type EventMessageRecord = {
  id: string;
  conversationId: string;
  actorId: string;
  body: string;
  createdAt: number;
  class: string;
  attachments?: Message["attachments"];
  metadata?: Record<string, unknown> | null;
};

type EventFlightRecord = {
  id: string;
  invocationId: string;
  targetAgentId: string;
  state: string;
  summary?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
};

type EventInvocationRecord = {
  id: string;
  targetAgentId: string;
  conversationId?: string | null;
};

type SendResult = {
  conversationId?: string;
  messageId?: string;
  flight?: EventFlightRecord | null;
};

type ComposeMode = "tell" | "ask";
type ComposeAction = "tell" | "ask" | "steer";

type ConversationPresence = {
  label: string;
  detail: string;
  tone: "idle" | "pending" | "working" | "stale" | "offline";
  showStrip: boolean;
  showTyping: boolean;
};

type TurnSnapshot = {
  latest: string;
  signalsLabel: string;
  elapsedLabel: string;
  lastSignalLabel: string;
};

function pathLeaf(path: string | null | undefined): string | null {
  if (!path) return null;
  const normalized = path.replace(/[\\/]+$/, "");
  if (!normalized) return null;
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

function deriveDisplayTitle(session: SessionEntry): string {
  if (session.kind === "direct" && session.agentName) return session.agentName;
  if (session.kind === "direct" && session.agentId) {
    return compactAgentId(session.agentId) ?? session.agentId;
  }
  return session.title.replace(/\s*<>\s*/g, " · ");
}

function messageClassLabel(kind: string): string | null {
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

function sortMessages(messages: Message[]): Message[] {
  return [...messages].sort((left, right) =>
    compareTimestampsAsc(left.createdAt, right.createdAt),
  );
}

function selectCurrentFlight(flights: Flight[]): Flight | null {
  return (
    flights
      .filter(isActiveConversationFlight)
      .sort((left, right) =>
        compareTimestampsDesc(left.startedAt, right.startedAt),
      )[0] ?? null
  );
}

function mapEventFlight(
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
  };
}

function fleetAttentionIds(fleet: FleetState): Set<string> {
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

function emptyFleetState(): FleetState {
  return {
    generatedAt: Date.now(),
    totals: { active: 0, staleMotion: 0, recentCompleted: 0, needsAttention: 0, activity: 0 },
    activeAsks: [],
    staleMotionAsks: [],
    recentCompleted: [],
    needsAttention: [],
    activity: [],
  };
}

function selectTurnActivity(
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

function selectTurnAsk(
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

function turnActivityText(item: FleetActivity): string | null {
  const summary = item.summary?.trim();
  if (summary) return summary;
  const title = item.title?.trim();
  if (title) return title;
  return null;
}

function pluralizeSignal(count: number): string {
  return count === 1 ? "1 signal" : `${count} signals`;
}

function buildTurnSnapshot(input: {
  currentFlight: Flight | null;
  presence: ConversationPresence;
  turnActivity: FleetActivity[];
  turnAsk: FleetAsk | null;
  nowMs: number;
}): TurnSnapshot {
  const { currentFlight, presence, turnActivity, turnAsk, nowMs } = input;
  const latestActivity = turnActivity.find((item) => turnActivityText(item));
  const latest =
    (latestActivity ? turnActivityText(latestActivity) : null) ??
    turnAsk?.summary?.trim() ??
    currentFlight?.summary?.trim() ??
    presence.detail;
  const startedAt =
    normalizeTimestampMs(currentFlight?.startedAt) ??
    normalizeTimestampMs(turnAsk?.startedAt);
  const lastSignalAt =
    normalizeTimestampMs(latestActivity?.ts) ??
    normalizeTimestampMs(turnAsk?.updatedAt) ??
    startedAt;
  const signalCount = Math.max(
    turnActivity.length,
    turnAsk?.acknowledgedAt ? 1 : 0,
    currentFlight ? 1 : 0,
  );

  return {
    latest,
    signalsLabel: pluralizeSignal(signalCount),
    elapsedLabel: startedAt ? timeAgo(startedAt, nowMs) : "now",
    lastSignalLabel: lastSignalAt ? timeAgo(lastSignalAt, nowMs) : "now",
  };
}

function readScoutDispatch(message: Message): ScoutDispatchRecord | null {
  const value = message.metadata?.["scoutDispatch"];
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ScoutDispatchRecord>;
  if (!record.id || !record.kind || !Array.isArray(record.candidates))
    return null;
  return record as ScoutDispatchRecord;
}

function isOperatorMessage(message: Message, operatorName: string): boolean {
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

function resolveAgentByIdentity(
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

function resolveMessageAgent(
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

function latestAgentMessageAt(
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

function displayNameForActor(
  actorId: string | null | undefined,
  agents: Agent[],
  operatorName: string,
): string {
  if (!actorId || actorId === "operator") return operatorName;
  const agent = agents.find((candidate) => candidate.id === actorId);
  return agent?.name ?? compactAgentId(actorId) ?? actorId;
}

function describePresence(input: {
  agentName: string;
  agentState: string | null;
  sending: boolean;
  currentFlight: Flight | null;
  showWorkingTurn: boolean;
  workingTurnIsGone: boolean;
  workingTurnIsStale: boolean;
  nowMs: number;
}): ConversationPresence {
  const {
    agentName,
    agentState,
    sending,
    currentFlight,
    showWorkingTurn,
    workingTurnIsGone,
    workingTurnIsStale,
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

  if (currentFlight && showWorkingTurn && workingTurnIsStale) {
    const staleAge = timeAgo(currentFlight.startedAt, nowMs);
    const staleDetail = staleAge
      ? `No update from ${agentName} for ${staleAge}.`
      : `No recent update from ${agentName}.`;
    return {
      label: workingTurnIsGone ? "Gone" : "Stale",
      detail: workingTurnIsGone
        ? `${staleDetail} Agent is not ready.`
        : staleDetail,
      tone: "stale",
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

function presenceColor(
  presence: ConversationPresence,
  agentState: string | null,
): string {
  switch (presence.tone) {
    case "pending":
      return "var(--accent)";
    case "working":
      return "var(--green)";
    case "stale":
      return "var(--amber)";
    case "offline":
      return "var(--dim)";
    default:
      return stateColor(agentState);
  }
}

function SendIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 11 18-8-8 18-2.8-7.2L3 11Z" />
      <path d="M10.2 13.8 21 3" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function DismissIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </svg>
  );
}

function participantListLabel(session: SessionEntry | null): string | null {
  if (!session) return null;
  if (session.kind === "direct") {
    return session.agentName ?? compactAgentId(session.agentId) ?? null;
  }
  const participants = session.participantIds.filter(
    (participant) => participant !== "operator",
  );
  if (participants.length === 0) return null;
  return participants
    .map((participant) => compactAgentId(participant) ?? participant)
    .join(", ");
}

function shortConversationIdentity(id: string): string {
  if (id.startsWith("conv.")) {
    return `conv.${id.slice("conv.".length, "conv.".length + 8)}`;
  }
  if (id.startsWith("channel.")) {
    return `#${id.slice("channel.".length)}`;
  }
  if (id.startsWith("dm.")) {
    return "legacy DM";
  }
  return id.length > 22 ? `${id.slice(0, 10)}...${id.slice(-7)}` : id;
}

function conversationIdentityLabel(id: string): string {
  return id.startsWith("conv.") ? "UID" : "ID";
}

type RailWorkspaceGroup = {
  workspace: string;
  sessions: SessionEntry[];
};

function groupSessionsByWorkspace(
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

function deriveParticipantActivity(
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
  if (state === "working") return "typing";
  return null;
}

function ChannelRail({
  sessions,
  activeConversationId,
  needsYouIds,
  lastViewed,
  navigate,
}: {
  sessions: SessionEntry[];
  activeConversationId: string;
  needsYouIds: Set<string>;
  lastViewed: LastViewedMap;
  navigate: (r: Route) => void;
}) {
  const needsYouSessions = sessions.filter(
    (s) => needsYouIds.has(s.id) || (s.agentId && needsYouIds.has(s.agentId)),
  );
  const groups = useMemo(() => groupSessionsByWorkspace(sessions), [sessions]);

  return (
    <aside className="s-thread-rail">
      <div className="s-thread-rail-scroll">
        {needsYouSessions.length > 0 && (
          <div className="s-thread-rail-section s-thread-rail-section--needs-you">
            <div className="s-thread-rail-section-label">Signals</div>
            {needsYouSessions.map((session) => (
              <RailItem
                key={`needs-${session.id}`}
                session={session}
                active={session.id === activeConversationId}
                unread={isUnread(session.lastMessageAt, session.id, lastViewed)}
                needsYou
                navigate={navigate}
              />
            ))}
          </div>
        )}
        {groups.map((group) => (
          <div key={group.workspace} className="s-thread-rail-section">
            <div className="s-thread-rail-section-label">
              {group.workspace}
            </div>
            {group.sessions.map((session) => (
              <RailItem
                key={session.id}
                session={session}
                active={session.id === activeConversationId}
                unread={isUnread(session.lastMessageAt, session.id, lastViewed)}
                needsYou={false}
                navigate={navigate}
              />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

function RailItem({
  session,
  active,
  unread,
  needsYou,
  navigate,
}: {
  session: SessionEntry;
  active: boolean;
  unread: boolean;
  needsYou: boolean;
  navigate: (r: Route) => void;
}) {
  const { route } = useScout();
  const title = deriveDisplayTitle(session);
  const initial = (session.agentName ?? title)[0]?.toUpperCase() ?? "?";
  const isDm = session.kind === "direct";
  const sub = pathLeaf(session.workspaceRoot) ?? session.kind;

  return (
    <button
      type="button"
      className={[
        "s-thread-rail-item",
        active && "s-thread-rail-item--active",
        needsYou && "s-thread-rail-item--needs-you",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() =>
        openContent(navigate, { view: "conversation", conversationId: session.id }, { returnTo: route })
      }
    >
      {isDm ? (
        <div
          className="s-thread-rail-avatar"
          style={{ background: actorColor(session.agentName ?? title) }}
        >
          {initial}
        </div>
      ) : (
        <div className="s-thread-rail-avatar s-thread-rail-avatar--channel">
          #
        </div>
      )}
      <div className="s-thread-rail-body">
        <span className="s-thread-rail-name">{title}</span>
        <span className="s-thread-rail-sub">{sub}</span>
      </div>
      <div className="s-thread-rail-trailing">
        {unread && !needsYou && (
          <span
            className="s-thread-rail-presence-dot"
            style={{ background: "var(--accent)" }}
          />
        )}
        {needsYou && (
          <span className="s-thread-rail-badge s-thread-rail-badge--amber">
            !
          </span>
        )}
      </div>
    </button>
  );
}

function PresenceSidebar({
  sessionMeta,
  agents,
  flights,
  conversationId,
  navigate,
  route,
}: {
  sessionMeta: SessionEntry | null;
  agents: Agent[];
  flights: Flight[];
  conversationId: string;
  navigate: (r: Route) => void;
  route: Route;
}) {
  const participantAgents = useMemo(() => {
    if (!sessionMeta) return [];
    return sessionMeta.participantIds
      .filter((id) => id !== "operator")
      .map((id) => resolveAgentByIdentity(agents, [id]))
      .filter((a): a is Agent => a !== null);
  }, [sessionMeta, agents]);

  const operatorEntry = {
    id: "operator",
    name: "You",
    handle: "operator",
    activity: null as string | null,
    state: "ready" as const,
    agent: null as Agent | null,
  };

  const participantEntries = useMemo(() => {
    return participantAgents.map((a) => ({
      id: a.id,
      name: a.name,
      handle: minimalAgentHandle(a) ?? compactAgentId(a.id) ?? a.id,
      activity: deriveParticipantActivity(a, flights, conversationId),
      state: normalizeAgentState(a.state),
      agent: a,
    }));
  }, [participantAgents, flights, conversationId]);

  const allParticipants = [operatorEntry, ...participantEntries];

  return (
    <aside className="s-thread-sidebar">
      <div className="s-thread-sidebar-section">
        <div className="s-thread-sidebar-label">In this conversation</div>
        {allParticipants.map((p) => {
          const content = (
            <>
              <div
                className="s-ops-avatar"
                style={{
                  "--size": "28px",
                  background: actorColor(p.name),
                } as React.CSSProperties}
              >
                {p.name[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="s-thread-sidebar-participant-info">
                <span className="s-thread-sidebar-participant-name">
                  {p.name}
                </span>
                <span className="s-thread-sidebar-participant-handle">
                  @{p.handle}
                </span>
              </div>
              <div className="s-thread-sidebar-participant-activity">
                {p.activity ? (
                  <>
                    <span
                      className="s-thread-sidebar-activity-dot s-thread-sidebar-activity-dot--pulse"
                      style={{ background: "var(--green)" }}
                    />
                    <span className="s-thread-sidebar-activity-label">
                      {p.activity}
                    </span>
                  </>
                ) : p.state === "ready" || p.id === "operator" ? (
                  <span
                    className="s-thread-sidebar-activity-dot"
                    style={{ background: stateColor(p.state) }}
                  />
                ) : (
                  <span
                    className="s-thread-sidebar-activity-dot"
                    style={{ background: "var(--dim)" }}
                  />
                )}
              </div>
            </>
          );
          if (!p.agent) {
            return (
              <div key={p.id} className="s-thread-sidebar-participant">
                {content}
              </div>
            );
          }
          return (
            <button
              key={p.id}
              type="button"
              className="s-thread-sidebar-participant s-thread-sidebar-participant--clickable"
              onClick={() =>
                openContent(
                  navigate,
                  { view: "agent-info", conversationId: conversationForAgent(p.agent!.id) },
                  { returnTo: route },
                )
              }
              title={`Open ${p.name} profile`}
            >
              {content}
            </button>
          );
        })}
      </div>

      {participantEntries.length > 0 && (
        <div className="s-thread-sidebar-section">
          <div className="s-thread-sidebar-label">Conversation mesh</div>
          <MiniMeshSvg participants={participantEntries} />
        </div>
      )}
    </aside>
  );
}

function MiniMeshSvg({
  participants,
}: {
  participants: Array<{
    id: string;
    name: string;
    state: string;
  }>;
}) {
  const cx = 130;
  const cy = 80;
  const radius = 55;
  const nodeRadius = 16;

  const nodes = participants.map((p, i) => {
    const angle = (2 * Math.PI * i) / participants.length - Math.PI / 2;
    return {
      ...p,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });

  return (
    <div className="s-thread-mini-mesh">
      <svg viewBox="0 0 260 160" aria-label="Conversation participant mesh">
        {nodes.map((node) => (
          <line
            key={`edge-${node.id}`}
            x1={cx}
            y1={cy}
            x2={node.x}
            y2={node.y}
            className="s-thread-mini-mesh-edge"
          />
        ))}
        <circle
          cx={cx}
          cy={cy}
          r={nodeRadius}
          className="s-thread-mini-mesh-node s-thread-mini-mesh-node--center"
        />
        <text
          x={cx}
          y={cy}
          className="s-thread-mini-mesh-label s-thread-mini-mesh-label--center"
        >
          OP
        </text>
        {nodes.map((node) => (
          <g key={`node-${node.id}`}>
            <circle
              cx={node.x}
              cy={node.y}
              r={nodeRadius}
              className="s-thread-mini-mesh-node"
              style={
                node.state === "working"
                  ? { stroke: "var(--green)" }
                  : undefined
              }
            />
            <text
              x={node.x}
              y={node.y}
              className="s-thread-mini-mesh-label"
            >
              {node.name.slice(0, 3).toUpperCase()}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function ConversationScreen({
  conversationId,
  initialComposeMode,
  initialDraft,
  navigate,
  embedded,
  showBackNav = true,
}: {
  conversationId: string;
  initialComposeMode?: ComposeMode;
  initialDraft?: string;
  navigate: (r: Route) => void;
  embedded?: boolean;
  showBackNav?: boolean;
}) {
  const { agents, route } = useScout();
  const machineId = routeMachineId(route);
  const scopedAgents = useMemo(
    () => filterAgentsByMachineScope(agents, machineId),
    [agents, machineId],
  );
  const [sessionMeta, setSessionMeta] = useState<SessionEntry | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentFlight, setCurrentFlight] = useState<Flight | null>(null);
  const [turnActivity, setTurnActivity] = useState<FleetActivity[]>([]);
  const [turnAsk, setTurnAsk] = useState<FleetAsk | null>(null);
  const [dismissedWorkingTurnIds, setDismissedWorkingTurnIds] = useState<
    Set<string>
  >(new Set());
  const [allFlights, setAllFlights] = useState<Flight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const trackedInvocationIdsRef = useRef<Set<string>>(new Set());
  const currentFlightRef = useRef<Flight | null>(null);
  const lastForegroundRefreshAtRef = useRef(0);
  const appliedInitialDraftKeyRef = useRef<string | null>(null);

  const legacyAgentId = agentIdFromConversation(conversationId);
  const agentId = sessionMeta ? sessionMeta.agentId : legacyAgentId;
  const isDm = sessionMeta ? sessionMeta.kind === "direct" : legacyAgentId !== null;
  const agent = useMemo<Agent | null>(
    () =>
      agentId ? (scopedAgents.find((item) => item.id === agentId) ?? null) : null,
    [scopedAgents, agentId],
  );

  const [needsYouIds, setNeedsYouIds] = useState<Set<string>>(new Set());
  const [lastViewed] = useState<LastViewedMap>(() => loadLastViewedMap());

  useEffect(() => {
    api<FleetState>("/api/fleet")
      .then((fleet) => {
        setNeedsYouIds(fleetAttentionIds(fleet));
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const meta = await api<SessionEntry>(
        `/api/session/${encodeURIComponent(conversationId)}`,
      ).catch(() => null);

      setSessionMeta(meta);
      const resolvedAgentId = meta?.agentId ?? legacyAgentId;

      const canonicalConversationId =
        meta?.id && meta.id !== conversationId
          ? meta.id
        : meta?.kind === "direct" &&
        resolvedAgentId &&
        resolvedAgentId.startsWith("local-session-agent-")
          ? conversationForAgent(resolvedAgentId)
          : conversationId;

      if (canonicalConversationId !== conversationId) {
        navigate({
          view: "conversation",
          conversationId: canonicalConversationId,
          ...(initialComposeMode ? { composeMode: initialComposeMode } : {}),
        });
        return;
      }

      const [conversationMessages, activeFlights, fleet] = await Promise.all([
        api<Message[]>(
          `/api/messages?conversationId=${encodeURIComponent(canonicalConversationId)}&limit=300`,
        ),
        api<Flight[]>(
          `/api/flights?conversationId=${encodeURIComponent(canonicalConversationId)}`,
        ),
        api<FleetState>("/api/fleet?limit=24&activityLimit=160").catch(() =>
          emptyFleetState(),
        ),
      ]);

      const sortedMessages = sortMessages(conversationMessages);
      setMessages(sortedMessages);
      saveLastViewed(canonicalConversationId);
      const lastMessage = sortedMessages.at(-1);
      if (lastMessage) {
        void api(`/api/conversations/${encodeURIComponent(canonicalConversationId)}/read-cursor`, {
          method: "POST",
          body: JSON.stringify({ lastReadMessageId: lastMessage.id }),
        }).catch(() => {});
      }
      setAllFlights(activeFlights);
      trackedInvocationIdsRef.current = new Set(
        activeFlights.map((flight) => flight.invocationId),
      );
      const nextCurrentFlight = selectCurrentFlight(activeFlights);
      const turnAgentId = nextCurrentFlight?.agentId ?? resolvedAgentId ?? null;
      setCurrentFlight(nextCurrentFlight);
      setTurnActivity(
        selectTurnActivity(
          fleet.activity,
          nextCurrentFlight,
          canonicalConversationId,
          turnAgentId,
        ),
      );
      setTurnAsk(
        selectTurnAsk(
          fleet.activeAsks,
          nextCurrentFlight,
          canonicalConversationId,
          turnAgentId,
        ),
      );
      setNeedsYouIds(fleetAttentionIds(fleet));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [conversationId, initialComposeMode, legacyAgentId, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  const [sessionCatalog, setSessionCatalog] = useState<SessionCatalogWithResume | null>(null);
  const [takeoverSent, setTakeoverSent] = useState(false);
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    api<SessionCatalogWithResume>(`/api/agents/${encodeURIComponent(agentId)}/session-catalog`)
      .then((result) => { if (!cancelled) setSessionCatalog(result); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [agentId]);

  useEffect(() => {
    currentFlightRef.current = currentFlight;
  }, [currentFlight]);

  const dismissWorkingTurn = useCallback(() => {
    if (!currentFlight?.id) return;
    setDismissedWorkingTurnIds((previous) => {
      const next = new Set(previous);
      next.add(currentFlight.id);
      return next;
    });
  }, [currentFlight?.id]);

  const [draft, setDraft] = useState(() => initialDraft ?? "");
  const [sending, setSending] = useState(false);
  const [operatorName, setOperatorName] = useState("operator");
  const [slashState, setSlashState] = useState<SlashSuggestState>({
    open: false,
    query: "",
    triggerStart: -1,
    index: 0,
  });
  const [mentionState, setMentionState] = useState<MentionSuggestState>({
    open: false,
    query: "",
    triggerStart: -1,
    index: 0,
  });
  const [awaitingResponseSince, setAwaitingResponseSince] = useState<
    number | null
  >(null);
  const [composeMode, setComposeMode] = useState<ComposeMode>(
    initialComposeMode === "ask" ? "ask" : "tell",
  );
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [addParticipantId, setAddParticipantId] = useState("");
  const [addParticipantError, setAddParticipantError] = useState<string | null>(null);
  const [addingParticipant, setAddingParticipant] = useState(false);

  useEffect(() => {
    setComposeMode(isDm && initialComposeMode === "ask" ? "ask" : "tell");
  }, [conversationId, initialComposeMode, isDm]);

  useEffect(() => {
    setAddParticipantOpen(false);
    setAddParticipantId("");
    setAddParticipantError(null);
    setAddingParticipant(false);
  }, [conversationId]);

  useEffect(() => {
    if (!initialDraft) return;
    const draftKey = `${conversationId}:${initialDraft}`;
    if (appliedInitialDraftKeyRef.current === draftKey) return;
    appliedInitialDraftKeyRef.current = draftKey;
    setDraft(initialDraft);
    requestAnimationFrame(() => composeRef.current?.focus());
  }, [conversationId, initialDraft]);

  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    const seen = new Set<string>();
    const list: MentionCandidate[] = [];
    for (const a of scopedAgents) {
      const handleRaw = a.handle?.trim().replace(/^@+/, "") ?? compactAgentId(a.id) ?? a.id;
      if (!handleRaw) continue;
      const key = handleRaw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        id: a.id,
        label: handleRaw,
        name: a.name ?? handleRaw,
        handle: handleRaw,
      });
    }
    return list.sort((a, b) => a.handle.localeCompare(b.handle));
  }, [scopedAgents]);

  const filteredSlashCommands = useMemo(() => {
    if (!slashState.open) return [];
    const q = slashState.query.toLowerCase();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (c) =>
        c.command.toLowerCase().startsWith("/" + q) ||
        c.command.toLowerCase().includes(q),
    );
  }, [slashState.open, slashState.query]);

  const filteredMentions = useMemo(() => {
    if (!mentionState.open) return [];
    const q = mentionState.query.toLowerCase();
    if (!q) return mentionCandidates.slice(0, 8);
    return mentionCandidates
      .filter(
        (c) =>
          c.handle.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [mentionState.open, mentionState.query, mentionCandidates]);

  const closeSuggestions = useCallback(() => {
    setSlashState((s) => (s.open ? { ...s, open: false } : s));
    setMentionState((s) => (s.open ? { ...s, open: false } : s));
  }, []);

  const updateTriggersFromDraft = useCallback(
    (value: string, caret: number) => {
      const slashMatch = matchSlashTrigger(value, caret);
      if (slashMatch) {
        setSlashState((prev) => ({
          open: true,
          query: slashMatch.query,
          triggerStart: slashMatch.start,
          index:
            prev.open && prev.triggerStart === slashMatch.start ? prev.index : 0,
        }));
      } else {
        setSlashState((prev) => (prev.open ? { ...prev, open: false } : prev));
      }

      const mentionMatch = matchMentionTrigger(value, caret);
      if (mentionMatch) {
        setMentionState((prev) => ({
          open: true,
          query: mentionMatch.query,
          triggerStart: mentionMatch.start,
          index:
            prev.open && prev.triggerStart === mentionMatch.start
              ? prev.index
              : 0,
        }));
      } else {
        setMentionState((prev) => (prev.open ? { ...prev, open: false } : prev));
      }
    },
    [],
  );

  const applySlashCommand = useCallback(
    (command: SlashCommand) => {
      const textarea = composeRef.current;
      const start = slashState.triggerStart;
      if (start < 0) return;
      const caret = textarea?.selectionStart ?? draft.length;
      const before = draft.slice(0, start);
      const after = draft.slice(caret);
      const insert = command.insert;
      const next = `${before}${insert}${after}`;
      setDraft(next);
      setSlashState((s) => ({ ...s, open: false }));
      requestAnimationFrame(() => {
        const el = composeRef.current;
        if (!el) return;
        const pos = before.length + insert.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    },
    [draft, slashState.triggerStart],
  );

  const applyMention = useCallback(
    (candidate: MentionCandidate) => {
      const textarea = composeRef.current;
      const start = mentionState.triggerStart;
      if (start < 0) return;
      const caret = textarea?.selectionStart ?? draft.length;
      const before = draft.slice(0, start);
      const after = draft.slice(caret);
      const needsSpace = after.length === 0 || !after.startsWith(" ");
      const insert = `@${candidate.handle}${needsSpace ? " " : ""}`;
      const next = `${before}${insert}${after}`;
      setDraft(next);
      setMentionState((s) => ({ ...s, open: false }));
      requestAnimationFrame(() => {
        const el = composeRef.current;
        if (!el) return;
        const pos = before.length + insert.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    },
    [draft, mentionState.triggerStart],
  );

  useEffect(() => {
    const element = composeRef.current;
    if (!element) return;
    element.style.height = "0px";
    const nextHeight = Math.min(Math.max(element.scrollHeight, 40), 160);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY =
      element.scrollHeight > nextHeight ? "auto" : "hidden";
  }, [draft]);

  useEffect(() => {
    api<{ name: string }>("/api/user")
      .then((user) => setOperatorName(user.name))
      .catch(() => {});
  }, []);

  const lastAgentReplyAt = useMemo(
    () => latestAgentMessageAt(messages, operatorName),
    [messages, operatorName],
  );

  useEffect(() => {
    if (awaitingResponseSince === null || lastAgentReplyAt === null) return;
    if (lastAgentReplyAt >= awaitingResponseSince) {
      setAwaitingResponseSince(null);
    }
  }, [awaitingResponseSince, lastAgentReplyAt]);

  const rawShowWorkingTurn = useMemo(() => {
    return shouldShowConversationWorkingTurn(currentFlight);
  }, [currentFlight]);
  const currentNowMs = Date.now();
  const currentFlightIsStale = isStaleConversationWorkingTurn(
    currentFlight,
    currentNowMs,
  );
  const staleWorkingTurnHasNewerReply =
    isStaleConversationWorkingTurnAnswered(
      currentFlight,
      lastAgentReplyAt,
      currentNowMs,
    );
  const workingTurnDismissed = currentFlight
    ? dismissedWorkingTurnIds.has(currentFlight.id)
    : false;
  const showWorkingTurn =
    rawShowWorkingTurn &&
    !staleWorkingTurnHasNewerReply &&
    !workingTurnDismissed;
  const workingTurnIsStale = showWorkingTurn && currentFlightIsStale;
  const workingTurnIsGone =
    workingTurnIsStale &&
    normalizeAgentState(agent?.state ?? null) === "not_ready";
  const shouldPollOutstandingTurn =
    isDm && (sending || awaitingResponseSince !== null || showWorkingTurn);
  const hasOutstandingReply =
    isDm &&
    (sending ||
      awaitingResponseSince !== null ||
      (showWorkingTurn && !workingTurnIsStale));

  const agentName = minimalAgentDisplayName({
    name: agent?.name,
    agentName: sessionMeta?.agentName,
    id: agentId,
    title: sessionMeta?.title,
  });
  const presence = useMemo(
    () => {
      if (!isDm) {
        return {
          label: "Open",
          detail: "",
          tone: "idle",
          showStrip: false,
          showTyping: false,
        } satisfies ConversationPresence;
      }
      return describePresence({
        agentName,
        agentState: agent?.state ?? null,
        sending,
        currentFlight,
        showWorkingTurn,
        workingTurnIsGone,
        workingTurnIsStale,
        nowMs: currentNowMs,
      });
    },
    [
      agent?.state,
      agentName,
      currentFlight,
      currentNowMs,
      isDm,
      sending,
      showWorkingTurn,
      workingTurnIsGone,
      workingTurnIsStale,
    ],
  );
  const hasStaleWorkingTurnPresence = presence.tone === "stale";
  const workingTurnBadgeLabel = hasStaleWorkingTurnPresence
    ? presence.label
    : "Live";
  const workingTurnSnapshot = useMemo(
    () =>
      buildTurnSnapshot({
        currentFlight,
        presence,
        turnActivity,
        turnAsk,
        nowMs: currentNowMs,
      }),
    [currentFlight, currentNowMs, presence, turnActivity, turnAsk],
  );
  const workingTurnCardClassName = [
    "s-thread-msg-card",
    "s-thread-msg-working-card",
    "s-thread-msg-card--avatar-row",
    hasStaleWorkingTurnPresence ? "s-thread-msg-working-card--stale" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const workingTurnKindClassName = [
    "s-thread-msg-kind",
    hasStaleWorkingTurnPresence ? "s-thread-msg-kind--stale" : null,
    workingTurnIsGone ? "s-thread-msg-kind--gone" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const staleIndicatorClassName = [
    "s-thread-stale-indicator",
    workingTurnIsGone ? "s-thread-stale-indicator--gone" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const workingTurnSnapshotClassName = [
    "s-thread-turn-snapshot",
    hasStaleWorkingTurnPresence ? "s-thread-turn-snapshot--stale" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const workingTurnPulseClassName = [
    "s-thread-turn-snapshot-pulse",
    hasStaleWorkingTurnPresence ? "s-thread-turn-snapshot-pulse--stale" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const presenceLineClassName = [
    "s-thread-presence-line",
    hasStaleWorkingTurnPresence ? "s-thread-presence-line--stale" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const presenceStripClassName = [
    "s-thread-presence-strip",
    hasStaleWorkingTurnPresence ? "s-thread-presence-strip--stale" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const presenceLineLabel = hasStaleWorkingTurnPresence
    ? presence.detail
    : `${agentName}: ${workingTurnSnapshot.latest}`;
  const threadTitle = sessionMeta ? deriveDisplayTitle(sessionMeta) : agentName;
  const canonicalConversationId = sessionMeta?.id ?? conversationId;
  const conversationAlias = sessionMeta?.alias?.trim() || null;
  const kindLabel = sessionMeta?.kind
    ? (KIND_LABELS[sessionMeta.kind] ?? sessionMeta.kind)
    : "Conversation";
  const participantLabel = participantListLabel(sessionMeta) ?? conversationId;
  const workspaceName = pathLeaf(sessionMeta?.workspaceRoot);
  const threadUpdatedAt =
    sessionMeta?.lastMessageAt ??
    messages[messages.length - 1]?.createdAt ??
    null;
  const threadChips = [
    workspaceName
      ? { label: workspaceName, title: sessionMeta?.workspaceRoot ?? undefined }
      : null,
    sessionMeta?.currentBranch
      ? { label: sessionMeta.currentBranch, title: sessionMeta.currentBranch }
      : null,
    (agent?.harness ?? sessionMeta?.harness)
      ? {
          label: agent?.harness ?? sessionMeta?.harness ?? "",
          title: undefined,
        }
      : null,
  ].filter((value): value is { label: string; title: string | undefined } =>
    Boolean(value),
  );

  const participantCount = sessionMeta
    ? sessionMeta.participantIds.length
    : isDm
      ? 2
      : 1;

  const pinnedAsk = useMemo<FleetAsk | null>(() => {
    if (!needsYouIds.has(conversationId) && !(agentId && needsYouIds.has(agentId)))
      return null;
    return null;
  }, [conversationId, agentId, needsYouIds]);

  useBrokerEvents(
    useCallback(
      (event) => {
        if (event.kind === "message.posted") {
          const message = (
            event.payload as { message?: EventMessageRecord } | undefined
          )?.message;
          if (!message || message.conversationId !== conversationId) return;

          const isOperatorActor = message.actorId === "operator";
          const isAgentMessage = isDm && message.actorId === agentId;
          const nextMessage: Message = {
            id: message.id,
            conversationId: message.conversationId,
            actorId: message.actorId,
            actorName: isAgentMessage
              ? agentName
              : displayNameForActor(message.actorId, scopedAgents, operatorName),
            body: message.body,
            createdAt: message.createdAt,
            class: isOperatorActor ? "operator" : message.class,
            attachments: message.attachments,
            metadata: message.metadata,
          };

          setMessages((previous) => {
            if (previous.some((candidate) => candidate.id === message.id))
              return previous;
            if (isOperatorActor) {
              const optimisticIndex = previous.findIndex(
                (candidate) =>
                  candidate.id.startsWith("optimistic-") &&
                  candidate.body === message.body &&
                  Math.abs(
                    (normalizeTimestampMs(candidate.createdAt) ?? 0) -
                      (normalizeTimestampMs(message.createdAt) ?? 0),
                  ) <= 60_000,
              );
              if (optimisticIndex !== -1) {
                const next = [...previous];
                next[optimisticIndex] = nextMessage;
                return sortMessages(next);
              }
            }
            return sortMessages([...previous, nextMessage]);
          });

          if (isAgentMessage) {
            const messageAt =
              normalizeTimestampMs(message.createdAt) ?? Date.now();
            setAwaitingResponseSince((current) => {
              if (current === null || messageAt < current) return current;
              if (isActiveConversationFlight(currentFlightRef.current))
                return current;
              return null;
            });
            setCurrentFlight((current) => {
              return shouldClearConversationWorkingStateForAgentMessage(current)
                ? null
                : current;
            });
          }
          return;
        }

        if (event.kind === "invocation.requested") {
          const invocation = (
            event.payload as { invocation?: EventInvocationRecord } | undefined
          )?.invocation;
          if (
            !invocation ||
            invocation.targetAgentId !== agentId ||
            invocation.conversationId !== conversationId
          )
            return;
          trackedInvocationIdsRef.current.add(invocation.id);
          setTurnActivity([]);
          setTurnAsk(null);
          setAwaitingResponseSince((current) => current ?? Date.now());
          return;
        }

        if (event.kind === "flight.updated") {
          const flight = (
            event.payload as { flight?: EventFlightRecord } | undefined
          )?.flight;
          if (!flight || flight.targetAgentId !== agentId) return;
          const isTracked =
            trackedInvocationIdsRef.current.has(flight.invocationId) ||
            currentFlightRef.current?.id === flight.id;
          if (!isTracked) return;

          if (TERMINAL_CONVERSATION_FLIGHT_STATES.has(flight.state)) {
            setCurrentFlight((current) =>
              current?.id === flight.id ? null : current,
            );
            setTurnActivity([]);
            setTurnAsk(null);
            setAwaitingResponseSince(null);
            void load();
            return;
          }

          trackedInvocationIdsRef.current.add(flight.invocationId);
          const sameTurn = currentFlightRef.current?.id === flight.id;
          const mappedFlight = mapEventFlight(flight, conversationId, agentId ?? "");
          if (isRequesterWaitTimeoutConversationFlight(mappedFlight)) {
            setAwaitingResponseSince(null);
          }
          setCurrentFlight(mappedFlight);
          if (!sameTurn) {
            setTurnActivity([]);
            setTurnAsk(null);
          }
          return;
        }

        if (event.kind === "agent.endpoint.upserted") {
          return;
        }

        if (event.kind === "unknown") {
          void load();
        }
      },
      [agentId, agentName, conversationId, isDm, load, operatorName, scopedAgents],
    ),
  );

  useEffect(() => {
    if (!shouldPollOutstandingTurn) {
      return;
    }

    const timer = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(timer);
  }, [shouldPollOutstandingTurn, load]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      const now = Date.now();
      if (now - lastForegroundRefreshAtRef.current < 1000) {
        return;
      }
      lastForegroundRefreshAtRef.current = now;
      void load();
    };

    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [load]);

  const visualRowCount = messages.length + (presence.showTyping ? 1 : 0);
  const previousVisualRowCount = useRef(0);
  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    if (visualRowCount > previousVisualRowCount.current) {
      const behavior = initialScrollDoneRef.current ? "smooth" : "instant";
      bottomRef.current?.scrollIntoView({ behavior });
      initialScrollDoneRef.current = true;
    }
    previousVisualRowCount.current = visualRowCount;
  }, [visualRowCount]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 15_000);
    return () => clearInterval(timer);
  }, []);

  const sendText = async (
    text: string,
    options?: { forceMode?: ComposeMode },
  ) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const effectiveMode = options?.forceMode ?? composeMode;
    const action: ComposeAction = isDm
      ? hasOutstandingReply
        ? "steer"
        : effectiveMode
      : "tell";

    const optimisticCreatedAt = Date.now();
    const optimisticMessage: Message = {
      id: `optimistic-${optimisticCreatedAt}`,
      conversationId,
      actorId: "operator",
      actorName: operatorName,
      body: trimmed,
      createdAt: optimisticCreatedAt,
      class: "operator",
    };

    setSending(true);
    if (isDm) {
      setAwaitingResponseSince(optimisticCreatedAt);
    }
    setError(null);
    setMessages((previous) => sortMessages([...previous, optimisticMessage]));

    try {
      const result = await api<SendResult>(
        action === "ask" ? "/api/ask" : "/api/send",
        {
          method: "POST",
          body: JSON.stringify({ body: trimmed, conversationId }),
        },
      );
      const routedConversationId = result.conversationId?.trim();
      if (routedConversationId && routedConversationId !== conversationId) {
        setMessages((previous) =>
          previous.filter((message) => message.id !== optimisticMessage.id),
        );
        setAwaitingResponseSince(null);
        navigate({ view: "conversation", conversationId: routedConversationId });
        return;
      }
      if (result.flight) {
        trackedInvocationIdsRef.current.add(result.flight.invocationId);
        setCurrentFlight(
          mapEventFlight(result.flight, conversationId, agentId ?? ""),
        );
        setTurnActivity([]);
        setTurnAsk(null);
      }
    } catch (cause) {
      setMessages((previous) =>
        previous.filter((message) => message.id !== optimisticMessage.id),
      );
      setAwaitingResponseSince(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await sendText(text);
  };

  const interrupt = async () => {
    if (!agentId) return;
    try {
      await api("/api/agents/" + encodeURIComponent(agentId) + "/interrupt", {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch {
      // Best-effort
    }
  };

  const isAgentBusy =
    presence.tone === "working" || presence.tone === "pending";
  const composeAction: ComposeAction = isDm
    ? hasOutstandingReply
      ? "steer"
      : composeMode
    : "tell";
  const composePlaceholder = isDm
    ? `Reply — or type / to route, @ to mention an agent, ? to ask a question`
    : sessionMeta?.kind === "channel"
      ? `Message #${conversationShortLabel(sessionMeta)}...`
      : `Message ${threadTitle}...`;
  const composeModeDetail =
    composeAction === "ask"
      ? "Ask creates owned work in this private conversation and expects a reply here."
      : composeAction === "steer"
        ? "Follow-up stays in this private conversation while the current turn is active."
        : isDm
          ? "Tell is for heads-up, replies, and status in this private conversation."
          : "Shared conversations are for group coordination and shared updates.";
  const isStopMode = !draft.trim() && isAgentBusy;

  const showContextMenu = useContextMenu();
  const onMessageContextMenu = useCallback(
    (event: React.MouseEvent, message: Message) => {
      const sel = window.getSelection()?.toString().trim();
      const items: MenuItem[] = [];
      if (sel) {
        items.push({
          kind: "action",
          label: "Copy Selection",
          shortcut: "⌘C",
          onSelect: () => {
            void copyTextToClipboard(sel);
          },
        });
        items.push({ kind: "separator" });
      }
      items.push({
        kind: "action",
        label: "Copy Message",
        onSelect: () => {
          void copyTextToClipboard(message.body);
        },
      });
      if (message.actorName && !isOperatorMessage(message, operatorName)) {
        items.push({
          kind: "action",
          label: "Copy Agent ID",
          onSelect: () => {
            void copyTextToClipboard(message.actorName ?? "");
          },
        });
      }
      items.push({ kind: "separator" });
      items.push({
        kind: "action",
        label: "Copy Message ID",
        onSelect: () => {
          void copyTextToClipboard(message.id);
        },
      });
      showContextMenu(event, items);
    },
    [operatorName, showContextMenu],
  );

  const dispatchToCandidate = async (
    record: ScoutDispatchRecord,
    candidate: ScoutDispatchCandidate,
  ) => {
    const prefix = `@${candidate.agentId} `;
    const leftover = draft.trim();
    if (leftover) {
      setDraft("");
      await sendText(`${prefix}${leftover}`, { forceMode: "tell" });
      return;
    }
    setDraft(prefix);
    composeRef.current?.focus();
    void record;
  };

  const stackedAvatarAgents = useMemo(() => {
    if (!sessionMeta) return [];
    return sessionMeta.participantIds
      .filter((id) => id !== "operator")
      .slice(0, 4)
      .map((id) => {
        const a = resolveAgentByIdentity(scopedAgents, [id]);
        return { id, name: a?.name ?? id, agent: a ?? null };
      });
  }, [sessionMeta, scopedAgents]);

  const addableParticipantAgents = useMemo(() => {
    if (!sessionMeta) return [];
    const currentParticipants = new Set(sessionMeta.participantIds);
    return scopedAgents
      .filter((candidate) =>
        !currentParticipants.has(candidate.id) &&
        !candidate.retiredFromFleet
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [sessionMeta, scopedAgents]);

  useEffect(() => {
    if (!addParticipantOpen) return;
    setAddParticipantId((current) => {
      if (current && addableParticipantAgents.some((agent) => agent.id === current)) {
        return current;
      }
      return addableParticipantAgents[0]?.id ?? "";
    });
  }, [addParticipantOpen, addableParticipantAgents]);

  const canAddParticipants = Boolean(
    sessionMeta &&
    ["direct", "group_direct", "channel"].includes(sessionMeta.kind) &&
    addableParticipantAgents.length > 0,
  );

  const submitAddParticipant = useCallback(async () => {
    if (!sessionMeta) return;
    const actorId = addParticipantId.trim();
    if (!actorId) return;

    setAddingParticipant(true);
    setAddParticipantError(null);
    try {
      const result = await api<{
        ok: true;
        kind: string;
        participantIds: string[];
        session?: SessionEntry | null;
      }>(`/api/conversations/${encodeURIComponent(sessionMeta.id)}/members`, {
        method: "POST",
        body: JSON.stringify({ actorId }),
      });

      if (result.session) {
        setSessionMeta(result.session);
      } else {
        setSessionMeta((previous) =>
          previous
            ? {
                ...previous,
                kind: result.kind,
                participantIds: result.participantIds,
              }
            : previous,
        );
      }

      setAddParticipantOpen(false);
      setAddParticipantId("");
      await load();
    } catch (cause) {
      setAddParticipantError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAddingParticipant(false);
    }
  }, [addParticipantId, load, sessionMeta]);

  return (
    <div className={`s-thread-layout${embedded ? " s-thread-layout--embedded" : ""}`}>
      <div className="s-thread-center">
        {!embedded && showBackNav && (
          <BackToPicker
            slot="conversation"
            fallback={{ view: "inbox" }}
            navigate={navigate}
          />
        )}
        {!embedded && <div
          className="s-thread-center-header"
          onClick={() =>
            isDm
              ? openContent(
                  navigate,
                  { view: "agent-info", conversationId: canonicalConversationId },
                  { returnTo: route },
                )
              : undefined
          }
          style={isDm ? { cursor: "pointer" } : undefined}
          onContextMenu={(e) => {
            const items: MenuItem[] = [
              {
                kind: "action",
                label: "Copy Title",
                onSelect: () => {
                  void copyTextToClipboard(threadTitle);
                },
              },
            ];
            if (agentId) {
              items.push({
                kind: "action",
                label: "Copy Agent ID",
                onSelect: () => {
                  void copyTextToClipboard(agentId);
                },
              });
            }
            items.push({
              kind: "action",
              label: "Copy Conversation ID",
              onSelect: () => {
                void copyTextToClipboard(canonicalConversationId);
              },
            });
            showContextMenu(e, items);
          }}
        >
          <div className="s-thread-center-header-info">
            <span className="s-thread-center-header-name">{threadTitle}</span>
            <div className="s-thread-center-header-eyebrow">
              <span className="s-thread-center-header-kicker">
                {kindLabel}
              </span>
              {threadUpdatedAt && (
                <span
                  className="s-thread-center-header-time"
                  title={formatAbsoluteTimestamp(threadUpdatedAt)}
                >
                  {timeAgo(threadUpdatedAt)}
                </span>
              )}
            </div>
          </div>

          <div className="s-thread-center-header-right">
            {threadChips.length > 0 && (
              <div className="s-thread-center-header-chips">
                {threadChips.map((chip, index) => (
                  <span
                    key={`${chip.label}-${index}`}
                    className="s-thread-center-chip"
                    title={chip.title}
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
            )}
            {!embedded && canAddParticipants && (
              <button
                type="button"
                className="s-btn s-btn-sm s-thread-add-participant-trigger"
                onClick={(event) => {
                  event.stopPropagation();
                  setAddParticipantError(null);
                  setAddParticipantOpen((open) => !open);
                }}
              >
                Add participant
              </button>
            )}
            {stackedAvatarAgents.length > 0 && (
              <div className="s-thread-center-avatars">
                {stackedAvatarAgents.map((a) => {
                  const avatarStyle = {
                    "--size": "22px",
                    background: actorColor(a.name),
                  } as React.CSSProperties;
                  return a.agent ? (
                    <button
                      key={a.id}
                      type="button"
                      className="s-ops-avatar s-thread-center-avatar-button"
                      style={avatarStyle}
                      title={`Open ${a.name} profile`}
                      aria-label={`Open ${a.name} profile`}
                      onClick={(event) => {
                        event.stopPropagation();
                        openContent(
                          navigate,
                          { view: "agent-info", conversationId: conversationForAgent(a.agent!.id) },
                          { returnTo: route },
                        );
                      }}
                    >
                      {a.name[0]?.toUpperCase() ?? "?"}
                    </button>
                  ) : (
                    <div
                      key={a.id}
                      className="s-ops-avatar"
                      style={avatarStyle}
                      title={a.name}
                    >
                      {a.name[0]?.toUpperCase() ?? "?"}
                    </div>
                  );
                })}
                <span className="s-thread-center-participant-count">
                  {participantCount}
                </span>
              </div>
            )}
          </div>
        </div>}

        {!embedded && sessionMeta && (
          <div className="s-thread-identity-row">
            <button
              type="button"
              className="s-thread-identity-chip"
              title={canonicalConversationId}
              onClick={() => void copyTextToClipboard(canonicalConversationId)}
            >
              <span>{conversationIdentityLabel(canonicalConversationId)}</span>
              <strong>{shortConversationIdentity(canonicalConversationId)}</strong>
            </button>
            {conversationAlias && (
              <span className="s-thread-identity-chip" title={conversationAlias}>
                <span>Alias</span>
                <strong>{conversationAlias}</strong>
              </span>
            )}
          </div>
        )}

        {!embedded && addParticipantOpen && canAddParticipants && (
          <form
            className="s-thread-add-participant"
            onSubmit={(event) => {
              event.preventDefault();
              void submitAddParticipant();
            }}
          >
            <div className="s-thread-add-participant-row">
              <div className="s-thread-add-participant-field">
                <label
                  className="s-thread-add-participant-label"
                  htmlFor="thread-add-participant-select"
                >
                  Agent
                </label>
                <select
                  id="thread-add-participant-select"
                  className="s-thread-add-participant-select"
                  value={addParticipantId}
                  onChange={(event) => setAddParticipantId(event.target.value)}
                  autoFocus
                >
                  {addableParticipantAgents.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="s-thread-add-participant-actions">
                <button
                  type="button"
                  className="s-btn s-btn-sm"
                  onClick={() => {
                    setAddParticipantOpen(false);
                    setAddParticipantError(null);
                  }}
                  disabled={addingParticipant}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="s-btn s-btn-primary s-btn-sm"
                  disabled={addingParticipant || addParticipantId.trim().length === 0}
                >
                  {addingParticipant ? "Adding..." : "Add"}
                </button>
              </div>
            </div>

            {addParticipantError && (
              <div className="s-thread-add-participant-error">
                {addParticipantError}
              </div>
            )}
          </form>
        )}

        {pinnedAsk && (
          <div className="s-thread-pinned-ask">
            <div className="s-thread-pinned-ask-label">
              Pinned ask &middot; Awaiting operator
            </div>
            <div className="s-thread-pinned-ask-body">
              {pinnedAsk.task}
            </div>
            <div className="s-thread-pinned-ask-routing">
              <span>{pinnedAsk.agentName ?? compactAgentId(pinnedAsk.agentId) ?? pinnedAsk.agentId}</span>
              <span className="s-thread-pinned-ask-routing-arrow">
                &rarr;
              </span>
              <span>You</span>
            </div>
            <div className="s-thread-pinned-ask-actions">
              <button
                type="button"
                className="s-ops-btn s-ops-btn--primary"
                onClick={() => {
                  composeRef.current?.focus();
                }}
              >
                Answer
              </button>
              <button type="button" className="s-ops-btn">
                Defer
              </button>
              <button type="button" className="s-ops-btn">
                Route
              </button>
            </div>
            <div className="s-thread-pinned-ask-strip" />
          </div>
        )}

        {presence.showStrip && (
          <div
            className={`s-thread-status s-thread-status--${presence.tone}`}
            aria-live="polite"
          >
            <span
              className="s-thread-status-dot"
              style={{
                background: presenceColor(presence, agent?.state ?? null),
              }}
            />
            <div className="s-thread-status-copy">
              <span className="s-thread-status-label">{presence.label}</span>
              <span className="s-thread-status-detail">{presence.detail}</span>
            </div>
          </div>
        )}

        {!embedded && isDm && agent && (agent.harnessSessionId || agent.harnessLogPath || sessionCatalog?.activeSessionId) && (
          <details className="s-thread-meta-disclosure">
            <summary className="s-thread-meta-toggle">
              Session details
            </summary>
            <div className="s-thread-meta-block">
              {sessionCatalog?.activeSessionId && (
                <div className="s-thread-meta-row">
                  <span className="s-thread-meta-row-label">Session ID</span>
                  <span className="s-thread-meta-row-value s-thread-meta-row-value--accent" title={sessionCatalog.activeSessionId}>
                    {sessionCatalog.activeSessionId.slice(0, 8)}
                  </span>
                </div>
              )}
              {sessionCatalog?.resumeCommand && (
                <div className="s-thread-meta-row">
                  <span className="s-thread-meta-row-label">Takeover</span>
                  <span className="s-thread-meta-row-value">
                    <button
                      type="button"
                      className="s-thread-meta-takeover-btn"
                      title={sessionCatalog.resumeCommand}
                      onClick={() => {
                        void queueTakeover({
                          command: sessionCatalog.resumeCommand!,
                          cwd: sessionCatalog.resumeCwd,
                          agentId,
                        }).then(() =>
                          openContent(
                            navigate,
                            { view: "terminal", agentId: agentId ?? undefined },
                            { returnTo: route },
                          ),
                        );
                        setTakeoverSent(true);
                      }}
                    >
                      {takeoverSent ? "Going…" : `Takeover — ${sessionCatalog.resumeCommand}`}
                    </button>
                  </span>
                </div>
              )}
              {sessionCatalog?.activeSessionId && (
                <div className="s-thread-meta-row">
                  <span className="s-thread-meta-row-label">Vantage</span>
                  <span className="s-thread-meta-row-value s-thread-meta-actions">
                    <VantageHandoffButton
                      agentId={agentId}
                      className="s-thread-meta-vantage-btn"
                      statusClassName="s-thread-meta-vantage-status"
                      label="Open in Vantage"
                      openingLabel="Opening…"
                    />
                  </span>
                </div>
              )}
              {agent.harnessSessionId && (
                <div className="s-thread-meta-row">
                  <span className="s-thread-meta-row-label">
                    Harness Session
                  </span>
                  <span className="s-thread-meta-row-value">
                    {agent.harnessSessionId}
                  </span>
                </div>
              )}
              {agent.harnessLogPath && (
                <div className="s-thread-meta-row">
                  <span className="s-thread-meta-row-label">Harness Log</span>
                  <span className="s-thread-meta-row-value">
                    {agent.harnessLogPath}
                  </span>
                </div>
              )}
            </div>
          </details>
        )}

        {error && <p className="s-thread-error">{error}</p>}

        <div className="s-thread-feed">
          <div className="s-thread-feed-spacer" />
          {messages.length === 0 ? (
            <div className="s-thread-empty">
              <div className="s-thread-empty-glyph" aria-hidden="true">
                {isDm ? "@" : "#"}
              </div>
              <p>{threadTitle}</p>
              <p>
                {isDm
                  ? "No messages yet. Use Tell for quick updates or Ask to create owned work with a reply."
                  : "No messages yet. Start the conversation below."}
              </p>
              {(workspaceName || sessionMeta?.currentBranch) && (
                <div className="s-thread-empty-chips">
                  {workspaceName && (
                    <span className="s-thread-empty-chip">{workspaceName}</span>
                  )}
                  {sessionMeta?.currentBranch && (
                    <span className="s-thread-empty-chip">{sessionMeta.currentBranch}</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            messages.map((message, index) => {
              const isYou = isOperatorMessage(message, operatorName);
              const dispatch = readScoutDispatch(message);
              const rowClass = dispatch ? "scout.dispatch" : message.class;
              const badgeLabel = messageClassLabel(rowClass);
              const isToolMessage = rowClass === "status";
              const showDayDivider =
                index === 0 ||
                !isSameCalendarDay(
                  messages[index - 1]?.createdAt,
                  message.createdAt,
                );
              const absoluteTime = formatAbsoluteTimestamp(message.createdAt);
              const messageAgent =
                !isYou
                  ? resolveMessageAgent(message, scopedAgents, agentId)
                  : null;
              const actorHandle = isYou
                ? operatorName.toLowerCase()
                : messageAgent?.handle ?? null;

              return (
                <div
                  key={message.id}
                  className={[
                    "s-thread-feed-block",
                    isYou && "s-thread-feed-block--you",
                    showDayDivider && "s-thread-feed-block--full-width",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {showDayDivider && (
                    <div
                      className="s-thread-day-divider"
                      aria-label={formatThreadDayLabel(message.createdAt)}
                    >
                      <span className="s-thread-day-line" aria-hidden="true" />
                      <span className="s-thread-day-label">
                        {formatThreadDayLabel(message.createdAt)}
                      </span>
                      <span className="s-thread-day-line" aria-hidden="true" />
                    </div>
                  )}

                  <article
                    id={`msg-${message.id}`}
                    className={[
                      "s-thread-msg",
                      isYou && "s-thread-msg--you",
                      isToolMessage && "s-thread-msg--tool",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-class={rowClass}
                    onContextMenu={(e) => onMessageContextMenu(e, message)}
                  >
                    <div className="s-thread-msg-card s-thread-msg-card--avatar-row">
                      {(() => {
                        const profileNav = !isYou && messageAgent
                          ? () =>
                              openContent(
                                navigate,
                                {
                                  view: "agent-info",
                                  conversationId: conversationForAgent(messageAgent.id),
                                },
                                { returnTo: route },
                              )
                          : null;
                        const avatarLabel = (isYou
                          ? operatorName[0]
                          : message.actorName?.[0] ?? "?"
                        ).toUpperCase();
                        const avatarStyle = {
                          "--size": "28px",
                          background: actorColor(
                            isYou ? operatorName : (message.actorName ?? "?"),
                          ),
                        } as React.CSSProperties;
                        return profileNav ? (
                          <button
                            type="button"
                            className="s-ops-avatar s-thread-msg-avatar s-thread-msg-avatar--nav"
                            style={avatarStyle}
                            onClick={profileNav}
                            aria-label={`View profile for ${message.actorName ?? "agent"}`}
                            title={`View profile for ${message.actorName ?? "agent"}`}
                          >
                            {avatarLabel}
                          </button>
                        ) : (
                          <div className="s-ops-avatar s-thread-msg-avatar" style={avatarStyle}>
                            {avatarLabel}
                          </div>
                        );
                      })()}
                      <div className="s-thread-msg-card-content">
                        <div className="s-thread-msg-header">
                          <div className="s-thread-msg-meta">
                            {!isYou && messageAgent ? (
                              <button
                                type="button"
                                className="s-thread-msg-actor s-thread-msg-actor--nav"
                                onClick={() =>
                                  openContent(
                                    navigate,
                                    {
                                      view: "agent-info",
                                      conversationId: conversationForAgent(messageAgent.id),
                                    },
                                    { returnTo: route },
                                  )
                                }
                                title={`View profile for ${message.actorName}`}
                              >
                                {message.actorName}
                              </button>
                            ) : (
                              <span className="s-thread-msg-actor">
                                {isYou ? operatorName : message.actorName}
                              </span>
                            )}
                            {actorHandle && (
                              <span className="s-thread-msg-handle">
                                @{actorHandle}
                              </span>
                            )}
                            {badgeLabel && (
                              <span className="s-thread-msg-kind">
                                {badgeLabel}
                              </span>
                            )}
                          </div>
                          <span
                            className="s-thread-msg-time"
                            title={absoluteTime}
                          >
                            {timeAgo(message.createdAt)}
                          </span>
                          <button
                            type="button"
                            className="s-thread-msg-permalink"
                            aria-label="Copy link to message"
                            title="Copy link to message"
                            onClick={() => {
                              const url = `${window.location.origin}${window.location.pathname}#msg-${message.id}`;
                              void navigator.clipboard.writeText(url);
                            }}
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 16 16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M6.5 9.5a2.5 2.5 0 0 0 3.54 0l2.12-2.12a2.5 2.5 0 0 0-3.54-3.54l-.7.7" />
                              <path d="M9.5 6.5a2.5 2.5 0 0 0-3.54 0L3.84 8.62a2.5 2.5 0 0 0 3.54 3.54l.7-.7" />
                            </svg>
                          </button>
                        </div>

                        <div className="s-thread-msg-body" title={absoluteTime}>
                          <MessageMarkup text={message.body} />
                        </div>

                        <MessageEmbeds message={message} />

                        {dispatch && dispatch.candidates.length > 0 && (
                          <div className="s-thread-dispatch">
                            {dispatch.candidates.map((candidate) => (
                              <button
                                key={candidate.agentId}
                                type="button"
                                className="s-thread-dispatch-tile"
                                onClick={() =>
                                  void dispatchToCandidate(dispatch, candidate)
                                }
                              >
                                <span className="s-thread-dispatch-tile-id">
                                  @{candidate.agentId}
                                </span>
                                <span className="s-thread-dispatch-tile-state">
                                  {candidate.endpointState}
                                </span>
                                <span className="s-thread-dispatch-tile-meta">
                                  {[
                                    candidate.workspace,
                                    candidate.node,
                                    candidate.projectRoot,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || candidate.displayName}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                </div>
              );
            })
          )}

          {presence.showTyping && (
            <div className="s-thread-feed-block">
              <div className="s-thread-msg" aria-live="polite">
                <div className={workingTurnCardClassName}>
                  <div
                    className="s-ops-avatar s-thread-msg-avatar"
                    style={{
                      "--size": "28px",
                      background: actorColor(agentName),
                    } as React.CSSProperties}
                  >
                    {agentName[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="s-thread-msg-card-content">
                    <div className="s-thread-msg-header">
                      <div className="s-thread-msg-meta">
                        <span className="s-thread-msg-actor">{agentName}</span>
                        <span className={workingTurnKindClassName}>
                          {workingTurnBadgeLabel}
                        </span>
                      </div>
                      <span
                        className="s-thread-msg-time"
                        title={
                          currentFlight?.startedAt
                            ? formatAbsoluteTimestamp(currentFlight.startedAt)
                            : "now"
                        }
                      >
                        {currentFlight?.startedAt
                          ? timeAgo(currentFlight.startedAt)
                          : "now"}
                      </span>
                      {hasStaleWorkingTurnPresence && (
                        <button
                          type="button"
                          className="s-thread-msg-dismiss"
                          aria-label="Dismiss stale turn"
                          title="Dismiss stale turn"
                          onClick={dismissWorkingTurn}
                        >
                          <DismissIcon />
                        </button>
                      )}
                    </div>
                    <div className="s-thread-msg-working-body">
                      <div className={workingTurnSnapshotClassName}>
                        {hasStaleWorkingTurnPresence ? (
                          <span
                            className={staleIndicatorClassName}
                            aria-hidden="true"
                          />
                        ) : (
                          <span
                            className={workingTurnPulseClassName}
                            aria-hidden="true"
                          />
                        )}
                        <div className="s-thread-turn-snapshot-main">
                          <span className="s-thread-turn-snapshot-label">
                            Latest
                          </span>
                          <span className="s-thread-msg-working-copy">
                            {workingTurnSnapshot.latest}
                          </span>
                        </div>
                      </div>
                      <dl className="s-thread-turn-snapshot-stats">
                        <div className="s-thread-turn-snapshot-stat">
                          <dt>Signals</dt>
                          <dd>{workingTurnSnapshot.signalsLabel}</dd>
                        </div>
                        <div className="s-thread-turn-snapshot-stat">
                          <dt>Elapsed</dt>
                          <dd>{workingTurnSnapshot.elapsedLabel}</dd>
                        </div>
                        <div className="s-thread-turn-snapshot-stat">
                          <dt>Last</dt>
                          <dd>{workingTurnSnapshot.lastSignalLabel}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {presence.showTyping && (
          <div className={presenceLineClassName}>
            <div className="s-thread-presence-line-avatars">
              <div
                className="s-ops-avatar"
                style={{
                  "--size": "20px",
                  background: actorColor(agentName),
                } as React.CSSProperties}
              >
                {agentName[0]?.toUpperCase() ?? "?"}
              </div>
            </div>
            <span className="s-thread-presence-line-label">
              {presenceLineLabel}
            </span>
            <div className={presenceStripClassName} />
          </div>
        )}

        <form
          className="s-thread-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="s-thread-compose-shell">
            {slashState.open && filteredSlashCommands.length > 0 && (
              <div
                className="s-thread-compose-suggest"
                role="listbox"
                aria-label="Slash commands"
              >
                <div className="s-thread-compose-suggest-label">
                  Slash commands
                </div>
                {filteredSlashCommands.map((cmd, i) => (
                  <button
                    key={cmd.command}
                    type="button"
                    role="option"
                    aria-selected={i === slashState.index}
                    className={[
                      "s-thread-compose-suggest-item",
                      i === slashState.index &&
                        "s-thread-compose-suggest-item--active",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applySlashCommand(cmd);
                    }}
                    onMouseEnter={() =>
                      setSlashState((s) => ({ ...s, index: i }))
                    }
                  >
                    <span className="s-thread-compose-suggest-cmd">
                      {cmd.label}
                    </span>
                    <span className="s-thread-compose-suggest-desc">
                      {cmd.description}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {mentionState.open && filteredMentions.length > 0 && (
              <div
                className="s-thread-compose-suggest"
                role="listbox"
                aria-label="Mention agents"
              >
                <div className="s-thread-compose-suggest-label">
                  Mention agent
                </div>
                {filteredMentions.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={i === mentionState.index}
                    className={[
                      "s-thread-compose-suggest-item",
                      i === mentionState.index &&
                        "s-thread-compose-suggest-item--active",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyMention(m);
                    }}
                    onMouseEnter={() =>
                      setMentionState((s) => ({ ...s, index: i }))
                    }
                  >
                    <span
                      className="s-ops-avatar s-thread-compose-suggest-avatar"
                      style={{
                        "--size": "20px",
                        background: actorColor(m.name),
                      } as React.CSSProperties}
                    >
                      {m.name[0]?.toUpperCase() ?? "?"}
                    </span>
                    <span className="s-thread-compose-suggest-cmd">
                      @{m.handle}
                    </span>
                    <span className="s-thread-compose-suggest-desc">
                      {m.name}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="s-thread-compose-row">
              <textarea
                ref={composeRef}
                className="s-thread-compose-input"
                placeholder={composePlaceholder}
                value={draft}
                onChange={(event) => {
                  const next = event.target.value;
                  setDraft(next);
                  updateTriggersFromDraft(next, event.target.selectionStart);
                }}
                onSelect={(event) => {
                  const target = event.currentTarget;
                  updateTriggersFromDraft(target.value, target.selectionStart);
                }}
                onBlur={() => {
                  // Small delay so mousedown on a suggestion lands first
                  setTimeout(closeSuggestions, 120);
                }}
                onKeyDown={(event) => {
                  const suggestOpen =
                    (slashState.open && filteredSlashCommands.length > 0) ||
                    (mentionState.open && filteredMentions.length > 0);
                  if (suggestOpen) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      if (slashState.open) {
                        setSlashState((s) => ({
                          ...s,
                          index: (s.index + 1) % filteredSlashCommands.length,
                        }));
                      } else if (mentionState.open) {
                        setMentionState((s) => ({
                          ...s,
                          index: (s.index + 1) % filteredMentions.length,
                        }));
                      }
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      if (slashState.open) {
                        setSlashState((s) => ({
                          ...s,
                          index:
                            (s.index - 1 + filteredSlashCommands.length) %
                            filteredSlashCommands.length,
                        }));
                      } else if (mentionState.open) {
                        setMentionState((s) => ({
                          ...s,
                          index:
                            (s.index - 1 + filteredMentions.length) %
                            filteredMentions.length,
                        }));
                      }
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeSuggestions();
                      return;
                    }
                    if (event.key === "Enter" || event.key === "Tab") {
                      if (event.shiftKey) return;
                      event.preventDefault();
                      if (slashState.open) {
                        const pick =
                          filteredSlashCommands[slashState.index] ??
                          filteredSlashCommands[0];
                        if (pick) applySlashCommand(pick);
                      } else if (mentionState.open) {
                        const pick =
                          filteredMentions[mentionState.index] ??
                          filteredMentions[0];
                        if (pick) applyMention(pick);
                      }
                      return;
                    }
                  }
                  if (
                    event.key !== "Enter" ||
                    event.shiftKey ||
                    event.nativeEvent.isComposing
                  )
                    return;
                  event.preventDefault();
                  if (!sending && draft.trim()) {
                    void send();
                  }
                }}
                rows={1}
              />

              <DictationMic
                onAppend={(text) =>
                  setDraft((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text))
                }
              />

              {isStopMode ? (
                <button
                  type="button"
                  className="s-thread-compose-send s-thread-compose-send--stop"
                  onClick={() => void interrupt()}
                  aria-label="Stop agent"
                >
                  <StopIcon />
                </button>
              ) : (
                <button
                  type="submit"
                  className="s-thread-compose-send"
                  disabled={sending || !draft.trim()}
                  aria-label={
                    composeAction === "ask"
                      ? "Ask agent"
                      : composeAction === "steer"
                        ? "Steer agent"
                        : isDm
                          ? "Tell agent"
                          : "Send message"
                  }
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

    </div>
  );
}
