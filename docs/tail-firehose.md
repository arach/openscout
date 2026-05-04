# Tail Firehose — Design Brief

**Status:** proposal, not yet implemented
**Owners:** Lane A (Codex) — producer/transport. Lane B (Claude) — consumers/design.

## Why this exists

The durable question is *"what's running on my machine right now"* — not *"what did this specific agent spawn."* Every harness (Claude Code, Codex, Ghost, future ones) reinvents its own spawn protocol; sub-agents already cross harness boundaries (a Claude Code session shells out to a Codex review, an MCP server spawns its own model calls). Trying to trace topology from each source means re-doing that work every time a new provider ships, and we still miss the cross-harness edges.

Capture-everything-at-the-machine-layer flips it: the file system already has the ground truth (every harness writes transcripts somewhere — `~/.claude/projects/`, `~/.codex/sessions/`, etc.). One watcher reads them all, emits a uniform `TailEvent`, and every surface filters from there. Adding a new harness is one entry in the detection table, not a new pipeline.

The firehose is an observation surface, not a data-ownership claim. Harness transcript files remain owned by the harness that wrote them. Scout reads from those raw materials and emits bounded events for live views; it does not import every observed turn into the Scout conversation database. Durable coordination should still be represented as Scout messages, invocations, flights, deliveries, and work items.

The second reason is single-source-of-truth ergonomics. Today the tail watcher lives in `@openscout/web` (`packages/web/server/core/tail/`), the bridge has no path to it, iOS has no path at all, and the macOS menu would be tempted to grow its own. Three watchers diverge in subtle ways within a quarter — different harness detection, different truncation, different ordering. One firehose, hosted by the always-on broker, fans out to every consumer over the same WS we already trust for everything else. Web/iOS/Mac become views, not re-implementations.

The third reason — and this is the one that matters most to Lane A — is that spawn-tree visibility becomes a property of the firehose, not a per-harness feature. `pid` + `parentPid` ride on every event; any consumer can render the tree without knowing harness internals. As model providers get more sophisticated about delegating, *we don't have to keep up with each protocol* — we just keep watching the file system.

## Contract — the seam between lanes

### TailEvent schema (matches existing producer)

The existing tail service in `packages/web/server/core/tail/types.ts` already defines this shape — Lane B mirrors it on iOS verbatim, no transformation in the bridge. Two dimensions matter:

- `source` is the **runtime harness name** (`"claude"`, `"codex"`, future: `"quad"`, `"scout"`) — drives the primary tag on every consumer surface.
- `harness` is the legacy field name for **launch attribution** (`"scout-managed"` if Scout spawned it, `"hudson-managed"` if a peer Mac did, `"unattributed"` for everything else). UI should label this as origin/attribution, not harness.

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
  id: string;                    // already unique per event — use as cursor
  ts: number;                    // ms epoch
  source: string;                // runtime harness: "claude" | "codex" | ...
  sessionId: string;
  pid: number;
  parentPid: number | null;
  project: string;
  cwd: string;
  harness: TailAttribution;      // legacy field name: launch attribution
  kind: TailEventKind;
  summary: string;               // already truncated upstream
  raw?: unknown;                 // full payload, also bounded
};
```

### WS protocol — `ws://127.0.0.1:65535/v1/tail/stream`

```
S→C: { type: 'event', event: TailEvent }
S→C: { type: 'heartbeat', ts }
S→C: { type: 'snapshot_start' | 'snapshot_end', cursor }
C→S: { type: 'subscribe', since?: cursor /* TailEvent.id */, sources?: string[] }
```

### Invariants Lane A owns

1. **Single watcher per broker process** — service.ts already enforces one watcher per `${source}:${transcriptPath}` regardless of subscriber count; preserve that
2. **Replay** — consumer reconnects with `since: cursor` and gets backlog from the existing aggregate buffer before live tail (`snapshotRecentEvents` already exists; cursor is `TailEvent.id`)
3. **Backpressure** — if a consumer falls behind, drop heartbeats/`system`/`other` first; keep `user`/`assistant`/`tool`/`tool-result`
4. **Engine detection is data, not code paths** — `TranscriptSource` interface already encodes this; adding a new engine = a new source module + one entry in the `sources` array

### Resolved: cursor primitive

`TailEvent.id` already exists and is unique per event (e.g. `"codex:<sessionId>:<lineOffset>"`). Use it as the cursor — no need for file+offset or a new monotonic id. Restart story: in-memory aggregate buffer is bounded (`AGGREGATE_BUFFER_LIMIT = 10_000`); on watcher restart the buffer is empty, consumers get an empty backlog and start receiving live events. That's acceptable for v0; if we later need cross-restart replay, persist the buffer to SQLite.

## Lane A scope — Codex

- Move `packages/web/server/core/tail/` into `@openscout/runtime/tail` (pure logic, no transport)
- Host watcher in broker; expose WS endpoint above
- Bridge subscribes once, re-yields as tRPC `tail.events` for phones
- Web client swap SSE → WS; delete `/api/tail/stream` proxy

## Lane B scope — Claude

- iOS `subscribeToTailEvents()` helper next to existing fanout
- `TailFeedView` three-source merge by `ts`: Activity + SessionStore turns + TailEvents
- Runtime harness tag column (`[claude]` / `[codex]` / future `[quad]` etc.) driven by `event.source`
- Origin/attribution dot or badge (Scout-managed / Hudson-managed / native) driven by `event.harness`
- Leading `↳` glyph when `parentPid` is in live process map
- macOS menu cockpit row treatment if it matters there too — TBD after iOS lands

## Order of operations within Lane A

1. Move tail logic into `@openscout/runtime/tail` (mechanical move, no behavior change)
2. Wire broker to host it + expose `/v1/tail/stream` WebSocket
3. Bridge: subscribe to broker WS, expose `tail.events` tRPC subscription
4. Web client: swap SSE → WS, delete `/api/tail/stream` proxy

Stop after each step is wired & verified before moving to the next. Two firehoses temporarily is exactly what we don't want.
