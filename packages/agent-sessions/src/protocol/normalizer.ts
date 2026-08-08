// SCO-042 harness event normalizer contracts.
//
// Normalizers are pure after construction: no filesystem, process, network,
// environment, clock, stdin, or stdout access. Live adapter shells own those
// side effects and pass semantic edges as adapter_control records.

import type { AgentSessionStreamEvent } from "./primitives.js";

export type AdapterControlEvent =
  | "prompt_accepted"
  | "question_answered"
  | "topology_observed"
  | "interrupt"
  | "transport_closed"
  | "transport_error";

export type AdapterReplayRecord =
  | { source: "harness"; sequence: number; payload: unknown }
  | {
      source: "adapter_control";
      sequence: number;
      event: AdapterControlEvent;
      turnId?: string;
      payload?: unknown;
    };

export type NormalizerIdKind = "turn" | "block" | "event";

export interface HarnessEventNormalizerContext {
  sessionId: string;
  now(): string;
  nextId(kind: NormalizerIdKind): string;
}

export interface HarnessEventNormalizer {
  ingest(record: AdapterReplayRecord): readonly AgentSessionStreamEvent[];
  finishReplay(): readonly AgentSessionStreamEvent[];
  readonly turnOpen: boolean;
}

/** Maximum UTF-8 size for a serialized session event (SCO-042-C009). */
export const MAX_SESSION_EVENT_UTF8_BYTES = 64 * 1024;

/** Maximum retained UTF-8 action output per block in StateTracker (SCO-042-C009). */
export const MAX_RETAINED_ACTION_OUTPUT_UTF8_BYTES = 64 * 1024;

/** Leaves enough envelope space for a serialized action-output event to stay below 64 KiB. */
export const MAX_ACTION_OUTPUT_EVENT_UTF8_BYTES = 60 * 1024;

/** Maximum UTF-8 size for a diagnostic message (SCO-042-C009). */
export const MAX_DIAGNOSTIC_UTF8_BYTES = 4 * 1024;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function truncateUtf8(
  value: string,
  maxBytes: number,
): { text: string; omittedBytes: number } {
  if (maxBytes <= 0) {
    return { text: "", omittedBytes: utf8ByteLength(value) };
  }
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) {
    return { text: value, omittedBytes: 0 };
  }
  const slice = encoded.subarray(0, maxBytes);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = slice.byteLength;
  let text = "";
  while (end > 0) {
    try {
      text = decoder.decode(slice.subarray(0, end));
      break;
    } catch {
      // A UTF-8 scalar is at most four bytes, so a cut sequence takes at most
      // three decrements to remove without introducing a replacement glyph.
      end -= 1;
    }
  }
  return {
    text,
    omittedBytes: encoded.byteLength - utf8ByteLength(text),
  };
}

/** Emitted protocol values are immutable snapshots, never live normalizer state. */
export function snapshotNormalizedValue<T>(value: T): T {
  return structuredClone(value);
}
