import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScoutDispatchRecord, ScoutDispatchCandidate } from "@openscout/protocol";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { renderWithMentions } from "../lib/mentions.tsx";
import { agentIdFromConversation } from "../lib/router.ts";
import type { Agent, Flight, Message, Route, SessionEntry } from "../lib/types.ts";

const TERMINAL_FLIGHT_STATES = new Set(["completed", "failed", "cancelled"]);

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

type EventEndpointRecord = {
  agentId: string;
  harness?: string | null;
  state: string;
};

type SendResult = {
  flight?: EventFlightRecord | null;
};

type ConversationPresence = {
  label: string;
  detail: string;
  tone: "idle" | "pending" | "working" | "offline";
  showStrip: boolean;
  showTyping: boolean;
};

function normalizeTimestampMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e12 ? value * 1000 : value;
}

function sortMessages(messages: Message[]): Message[] {
  return [...messages].sort(
    (left, right) => (normalizeTimestampMs(left.createdAt) ?? 0) - (normalizeTimestampMs(right.createdAt) ?? 0),
  );
}

function selectCurrentFlight(flights: Flight[]): Flight | null {
  return flights
    .filter((flight) => !TERMINAL_FLIGHT_STATES.has(flight.state))
    .sort((left, right) => (normalizeTimestampMs(right.startedAt) ?? 0) - (normalizeTimestampMs(left.startedAt) ?? 0))[0] ?? null;
}

function mapEventFlight(flight: EventFlightRecord, conversationId: string, fallbackAgentId: string): Flight {
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
  if (!record.id || !record.kind || !Array.isArray(record.candidates)) return null;
  return record as ScoutDispatchRecord;
}

function isOperatorMessage(message: Message, operatorName: string): boolean {
  return message.class === "operator"
    || message.actorName === operatorName
    || message.actorName === "operator";
}

