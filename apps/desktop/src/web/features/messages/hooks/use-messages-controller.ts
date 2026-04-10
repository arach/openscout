import React from "react";

import {
  buildOptimisticRelayMessage,
  generateClientMessageId,
} from "@web/features/messages/components/relay-timeline";
import {
  asErrorMessage,
  buildRelayConversationItems,
  buildRelayFeedItems,
  cleanDisplayTitle,
  filterRelayMessages,
  findActiveRelayMention,
  messagePreviewSnippet,
  relaySecondaryText,
  resolveRelayDestination,
  scoreRelayMentionCandidate,
} from "@web/features/messages/lib/relay-utils";
import type { RelayMentionCandidate } from "@web/features/messages/lib/relay-types";
import type { AppView, ComposerRelayReference, PendingRelayMessage } from "@/app-types";
import type { ScoutDesktopBridge } from "@/lib/electron";
import type {
  AppSettingsState,
  DesktopShellPatch,
  DesktopShellState,
  InterAgentAgent,
  InterAgentThread,
  MessagesState,
  MessagesThread,
  RelayDestinationKind,
  RelayMessage,
  RelayState,
  SessionMetadata,
} from "@/lib/scout-desktop";

export type ConversationReplyTarget = {
  messageId: string;
  authorId: string;
  authorName: string;
  preview: string;
};

type UseMessagesControllerInput = {
  activeView: AppView;
  scoutDesktop: ScoutDesktopBridge | null;
  voiceEnabled: boolean;
  relayState: RelayState | null;
  messagesState: MessagesState | null;
  interAgentAgents: InterAgentAgent[];
  interAgentThreads: InterAgentThread[];
  sessions: SessionMetadata[];
  appSettings: AppSettingsState | null;
  setActiveView: React.Dispatch<React.SetStateAction<AppView>>;
  applyRelayWorkspacePatch: (
    nextState: DesktopShellPatch,
  ) => void;
};

