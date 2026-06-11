import type {
  AgentDefinition,
  AgentEndpoint,
  ConversationKind,
  MessageRecord,
  UnblockRequestRecord,
} from "@openscout/protocol";
import { channelNaturalKeyFromMetadata } from "@openscout/protocol";
import { configuredOperatorActorIds } from "@openscout/runtime/conversations/legacy-ids";

import {
  loadScoutBrokerContext,
  type ScoutBrokerSnapshot,
} from "../broker/service.ts";

export type ScoutConversationListFilters = {
  query?: string;
  limit?: number;
  kinds?: ConversationKind[];
};

/// Per-conversation ask signal surfaced to the comms list. `state` is "pending"
/// while the originating agent is still blocked on the operator, and "answered"
/// once the most recent ask in this conversation has been resolved. The UI only
/// renders a chip/band while pending — an answered ask is resolved, so a chip
/// there would be noise.
export type ScoutConversationAsk = {
  from: string;
  text: string;
  state: "pending" | "answered";
};

export type ScoutConversationSummary = {
  id: string;
  kind: string;
  title: string;
  alias?: string | null;
  naturalKey?: string | null;
  participantIds: string[];
  authorityNodeId: string | null;
  authorityNodeName: string | null;
  agentId: string | null;
  agentName: string | null;
  harness: string | null;
  currentBranch: string | null;
  preview: string | null;
  messageCount: number;
  lastMessageAt: number | null;
  workspaceRoot: string | null;
  /// Messages the operator has not yet read in this conversation. Always present;
  /// 0 means fully read (or we cannot determine a read position yet).
  unreadCount: number;
  /// Best-effort per-conversation ask, omitted entirely when there is no signal.
  ask?: ScoutConversationAsk;
};

const DEFAULT_CONVERSATION_KINDS: ConversationKind[] = [
  "direct",
  "channel",
  "group_direct",
  "thread",
];

function normalizeTimestamp(value: number | null | undefined): number | null {
  if (!value) return null;
  return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
}

function normalizeTimestampMs(value: number | null | undefined): number | null {
  if (!value) return null;
  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
}

