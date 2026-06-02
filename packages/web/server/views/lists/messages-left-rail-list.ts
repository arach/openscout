import { queryAgents, queryFleet } from "../../db-queries.ts";
import type { WebAgent, WebFleetAsk } from "../../db/types/web.ts";
import { getScoutConversations, type ScoutConversationSummary } from "../../core/conversations/service.ts";
import { buildEntityRefResolver, entityAgentStateRank, normalizeEntityAgentState } from "../../core/entity-refs/entity-ref-resolver.ts";
import type { EntityAgentState, EntityRefs } from "../../core/entity-refs/entity-ref-contract.ts";
import { createListBucket, bucketMapToGroups } from "../../core/lists/list-grouping.ts";
import { compareNumbersDesc, compareStrings, includesListQuery, normalizeListQuery } from "../../core/lists/list-sorting.ts";
import { createListResponse, type ListGroupKind, type ListQuery, type ListResponse } from "../../core/lists/list-contract.ts";

export type MessagesLeftRailFilter = "all" | "dm" | "channel";
export type MessagesLeftRailSort = "recent" | "name" | "unread";

export type MessagesLeftRailRow = {
  id: string;
  conversationId: string;
  title: string;
  name: string;
  sub: string | null;
  unread: boolean;
  tone: EntityAgentState | "channel" | "dm" | "neutral";
  avatarName: string;
  lastMessageAt: number | null;
  refs: EntityRefs;
};

type MessagesLeftRailGroupMeta = {
  latestAt: number | null;
  unreadCount: number;
  totalCount: number;
  tone: EntityAgentState | "channel" | "dm" | "neutral";
};

type LastViewedMap = Record<string, number>;

export async function buildMessagesLeftRailList(input: {
  filter?: string | null;
  sort?: string | null;
  query?: string | null;
  machineId?: string | null;
  lastViewed?: LastViewedMap | null;
} = {}): Promise<ListResponse<MessagesLeftRailRow, MessagesLeftRailGroupMeta>> {
  const filter = normalizeMessagesFilter(input.filter);
  const sort = normalizeMessagesSort(input.sort);
  const query = normalizeListQuery(input.query);
  const machineId = input.machineId?.trim() || null;
  const lastViewed = input.lastViewed ?? {};
  const agents = queryAgents();
  const scopedAgentIds = machineId ? new Set(
    agents
      .filter((agent) => agentMatchesMachine(agent, machineId))
      .map((agent) => agent.id),
  ) : null;
  const resolver = buildEntityRefResolver({ agents });
  const activeAsksByAgent = new Map(
    queryFleet({ limit: 80, activityLimit: 0 }).activeAsks.map((ask) => [ask.agentId, ask]),
  );

  const conversations = (await getScoutConversations())
    .filter((conversation) => conversationMatchesFilter(conversation, filter))
    .filter((conversation) => conversationMatchesMachine(conversation, scopedAgentIds, machineId))
    .filter((conversation) =>
      includesListQuery([
        conversation.title,
        conversation.id,
        conversation.agentId,
        conversation.agentName,
        conversation.preview,
        conversation.workspaceRoot,
      ], query)
    );

  const rows = sortConversationRows(
    conversations.map((conversation) => {
      const refs = resolver.forConversation(conversation);
      return conversationRow(conversation, refs, lastViewed, activeAsksByAgent.get(conversation.agentId ?? ""));
    }),
    sort,
  );
  const groups = buildConversationGroups(rows, sort);

  return createListResponse({
    kind: "messages-left-rail",
    query: {
      group: "project-or-channel",
      sort,
      rowSort: "recent",
      q: input.query ?? null,
      filters: { filter, machineId },
    } satisfies ListQuery,
    groups,
    totalRows: conversations.length,
    counts: {
      unread: rows.filter((row) => row.unread).length,
      direct: rows.filter((row) => row.refs.conversation?.kind === "direct").length,
      shared: rows.filter((row) => isGroupConversationKind(row.refs.conversation?.kind ?? "", row.id)).length,
    },
  });
}

function normalizeMessagesFilter(value: string | null | undefined): MessagesLeftRailFilter {
  return value === "dm" || value === "channel" ? value : "all";
}

function normalizeMessagesSort(value: string | null | undefined): MessagesLeftRailSort {
  return value === "name" || value === "unread" ? value : "recent";
}

