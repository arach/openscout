/**
 * SCO-031 §5: repository facades over `SQLiteControlPlaneStore`.
 *
 * The first repository — `ConversationsRepo` — lands here so SCO-030 has a
 * single home for conversation identity logic (`findByNaturalKey`,
 * `ensureByNaturalKey`, `resolveLegacyId`). Other aggregates extract
 * opportunistically as their domains get surgery (SCO-031 §2 non-goals).
 */

export type {
  ConversationsRepo,
  EnsureConversationInput,
} from "./conversations.js";
export { SQLiteConversationsRepo } from "./conversations.js";
