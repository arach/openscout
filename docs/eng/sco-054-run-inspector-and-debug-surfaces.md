# SCO-054: Run Inspector And Debug Surfaces

## Status

Proposed.

## Proposal ID

`sco-054`

## Intent

Define a Scout-native run inspector for debugging agent coordination across the
broker, runtime, harness adapters, and operator surfaces.

The borrowed idea is an agent studio that shows workflow structure, step state,
live logs, and replay context. The Scout version is not a new execution owner.
It is a read and diagnosis surface over broker-owned records and bounded
observed harness material.

## Context

Scout's value depends on being able to answer "what happened?" without making
the operator inspect SQLite rows, terminal scrollback, raw JSONL, and app logs
by hand.

The system already has pieces of the story:

- broker-owned messages, invocations, flights, deliveries, and bindings
- runtime session state and endpoint lifecycle
- observed harness session snapshots in `@openscout/agent-sessions`
- operator attention and unblock records
- proposed execution placement, capability, and checkpoint records

The missing piece is a composed inspector that turns those records into a
single, deterministic debug view.

## Decision

Scout SHOULD introduce a run inspector read model and surface.

A run is the visible execution story for one broker-owned subject, usually an
invocation or work item. The inspector projects that story into:

- a timeline of broker facts and observed harness events
- a graph of related records
- current state and blockers
- source references for raw harness material
- compact logs and metrics
- replay and retry affordances where Scout owns the action

The inspector is not the canonical writer. The broker remains the writer for
Scout-owned records. Harness transcripts remain observed source material.

## Principles

1. Debug views must be reconstructable from durable Scout records plus bounded
   source references.
2. The inspector should label ownership clearly: broker-owned, runtime-owned,
   harness-observed, host-observed, or derived.
3. Retry and replay actions must use existing broker commands, not mutate debug
   state directly.
4. The same read model should serve web, desktop, CLI, and future native
   surfaces.
5. Missing adapter data should degrade into visible gaps, not silent false
   confidence.
6. The inspector should be useful locally with no hosted service.

## Run Subject

```ts
export type ScoutRunSubject =
  | { kind: "invocation"; id: ScoutId }
  | { kind: "flight"; id: ScoutId }
  | { kind: "work_item"; id: ScoutId }
  | { kind: "session"; id: ScoutId }
  | { kind: "delivery"; id: ScoutId };
```

The first implementation should focus on invocation and flight subjects.

## Inspector Snapshot

```ts
export interface ScoutRunInspectorSnapshot {
  subject: ScoutRunSubject;
  generatedAt: number;
  status: ScoutRunInspectorStatus;
  summary: string;
  graph: ScoutRunGraph;
  timeline: ScoutRunTimelineItem[];
  blockers: ScoutRunBlocker[];
  actions: ScoutRunDebugAction[];
  sources: ScoutRunSourceReference[];
  metrics?: ScoutRunInspectorMetrics;
  warnings: string[];
}
```

```ts
export type ScoutRunInspectorStatus =
  | "queued"
  | "routing"
  | "delivering"
  | "running"
  | "waiting"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";
```

## Graph Model

The graph is deliberately operational, not a generic DAG engine:

```ts
export interface ScoutRunGraph {
  nodes: ScoutRunGraphNode[];
  edges: ScoutRunGraphEdge[];
}
```

Node kinds SHOULD include:

- actor
- agent
- endpoint
- session
- invocation
- flight
- delivery
- message
- work item
- question
- unblock request
- checkpoint
- execution environment
- capability
- artifact
- observed harness event

Edges SHOULD describe relationships such as:

- requested
- routed_to
- delivered_by
- executed_in
- produced
- waiting_on
- referenced
- resumed_from
- observed_in

This gives the inspector a common visual and CLI representation without
requiring every feature to become a workflow step.

## Timeline Items

