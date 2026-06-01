/**
 * `Conversations` — the single, service-shaped entry point for conversation
 * identity operations across runtime and web (SCO-031 §5). Despite the
 * "repo" framing in the design doc, this is not a pure repository — methods
 * like `ensureByNaturalKey` and `resolveLegacyId` carry domain logic, so it
 * is named for what it is: the conversations API on the store.
 *
 * Read methods reuse the host `SQLiteControlPlaneStore`'s connection handles
 * so we never open a third bun:sqlite connection to the same database file.
 * Writes funnel through `store.upsertConversation` so transaction/WAL
 * coordination stays in one place.
 *
 * In SCO-031 the body is "lift the existing structural-ID logic verbatim";
 * SCO-030 then fills in `findByNaturalKey` + `ensureByNaturalKey` once the
 * `natural_key` column lands. Until then `resolveLegacyId` carries the
 * deprecated `dm.{operator}.{agent}` parse/build helpers — see
 * `./legacy-ids.ts` for the structural form definitions.
 */

import { randomUUID } from "node:crypto";

import type { Database } from "bun:sqlite";

import type {
  ConversationDefinition,
  ConversationKind,
  MetadataMap,
  ScoutId,
  ShareMode,
  VisibilityScope,
} from "@openscout/protocol";
import {
  channelNaturalKeyFromMetadata,
  directChannelNaturalKey,
  mintChannelId,
} from "@openscout/protocol";

import type { SQLiteControlPlaneStore } from "../sqlite-store.js";

import {
  conversationIdForAgent,
  directConversationIdCandidates,
  parseDirectConversationId,
  parseLegacyScoutSessionConversationId,
} from "./legacy-ids.js";

export interface EnsureConversationInput {
  naturalKey: string;
  kind: ConversationKind;
  title: string;
  visibility: VisibilityScope;
  shareMode: ShareMode;
  authorityNodeId: ScoutId;
  participantIds: ScoutId[];
  parentConversationId?: ScoutId;
  topic?: string;
  metadata?: MetadataMap;
}

export interface ConversationsApi {
  findById(id: ScoutId): ConversationDefinition | null;
  findByNaturalKey(key: string): ConversationDefinition | null;
  findByAgent(agentId: ScoutId): ConversationDefinition | null;
  findByParent(parentId: ScoutId): ConversationDefinition[];
  findByParticipants(participants: ScoutId[]): ConversationDefinition | null;
  ensureByNaturalKey(input: EnsureConversationInput): ConversationDefinition;
  upsert(c: ConversationDefinition): void;
  delete(id: ScoutId): void;
  resolveLegacyId(rawId: string): ConversationDefinition | null;
}

interface ConversationRow {
  id: string;
}

export class Conversations implements ConversationsApi {
  constructor(private readonly store: SQLiteControlPlaneStore) {}

  private get readDb(): Database {
    return this.store.readerDb;
  }

  private get writeDb(): Database {
    return this.store.writerDb;
  }

  findById(id: ScoutId): ConversationDefinition | null {
    return this.store.getConversation(id);
  }

