# Universal Conversations Service + Projection Sync — Engineering Proposal (V6)

> V6 replaces the earlier mobile-first plan. We are no longer building mobile-specific conversations RPCs and migrating web later. Instead, we will build one universal conversations service with one data model, one projection, and one sync contract. Web consumes it first through an in-process transport; iOS adopts it later through the bridge RPC transport. Same service, same semantics, no web-vs-mobile branching.

## Context

The current conversations/comms experience is split by transport rather than unified by service:

- The broker is the source of truth.
- The web app is co-located with the broker and can read broker state directly.
- iOS goes through the pairing bridge over HTTP / RPC.
- Existing conversation summary helpers are effectively mobile-specific:
  - `packages/web/server/core/mobile/service.ts`
    - `buildMobileAgentSummary()`
    - `buildMobileSessionSummaries()`
    - `getScoutMobileHome()`
    - `getScoutMobileAgents()`
    - `getScoutMobileSessions()`
    - `getScoutMobileSessionSnapshot()`
- Those helpers currently rebuild summary state from the live broker snapshot via `loadScoutBrokerContext()`, which is fine for ad hoc reads but not a safe contract for replay, sync, or shared web/iOS semantics.

This proposal replaces that split with a **universal conversations service**:

- **Web first**:
  - Build the service.
  - Migrate the web app off direct broker snapshot reads and onto the service.
  - Polish semantics on web.
- **iOS second**:
  - Expose the same service over bridge transport.
  - Adopt it on iOS after web is already correct.

iOS Comms stays empty until the web migration is solid.

## Architectural decision

We are standardizing on an **append-only projection log + materialized snapshot**.

This is the same correctness model chosen in V5 Stage 2, but it now becomes the **universal conversations service**, not a mobile-only sync layer.

We explicitly reject "diff over current broker tables" for this service. The replay source must be a durable projection log of actual conversation deltas, not a mutation marker that forces the server to reread moving broker state.

## Goals

1. **One service, one semantics**
   - Web and iOS consume the same conversations service.
   - Transport differs; behavior does not.

2. **Web-first delivery**
   - Web migrates first.
   - No new iOS conversations surface until web is correct.

3. **Projection-backed correctness**
   - Conversation summary reads, bootstrap, replay, and live updates come from one projection plane.
   - No list/sync correctness depends on live broker snapshot scans.

4. **Stable replay and recovery**
   - One cursor domain.
   - One bootstrap contract.
   - One pagination model.
   - Explicit replay retention with `minReplayableSeq`.

## Non-goals

- This proposal does **not** replace transcript / thread-detail APIs.
  - Existing thread snapshot and thread event paths remain the detail-plane for opened conversations.
  - Relevant current code:
    - `packages/runtime/src/thread-events.ts`
    - broker thread endpoints in `packages/runtime/src/broker-core-service.ts` and `packages/runtime/src/broker-api.ts`
- This proposal does **not** unify workspace inventory or pairing management APIs.
- This proposal does **not** resolve the separate product question about whether offline direct conversations should remain visible. The universal service will centralize that rule, but the rule itself is a separate decision.

---

## Universal conversations service

### Service boundary

This service owns the **conversation summary plane**:

- conversation list / home surfaces
- conversation summary sync / bootstrap / replay / live update
- agent summary data needed by the conversations surfaces

It does **not** own:

- full thread message history
- session transcript block replay
- pairing-workspace inventory

### Canonical types

Rename the old mobile-specific names:

- `ScoutMobileSessionSummary` → `ConversationSummary`
- `ScoutMobileAgentSummary` → `ConversationAgentSummary`
- `MobileProjectionEvent` → `ConversationProjectionEvent`
- `mobile_projection_*` → `conversation_projection_*`
- `mobile/sync/*` → `conversations/sync/*`

### Service interface

