/**
 * Direct-conversation identity helpers used by the web read path.
 *
 * Lifted from db-queries.ts during SCO-031 Phase C so that domain files
 * (agents/messages/runs/mobile) can compose conversation IDs without
 * importing back into db-queries.ts (which would create a circular
 * dependency once domains are split out).
 *
 * Per the SCO-031 plan §5, this cluster will migrate to
 * `ConversationsRepo` (packages/runtime/src/repos/conversations.ts) once
 * SCO-030 lands the opaque-id schema. Until then, db-queries.ts re-exports
 * the public surface (`conversationIdForAgent`) from this module so
 * external consumers keep working.
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
