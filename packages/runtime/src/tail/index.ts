// Internal tail event surface for @openscout/runtime.
//
// The tail firehose runs as a single in-process watcher that polls harness
// transcripts (Claude, Codex, …) and fans the parsed events out to any
// registered subscriber. Hosts wire the transport layer; this module is pure
// logic owned by runtime.

export {
  buildTailDiscoverySessionPreviews,
  getTailDiscovery,
  readRecentTranscriptEvents,
  snapshotRecentEvents,
  subscribeTail,
} from "./service.js";
export { buildTailSessionPreview } from "./session-preview.js";

export type {
  DiscoveredProcess,
  DiscoveredTranscript,
  DiscoverySnapshot,
  TailContext,
  TailDiscoveryScope,
  TailEvent,
  TailEventKind,
  TailSessionPreview,
  TailSessionPreviewFact,
  TailSessionPreviewInput,
  TailSessionPreviewStats,
  TailAttribution,
  TailHarness,
  TranscriptSource,
} from "./types.js";
