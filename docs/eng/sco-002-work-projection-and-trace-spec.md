# SCO-002: Work Projection And Trace Layering

## Status

Proposed.

## Purpose

Define how OpenScout projects canonical broker records and live runtime events
into operator-facing surfaces without over-managing the raw trace.

The main operator need is fleet visibility:

- what each agent owns right now
- what changed recently
- whether a human needs to act
- which related agents and artifacts are involved

The system already has the right ingredients:

- broker-owned conversations, messages, invocations, flights, and collaboration
  records
- `activity_items` for fast operational projection
- runtime `turn` / `block` events for live execution detail

What is missing is a shared rule for how those planes become:

- fleet overview
- work detail
- coordination timeline
- live trace
- artifacts

## Problem

Without an explicit projection contract, surfaces drift toward one of two bad
outcomes:

1. They overfit terminal or tmux output and make runtime noise the main product
   narrative.
2. They flatten raw execution trace into durable chat or work state and invent
   more semantics than the broker actually owns.

Both are wrong.

The root issue is not missing data. It is missing projection boundaries.

## Decision

OpenScout should separate operator visibility into four layers:

1. `Fleet overview`
   A normalized list of active work across agents.
2. `Work detail`
   A normalized work view with durable status, progress, delegations, and
   attention.
3. `Coordination timeline`
   A durable, operator-facing narrative of handoff, ownership, waiting, review,
   reply, and published artifacts.
4. `Live trace`
   A mostly raw view of runtime `turn` / `block` execution.

Artifacts are first-class, but they are not a fifth narrative plane. They are a
durable inventory attached to work and surfaced alongside the layers above.

### Product Rule

- `Work view` is managed and normalized.
- `Coordination timeline` is durable and operator-facing.
- `Live trace` is mostly raw.
- `Artifacts` are broker-owned resources, not scraped tool output.

## Non-Goals

- Do not turn live trace into a second workflow engine.
- Do not persist raw reasoning as canonical work state.
- Do not synthesize durable work steps from every tool call or stdout delta.
- Do not make tmux or logs the primary product model.
- Do not require every harness to expose identical trace fidelity.

## Canonical Source Planes

### 1. Conversation Plane

Source records:

- `ConversationDefinition`
- `MessageRecord`

Answers:

- what was said
- what was answered
- which durable replies belong in the thread

### 2. Work Plane

Source records:

- `CollaborationRecord`
- `CollaborationEvent`

Answers:

- what is owned
- what is waiting
- what is in review
- what is done

### 3. Execution Plane

Source records:

- `InvocationRequest`
- `FlightRecord`
- runtime `turn` / `block` events

Answers:

- what is actively running
- what execution phase the agent is in
- whether the runtime needs approval or encountered failure
- what the current live turn is doing

### 4. Resource Plane

Source records:

- broker resources and artifact records
- artifact-class messages where applicable

Answers:

- which durable outputs exist
- who owns them
- what work they came from

### 5. Diagnostic Plane

Source surfaces:

- tmux panes
- runtime logs

Answers:

- low-level debugging questions

This plane is explicitly secondary. It must not be the primary fleet or work
model.

## Surface Contracts

### Fleet Overview

The fleet view is a normalized read model for active work.

It should answer, at a glance:

- who owns the work
- what state it is in
- what the current phase is
- whether attention is needed
- how many active delegations or child efforts exist
- how many durable artifacts were published
- what changed most recently

Recommended row shape:

| Field | Meaning | Primary source |
|---|---|---|
| `workId` | stable work record id | collaboration |
| `title` | operator-readable task title | collaboration |
| `ownerId` | current owner | collaboration |
| `nextMoveOwnerId` | current responsibility holder | collaboration |
| `state` | `open`, `working`, `waiting`, `review`, `done`, `cancelled` | collaboration |
| `currentPhase` | short normalized execution label | flights + promoted trace |
| `attention` | `none`, `badge`, `interrupt` | collaboration + flights + approval |
| `activeDelegationCount` | active child work or trace-level helper count | collaboration, secondarily trace |
| `artifactCount` | durable published outputs | resources / artifact records |
| `lastMeaningfulAt` | most recent high-signal change | projected |
| `lastMeaningfulSummary` | short summary of that change | projected |

The fleet view should default to active `work_item` records. Open questions may
appear elsewhere, but they should not dominate the fleet surface.

### Work Detail

The work detail view is the normalized operator page for one work item.

It should contain:

- title, owner, next move owner, priority, workspace
- progress summary and checkpoint
- waiting / review / acceptance state
- active flight summary
- active delegations and child work
- durable artifact inventory
- coordination timeline
- optional live trace drawer

This is the main page for understanding long-running work.

### Coordination Timeline

