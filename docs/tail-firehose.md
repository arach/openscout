# Tail Firehose

**Status:** implemented in the runtime/broker

## Purpose and ownership

The tail firehose answers “what agent activity is happening on this machine?” by
observing the transcript files already written by local harnesses. Harness files
remain owned by their harness. Scout emits bounded `TailEvent` projections for
live views; it does not bulk-import observed turns into Scout's canonical message
or invocation records.

There is one tail service in `packages/runtime/src/tail/service.ts`, hosted by the
Bun broker supervised under `scoutd`. Web, pairing/mobile, and other consumers
subscribe to that broker-owned stream instead of running their own filesystem
watchers. `scoutd` itself does not parse transcripts.

## Current sources

The source registry currently includes Grok, Kimi Code, Claude Code, Codex,
Cursor, OpenCode, and Pi. Each source implements `TranscriptSource` under
`packages/runtime/src/tail/` and is registered once in `service.ts`.

Kimi Code is discovered from:

```text
~/.kimi-code/sessions/
  wd_<workspace>_<hash>/
    session_<uuid>/
      state.json
      agents/main/wire.jsonl
      agents/agent-0/wire.jsonl
      ...
```

The Kimi source also honors `$KIMI_CODE_HOME/sessions` and the explicit
`OPENSCOUT_TAIL_KIMI_SESSIONS_ROOT` override. It uses `state.json` for workspace
metadata and parses `wire.jsonl` for prompts, assistant text, thinking, tool
calls/results, approvals, plan-mode changes, cancellation, and context
compaction. High-volume request, token-usage, tool-snapshot, and step lifecycle
records are intentionally not emitted.

The main log uses session ID `session_<uuid>`. A spawned agent log uses
`session_<uuid>:agent-N`. This prevents watcher and buffer collisions while
preserving the parent Kimi session in the identifier.

## Event contract

The canonical types are in `packages/runtime/src/tail/types.ts`:

```ts
type TailAttribution = "scout-managed" | "hudson-managed" | "unattributed";

type TailEventKind =
  | "user"
  | "assistant"
  | "tool"
  | "tool-result"
  | "system"
  | "other";

type TailEvent = {
  id: string;
  ts: number;
  source: string;
  sessionId: string;
  pid: number;
  parentPid: number | null;
  project: string;
  cwd: string;
  harness: TailAttribution;
  kind: TailEventKind;
  summary: string;
  raw?: unknown;
};
```

`source` is the runtime harness (`kimi`, `claude`, `codex`, and so on).
`harness` is the legacy field name for launch attribution.

Event IDs are stable cursors. Kimi prefers the nested event UUID or tool-call ID,
then falls back to record type, timestamp, and line offset.

## Discovery and transport

- `GET /v1/tail/discover` returns the bounded discovery snapshot.
- `GET /v1/tail/recent` merges bounded live and transcript-backed observations.
- Broker tRPC `tail.events` streams backlog plus live events over the broker's
  `/trpc` WebSocket. It accepts `since` and `sources` filters and emits tracked
  event IDs for reconnect continuity.
- Pairing's tail fanout and the web client's shared subscription consume the same
  broker procedure.

The in-memory aggregate buffer is bounded to 10,000 events and each session
buffer to 2,000. A process restart starts a new in-memory replay window; source
transcripts remain available for bounded transcript-backed reads.

## Invariants

1. One watcher exists per source transcript path, independent of subscriber count.
2. Transcript files remain observed source material, not canonical Scout records.
3. Raw payloads and summaries are bounded before fanout.
4. Adding a harness means adding one `TranscriptSource` and registry entry, not a
   consumer-specific pipeline.
5. Presentation filtering happens downstream; the producer retains substantive
   prompts, responses, tools, results, and operator-attention events.

## Code map

| Concern | Path |
|---|---|
| Source contract and event types | `packages/runtime/src/tail/types.ts` |
| Discovery, watchers, buffers | `packages/runtime/src/tail/service.ts` |
| Kimi discovery and parsing | `packages/runtime/src/tail/kimi-source.ts` |
| Broker HTTP reads | `packages/runtime/src/broker-http-router.ts` |
| Broker tRPC stream | `packages/runtime/src/broker-trpc-router.ts` |
| Web subscription | `packages/web/client/lib/tail-events.ts` |
| Pairing/mobile fanout | `packages/web/server/core/pairing/runtime/bridge/tail-fanout.ts` |