function normalizeMetadataTimestamp(value: unknown): number {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function endpointStateRank(endpoint: AgentEndpoint): number {
  switch (endpoint.state) {
    case "active": return 5;
    case "waiting": return 4;
    case "idle": return 3;
    default: return 0;
  }
}

function endpointActivity(endpoint: AgentEndpoint): number {
  return Math.max(
    normalizeMetadataTimestamp(endpoint.metadata?.lastCompletedAt),
    normalizeMetadataTimestamp(endpoint.metadata?.lastStartedAt),
    normalizeMetadataTimestamp(endpoint.metadata?.lastFailedAt),
    normalizeMetadataTimestamp(endpoint.metadata?.staleAt),
    normalizeMetadataTimestamp(endpoint.metadata?.startedAt),
  );
}

function endpointStartedAt(endpoint: AgentEndpoint): number {
  return Math.max(
    normalizeMetadataTimestamp(endpoint.metadata?.lastStartedAt),
    normalizeMetadataTimestamp(endpoint.metadata?.startedAt),
  );
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function formatChannelAlias(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function conversationAlias(input: {
  id: string;
  kind: string;
  title: string;
  metadata?: Record<string, unknown>;
}): string | null {
  const explicitAlias = metadataString(input.metadata, "alias");
  if (explicitAlias) return explicitAlias;

  const channel = metadataString(input.metadata, "channel");
  if (channel && channel !== "system") {
    return formatChannelAlias(channel);
  }

  if (input.kind === "channel") {
    if (input.id.startsWith("channel.")) {
      return formatChannelAlias(input.id.slice("channel.".length));
    }
    return formatChannelAlias(input.title);
  }

  return null;
}

function conversationIdentityFields(input: {
  id: string;
  kind: string;
  title: string;
  metadata?: Record<string, unknown>;
}): Pick<ScoutConversationSummary, "alias" | "naturalKey"> {
  return {
    alias: conversationAlias(input),
    naturalKey: channelNaturalKeyFromMetadata(input.metadata),
  };
}

function metadataBoolean(
  metadata: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return metadata?.[key] === true;
}

function titleCaseToken(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function humanizeWorkspaceName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const base = trimmed.split("/").at(-1)?.trim() || trimmed;
  if (!base) return null;
  return base
    .split(/[-_]+/g)
    .filter((token) => token.length > 0)
    .map(titleCaseToken)
    .join(" ");
}

function normalizeQuery(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function latestMessageByConversation(snapshot: ScoutBrokerSnapshot): Map<string, MessageRecord[]> {
  const buckets = new Map<string, MessageRecord[]>();
  for (const message of Object.values(snapshot.messages)) {
    const next = buckets.get(message.conversationId) ?? [];
    next.push(message);
    buckets.set(message.conversationId, next);
  }
  for (const messages of buckets.values()) {
    messages.sort((left, right) => (
      (normalizeTimestamp(left.createdAt) ?? 0) - (normalizeTimestamp(right.createdAt) ?? 0)
    ));
  }
  return buckets;
}

function endpointForAgent(snapshot: ScoutBrokerSnapshot, agentId: string): AgentEndpoint | null {
  return Object.values(snapshot.endpoints)
    .filter((endpoint) => endpoint.agentId === agentId)
    .sort((left, right) =>
      endpointStateRank(right) - endpointStateRank(left)
      || endpointStartedAt(right) - endpointStartedAt(left)
      || endpointActivity(right) - endpointActivity(left)
      || right.id.localeCompare(left.id)
    )[0] ?? null;
}

function agentDisplayName(snapshot: ScoutBrokerSnapshot, agentId: string): string {
  const endpoint = endpointForAgent(snapshot, agentId);
  const workspaceTitle = humanizeWorkspaceName(endpoint?.projectRoot ?? endpoint?.cwd ?? null);
  if (workspaceTitle) {
    return workspaceTitle;
  }
  return snapshot.agents[agentId]?.displayName
    ?? snapshot.actors[agentId]?.displayName
    ?? agentId;
}

function directConversationAgent(
  snapshot: ScoutBrokerSnapshot,
  participantIds: string[],
): { agentId: string | null; agent: AgentDefinition | null; endpoint: AgentEndpoint | null } {
  const operatorActorIds = new Set(configuredOperatorActorIds());
  const agentId =
    participantIds.find((participantId) =>
      !operatorActorIds.has(participantId) && Boolean(snapshot.agents[participantId])
    )
    ?? participantIds.find((participantId) => Boolean(snapshot.agents[participantId]))
    ?? participantIds.find((participantId) => !operatorActorIds.has(participantId))
    ?? null;
  const agent = agentId ? snapshot.agents[agentId] ?? null : null;
  const endpoint = agentId ? endpointForAgent(snapshot, agentId) : null;
  return { agentId, agent, endpoint };
}

function includeConversation(
  summary: ScoutConversationSummary,
  query: string,
): boolean {
  if (!query) return true;
  return [
    summary.id,
    summary.kind,
    summary.title,
    summary.agentId ?? "",
    summary.agentName ?? "",
    summary.preview ?? "",
    summary.workspaceRoot ?? "",
    ...summary.participantIds,
  ].some((value) => value.toLowerCase().includes(query));
}

/// The operator's furthest-read timestamp per conversation. Mirrors the proven
/// mobile-comms unread logic (core/mobile/service.ts ~L1218): a conversation can
/// carry several operator-flavored read cursors (canonical "operator" plus the
/// configured name/handle), so we keep the *max* `lastReadAt`. `MessageRecord`
/// has no monotonic `seq`, so — like mobile — we count by `createdAt`, which the
/// broker stamps and the cursor's `lastReadAt` is expressed in.
function operatorReadAtByConversation(snapshot: ScoutBrokerSnapshot): Map<string, number> {
  const operatorIds = new Set(configuredOperatorActorIds());
  const readAt = new Map<string, number>();
  for (const cursor of Object.values(snapshot.readCursors ?? {})) {
    if (!operatorIds.has(cursor.actorId)) continue;
    const prev = readAt.get(cursor.conversationId) ?? 0;
    readAt.set(cursor.conversationId, Math.max(prev, cursor.lastReadAt ?? 0));
  }
  return readAt;
}

/// Count messages newer than the operator's read position that the operator did
/// not author. When the operator has no cursor for the conversation we cannot
/// tell what has been seen, so we return 0 (prefer under- over over-counting, per
/// the data-contract note) rather than flagging the whole history as unread.
function unreadCountForConversation(
  messages: MessageRecord[],
  readAt: number | undefined,
  operatorIds: Set<string>,
): number {
  if (readAt == null || readAt <= 0) return 0;
  let count = 0;
  for (const message of messages) {
    const createdAt = normalizeTimestampMs(message.createdAt) ?? 0;
    if (createdAt > readAt && !operatorIds.has(message.actorId)) {
      count += 1;
    }
  }
  return count;
}

/// Index the most recent "question"-kind unblock request per conversation. These
/// are the broker's record of an agent blocked on the operator (the same records
/// that drive operator-attention), so they are the cleanest per-conversation ask
/// signal available in the snapshot we already hold. Keyed by `conversationId`,
/// newest by `updatedAt` wins so a fresh ask supersedes a resolved one.
function latestQuestionAskByConversation(
  snapshot: ScoutBrokerSnapshot,
): Map<string, UnblockRequestRecord> {
  const latest = new Map<string, UnblockRequestRecord>();
  for (const request of Object.values(snapshot.unblockRequests ?? {})) {
    if (request.kind !== "question") continue;
    const conversationId = request.conversationId;
    if (!conversationId) continue;
    const prev = latest.get(conversationId);
    if (!prev || request.updatedAt > prev.updatedAt) {
      latest.set(conversationId, request);
    }
  }
  return latest;
}

/// Map a question unblock request into the wire `ask`. `state` is "pending" while
/// the request is still active (broker state "open"/"snoozed"), "answered" once it
/// has reached a terminal state. `from` is the asker's display name (the agent /
/// actor that created the request), `text` the ask itself (summary preferred over
/// the shorter title).
function askFromUnblockRequest(
  snapshot: ScoutBrokerSnapshot,
  request: UnblockRequestRecord,
): ScoutConversationAsk | null {
  const text = (request.summary?.trim() || request.title?.trim()) ?? "";
  if (!text) return null;
  const askerId = request.createdById || request.agentId || "";
  const from = (askerId
    && (snapshot.agents[askerId]?.displayName
      ?? snapshot.actors[askerId]?.displayName))
    || askerId
    || "Agent";
  const state: ScoutConversationAsk["state"] =
    request.state === "open" || request.state === "snoozed" ? "pending" : "answered";
  return { from, text, state };
}

export async function getScoutConversations(
  filters: ScoutConversationListFilters = {},
): Promise<ScoutConversationSummary[]> {
  const broker = await loadScoutBrokerContext();
  if (!broker) {
    return [];
  }

  const snapshot = broker.snapshot;
  const messagesByConversation = latestMessageByConversation(snapshot);
  const allowedKinds = new Set(filters.kinds ?? DEFAULT_CONVERSATION_KINDS);
  const query = normalizeQuery(filters.query);
  const operatorIds = new Set(configuredOperatorActorIds());
  const readAtByConversation = operatorReadAtByConversation(snapshot);
  const askByConversation = latestQuestionAskByConversation(snapshot);

  const summaries = Object.values(snapshot.conversations)
    .flatMap((conversation): ScoutConversationSummary[] => {
      if (!allowedKinds.has(conversation.kind)) {
        return [];
      }

      const messages = messagesByConversation.get(conversation.id) ?? [];
      const latestMessage = messages.at(-1) ?? null;
      const messageCount = messages.length;
      const unreadCount = unreadCountForConversation(
        messages,
        readAtByConversation.get(conversation.id),
        operatorIds,
      );
      const askRequest = askByConversation.get(conversation.id);
      const ask = askRequest ? askFromUnblockRequest(snapshot, askRequest) : null;
      const askField = ask ? { ask } : {};

      if (conversation.kind === "direct") {
        const { agentId, agent, endpoint } = directConversationAgent(snapshot, conversation.participantIds);
        if (
          !agentId
          || !agent
          || metadataBoolean(agent.metadata, "retiredFromFleet")
          || messageCount === 0
        ) {
          return [];
        }
        const title = agentDisplayName(snapshot, agentId);
        const identityFields = conversationIdentityFields(conversation);
        return [{
          id: conversation.id,
          kind: conversation.kind,
          title,
          ...identityFields,
          participantIds: [...conversation.participantIds],
          authorityNodeId: conversation.authorityNodeId ?? null,
          authorityNodeName: snapshot.nodes?.[conversation.authorityNodeId]?.name ?? null,
          agentId,
          agentName: title,
          harness: endpoint?.harness ?? null,
          currentBranch:
            metadataString(endpoint?.metadata, "branch")
            ?? metadataString(endpoint?.metadata, "workspaceQualifier")
            ?? metadataString(agent.metadata, "branch")
            ?? metadataString(agent.metadata, "workspaceQualifier"),
          preview: latestMessage?.body ?? null,
          messageCount,
          lastMessageAt: normalizeTimestampMs(latestMessage?.createdAt),
          workspaceRoot: endpoint?.projectRoot ?? endpoint?.cwd ?? null,
          unreadCount,
          ...askField,
        }];
      }

      if (conversation.kind === "channel" || conversation.kind === "group_direct") {
        const visible = messageCount >= 1 || conversation.participantIds.includes("operator");
        if (!visible) {
          return [];
        }
      } else if (conversation.kind === "thread") {
        if (messageCount === 0) {
          return [];
        }
      } else if (conversation.kind === "system") {
        return [];
      }

      const identityFields = conversationIdentityFields(conversation);

      return [{
        id: conversation.id,
        kind: conversation.kind,
        title: conversation.title,
        ...identityFields,
        participantIds: [...conversation.participantIds],
        authorityNodeId: conversation.authorityNodeId ?? null,
        authorityNodeName: snapshot.nodes?.[conversation.authorityNodeId]?.name ?? null,
        agentId: null,
        agentName: null,
        harness: null,
        currentBranch: null,
        preview: latestMessage?.body ?? null,
        messageCount,
        lastMessageAt: normalizeTimestampMs(latestMessage?.createdAt),
        workspaceRoot: null,
        unreadCount,
        ...askField,
      }];
    })
    .filter((summary) => includeConversation(summary, query))
    .sort((left, right) => (
      (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0)
      || right.messageCount - left.messageCount
      || left.title.localeCompare(right.title)
    ));

  const limit = typeof filters.limit === "number" && filters.limit > 0
    ? Math.floor(filters.limit)
    : null;
  return limit ? summaries.slice(0, limit) : summaries;
}
