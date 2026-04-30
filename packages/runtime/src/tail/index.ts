// Internal tail event surface for @openscout/runtime.
//
// The tail firehose runs as a single in-process watcher that polls harness
// transcripts (Claude, Codex, …) and fans the parsed events out to any
// registered subscriber. Hosts wire the transport layer; this module is pure
// logic owned by runtime.

export {
  getTailDiscovery,
  snapshotRecentEvents,
  subscribeTail,
} from "./service.js";

export type {
  DiscoveredProcess,
  DiscoveredTranscript,
  DiscoverySnapshot,
  TailContext,
  TailDiscoveryScope,
  TailEvent,
  TailEventKind,
  TailAttribution,
  TailHarness,
  TranscriptSource,
} from "./types.js";
