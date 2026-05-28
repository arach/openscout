# SCO-053: Resumable Work Checkpoints

## Status

Proposed.

## Proposal ID

`sco-053`

## Intent

Define a Scout-native checkpoint model for long-running work that can pause,
resume, recover after broker restart, and ask for human input without becoming a
general workflow engine or importing external harness memory as canonical state.

The borrowed idea is workflow snapshots: save enough execution state at stable
boundaries that a run can resume intentionally. The Scout version is narrower:
checkpoints belong to broker-owned invocations, flights, work items, questions,
and unblock records. They reference harness-owned material; they do not absorb
it.

## Context

Scout already has durable requests and lifecycle records:

- `InvocationRequest`
- `FlightRecord`
- `DeliveryIntent`
- collaboration records such as `question` and `work_item`
- durable unblock requests
- the durable action ledger proposed in [`sco-027`](./sco-027-durable-action-ledger.md)

The remaining gap is resumability. A flight can be waiting or failed, but the
system does not yet have one small record that answers:

1. What stable point was reached?
2. What input or condition is required next?
3. Which facts are needed to resume safely?
4. Which session, environment, and capability grants were involved?
5. Which source material is referenced but not owned by Scout?

Without this record, resume behavior gets recreated ad hoc in route handlers,
host adapters, and UI surfaces.

## Decision

Scout SHOULD introduce broker-owned resumable checkpoints.

A checkpoint is a compact recovery fact for one Scout-owned subject. It records
the state needed to continue a broker-owned flow, plus bounded references to
observed harness material. It is not a serialized JavaScript closure, not a
model context dump, and not a transcript import.

Checkpoints SHOULD be append-only facts with a materialized latest view per
subject. The first implementation can store checkpoints directly in SQLite as
long as the broker journal can replay them.

## Principles

1. Checkpoint broker-owned work, not external harness memory.
2. Store resume intent and required inputs explicitly.
3. Reference large or harness-owned material by cursor, artifact id, or source
   path.
4. Make resume eligibility explainable before attempting it.
5. Preserve human input requirements as first-class unblock records.
6. Treat checkpoint replay as recovery, not time travel through every model
   token.
7. Keep the first slice compatible with the durable action ledger.

## Checkpoint Record

```ts
export interface ScoutResumableCheckpoint {
  id: ScoutId;
  subject:
    | { kind: "invocation"; id: ScoutId }
    | { kind: "flight"; id: ScoutId }
    | { kind: "work_item"; id: ScoutId }
    | { kind: "question"; id: ScoutId }
    | { kind: "unblock_request"; id: ScoutId };
  checkpointType:
    | "started"
    | "routed"
    | "delivered"
    | "awaiting_ack"
    | "awaiting_human"
    | "awaiting_external"
    | "paused"
    | "retry_ready"
    | "handoff_ready"
    | "terminal";
  sequence: number;
  createdAt: number;
  createdBy: "broker" | "runtime" | "adapter" | "operator" | "agent";
  stateDigest: ScoutCheckpointDigest;
  resume: ScoutCheckpointResumePolicy;
  refs: ScoutCheckpointReference[];
  placementId?: ScoutId;
  actionId?: ScoutId;
  attemptId?: ScoutId;
  metadata?: MetadataMap;
}
```

```ts
export interface ScoutCheckpointDigest {
  summary: string;
  status:
    | "running"
    | "waiting"
    | "blocked"
    | "retryable"
    | "handoff_ready"
    | "completed"
    | "failed"
    | "cancelled";
  lastKnownOwner?: ScoutId;
  nextOwner?: ScoutId | "operator" | "external";
  requiredInputs?: ScoutRequiredInput[];
  compatibilityWarnings?: string[];
}
```

```ts
export interface ScoutCheckpointResumePolicy {
  mode:
    | "not_resumable"
    | "resume_same_session"
    | "resume_compatible_session"
    | "retry_delivery"
    | "continue_after_input"
    | "fork_from_state"
    | "manual_only";
  reason: string;
  requiresInputIds?: ScoutId[];
  expiresAt?: number;
  maxResumeAttempts?: number;
}
```

## References

Checkpoint references are intentionally typed and bounded:

```ts
export type ScoutCheckpointReference =
  | { kind: "message"; messageId: ScoutId }
  | { kind: "flight"; flightId: ScoutId }
  | { kind: "delivery"; deliveryId: ScoutId }
  | { kind: "artifact"; artifactId: ScoutId }
  | { kind: "observed_event"; eventId: string; cursor?: string }
  | { kind: "harness_source"; harness: AgentHarness; sessionId?: string; cursor?: string; path?: string }
  | { kind: "environment"; placementId: ScoutId }
  | { kind: "capability_grant"; grantId: ScoutId }
  | { kind: "unblock_request"; unblockRequestId: ScoutId };
```

References make the resume story auditable without copying large command output,
model messages, or provider transcript bodies into checkpoint records.

## Resume Evaluation

Before resuming, the broker SHOULD evaluate:

1. Does the checkpoint still exist and belong to the requested subject?
2. Is the checkpoint's resume mode supported by the current runtime?
3. Are required human inputs resolved?
4. Is the original or compatible execution environment available?
5. Are required capability grants still valid?
6. Is the referenced harness material still available if the resume path needs
   it?
7. Has the resume attempt limit or expiry been reached?

The result should be typed:

```ts
export type ScoutCheckpointResumeDecision =
  | { decision: "allow"; checkpointId: ScoutId; mode: ScoutCheckpointResumePolicy["mode"] }
  | { decision: "deny"; checkpointId: ScoutId; reason: string; remediation?: string }
  | { decision: "needs_input"; checkpointId: ScoutId; unblockRequestIds: ScoutId[] }
  | { decision: "needs_environment"; checkpointId: ScoutId; remediation: string };
```

## Relationship To Human Input

If work pauses for an operator, the checkpoint should not be the approval UI.
The checkpoint records that the work is waiting. A durable unblock request owns
the operator-facing action.

The checkpoint links to the unblock request. When the unblock request resolves,
the broker can evaluate the checkpoint and continue with the supplied answer,
approval, denial, or dismissal.

## Relationship To Session Forking

SCO-049 defines excellent session states as reusable fork sources. Checkpoints
are lower-level recovery points. A checkpoint MAY be promoted into an excellent
state, but only after a compact handoff is authored or derived.

In other words:

- checkpoint: "we can recover this known point"
- excellent state: "this is worth reusing for future work"

## Non-Goals

- building a generic workflow engine
- serializing arbitrary process memory
- making checkpoints a full transcript store
- guaranteeing native provider session resume across all harnesses
- implementing cross-machine consensus for resume state
- replacing `FlightRecord`, work items, questions, or unblock records

## Implementation Sequence

1. Add protocol types for checkpoints, references, resume policies, and resume
   decisions.
2. Add broker persistence and journal facts:
   - `checkpoint.created`
   - `checkpoint.superseded`
   - `checkpoint.resume_evaluated`
   - `checkpoint.resumed`
   - `checkpoint.resume_failed`
3. Create checkpoints for ask delivery boundaries: routed, delivered, awaiting
   ack, waiting for human, completed, failed.
4. Link durable unblock requests to waiting checkpoints.
5. Add a `scout checkpoint inspect <id>` diagnostic command or equivalent
   broker read endpoint.
6. Add resume support for one narrow path: continue after broker-owned human
   input.
7. Later, integrate retry and fork-from-state paths.

## Acceptance Criteria

- A flight can expose its latest checkpoint and checkpoint history.
- A waiting checkpoint links to the unblock request that owns the human action.
- Resume decisions are typed and include remediation when denied.
- Checkpoints reference harness-owned source material instead of copying it.
- Broker restart does not lose checkpoint state.
- The first resume path works without a new workflow engine.

## Relationship To Other Proposals

- [`sco-027`](./sco-027-durable-action-ledger.md) supplies lower-level action,
  attempt, checkpoint, and signal semantics.
- [`sco-039`](./sco-039-durable-invocation-and-delivery-lifecycle.md) defines
  the invocation and delivery lifecycle this proposal checkpoints.
- [`sco-042`](./sco-042-harness-event-normalization-and-replay-boundary.md)
  defines observed event references.
- [`sco-049`](./sco-049-session-forking-and-excellent-session-states.md)
  defines the higher-level reusable state model.
