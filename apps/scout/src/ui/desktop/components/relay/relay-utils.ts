import type { CSSProperties } from "react";
import { C } from "@/lib/theme";
import type {
  AgentConfigState,
  AppSettingsState,
  DesktopShellState,
  InterAgentAgent,
  InterAgentThread,
  RelayDestinationKind,
  RelayDirectThread,
  RelayMessage,
  RelayNavItem,
} from "@/lib/scout-desktop";
import type {
  AgentRosterFilterMode,
  AgentRosterSortMode,
  RelayActiveMention,
  RelayMentionCandidate,
} from "@/components/relay/relay-types";

export function firstInterAgentThreadIdForAgent(threads: InterAgentThread[], agentId: string) {
  return threads.find((thread) => thread.participants.some((participant) => participant.id === agentId))?.id ?? null;
}

export function interAgentCounterparts(thread: InterAgentThread, perspectiveId: string | null) {
  const others = perspectiveId
    ? thread.participants.filter((participant) => participant.id !== perspectiveId)
    : thread.participants;
  return others.length > 0 ? others : thread.participants;
}

export function interAgentThreadTitleForAgent(thread: InterAgentThread, perspectiveId: string | null) {
  return interAgentCounterparts(thread, perspectiveId).map((participant) => participant.title).join(", ");
}

export function interAgentThreadSubtitle(thread: InterAgentThread, perspectiveId: string | null) {
  const sourceLabel = thread.sourceKind === "private" ? "Private thread" : "Targeted relay traffic";
  const participantLine = thread.participants.map((participant) => participant.title).join(" ↔ ");
  if (!perspectiveId) {
    return `${sourceLabel} · ${participantLine}`;
  }

  const others = interAgentCounterparts(thread, perspectiveId).map((participant) => participant.title).join(", ");
  return thread.latestAuthorName
    ? `${sourceLabel} · ${others} · Last from ${thread.latestAuthorName}`
    : `${sourceLabel} · ${participantLine}`;
}

export function agentThreadFollowUpDraft(thread: InterAgentThread, perspectiveId: string | null) {
  const others = interAgentCounterparts(thread, perspectiveId).map((participant) => participant.title).join(", ");
  return others
    ? `Can you catch me up on your thread with ${others}?`
    : "Can you catch me up on this thread?";
}

export function interAgentProfileKindLabel(profileKind: InterAgentAgent["profileKind"]) {
  if (profileKind === "project") {
    return "Relay Agent";
  }
  if (profileKind === "system") {
    return "System";
  }
  return "Built-in Role";
}

export function agentRosterFilterLabel(mode: AgentRosterFilterMode) {
  return mode === "active" ? "active" : "all";
}

export function agentRosterSortLabel(mode: AgentRosterSortMode) {
  if (mode === "code") {
    return "code";
  }
  if (mode === "session") {
    return "session";
  }
  if (mode === "alpha") {
    return "a-z";
  }
  return "chat";
}

export function isAgentRosterActive(agent: InterAgentAgent) {
  return agent.threadCount > 0
    || agent.reachable
    || Boolean(agent.lastChatAt || agent.lastCodeChangeAt || agent.lastSessionAt);
}

export function agentRosterTimestamp(agent: InterAgentAgent, mode: AgentRosterSortMode) {
  if (mode === "code") {
    return agent.lastCodeChangeAt ?? 0;
  }
  if (mode === "session") {
    return agent.lastSessionAt ?? 0;
  }
  return agent.lastChatAt ?? 0;
}

export function compareAgentRoster(lhs: InterAgentAgent, rhs: InterAgentAgent, mode: AgentRosterSortMode) {
  if (mode === "alpha") {
    return lhs.title.localeCompare(rhs.title);
  }

  const delta = agentRosterTimestamp(rhs, mode) - agentRosterTimestamp(lhs, mode);
  if (delta !== 0) {
    return delta;
  }

  return rhs.threadCount - lhs.threadCount || lhs.title.localeCompare(rhs.title);
}

export function agentRosterSecondaryText(agent: InterAgentAgent, mode: AgentRosterSortMode) {
  if (mode === "chat" && agent.lastChatLabel) {
    return `${agent.subtitle} · chat ${agent.lastChatLabel}`;
  }
  if (mode === "code" && agent.lastCodeChangeLabel) {
    return `${agent.subtitle} · code ${agent.lastCodeChangeLabel}`;
  }
  if (mode === "session" && agent.lastSessionLabel) {
    return `${agent.subtitle} · session ${agent.lastSessionLabel}`;
  }
  return agent.subtitle;
}

