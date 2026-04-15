# SCO-001: Authority-Owned Thread Events, Remote Watches, and Notifications

## Status

Proposed.

## Proposal ID

`sco-001`

## Intent

Define how Scout should handle cross-node thread notifications without
replicating thread history across machines.

The target outcome is:

- one canonical thread history
- low-latency remote notifications
- replay after disconnect
- clean semantics for remote reply, mention, and "needs attention"

This proposal is intentionally shaped to fit Scout's current broker, event, and
relay foundation instead of introducing a second distributed system.

## Problem

Cross-node communication is already good enough for:

- discovering remote nodes
- finding reachable agents
- sending messages across machines
- carrying on real conversations

The missing piece is what happens after the remote side acts.

When a remote agent replies, or when a remote thread now needs attention, Scout
needs to notify the originating node. But if both nodes persist the same thread
messages, we get the wrong model:

- thread history gets duplicated across brokers
- "who owns the truth?" becomes ambiguous
- replay and unread state drift between nodes
- share-mode and privacy rules become harder to enforce

If we do not replicate history, but also do not define a proper watch/replay
model, the remote node misses reply and attention signals when the connection
drops or a surface reconnects.

The root problem is that we need pub/sub-like event distribution for threads,
but we do not want multi-writer thread storage.

## Decision

Scout should treat thread history and thread notifications as two separate
planes:

- **history plane**: one authority broker owns durable thread state
- **event plane**: interested remote nodes subscribe to lightweight,
  replayable thread events

The durable source of truth stays at `conversation.authorityNodeId`.
Non-authority nodes do not persist mirrored thread history as canonical data.
Instead, they maintain:

- local watcher state
- replay cursors
- attention projections
- optional read-through caches

This preserves a single source of truth while still letting remote nodes react
to new replies, mentions, flight changes, and collaboration updates.

## Normative Language

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as normative requirements.

## Implementation Expectation

This document describes the intended complete design.

It is not a phased rollout plan. The implementation should aim to land this
model as one coherent cutover:

- authority-owned thread writes
- authority-owned thread event sequencing
- remote watch / replay / snapshot semantics
- subscriber cursor persistence
- notification projection from authority events

## Design Principles

1. **Single authority per thread**
   Durable thread state belongs to exactly one broker.
2. **Request/reply for writes**
   Remote thread writes should target the authority broker and receive an
   explicit acknowledgement or refusal.
3. **Fan-out for notifications**
   Notifications are broadcast to all interested watchers, not load-balanced to
   one worker.
4. **At-least-once event delivery**
   Event consumers must be idempotent.
5. **Replay by sequence**
   Reconnect and catch-up should use stable per-thread sequence numbers.
6. **Share-mode-aware disclosure**
   `local`, `summary`, and `shared` must affect what remote watchers can see.
7. **Fast failure**
   Missing responder, expired lease, and replay-gap overflow should fail
   explicitly instead of hanging.

## What We Should Learn From NATS

This proposal borrows design lessons from NATS, not implementation code.

### Worth Adopting

- **Request/reply instead of hard-wired callbacks**
  A remote writer should send a request to the authority broker and receive a
  correlated response.
- **Explicit no-responder behavior**
  If no authority or no watch handler is available, return a machine-readable
  error quickly.
- **Durable cursor thinking**
  The important persistent state is the subscriber cursor, not a mirrored copy
  of every message.
- **Drain before close**
  Mesh sessions should stop accepting new work, flush what they can, and then
  shut down.
- **Slow-consumer protection**
  If a watcher falls too far behind, force it onto replay/snapshot instead of
  buffering forever.
- **Hierarchical event naming**
  Dot-separated event kinds and RPC methods are easy to inspect and evolve.

### Worth Rejecting For This Problem

- **Queue-group semantics for notifications**
  Notifications are fan-out, not work distribution.
- **A second external source of truth**
  Scout should not add a separate durable message bus before proving the broker
  model is insufficient.
