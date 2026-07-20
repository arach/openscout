import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ScoutDispatchRecord,
  ScoutDispatchCandidate,
} from "@openscout/protocol";
import { api } from "../../lib/api.ts";
import {
  filterAgentsByMachineScope,
} from "../../lib/machine-scope.ts";
import {
  compactAgentId,
  minimalAgentDisplayName,
} from "../../lib/agent-labels.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import {
  formatAbsoluteTimestamp,
  normalizeTimestampMs,
  timeAgo,
} from "../../lib/time.ts";
import { isSameCalendarDay, formatThreadDayLabel } from "../../lib/thread-days.ts";
import { isAgentOnline } from "../../lib/agent-state.ts";
import {
  TERMINAL_CONVERSATION_FLIGHT_STATES,
  conversationShortLabel,
  isActiveConversationFlight,
  isConversationWorkingTurnWithoutRecentUpdate,
  isConversationWorkingTurnWithoutRecentUpdateAnswered,
  isQueuedUntilOnlineConversationFlight,
  isRequesterWaitTimeoutConversationFlight,
  shouldClearConversationWorkingStateForAgentMessage,
  shouldShowConversationWorkingTurn,
} from "../../lib/conversations.ts";
import { MessageMarkup } from "../../lib/message-markup.tsx";
import { isNoisyConversationStatusMessage } from "../../lib/message-visibility.ts";
import {
  routeMachineId,
} from "../../lib/router.ts";
import {
  saveLastViewed,
} from "../../lib/sessionRead.ts";
import { useScout } from "../../scout/Provider.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import { useContextMenu, type MenuItem } from "../../components/ContextMenu.tsx";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { MessageEmbeds } from "../../components/MessageEmbeds.tsx";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import type {
  Agent,
  Flight,
  FleetActivity,
  FleetState,
  FleetAsk,
  Message,
  Route,
  SessionEntry,
} from "../../lib/types.ts";
import "./conversation-screen.css";
import "../ops/ops-screen.css";
import {
  AddParticipantForm,
  ConversationHeader,
  ConversationIdentityRow,
  type ConversationHeaderOperator,
  type ConversationHeaderParticipant,
} from "./ConversationHeader.tsx";
import { ConversationComposer } from "./ConversationComposer.tsx";
import { ThreadMotionPanel } from "./ConversationPanels.tsx";
import { ConversationStatusStrip, PinnedAskCard } from "./ConversationStatus.tsx";
import { DismissIcon } from "./conversation-icons.tsx";
import {
  SLASH_COMMANDS,
  buildTurnSnapshot,
  deriveDisplayTitle,
  describePresence,
  displayNameForActor,
  emptyFleetState,
  hasOutstandingConversationReply,
  isOperatorMessage,
  keepPreviousIfJsonEqual,
  latestAgentMessageAt,
  mapEventFlight,
  matchMentionTrigger,
  matchSlashTrigger,
  messageClassLabel,
  parseAskReplyTag,
  pathLeaf,
  readScoutDispatch,
  resolveAgentByIdentity,
  resolveComposeAction,
  resolveAskReplyContext,
  resolveMessageAgent,
  selectCurrentFlight,
  selectOperatorPendingAsk,
  selectTurnActivity,
  selectTurnAsk,
  sortMessages,
  type ComposeAction,
  type ConversationPresence,
  type EventFlightRecord,
  type EventInvocationRecord,
  type EventMessageRecord,
  type MentionCandidate,
  type MentionSuggestState,
  type MotionTone,
  type SendResult,
  type SendReceipt,
  type SlashCommand,
  type SlashSuggestState,
} from "./conversation-model.ts";

