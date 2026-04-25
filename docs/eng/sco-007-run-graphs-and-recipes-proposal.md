# SCO-007: Run Graphs and Recipes

## Status

Proposed.

## Proposal ID

`sco-007`

## Intent

Define a durable execution primitive for OpenScout that sits between
collaboration ownership and live session trace.

OpenScout already has strong nouns for:

- conversation and messages
- questions and work items
- invocations, deliveries, and flights
- live session trace

What it does not have yet is a first-class execution model for
multi-step work that unfolds over time, pauses, retries, waits for
humans, resumes after restarts, and remains explainable without turning
that whole story into chat messages.

SCO-007 proposes three connected concepts:

- **recipe** as a reusable execution skeleton
- **run** as a durable execution instance
- **run graph** as the step-level state of a run over time

This proposal keeps the broker-first architecture intact. It does not
replace work items, invocations, or flights. It fills the missing
execution plane between them.

## Problem

Today OpenScout can represent:

- who owns work
- who should move next
- that an invocation was requested
- that a flight is queued, running, waiting, or complete
- what happened inside a live session trace while it was visible

That is enough for short ask/answer flows and direct agent dispatch, but
it is not enough for durable work that spans hours, days, or repeated
recovery cycles.

Three gaps show up:

1. **Work items are ownership records, not execution records.**
   `work_item.progress` can carry percent, summary, and checkpoint text,
   but it cannot express a durable step plan, wait state, retry policy,
   or branch history.
2. **Flights are request lifecycle records, not execution graphs.**
   A flight explains one request to one target. It does not explain
   nested work, approval gates, repeated retries, scheduled resumes, or
   multiple execution phases over time.
3. **Session trace is live evidence, not canonical execution state.**
   Trace is the right product surface for observing a live session, but
   it is not the durable place to answer questions such as:
   - what step are we on?
   - why are we waiting?
   - what will wake this back up?
   - what already completed and should not re-run?

The result is predictable drift:

- execution state leaks into chat summaries
- waiting and retry behavior becomes adapter-specific
- restart recovery depends on prompt reconstruction and operator memory
- sweeper and notification logic have no canonical step-level substrate

## Decision

OpenScout SHOULD add a first-class **run graph** model and a reusable
**recipe** model.

The architectural rule is:

- work items remain the durable ownership plane
- invocations and flights remain the dispatch plane
- runs become the durable execution plane
- session trace remains the live observation plane

In practical terms:

- a `work_item` says what is owned and by whom
- an `invocation` says a concrete execution request was issued
- a `flight` says how that request moved through delivery and response
- a `run` says how the work is actually being executed over time

## Design Principles

1. The broker owns canonical execution state.
2. A run must survive broker restarts.
3. Waiting, retry, approval, and handoff are first-class states, not
   summary text.
4. Session trace may enrich a run, but must not be the only record of
   execution.
5. Recipes are reusable guidance, not a replacement for agent judgment.
6. Linear execution should be easy, but the model should not trap us in
   a purely linear future.
7. The same run model should support human-driven and agent-driven work.

## Goals

- add a durable step-level execution substrate
- make long-running work restartable and explainable
- separate ownership state from execution state
- let work pause on approvals, schedules, or external conditions without
  collapsing into freeform notes
- support reusable execution skeletons for repeated operational patterns
- make sweeper, notifications, and surfaces read from durable run state

## Non-Goals

- building a generic distributed workflow engine
- replacing collaboration records as the source of ownership truth
- replacing flights as the source of delivery truth
- forcing every run to be fully deterministic
- making the broker execute arbitrary user code as a workflow language
- replacing session trace with a step list

## Terminology

| Term | Meaning |
|---|---|
| **Recipe** | A reusable execution skeleton or policy template that can be instantiated into a run |
| **Run** | A durable execution instance for a piece of work |
| **Run graph** | The set of run steps and their transitions over time |
| **Run step** | A single execution node such as act, wait, approve, review, handoff, or complete |
| **Checkpoint** | A durable recovery point within a run |
| **Resume trigger** | A durable condition that can wake or continue a waiting run |

## Proposed Model

### Recipe

A recipe is reusable execution structure, not a work item itself.

Suggested fields:

- `id`
- `title`
- `scope`: `system`, `workspace`, `agent`, `integration`
- `version`
- `input_schema`
- `default_steps`
- `retry_policy`
- `approval_policy`
- `escalation_policy`
- `metadata`

Examples:

- "Code review with human sign-off"
- "Investigate failing build and report back"
- "Triage inbound issue, reproduce, patch, verify"

Recipes SHOULD be optional. A run may exist without one.

### Run

A run is the durable execution record.

Suggested fields:

- `id`
- `recipe_id`
- `state`: `planned`, `ready`, `running`, `waiting`, `review`,
  `completed`, `failed`, `cancelled`
