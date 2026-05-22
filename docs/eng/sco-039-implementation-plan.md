# SCO-039: Implementation Plan

Companion to
[sco-039-durable-invocation-and-delivery-lifecycle.md](./sco-039-durable-invocation-and-delivery-lifecycle.md).

## Status

Draft.

## Intent

Land the first implementation of the durable invocation and delivery lifecycle
without inventing a second workflow runtime.

SCO-027 has already established the durable action ledger tables, protocol
types, and store-level lease/idempotency commands. SCO-039 should use that
foundation to make asks, flights, and delivery attempts inspectable from one
consistent read model while keeping current public ask, message, and delivery
APIs stable.

## What This Plan Optimizes For

- one broker-owned lifecycle projection for invocation and delivery status
- clear separation between invocation execution state and outcome delivery
  state
- durable ids that survive requester disconnects, host restarts, and peer
  retries
- no migration of external harness transcripts into Scout-owned message history
- small integration slices that can be verified against current broker behavior

## Current Shape

The repo already has the important pieces, but they are not yet joined by a
single lifecycle contract.

- `packages/protocol/src/invocations.ts` defines `InvocationRequest`,
  `FlightRecord`, and `FlightState`.
- `packages/protocol/src/deliveries.ts` defines `DeliveryIntent` and
  `DeliveryAttempt`.
- `packages/protocol/src/durable-actions.ts` defines ledger action, attempt,
  checkpoint, signal, claim, and heartbeat types.
- `packages/runtime/src/schema.ts` and `packages/runtime/src/sqlite-store.ts`
  persist durable ledger records and enforce idempotency, leases, attempts, and
  first-write-wins checkpoints/signals.
- `packages/runtime/src/broker-daemon.ts` still records invocations, flights,
  and delivery updates directly through `recordInvocationDurably`,
  `recordFlightDurably`, `acceptBrokerDelivery`, `executeLocalInvocation`, and
  `updateDeliveryStatusDurably`.
- `packages/runtime/src/peer-delivery.ts` already treats peer reachability as a
  delivery lifecycle with attempts, retry windows, leases, and terminal
  failures.
- `/v1/invocations/:id` returns an invocation-local snapshot, but there is not
  yet a first-class lifecycle projection API.

## End-State Ownership

### Protocol

Owns public lifecycle snapshot shapes and state vocabularies.

It should add:

- `ScoutInvocationLifecycle`
- `ScoutOutcomeDelivery`
- `ScoutTerminalResult`, restricted to compact broker-owned terminal metadata
- terminal waiting-on helper types if they are not already reusable
- helpers for deriving lifecycle state from existing flight and delivery
  records

### Runtime Store

Owns durable facts and queryable projections.

It should:

- keep ledger command semantics in SQLite and journal replay
- provide read helpers that join invocation, flight, durable action, delivery,
  attempts, collaboration, and dispatch records
- avoid requiring callers to reconstruct lifecycle state from raw events

### Broker

Owns lifecycle advancement.

It should:

- create an `ask` durable action when a consult invocation is accepted
- create a `message_delivery` durable action for delivery work that can retry,
  be claimed, or dead-letter
- use the durable action ledger as the single claim authority for retryable
  delivery work; delivery rows are compatibility projections, not a second
  lease source
- mirror execution transitions into the existing `FlightRecord` API until all
  consumers move to lifecycle snapshots
- keep target acknowledgement distinct from final completion

### Surfaces

Own rendering and operator affordances only.

CLI, MCP, desktop, web, mobile, and mesh should read the same broker lifecycle
projection rather than deriving state from separate snapshots.

## Pre-Implementation Decisions

These decisions close the review blockers and should not be reopened during the
first implementation pass.

1. `expired` is a read-time derived invocation state in 0.39. The lifecycle
   projection may return `expired` when `expiresAt < now()`, but no background
   sweeper writes `expired` durably in this release.
2. `/v1/invocations/:id/lifecycle` is the first lifecycle read endpoint. The
   existing `/v1/invocations/:id` snapshot stays compatibility-only.