The coordination timeline is the durable narrative of the work.

It should include:

- work item creation and claim
- handoffs and ownership changes
- waiting and unblock transitions
- review requests and acceptance
- human or agent replies that matter to the work
- invocation opens and terminal flight changes
- durable artifact publication
- explicit attention events

It should not include:

- reasoning deltas
- routine text streaming
- command stdout chunks
- every tool call
- ephemeral session churn

### Live Trace

The live trace is a mostly raw rendering of runtime execution.

Source model:

- `turn:start`
- `turn:end`
- `turn:error`
- `block:start`
- `block:delta`
- `block:action:output`
- `block:action:status`
- `block:action:approval`
- `block:question:answer`
- `block:end`

Rendering rules:

- preserve turn and block ordering
- collapse reasoning by default
- render action blocks with minimal specialization by `kind`
- allow filter, collapse, copy, and jump-to-artifact
- do not invent kanban states or fake checkpoints from trace noise

The trace is for observation and diagnosis. It is not the canonical work model.

### Artifacts

Artifacts are durable outputs that can be reopened later.

Examples:

- plans
- reports
- generated files
- patches
- benchmark outputs
- screenshots
- logs intentionally published as outputs

Artifacts should come from broker-owned resource or artifact records, not from
arbitrary tool output.

## Projection Rules

### Durable Rules

1. `CollaborationRecord` is the source of truth for normalized work state.
2. `CollaborationEvent` is the source of truth for durable work transitions.
3. `FlightRecord` is the source of truth for ask/invoke execution lifecycle.
4. `MessageRecord` is the source of truth for durable communicative turns.
5. Runtime `turn` / `block` events are the source of truth for live trace only.
6. Resource or artifact records are the source of truth for artifact inventory.

### Promotion Rule

Runtime trace may promote a small set of high-signal facts upward into the work
view, but only when those facts improve fleet comprehension.

Allowed promoted facts:

- current execution phase
- current live activity timestamp
- approval needed
- active helper / subagent count
- terminal failure or interruption before durable reconciliation arrives

Everything else stays in trace.

## Event-To-Surface Mapping

| Source event or record | Fleet / work projection | Coordination timeline | Live trace |
|---|---|---|---|
| `CollaborationRecord(work_item)` upsert | yes | on significant state change | no |
| `CollaborationEvent` appended | yes | yes | no |
| durable human / agent reply message | reply preview only | yes | no |
| durable status message like `is working` | no | no | no |
| `InvocationRequest` | yes | yes, as work start / dispatch | no |
| `FlightRecord` running / waiting / completed / failed | yes | yes for meaningful state changes | no |
| `turn:start` / `turn:end` / `turn:error` | live activity metadata only | terminal failure only if needed | yes |
| reasoning block start / delta / end | no | no | yes |
| text block start / delta / end | no | no | yes |
| action block `command` | current phase only | no by default | yes |
| action block `file_change` | current phase only | no by default | yes |
| action block `tool_call` | current phase only | no by default | yes |
| action block `subagent` | helper count only | no by default | yes |
| `block:action:approval` | attention `interrupt` | yes | yes |
| `block:question:answer` | maybe attention clear | yes if user-facing | yes |
| resource / artifact published | artifact count | yes | optional link only |

## Normalized Work Signals

The work view should expose a small normalized vocabulary derived from the
canonical records above.

### Work State

Use the existing `work_item` state vocabulary:

- `open`
- `working`
- `waiting`
- `review`
- `done`
- `cancelled`

Do not invent a second long-lived state machine from trace data.

### Current Phase

`currentPhase` is short-lived and derived. It is not canonical durable state.

Recommended vocabulary:

- `Dispatching`
- `Working`
- `Running command`
- `Editing files`
- `Using tool`
- `Delegating`
- `Awaiting approval`
- `Preparing reply`
- `Waiting`
- `In review`
- `Failed`

Phase precedence should be:

1. approval needed
2. explicit work `waiting`
3. explicit work `review`
4. active subagent action
5. active command action
6. active file-change action
7. active generic tool action
8. active flight without richer trace
9. work-item checkpoint summary
10. plain `Working`

### Attention

Reuse the existing notification tier shape:

- `none`
- `badge`
- `interrupt`

Recommended mapping:

- `interrupt`
  - approval required
  - direct question to operator
  - terminal failure with no recovery path
- `badge`
  - review requested
  - durable reply posted
  - artifact published
  - work completed
- `none`
  - ordinary progress churn

### Last Meaningful Event

`lastMeaningfulEvent` should only update for high-signal changes:

- collaboration event
- durable reply
- flight state transition
- promoted phase transition
- approval request
- artifact publication

It should not update for:

- every reasoning delta
- every stdout chunk
- every text token