- **Exactly-once ambitions**
  Stable IDs and idempotent consumers are the right tradeoff here.

## Goals

- keep one canonical thread history on the authority broker
- notify interested remote nodes when a thread changes
- support reconnect and catch-up without copying full thread history everywhere
- respect `shareMode`
- keep the protocol small enough to implement on the current broker stack
- align with existing `ControlEvent`, `ConversationDefinition`, and pairing
  replay patterns

## Non-Goals

- multi-writer thread history
- global full-mesh replication of all message records
- exactly-once delivery
- general-purpose third-party pub/sub compatibility
- solving end-to-end authorization beyond current trusted mesh assumptions

## Terminology

| Term | Meaning |
|---|---|
| **Authority broker** | The broker named by `conversation.authorityNodeId` |
| **Subscriber node** | A remote node interested in thread events |
| **Watch** | A leased subscription from a subscriber node to a thread event stream |
| **Cursor** | The highest thread event sequence the subscriber has applied |
| **Replay window** | The range of recent events the authority can resend by sequence |
| **Attention projection** | Local unread / badge / interrupt state derived from thread events |

## Formal Spec

### 1. Thread Authority

1. Each `ConversationDefinition` MUST have exactly one `authorityNodeId`.
2. `authorityNodeId` MUST remain stable for the lifetime of the conversation.
3. The broker at `authorityNodeId` MUST be the only broker that durably appends
   thread-scoped state for that conversation:
   - `MessageRecord`
   - thread-scoped `FlightRecord` projections
   - `CollaborationRecord`
   - `CollaborationEvent`
4. A non-authority node MUST forward thread-scoped writes to the authority
   broker.
5. A non-authority node MAY maintain a read-through cache, but MUST treat it as
   derivative and discardable.
6. The node that creates a conversation SHOULD set itself as the initial
   authority broker unless there is an explicit reason to do otherwise.
7. If an agent on node `B` replies in a conversation owned by node `A`, node
   `B` MUST send the durable reply write back to node `A` instead of treating
   the local append as canonical.

### 2. Conversation Share Modes

Thread watch behavior MUST respect `ConversationDefinition.shareMode`.

| `shareMode` | Remote watch allowed | Remote snapshot allowed | Payload detail |
|---|---|---|---|
| `local` | no | no | none |
| `summary` | yes | yes | summary only |
| `shared` | yes | yes | full thread payload |

Rules:

1. `local` conversations MUST reject remote watch and snapshot requests.
2. `summary` conversations MUST expose event metadata and notification-relevant
   summaries, but MUST NOT expose full message bodies or attachments.
3. `shared` conversations MAY expose full message and collaboration payloads to
   authorized remote nodes.

### 3. Mesh Session

Scout SHOULD maintain one long-lived authenticated mesh session per peer node.

That session SHOULD multiplex:

- request envelopes
- response envelopes
- live thread event envelopes

The exact transport MAY be HTTP + SSE or another broker-supported peer
transport, but the logical model is one peer session, not one socket per
thread.

Mesh sessions SHOULD:

- reconnect automatically with jitter
- re-establish active watches after reconnect
- expose disconnect and reconnect lifecycle callbacks for observability

### 4. Request / Reply Envelope

Thread operations MUST use correlated request/reply semantics.

```ts
type MeshRequestEnvelope<T> = {
  id: string;
  kind: "request";
  method: string;
  sourceNodeId: string;
  targetNodeId: string;
  sentAt: number;
  payload: T;
};

type MeshResponseEnvelope<T> = {
  id: string;
  kind: "response";
  requestId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sentAt: number;
  ok: boolean;
  payload?: T;
  error?: {
    code:
      | "no_responder"
      | "forbidden"
      | "unknown_conversation"
      | "lease_expired"
      | "cursor_out_of_range"
      | "invalid_request"
      | "internal";
    message: string;
  };
};
```

The responder MUST NOT need out-of-band caller state to reply. `requestId`
correlation is sufficient.

### 5. Thread Watch RPC