```ts
type ConversationKind = "direct" | "channel" | "group_direct" | "thread" | "system";

type ConversationListFilters = {
  query?: string;
  limit?: number;
  kinds?: ConversationKind[];
};

type ConversationSyncCursor = {
  projectionId: string;
  seq: number;
};

type ConversationSummary = {
  id: string;
  kind: string;
  title: string;
  participantIds: string[];
  agentId: string | null;
  agentName: string | null;
  harness: string | null;
  currentBranch: string | null;
  preview: string | null;
  messageCount: number;
  lastMessageAt: number | null;
  workspaceRoot: string | null;
};

type ConversationAgentSummary = {
  id: string;
  title: string;
  selector: string | null;
  defaultSelector: string | null;
  workspaceRoot: string | null;
  harness: string | null;
  transport: string | null;
  state: "offline" | "available" | "working";
  statusLabel: string;
  sessionId: string | null;
  lastActiveAt: number | null;
};

type ConversationProjectionEvent = {
  seq: number;
  ts: number;
  delta: {
    conversations: {
      upserted: ConversationSummary[];
      notVisible: string[];
      hardDeleted: string[];
    };
    agents: {
      upserted: ConversationAgentSummary[];
      notVisible: string[];
      hardDeleted: string[];
    };
  };
};

interface ConversationsService {
  readHome(input?: {
    conversationLimit?: number;
    agentLimit?: number;
    kinds?: ConversationKind[];
  }): Promise<{
    conversations: ConversationSummary[];
    agents: ConversationAgentSummary[];
    totals: {
      conversations: number;
      agents: number;
    };
    snapshotSeq: number;
    projectionId: string;
  }>;

  listConversations(filters?: ConversationListFilters): Promise<ConversationSummary[]>;

  listAgents(filters?: {
    query?: string;
    limit?: number;
  }): Promise<ConversationAgentSummary[]>;

  bootstrap(input?: {
    kinds?: ConversationKind[];
  }): Promise<{
    projectionId: string;
    projectionVersion: number;
    snapshotSeq: number;
    payload: {
      conversations: ConversationSummary[];
      agents: ConversationAgentSummary[];
    };
  }>;

  bulkSince(input: {
    cursor: ConversationSyncCursor;
    limit?: number; // event count, default 200
    kinds?: ConversationKind[];
  }): Promise<{
    projectionId: string;
    projectionVersion: number;
    headSeq: number;
    minReplayableSeq: number;
    cursorExpired: boolean;
    reason?: "projection_reset" | "cursor_too_old";
    events: ConversationProjectionEvent[];
    hasMore: boolean;
  }>;

  subscribe(input: {
    cursor: ConversationSyncCursor;
    kinds?: ConversationKind[];
  }): AsyncIterable<ConversationProjectionEvent>;
}
```

### Transport model

Same service, two transports:

1. **Web transport (Stage 1)**
   - in-process transport
   - server code calls `ConversationsService` directly

2. **Bridge transport (Stage 2)**
   - pairing bridge RPC transport
   - bridge handlers forward to the same `ConversationsService`

There must be no "web semantics" and "iOS semantics" divergence.

---

## Projection architecture

## Canonical source of truth

The universal service does **not** answer list/sync requests from `loadScoutBrokerContext()` or live broker table scans.

Its source of truth is a dedicated **conversation projection plane** with:

1. a materialized current snapshot
2. an append-only replay log

Suggested schema:

```sql
CREATE TABLE conversation_projection_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  projection_id TEXT NOT NULL,
  projection_version INTEGER NOT NULL,
  head_seq INTEGER NOT NULL,
  min_replayable_seq INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE conversation_projection_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  projection_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE conversation_projection_conversation_state (
  id TEXT PRIMARY KEY,
  summary_json TEXT NOT NULL,
  visibility_state TEXT NOT NULL, -- 'visible' | 'hidden'
  updated_seq INTEGER NOT NULL
);

CREATE TABLE conversation_projection_agent_state (
  id TEXT PRIMARY KEY,
  summary_json TEXT NOT NULL,
  visibility_state TEXT NOT NULL,
  updated_seq INTEGER NOT NULL
);
```

### Projection identity

Cursors are scoped to:

- broker
- pairing identity (`bridgePublicKeyHex`) on remote clients
- projection lineage (`projectionId`)

```ts
type ConversationSyncCursor = {
  projectionId: string;
  seq: number;
};
```

Any incompatible projection rebuild or semantics change MUST rotate `projectionId`.

### Why this is required

This design fixes the seven blockers from the V4 review:

1. **Snapshot model**
   - reads come from a materialized projection snapshot, not moving broker tables

2. **`cursorExpired` recovery**
   - bootstrap is one atomic snapshot endpoint, not multiple unrelated list calls

3. **Pagination shape**
   - pagination is by append-only projection events, not by raw DB rows or diff windows

4. **Replay completeness**
   - persisted events contain actual conversation deltas, not "something changed" markers

5. **`minReplayableSeq`**
   - replay retention is defined on the projection event log itself

6. **Live-stream cursor domain**
   - live subscribe and catch-up replay share the same `{projectionId, seq}` cursor

7. **Cross-resource causal ordering**
   - one projection event corresponds to one durable broker write batch and pages only between whole events

---

## Projection write path

The projection must update from the broker's existing durable write boundary.

Relevant current broker code:

- `packages/runtime/src/broker-daemon.ts`
  - `runDurableWrite()`
  - `commitDurableEntries()`
  - `applyProjectedEntries()`
- `packages/runtime/src/broker-journal.ts`
  - journal append / compaction behavior

### Required behavior change

Extend the durable write pipeline so the retained `BrokerJournalEntry[]` returned by `commitDurableEntries()` also feed the conversation projection.

Conceptually:

```ts
retainedEntries = await commitDurableEntries(...)
await conversationProjection.applyBatch(retainedEntries, runtime.snapshot())
await applyProjectedEntries(retainedEntries) // existing thread/detail projection path
```

The exact internal ordering can be tuned, but the correctness rule is:

> For the conversations service, a broker write batch is not considered visible until the matching conversation projection batch is durably persisted.

### Important note on `broker-journal.ts`

`packages/runtime/src/broker-journal.ts` compacts redundant upserts. That is good for broker-state recovery, but it is **not** safe as a client replay log.

Therefore:

- the file-backed broker journal remains the broker durability layer
- the conversations service gets its **own retained replay log** in `conversation_projection_events`

---

## Projection event model

A projection event is the replay unit.

```ts
type ConversationProjectionEvent = {
  seq: number;
  ts: number;
  delta: {
    conversations: {
      upserted: ConversationSummary[];
      notVisible: string[];
      hardDeleted: string[];
    };
    agents: {
      upserted: ConversationAgentSummary[];
      notVisible: string[];
      hardDeleted: string[];
    };
  };
};
```

Rules:

- `seq` order is the only replay order
- one event corresponds to one retained durable broker write batch that affects the conversations surface
- event payloads are **self-contained**
- pagination may split only **between** events, never through a single event payload
- if a broker write batch changes no conversation-visible fields, no projection event is emitted and `head_seq` does not advance

This is the core replacement for the abandoned `broker_mutations` / diff-window design.

---

## Canonical summary builders

The service must have one canonical conversation-summary builder and one canonical agent-summary builder.

Current seed logic lives in:

- `packages/web/server/core/mobile/service.ts`
  - `buildMobileAgentSummary()`
  - `buildMobileSessionSummaries()`
  - `agentDisplayName()`
  - `endpointForAgent()`

V6 changes that:

1. those rules move into the conversations service / projection layer
2. bootstrap, list reads, replay, and live updates all use the same builders
3. the current `endpointForAgent()` first-match logic must be retired for projection purposes

### Endpoint selection rule

The projection MUST use deterministic endpoint selection equivalent to `homeEndpointForAgent()` in `packages/runtime/src/broker-daemon.ts`, not `Object.values(...).find(...)`.

Relevant code path:

- `packages/runtime/src/broker-daemon.ts`
  - `homeEndpointForAgent()`

This is required so:

- bootstrap and replay compute the same visible summary
- multi-endpoint agents do not flicker by object iteration order
- web and iOS see identical summary selection