function agentMatchesMachine(agent: WebAgent, machineId: string): boolean {
  return agent.authorityNodeId === machineId || agent.homeNodeId === machineId;
}

function conversationMatchesMachine(
  conversation: ScoutConversationSummary,
  scopedAgentIds: Set<string> | null,
  machineId: string | null,
): boolean {
  if (!machineId) return true;
  if (conversation.authorityNodeId === machineId) return true;
  if (!scopedAgentIds) return false;
  if (conversation.agentId && scopedAgentIds.has(conversation.agentId)) return true;
  return conversation.participantIds.some((id) => scopedAgentIds.has(id));
}

function conversationMatchesFilter(
  conversation: ScoutConversationSummary,
  filter: MessagesLeftRailFilter,
): boolean {
  if (filter === "dm") return conversation.kind === "direct";
  if (filter === "channel") return isGroupConversation(conversation);
  return true;
}

function isGroupConversation(conversation: ScoutConversationSummary): boolean {
  return isGroupConversationKind(conversation.kind, conversation.id);
}

function isGroupConversationKind(kind: string, id: string): boolean {
  return kind === "channel" || kind === "group_direct" || id.startsWith("channel.");
}

function displayTitle(conversation: ScoutConversationSummary): string {
  if (conversation.title && conversation.title !== conversation.id) return conversation.title;
  if (conversation.id.startsWith("channel.")) return conversation.id.replace(/^channel\./, "");
  return conversation.agentName ?? conversation.id;
}

function shortLabel(conversation: ScoutConversationSummary): string {
  if (conversation.id.startsWith("channel.")) return conversation.id.replace(/^channel\./, "");
  return displayTitle(conversation);
}

function isUnread(conversation: ScoutConversationSummary, lastViewed: LastViewedMap): boolean {
  if (!conversation.lastMessageAt) return false;
  return conversation.lastMessageAt > (lastViewed[conversation.id] ?? 0);
}

function conversationRow(
  conversation: ScoutConversationSummary,
  refs: EntityRefs,
  lastViewed: LastViewedMap,
  ask: WebFleetAsk | undefined,
): MessagesLeftRailRow {
  const title = displayTitle(conversation);
  const channel = isGroupConversation(conversation);
  const identifier = threadIdentifier(conversation, refs);
  const subject = ask?.task ?? trimPreview(conversation.preview) ?? conversation.currentBranch ?? "";
  const childName = subject ? `${refs.agent?.name ?? conversation.agentName ?? title} · ${subject}` : title;
  const sub = identifier.toLowerCase() === title.toLowerCase() ? null : identifier;
  return {
    id: conversation.id,
    conversationId: conversation.id,
    title,
    name: childName,
    sub,
    unread: isUnread(conversation, lastViewed),
    tone: channel ? "channel" : refs.agent?.state ?? "dm",
    avatarName: refs.agent?.name ?? title,
    lastMessageAt: conversation.lastMessageAt,
    refs,
  };
}

function threadIdentifier(conversation: ScoutConversationSummary, refs: EntityRefs): string {
  if (isGroupConversation(conversation)) {
    return shortLabel(conversation);
  }
  const agentId = refs.agent?.id ?? conversation.agentId;
  if (agentId) return agentId.split(".")[0] ?? agentId;
  return displayTitle(conversation);
}

function trimPreview(preview: string | null): string | null {
  if (!preview) return null;
  const collapsed = preview.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > 60 ? `${collapsed.slice(0, 57)}...` : collapsed;
}

function sortConversationRows(rows: MessagesLeftRailRow[], sort: MessagesLeftRailSort): MessagesLeftRailRow[] {
  return [...rows].sort((left, right) => {
    switch (sort) {
      case "name":
        return compareStrings(left.title, right.title) || compareNumbersDesc(left.lastMessageAt, right.lastMessageAt);
      case "unread":
        if (left.unread !== right.unread) return left.unread ? -1 : 1;
        return compareNumbersDesc(left.lastMessageAt, right.lastMessageAt);
      case "recent":
      default:
        return compareNumbersDesc(left.lastMessageAt, right.lastMessageAt);
    }
  });
}