Scout MUST add the following logical RPCs:

- `thread.watch.open`
- `thread.watch.renew`
- `thread.watch.close`
- `thread.snapshot.get`
- `thread.events.replay`

Suggested request shapes:

```ts
type ThreadWatchOpenRequest = {
  conversationId: string;
  watcherNodeId: string;
  watcherId: string; // stable per local broker watch
  afterSeq?: number;
  leaseMs?: number;
};

type ThreadWatchOpenResponse = {
  watchId: string;
  conversationId: string;
  authorityNodeId: string;
  acceptedAfterSeq: number;
  latestSeq: number;
  leaseExpiresAt: number;
  mode: "summary" | "shared";
};

type ThreadWatchRenewRequest = {
  watchId: string;
  leaseMs?: number;
};

type ThreadWatchCloseRequest = {
  watchId: string;
  reason?: string;
};

type ThreadEventsReplayRequest = {
  conversationId: string;
  afterSeq: number;
  limit?: number;
};

type ThreadSnapshotRequest = {
  conversationId: string;
};
```

Rules:

1. `thread.watch.open` MUST fail for `shareMode=local`.
2. A duplicate open for the same `(conversationId, watcherNodeId, watcherId)`
   SHOULD replace the prior live watch.
3. The authority broker MUST issue a lease with an explicit expiry.
4. The subscriber MUST renew the lease before expiry if it wants live delivery
   to continue.
5. The authority broker MAY garbage-collect expired watches without further
   notice.

### 6. Thread Event Envelope

The authority broker MUST assign a monotonic per-conversation `seq` to every
published thread event.

```ts
type ThreadEventKind =
  | "message.posted"
  | "flight.updated"
  | "collaboration.upserted"
  | "collaboration.event.appended"
  | "attention.requested"
  | "watch.reset_required";

type ThreadNotificationTier = "interrupt" | "badge" | "silent";

type ThreadEventEnvelope = {
  id: string;
  conversationId: string;
  authorityNodeId: string;
  seq: number;
  kind: ThreadEventKind;
  actorId?: string;
  ts: number;
  payload: unknown;
  notification?: {
    tier: ThreadNotificationTier;
    targetActorIds?: string[];
    reason?:
      | "mention"
      | "thread_reply"
      | "next_move"
      | "flight_completed"
      | "flight_failed";
    summary: string;
  };
};
```

Rules:

1. `seq` ordering MUST be stable per conversation.
2. Event delivery is **at least once**.
3. Consumers MUST deduplicate by `(conversationId, seq)` or `id`.
4. `payload` MUST be redacted according to `shareMode`.
5. `attention.requested` SHOULD be a derived event, not a durable copied
   message.

### 7. Subscriber Cursor

The subscriber node MUST persist its own cursor per watched conversation.

```ts
type LocalThreadCursor = {
  conversationId: string;
  authorityNodeId: string;
  lastAppliedSeq: number;
  updatedAt: number;
};
```

Rules:

1. The subscriber MUST advance `lastAppliedSeq` only after it has applied the
   event locally.
2. On reconnect, the subscriber MUST reopen the watch with
   `afterSeq=lastAppliedSeq`.
3. The authority broker MAY track `lastSentSeq` for observability, but the
   subscriber cursor is the durable truth for replay.

### 8. Replay and Snapshot

The authority broker MUST support:

- replay from sequence within a retention window
- explicit snapshot when the replay window is insufficient

Rules:

1. If `afterSeq` is within the replay window, the authority broker MUST replay
   all later events in order before switching to live delivery.
2. If `afterSeq` is too old, the authority broker MUST fail with
   `cursor_out_of_range` or emit `watch.reset_required`.
3. After reset, the subscriber MUST fetch `thread.snapshot.get` and then resume
   from `snapshot.latestSeq`.

Suggested snapshot shape:

```ts
type ThreadSnapshot = {
  conversation: unknown;
  latestSeq: number;
  messages?: unknown[];
  collaboration?: unknown[];
  activeFlights?: unknown[];
};
```