function messageIdFromLocationHash(hash: string | null | undefined): string | null {
  const raw = hash?.trim().replace(/^#/, "");
  if (!raw?.startsWith("msg-")) return null;
  const id = raw.slice("msg-".length).trim();
  if (!id) return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export function ConversationScreen({
  conversationId,
  initialDraft,
  navigate,
  embedded,
  showBackNav = true,
}: {
  conversationId: string;
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
  const [hashMessageId, setHashMessageId] = useState(() =>
    typeof window === "undefined" ? null : messageIdFromLocationHash(window.location.hash),
  );
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const trackedInvocationIdsRef = useRef<Set<string>>(new Set());
  const currentFlightRef = useRef<Flight | null>(null);
  const lastForegroundRefreshAtRef = useRef(0);
  const appliedInitialDraftKeyRef = useRef<string | null>(null);
  const lastPostedReadCursorMessageIdRef = useRef<string | null>(null);

  const agentId = sessionMeta?.agentId ?? null;
  const isDm = sessionMeta?.kind === "direct";
  const agent = useMemo<Agent | null>(
    () =>
      agentId ? (scopedAgents.find((item) => item.id === agentId) ?? null) : null,
    [scopedAgents, agentId],
  );

  const [pinnedAsk, setPinnedAsk] = useState<FleetAsk | null>(null);

  useEffect(() => {
    api<FleetState>("/api/fleet")
      .then((fleet) => {
        setPinnedAsk((previous) =>
          keepPreviousIfJsonEqual(
            previous,
            selectOperatorPendingAsk(fleet.activeAsks, conversationId, agentId),
          ),
        );
      })
      .catch(() => {});
  }, [conversationId, agentId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const meta = await api<SessionEntry>(
        `/api/session/${encodeURIComponent(conversationId)}`,
      ).catch(() => null);

      setSessionMeta((previous) => keepPreviousIfJsonEqual(previous, meta));
      const resolvedAgentId = meta?.agentId ?? null;

      const canonicalConversationId =
        meta?.id && meta.id !== conversationId
          ? meta.id
          : conversationId;

      if (canonicalConversationId !== conversationId) {
        navigate({
          view: "conversation",
          conversationId: canonicalConversationId,
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
      const visibleMessages = sortedMessages.filter(
        (message) => !isNoisyConversationStatusMessage(message),
      );
      setMessages((previous) => keepPreviousIfJsonEqual(previous, visibleMessages));
      saveLastViewed(canonicalConversationId);
      const lastMessage = sortedMessages.at(-1);
      if (
        lastMessage &&
        lastPostedReadCursorMessageIdRef.current !== lastMessage.id
      ) {
        lastPostedReadCursorMessageIdRef.current = lastMessage.id;
        void api(`/api/conversations/${encodeURIComponent(canonicalConversationId)}/read-cursor`, {
          method: "POST",
          body: JSON.stringify({ lastReadMessageId: lastMessage.id }),
        }).catch(() => {
          if (lastPostedReadCursorMessageIdRef.current === lastMessage.id) {
            lastPostedReadCursorMessageIdRef.current = null;
          }
        });
      }
      setAllFlights((previous) => keepPreviousIfJsonEqual(previous, activeFlights));
      trackedInvocationIdsRef.current = new Set(
        activeFlights.map((flight) => flight.invocationId),
      );
      const nextCurrentFlight = selectCurrentFlight(activeFlights);
      const turnAgentId = nextCurrentFlight?.agentId ?? resolvedAgentId ?? null;
      const nextTurnActivity = selectTurnActivity(
        fleet.activity,
        nextCurrentFlight,
        canonicalConversationId,
        turnAgentId,
      );
      const nextTurnAsk = selectTurnAsk(
        fleet.activeAsks,
        nextCurrentFlight,
        canonicalConversationId,
        turnAgentId,
      );
      setCurrentFlight((previous) =>
        keepPreviousIfJsonEqual(previous, nextCurrentFlight),
      );
      setTurnActivity((previous) =>
        keepPreviousIfJsonEqual(previous, nextTurnActivity),
      );
      setTurnAsk((previous) => keepPreviousIfJsonEqual(previous, nextTurnAsk));
      setPinnedAsk((previous) =>
        keepPreviousIfJsonEqual(
          previous,
          selectOperatorPendingAsk(
            fleet.activeAsks,
            canonicalConversationId,
            resolvedAgentId,
          ),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [conversationId, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    lastPostedReadCursorMessageIdRef.current = null;
  }, [conversationId]);

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
  const [sendReceipt, setSendReceipt] = useState<SendReceipt | null>(null);
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
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [addParticipantId, setAddParticipantId] = useState("");
  const [addParticipantError, setAddParticipantError] = useState<string | null>(null);
  const [addingParticipant, setAddingParticipant] = useState(false);

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

  const participantMetaById = useMemo(() => {
    const entries = new Map<
      string,
      NonNullable<SessionEntry["participants"]>[number]
    >();
    for (const participant of sessionMeta?.participants ?? []) {
      entries.set(participant.actorId, participant);
      if (participant.agentId) entries.set(participant.agentId, participant);
    }
    return entries;
  }, [sessionMeta]);

  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    const seen = new Set<string>();
    const list: MentionCandidate[] = [];
    for (const participantId of sessionMeta?.participantIds ?? []) {
      if (participantId === "operator") continue;
      const participant = participantMetaById.get(participantId);
      const handleRaw = participant?.scopedAlias?.trim().replace(/^@+/, "");
      if (!handleRaw) continue;
      const key = handleRaw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        id: participantId,
        label: participant?.label ?? participant?.displayName ?? handleRaw,
        name: participant?.displayName ?? handleRaw,
        handle: handleRaw,
      });
    }
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
  }, [participantMetaById, scopedAgents, sessionMeta]);

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
          c.name.toLowerCase().includes(q) ||
          c.label.toLowerCase().includes(q),
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
  const currentFlightHasNoRecentUpdate = isConversationWorkingTurnWithoutRecentUpdate(
    currentFlight,
    currentNowMs,
  );
  const quietWorkingTurnHasNewerReply =
    isConversationWorkingTurnWithoutRecentUpdateAnswered(
      currentFlight,
      lastAgentReplyAt,
      currentNowMs,
    );
  const workingTurnDismissed = currentFlight
    ? dismissedWorkingTurnIds.has(currentFlight.id)
    : false;
  const showWorkingTurn =
    rawShowWorkingTurn &&
    !quietWorkingTurnHasNewerReply &&
    !workingTurnDismissed;
  const workingTurnHasNoRecentUpdate = showWorkingTurn && currentFlightHasNoRecentUpdate;
  const currentFlightQueuedUntilOnline =
    showWorkingTurn && isQueuedUntilOnlineConversationFlight(currentFlight);
  const workingTurnIsGone =
    workingTurnHasNoRecentUpdate &&
    !isAgentOnline(agent?.state ?? null);
  const shouldPollOutstandingTurn =
    isDm && (sending || awaitingResponseSince !== null || showWorkingTurn);
  const hasOutstandingReply =
    isDm &&
    hasOutstandingConversationReply({
      sending,
      awaitingResponse: awaitingResponseSince !== null,
      currentFlight,
    });

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
        awaitingResponse: awaitingResponseSince !== null,
        workingTurnIsGone,
        workingTurnHasNoRecentUpdate,
        nowMs: currentNowMs,
      });
    },
    [
      agent?.state,
      agentName,
      awaitingResponseSince,
      currentFlight,
      currentNowMs,
      isDm,
      sending,
      showWorkingTurn,
      workingTurnIsGone,
      workingTurnHasNoRecentUpdate,
    ],
  );
  const hasQuietWorkingTurnPresence = presence.tone === "quiet";
  const hasPassiveWorkingTurnPresence =
    hasQuietWorkingTurnPresence || currentFlightQueuedUntilOnline;
  const workingTurnBadgeLabel = currentFlightQueuedUntilOnline
    ? "Not delivered"
    : hasQuietWorkingTurnPresence
    ? presence.label
    : "Live";
  const workingTurnSnapshot = useMemo(
    () =>
      buildTurnSnapshot({
        currentFlight,
        presence,
        turnActivity,
        turnAsk,
        awaitingResponseSince,
        nowMs: currentNowMs,
      }),
    [awaitingResponseSince, currentFlight, currentNowMs, presence, turnActivity, turnAsk],
  );
  const workingTurnCardClassName = [
    "s-thread-msg-card",
    "s-thread-msg-working-card",
    "s-thread-msg-card--avatar-row",
    hasPassiveWorkingTurnPresence ? "s-thread-msg-working-card--quiet" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const workingTurnKindClassName = [
    "s-thread-msg-kind",
    hasPassiveWorkingTurnPresence ? "s-thread-msg-kind--quiet" : null,
    workingTurnIsGone ? "s-thread-msg-kind--gone" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const noRecentUpdateIndicatorClassName = [
    "s-thread-no-recent-update-indicator",
    workingTurnIsGone ? "s-thread-no-recent-update-indicator--gone" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const workingTurnSnapshotClassName = [
    "s-thread-turn-snapshot",
    hasPassiveWorkingTurnPresence ? "s-thread-turn-snapshot--quiet" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const workingTurnPulseClassName = [
    "s-thread-turn-snapshot-pulse",
    hasPassiveWorkingTurnPresence ? "s-thread-turn-snapshot-pulse--quiet" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const presenceLineClassName = [
    "s-thread-presence-line",
    hasPassiveWorkingTurnPresence ? "s-thread-presence-line--quiet" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const presenceStripClassName = [
    "s-thread-presence-strip",
    hasPassiveWorkingTurnPresence ? "s-thread-presence-strip--quiet" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const presenceLineLabel = hasQuietWorkingTurnPresence
    ? presence.detail
    : `${agentName}: ${workingTurnSnapshot.latest}`;
  const threadTitle = sessionMeta ? deriveDisplayTitle(sessionMeta) : agentName;
  const canonicalConversationId = sessionMeta?.id ?? conversationId;
  const conversationAlias = sessionMeta?.alias?.trim() || null;
  const workspaceName = pathLeaf(sessionMeta?.workspaceRoot);
  const turnMotionTone: MotionTone = hasQuietWorkingTurnPresence ? "quiet" : presence.tone;
  const turnMotionStartedAt =
    currentFlight?.startedAt ?? turnAsk?.startedAt ?? awaitingResponseSince;
  const showEmptyMotionPanel =
    messages.length === 0 &&
    isDm &&
    (presence.showTyping ||
      currentFlight !== null ||
      turnActivity.length > 0 ||
      turnAsk !== null ||
      awaitingResponseSince !== null);
  const operatorIsParticipant = useMemo(() => {
    if (sessionMeta) return sessionMeta.participantIds.includes("operator");
    return isDm;
  }, [isDm, sessionMeta]);
  const headerParticipants = useMemo<ConversationHeaderParticipant[]>(() => {
    const participantIds = sessionMeta
      ? sessionMeta.participantIds.filter((id) => id !== "operator")
      : agentId
        ? [agentId]
        : [];
    return participantIds.map((id) => {
      const participantAgent = resolveAgentByIdentity(scopedAgents, [id]);
      const meta = participantMetaById.get(id);
      return {
        id,
        name: meta?.scopedAlias ?? participantAgent?.name ?? meta?.displayName ?? compactAgentId(id) ?? id,
        title: meta?.label ?? participantAgent?.id ?? id,
        agent: participantAgent,
        harness: participantAgent?.harness ?? meta?.harness ?? null,
        model: participantAgent?.model ?? null,
      } satisfies ConversationHeaderParticipant;
    });
  }, [agentId, participantMetaById, scopedAgents, sessionMeta]);
  const visibleHeaderParticipants = headerParticipants.slice(0, 4);
  const hiddenHeaderParticipantCount = Math.max(
    headerParticipants.length - visibleHeaderParticipants.length,
    0,
  );
  const headerOperator = useMemo<ConversationHeaderOperator>(
    () => ({ name: operatorName, active: operatorIsParticipant }),
    [operatorIsParticipant, operatorName],
  );

  const messagesById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );

  const scrollToMessage = useCallback((messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("s-thread-msg--flash");
    window.setTimeout(() => el.classList.remove("s-thread-msg--flash"), 1200);
  }, []);

  useEffect(() => {
    const onHashChange = () => setHashMessageId(messageIdFromLocationHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!hashMessageId || !messagesById.has(hashMessageId)) return;
    const timer = window.setTimeout(() => scrollToMessage(hashMessageId), 50);
    return () => window.clearTimeout(timer);
  }, [hashMessageId, messagesById, scrollToMessage]);

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
            replyToMessageId: message.replyToMessageId ?? message.n ?? null,
          };
          if (isNoisyConversationStatusMessage(nextMessage)) return;

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
    options?: { forceAction?: ComposeAction },
  ) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const forceAction = options?.forceAction;
    const action = forceAction ?? resolveComposeAction({
      isDm,
      hasOutstandingReply,
    });

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
    setSendReceipt(null);
    if (action !== "message") {
      setAwaitingResponseSince(optimisticCreatedAt);
    }
    setError(null);
    setMessages((previous) => sortMessages([...previous, optimisticMessage]));

    try {
      const result = await api<SendResult>(
        `/api/chats/${encodeURIComponent(conversationId)}/messages`,
        {
        method: "POST",
        body: JSON.stringify({
          body: trimmed,
        }),
        },
      );
      const routedConversationId = result.chatId?.trim() ?? result.conversationId?.trim();
      if (routedConversationId && routedConversationId !== conversationId) {
        throw new Error(
          `Send returned a different Chat (${routedConversationId}) instead of appending to ${conversationId}.`,
        );
      }
      if (result.flight) {
        trackedInvocationIdsRef.current.add(result.flight.invocationId);
        setCurrentFlight(
          mapEventFlight(result.flight, conversationId, agentId ?? ""),
        );
        setTurnActivity([]);
        setTurnAsk(null);
      } else if (action !== "message") {
        setAwaitingResponseSince(null);
      }
      const unresolvedTargets = result.unresolvedTargets ?? [];
      const deliveredTargetIds = result.invokedTargets?.length
        ? result.invokedTargets
        : result.notifiedTargets ?? [];
      if (unresolvedTargets.length > 0) {
        setSendReceipt({
          tone: "warning",
          text: `Posted, but not delivered to ${unresolvedTargets.join(", ")}`,
        });
      } else if (deliveredTargetIds.length > 0) {
        const labels = deliveredTargetIds.map((targetId) => {
          const participant = participantMetaById.get(targetId);
          return `@${participant?.scopedAlias?.trim() || participant?.displayName?.trim() || targetId}`;
        });
        setSendReceipt({ tone: "success", text: `Sent to ${labels.join(", ")}` });
      } else {
        setSendReceipt({ tone: "success", text: "Posted to this room" });
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

  const replyToHandle = useCallback((handle: string) => {
    const normalized = handle.trim().replace(/^@+/, "");
    if (!normalized) return;
    const token = `@${normalized}`;
    setDraft((current) => {
      if (current.toLowerCase().includes(token.toLowerCase())) return current;
      return current.trim() ? `${current.trimEnd()} ${token} ` : `${token} `;
    });
    requestAnimationFrame(() => composeRef.current?.focus());
  }, []);

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
  const composeAction = resolveComposeAction({ isDm, hasOutstandingReply });
  const composePlaceholder = isDm
    ? `Message ${agentName} — type / to route or @ to mention an agent`
    : sessionMeta?.kind === "channel"
      ? `Message #${conversationShortLabel(sessionMeta)}...`
      : `Message ${threadTitle}...`;
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
      await sendText(`${prefix}${leftover}`, { forceAction: "invoke" });
      return;
    }
    setDraft(prefix);
    composeRef.current?.focus();
    void record;
  };

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
        {!embedded && (
          <ConversationHeader
            showBackNav={showBackNav}
            isDm={isDm}
            navigate={navigate}
            route={route}
            canonicalConversationId={canonicalConversationId}
            threadTitle={threadTitle}
            agentId={agentId}
            visibleParticipants={visibleHeaderParticipants}
            hiddenParticipantCount={hiddenHeaderParticipantCount}
            operator={headerOperator}
            canAddParticipants={canAddParticipants}
            onToggleAddParticipant={() => {
              setAddParticipantError(null);
              setAddParticipantOpen((open) => !open);
            }}
          />
        )}

        {!embedded && sessionMeta && (
          <ConversationIdentityRow
            canonicalConversationId={canonicalConversationId}
            conversationAlias={conversationAlias}
          />
        )}

        {!embedded && addParticipantOpen && canAddParticipants && (
          <AddParticipantForm
            agents={addableParticipantAgents}
            addParticipantId={addParticipantId}
            setAddParticipantId={setAddParticipantId}
            addingParticipant={addingParticipant}
            addParticipantError={addParticipantError}
            onCancel={() => {
              setAddParticipantOpen(false);
              setAddParticipantError(null);
            }}
            onSubmit={() => void submitAddParticipant()}
          />
        )}

        {pinnedAsk && (
          <PinnedAskCard
            pinnedAsk={pinnedAsk}
            onAnswer={() => {
              composeRef.current?.focus();
            }}
          />
        )}

        <ConversationStatusStrip presence={presence} agent={agent} />

        {error && <p className="s-thread-error">{error}</p>}

        <div className="s-thread-feed">
          <div className="s-thread-feed-spacer" />
          {messages.length === 0 ? (
            showEmptyMotionPanel ? (
              <ThreadMotionPanel
                agentName={agentName}
                title={presence.label}
                detail={presence.detail || workingTurnSnapshot.latest}
                snapshot={workingTurnSnapshot}
                events={turnActivity}
                tone={turnMotionTone}
                workspaceName={workspaceName}
                branch={sessionMeta?.currentBranch}
                startedAt={turnMotionStartedAt}
              />
            ) : (
              <div className="s-thread-empty">
                <div className="s-thread-empty-glyph" aria-hidden="true">
                  {isDm ? "@" : "#"}
                </div>
                <p>{threadTitle}</p>
                <p>
                  {isDm
                    ? "No messages yet. Send a message to start working with this agent."
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
            )
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
              const messageParticipant = participantMetaById.get(message.actorId);
              const scopedReplyHandle = messageParticipant?.scopedAlias?.trim() || null;
              const displayActorName = !isYou && scopedReplyHandle
                ? scopedReplyHandle
                : message.actorName;
              const actorHandle = isYou
                ? operatorName.toLowerCase()
                : scopedReplyHandle ?? messageAgent?.handle ?? null;
              const askReply = parseAskReplyTag(message.body);
              const replyContext = askReply
                ? resolveAskReplyContext({
                    flightId: askReply.flightId,
                    replyToMessageId: message.replyToMessageId,
                    messagesById,
                    agents: scopedAgents,
                    operatorName,
                  })
                : null;
              const displayBody = askReply ? askReply.body : message.body;

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
                    <div className="s-thread-msg-card">
                      <div className="s-thread-msg-card-content">
                        <div className="s-thread-msg-header">
                          <div className="s-thread-msg-meta">
                            {(() => {
                              const profileNav = !isYou && messageAgent
                                ? () =>
                                    openContent(
                                      navigate,
                                      {
                                        view: "agents-v2",
                                        agentId: messageAgent.id,
                                      },
                                      { returnTo: route },
                                    )
                                : null;
                              const avatarName = isYou
                                ? operatorName
                                : displayActorName ?? "?";
                              const avatar = (
                                <AgentAvatar
                                  agent={messageAgent ?? undefined}
                                  name={avatarName}
                                  placement="turn"
                                  className="s-thread-msg-avatar"
                                  title={avatarName}
                                />
                              );
                              return profileNav ? (
                                <button
                                  type="button"
                                  className="s-thread-msg-avatar--nav"
                                  onClick={profileNav}
                                  aria-label={`View profile for ${message.actorName ?? "agent"}`}
                                  title={`View profile for ${message.actorName ?? "agent"}`}
                                >
                                  {avatar}
                                </button>
                              ) : (
                                avatar
                              );
                            })()}
                            {!isYou && messageAgent ? (
                              <button
                                type="button"
                                className="s-thread-msg-actor s-thread-msg-actor--nav"
                                onClick={() =>
                                  openContent(
                                    navigate,
                                    {
                                      view: "agents-v2",
                                      agentId: messageAgent.id,
                                    },
                                    { returnTo: route },
                                  )
                                }
                                title={`View profile for ${message.actorName}`}
                              >
                                {displayActorName}
                              </button>
                            ) : (
                              <span className="s-thread-msg-actor">
                                {isYou ? operatorName : displayActorName}
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
                          {!isYou && actorHandle && (
                            <button
                              type="button"
                              className="s-thread-msg-permalink"
                              aria-label={`Reply to @${actorHandle}`}
                              title={`Reply to @${actorHandle}`}
                              onClick={() => replyToHandle(actorHandle)}
                            >
                              <ReplyGlyph />
                            </button>
                          )}
                          <button
                            type="button"
                            className="s-thread-msg-permalink"
                            aria-label="Copy link to message"
                            title="Copy link to message"
                            onClick={() => {
                              const url = new URL(window.location.href);
                              if (
                                route.view === "agents" ||
                                route.view === "agents-v2"
                              ) {
                                url.searchParams.set("tab", "message");
                              }
                              url.hash = `msg-${message.id}`;
                              void navigator.clipboard.writeText(url.toString());
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

                        {replyContext && (
                          <button
                            type="button"
                            className="s-thread-reply-ctx"
                            title={`Open the originating request${
                              replyContext.flightId
                                ? ` · ${replyContext.flightId}`
                                : ""
                            }`}
                            onClick={() =>
                              scrollToMessage(replyContext.originatingMessageId)
                            }
                          >
                            <ReplyGlyph />
                            <span className="s-thread-reply-ctx-label">
                              reply to
                            </span>
                            <span className="s-thread-reply-ctx-title">
                              {replyContext.title}
                            </span>
                            <span className="s-thread-reply-ctx-from">
                              · {replyContext.from}
                            </span>
                            <span className="s-thread-reply-ctx-status">
                              · done
                            </span>
                          </button>
                        )}

                        <div className="s-thread-msg-body" title={absoluteTime}>
                          <MessageMarkup text={displayBody} />
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

          {presence.showTyping && !showEmptyMotionPanel && (
            <div className="s-thread-feed-block">
              <div className="s-thread-msg" aria-live="polite">
                <div className={workingTurnCardClassName}>
                  <AgentAvatar
                    agent={agent ?? undefined}
                    name={agentName}
                    placement="turn"
                    className="s-thread-msg-avatar s-thread-msg-avatar--working"
                    title={agentName}
                  />
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
                      {hasQuietWorkingTurnPresence && (
                        <button
                          type="button"
                          className="s-thread-msg-dismiss"
                          aria-label="Dismiss no recent update turn"
                          title="Dismiss no recent update turn"
                          onClick={dismissWorkingTurn}
                        >
                          <DismissIcon />
                        </button>
                      )}
                    </div>
                    <div className="s-thread-msg-working-body">
                      <div className={workingTurnSnapshotClassName}>
                        {hasPassiveWorkingTurnPresence ? (
                          <span
                            className={noRecentUpdateIndicatorClassName}
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
                          <dt>Activity</dt>
                          <dd>{workingTurnSnapshot.activityLabel}</dd>
                        </div>
                        <div className="s-thread-turn-snapshot-stat">
                          <dt>Elapsed</dt>
                          <dd>{workingTurnSnapshot.elapsedLabel}</dd>
                        </div>
                        <div className="s-thread-turn-snapshot-stat">
                          <dt>Last</dt>
                          <dd>{workingTurnSnapshot.lastActivityLabel}</dd>
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
              <AgentAvatar
                agent={agent ?? undefined}
                name={agentName}
                placement="turn"
                className="s-thread-presence-line-avatar"
                title={agentName}
              />
            </div>
            <span className="s-thread-presence-line-label">
              {presenceLineLabel}
            </span>
            <div className={presenceStripClassName} />
          </div>
        )}

        <ConversationComposer
          composeRef={composeRef}
          draft={draft}
          setDraft={setDraft}
          composePlaceholder={composePlaceholder}
          slashState={slashState}
          setSlashState={setSlashState}
          filteredSlashCommands={filteredSlashCommands}
          applySlashCommand={applySlashCommand}
          mentionState={mentionState}
          setMentionState={setMentionState}
          filteredMentions={filteredMentions}
          applyMention={applyMention}
          updateTriggersFromDraft={updateTriggersFromDraft}
          closeSuggestions={closeSuggestions}
          isStopMode={isStopMode}
          sending={sending}
          composeAction={composeAction}
          onSend={() => void send()}
          onInterrupt={() => void interrupt()}
          sendReceipt={sendReceipt}
        />
      </div>

    </div>
  );
}

function ReplyGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  );
}
