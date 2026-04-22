import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ScoutDispatchRecord,
  ScoutDispatchCandidate,
} from "@openscout/protocol";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { isAgentOnline } from "../lib/agent-state.ts";
import { renderWithMentions } from "../lib/mentions.tsx";
import {
  agentIdFromConversation,
  conversationForAgent,
} from "../lib/router.ts";
import { useScout } from "../scout/Provider.tsx";
import { useContextMenu, type MenuItem } from "../components/ContextMenu.tsx";
import type {
  Agent,
  Flight,
  Message,
  Route,
  SessionEntry,
} from "../lib/types.ts";

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

function ConversationMetaRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="s-conv-meta-row">
      <span className="s-conv-meta-label">{label}</span>
      <span className="s-conv-meta-value">{value}</span>
    </div>
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
          // ScoutProvider refetches agents on broker events, so the context-derived
          // `agent` updates automatically. Nothing to do locally.
          return;
        }

        if (event.kind === "unknown") {
          void load();
        }
      },
      [agentId, agentName, conversationId, load, operatorName],
    ),
  );

  // SSE is primary. Only poll while we are actively waiting on a reply, and
  // otherwise resync when the tab comes back into view after sleep/backgrounding.
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
      // Best-effort interrupt — swallow errors silently
    }
  };

  const isAgentBusy =
    presence.tone === "working" || presence.tone === "pending";
  const composeAction: ComposeAction = isDm
    ? hasOutstandingReply
      ? "steer"
      : composeMode
    : "tell";
  const composePlaceholder =
    composeAction === "ask"
      ? `Ask ${agentName} to own this and report back...`
      : composeAction === "steer"
        ? `Steer ${agentName} while the current turn is active...`
        : isDm
          ? `Tell ${agentName} what changed...`
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
          label: `Copy Agent ID`,
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

  return (
    <div className="s-conversation s-inbox-thread-redesign">
      <div
        className="s-conv-header"
        onClick={() =>
          isDm ? navigate({ view: "agent-info", conversationId }) : undefined
        }
        style={isDm ? undefined : { cursor: "default" }}
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
        <button
          type="button"
          className="s-back"
          onClick={(event) => {
            event.stopPropagation();
            navigate(isDm ? { view: "inbox" } : { view: "sessions" });
          }}
        >
          &larr;
        </button>
        <div className="s-thread-header-copy">
          <div className="s-thread-header-main">
            <div
              className="s-avatar s-avatar-sm"
              style={{ background: actorColor(agentName) }}
            >
              {agentName[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="s-conv-header-info">
              <span className="s-conv-header-name">{threadTitle}</span>
              <span
                className="s-conv-header-state"
                title={isDm ? presence.detail : participantLabel}
              >
                <span
                  className="s-dot s-dot-sm"
                  style={{
                    background: presenceColor(presence, agent?.state ?? null),
                  }}
                />
                {isDm ? presence.label : participantLabel}
              </span>
            </div>
          </div>
          <div className="s-thread-header-meta">
            <span className="s-thread-kicker">{kindLabel}</span>
            {threadUpdatedAt && (
              <span
                className="s-thread-header-updated s-tabular"
                title={formatAbsoluteTimestamp(threadUpdatedAt)}
              >
                {timeAgo(threadUpdatedAt)}
              </span>
            )}
          </div>
        </div>

        {threadChips.length > 0 && (
          <div className="s-thread-header-chips" aria-label="Thread details">
            {threadChips.map((chip, index) => (
              <span
                key={`${chip.label}-${index}`}
                className="s-thread-chip"
                title={chip.title}
              >
                {chip.label}
              </span>
            ))}
          </div>
        )}

        {isDm && agentId && <span className="s-chevron" />}
      </div>

      {presence.showStrip && (
        <div
          className={`s-conv-status s-conv-status-${presence.tone}`}
          aria-live="polite"
        >
          <span className="s-conv-status-dot" />
          <div className="s-conv-status-copy">
            <span className="s-conv-status-label">{presence.label}</span>
            <span className="s-conv-status-detail">{presence.detail}</span>
          </div>
        </div>
      )}

      {isDm && agent && (agent.harnessSessionId || agent.harnessLogPath) && (
        <details className="s-conv-meta-disclosure">
          <summary className="s-conv-meta-toggle">Session details</summary>
          <div className="s-conv-meta" aria-label="Agent session metadata">
            {agent.harnessSessionId && (
              <ConversationMetaRow
                label="Harness Session"
                value={agent.harnessSessionId}
              />
            )}
            {agent.harnessLogPath && (
              <ConversationMetaRow
                label="Harness Log"
                value={agent.harnessLogPath}
              />
            )}
          </div>
        </details>
      )}

      {error && <p className="s-error">{error}</p>}

      <div className="s-messages">
        {messages.length === 0 ? (
          <div className="s-empty s-thread-empty">
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
            const showDayDivider =
              index === 0 ||
              !isSameCalendarDay(
                messages[index - 1]?.createdAt,
                message.createdAt,
              );
            const absoluteTime = formatAbsoluteTimestamp(message.createdAt);
            return (
              <div key={message.id} className="s-thread-message-block">
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
                  className={`s-msg s-row-message${isYou ? " s-msg-you" : ""}`}
                  data-class={rowClass}
                  onContextMenu={(e) => onMessageContextMenu(e, message)}
                >
                  <div className="s-msg-card">
                    <div className="s-msg-header">
                      <div className="s-msg-meta">
                        <span className="s-msg-actor">
                          {isYou ? "You" : message.actorName}
                        </span>
                        {badgeLabel && (
                          <span className="s-msg-kind">{badgeLabel}</span>
                        )}
                      </div>
                      <span className="s-msg-time" title={absoluteTime}>
                        {timeAgo(message.createdAt)}
                      </span>
                    </div>

                    <div className="s-msg-body" title={absoluteTime}>
                      {renderWithMentions(message.body)}
                    </div>

                    {dispatch && dispatch.candidates.length > 0 && (
                      <div className="s-scout-dispatch">
                        {dispatch.candidates.map((candidate) => (
                          <button
                            key={candidate.agentId}
                            type="button"
                            className="s-scout-tile"
                            onClick={() =>
                              void dispatchToCandidate(dispatch, candidate)
                            }
                          >
                            <span className="s-scout-tile-id">
                              @{candidate.agentId}
                            </span>
                            <span className="s-scout-tile-state">
                              {candidate.endpointState}
                            </span>
                            <span className="s-scout-tile-meta">
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
                </article>
              </div>
            );
          })
        )}

        {presence.showTyping && (
          <div className="s-thread-message-block">
            <div className="s-msg s-msg-working" aria-live="polite">
              <div className="s-msg-card s-msg-working-card">
                <div className="s-msg-header">
                  <div className="s-msg-meta">
                    <span className="s-msg-actor">{agentName}</span>
                    <span className="s-msg-kind">Live</span>
                  </div>
                  <span
                    className="s-msg-time"
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
                <div className="s-msg-working-body">
                  <span className="s-typing-indicator" aria-hidden="true">
                    <span className="s-typing-dot" />
                    <span className="s-typing-dot" />
                    <span className="s-typing-dot" />
                  </span>
                  <span className="s-msg-working-copy">{presence.detail}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form
        className="s-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="s-thread-compose-shell">
          {isDm && (
            <div className="s-compose-mode-row">
              <div
                className="s-seg s-compose-mode"
                role="tablist"
                aria-label="Direct message mode"
              >
                <button
                  type="button"
                  className="s-seg-btn"
                  aria-pressed={composeMode === "tell"}
                  onClick={() => setComposeMode("tell")}
                >
                  Tell
                </button>
                <button
                  type="button"
                  className="s-seg-btn"
                  aria-pressed={composeMode === "ask"}
                  onClick={() => setComposeMode("ask")}
                >
                  Ask
                </button>
              </div>
              <span className="s-compose-mode-detail">{composeModeDetail}</span>
            </div>
          )}
          <textarea
            ref={composeRef}
            className="s-compose-input"
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
            <span className="s-thread-compose-hint">
              {sending ? (
                `Sending…`
              ) : isStopMode ? (
                "Stop"
              ) : composeAction === "steer" ? (
                <>
                  <kbd className="s-kbd">↵</kbd> steer
                </>
              ) : composeAction === "ask" ? (
                <>
                  <kbd className="s-kbd">↵</kbd> ask
                  <kbd className="s-kbd">⇧↵</kbd> newline
                </>
              ) : (
                <>
                  <kbd className="s-kbd">↵</kbd> {isDm ? "tell" : "send"}
                  <kbd className="s-kbd">⇧↵</kbd> newline
                </>
              )}
            </span>
            {isStopMode ? (
              <button
                type="button"
                className="s-compose-send s-compose-stop"
                onClick={() => void interrupt()}
                aria-label="Stop agent"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="submit"
                className="s-compose-send"
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
  );
}
