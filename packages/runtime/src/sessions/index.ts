// Public surface of the sessions inventory module.
//
// Sessions is a sibling to tail/* — same input (transcript files on disk),
// different optimization. Tail streams live events; sessions returns a
// stateful snapshot of every transcript with model/context/last-summary
// enrichment, cached by (path, mtime, size) so warm calls are essentially
// free.

export { getSessionInventory } from "./inventory.js";
export { clearEnrichmentCache, enrichmentCacheStats } from "./cache.js";

export type {
  SessionEnrichment,
  SessionInventory,
  SessionInventoryScope,
  SessionRecord,
} from "./types.js";
