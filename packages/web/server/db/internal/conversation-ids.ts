/**
 * ⚠️ LEGACY STRUCTURAL CONVERSATION-ID PARSERS — DO NOT EXTEND.
 *
 * Compatibility shim. The canonical home for these helpers lives at
 * `@openscout/runtime/conversations/legacy-ids` (see SCO-031 §5) so the
 * `Conversations` api and the web domain files can both reach a single
 * implementation. This file re-exports so existing
 * `packages/web/server/db/...` imports keep working without ripping every
 * import site in the same PR.
 *
 * New callers should prefer `store.conversations.findByAgent` /
 * `store.conversations.resolveLegacyId`. SCO-030 deletes this shim after
 * the structural-ID compat window closes.
 */

export {
  buildDirectConversationId,
  buildLegacyScoutSessionConversationId,
  configuredOperatorActorIds,
  conversationIdAliases,
  conversationIdForAgent,
  directConversationIdCandidates,
  isLikelyLocalSessionAgentId,
  parseDirectConversationId,
  parseLegacyScoutSessionConversationId,
} from "@openscout/runtime/conversations/legacy-ids";
