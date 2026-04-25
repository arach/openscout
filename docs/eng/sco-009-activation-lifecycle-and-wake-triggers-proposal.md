# SCO-009: Activation Lifecycle and Wake Triggers

## Status

Proposed.

## Proposal ID

`sco-009`

## Intent

Formalize why an OpenScout agent is awake, what may wake it, how long it
should stay warm, and when it may safely go idle again.

OpenScout already has:

- `wakePolicy` on agents
- `ensureAwake` on invocations
- delivery planning and lease fields on deliveries
- clear collaboration wake rules

What it does not have yet is a first-class runtime primitive for
activation itself.

SCO-009 proposes:

- **wake triggers** as durable wake conditions
- **activation leases** as durable "stay awake for this reason" claims
- **activation events** as the explainable lifecycle of warm/cold state

This proposal is about runtime activation, not about thread watch leases
and not about replacing the broker's routing decisions.

## Problem

Today OpenScout can explain:

- which agent should move next
- why a collaboration wake target was chosen
- that an invocation asked to ensure the target is awake

But it cannot yet answer cleanly:

- why is this agent still running right now?
- who or what asked it to stay warm?
- when may it sleep?
- what future condition will wake it back up?
- how do we prevent "keep warm" from becoming an unbounded runtime smell?

The current model is too coarse:

- `manual`, `on_demand`, and `keep_warm` are useful policies, but they are
  not live activation records
- `ensureAwake` is a request hint, not a durable activation explanation
- delivery lease fields are transport-oriented and too narrow to model the
  whole lifecycle of activation

That gap becomes more visible as OpenScout grows into:

- long-running work
- approvals and review waits
- scheduled wakeups
- resource watchers
- richer integration triggers

Without a dedicated activation primitive, those behaviors drift into
adapter-specific heuristics, restart loops, or invisible runtime state.

## Decision

OpenScout SHOULD add first-class **activation leases** and
**wake triggers** as broker-owned runtime records.

The architectural rule is:

- collaboration state decides who should move
- invocations and deliveries request concrete work
- wake triggers describe what conditions may activate a target
- activation leases describe why a target should remain active now

The broker MUST remain the source of truth for issuing and expiring
activation leases.

Harness runtimes MAY heartbeat, renew, or report liveness, but they MUST
NOT invent durable activation reasons on their own.

## Design Principles

1. Activation should be explainable as data.
2. "Keep warm" should become a scoped lease, not a vague forever mode.
3. Wake conditions should be durable enough to survive broker restarts.
4. Authority-node rules still apply.
5. Activation is related to routing, but not the same thing as routing.
6. Warmth should be explicit, revocable, and observable.
7. Watch-stream leases and runtime activation leases must stay distinct.

## Goals

- explain why an agent is awake right now
- let future wake conditions be stored durably
- scope warm state by reason and expiry
- prevent unbounded restart or keep-alive loops
- support scheduled and event-based reactivation cleanly
- make surfaces show warm/cold state with a reason, not just a status

## Non-Goals

- replacing the existing authority and routing model
- building a cloud scheduler
- turning the broker into a general-purpose process supervisor
- making watch subscriptions and runtime activation the same primitive
- requiring every harness to expose identical warm-state mechanics

## Terminology

| Term | Meaning |
|---|---|
| **Wake trigger** | A durable condition that may activate a target in the future |
| **Activation lease** | A durable claim that a target should remain active until expiry or release |
| **Activation source** | The record or event that justified the lease or trigger |
| **Warmth level** | A policy hint such as `cold`, `warm`, or `sticky` for how strongly the broker should try to preserve activation |

## Proposed Model

### Wake Trigger

A wake trigger answers:

- what may wake this target?
- under what condition?
- when is it next eligible to fire?

Suggested fields:

- `id`
- `target_kind`: `agent`, `work_item`, `run`
- `target_id`
- `kind`: `manual`, `message`, `invocation`, `schedule`, `approval`,
  `resource_event`, `integration_event`
- `state`: `armed`, `fired`, `cancelled`, `expired`
- `condition_json`
- `next_fire_at`
- `last_fired_at`
- `created_by_id`
- `metadata`

Examples:

- wake agent `arc` when review is requested on work item `work-12`
- wake run `run-5` at `2026-04-25T09:00:00`
- wake agent `hudson` when approval `approval-3` is resolved