export function normalizeDraftText(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

export function serializeEditableAgentConfig(config: AgentConfigState | null) {
  if (!config) {
    return "";
  }

  return JSON.stringify({
    cwd: normalizeDraftText(config.runtime.cwd),
    harness: config.runtime.harness,
    sessionId: normalizeDraftText(config.runtime.sessionId),
    systemPrompt: normalizeDraftText(config.systemPrompt),
    launchArgsText: normalizeDraftText(config.toolUse.launchArgsText),
    capabilitiesText: normalizeDraftText(config.capabilitiesText),
  });
}

export function serializeAppSettings(settings: AppSettingsState | null) {
  if (!settings) {
    return "";
  }

  return JSON.stringify({
    operatorName: normalizeDraftText(settings.operatorName),
    onboardingContextRoot: normalizeDraftText(settings.onboardingContextRoot),
    workspaceRoots: settings.workspaceRoots.map((entry) => normalizeDraftText(entry)),
    includeCurrentRepo: settings.includeCurrentRepo,
    defaultHarness: settings.defaultHarness,
    defaultCapabilities: settings.defaultCapabilities.map((entry) => normalizeDraftText(entry)),
    sessionPrefix: normalizeDraftText(settings.sessionPrefix),
    telegram: {
      enabled: settings.telegram.enabled,
      mode: settings.telegram.mode,
      botToken: normalizeDraftText(settings.telegram.botToken),
      secretToken: normalizeDraftText(settings.telegram.secretToken),
      apiBaseUrl: normalizeDraftText(settings.telegram.apiBaseUrl),
      userName: normalizeDraftText(settings.telegram.userName),
      defaultConversationId: normalizeDraftText(settings.telegram.defaultConversationId),
      ownerNodeId: normalizeDraftText(settings.telegram.ownerNodeId),
    },
  });
}

export function parseCapabilityText(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/g)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeLegacyAgentCopy(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value;
}

export function compactHomePath(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^\/home\/[^/]+/, "~");
}

export function shouldRenderRole(role: string | null) {
  if (!role) {
    return false;
  }
  return role.trim().toLowerCase() !== "operator";
}

export function relaySecondaryText(thread: RelayDirectThread) {
  if (thread.state === "working") {
    return thread.activeTask ?? thread.statusDetail ?? thread.subtitle;
  }

  if (thread.statusDetail) {
    return `${thread.subtitle} · ${thread.statusDetail}`;
  }

  return thread.subtitle;
}

export function relayPresenceDotClass(state: RelayDirectThread["state"]) {
  if (state === "working") {
    return "bg-[var(--os-accent)] os-presence-pulse";
  }
  if (state === "available") {
    return "bg-emerald-500";
  }
  return "bg-zinc-400/50";
}

export function relayPresencePillStyle(state: RelayDirectThread["state"]): CSSProperties {
  if (state === "working") {
    return {
      borderColor: "rgba(0,102,255,0.2)",
      backgroundColor: "rgba(0,102,255,0.08)",
      color: "var(--os-accent)",
    };
  }

  if (state === "available") {
    return {
      borderColor: "rgba(16,185,129,0.18)",
      backgroundColor: "rgba(16,185,129,0.08)",
      color: "#059669",
    };
  }

  return {
    borderColor: "var(--os-border)",
    backgroundColor: "var(--os-tag-bg)",
    color: "var(--os-muted)",
  };
}

export function relayPresenceIndicatorLabel(state: RelayDirectThread["state"]) {
  return state === "offline" ? "Off" : "On";
}

export function relayReceiptTone(state: NonNullable<RelayMessage["receipt"]>["state"]) {
  switch (state) {
    case "replied":
      return { color: "#059669" };
    case "working":
      return { color: "var(--os-accent)" };
    case "seen":
      return { color: "var(--os-accent)" };
    case "delivered":
      return { color: "#64748b" };
    case "sent":
    default:
      return { color: "var(--os-muted)" };
  }
}

export function canInlineRelayReceipt(body: string) {
  const trimmed = body.trim();
  if (!trimmed || trimmed.includes("\n")) {
    return false;
  }

  if (/```|`|\[[^\]]+\]\([^)]+\)|^>\s|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\|/.test(trimmed)) {
    return false;
  }

  return true;
}

