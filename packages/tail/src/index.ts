// Public surface of @openscout/tail.
//
// The tail firehose runs as a single in-process watcher that polls harness
// transcripts (Claude, Codex, …) and fans the parsed events out to any
// registered subscriber. Hosts (web server today, broker tomorrow) wire the
// transport layer; this package is pure logic.

export {
  getTailDiscovery,
  snapshotRecentEvents,
  subscribeTail,
} from "./service";

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
} from "./types";
