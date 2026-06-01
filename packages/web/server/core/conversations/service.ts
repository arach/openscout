import type {
  AgentDefinition,
  AgentEndpoint,
  ConversationKind,
  MessageRecord,
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

  const summaries = Object.values(snapshot.conversations)
    .flatMap((conversation): ScoutConversationSummary[] => {
      if (!allowedKinds.has(conversation.kind)) {
        return [];
      }

      const messages = messagesByConversation.get(conversation.id) ?? [];
      const latestMessage = messages.at(-1) ?? null;
      const messageCount = messages.length;

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