3. `invocations_wait` continues to wait on invocation execution state only:
   `completed`, `failed`, `cancelled`, or derived `expired`. Delivery state is
   included in the returned lifecycle snapshot but never extends the wait.
4. The durable action ledger is the single authority for delivery claims.
   `DeliveryIntent.status`, `leaseOwner`, and `leaseExpiresAt` are compatibility
   projections once a delivery has an associated action.
5. Ask recovery joins through the durable action idempotency key. `actionId` may
   be copied into invocation metadata because invocation and initial flight are
   committed atomically, but `FlightRecord.metadata.actionId` must not be the
   recovery join predicate.
6. Terminal flight writes after ask claims must be gated by first-write-wins
   durable signals. Only the owner/generation that wins the terminal signal can
   project the terminal `FlightRecord`.
7. Peer broker acknowledgement is an authority handoff. The lifecycle read model
   must expose that handoff separately from local endpoint acknowledgement.

## Terminal Result Contract

`ScoutTerminalResult` is a compact Scout-owned summary. It must never contain a
full harness transcript, raw stdout/stderr, or an unbounded agent reply.

The first protocol type should stay close to:

```ts
export interface ScoutTerminalResult {
  state: "completed" | "failed" | "cancelled" | "expired";
  summary?: string; // broker-generated, <= 256 chars
  errorClass?: string;
  exitCode?: number;
  completedAt: number;
  sourceRecordId?: ScoutId;
  metadata?: MetadataMap;
}
```

Full agent output remains available through the existing message/flight
compatibility fields while those surfaces exist, or through harness-owned
transcripts. Lifecycle records should store only ids, timestamps, error classes,
and bounded summaries.

## Track 1: Lifecycle Protocol And Projection

### Goal

Define the read model first so every later integration has a stable target.

### Scope

- Add lifecycle snapshot types to `packages/protocol`.
- Keep current `FlightState` and `DeliveryStatus` values backward-compatible.
- Add projection helpers that map:
  - invocation `queued` or `waking` to lifecycle `queued` or `dispatching`
  - flight `running` to lifecycle `working`
  - flight `waiting`, `completed`, `failed`, and `cancelled` directly
  - `expired` only as a read-time derived state from `expiresAt < now()`
- Add delivery projection helpers that normalize current statuses:
  - `pending` and `accepted` -> `pending`
  - `leased` -> `leased`
  - `sent` and `acknowledged` -> `sent`
  - `peer_acked` -> `dispatched_to_peer`, with `peerNodeId` and peer flight
    metadata preserved when available
  - `deferred` -> `retrying`
  - `failed` -> `dead_lettered` when non-retryable or exhausted
  - `cancelled` -> `suppressed` only when policy intentionally skipped the
    delivery; otherwise expose `cancelled` as a distinct terminal delivery
    state
- Include source record ids and metadata in the projection so the UI can link
  back to invocation, flight, work item, dispatch, delivery, and attempt
  records.

### Completion Criteria

- Protocol tests cover state projection for local success, local failure,
  waiting requester timeout, peer ack with later completion, peer retry, and
  delivery failure.
- Existing package consumers compile without needing to adopt the new read
  model immediately.

## Track 2: Broker Read APIs

### Goal

Expose one durable status path for asks and outcome delivery.

### Scope

- Add broker read functions for:
  - `getInvocationLifecycle(invocationId)`
  - `listPendingDeliveries({ transport?, state? })`
- Back these functions from current snapshot, journal delivery attempts, and
  durable action state.
- Add `/v1/invocations/:id/lifecycle` with the lifecycle projection while
  keeping the existing snapshot response stable.
- Defer lifecycle-specific stream frames. For 0.39, clients can poll the
  lifecycle endpoint and continue using existing `flight.updated` and
  `delivery.state.changed` events as refresh hints.
- Wire MCP `invocations_get` and `invocations_wait` to prefer the lifecycle
  projection while preserving existing `flight` fields for compatibility.
- Keep `invocations_wait` bounded on invocation execution state only. Delivery
  state is snapshot context, not part of the wait condition.