export function isRelaySharedConversationMessage(message: RelayMessage) {
  return (
    !message.isDirectConversation &&
    !message.isSystem &&
    !message.isVoice &&
    message.messageClass !== "status" &&
    (!message.normalizedChannel || message.normalizedChannel === "shared")
  );
}

export function isRelaySystemMessage(message: RelayMessage) {
  return message.isSystem;
}

export function isRelayVoiceMessage(message: RelayMessage) {
  return message.isVoice;
}

export function isRelayAllTrafficMessage(message: RelayMessage) {
  return !message.isVoice;
}

export function isRelayCoordinationMessage(message: RelayMessage) {
  return (
    !message.isVoice &&
    !message.isSystem &&
    (message.isDirectConversation || message.recipients.length > 0 || message.messageClass === "status")
  );
}

export function isRelayMentionMessage(message: RelayMessage) {
  return (
    !message.isDirectConversation &&
    !message.isSystem &&
    !message.isVoice &&
    message.messageClass !== "status" &&
    message.recipients.length > 0
  );
}

export function relayMessageCount(messages: RelayMessage[], predicate: (message: RelayMessage) => boolean) {
  return messages.filter(predicate).length;
}

export function buildRelayFeedItems(relayState: DesktopShellState["relay"] | null): RelayNavItem[] {
  if (!relayState) {
    return [];
  }

  const viewById = new Map(relayState.views.map((item) => [item.id, item]));
  const channelById = new Map(relayState.channels.map((item) => [item.id, item]));

  return [
    viewById.get("all-traffic") ?? {
      kind: "filter",
      id: "all-traffic",
      title: "All Traffic",
      subtitle: "Every non-voice message across the workspace.",
      count: relayMessageCount(relayState.messages, isRelayAllTrafficMessage),
    },
    viewById.get("coordination") ?? {
      kind: "filter",
      id: "coordination",
      title: "Coordination",
      subtitle: "Targeted messages, direct threads, and task handoffs.",
      count: relayMessageCount(relayState.messages, isRelayCoordinationMessage),
    },
    viewById.get("mentions") ?? {
      kind: "filter",
      id: "mentions",
      title: "Mentions",
      subtitle: "Focused view over shared-channel targeted messages.",
      count: relayMessageCount(relayState.messages, isRelayMentionMessage),
    },
    channelById.get("system") ?? {
      kind: "channel",
      id: "system",
      title: "# system",
      subtitle: "Infrastructure, lifecycle, and broker state events.",
      count: relayMessageCount(relayState.messages, isRelaySystemMessage),
    },
    channelById.get("voice") ?? {
      kind: "channel",
      id: "voice",
      title: "# voice",
      subtitle: "Voice-related chat, transcripts, and spoken updates.",
      count: relayMessageCount(relayState.messages, isRelayVoiceMessage),
    },
  ];
}

export function buildRelayConversationItems(relayState: DesktopShellState["relay"] | null): RelayNavItem[] {
  if (!relayState) {
    return [];
  }

  const sharedChannel = relayState.channels.find((item) => item.id === "shared");
  return [
    sharedChannel ?? {
      kind: "channel",
      id: "shared",
      title: "# shared-channel",
      subtitle: "Broadcast updates and shared context.",
      count: relayMessageCount(relayState.messages, isRelaySharedConversationMessage),
    },
  ];
}

export function resolveRelayDestination(
  relayState: DesktopShellState["relay"],
  feedItems: RelayNavItem[],
  kind: RelayDestinationKind,
  id: string,
) {
  if (kind === "channel") {
    return relayState.channels.find((item) => item.id === id) ?? null;
  }
  if (kind === "filter") {
    return feedItems.find((item) => item.id === id) ?? null;
  }
  return relayState.directs.find((item) => item.id === id) ?? null;
}

export function filterRelayMessages(messages: RelayMessage[], kind: RelayDestinationKind, id: string) {
  if (kind === "direct") {
    return messages.filter(
      (message) =>
        message.isDirectConversation &&
        (message.authorId === id || message.recipients.includes(id)),
    );
  }

  if (kind === "filter" && id === "all-traffic") {
    return messages.filter(isRelayAllTrafficMessage);
  }

  if (kind === "filter" && id === "coordination") {
    return messages.filter(isRelayCoordinationMessage);
  }

  if (kind === "filter" && id === "mentions") {
    return messages.filter(isRelayMentionMessage);
  }

  if (kind === "channel" && id === "voice") {
    return messages.filter(isRelayVoiceMessage);
  }

  if (kind === "channel" && id === "system") {
    return messages.filter(isRelaySystemMessage);
  }

  return messages.filter(isRelaySharedConversationMessage);
}