function buildConversationGroups(rows: MessagesLeftRailRow[], sort: MessagesLeftRailSort) {
  const buckets = new Map<string, ReturnType<typeof createListBucket<MessagesLeftRailRow, MessagesLeftRailGroupMeta>>>();
  for (const row of rows) {
    const bucketInfo = conversationGroupInfo(row);
    let bucket = buckets.get(bucketInfo.key);
    if (!bucket) {
      bucket = createListBucket<MessagesLeftRailRow, MessagesLeftRailGroupMeta>({
        key: bucketInfo.key,
        kind: bucketInfo.kind,
        label: bucketInfo.label,
        refs: bucketInfo.refs,
        counts: { total: 0, unread: 0 },
        sortKeys: { name: bucketInfo.label, recent: 0, unread: 0, stateRank: 9 },
        meta: {
          latestAt: null,
          unreadCount: 0,
          totalCount: 0,
          tone: bucketInfo.tone,
        },
      });
      buckets.set(bucketInfo.key, bucket);
    }

    bucket.rows.push(row);
    bucket.counts.total = (bucket.counts.total ?? 0) + 1;
    bucket.meta.totalCount += 1;
    if (row.unread) {
      bucket.counts.unread = (bucket.counts.unread ?? 0) + 1;
      bucket.meta.unreadCount += 1;
    }
    bucket.meta.latestAt = Math.max(bucket.meta.latestAt ?? 0, row.lastMessageAt ?? 0) || null;
    bucket.sortKeys.recent = bucket.meta.latestAt ?? 0;
    bucket.sortKeys.unread = bucket.meta.unreadCount;
    if (row.refs.agent) {
      bucket.sortKeys.stateRank = Math.min(
        Number(bucket.sortKeys.stateRank ?? 9),
        entityAgentStateRank(row.refs.agent.state),
      );
      if (bucket.meta.tone !== "channel") {
        const current = bucket.meta.tone;
        const next = row.refs.agent.state;
        bucket.meta.tone = entityAgentStateRank(next) < entityAgentStateRank(current as EntityAgentState)
          ? next
          : current;
      }
    }
  }

  for (const bucket of buckets.values()) {
    bucket.rows.sort((left, right) => compareNumbersDesc(left.lastMessageAt, right.lastMessageAt));
  }

  const groups = bucketMapToGroups(buckets);
  groups.sort((left, right) => compareConversationGroups(left, right, sort));
  return groups;
}

function conversationGroupInfo(row: MessagesLeftRailRow): {
  key: string;
  kind: ListGroupKind;
  label: string;
  tone: MessagesLeftRailGroupMeta["tone"];
  refs?: EntityRefs;
} {
  const conversation = row.refs.conversation;
  if (conversation && isGroupConversationKind(conversation.kind, conversation.id)) {
    return {
      key: `channel:${conversation.id}`,
      kind: "channel",
      label: row.title,
      tone: "channel",
      refs: { ...row.refs, project: null, agent: null, flight: null },
    };
  }

  const project = row.refs.project;
  if (project) {
    return {
      key: project.key,
      kind: "project",
      label: project.title,
      tone: row.refs.agent?.state ?? "dm",
      refs: { ...row.refs, agent: null, conversation: null, flight: null },
    };
  }

  const agentName = row.refs.agent?.name ?? row.title;
  return {
    key: `agent-name:${agentName.trim().toLowerCase() || row.conversationId}`,
    kind: "agent",
    label: agentName,
    tone: row.refs.agent?.state ?? "dm",
    refs: { ...row.refs, project: null, conversation: null, flight: null },
  };
}

function compareConversationGroups(
  left: { label: string; sortKeys: Record<string, string | number | boolean | null> },
  right: { label: string; sortKeys: Record<string, string | number | boolean | null> },
  sort: MessagesLeftRailSort,
): number {
  switch (sort) {
    case "name":
      return compareStrings(left.label, right.label)
        || Number(right.sortKeys.recent ?? 0) - Number(left.sortKeys.recent ?? 0);
    case "unread": {
      const leftUnread = Number(left.sortKeys.unread ?? 0) > 0;
      const rightUnread = Number(right.sortKeys.unread ?? 0) > 0;
      if (leftUnread !== rightUnread) return leftUnread ? -1 : 1;
      return Number(right.sortKeys.recent ?? 0) - Number(left.sortKeys.recent ?? 0);
    }
    case "recent":
    default:
      return Number(right.sortKeys.recent ?? 0) - Number(left.sortKeys.recent ?? 0)
        || compareStrings(left.label, right.label);
  }
}