  findByNaturalKey(key: string): ConversationDefinition | null {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return null;
    }
    const rows = this.readDb.query(
      "SELECT id FROM conversations ORDER BY created_at ASC",
    ).all() as ConversationRow[];
    for (const row of rows) {
      const conversation = this.findById(row.id);
      if (
        conversation &&
        channelNaturalKeyFromMetadata(conversation.metadata) === normalizedKey
      ) {
        return conversation;
      }
    }
    return null;
  }

  /**
   * Build the canonical operator↔agent direct conversation id and look it up.
   * Equivalent to the inline `queryConversationDefinitionById(conversationIdForAgent(agentId))`
   * pattern that used to live in `db-queries.ts`.
   */
  findByAgent(agentId: ScoutId): ConversationDefinition | null {
    return this.findById(conversationIdForAgent(agentId))
      ?? this.findByNaturalKey(directChannelNaturalKey(["operator", agentId]));
  }

  findByParent(parentId: ScoutId): ConversationDefinition[] {
    const rows = this.readDb.query(
      "SELECT id FROM conversations WHERE parent_conversation_id = ?1 ORDER BY created_at ASC",
    ).all(parentId) as ConversationRow[];

    const conversations: ConversationDefinition[] = [];
    for (const row of rows) {
      const conversation = this.findById(row.id);
      if (conversation) {
        conversations.push(conversation);
      }
    }
    return conversations;
  }

  /**
   * Returns a conversation whose `conversation_members` set exactly matches
   * the given participant set, or `null` when no such row exists.
   *
   * In SCO-031 this only matches when the membership multiset is identical —
   * the dedup logic from `pickDirectConversationAgentId` / `shouldPreferSessionSummary`
   * stays in the session pickers because it is concerned with display
   * ordering rather than identity. SCO-030 may replace this with a
   * `natural_key`-driven match for canonical direct/channel forms.
   */
  findByParticipants(participants: ScoutId[]): ConversationDefinition | null {
    const uniqueParticipants = Array.from(new Set(participants.filter(Boolean)));
    if (uniqueParticipants.length === 0) {
      return null;
    }

    const placeholders = uniqueParticipants.map(() => "?").join(", ");
    const rows = this.readDb.query(
      `SELECT cm.conversation_id AS id
       FROM conversation_members cm
       WHERE cm.actor_id IN (${placeholders})
       GROUP BY cm.conversation_id
       HAVING COUNT(DISTINCT cm.actor_id) = ?
          AND (
            SELECT COUNT(*) FROM conversation_members cm2
            WHERE cm2.conversation_id = cm.conversation_id
          ) = ?`,
    ).all(...uniqueParticipants, uniqueParticipants.length, uniqueParticipants.length) as ConversationRow[];

    if (rows.length === 0) {
      return null;
    }

    // Stable selection: oldest matching conversation by created_at.
    const orderedRows = this.readDb.query(
      `SELECT id FROM conversations
       WHERE id IN (${rows.map(() => "?").join(", ")})
       ORDER BY created_at ASC
       LIMIT 1`,
    ).all(...rows.map((r) => r.id)) as ConversationRow[];

    const winner = orderedRows[0] ?? rows[0];
    return winner ? this.findById(winner.id) : null;
  }

  ensureByNaturalKey(input: EnsureConversationInput): ConversationDefinition {
    const existing = this.findByNaturalKey(input.naturalKey);
    if (existing) {
      return existing;
    }

    const conversation: ConversationDefinition = {
      id: mintChannelId(randomUUID),
      kind: input.kind,
      title: input.title,
      visibility: input.visibility,
      shareMode: input.shareMode,
      authorityNodeId: input.authorityNodeId,
      participantIds: input.participantIds,
      parentConversationId: input.parentConversationId,
      topic: input.topic,
      metadata: {
        ...(input.metadata ?? {}),
        naturalKey: input.naturalKey,
      },
    };
    this.upsert(conversation);
    return conversation;
  }

  upsert(c: ConversationDefinition): void {
    this.store.upsertConversation(c);
  }

  delete(id: ScoutId): void {
    // Schema's `ON DELETE CASCADE` on conversation_members and `ON DELETE SET NULL`
    // on the other FK references handle cleanup (schema.ts:75, 96, 143, 262, 296, 332).
    this.writeDb.query("DELETE FROM conversations WHERE id = ?1").run(id);
  }

  /**
   * Resolve a raw URL/path conversation id to a canonical row, falling back
   * to the legacy structural form (`dm.{operator}.{agent}` and the
   * `dm.{agent}.scout.main.mini` variant). Returns `null` when the id is
   * unknown.
   *
   * SCO-030 marks this `@deprecated` and removes it once the structural-ID
   * compat window closes.
   */
  resolveLegacyId(rawId: string): ConversationDefinition | null {
    const direct = this.findById(rawId);
    if (direct) {
      return direct;
    }

    const parsedDirect = parseDirectConversationId(rawId);
    if (parsedDirect) {
      const byNaturalKey = this.findByNaturalKey(
        directChannelNaturalKey([parsedDirect.operatorId, parsedDirect.agentId]),
      );
      if (byNaturalKey) {
        return byNaturalKey;
      }
      for (const candidate of directConversationIdCandidates(parsedDirect.agentId)) {
        const hit = this.findById(candidate);
        if (hit) {
          return hit;
        }
      }
    }

    const legacyScoutAgentId = parseLegacyScoutSessionConversationId(rawId);
    if (legacyScoutAgentId) {
      const byNaturalKey = this.findByNaturalKey(
        directChannelNaturalKey(["operator", legacyScoutAgentId]),
      );
      if (byNaturalKey) {
        return byNaturalKey;
      }
      for (const candidate of directConversationIdCandidates(legacyScoutAgentId)) {
        const hit = this.findById(candidate);
        if (hit) {
          return hit;
        }
      }
    }

    return null;
  }
}