export function placeholderForDestination(kind: RelayDestinationKind, id: string) {
  if (kind === "direct") {
    return "Message direct thread...";
  }
  if (kind === "filter" && id === "coordination") {
    return "Message #shared-channel or @agent...";
  }
  if (kind === "channel" && id === "voice") {
    return "Message #voice...";
  }
  if (kind === "channel" && id === "system") {
    return "Message #system...";
  }
  return "Message #shared-channel...";
}

export function cleanDisplayTitle(title: string) {
  return title.replace(/^[@#]\s*/, "");
}

export function normalizeRelayTimestamp(value: number) {
  return value > 10_000_000_000 ? value : value * 1000;
}

export function formatRelayTimestamp(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(normalizeRelayTimestamp(value)));
}

export function formatRelayDayLabel(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(normalizeRelayTimestamp(value))).toUpperCase();
}

export function formatFooterTime(date: Date) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function colorForIdentity(identity: string) {
  const palette = ["#3b82f6", "#14b8a6", "#fb923c", "#f43f5e", "#8b5cf6", "#10b981"];
  let seed = 0;
  for (const character of identity) {
    seed += character.charCodeAt(0);
  }
  return palette[seed % palette.length];
}

export function resolveOperatorDisplayName(
  relayState: DesktopShellState["relay"] | null,
  appSettings: AppSettingsState | null,
) {
  const configuredName = appSettings?.operatorName?.trim();
  if (configuredName) {
    return configuredName;
  }

  const operatorId = relayState?.operatorId ?? "operator";
  const messages = relayState?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.authorId === operatorId && message.authorName.trim()) {
      return message.authorName.trim();
    }
  }

  return appSettings?.operatorNameDefault ?? "Operator";
}