## Promotion Heuristics

### Runtime Actions

Action blocks should always appear in trace.

They should only affect normalized work when they change one of:

- `currentPhase`
- `attention`
- `activeDelegationCount`
- `lastMeaningfulEvent`

### Duration Threshold

Short-lived action churn should not cause visible fleet flicker.

Default rule:

- only promote a trace action into `currentPhase` once it has been active for at
  least 5 seconds, unless it enters `awaiting_approval`, `failed`, or
  `completed` with a meaningful result

### Subagent Actions

Not every harness-local helper call is a durable delegation.

Rules:

- trace-level `subagent` action may increment a transient helper count
- durable delegation should come from collaboration, delivery, or explicit child
  work records
- fleet and work detail should prefer durable child work over trace heuristics

### Approval

Approval is one of the few runtime events that should always promote upward.

Rules:

- `block:action:approval` must surface as `attention=interrupt`
- it may appear in the coordination timeline because the operator must act
- it should not mutate durable work state on its own unless the broker writes a
  corresponding collaboration change

## Artifact Rules

An output counts as an artifact only if it becomes a durable broker-visible
record.

Counts as artifact:

- published plan document
- stored diff or patch
- generated file with provenance
- screenshot or media output
- benchmark result intentionally recorded

Does not count as artifact:

- stdout fragments
- tmux scrollback
- ephemeral command output
- reasoning text
- uncommitted file edits that have not been published or linked

Artifact provenance should link back to work and execution where possible:

- `source_message_id`
- `source_invocation_id`
- linked work item id
- creator / owner

## Persistence And Recovery

### Work View Recovery

Fleet overview and work detail must remain reconstructable from durable broker
records alone:

- collaboration
- messages
- invocations
- flights
- resources
- activity projections

Losing a live session or trace buffer must not erase the work story.

### Live Trace Recovery

Live trace may use replayable session buffers or snapshots where available, but
it remains secondary.

If trace cannot be recovered:

- keep work and timeline intact
- show that trace is unavailable
- fall back to diagnostics only when necessary

### Diagnostics

tmux and logs may remain available as drill-down surfaces, especially for
harnesses that do not expose rich runtime events, but they must stay outside the
normalized work projection path.

## Example: Vox DJ Real-Time Voice Commands

Operator request:

> Ask `@vox-dj` to implement real-time voice commands and let it work for 20
> minutes with optional delegations.

Expected projection:

### Fleet Overview

- `@vox-dj`
- `Working`
- `Current phase: Running command`
- `2 active delegations`
- `3 artifacts`
- `Last meaningful event: published latency benchmark`
- `Attention: none`

### Work Detail

- work title, owner, progress checkpoint
- child work for speech parsing and command routing
- active flight summary
- artifact inventory for plan, benchmark, and patch

### Coordination Timeline

- task created
- vox-dj claimed work
- spawned child work for command parsing
- waiting cleared after benchmark input arrived
- review requested

### Live Trace

- reasoning block for planning
- command block for test runs
- file-change block for edits
- subagent block for helper work
- streamed output for the active command

The operator can watch the work without forcing the trace itself to become the
work model.

## API Direction

This proposal does not require a new canonical store. It requires a stable read
contract.

Suggested read models:

- `fleet_work_rows`
- `work_detail_projection`
- `coordination_timeline_items`
- `live_trace_stream`
- `artifact_inventory`

These may be implemented as:

- broker read helpers
- SQLite-backed projection tables
- hybrid projections over durable tables plus live session state

What matters is the contract, not whether the implementation is table-backed or
assembled at read time.

## Rollout

### Phase 1

- freeze the projection vocabulary in this doc
- ensure `working` stays off the durable message plane
- make fleet and work detail read from collaboration plus flights plus
  `activity_items`

### Phase 2

- attach runtime trace drawers using the existing `turn` / `block` model
- promote only approval, phase, helper count, and terminal failure
- keep reasoning collapsed and trace minimally interpreted

### Phase 3

- attach durable resource and artifact inventory
- link trace blocks to published artifacts where provenance exists
- add cross-surface queries like "what is my fleet working on?"

## Open Questions

- Should short-lived phases use a fixed 5-second threshold everywhere, or be
  per-surface tuned?
- How should child work and harness-local helper calls be reconciled when both
  exist for the same effort?
- Do we want a dedicated broker projection table for normalized work rows, or
  should the first version assemble them from existing state?

## Summary

OpenScout should not choose between normalized work management and raw runtime
observation.

It should do both, but on different layers:

- normalized work for fleet comprehension
- durable coordination for the narrative
- mostly raw trace for observation
- durable artifacts for outputs

That separation gives the operator a coherent fleet view without forcing every
harness to look like tmux or every tool call to become product state.