### Completion Criteria

- A caller with only `invocationId` or `flightId` can read current lifecycle
  state after the original request has disconnected.
- `invocations_wait` remains bounded and returns latest state on timeout.
- Existing `flight` polling behavior remains compatible.

## Track 3: Ask Ledger Integration

### Goal

Make consult invocation execution lease-protected and recoverable without
changing the caller-facing ask API.

### Scope

- In `acceptInvocationDurably`, create or get a durable `ask` action keyed by a
  stable idempotency key derived from request id, requester, target, and
  conversation/message ids.
- Add a store helper to get durable actions by `(authorityCellId, kind,
  idempotencyKey)` before any broker code depends on idempotency.
- Store `actionId` in invocation metadata during the atomic invocation/flight
  commit. Do not use `FlightRecord.metadata.actionId` as a recovery join.
- In `dispatchAcceptedInvocation`, claim the `ask` action before local execution
  or peer forwarding.
- In `executeLocalInvocation`, start a durable attempt when the target endpoint
  acknowledges the task, heartbeat while long waits are active when practical,
  and transition the action on `waiting`, `completed`, `failed`, or `cancelled`.
- Emit first-write-wins durable signals for terminal result, cancel, requester
  timeout, and stale-owner rejection.
- Gate terminal `recordFlightDurably` writes behind the durable terminal signal.
  Non-terminal projection writes can remain direct during the compatibility
  period.

### Completion Criteria

- Duplicate ask submission with the same idempotency key returns the original
  action/lifecycle instead of creating a duplicate terminal delivery.
- A broker restart can recover the action and expose whether the ask is pending,
  leased, running, waiting, or terminal.
- A stale execution owner cannot overwrite a newer terminal result.
- Current ask tests still pass, with new tests covering ledger action creation,
  idempotency-key recovery, claim loss, first-write-wins terminal signals, and
  stale owner rejection.

## Track 4: Delivery Ledger Integration

### Goal

Move retryable delivery work onto `message_delivery` actions while preserving
current delivery rows and inbox semantics.

### Scope

- Create `message_delivery` actions when recording delivery intents that can be
  claimed or retried.
- Store `actionId`, retry budget, and first queued timestamp in delivery
  metadata.
- Change `claimDeliveryDurably` to use ledger claim semantics. There is no
  second delivery-row lease authority for ledger-backed deliveries.
- Update `updateDeliveryStatusDurably` to transition the durable action when
  delivery reaches running, retrying, completed, failed, cancelled, or
  suppressed states.
- Keep `DeliveryIntent.status` as the compatibility projection from the durable
  action and delivery attempts.
- Integrate peer delivery first because it already has explicit attempt
  accounting and retry windows.
- Defer mobile push, desktop notification, and web-specific delivery transports
  until the peer path proves the ledger contract.

### Completion Criteria

- Peer delivery attempts are reflected in both delivery attempts and durable
  ledger attempts.
- Retry exhaustion produces an explicit terminal delivery state in the lifecycle
  read model.
- Claim conflicts and expired leases are covered by store tests and
  peer-delivery worker tests.
- Peer authority handoff is visible as `dispatched_to_peer` or equivalent
  peer-owned lifecycle metadata, not collapsed into a generic sent state.

## Track 5: Surface Adoption

### Goal

Make stuck, waiting, failed, and delivery-failed states visible everywhere an
ask can be followed.

### Scope

- Update CLI follow/status output to show lifecycle state, target ack, final
  result, and delivery state separately.
- Update MCP `invocations_get` and `invocations_wait` outputs with lifecycle
  fields while keeping old fields. `invocations_wait` must not wait on delivery
  completion.
- Update `broker_feed` and label feeds to include lifecycle-derived summaries
  for active, waiting, failed, and dead-lettered work.
- Add web/desktop/mobile rendering only after the CLI/MCP read path is stable.

### Completion Criteria

- A user can tell whether an ask is unaccepted, acknowledged but working,
  waiting, terminal, or terminal-but-undelivered.