```ts
export interface ScoutRunTimelineItem {
  id: string;
  at: number;
  label: string;
  kind:
    | "broker_fact"
    | "runtime_event"
    | "harness_observed"
    | "host_observed"
    | "derived_status"
    | "operator_action";
  ownership:
    | "scout_owned"
    | "runtime_owned"
    | "harness_observed"
    | "host_observed"
    | "derived";
  subjectRef?: ScoutRunSubject;
  sourceRef?: ScoutRunSourceReference;
  severity?: "debug" | "info" | "warning" | "error";
  detail?: string;
}
```

Timeline item detail must stay bounded. Large logs and command output should
appear as source references or artifacts.

## Debug Actions

The inspector may expose actions only when the broker has a safe command for
them:

```ts
export type ScoutRunDebugAction =
  | { kind: "open_session"; sessionId: ScoutId }
  | { kind: "open_source"; source: ScoutRunSourceReference }
  | { kind: "answer_question"; questionId: ScoutId }
  | { kind: "decide_unblock"; unblockRequestId: ScoutId }
  | { kind: "retry_delivery"; deliveryId: ScoutId }
  | { kind: "resume_checkpoint"; checkpointId: ScoutId }
  | { kind: "fork_from_state"; stateId: ScoutId }
  | { kind: "copy_debug_bundle"; subject: ScoutRunSubject };
```

Actions should be returned with availability and denial reasons. The UI should
not render dead buttons.

## Replay Boundary

The inspector has two forms of replay:

1. **Projection replay** rebuilds the run snapshot from broker-owned facts.
2. **Source replay** asks adapters to re-read bounded harness material when
   source references are still available.

Projection replay is required. Source replay is best-effort and must be labeled
as observed material.

The inspector MUST NOT rerun a harness step just because a user scrubbed the
timeline. Re-execution is a broker command such as retry, resume, or fork.

## CLI Shape

Expected future command shape:

```bash
scout inspect run <invocation-id>
scout inspect flight <flight-id>
scout inspect run <invocation-id> --json
scout inspect run <invocation-id> --bundle
```

The default text output should include status, current blocker, route, endpoint,
environment, last checkpoint, and the most important recent events.

## Debug Bundle

A debug bundle is a local export for support and self-diagnosis. It should
include:

- inspector snapshot JSON
- selected broker-owned records
- bounded observed event excerpts
- adapter capability reports
- environment and capability metadata
- redaction report

It should not include secrets, full transcripts, unbounded command output, or
private files unless the operator explicitly selects them.

## Non-Goals

- creating a hosted observability product
- making the inspector the writer for run state
- importing complete harness transcripts
- replaying provider model execution deterministically
- replacing existing CLI commands for ask, wait, session inspect, or logs
- building a general workflow editor

## Implementation Sequence

1. Add a broker read endpoint that composes an inspector snapshot for a flight.
2. Add ownership labels and source references to each timeline item.
3. Render a text inspector in the CLI.
4. Add web or desktop inspector panels backed by the same snapshot.
5. Add debug bundle export with redaction.
6. Add checkpoint, capability, and environment graph nodes as those proposals
   land.
7. Add source replay through adapter capabilities after the projection path is
   stable.

## Acceptance Criteria

- An invocation or flight can be inspected from one command or endpoint.
- The inspector distinguishes broker-owned facts from observed harness events.
- Current blockers and available next actions are explicit.
- Large raw material is referenced or redacted, not embedded by default.
- The snapshot can be regenerated after broker restart.
- CLI and UI surfaces can use the same inspector schema.

## Relationship To Other Proposals

- [`sco-042`](./sco-042-harness-event-normalization-and-replay-boundary.md)
  defines observed event normalization and source replay boundaries.
- [`sco-053`](./sco-053-resumable-work-checkpoints.md) defines checkpoint nodes
  and resume actions.
- [`sco-043`](./sco-043-execution-environment-contracts.md) defines placement
  nodes.
- [`sco-040`](./sco-040-capability-registry-and-tool-boundaries.md) defines
  capability nodes and decisions.