- `title`
- `summary`
- `collaboration_record_id`
- `invocation_id`
- `current_step_id`
- `owner_id`
- `next_move_owner_id`
- `waiting_on`
- `started_at`, `updated_at`, `completed_at`
- `metadata`

Relationship rules:

- a work item MAY spawn zero or many runs over time
- a run SHOULD point back to the originating work item when one exists
- a flight MAY point at the run it is advancing
- a session trace MAY annotate run steps, but the run remains canonical

### Run Step

Run steps are durable execution nodes.

Suggested fields:

- `id`
- `run_id`
- `kind`: `action`, `decision`, `wait`, `approval`, `review`, `handoff`,
  `complete`
- `state`: `pending`, `ready`, `running`, `waiting`, `done`, `failed`,
  `cancelled`
- `title`
- `summary`
- `actor_id`
- `depends_on_step_id`
- `checkpoint`
- `resume_trigger_id`
- `attempt`
- `started_at`, `completed_at`
- `metadata`

The graph MAY be represented as a simple ordered list in v1, but the data
model SHOULD allow explicit dependencies so a richer graph can emerge
without replacing the primitive.

### Resume Triggers

When a run pauses, the reason and re-entry path should be durable.

Suggested trigger kinds:

- `time`
- `approval`
- `message`
- `resource_event`
- `integration_event`
- `manual`

Suggested fields:

- `id`
- `run_id`
- `step_id`
- `kind`
- `state`: `armed`, `fired`, `cancelled`, `expired`
- `condition_json`
- `fires_at`
- `fired_at`

## How This Fits Existing Core Records

### Collaboration Records

Collaboration records continue to answer:

- what is the work?
- who owns it?
- who moves next?

Runs answer:

- how is this work being executed?
- what step is active?
- what completed already?
- why is execution waiting?

The current `progress` block on `work_item` SHOULD remain, but it SHOULD
become a projection of run state when a run exists instead of the only
execution substrate.

### Invocations And Flights

Invocations and flights stay focused on dispatch.

Recommended relationship:

- creating a run MAY emit one or more invocations
- an invocation MAY either create a run or attach to an existing run
- each flight SHOULD be linkable to the run step it advances

This preserves the strong request/delivery model already in the broker.

### Session Trace

Session trace remains the live evidence stream.

Trace blocks MAY be linked to:

- `run_id`
- `run_step_id`
- `checkpoint`

But trace does not become the durable execution source of truth.

## Suggested Tables

- `recipes`
- `recipe_versions`
- `runs`
- `run_steps`
- `run_step_edges`
- `run_resume_triggers`
- `run_events`

These tables should sit adjacent to:

- `collaboration_records`
- `invocations`
- `flights`
- `deliveries`

They should not replace them.

## Product Implications

### CLI

Recommended commands:

- `scout runs list`
- `scout runs show <id>`
- `scout runs retry <id>`
- `scout runs resume <id>`
- `scout recipes list`

### Surfaces

Surfaces should be able to answer:

- what work is currently executing?
- what step is active?
- what step are we waiting on?
- what will wake this up next?
- what completed already?

That is different from both chat history and raw trace.

## Rollout Phases

### Phase 1: Schema And Projection

- add `run` and `run_step` records
- link runs to collaboration records and flights
- project existing work-item progress into runs where useful

### Phase 2: Waiting And Resume

- add durable waiting reasons
- add time-based and approval-based resume triggers
- teach sweeper and notifications to read run state

### Phase 3: Recipes

- add reusable recipe definitions
- allow agents or operators to select a recipe when opening work
- keep recipe use optional

### Phase 4: Richer Graphs

- add explicit step dependencies
- add richer branch and retry visualization
- connect trace blocks back to run steps

## Risks

- If runs overlap too much with work items, the model will get confusing.
- If recipes become too prescriptive, they will fight the broker-first
  collaboration model instead of helping it.
- If session trace is treated as canonical, recovery will remain fragile.
- If runs are too heavyweight, teams will avoid them and fall back to
  chat summaries.

## Open Questions

- Should a work item allow multiple concurrent active runs, or only one?
- Should v1 support only ordered steps, with graph edges reserved for v2?
- Which waits deserve first-class trigger kinds in v1 beyond time and
  approval?
- Should recipe definitions live in the broker database, on disk, or both?
- How much of run state should be writable by harness adapters versus only
  by broker-side reducers?

## Summary

OpenScout has durable ownership and durable delivery, but not yet durable
execution.

SCO-007 fills that hole with:

- recipes for reusable execution structure
- runs for durable execution instances
- run graphs for durable step state and recovery

That gives the broker a real execution plane without weakening the
existing collaboration and routing model.
