# SCO-039: Durable Invocation And Delivery Lifecycle

## Status

Proposed.

## Proposal ID

`sco-039`

## Intent

Define the OpenScout lifecycle for requests that expect work and for the
messages or notifications that report their outcome.

The goal is a compact, broker-owned state model that makes asks, replies,
delivery attempts, retries, and terminal results inspectable without turning
Scout into a transcript store or a generic workflow engine.

## Context

OpenScout already has the core nouns:

- `MessageRecord` for broker-owned conversation messages.
- `InvocationRequest` for explicit requests for agent work.
- `FlightRecord` for invocation lifecycle.
- `DeliveryIntent` and delivery attempts for transport-specific fan-out.
- `QuestionRecord` and `WorkItemRecord` for collaboration state.
- SCO-027's durable action ledger as the store-level primitive for claims,
  attempts, checkpoints, signals, and terminal state.

The missing product contract is the standard lifecycle that every surface should
expect when one agent asks another agent or when Scout must deliver a result to
a human or peer.

## Decision

OpenScout SHOULD treat an ask and its result delivery as a durable lifecycle
with explicit phases:

1. **Record request.** Persist the caller message and invocation intent.
2. **Resolve target.** Resolve the concrete target agent, endpoint, and
   compatible session requirement.
3. **Plan delivery.** Create one or more delivery intents.
4. **Claim execution.** Lease the ask to a broker worker, runtime adapter, or
   target endpoint.
5. **Acknowledge.** Record whether the target accepted, rejected, or failed to
   wake.
6. **Run or wait.** Track active work, waiting state, progress, and stale
   ownership.
7. **Record terminal result.** Mark the invocation and flight as completed,
   failed, cancelled, or expired.
8. **Deliver outcome.** Attempt human-facing and agent-facing delivery until
   terminal delivery state is reached.
9. **Replay status.** Let clients read the current state without reconstructing
   it from logs or harness transcripts.

This lifecycle SHOULD be represented as broker-owned records and durable action
ledger facts. It SHOULD NOT rely on a single open HTTP request, SSE stream, host
process, or UI tab staying alive.

## Principles

1. The broker records lifecycle facts; surfaces render them.
2. Delivery is state, not a best-effort side effect.
3. Every long-running ask has a durable id that can be followed.
4. A target acknowledgement is distinct from final completion.
5. A failed wake or unavailable session is a lifecycle state, not silent limbo.
6. Retries must be explicit and bounded.
7. Idempotency keys should protect against duplicate asks and duplicate final
   deliveries.
8. Harness transcript detail remains observed material, not Scout-owned
   message history.

## Minimal State Machine

An invocation lifecycle SHOULD use this public state vocabulary:

| State | Meaning |
|---|---|
| `queued` | The broker accepted the request and has not started delivery. |
| `dispatching` | The broker is resolving and delivering the request to a target. |
| `acknowledged` | The target endpoint accepted the request. |
| `working` | Work is actively being performed. |
| `waiting` | Work is blocked on a human, peer, approval, artifact, or condition. |
| `completed` | The target produced a terminal result. |
| `failed` | The request cannot continue without a new request or operator action. |
| `cancelled` | The caller, target, or operator cancelled the request. |
| `expired` | The request exceeded its lease, timeout, or retention window. |

Delivery attempts SHOULD use a separate state vocabulary:

| State | Meaning |
|---|---|
| `pending` | Delivery is planned but unclaimed. |
| `leased` | A worker owns the next attempt. |
| `sent` | The transport accepted the message or notification. |
| `retrying` | The transport failed with a retryable error. |
| `dead_lettered` | Delivery failed with a non-retryable or exhausted error. |
| `dispatched_to_peer` | A peer broker accepted authority for the invocation or delivery. |
| `suppressed` | Delivery was intentionally skipped by policy or caller option. |
| `cancelled` | Delivery was cancelled by the caller, target, or operator. |

Invocation state and delivery state MUST remain separate. An ask can complete
successfully while notification delivery is still retrying or dead-lettered.
Peer broker acknowledgement MUST remain distinguishable from local endpoint
acknowledgement because it is an authority handoff, not a final delivery or
execution result.

