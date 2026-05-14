/**
 * ⚠️ LEGACY STRUCTURAL CONVERSATION-ID PARSERS — DO NOT EXTEND.
 *
 * Compatibility shim. The canonical home for these helpers moved to
 * `@openscout/runtime/repos/legacy-conversation-ids` (see SCO-031 §5) so the
 * `ConversationsRepo` and the web domain files can both reach a single
 * implementation. This file re-exports so existing
 * `packages/web/server/db/...` imports keep working without ripping every
 * import site in the same PR.
 *
 * New callers should prefer `SQLiteConversationsRepo.findByAgent` /
 * `resolveLegacyId` on `store.conversations`. SCO-030 deletes this shim
 * after the structural-ID compat window closes.
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
} from "@openscout/runtime/repos/legacy-conversation-ids";
