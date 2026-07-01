import type {
  ActorKind,
  AgentDefinition,
  AgentEndpoint,
  ConversationKind,
  FlightRecord,
  InvocationRequest,
  MessageRecord,
} from "@openscout/protocol";
import { channelNaturalKeyFromMetadata, epochMs, isOpaqueChannelId } from "@openscout/protocol";
import { configuredOperatorActorIds } from "@openscout/runtime/conversations/legacy-ids";

import {
  loadScoutBrokerContext,
  type ScoutBrokerSnapshot,
} from "../broker/service.ts";

export type ScoutConversationListFilters = {
  query?: string;
  limit?: number;
  kinds?: ConversationKind[];
  conversationId?: string;
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

export type ScoutConversationParticipant = {
  actorId: string;
  kind: string;
  displayName: string;
  label: string;
  scopedAlias: string | null;
  agentId: string | null;
  sessionId: string | null;
  harness: string | null;
  transport: string | null;
  workspaceRoot: string | null;
};

export type ScoutConversationSummary = {
  id: string;
  chatId: string;
  kind: string;
  title: string;
  alias?: string | null;
  naturalKey?: string | null;
  participantIds: string[];
  participants: ScoutConversationParticipant[];
  authorityNodeId: string | null;
  authorityNodeName: string | null;
  agentId: string | null;
  agentName: string | null;
  harness: string | null;
  sessionId: string | null;
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

const SCOPED_ALIAS_POOL = [
  "Curie",
  "Dewey",
  "Turing",
  "Noether",
  "Lovelace",
  "Hopper",
  "Franklin",
  "Faraday",
  "Tesla",
  "Newton",
  "Darwin",
  "Ada",
  "Sagan",
  "Feynman",
  "Bohr",
  "Kepler",
];

function normalizeTimestamp(value: number | null | undefined): number | null {
  const ms = epochMs(value);
  return ms === null ? null : Math.floor(ms / 1000);
}

function normalizeTimestampMs(value: number | null | undefined): number | null {
  return epochMs(value);
}

function normalizeMetadataTimestamp(value: unknown): number {
  const ms = epochMs(value);
  return ms === null ? 0 : Math.floor(ms / 1000);
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

function metadataObject(
  metadata: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = metadata?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function metadataSessionId(metadata: Record<string, unknown> | undefined): string | null {
  return metadataString(metadata, "targetSessionId")
    ?? metadataString(metadata, "responderSessionId")
    ?? metadataString(metadata, "sessionId")
    ?? metadataString(metadata, "externalSessionId")
    ?? metadataString(metadata, "threadId")
    ?? metadataString(metadataObject(metadata, "returnAddress"), "sessionId");
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

function metadataHasValue(
  metadata: Record<string, unknown> | undefined,
  key: string,
): boolean {
  const value = metadata?.[key];
  if (value == null) return false;
  return typeof value !== "string" || value.trim().length > 0;
}

function isFailedCardlessLaunchStub(endpoint: AgentEndpoint | null): boolean {
  if (!endpoint || endpoint.state !== "offline") return false;
  const metadata = endpoint.metadata;
  const hasSession = Boolean(endpoint.sessionId?.trim())
    || Boolean(metadataString(metadata, "externalSessionId"))
    || Boolean(metadataString(metadata, "threadId"));
  return metadataBoolean(metadata, "cardless")
    && metadataBoolean(metadata, "pendingExternalSession")
    && !hasSession
    && (
      metadataHasValue(metadata, "lastError")
      || metadataHasValue(metadata, "lastFailedAt")
    );
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

function invocationsByConversation(snapshot: ScoutBrokerSnapshot): Map<string, InvocationRequest[]> {
  const buckets = new Map<string, InvocationRequest[]>();
  for (const invocation of Object.values(snapshot.invocations ?? {})) {
    if (!invocation.conversationId) continue;
    const next = buckets.get(invocation.conversationId) ?? [];
    next.push(invocation);
    buckets.set(invocation.conversationId, next);
  }
  for (const invocations of buckets.values()) {
    invocations.sort((left, right) =>
      (normalizeTimestampMs(left.createdAt) ?? 0) - (normalizeTimestampMs(right.createdAt) ?? 0)
    );
  }
  return buckets;
}

function flightsByConversation(
  snapshot: ScoutBrokerSnapshot,
  invocationById: Map<string, InvocationRequest>,
): Map<string, FlightRecord[]> {
  const buckets = new Map<string, FlightRecord[]>();
  for (const flight of Object.values(snapshot.flights ?? {})) {
    const invocation = invocationById.get(flight.invocationId);
    if (!invocation?.conversationId) continue;
    const next = buckets.get(invocation.conversationId) ?? [];
    next.push(flight);
    buckets.set(invocation.conversationId, next);
  }
  for (const flights of buckets.values()) {
    flights.sort((left, right) =>
      (normalizeTimestampMs(left.completedAt ?? left.startedAt) ?? 0)
        - (normalizeTimestampMs(right.completedAt ?? right.startedAt) ?? 0)
    );
  }
  return buckets;
}

function latestConversationSessionId(input: {
  messages: MessageRecord[];
  invocations: InvocationRequest[];
  flights: FlightRecord[];
}): string | null {
  for (const message of [...input.messages].reverse()) {
    const sessionId = metadataSessionId(message.metadata);
    if (sessionId) return sessionId;
  }
  for (const flight of [...input.flights].reverse()) {
    const sessionId = metadataSessionId(flight.metadata);
    if (sessionId) return sessionId;
  }
  for (const invocation of [...input.invocations].reverse()) {
    const sessionId = invocation.execution?.targetSessionId?.trim()
      || invocation.execution?.forkFromSessionId?.trim()
      || metadataSessionId(invocation.metadata);
    if (sessionId) return sessionId;
  }
  return null;
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

function stableAliasSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function scopedAliasForParticipant(
  scopeId: string,
  participantId: string,
  usedAliases: Set<string>,
): string {
  const seed = stableAliasSeed(`${scopeId}:${participantId}`);
  for (let offset = 0; offset < SCOPED_ALIAS_POOL.length; offset += 1) {
    const alias = SCOPED_ALIAS_POOL[(seed + offset) % SCOPED_ALIAS_POOL.length]!;
    if (!usedAliases.has(alias)) {
      usedAliases.add(alias);
      return alias;
    }
  }
  const fallback = `Agent ${usedAliases.size + 1}`;
  usedAliases.add(fallback);
  return fallback;
}

function cleanParticipantDisplayName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Agent";
  const sessionMatch = trimmed.match(/^(.+?):session\b/iu);
  if (sessionMatch?.[1]) {
    return humanizeWorkspaceName(sessionMatch[1]) ?? titleCaseToken(sessionMatch[1]);
  }
  if (/^session[-_]/iu.test(trimmed)) {
    return "Session";
  }
  return trimmed;
}

function participantEndpoint(
  snapshot: ScoutBrokerSnapshot,
  participantId: string,
): AgentEndpoint | null {
  return endpointForAgent(snapshot, participantId);
}

function participantBaseName(snapshot: ScoutBrokerSnapshot, participantId: string): string {
  if (configuredOperatorActorIds().includes(participantId)) return "Operator";
  if (snapshot.agents[participantId]) {
    return cleanParticipantDisplayName(agentDisplayName(snapshot, participantId));
  }
  return cleanParticipantDisplayName(
    snapshot.actors[participantId]?.displayName
      ?? participantId,
  );
}

function buildScopedParticipants(
  snapshot: ScoutBrokerSnapshot,
  conversationId: string,
  participantIds: string[],
): ScoutConversationParticipant[] {
  const uniqueParticipantIds = [...new Set(participantIds)];
  const bases = new Map<string, string>();
  const baseCounts = new Map<string, number>();
  for (const participantId of uniqueParticipantIds) {
    const base = participantBaseName(snapshot, participantId);
    bases.set(participantId, base);
    const key = base.toLowerCase();
    baseCounts.set(key, (baseCounts.get(key) ?? 0) + 1);
  }

  const usedAliases = new Set<string>();
  const operatorIds = new Set(configuredOperatorActorIds());
  return uniqueParticipantIds.map((participantId) => {
    const actor = snapshot.actors[participantId];
    const agent = snapshot.agents[participantId] ?? null;
    const endpoint = participantEndpoint(snapshot, participantId);
    const kind: ActorKind = actor?.kind ?? agent?.kind ?? "agent";
    const displayName = bases.get(participantId) ?? participantId;
    const scopedAlias = operatorIds.has(participantId)
      ? null
      : scopedAliasForParticipant(conversationId, participantId, usedAliases);
    const duplicateName = (baseCounts.get(displayName.toLowerCase()) ?? 0) > 1;
    const needsScopedLabel = Boolean(scopedAlias)
      && (duplicateName || kind === "session" || agent?.metadata?.cardless === true);
    return {
      actorId: participantId,
      kind,
      displayName,
      label: needsScopedLabel && scopedAlias ? `${displayName} · ${scopedAlias}` : displayName,
      scopedAlias,
      agentId: agent?.id ?? null,
      sessionId: endpoint?.sessionId ?? metadataSessionId(endpoint?.metadata),
      harness: endpoint?.harness ?? null,
      transport: endpoint?.transport ?? null,
      workspaceRoot: endpoint?.projectRoot ?? endpoint?.cwd ?? null,
    };
  });
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
    ...summary.participants.flatMap((participant) => [
      participant.displayName,
      participant.label,
      participant.scopedAlias ?? "",
    ]),
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
    readAt.set(cursor.conversationId, Math.max(prev, normalizeTimestampMs(cursor.lastReadAt) ?? 0));
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

export async function getScoutConversations(
  filters: ScoutConversationListFilters = {},
): Promise<ScoutConversationSummary[]> {
  const broker = await loadScoutBrokerContext();
  if (!broker) {
    return [];
  }

  const snapshot = broker.snapshot;
  const messagesByConversation = latestMessageByConversation(snapshot);
  const invocationsByConversationId = invocationsByConversation(snapshot);
  const invocationById = new Map(Object.values(snapshot.invocations ?? {}).map((invocation) => [invocation.id, invocation]));
  const flightsByConversationId = flightsByConversation(snapshot, invocationById);
  const allowedKinds = new Set(filters.kinds ?? DEFAULT_CONVERSATION_KINDS);
  const query = normalizeQuery(filters.query);
  const operatorIds = new Set(configuredOperatorActorIds());
  const readAtByConversation = operatorReadAtByConversation(snapshot);

  const conversationIdFilter = filters.conversationId?.trim() || null;

  const summaries = Object.values(snapshot.conversations)
    .flatMap((conversation): ScoutConversationSummary[] => {
      if (conversationIdFilter && conversation.id !== conversationIdFilter) {
        return [];
      }

      if (!isOpaqueChannelId(conversation.id)) {
        return [];
      }

      if (!allowedKinds.has(conversation.kind)) {
        return [];
      }

      const messages = messagesByConversation.get(conversation.id) ?? [];
      const invocations = invocationsByConversationId.get(conversation.id) ?? [];
      const flights = flightsByConversationId.get(conversation.id) ?? [];
      const latestMessage = messages.at(-1) ?? null;
      const messageCount = messages.length;
      const sessionId = latestConversationSessionId({ messages, invocations, flights });
      const unreadCount = unreadCountForConversation(
        messages,
        readAtByConversation.get(conversation.id),
        operatorIds,
      );
      const askField = {};
      const participants = buildScopedParticipants(
        snapshot,
        conversation.id,
        conversation.participantIds,
      );

      if (conversation.kind === "direct") {
        const { agentId, agent, endpoint } = directConversationAgent(snapshot, conversation.participantIds);
        if (
          !agentId
          || !agent
          || metadataBoolean(agent.metadata, "retiredFromFleet")
          || isFailedCardlessLaunchStub(endpoint)
          || messageCount === 0
        ) {
          return [];
        }
        const title = agentDisplayName(snapshot, agentId);
        const identityFields = conversationIdentityFields(conversation);
        return [{
          id: conversation.id,
          chatId: conversation.id,
          kind: conversation.kind,
          title,
          ...identityFields,
          participantIds: [...conversation.participantIds],
          participants,
          authorityNodeId: conversation.authorityNodeId ?? null,
          authorityNodeName: snapshot.nodes?.[conversation.authorityNodeId]?.name ?? null,
          agentId,
          agentName: title,
          harness: endpoint?.harness ?? null,
          sessionId,
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
        chatId: conversation.id,
        kind: conversation.kind,
        title: conversation.title,
        ...identityFields,
        participantIds: [...conversation.participantIds],
        participants,
        authorityNodeId: conversation.authorityNodeId ?? null,
        authorityNodeName: snapshot.nodes?.[conversation.authorityNodeId]?.name ?? null,
        agentId: null,
        agentName: null,
        harness: null,
        sessionId,
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

export async function getScoutConversationById(
  conversationId: string,
): Promise<ScoutConversationSummary | null> {
  const normalizedId = conversationId.trim();
  if (!normalizedId || !isOpaqueChannelId(normalizedId)) {
    return null;
  }
  const matches = await getScoutConversations({ conversationId: normalizedId, limit: 1 });
  return matches[0] ?? null;
}