export function relayMessageMentionRecipients(body: string) {
  const matches = body.match(/@[a-z0-9][\w.-]*(?:@[a-z0-9][\w.-]*)?(?:#[a-z0-9][\w.-]*)?/gi) ?? [];
  return Array.from(new Set(matches.map((match) => match.slice(1))));
}

export function normalizeRelayMentionQuery(value: string) {
  return value.trim().toLowerCase();
}

export function pathLeaf(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.replace(/[\\/]+$/, "");
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? null;
}

export function findActiveRelayMention(text: string, cursor: number): RelayActiveMention | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  let start = safeCursor - 1;

  while (start >= 0 && /[\w.@#-]/.test(text[start] ?? "")) {
    start -= 1;
  }

  const mentionStart = start + 1;
  if (text[mentionStart] !== "@") {
    return null;
  }

  if (start >= 0 && !/[\s([{,]/.test(text[start] ?? "")) {
    return null;
  }

  return {
    start: mentionStart,
    end: safeCursor,
    query: normalizeRelayMentionQuery(text.slice(mentionStart + 1, safeCursor)),
  };
}

export function scoreRelayMentionCandidate(
  candidate: RelayMentionCandidate,
  query: string,
  selectedDirectAgentId: string | null,
): number {
  const normalizedToken = candidate.mentionToken.replace(/^@/, "").toLowerCase();
  const normalizedTitle = candidate.title.toLowerCase();
  const normalizedQuery = normalizeRelayMentionQuery(query);
  let score = 0;

  if (candidate.agentId === selectedDirectAgentId) {
    score += 100;
  }

  if (!normalizedQuery) {
    if (candidate.state === "working") score += 10;
    else if (candidate.state === "available") score += 6;
    return score;
  }

  if (normalizedToken === normalizedQuery) score += 120;
  else if (normalizedToken.startsWith(normalizedQuery)) score += 80;
  else if (normalizedTitle.startsWith(normalizedQuery)) score += 72;
  else if (candidate.searchText.includes(normalizedQuery)) score += 28;

  if (candidate.state === "working") score += 8;
  else if (candidate.state === "available") score += 4;

  return score;
}

export function mentionWorkspaceLabel(candidate: RelayMentionCandidate) {
  return pathLeaf(candidate.subtitle) ?? candidate.workspaceQualifier ?? null;
}

export function mentionWorktreeLabel(candidate: RelayMentionCandidate) {
  const branch = candidate.branch?.trim();
  if (branch && branch !== "HEAD") {
    return branch;
  }
  return candidate.workspaceQualifier?.trim() || null;
}

export function optimisticRelayConversationId(kind: RelayDestinationKind, id: string) {
  if (kind === "direct") {
    if (id === "scout") {
      return "dm.scout.primary";
    }
    return `dm.operator.${id}`;
  }
  if (kind === "channel" && id === "voice") {
    return "channel.voice";
  }
  if (kind === "channel" && id === "system") {
    return "channel.system";
  }
  return "channel.shared";
}

export function normalizedMessageRefKey(messageId: string) {
  return messageId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function messageRefTokenPattern() {
  return /\b(?:message:[a-zA-Z0-9._:-]+|m:[a-z0-9]{4,12})\b/gi;
}

export function arraysEqual(values: string[], other: string[]) {
  if (values.length !== other.length) {
    return false;
  }

  return values.every((value, index) => value === other[index]);
}

export function resolveRelayMessageRefToken(token: string, messages: RelayMessage[]) {
  const normalizedToken = token.trim().toLowerCase();
  if (!normalizedToken) {
    return null;
  }

  if (normalizedToken.startsWith("message:")) {
    const messageId = token.slice(token.indexOf(":") + 1).trim();
    return messages.find((message) => message.id === messageId) ?? null;
  }

  if (!normalizedToken.startsWith("m:")) {
    return null;
  }

  const suffix = normalizedToken.slice(2);
  if (!suffix) {
    return null;
  }

  const matches = messages.filter((message) => normalizedMessageRefKey(message.id).endsWith(suffix));
  return matches.length === 1 ? matches[0] : null;
}

export function stripResolvedRelayRefTokens(body: string, resolvedTokens: string[]) {
  if (resolvedTokens.length === 0) {
    return body;
  }

  const tokenSet = new Set(resolvedTokens.map((token) => token.toLowerCase()));
  const withoutTokens = body.replace(messageRefTokenPattern(), (match) => (
    tokenSet.has(match.toLowerCase()) ? " " : match
  ));

  return withoutTokens
    .split(/\r?\n/g)
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && index < lines.length - 1))
    .join("\n")
    .trim();
}

export function ingestRelayMessageRefs(
  body: string,
  messages: RelayMessage[],
  currentReferenceMessageIds: string[],
) {
  const tokens = body.match(messageRefTokenPattern()) ?? [];
  if (tokens.length === 0) {
    return {
      body,
      nextReferenceMessageIds: currentReferenceMessageIds,
    };
  }

  const nextReferenceMessageIds = [...currentReferenceMessageIds];
  const resolvedTokens: string[] = [];
  for (const token of tokens) {
    const match = resolveRelayMessageRefToken(token, messages);
    if (!match) {
      continue;
    }
    resolvedTokens.push(token);
    if (!nextReferenceMessageIds.includes(match.id)) {
      nextReferenceMessageIds.push(match.id);
    }
  }

  if (resolvedTokens.length === 0) {
    return {
      body,
      nextReferenceMessageIds: currentReferenceMessageIds,
    };
  }

  const cleanedBody = stripResolvedRelayRefTokens(body, resolvedTokens);
  return {
    body: cleanedBody,
    nextReferenceMessageIds: arraysEqual(nextReferenceMessageIds, currentReferenceMessageIds)
      ? currentReferenceMessageIds
      : nextReferenceMessageIds,
  };
}

export function shortMessageRef(messageId: string) {
  const normalized = messageId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const suffix = normalized.slice(-7) || normalized.slice(0, 7) || "message";
  return `m:${suffix}`;
}

export function messageRefSuffix(messageId: string) {
  const normalized = messageId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return normalized.slice(-4) || normalized.slice(0, 4) || "ref";
}

export function stableMessageRef(messageId: string) {
  return `message:${messageId}`;
}

export function messageDomId(messageId: string) {
  return `message-${messageId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function messagePreviewSnippet(body: string, maxLength = 88) {
  const compact = body.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function highlightedMessageStyle(): CSSProperties {
  return {
    color: C.ink,
    backgroundColor: C.accentBg,
    boxShadow: "inset 0 0 0 1px rgba(0,102,255,0.16)",
  };
}

export function asErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Action failed.";
}