function latestAgentMessageAt(messages: Message[], operatorName: string): number | null {
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
  const { agentName, agentState, sending, currentFlight, showWorkingTurn } = input;

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
    const detail = currentFlight.summary?.trim() || defaultFlightDetail(agentName, currentFlight.state);
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

  if (agentState === "active") {
    return {
      label: "Online",
      detail: `${agentName} is connected and ready.`,
      tone: "idle",
      showStrip: false,
      showTyping: false,
    };
  }

  if (agentState === "waiting" || agentState === "idle") {
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

function presenceColor(presence: ConversationPresence, agentState: string | null): string {
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

export function ConversationScreen({
  conversationId,
  navigate,
}: {
  conversationId: string;
  navigate: (r: Route) => void;
}) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [sessionMeta, setSessionMeta] = useState<SessionEntry | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentFlight, setCurrentFlight] = useState<Flight | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const trackedInvocationIdsRef = useRef<Set<string>>(new Set());
  const currentFlightRef = useRef<Flight | null>(null);

  const agentId = agentIdFromConversation(conversationId);
  const isDm = agentId !== null;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [agents, allMessages, activeFlights] = await Promise.all([
        api<Agent[]>("/api/agents"),
        api<Message[]>("/api/messages"),
        api<Flight[]>(`/api/flights?conversationId=${encodeURIComponent(conversationId)}`),
      ]);
      setAgent(agentId ? agents.find((item) => item.id === agentId) ?? null : null);

      // For non-DM conversations, fetch session metadata for title/participants
      if (!agentId) {
        try {
          const meta = await api<SessionEntry>(`/api/session/${encodeURIComponent(conversationId)}`);
          setSessionMeta(meta);
        } catch {
          // session lookup is best-effort
        }
      }

      setMessages(
        sortMessages(allMessages.filter((message) => message.conversationId === conversationId)),
      );
      trackedInvocationIdsRef.current = new Set(activeFlights.map((flight) => flight.invocationId));
      setCurrentFlight(selectCurrentFlight(activeFlights));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [agentId, conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    currentFlightRef.current = currentFlight;
  }, [currentFlight]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [operatorName, setOperatorName] = useState("operator");
  const [awaitingResponseSince, setAwaitingResponseSince] = useState<number | null>(null);

  useEffect(() => {
    const element = composeRef.current;
    if (!element) return;
    element.style.height = "0px";
    const nextHeight = Math.min(Math.max(element.scrollHeight, 40), 160);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > nextHeight ? "auto" : "hidden";
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
    if (!currentFlight || TERMINAL_FLIGHT_STATES.has(currentFlight.state)) return false;
    const flightStartedAt = normalizeTimestampMs(currentFlight.startedAt) ?? awaitingResponseSince ?? Date.now();
    return flightStartedAt >= (lastAgentReplyAt ?? 0);
  }, [awaitingResponseSince, currentFlight, lastAgentReplyAt]);

  const agentName = agent?.name ?? sessionMeta?.title ?? agentId ?? "Conversation";
  const presence = useMemo(
    () => describePresence({
      agentName,
      agentState: agent?.state ?? null,
      sending,
      currentFlight,
      showWorkingTurn,
    }),
    [agent?.state, agentName, currentFlight, sending, showWorkingTurn],
  );

  useBrokerEvents(useCallback((event) => {
    if (event.kind === "message.posted") {
      const message = (event.payload as { message?: EventMessageRecord } | undefined)?.message;
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
        if (previous.some((candidate) => candidate.id === message.id)) return previous;
        if (!isAgentMessage) {
          const optimisticIndex = previous.findIndex((candidate) => (
            candidate.id.startsWith("optimistic-")
            && candidate.body === message.body
            && Math.abs(
              (normalizeTimestampMs(candidate.createdAt) ?? 0)
              - (normalizeTimestampMs(message.createdAt) ?? 0),
            ) <= 60_000
          ));
          if (optimisticIndex !== -1) {
            const next = [...previous];
            next[optimisticIndex] = nextMessage;
            return sortMessages(next);
          }
        }
        return sortMessages([...previous, nextMessage]);
      });

      if (isAgentMessage) {
        const messageAt = normalizeTimestampMs(message.createdAt) ?? Date.now();
        setAwaitingResponseSince((current) => {
          if (current === null || messageAt < current) return current;
          return null;
        });
        setCurrentFlight((current) => {
          if (!current) return current;
          const flightStartedAt = normalizeTimestampMs(current.startedAt) ?? 0;
          return messageAt >= flightStartedAt ? null : current;
        });
      }
      return;
    }

    if (event.kind === "invocation.requested") {
      const invocation = (event.payload as { invocation?: EventInvocationRecord } | undefined)?.invocation;
      if (!invocation || invocation.targetAgentId !== agentId || invocation.conversationId !== conversationId) return;
      trackedInvocationIdsRef.current.add(invocation.id);
      setAwaitingResponseSince((current) => current ?? Date.now());
      return;
    }

    if (event.kind === "flight.updated") {
      const flight = (event.payload as { flight?: EventFlightRecord } | undefined)?.flight;
      if (!flight || flight.targetAgentId !== agentId) return;
      const isTracked = trackedInvocationIdsRef.current.has(flight.invocationId)
        || currentFlightRef.current?.id === flight.id;
      if (!isTracked) return;

      if (TERMINAL_FLIGHT_STATES.has(flight.state)) {
        setCurrentFlight((current) => (current?.id === flight.id ? null : current));
        void load();
        return;
      }

      trackedInvocationIdsRef.current.add(flight.invocationId);
      setCurrentFlight(mapEventFlight(flight, conversationId, agentId ?? ""));
      return;
    }

    if (event.kind === "agent.endpoint.upserted") {
      const endpoint = (event.payload as { endpoint?: EventEndpointRecord } | undefined)?.endpoint;
      if (!endpoint || endpoint.agentId !== agentId) return;
      setAgent((current) => {
        if (!current) return current;
        return {
          ...current,
          harness: endpoint.harness ?? current.harness,
          state: endpoint.state,
          updatedAt: Date.now(),
        };
      });
      return;
    }

    if (event.kind === "unknown") {
      void load();
    }
  }, [agentId, agentName, conversationId, load, operatorName]));

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

  const sendText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

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
      const result = await api<SendResult>("/api/send", {
        method: "POST",
        body: JSON.stringify({ body: trimmed, conversationId }),
      });
      if (result.flight) {
        trackedInvocationIdsRef.current.add(result.flight.invocationId);
        setCurrentFlight(mapEventFlight(result.flight, conversationId, agentId ?? ""));
      }
    } catch (cause) {
      setMessages((previous) => previous.filter((message) => message.id !== optimisticMessage.id));
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

  const dispatchToCandidate = async (record: ScoutDispatchRecord, candidate: ScoutDispatchCandidate) => {
    const prefix = `@${candidate.agentId} `;
    const leftover = draft.trim();
    if (leftover) {
      setDraft("");
      await sendText(`${prefix}${leftover}`);
      return;
    }
    setDraft(prefix);
    composeRef.current?.focus();
    void record;
  };

  return (
    <div className="s-conversation">
      <div
        className="s-conv-header"
        onClick={() => isDm ? navigate({ view: "agent-info", conversationId }) : undefined}
        style={isDm ? undefined : { cursor: "default" }}
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
        <div
          className="s-avatar s-avatar-sm"
          style={{ background: actorColor(agentName) }}
        >
          {agentName[0].toUpperCase()}
        </div>
        <div className="s-conv-header-info">
          <span className="s-conv-header-name">{agentName}</span>
          <span className="s-conv-header-state">
            <span className="s-dot s-dot-sm" style={{ background: presenceColor(presence, agent?.state ?? null) }} />
            {isDm ? presence.label : (sessionMeta?.participantIds.filter((p) => p !== "operator").join(", ") ?? conversationId)}
          </span>
        </div>
        <span className="s-spacer" />
        {agent?.harness && <span className="s-badge">{agent.harness}</span>}
        {!isDm && sessionMeta?.kind && <span className="s-badge">{sessionMeta.kind}</span>}
        {isDm && <span className="s-chevron" />}
      </div>

      {presence.showStrip && (
        <div className={`s-conv-status s-conv-status-${presence.tone}`} aria-live="polite">
          <span className="s-conv-status-dot" />
          <div className="s-conv-status-copy">
            <span className="s-conv-status-label">{presence.label}</span>
            <span className="s-conv-status-detail">{presence.detail}</span>
          </div>
        </div>
      )}

      {error && <p className="s-error">{error}</p>}

      <div className="s-messages">
        {messages.length === 0 ? (
          <div className="s-empty">
            <p>No messages yet</p>
            <p>Start a conversation with this agent</p>
          </div>
        ) : (
          messages.map((message) => {
            const isYou = isOperatorMessage(message, operatorName);
            const dispatch = readScoutDispatch(message);
            const rowClass = dispatch ? "scout.dispatch" : message.class;
            return (
              <div
                key={message.id}
                className={`s-msg s-row-message${isYou ? " s-msg-you" : ""}`}
                data-class={rowClass}
              >
                <div className="s-msg-header">
                  <span className="s-msg-actor">{isYou ? "You" : message.actorName}</span>
                  <span className="s-msg-time">{timeAgo(message.createdAt)}</span>
                </div>
                <p className="s-msg-body">{renderWithMentions(message.body)}</p>
                {dispatch && dispatch.candidates.length > 0 && (
                  <div className="s-scout-dispatch">
                    {dispatch.candidates.map((candidate) => (
                      <button
                        key={candidate.agentId}
                        type="button"
                        className="s-scout-tile"
                        onClick={() => void dispatchToCandidate(dispatch, candidate)}
                      >
                        <span className="s-scout-tile-id">@{candidate.agentId}</span>
                        <span className="s-scout-tile-state">{candidate.endpointState}</span>
                        <span className="s-scout-tile-meta">
                          {[candidate.workspace, candidate.node, candidate.projectRoot]
                            .filter(Boolean)
                            .join(" · ") || candidate.displayName}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {presence.showTyping && (
          <div className="s-msg s-msg-working" aria-live="polite">
            <div className="s-msg-header">
              <span className="s-msg-actor">{agentName}</span>
              <span className="s-msg-time">
                {currentFlight?.startedAt ? timeAgo(currentFlight.startedAt) : "now"}
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
        <textarea
          ref={composeRef}
          className="s-compose-input"
          placeholder={`Message ${agentName}...`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (!sending && draft.trim()) {
              void send();
            }
          }}
          disabled={sending}
          rows={1}
        />
        <button
          type="submit"
          className="s-compose-send"
          disabled={sending || !draft.trim()}
          aria-label="Send message"
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
}