### Inclusion / visibility rules

The universal service owns the inclusion rules for all consumers.

At minimum, it centralizes the same semantics currently embodied in the mobile summary helpers. If those rules change later (for example the offline-direct decision), that change must happen once in the service and may require a new `projectionId` if it is contract-breaking.

---

## Dependency expansion

Projection updates must expand a broker write to all conversation-visible resources it affects.

Minimum mapping:

| Broker durable write kind | Projection resources affected |
| --- | --- |
| `conversation.upsert` | that conversation summary |
| `message.record` | owning conversation summary (`preview`, `messageCount`, `lastMessageAt`) |
| `actor.upsert` / `agent.upsert` | that agent summary; any conversation summaries whose title/agent label derives from that agent |
| `agent.endpoint.upsert` | that agent summary; any conversation summaries whose visible fields derive from the selected home endpoint |
| `flight.record` | that agent summary if `working`/status changes |
| future explicit delete kinds | matching `hardDeleted` delta |

The projector must not emit "maybe changed; reread it later." It must emit the actual upsert / hide / delete deltas.

---

## `notVisible` vs `hardDeleted`

The split remains, but with stricter semantics:

| Signal | Meaning | Client behavior |
| --- | --- | --- |
| `notVisible` | resource still exists in projection state but is outside the visible conversations surface | hide it, but keep enough local identity to allow later resurrection |
| `hardDeleted` | resource has been explicitly removed from projection state | evict permanently |

Rules:

- `notVisible` is emitted by comparing pre-batch and post-batch visibility for affected resources
- `hardDeleted` requires explicit delete semantics or projection reset
- the service must not infer hard delete from "resource absent in current broker snapshot"

---

## Bootstrap and sync contract

## Bootstrap

```ts
conversations/sync/bootstrap(input?: {
  kinds?: ConversationKind[];
}): Promise<{
  projectionId: string;
  projectionVersion: number;
  snapshotSeq: number;
  payload: {
    conversations: ConversationSummary[];
    agents: ConversationAgentSummary[];
  };
}>
```

Requirements:

- read `conversation_projection_meta` and state tables in one read transaction
- `snapshotSeq` is the `head_seq` observed in that transaction
- payload is the exact visible snapshot as of `snapshotSeq`

This replaces the old multi-endpoint reset flow. There is now one atomic bootstrap snapshot.

## Catch-up replay

```ts
conversations/sync/bulk-since(input: {
  cursor: ConversationSyncCursor;
  limit?: number;
  kinds?: ConversationKind[];
}): Promise<{
  projectionId: string;
  projectionVersion: number;
  headSeq: number;
  minReplayableSeq: number;
  cursorExpired: boolean;
  reason?: "projection_reset" | "cursor_too_old";
  events: ConversationProjectionEvent[];
  hasMore: boolean;
}>
```

Rules:

- page size is **event count**, default 200
- server returns events with `seq > cursor.seq`, ascending
- `hasMore = true` iff the last returned event seq is `< headSeq`
- server returns at least one whole event when replayable data exists
- there is no continuation token; the client advances by last applied event seq

## `cursorExpired`

Return `cursorExpired: true` when either:

1. `cursor.projectionId !== current projectionId`
2. `cursor.seq < minReplayableSeq - 1`

Response:

```ts
{
  projectionId,
  projectionVersion,
  headSeq,
  minReplayableSeq,
  cursorExpired: true,
  reason: "projection_reset" | "cursor_too_old",
  events: [],
  hasMore: false
}
```

## Recovery flow

When the client receives `cursorExpired: true`:

1. call `conversations/sync/bootstrap()`
2. replace local caches atomically
3. persist cursor = `{ projectionId, seq: snapshotSeq }`
4. resume replay / subscribe from that cursor

This is simpler and safer than the old "cache sessionSeq, fetch three lists, then maybe advance" ordering.

## Live stream

Live updates and replay must share the same cursor domain.