`summary` conversations SHOULD return summary rows instead of full message
payloads.

### 9. Notification Projection

Notifications on subscriber nodes MUST be derived from thread events, not from
mirrored durable message rows.

The authority broker SHOULD set `notification` metadata when any of the
following happens:

- a message replies to a message authored by a remote participant
- a message mentions a remote participant
- a collaboration record now has `nextMoveOwnerId` on a remote node
- a remote-facing flight completes or fails

Default tiers:

| Condition | Tier |
|---|---|
| remote question / approval needed / terminal failure | `interrupt` |
| remote reply / mention / review requested / flight completed | `badge` |
| ordinary state churn | `silent` |

Subscriber nodes MAY map these tiers to:

- OS notifications
- local unread counters
- inbox rows
- attention feeds

### 10. Failure and Backpressure

The system MUST fail explicitly.

Rules:

1. If the authority broker is unavailable, request/reply calls MUST fail fast
   with `no_responder` or transport-level network failure.
2. If a watch lease expires, the authority broker MUST stop live delivery.
3. If a subscriber becomes a slow consumer, the authority broker SHOULD stop
   live delivery and require replay/snapshot rather than buffering without
   bound.
4. Mesh sessions SHOULD support drain semantics:
   - stop accepting new watch opens
   - flush queued responses/events when practical
   - then close

### 11. Security and Authorization

This proposal assumes Scout's existing trusted mesh and paired-node model.

Even in that model:

1. The authority broker MUST validate that the subscriber node is allowed to
   watch the conversation.
2. `shareMode` MUST gate disclosure before payload emission.
3. `summary` mode MUST redact body content and attachment details.

Richer authorization is intentionally out of scope for this iteration.

## Engineering Justification

### Why This Is The Right Model

- It preserves the current local-first broker thesis instead of eroding it.
- It keeps `conversation.authorityNodeId` meaningful.
- It avoids "eventually consistent chat transcripts" between machines.
- It treats notifications as projections of canonical events, which is what
  they are.
- It gives us replay and unread semantics without inventing mirrored storage.

### Why This Is Practical To Ship

Scout already has most of the required ingredients:

- durable broker records
- typed `ControlEvent` shapes
- long-lived event streaming
- a working `seq + replay + snapshot` pattern in the pairing bridge
- request/response oriented broker communication

So the work is not "build a distributed system from zero." The work is:

1. make thread authority explicit in remote write paths
2. add a conversation-scoped event log with per-thread sequence numbers
3. add watch/replay/snapshot RPCs
4. project remote notifications from those events

That is the right level of ambition. It solves the real product problem without
committing us to external infrastructure we do not yet need.

### Why Not Just Add NATS

NATS is a very good reference point, but it is still another operational
substrate. Scout already has a broker, durable storage, and typed protocol
surface. Adding a second durable bus before we have exhausted the native model
would blur ownership instead of clarifying it.

If Scout ever needs an external event substrate, this design still helps: it
defines the semantics we need first, which is the hard part.

## Operational Metrics

The broker SHOULD expose at least:

- active watch count
- watch lease renew failures
- replay requests
- replay reset count
- slow-consumer resets
- average event fan-out latency
- authority write round-trip latency

## Open Questions

1. Should `summary` mode expose a synthetic message summary generated at write
   time, or should it expose only sender + timestamp + "updated" metadata?
2. Do we want one mesh session per peer immediately, or should the first cut be
   HTTP replay plus one SSE stream per authority peer?
3. Should watch state be node-scoped only, with device-level watches kept local
   to the subscriber broker?

## Summary

The correct fix is not to replicate thread history across machines.

The correct fix is:

- keep one authority broker per thread
- route durable writes back to that authority
- publish replayable thread events from that authority
- let remote nodes build notifications and unread state from those events

That gives Scout the behavior we want:

- remote nodes know when an agent replied
- reconnect is deterministic
- thread history stays canonical
- the protocol stays small enough to ship now
