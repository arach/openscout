/**
 * Named channel memberships for agents (dynamic participation, not identity).
 */

import { db } from "./internal/db.ts";
import type { WebAgentChannelMembership } from "./types/web.ts";

const BROKER_SHARED_CHANNEL_ID = "channel.shared";

type ChannelMembershipRow = {
  agent_id: string;
  conversation_id: string;
  title: string;
  metadata_json: string | null;
  participant_count: number;
};

function channelSlugFromRow(row: Pick<ChannelMembershipRow, "conversation_id" | "metadata_json">): string {
  if (row.metadata_json) {
    try {
      const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
      const fromMetadata = typeof metadata.channel === "string" ? metadata.channel.trim() : "";
      if (fromMetadata) {
        return fromMetadata;
      }
    } catch {
      // ignore malformed metadata
    }
  }
  if (row.conversation_id === BROKER_SHARED_CHANNEL_ID) {
    return "shared";
  }
  if (row.conversation_id.startsWith("channel.")) {
    return row.conversation_id.slice("channel.".length);
  }
  return row.conversation_id;
}

export function queryChannelMembershipsByAgentIds(
  agentIds: readonly string[],
): Map<string, WebAgentChannelMembership[]> {
  const normalizedAgentIds = [...new Set(agentIds.map((agentId) => agentId.trim()).filter(Boolean))];
  const memberships = new Map<string, WebAgentChannelMembership[]>(
    normalizedAgentIds.map((agentId) => [agentId, []]),
  );
  if (normalizedAgentIds.length === 0) {
    return memberships;
  }

  const placeholders = normalizedAgentIds.map(() => "?").join(", ");
  const rows = db().prepare(
    `SELECT
       cm.actor_id AS agent_id,
       c.id AS conversation_id,
       c.title,
       c.metadata_json,
       (
         SELECT COUNT(*)
         FROM conversation_members cm2
         WHERE cm2.conversation_id = c.id
       ) AS participant_count
     FROM conversation_members cm
     JOIN conversations c ON c.id = cm.conversation_id
     WHERE c.kind = 'channel'
       AND cm.actor_id IN (${placeholders})
     ORDER BY c.title ASC, c.id ASC`,
  ).all(...normalizedAgentIds) as ChannelMembershipRow[];

  for (const row of rows) {
    const list = memberships.get(row.agent_id);
    if (!list) {
      continue;
    }
    list.push({
      channel: channelSlugFromRow(row),
      conversationId: row.conversation_id,
      title: row.title,
      participantCount: row.participant_count,
    });
  }

  for (const agentId of normalizedAgentIds) {
    const list = memberships.get(agentId) ?? [];
    if (list.some((entry) => entry.conversationId === BROKER_SHARED_CHANNEL_ID)) {
      continue;
    }
    list.unshift({
      channel: "shared",
      conversationId: BROKER_SHARED_CHANNEL_ID,
      title: "shared-channel",
      participantCount: 0,
    });
    memberships.set(agentId, list);
  }

  for (const [agentId, list] of memberships) {
    memberships.set(
      agentId,
      [...list].sort((left, right) => left.channel.localeCompare(right.channel)),
    );
  }

  return memberships;
}