```ts
conversations/sync/events.subscribe(input: {
  cursor: ConversationSyncCursor;
  kinds?: ConversationKind[];
}): AsyncIterable<ConversationProjectionEvent>
```

Rules:

- subscribe emits the same durable projection events that `bulk-since` replays
- expiry rules are the same as `bulk-since`
- a client may switch freely between replay and live subscribe

### Explicit non-reuse of pairing session seq

Do **not** reuse the current per-session `SequencedEvent.seq` from:

- `packages/agent-sessions/src/buffer.ts`
- `packages/web/server/core/pairing/runtime/bridge/server.ts` (`sync/replay`, `sync/status`)

Those remain session-transcript / pairing-session cursors only. They are not broker-global and not conversation-summary cursors.

## Retention and `minReplayableSeq`

Retention is defined on `conversation_projection_events`.

- default target retention: 30 days, configurable
- pruning may also be size-based
- `minReplayableSeq` always equals the smallest retained seq for the current `projectionId`
- pruning old events must not affect the current materialized snapshot

## Projection rebuild / reset

If the projection store is lost, rebuilt, or changed incompatibly:

1. generate a new `projectionId`
2. rebuild the materialized snapshot
3. start a new event-log lineage
4. force all old cursors to expire via projection-id mismatch

That is intentional and correct.

---

## Stage breakdown

## Stage 1 — Service + web migration

Stage 1 is the primary deliverable. iOS does not adopt the new service yet.

### Deliverables

1. **Build the universal conversations service**
   - create the projection plane
   - define the canonical summary builders
   - implement:
     - `readHome`
     - `listConversations`
     - `listAgents`
     - `bootstrap`
     - `bulkSince`
     - `subscribe`

2. **Migrate web off direct broker snapshot reads**
   - the web app must consume the service, not raw `loadScoutBrokerContext()`-derived summary helpers

3. **Ship web-first and validate semantics in production**
   - only after that do we expose the bridge transport for iOS

### Web migration inventory

The following server-side conversation-summary helpers move behind / into the new service:

#### Replace
- `packages/web/server/core/mobile/service.ts`
  - `buildMobileAgentSummary()`
  - `buildMobileSessionSummaries()`
  - `getScoutMobileHome()`
  - `getScoutMobileAgents()`
  - `getScoutMobileSessions()`

#### Deprecate / compatibility-wrap during migration
- `packages/web/server/core/mobile/service.ts`
  - `getScoutMobileSessionSnapshot()`
    - this is detail-plane and may temporarily remain as-is if the web conversation-open view still depends on existing thread/detail APIs
    - it should no longer be the summary source of truth

#### Later bridge transport call sites
- `packages/web/server/core/pairing/runtime/bridge/server.ts`
- `packages/web/server/core/pairing/runtime/bridge/router.ts`

These should stop importing from the mobile-specific service and later bind to the universal conversations service instead.

### What changes in the web app

The web app currently benefits from co-location with broker state. V6 intentionally removes that special path for conversation summaries.

Web list / home / comms surfaces must consume a service-backed adapter instead of any helper that scans `loadScoutBrokerContext()` and derives summaries ad hoc.

At minimum, the migration must cover the surfaces currently represented in the web client by:

- `packages/web/client/screens/ChannelsScreen.tsx`
- `packages/web/client/screens/ConversationScreen.tsx` (for summary/header/list-adjacent state; not necessarily full thread history)
- `packages/web/client/scout/inspector/SessionsInspector.tsx`

The exact route/loader wiring may evolve, but the server-side source for conversation summaries must be the new service.

### Migration plan

#### Step 1 — Build in-process service without changing UI contracts
- add a new conversations service module
- back it with the projection plane
- adapt outputs to the current web UI summary shapes where possible

#### Step 2 — Swap server-side summary sources
- replace direct `loadScoutBrokerContext()` summary rebuilding in the old mobile helpers with calls into the conversations service
- keep old exported function names temporarily if that lowers web churn, but make them thin wrappers over the service

