/**
 * ⚠️ LEGACY STRUCTURAL CONVERSATION-ID PARSERS — DO NOT EXTEND.
 *
 * This module holds the *structural* `dm.{operator}.{agent}` /
 * `dm.{agent}.scout.main.mini` parsing-and-construction logic that
 * SCO-030 (opaque conversation IDs) is replacing. It exists only so
 * domain files in `packages/web/server/db/` can compose conversation IDs
 * without importing back into db-queries.ts (which would create a
 * circular dependency once domains are split out — see SCO-031 Phase C).
 *
 * Do NOT mistake this for `ConversationsRepo`. The repo (per SCO-031 §5,
 * `packages/runtime/src/repos/conversations.ts`) is the durable home for
 * conversation identity. This module is a transitional shim. New
 * call sites should go through the repo, not these helpers.
 *
 * When SCO-030 lands:
 *   - `ensureConversation({ kind, participants })` becomes the only mint path
 *   - structural-form parsing collapses into `resolveLegacyId` on the repo
 *   - this file deletes or shrinks to a re-export of the repo shims
 *
 * Until then, db-queries.ts re-exports `conversationIdForAgent` from here
 * so external consumers (web/server/* and runtime bridges) keep working.
 */

import { resolveOperatorName } from "@openscout/runtime/user-config";

/**
 * Derive the canonical direct conversation ID for an operator↔agent chat.
 */
export function conversationIdForAgent(agentId: string): string {
  return buildDirectConversationId("operator", agentId);
}

export function configuredOperatorActorIds(): string[] {
  const operatorName = resolveOperatorName().trim() || "operator";
  return Array.from(new Set(["operator", operatorName]));
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
