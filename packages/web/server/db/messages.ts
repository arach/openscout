/**
 * Web-shaped message reads from the control-plane conversations log.
 *
 * Lifted from db-queries.ts as part of SCO-031 Phase C. Conversation-ID
 * aliasing is delegated to `internal/conversation-ids.ts`.
 */

import { db } from "./internal/db.ts";
import { conversationIdAliases } from "./internal/conversation-ids.ts";
import { isOpaqueChannelId } from "@openscout/protocol";
import {
  sqlJoinClauses,
  sqlPlaceholders,
  sqlTimestampMsExpression,
  transientBrokerWorkingStatusPredicate,
} from "./internal/sql-helpers.ts";
import type { WebMessage } from "./types/web.ts";

export function queryRecentMessages(limit = 80, opts?: { conversationId?: string }): WebMessage[] {
  if (opts?.conversationId && !isOpaqueChannelId(opts.conversationId)) {
    return [];
  }
  const conversationIds = opts?.conversationId ? conversationIdAliases(opts.conversationId) : [];
  const messageCreatedAtExpression = sqlTimestampMsExpression("m.created_at");
  const where = sqlJoinClauses([
    transientBrokerWorkingStatusPredicate("m"),
    conversationIds.length > 0
      ? `m.conversation_id IN (${sqlPlaceholders(conversationIds.length)})`
      : "m.conversation_id LIKE 'c.%' AND length(m.conversation_id) > 2",
  ]);

  const rows = db()
    .prepare(
      `SELECT
         m.id,
         m.conversation_id,
         m.actor_id,
         ac.display_name AS actor_name,
         m.body,
         ${messageCreatedAtExpression} AS created_at,
         m.class,
         m.metadata_json,
         m.reply_to_message_id,
         m.thread_conversation_id
       FROM messages m
       JOIN actors ac ON ac.id = m.actor_id
       WHERE ${where}
       ORDER BY ${messageCreatedAtExpression} DESC
       LIMIT ?`,
    )
    .all(...conversationIds, limit) as Array<{
    id: string;
    conversation_id: string;
    actor_id: string;
    actor_name: string;
    body: string;
    created_at: number;
    class: string;
    metadata_json: string | null;
    reply_to_message_id: string | null;
    thread_conversation_id: string | null;
  }>;

  return rows.map((r) => {
    let metadata: Record<string, unknown> | null = null;
    if (r.metadata_json) {
      try { metadata = JSON.parse(r.metadata_json); } catch { metadata = null; }
    }
    return {
      id: r.id,
      conversationId: r.conversation_id,
      actorId: r.actor_id,
      actorName: r.actor_name,
      body: r.body,
      createdAt: r.created_at,
      class: r.class,
      metadata,
      replyToMessageId: r.reply_to_message_id,
      threadConversationId: r.thread_conversation_id,
    };
  });
}