#### Step 3 — Migrate web routes/loaders/screens
- update the web comms data path to use the service-backed server adapters
- no direct broker-summary reads remain on the web path for conversations list/home surfaces

#### Step 4 — Shadow / parity validation
Before deleting the old helper logic, run parity checks in test/dev:

- old summary helper output vs service output
- direct/channel/group_direct inclusion parity
- agent summary parity
- deterministic endpoint selection parity

#### Step 5 — Remove or freeze old helper builders
Once web is green:

- remove ad hoc summary-building logic from `packages/web/server/core/mobile/service.ts`, or
- freeze it as a legacy compatibility facade that delegates to the service

### Shipping rule for Stage 1

Do **not** expose iOS to this service until web is already using it and the web surface is judged correct.

That is the point of V6.

---

## Stage 2 — Bridge transport + iOS adoption

Only after Stage 1 is stable:

1. expose the universal service over bridge RPC transport
2. adopt it on iOS
3. keep semantics identical to web

### Bridge RPC names

Rename mobile-specific endpoints to universal names:

- `conversations/home`
- `conversations/list`
- `conversations/agents`
- `conversations/sync/bootstrap`
- `conversations/sync/bulk-since`
- `conversations/sync/events`

The bridge server and tRPC bridge router should forward these to the same service implementation used by web.

Relevant code paths to update:

- `packages/web/server/core/pairing/runtime/bridge/server.ts`
- `packages/web/server/core/pairing/runtime/bridge/router.ts`

### iOS adoption

iOS then consumes the same service contract:

- bootstrap on cold start
- `bulk-since` on reconnect
- live subscribe while connected

No iOS-specific summary semantics are allowed.

---

## Must-spec test cases

The V5 correctness cases still apply and remain mandatory:

1. **Hide → show across a page boundary**
2. **Agent rename racing with preview update**
3. **Endpoint selection determinism**
4. **Cursor expired by retention pruning**
5. **Projection reset / rebuild**
6. **Disconnect mid-pagination after page 1 persisted**
7. **Disconnect mid-page before persistence**
8. **Writes during bootstrap**
9. **Independent pairings on same broker**
10. **No-op broker write does not advance projection head**
11. **Explicit delete required for `hardDeleted`**
12. **Bootstrap parity**

V6 adds web-first migration cases:

13. **Web parity during migration**
    - service-backed conversation list matches legacy web summary output for the same broker state until the migration flag flips fully

14. **Web no-special-path guarantee**
    - after migration, disabling the old direct summary helper path does not change the rendered web comms list

15. **In-process vs bridge transport parity**
    - same cursor, same projection state, same filters → byte-equivalent service payloads across transports

16. **Projection event/page boundaries stable for web refresh**
    - web manual refresh, bootstrap, and subscribe converge to the same visible list state without transport-specific normalization

17. **Offline direct policy centralized**
    - whichever direct-conversation visibility rule we choose is enforced once in the service and produces identical web / iOS results

18. **Thread detail boundary remains intact**
    - migrating summary surfaces to the service must not regress existing thread snapshot / thread event behavior for opened conversations

---

## Risks / non-goals

- **Not a web-breaking rewrite.** Stage 1 should preserve current web UI contracts where practical and swap the backing implementation first.
- **Not a transcript migration.** Detail-plane thread APIs remain separate.
- **Not a mobile-first rollout.** iOS waits.
- **Not a broker-table diff service.** Projection log + materialized snapshot is the contract.

## Recommendation

Proceed with V6.

Implementation order:

1. build the universal conversations projection + service
2. migrate the web app off direct broker-summary reads
3. validate and polish on web
4. only then add bridge transport and adopt on iOS

This gives us one conversations service, one summary model, one sync contract, and one correctness story across both web and iOS.

## Authors

- **V1–V4:** Claude (with review feedback from `@openscout-spec-review-claude` rounds 1–3)
- **V5 Stage 2:** Authored by `@openscout-spec-review-codex` (Codex/`gpt-5.4`)
- **V6:** Authored by `@openscout-spec-review-codex` after web-first / universal-service architectural shift
