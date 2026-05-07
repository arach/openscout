# SCO-027: Durable Action Ledger

## Status

Proposed.

## Proposal ID

`sco-027`

## Intent

Define the smallest durable state primitive Scout can use under asks, flights,
deliveries, approvals, and future long-running work without becoming a generic
workflow engine.

The primitive is a **ledger** for one logical action. It records claims, attempts,
checkpoints, signals, and terminal state changes as broker-owned facts.

This is deliberately smaller than SCO-007 run graphs. A run graph may later use
this primitive, but asks and delivery should not wait for a full recipe/run
model before getting stronger database semantics.

## Context

Scout already has product nouns:

- `InvocationRequest` for a requested ask or action
- `FlightRecord` for the request lifecycle
- `DeliveryIntent` and `DeliveryAttempt` for transport-specific delivery
- collaboration records for questions, work items, approvals, and ownership

The gap is that some critical lifecycle rules are still implemented in route
handlers and worker code:

- claim and ack semantics
- lease expiry and stale owners
- retry and attempt accounting
- duplicate request handling
- first-write-wins answers or approvals
- crash recovery checkpoints

Those rules should be store-level semantics, not ad hoc read-modify-write code.

## Decision

Scout SHOULD add a durable action ledger primitive with five concepts:

| Concept | Meaning |
|---|---|
| **Action** | One logical thing Scout is trying to advance |
| **Attempt** | One concrete execution or dispatch try for that action |
| **Lease** | The current owner allowed to advance the action |
| **Checkpoint** | A named durable recovery fact |
| **Signal** | A first-write-wins external event that may unblock the action |

The ledger is not a new public product model. It is a store-level primitive that
projects into existing Scout records.

## Non-Goals

- Replacing `InvocationRequest`, `FlightRecord`, `DeliveryIntent`, or work items.
- Building a deterministic workflow runtime.
- Requiring PostgreSQL, Cloudflare Durable Objects, or any hosted backend.
- Requiring atomic transactions across machines, brokers, or cloud cells.
- Moving harness transcripts into Scout-owned durable state.

## Minimal Model

### Action

```ts
type DurableAction = {
  id: string;
  kind: "ask" | "message_delivery";
  subjectId: string;
  authorityCellId: string;
  state:
    | "pending"
    | "leased"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "cancelled";
  idempotencyKey?: string;
  leaseOwner?: string;
  leaseGeneration: number;
  leaseExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
};
```

The first implementation intentionally limits action kinds to `ask` and
`message_delivery`. Work items, questions, and approvals can become ledger
actions later; in the first slice they should appear as checkpoints or signals
on an ask or delivery action.

### Attempt

```ts
type DurableAttempt = {
  id: string;
  actionId: string;
  attempt: number;
  state: "pending" | "running" | "completed" | "failed" | "cancelled";
  leaseGeneration: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
};
```

### Checkpoint

```ts
type DurableCheckpoint = {
  actionId: string;
  name: string;
  payload?: unknown;
  ownerAttemptId?: string;
  createdAt: number;
};
```

`(actionId, name)` is unique. Repeating the same checkpoint returns the existing
checkpoint.

### Signal

```ts
type DurableSignal = {
  actionId: string;
  name: string;
  payload?: unknown;
  emittedAt: number;
};
```

`(actionId, name)` is unique. The first signal wins. Duplicate emits return the
existing signal.

## Required Commands

The primitive should expose semantic commands, not direct table mutation:

```ts
createOrGetAction(input)
claimAction({ actionId, owner, leaseMs })
heartbeatAction({ actionId, owner, generation, leaseMs })
startAttempt({ actionId, owner, generation })
commitCheckpoint({ actionId, name, payload })
emitSignalOnce({ actionId, name, payload })
transitionAction({ actionId, owner, generation, nextState })
completeAttempt({ attemptId, owner, generation })
failAttempt({ attemptId, owner, generation, error })
```

Every lease-protected command must include the expected owner and generation.
Stale owners must not be able to complete newer work.

## Event Log

Each command appends one or more compact facts to the broker journal:

- `action.created`
- `action.claimed`
- `action.heartbeat`
- `attempt.started`
- `checkpoint.committed`
- `signal.emitted`
- `attempt.completed`
- `attempt.failed`
- `action.transitioned`

The first implementation can persist coarse `durable.*.record` entries when the
record carries the same semantic result. The important contract is that replay
reconstructs the command-visible state and first-write-wins constraints.

The durable fact log is canonical. In the local broker that fact log is the
file journal; in a future Durable Object authority cell it would be DO storage.
SQLite is the local query and atomic transition surface. If a SQLite projection
lags or is rebuilt, replaying the fact log wins. Transit moves facts between
authority cells later; it does not become the source of truth.

## Mapping To Existing Scout Records

| Ledger | Scout projection |
|---|---|
| `Action(kind: "ask")` | `InvocationRequest` and `FlightRecord` |
| `Action(kind: "message_delivery")` | `DeliveryIntent` |
| `Attempt` | `FlightRecord` attempt or `DeliveryAttempt` |
| `Checkpoint` | durable recovery point, not usually user-visible |
| `Signal` | reply, human answer, approval decision, peer ack, cancel request |
| `Lease` | broker worker, agent session, issue runner, or relay worker ownership |

Existing public records stay intact. The ledger makes their transitions
consistent and recoverable.

## Local-First Storage Order

1. Append semantic facts to the broker file journal.
2. Project into SQLite tables with unique constraints and indexed claim queries.
3. Build public projections such as flights, inbox, activity, and work detail.
4. Add transit adapters only after the local primitive is correct.

## Durable Objects Compatibility

The primitive must be cell-oriented:

```ts
authorityCellId = `node:${nodeId}`;
```

Today the authority cell is the local broker. Later it can be a Cloudflare
Durable Object, another broker, or a shard.

Rules for future Durable Object compatibility:

1. One action has one authority cell.
2. Commands are the API boundary.
3. No command requires a cross-cell transaction.
4. Idempotency, checkpoints, and signals use stable logical keys.
5. Projections are disposable caches.
6. Transit uses outbox/inbox facts, not shared mutable rows.

This maps cleanly to Durable Objects because a DO can be the single writer for
one cell while still exposing the same commands.

## First Implementation Slice

Keep the first slice small and prove the primitive before broad integration:

1. Add a `durable-actions.ts` transition module with pure command/result types.
2. Add SQLite-backed operations for `createOrGetAction`, `claimAction`,
   `startAttempt`, `commitCheckpoint`, and `emitSignalOnce`.
3. Add journal replay for durable facts so SQLite can be rebuilt.
4. Use `message_delivery` or peer delivery as the first integration candidate,
   then graduate `ask`/flight integration after the store semantics are covered.
5. Keep the existing `invocations`, `flights`, `deliveries`, and inbox APIs
   stable while the ledger proves itself.

## Acceptance Criteria

- Duplicate action creation by idempotency key returns the original action.
- A stale lease generation cannot complete or fail an action.
- An expired non-terminal lease can be reclaimed with a higher generation.
- Concurrent attempt-number races fail without overwriting the existing attempt.
- Duplicate checkpoint and signal commits are first-write-wins.
- A broker restart can replay the file journal and rebuild action state.
- Before SCO-027 is accepted beyond the foundation slice, at least one
  message-delivery or ask/flight path uses the primitive without changing public
  API.