- Label-scoped release/goal briefs summarize lifecycle state without inventing
  a label lifecycle.

## Track 6: Retention And Backfill

### Goal

Keep terminal lifecycle summaries useful without retaining external harness
transcripts as Scout-owned state.

### Scope

- Define retention behavior for terminal durable actions, attempts, signals,
  and delivery attempts.
- Preserve compact terminal summaries, ids, timestamps, and error classes.
- Avoid persisting full external transcript detail in lifecycle records.
- Add a migration/backfill path that projects existing invocations and
  deliveries into lifecycle snapshots without pretending old records had ledger
  actions.

### Completion Criteria

- Existing databases can read lifecycle snapshots for old flights and
  deliveries.
- New ledger-backed records expose stronger ownership and retry data.
- Retention tests verify summaries remain while transcript-like detail is not
  copied into Scout-owned lifecycle records.

## Parallel Work Split

### Codex Owner

Owns protocol, store, broker implementation, and narrow tests.

Initial write areas:

- `packages/protocol/src/invocations.ts`
- `packages/protocol/src/deliveries.ts`
- `packages/protocol/src/durable-actions.ts`
- `packages/protocol/src/index.ts`
- `packages/runtime/src/sqlite-store.ts`
- `packages/runtime/src/broker-daemon.ts`
- `packages/runtime/src/peer-delivery.ts`
- focused tests in `packages/protocol/src/*test.ts` and
  `packages/runtime/src/*test.ts`

### Cloud Reviewer

Reviews the plan and implementation for:

- whether lifecycle state and delivery state are still cleanly separated
- accidental transcript ownership violations
- stale lease and duplicate terminal-result holes
- API compatibility hazards in CLI/MCP/broker read paths
- test cases missing from the root-cause failure modes

## First Implementation Slice

1. Add protocol lifecycle projection types, including `ScoutTerminalResult`,
   peer handoff metadata, and projection helper signatures.
2. Add `getDurableActionByIdempotencyKey` or equivalent store support.
3. Add ask durable action creation in `acceptInvocationDurably`; store `actionId`
   in invocation metadata and make duplicate asks return the existing action and
   lifecycle.
4. Add runtime lifecycle read projection and expose it at
   `/v1/invocations/:id/lifecycle`.
5. Add ask claiming in `dispatchAcceptedInvocation` before background task
   launch.
6. Gate local terminal flight projection through durable terminal signals so
   stale owners cannot overwrite newer terminal results.
7. Integrate peer delivery with `message_delivery` actions and ledger-backed
   claim authority.
8. Expand MCP and CLI status output after the read model is proven.

## Required Tests

- Split terminal write: two owners attempt different terminal signals for the
  same ask action; first write wins.
- Restart mid-claim: a leased action with an expired lease can be reclaimed, and
  the old generation cannot complete it.
- Stale background task: older local execution completes after a newer
  generation owns the action and cannot project a terminal flight.
- Completed invocation plus dead-lettered delivery: invocation state remains
  completed while outcome delivery is dead-lettered.
- Peer handoff then peer offline: local lifecycle shows peer-owned handoff and
  does not invent local failure without an expiry or remote terminal signal.
- Duplicate ask idempotency: same logical ask returns the original action,
  flight, and lifecycle.
- Suppressed vs cancelled delivery: policy-suppressed delivery is distinguishable
  from caller-cancelled work.

## Verification

Run the narrowest relevant checks per slice:

```bash
npm --prefix packages/protocol run check
npm --prefix packages/runtime run check
bun test packages/runtime/src/sqlite-store.test.ts
bun test packages/runtime/src/broker-daemon.test.ts
bun test packages/runtime/src/peer-delivery.test.ts
```

For UI-facing adoption, add:

```bash
bun run --cwd packages/web build:server
bun run --cwd apps/desktop check
```

## Open Questions

1. Which delivery transports beyond `peer_broker` are required for the first
   0.39 ship target?
2. Should terminal delivery failures create operator unblock requests
   immediately, or only appear in lifecycle/feed surfaces for the first slice?
