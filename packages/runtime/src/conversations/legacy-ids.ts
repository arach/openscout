/**
 * ⚠️ LEGACY STRUCTURAL CONVERSATION-ID PARSERS — DO NOT EXTEND.
 *
 * This module owns the *structural* `dm.{operator}.{agent}` /
 * `dm.{agent}.scout.main.mini` parsing-and-construction helpers that SCO-030
 * (Opaque Conversation IDs) is replacing. It lives in runtime, next to
 * `Conversations`, because the conversations API is the durable home for
 * conversation identity (SCO-031 §5). `packages/web/server/db/internal/conversation-ids.ts`
 * re-exports from here for backwards compatibility with the web domain files
 * extracted in SCO-031 Phase C; new callers should reach for the api's
 * `findByAgent` / `resolveLegacyId` methods instead.
 *
 * When SCO-030 lands:
 *   - `ensureConversation({ kind, participants })` becomes the only mint path.
 *   - Structural-form parsing collapses into `resolveLegacyId` on the repo.
 *   - This file deletes (or shrinks to nothing) after the structural-ID
 *     compat window closes.
 */

import { resolveOperatorHandle, resolveOperatorName } from "../user-config.js";

/**
 * Derive the canonical direct conversation ID for an operator↔agent chat.
 */
export function conversationIdForAgent(agentId: string): string {
  return buildDirectConversationId("operator", agentId);
}

export function configuredOperatorActorIds(): string[] {
  const operatorName = resolveOperatorName().trim() || "operator";
  const operatorHandle = resolveOperatorHandle().trim() || operatorName;
  return Array.from(new Set(["operator", operatorName, operatorHandle]));
}

export function buildDirectConversationId(operatorId: string, agentId: string): string {
  return `dm.${operatorId}.${agentId}`;
}

export function buildLegacyScoutSessionConversationId(agentId: string): string {
  return `dm.${[agentId, "scout.main.mini"].sort().join(".")}`;
}

export function isLikelyLocalSessionAgentId(actorId: string): boolean {
  return actorId.startsWith("local-session-agent-");
}

export function directConversationIdCandidates(agentId: string): string[] {
  const ids = [
    conversationIdForAgent(agentId),
    ...configuredOperatorActorIds().map((operatorId) => buildDirectConversationId(operatorId, agentId)),
  ];
  if (isLikelyLocalSessionAgentId(agentId)) {
    ids.push(buildLegacyScoutSessionConversationId(agentId));
  }
  return Array.from(new Set(ids));
}

export function parseLegacyScoutSessionConversationId(conversationId: string): string | null {
  const match = conversationId.match(/^dm\.(local-session-agent-[^.]+)\.scout\.main\.mini$/);
  return match?.[1] ?? null;
}

export function parseDirectConversationId(conversationId: string): { operatorId: string; agentId: string } | null {
  const legacyScoutAgentId = parseLegacyScoutSessionConversationId(conversationId);
  if (legacyScoutAgentId) {
    return { operatorId: "operator", agentId: legacyScoutAgentId };
  }

  for (const operatorId of configuredOperatorActorIds()) {
    const prefix = `dm.${operatorId}.`;
    if (!conversationId.startsWith(prefix)) {
      continue;
    }

    const agentId = conversationId.slice(prefix.length);
    if (agentId.length > 0) {
      return { operatorId, agentId };
    }
  }

  return null;
}

export function conversationIdAliases(conversationId: string): string[] {
  const fromDirect = parseDirectConversationId(conversationId);
  if (fromDirect) {
    return directConversationIdCandidates(fromDirect.agentId);
  }

  const fromLegacyScout = parseLegacyScoutSessionConversationId(conversationId);
  if (fromLegacyScout) {
    return directConversationIdCandidates(fromLegacyScout);
  }

  return [conversationId];
}