export function useMessagesController({
  activeView,
  scoutDesktop,
  voiceEnabled,
  relayState,
  messagesState,
  interAgentAgents,
  interAgentThreads,
  sessions,
  appSettings,
  setActiveView,
  applyRelayWorkspacePatch,
}: UseMessagesControllerInput) {
  const [selectedConversationKind, setSelectedConversationKind] = React.useState<RelayDestinationKind>("channel");
  const [selectedConversationId, setSelectedConversationId] = React.useState("shared");
  const [selectedMessageThreadId, setSelectedMessageThreadId] = React.useState<string | null>(null);
  const [composerDraft, setComposerDraft] = React.useState("");
  const [composerSending, setComposerSending] = React.useState(false);
  const [composerSelectionStart, setComposerSelectionStart] = React.useState(0);
  const [mentionSelectionIndex, setMentionSelectionIndex] = React.useState(0);
  const [messagesFeedback, setMessagesFeedback] = React.useState<string | null>(null);
  const [timelinePinnedToBottom, setTimelinePinnedToBottom] = React.useState(true);
  const [replyTarget, setReplyTarget] = React.useState<ConversationReplyTarget | null>(null);
  const [contextMessageIds, setContextMessageIds] = React.useState<string[]>([]);
  const [pendingMessages, setPendingMessages] = React.useState<PendingRelayMessage[]>([]);
  const [pendingComposerFocusTick, setPendingComposerFocusTick] = React.useState(0);

  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const timelineViewportRef = React.useRef<HTMLDivElement | null>(null);

  const messageThreads = messagesState?.threads ?? [];
  const selectedMessagesThread = React.useMemo(
    () => messageThreads.find((thread) => thread.id === selectedMessageThreadId) ?? null,
    [messageThreads, selectedMessageThreadId],
  );
  const selectedMessagesInternalThread = React.useMemo(
    () => selectedMessagesThread?.interAgentThreadId
      ? interAgentThreads.find((thread) => thread.id === selectedMessagesThread.interAgentThreadId) ?? null
      : null,
    [interAgentThreads, selectedMessagesThread],
  );
  const selectedMessagesInternalTarget = React.useMemo(
    () => {
      if (!selectedMessagesInternalThread) {
        return null;
      }

      const participantIds = selectedMessagesInternalThread.participants.map((participant) => participant.id);
      const directConversationId = relayState?.directs.find((thread) => participantIds.includes(thread.id))?.id ?? null;
      return directConversationId
        ? interAgentAgents.find((agent) => agent.id === directConversationId) ?? null
        : null;
    },
    [interAgentAgents, relayState, selectedMessagesInternalThread],
  );
  const selectedMessagesDetailAgentId = selectedMessagesThread?.kind === "relay" && selectedConversationKind === "direct"
    ? selectedConversationId
    : selectedMessagesInternalTarget?.id ?? null;

  React.useEffect(() => {
    if (!relayState) {
      return;
    }

    const conversationFeedItems = buildRelayFeedItems(relayState);
    const conversationListItems = buildRelayConversationItems(relayState);
    const availableDestinations = [
      ...conversationFeedItems.map((item) => `${item.kind}:${item.id}`),
      ...conversationListItems.map((item) => `${item.kind}:${item.id}`),
      ...relayState.directs.map((item) => `${item.kind}:${item.id}`),
    ];

    const currentKey = `${selectedConversationKind}:${selectedConversationId}`;
    if (!availableDestinations.includes(currentKey)) {
      setSelectedConversationKind("channel");
      setSelectedConversationId("shared");
    }
  }, [relayState, selectedConversationId, selectedConversationKind]);

  React.useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) {
      return;
    }

    const maxHeight = 120;
    textarea.style.height = "0px";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [composerDraft]);

  React.useEffect(() => {
    if ((activeView !== "relay" && activeView !== "messages") || pendingComposerFocusTick === 0) {
      return;
    }

    const target = composerRef.current;
    if (!target) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      target.focus();
      const end = target.value.length;
      target.setSelectionRange?.(end, end);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [activeView, pendingComposerFocusTick]);

  React.useEffect(() => {
    if (!replyTarget) {
      return;
    }

    if (selectedConversationKind !== "direct" || selectedConversationId !== replyTarget.authorId) {
      setReplyTarget(null);
    }
  }, [replyTarget, selectedConversationId, selectedConversationKind]);

  React.useEffect(() => {
    if (!relayState?.messages.length) {
      return;
    }

    const confirmedClientIds = new Set(
      relayState.messages
        .map((message) => message.clientMessageId)
        .filter((messageId): messageId is string => Boolean(messageId)),
    );
    if (!confirmedClientIds.size) {
      return;
    }

    setPendingMessages((current) => current.filter((entry) => !confirmedClientIds.has(entry.clientMessageId)));
  }, [relayState]);

  const conversationFeedItems = React.useMemo(
    () => buildRelayFeedItems(relayState).filter((item) => voiceEnabled || !(item.kind === "channel" && item.id === "voice")),
    [relayState, voiceEnabled],
  );
  const selectedDirectConversation = relayState && selectedConversationKind === "direct"
    ? relayState.directs.find((item) => item.id === selectedConversationId) ?? null
    : null;
  const currentConversation = relayState
    ? resolveRelayDestination(relayState, conversationFeedItems, selectedConversationKind, selectedConversationId)
    : null;
  const mergedConversationMessages = React.useMemo(
    () => {
      const brokerMessages = relayState?.messages ?? [];
      if (!pendingMessages.length) {
        return brokerMessages;
      }

      const confirmedClientIds = new Set(
        brokerMessages
          .map((message) => message.clientMessageId)
          .filter((messageId): messageId is string => Boolean(messageId)),
      );
      const optimisticMessages = pendingMessages
        .filter((entry) => !confirmedClientIds.has(entry.clientMessageId))
        .map((entry) => entry.message);

      if (!optimisticMessages.length) {
        return brokerMessages;
      }

      return [...brokerMessages, ...optimisticMessages].sort(
        (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
      );
    },
    [pendingMessages, relayState],
  );
  const visibleConversationMessages = React.useMemo(
    () => filterRelayMessages(mergedConversationMessages, selectedConversationKind, selectedConversationId),
    [mergedConversationMessages, selectedConversationId, selectedConversationKind],
  );
  const messageLookup = React.useMemo(
    () => new Map(mergedConversationMessages.map((message) => [message.id, message])),
    [mergedConversationMessages],
  );
  const contextReferences = React.useMemo<ComposerRelayReference[]>(
    () => contextMessageIds
      .map((messageId) => messageLookup.get(messageId))
      .filter((message): message is RelayMessage => Boolean(message))
      .map((message) => ({
        messageId: message.id,
        authorName: message.authorName,
        preview: messagePreviewSnippet(message.body, 96),
      })),
    [contextMessageIds, messageLookup],
  );
  const currentConversationTitle = cleanDisplayTitle(currentConversation?.title ?? "# shared-channel");
  const currentConversationSubtitle = selectedDirectConversation
    ? relaySecondaryText(selectedDirectConversation)
    : currentConversation?.subtitle ?? null;
  const currentConversationCount = currentConversation && "count" in currentConversation && currentConversation.count > 0
    ? currentConversation.count
    : null;
  const lastVisibleConversationMessage = visibleConversationMessages.at(-1) ?? null;
  const mentionCandidates = React.useMemo(
    () => interAgentAgents
      .flatMap((agent): RelayMentionCandidate[] => {
        const mentionToken = agent.selector ?? agent.defaultSelector;
        if (!mentionToken) {
          return [];
        }

        return [{
          agentId: agent.id,
          title: agent.title,
          subtitle: agent.projectRoot ?? agent.cwd ?? agent.subtitle ?? null,
          mentionToken,
          definitionId: agent.definitionId,
          workspaceQualifier: agent.workspaceQualifier,
          branch: agent.branch,
          harness: agent.harness,
          state: agent.state,
          statusLabel: agent.statusLabel,
          searchText: [
            agent.title,
            agent.id,
            agent.definitionId ?? "",
            mentionToken,
            agent.selector ?? "",
            agent.defaultSelector ?? "",
            agent.workspaceQualifier ?? "",
            agent.branch ?? "",
            agent.harness ?? "",
            agent.projectRoot ?? "",
            agent.cwd ?? "",
          ].join(" ").toLowerCase(),
        }];
      })
      .sort((left, right) => left.title.localeCompare(right.title)),
    [interAgentAgents],
  );

  React.useEffect(() => {
    setTimelinePinnedToBottom(true);
    const viewport = timelineViewportRef.current;
    if (!viewport) {
      return;
    }

    window.requestAnimationFrame(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
    });
  }, [selectedConversationId, selectedConversationKind]);

  React.useEffect(() => {
    if (!timelinePinnedToBottom) {
      return;
    }

    const viewport = timelineViewportRef.current;
    if (!viewport) {
      return;
    }

    window.requestAnimationFrame(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    });
  }, [
    lastVisibleConversationMessage?.body,
    lastVisibleConversationMessage?.id,
    lastVisibleConversationMessage?.receipt?.state,
    selectedDirectConversation?.activeTask,
    selectedDirectConversation?.state,
    timelinePinnedToBottom,
  ]);

  const handleConversationTimelineScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setTimelinePinnedToBottom(distanceFromBottom <= 48);
  }, []);

  const activeMention = React.useMemo(
    () => findActiveRelayMention(composerDraft, composerSelectionStart),
    [composerDraft, composerSelectionStart],
  );
  const mentionSuggestions = React.useMemo(
    () => {
      if (!activeMention) {
        return [];
      }

      const selectedDirectAgentId = selectedConversationKind === "direct" ? selectedConversationId : null;
      return mentionCandidates
        .map((candidate) => ({
          candidate,
          score: scoreRelayMentionCandidate(candidate, activeMention.query, selectedDirectAgentId),
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => (
          right.score - left.score
          || left.candidate.title.localeCompare(right.candidate.title)
        ))
        .slice(0, 8)
        .map(({ candidate }) => candidate);
    },
    [activeMention, mentionCandidates, selectedConversationId, selectedConversationKind],
  );
  const mentionDuplicateTitleCounts = React.useMemo(
    () => mentionCandidates.reduce((map, candidate) => {
      map.set(candidate.title, (map.get(candidate.title) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
    [mentionCandidates],
  );
  const mentionMenuOpen = mentionSuggestions.length > 0;

  React.useEffect(() => {
    if (!mentionMenuOpen) {
      setMentionSelectionIndex(0);
      return;
    }

    setMentionSelectionIndex((current) => Math.min(current, mentionSuggestions.length - 1));
  }, [mentionMenuOpen, mentionSuggestions.length]);

  const selectedMessagesInternalMessages = React.useMemo(
    () => {
      if (!selectedMessagesInternalThread) {
        return [];
      }

      const messageIds = new Set(selectedMessagesInternalThread.messageIds);
      return mergedConversationMessages.filter((message) => messageIds.has(message.id));
    },
    [mergedConversationMessages, selectedMessagesInternalThread],
  );
  const selectedMessagesDetailAgent = selectedMessagesDetailAgentId
    ? interAgentAgents.find((agent) => agent.id === selectedMessagesDetailAgentId) ?? null
    : null;
  const selectedMessagesSessions = React.useMemo(
    () => {
      if (selectedMessagesDetailAgent) {
        return sessions.filter((session) => (
          session.project === selectedMessagesDetailAgent.id
          || session.agent === selectedMessagesDetailAgent.title
        ));
      }

      if (selectedMessagesInternalThread) {
        const participantIds = new Set(selectedMessagesInternalThread.participants.map((participant) => participant.id));
        const participantTitles = new Set(selectedMessagesInternalThread.participants.map((participant) => participant.title));
        return sessions.filter((session) => participantIds.has(session.project) || participantTitles.has(session.agent));
      }

      if (selectedMessagesThread?.relayDestinationKind === "channel" && selectedMessagesThread.relayDestinationId) {
        return sessions.filter((session) => session.tags?.includes(selectedMessagesThread.relayDestinationId ?? "") ?? false);
      }

      return sessions.slice(0, 8);
    },
    [selectedMessagesDetailAgent, selectedMessagesInternalThread, selectedMessagesThread, sessions],
  );

  const openConversation = React.useCallback((kind: RelayDestinationKind, id: string) => {
    setSelectedConversationKind(kind);
    setSelectedConversationId(id);
    setSelectedMessageThreadId(
      messagesState?.threads.find((thread) => (
        thread.relayDestinationKind === kind
        && thread.relayDestinationId === id
      ))?.id ?? null,
    );
    setActiveView("messages");
  }, [messagesState, setActiveView]);

  const applyMentionSuggestion = React.useCallback((candidate: RelayMentionCandidate) => {
    if (!activeMention) {
      return;
    }

    const suffix = composerDraft.slice(activeMention.end);
    const trailingSpace = suffix.startsWith(" ") || suffix.length === 0 ? "" : " ";
    const nextDraft = `${composerDraft.slice(0, activeMention.start)}${candidate.mentionToken}${trailingSpace}${suffix}`;
    const nextCursor = activeMention.start + candidate.mentionToken.length + trailingSpace.length;

    setComposerDraft(nextDraft);
    setComposerSelectionStart(nextCursor);
    setMentionSelectionIndex(0);

    window.requestAnimationFrame(() => {
      const textarea = composerRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, [activeMention, composerDraft]);

  const sendMessage = React.useCallback(async () => {
    const body = composerDraft.trim();
    if (!body || composerSending || !scoutDesktop?.sendRelayMessage) {
      return;
    }

    const previousDraft = composerDraft;
    const previousReplyTarget = replyTarget;
    const previousContextMessageIds = contextMessageIds;
    const clientMessageId = generateClientMessageId();
    const effectiveReplyToMessageId = replyTarget?.messageId ?? contextMessageIds[0] ?? null;
    const optimisticMessage = buildOptimisticRelayMessage({
      relayState,
      appSettings,
      destinationKind: selectedConversationKind,
      destinationId: selectedConversationId,
      body,
      replyToMessageId: effectiveReplyToMessageId,
      clientMessageId,
    });

    setComposerSending(true);
    setMessagesFeedback("Sending…");
    setPendingMessages((current) => [...current, { clientMessageId, message: optimisticMessage }]);
    setComposerDraft("");
    setReplyTarget(null);
    setContextMessageIds([]);

    try {
      const nextState = await scoutDesktop.sendRelayMessage({
        destinationKind: selectedConversationKind,
        destinationId: selectedConversationId,
        body,
        replyToMessageId: effectiveReplyToMessageId,
        referenceMessageIds: contextMessageIds,
        clientMessageId,
      });
      applyRelayWorkspacePatch(nextState);
      setPendingMessages((current) => current.map((entry) => (
        entry.clientMessageId === clientMessageId
          ? {
              ...entry,
              message: {
                ...entry.message,
                receipt: entry.message.receipt
                  ? { ...entry.message.receipt, label: "Sent", detail: null }
                  : { state: "sent", label: "Sent", detail: null },
              },
            }
          : entry
      )));
      setMessagesFeedback("Sent.");
    } catch (error) {
      setPendingMessages((current) => current.filter((entry) => entry.clientMessageId !== clientMessageId));
      setComposerDraft(previousDraft);
      setReplyTarget(previousReplyTarget);
      setContextMessageIds(previousContextMessageIds);
      setMessagesFeedback(asErrorMessage(error));
    } finally {
      setComposerSending(false);
    }
  }, [
    appSettings,
    composerDraft,
    composerSending,
    contextMessageIds,
    relayState,
    replyTarget,
    scoutDesktop,
    selectedConversationId,
    selectedConversationKind,
    applyRelayWorkspacePatch,
  ]);

  const openDirectConversation = React.useCallback((
    agentId: string,
    options?: {
      replyToMessage?: RelayMessage | null;
      draft?: string | null;
      focusComposer?: boolean;
    },
  ) => {
    openConversation("direct", agentId);
    setContextMessageIds([]);
    setReplyTarget(options?.replyToMessage ? {
      messageId: options.replyToMessage.id,
      authorId: options.replyToMessage.authorId,
      authorName: options.replyToMessage.authorName,
      preview: messagePreviewSnippet(options.replyToMessage.body, 96),
    } : null);
    if (typeof options?.draft === "string") {
      setComposerDraft(options.draft);
    }
    if (options?.focusComposer) {
      setPendingComposerFocusTick((current) => current + 1);
    }
  }, [openConversation]);

  const nudgeMessage = React.useCallback((message: RelayMessage) => {
    if (message.isOperator) {
      return;
    }

    openDirectConversation(message.authorId, {
      replyToMessage: message,
      draft: "Following up on this.",
      focusComposer: true,
    });
    setMessagesFeedback(`Drafting a follow-up to ${message.authorName}.`);
  }, [openDirectConversation]);

  const openAgentDirectMessage = React.useCallback((agentId: string, draft?: string | null) => {
    openDirectConversation(agentId, {
      draft: draft ?? null,
      focusComposer: true,
    });
  }, [openDirectConversation]);

  return {
    selectedConversationKind,
    setSelectedConversationKind,
    selectedConversationId,
    setSelectedConversationId,
    selectedMessageThreadId,
    setSelectedMessageThreadId,
    selectedMessagesThread,
    selectedMessagesInternalThread,
    selectedMessagesInternalTarget,
    selectedMessagesDetailAgentId,
    selectedMessagesDetailAgent,
    selectedMessagesInternalMessages,
    selectedMessagesSessions,
    composerDraft,
    setComposerDraft,
    composerSending,
    composerSelectionStart,
    setComposerSelectionStart,
    mentionSelectionIndex,
    setMentionSelectionIndex,
    messagesFeedback,
    setMessagesFeedback,
    replyTarget,
    setReplyTarget,
    contextMessageIds,
    setContextMessageIds,
    composerRef,
    timelineViewportRef,
    mergedConversationMessages,
    visibleConversationMessages,
    currentConversationTitle,
    currentConversationSubtitle,
    currentConversationCount,
    selectedDirectConversation,
    contextReferences,
    mentionMenuOpen,
    mentionSuggestions,
    mentionDuplicateTitleCounts,
    handleConversationTimelineScroll,
    openConversation,
    applyMentionSuggestion,
    sendMessage,
    openDirectConversation,
    nudgeMessage,
    openAgentDirectMessage,
    messageThreads,
  };
}
