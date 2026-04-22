import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ScoutDispatchRecord,
  ScoutDispatchCandidate,
} from "@openscout/protocol";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { isAgentOnline, normalizeAgentState } from "../lib/agent-state.ts";
import { renderWithMentions } from "../lib/mentions.tsx";
import {
  agentIdFromConversation,
  conversationForAgent,
} from "../lib/router.ts";
import {
  loadLastViewedMap,
  isUnread,
  type LastViewedMap,
} from "../lib/sessionRead.ts";
import { useScout } from "../scout/Provider.tsx";
import { useContextMenu, type MenuItem } from "../components/ContextMenu.tsx";
import type {
  Agent,
  Flight,
  FleetState,
  FleetAsk,
  Message,
  Route,
  SessionEntry,
} from "../lib/types.ts";
import "./conversation-screen.css";
import "./ops-screen.css";

const TERMINAL_FLIGHT_STATES = new Set(["completed", "failed", "cancelled"]);
const KIND_LABELS: Record<string, string> = {
  direct: "Direct message",
  channel: "Channel",
  group_direct: "Group",
  thread: "Thread",
};

type EventMessageRecord = {
  id: string;
  conversationId: string;
  actorId: string;
  body: string;
  createdAt: number;
  class: string;
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
  flight?: EventFlightRecord | null;
};

type ComposeMode = "tell" | "ask";
type ComposeAction = "tell" | "ask" | "steer";

type ConversationPresence = {
  label: string;
  detail: string;
  tone: "idle" | "pending" | "working" | "offline";
  showStrip: boolean;
  showTyping: boolean;
};

function normalizeTimestampMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  return value < 1e12 ? value * 1000 : value;
}