### Activation Lease

An activation lease answers:

- why should the target stay active now?
- who issued that claim?
- when does it expire?

Suggested fields:

- `id`
- `target_agent_id`
- `endpoint_id`
- `source_kind`: `invocation`, `flight`, `run`, `session`, `manual`,
  `integration`
- `source_id`
- `reason`
- `warmth_level`: `cold`, `warm`, `sticky`
- `state`: `requested`, `starting`, `active`, `cooling_down`, `expired`,
  `released`, `failed`
- `lease_owner`
- `lease_expires_at`
- `last_heartbeat_at`
- `metadata`

### Activation Event

Every meaningful change should be recordable:

- lease issued
- lease renewed
- lease expired
- target failed to wake
- trigger armed
- trigger fired
- trigger cancelled

This should be durable enough for audit and surface explanation.

## Relationship To Existing Wake Policy

Current agent `wakePolicy` remains useful, but it should stop carrying the
entire meaning of runtime activation.

Recommended interpretation:

- `manual` means the broker does not auto-arm normal triggers and does not
  auto-issue warm leases except for explicit operator actions
- `on_demand` means ordinary collaboration and invocation paths may arm
  triggers and issue scoped leases
- `keep_warm` means the broker prefers to maintain at least one renewable
  warm lease while the agent has active responsibility, not that the agent
  must run forever without explanation

This is the key shift:

- static policy influences lease issuance
- leases become the durable explanation of actual activation

## Relationship To Existing Delivery Leases

Delivery lease fields already exist, but they are too narrow to represent
the whole activation story.

Recommended direction:

- delivery-specific lease state remains delivery-oriented
- runtime activation leases become a broader primitive
- delivery records MAY point to the activation lease used to satisfy them

## Relationship To Collaboration And Runs

Activation should follow responsibility and execution.

Examples:

- opening a work item run may issue an activation lease for the responsible
  agent
- a waiting approval may release the current lease and arm an approval
  trigger instead
- a scheduled reminder may arm a time trigger without holding the agent warm
  for hours
- an active live session may hold a short renewable lease while the operator
  is engaged

This makes warm state legible instead of magical.

## Suggested Tables

- `wake_triggers`
- `activation_leases`
- `activation_events`

These should sit adjacent to:

- `agents`
- `agent_endpoints`
- `invocations`
- `deliveries`
- `runs`

## Product Implications

### CLI

Recommended commands:

- `scout activations list`
- `scout activations show <agent>`
- `scout wake <agent>`
- `scout sleep <agent>`
- `scout triggers list`

### Surfaces

Surfaces should be able to render:

- awake because `run-17` is active
- cooling down after invocation `inv-8`
- sleeping until tomorrow 9:00 AM
- waiting for approval `apr-3`, no warm lease held

That is much more useful than a bare online/offline bit.

## Rollout Phases

### Phase 1: Lease Substrate

- add activation lease records
- let invocations issue scoped leases
- show lease reason in surfaces

### Phase 2: Trigger Substrate

- add wake triggers
- support manual and schedule triggers first

### Phase 3: Collaboration And Run Integration

- connect waits, approvals, and reviews to triggers
- let runs release and reacquire leases as they pause and resume

### Phase 4: Richer Runtime Policy

- refine warmth levels
- add better cooling-down heuristics
- expose stronger diagnostics for failed wake paths

## Risks

- If leases are too granular, runtime state will become noisy.
- If leases are too coarse, they will collapse back into vague keep-alive
  behavior.
- If triggers and leases are conflated, we will lose clarity between
  "what can wake" and "what must stay warm."
- If harnesses invent their own activation reasons, surfaces will drift.

## Open Questions

- What is the minimum useful warmth vocabulary for v1?
- Should operator-open session views always hold a renewable lease, or only
  when active interaction is possible?
- Which trigger kinds belong in v1 beyond manual and schedule?
- Should activation failures surface as collaboration events, runtime
  events, or both?
- How should authority-node forwarding interact with trigger ownership for
  remote agents?

## Summary

OpenScout already knows who should move and how to route work, but it does
not yet have a durable answer for why an agent is awake.

SCO-009 adds:

- wake triggers for future activation conditions
- activation leases for live warm-state claims
- activation events for explainable runtime lifecycle

That gives the broker a proper activation plane instead of relying on
coarse policy and implicit runtime behavior.