## Required Records

The first implementation SHOULD project the lifecycle into existing protocol
records plus a small amount of additional delivery state.

```ts
export interface ScoutInvocationLifecycle {
  invocationId: ScoutId;
  flightId: ScoutId;
  state: ScoutInvocationState;
  targetAgentId?: ScoutId;
  targetEndpointId?: ScoutId;
  peerNodeId?: ScoutId;
  peerFlightId?: ScoutId;
  workId?: ScoutId;
  actionId?: ScoutId;
  idempotencyKey?: string;
  acknowledgedAt?: number;
  startedAt?: number;
  completedAt?: number;
  expiresAt?: number;
  lastProgressAt?: number;
  waitingOn?: ScoutWaitingOn;
  terminal?: ScoutTerminalResult;
}
```

```ts
export interface ScoutTerminalResult {
  state: "completed" | "failed" | "cancelled" | "expired";
  summary?: string;
  errorClass?: string;
  exitCode?: number;
  completedAt: number;
  sourceRecordId?: ScoutId;
  metadata?: MetadataMap;
}
```

`ScoutTerminalResult.summary` MUST be a compact broker-owned summary, capped at
256 characters in the first implementation. It MUST NOT contain full harness
stdout, stderr, raw agent output, or external transcript excerpts. If a surface
needs full agent output, it should follow the existing message, flight, or
harness-owned transcript references rather than copying that material into the
lifecycle record.

```ts
export interface ScoutOutcomeDelivery {
  deliveryId: ScoutId;
  subjectKind: "message" | "invocation" | "work_item";
  subjectId: ScoutId;
  transport: "broker" | "mesh" | "desktop" | "mobile_push" | "web" | "cli";
  state: ScoutDeliveryState;
  peerNodeId?: ScoutId;
  peerFlightId?: ScoutId;
  attemptCount: number;
  nextAttemptAt?: number;
  lastError?: ScoutDeliveryError;
  lastAttemptAt?: number;
  deliveredAt?: number;
}
```

## Broker API Shape

Scout SHOULD expose three read paths:

```ts
getInvocationLifecycle(invocationId)
listPendingDeliveries({ transport?, state? })
```

The CLI, desktop app, mobile app, MCP tools, and mesh bridge should use the same
read model rather than each deriving status from different records.

For v0.39, `expired` is a read-time derived invocation state. The broker may
return `expired` when a lease, timeout, or retention deadline is provably past,
but this proposal does not require a background worker that writes durable
`expired` transitions.

## Mapping To Existing Features

| Existing feature | Lifecycle role |
|---|---|
| `ask` | Creates request, invocation, flight, and initial delivery. |
| `invocations_wait` | Reads lifecycle state and optionally waits for changes. |
| `messages_send` | Creates a message plus delivery lifecycle without work. |
| `work_update` | Updates progress, waiting, review, and terminal collaboration state. |
| Mobile push relay | A delivery transport for opaque wakeup notifications. |
| Mesh forwarding | A delivery transport and authority handoff path. |

## Non-Goals

- replacing SCO-027's durable action ledger
- defining a full workflow engine
- storing full harness transcripts as lifecycle events
- requiring a hosted control plane
- requiring exactly-once delivery across mesh peers
- forcing every message to create an invocation

## Implementation Sequence

1. Define protocol types for invocation lifecycle snapshots and delivery state.
2. Project existing ask and message records into the lifecycle read model.
3. Move ask completion and delivery retry bookkeeping onto durable action ledger
   commands.
4. Add CLI and MCP follow paths that report lifecycle state consistently.
5. Add desktop/mobile rendering for stuck, waiting, failed, and dead-lettered
   states.
6. Add retention rules that preserve terminal summaries without preserving
   observed harness transcript detail.

## Acceptance Criteria

- A caller can send an ask and later inspect its current lifecycle from any
  surface.
- Target acknowledgement and final completion are separately visible.
- Failed wake, stale lease, and delivery failure states are explicit.
- Retried delivery attempts are bounded and recorded.
- Duplicate result delivery is prevented by idempotency keys or first-write-wins
  terminal signals.
- No implementation path imports full external harness transcripts as
  first-party Scout messages.