function pathLeaf(path: string | null | undefined): string | null {
  if (!path) return null;
  const normalized = path.replace(/[\\/]+$/, "");
  if (!normalized) return null;
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

function deriveDisplayTitle(session: SessionEntry): string {
  if (session.kind === "direct" && session.agentName) return session.agentName;
  return session.title.replace(/\s*<>\s*/g, " · ");
}

function formatAbsoluteTimestamp(value: number | null | undefined): string {
  const normalized = normalizeTimestampMs(value);
  if (normalized === null) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(normalized);
}

function isSameCalendarDay(
  left: number | null | undefined,
  right: number | null | undefined,
): boolean {
  const leftValue = normalizeTimestampMs(left);
  const rightValue = normalizeTimestampMs(right);
  if (leftValue === null || rightValue === null) return false;

  const leftDate = new Date(leftValue);
  const rightDate = new Date(rightValue);
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function formatThreadDayLabel(value: number | null | undefined): string {
  const normalized = normalizeTimestampMs(value);
  if (normalized === null) return "";

  const date = new Date(normalized);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfTarget = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  if (startOfTarget === startOfToday) return "Today";
  if (startOfTarget === startOfToday - oneDay) return "Yesterday";

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(normalized);
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
  return [...messages].sort(
    (left, right) =>
      (normalizeTimestampMs(left.createdAt) ?? 0) -
      (normalizeTimestampMs(right.createdAt) ?? 0),
  );
}

function selectCurrentFlight(flights: Flight[]): Flight | null {
  return (
    flights
      .filter((flight) => !TERMINAL_FLIGHT_STATES.has(flight.state))
      .sort(
        (left, right) =>
          (normalizeTimestampMs(right.startedAt) ?? 0) -
          (normalizeTimestampMs(left.startedAt) ?? 0),
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
  const actor = message.actorName?.toLowerCase() ?? "";
  return (
    actor === operatorName.toLowerCase() ||
    actor === "operator" ||
    actor === "you"
  );
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

function describePresence(input: {
  agentName: string;
  agentState: string | null;
  sending: boolean;
  currentFlight: Flight | null;
  showWorkingTurn: boolean;
}): ConversationPresence {
  const { agentName, agentState, sending, currentFlight, showWorkingTurn } =
    input;

  if (sending && !currentFlight) {
    return {
      label: "Sending",
      detail: `Handing your message to ${agentName}.`,
      tone: "pending",
      showStrip: true,
      showTyping: false,
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
      label: "Available",
      detail: `${agentName} is connected.`,
      tone: "idle",
      showStrip: false,
      showTyping: false,
    };
  }

  return {
    label: "Offline",
    detail: `${agentName} is offline right now. Sending a message will wake it up.`,
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

function participantListLabel(session: SessionEntry | null): string | null {
  if (!session) return null;
  const participants = session.participantIds.filter(
    (participant) => participant !== "operator",
  );
  if (participants.length === 0) return null;
  return participants.join(", ");
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
      !TERMINAL_FLIGHT_STATES.has(f.state),
  );
  if (hasFlight) {
    const flight = flights.find(
      (f) =>
        f.agentId === agent.id &&
        f.conversationId === conversationId &&
        !TERMINAL_FLIGHT_STATES.has(f.state),
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
            <div className="s-thread-rail-section-label">Needs you</div>
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
        navigate({ view: "conversation", conversationId: session.id })
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
}: {
  sessionMeta: SessionEntry | null;
  agents: Agent[];
  flights: Flight[];
  conversationId: string;
}) {
  const participantAgents = useMemo(() => {
    if (!sessionMeta) return [];
    return sessionMeta.participantIds
      .filter((id) => id !== "operator")
      .map((id) => agents.find((a) => a.id === id) ?? null)
      .filter((a): a is Agent => a !== null);
  }, [sessionMeta, agents]);

  const operatorEntry = {
    id: "operator",
    name: "You",
    handle: "operator",
    activity: null as string | null,
    state: "available" as const,
  };

  const participantEntries = useMemo(() => {
    return participantAgents.map((a) => ({
      id: a.id,
      name: a.name,
      handle: a.handle ?? a.id,
      activity: deriveParticipantActivity(a, flights, conversationId),
      state: normalizeAgentState(a.state),
    }));
  }, [participantAgents, flights, conversationId]);

  const allParticipants = [operatorEntry, ...participantEntries];

  return (
    <aside className="s-thread-sidebar">
      <div className="s-thread-sidebar-section">
        <div className="s-thread-sidebar-label">In this thread</div>
        {allParticipants.map((p) => (
          <div key={p.id} className="s-thread-sidebar-participant">
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
              ) : p.state === "available" || p.id === "operator" ? (
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
          </div>
        ))}
      </div>

      {participantEntries.length > 0 && (
        <div className="s-thread-sidebar-section">
          <div className="s-thread-sidebar-label">Thread mesh</div>
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
      <svg viewBox="0 0 260 160" aria-label="Thread participant mesh">
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
  navigate,
}: {
  conversationId: string;
  initialComposeMode?: ComposeMode;
  navigate: (r: Route) => void;
}) {
  const { agents } = useScout();
  const [sessionMeta, setSessionMeta] = useState<SessionEntry | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentFlight, setCurrentFlight] = useState<Flight | null>(null);
  const [allFlights, setAllFlights] = useState<Flight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const trackedInvocationIdsRef = useRef<Set<string>>(new Set());
  const currentFlightRef = useRef<Flight | null>(null);
  const lastForegroundRefreshAtRef = useRef(0);

  const legacyAgentId = agentIdFromConversation(conversationId);
  const agentId = sessionMeta?.agentId ?? legacyAgentId;
  const isDm = sessionMeta?.kind === "direct" || legacyAgentId !== null;
  const agent = useMemo<Agent | null>(
    () =>
      agentId ? (agents.find((item) => item.id === agentId) ?? null) : null,
    [agents, agentId],
  );

  const [railSessions, setRailSessions] = useState<SessionEntry[]>([]);
  const [needsYouIds, setNeedsYouIds] = useState<Set<string>>(new Set());
  const [lastViewed] = useState<LastViewedMap>(() => loadLastViewedMap());

  useEffect(() => {
    api<SessionEntry[]>("/api/sessions")
      .then((data) =>
        setRailSessions(
          data.sort(
            (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0),
          ),
        ),
      )
      .catch(() => {});

    api<FleetState>("/api/fleet")
      .then((fleet) => {
        const ids = new Set<string>();
        for (const item of fleet.needsAttention) {
          if (item.conversationId) ids.add(item.conversationId);
          if (item.agentId) ids.add(item.agentId);
        }
        for (const ask of fleet.activeAsks) {
          if (
            ask.status === "needs_attention" &&
            ask.conversationId
          ) {
            ids.add(ask.conversationId);
          }
        }
        setNeedsYouIds(ids);
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
        meta?.kind === "direct" &&
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

      const [conversationMessages, activeFlights] = await Promise.all([
        api<Message[]>(
          `/api/messages?conversationId=${encodeURIComponent(canonicalConversationId)}&limit=300`,
        ),
        api<Flight[]>(
          `/api/flights?conversationId=${encodeURIComponent(canonicalConversationId)}`,
        ),
      ]);

      setMessages(sortMessages(conversationMessages));
      setAllFlights(activeFlights);
      trackedInvocationIdsRef.current = new Set(
        activeFlights.map((flight) => flight.invocationId),
      );
      setCurrentFlight(selectCurrentFlight(activeFlights));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [conversationId, initialComposeMode, legacyAgentId, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    currentFlightRef.current = currentFlight;
  }, [currentFlight]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [operatorName, setOperatorName] = useState("operator");
  const [awaitingResponseSince, setAwaitingResponseSince] = useState<
    number | null
  >(null);
  const [composeMode, setComposeMode] = useState<ComposeMode>(
    initialComposeMode === "ask" ? "ask" : "tell",
  );

  useEffect(() => {
    setComposeMode(isDm && initialComposeMode === "ask" ? "ask" : "tell");
  }, [conversationId, initialComposeMode, isDm]);

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

  const showWorkingTurn = useMemo(() => {
    if (!currentFlight || TERMINAL_FLIGHT_STATES.has(currentFlight.state))
      return false;
    const flightStartedAt =
      normalizeTimestampMs(currentFlight.startedAt) ??
      awaitingResponseSince ??
      Date.now();
    return flightStartedAt >= (lastAgentReplyAt ?? 0);
  }, [awaitingResponseSince, currentFlight, lastAgentReplyAt]);
  const hasOutstandingReply =
    sending || awaitingResponseSince !== null || showWorkingTurn;

  const agentName =
    agent?.name ??
    sessionMeta?.agentName ??
    sessionMeta?.title ??
    agentId ??
    "Conversation";
  const presence = useMemo(
    () =>
      describePresence({
        agentName,
        agentState: agent?.state ?? null,
        sending,
        currentFlight,
        showWorkingTurn,
      }),
    [agent?.state, agentName, currentFlight, sending, showWorkingTurn],
  );
  const threadTitle = sessionMeta ? deriveDisplayTitle(sessionMeta) : agentName;
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

          const isAgentMessage = message.actorId === agentId;
          const nextMessage: Message = {
            id: message.id,
            conversationId: message.conversationId,
            actorName: isAgentMessage ? agentName : operatorName,
            body: message.body,
            createdAt: message.createdAt,
            class: isAgentMessage ? message.class : "operator",
          };

          setMessages((previous) => {
            if (previous.some((candidate) => candidate.id === message.id))
              return previous;
            if (!isAgentMessage) {
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
              return null;
            });
            setCurrentFlight((current) => {
              if (!current) return current;
              const flightStartedAt =
                normalizeTimestampMs(current.startedAt) ?? 0;
              return messageAt >= flightStartedAt ? null : current;
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

          if (TERMINAL_FLIGHT_STATES.has(flight.state)) {
            setCurrentFlight((current) =>
              current?.id === flight.id ? null : current,
            );
            void load();
            return;
          }

          trackedInvocationIdsRef.current.add(flight.invocationId);
          setCurrentFlight(
            mapEventFlight(flight, conversationId, agentId ?? ""),
          );
          return;
        }

        if (event.kind === "agent.endpoint.upserted") {
          return;
        }

        if (event.kind === "unknown") {
          void load();
        }
      },
      [agentId, agentName, conversationId, load, operatorName],
    ),
  );

  useEffect(() => {
    if (!hasOutstandingReply) {
      return;
    }

    const timer = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(timer);
  }, [hasOutstandingReply, load]);

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
  useEffect(() => {
    if (visualRowCount > previousVisualRowCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
      actorName: operatorName,
      body: trimmed,
      createdAt: optimisticCreatedAt,
      class: "operator",
    };

    setSending(true);
    setAwaitingResponseSince(optimisticCreatedAt);
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
      if (result.flight) {
        trackedInvocationIdsRef.current.add(result.flight.invocationId);
        setCurrentFlight(
          mapEventFlight(result.flight, conversationId, agentId ?? ""),
        );
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
    : `Message ${agentName}...`;
  const composeModeDetail =
    composeAction === "ask"
      ? "Ask creates owned work in this DM and expects a reply here."
      : composeAction === "steer"
        ? "Follow-up stays in this DM while the current turn is active."
        : isDm
          ? "Tell is for heads-up, replies, and status in this DM."
          : "Channels are for group coordination and shared updates.";
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
          onSelect: () => navigator.clipboard.writeText(sel),
        });
        items.push({ kind: "separator" });
      }
      items.push({
        kind: "action",
        label: "Copy Message",
        onSelect: () => navigator.clipboard.writeText(message.body),
      });
      if (message.actorName && !isOperatorMessage(message, operatorName)) {
        items.push({
          kind: "action",
          label: "Copy Agent ID",
          onSelect: () =>
            navigator.clipboard.writeText(message.actorName ?? ""),
        });
      }
      items.push({ kind: "separator" });
      items.push({
        kind: "action",
        label: "Copy Message ID",
        onSelect: () => navigator.clipboard.writeText(message.id),
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
        const a = agents.find((ag) => ag.id === id);
        return { id, name: a?.name ?? id };
      });
  }, [sessionMeta, agents]);

  return (
    <div className="s-thread-layout">
      <div className="s-thread-center">
        <div
          className="s-thread-center-header"
          onClick={() =>
            isDm ? navigate({ view: "agent-info", conversationId }) : undefined
          }
          style={isDm ? { cursor: "pointer" } : undefined}
          onContextMenu={(e) => {
            const items: MenuItem[] = [
              {
                kind: "action",
                label: "Copy Title",
                onSelect: () => navigator.clipboard.writeText(threadTitle),
              },
            ];
            if (agentId) {
              items.push({
                kind: "action",
                label: "Copy Agent ID",
                onSelect: () => navigator.clipboard.writeText(agentId),
              });
            }
            items.push({
              kind: "action",
              label: "Copy Conversation ID",
              onSelect: () => navigator.clipboard.writeText(conversationId),
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
            {stackedAvatarAgents.length > 0 && (
              <div className="s-thread-center-avatars">
                {stackedAvatarAgents.map((a) => (
                  <div
                    key={a.id}
                    className="s-ops-avatar"
                    style={{
                      "--size": "22px",
                      background: actorColor(a.name),
                    } as React.CSSProperties}
                    title={a.name}
                  >
                    {a.name[0]?.toUpperCase() ?? "?"}
                  </div>
                ))}
                <span className="s-thread-center-participant-count">
                  {participantCount}
                </span>
              </div>
            )}
          </div>
        </div>

        {pinnedAsk && (
          <div className="s-thread-pinned-ask">
            <div className="s-thread-pinned-ask-label">
              Pinned ask &middot; Awaiting operator
            </div>
            <div className="s-thread-pinned-ask-body">
              {pinnedAsk.task}
            </div>
            <div className="s-thread-pinned-ask-routing">
              <span>{pinnedAsk.agentName ?? pinnedAsk.agentId}</span>
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

        {isDm && agent && (agent.harnessSessionId || agent.harnessLogPath) && (
          <details className="s-thread-meta-disclosure">
            <summary className="s-thread-meta-toggle">
              Session details
            </summary>
            <div className="s-thread-meta-block">
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
          {messages.length === 0 ? (
            <div className="s-thread-empty">
              <p>No messages yet</p>
              <p>
                {isDm
                  ? "Use Tell for quick coordination or Ask for owned work with a reply."
                  : "Start the thread below."}
              </p>
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
                !isYou && message.actorName
                  ? agents.find((a) => a.name === message.actorName) ?? null
                  : null;
              const actorHandle = messageAgent?.handle ?? null;

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
                      <div
                        className="s-ops-avatar s-thread-msg-avatar"
                        style={{
                          "--size": "28px",
                          background: actorColor(
                            isYou ? operatorName : (message.actorName ?? "?"),
                          ),
                        } as React.CSSProperties}
                      >
                        {(isYou
                          ? operatorName[0]
                          : message.actorName?.[0] ?? "?"
                        ).toUpperCase()}
                      </div>
                      <div className="s-thread-msg-card-content">
                        <div className="s-thread-msg-header">
                          <div className="s-thread-msg-meta">
                            <span className="s-thread-msg-actor">
                              {isYou ? "You" : message.actorName}
                            </span>
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
                        </div>

                        <div className="s-thread-msg-body" title={absoluteTime}>
                          {renderWithMentions(message.body)}
                        </div>

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
                <div className="s-thread-msg-card s-thread-msg-working-card s-thread-msg-card--avatar-row">
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
                        <span className="s-thread-msg-kind">Live</span>
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
                    </div>
                    <div className="s-thread-msg-working-body">
                      <span
                        className="s-thread-typing-indicator"
                        aria-hidden="true"
                      >
                        <span className="s-thread-typing-dot" />
                        <span className="s-thread-typing-dot" />
                        <span className="s-thread-typing-dot" />
                      </span>
                      <span className="s-thread-msg-working-copy">
                        {presence.detail}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {presence.showTyping && (
          <div className="s-thread-presence-line">
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
              {agentName} is {presence.label.toLowerCase()}...
            </span>
            <div className="s-thread-presence-strip" />
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
            <textarea
              ref={composeRef}
              className="s-thread-compose-input"
              placeholder={composePlaceholder}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
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

            <div className="s-thread-compose-footer">
              <div className="s-thread-compose-actions">
                <button
                  type="button"
                  className="s-thread-compose-action-btn"
                  onClick={() => setDraft((d) => d + "/route ")}
                >
                  /route
                </button>
                <button
                  type="button"
                  className="s-thread-compose-action-btn"
                  onClick={() => {
                    setComposeMode("ask");
                    composeRef.current?.focus();
                  }}
                >
                  ?ask
                </button>
              </div>
              <span className="s-thread-compose-hint">
                {sending ? (
                  "Sending..."
                ) : isStopMode ? (
                  "Stop"
                ) : composeAction === "steer" ? (
                  <>
                    <kbd className="s-thread-kbd">Enter</kbd> steer
                  </>
                ) : composeAction === "ask" ? (
                  <>
                    <kbd className="s-thread-kbd">Enter</kbd> ask
                    <kbd className="s-thread-kbd">Shift+Enter</kbd> newline
                  </>
                ) : (
                  <>
                    <kbd className="s-thread-kbd">
                      {"⌘"}Enter
                    </kbd>{" "}
                    send
                  </>
                )}
              </span>
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
