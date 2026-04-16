# SCO-003: Implementation Plan

Companion to
[sco-003-agent-sessions-capability-proposal.md](./sco-003-agent-sessions-capability-proposal.md).

## Status

Draft.

## Intent

This document is the execution blueprint for landing sco-003 in one extended
implementation session.

It is intentionally not written as a staged rollout plan. The goal is to get
the package boundaries, runtime ownership, trace layering, and bridge surface
right in one coherent pass rather than optimizing for reversible intermediate
slices.

## What This Plan Optimizes For

- the correct architectural boundary between capability, trace, and bridge
  policy
- one shared session substrate used by both `packages/web` and
  `apps/desktop`
- one shared trace model and one shared React rendering layer
- no accidental recreation of durable session logging
- practical parallelism once the core session substrate is stable enough to
  build on

## Core Constraints

1. `Bridge` stays the public integration point that existing consumers call.
   Its name and role remain.
2. `SessionRegistry` becomes the owner of session mechanics inside
   `@openscout/agent-sessions`.
3. The current normalized session protocol and turn/block vocabulary stay
   intact. This is a carve and cleanup, not a second event model.
4. Session replay semantics are per-session from the target design onward:
   `subscribe(sessionId, ...)`, `replay(sessionId, afterSeq)`,
   `currentSeq(sessionId)`, and `oldestBufferedSeq(sessionId)` are all
   session-scoped. This plan does not preserve a mixed global replay shim.
5. `session.decide` stale-version validation is part of the core runtime
   behavior, not a later hardening pass. The registry validates the current
   approval snapshot before any adapter call. Bridge may fast-fail remote
   callers, but the registry remains authoritative.
6. `@openscout/agent-sessions/client` must exist before shared browser trace
   consumers depend on session types.
7. The remote bridge surface matches the proposal surface:
   `session.list`, `session.get`, `session.subscribe`, `session.replay`,
   `session.sendTurn`, `session.answer`, `session.decide`,
   `session.interrupt`.
8. `attach` remains a registry or host-runtime concern. It is not the primary
   remote RPC concept for sco-003.
9. No part of this work introduces broker-backed raw trace storage, replay
   logs, or session-history projection tables.

## End-State Ownership

### `@openscout/agent-sessions`

Owns:

- protocol primitives and adapter-facing types
- approval normalization helpers
- adapter implementations and adapter factory types
- in-memory session state and replay buffers
- `SessionRegistry`
- browser-safe `client` entrypoint for trace consumers

Does not own:

- bridge authorization
- relay transport
- Noise, QR, or other pairing transport concerns
- durable broker persistence
- app-specific trace rendering

### `@openscout/session-trace`

Owns:

- framework-agnostic trace interpretation
- selectors
- formatting helpers
- view-model reduction from session events and snapshots
- interaction request shapes used by UI surfaces

Does not own:

- React
- routing
- queue management
- bridge transport

### `@openscout/session-trace-react`

Owns:

- reusable React trace presentation components

Does not own:

- app-level state
- inbox composition
- bridge calls
- router concerns

### `Bridge`

Owns:

- policy and authorization
- subscription fan-out
- human mediation
- relay transport
- remote RPC surface

Delegates:

- session lifecycle and replay mechanics
- adapter write paths
- approval version validation

## Track 1: Shared Session Core

### Goal

Establish one shared live-session substrate that both runtime trees consume,
with `Bridge` delegating session mechanics to `SessionRegistry`.

### Scope

- Create `packages/agent-sessions/` and move the shared protocol, adapter,
  state, and buffer code out of:
  - `packages/web/server/core/pairing/runtime/`
  - `apps/desktop/src/core/pairing/runtime/`
- Export the runtime-facing package surface from
  `@openscout/agent-sessions`.
- Introduce `SessionRegistry` inside `@openscout/agent-sessions` to own:
  - adapter factory lookup
  - session lifecycle
  - snapshots and summaries
  - event fan-in from adapters
  - per-session sequence allocation and replay buffers
  - `sendTurn`, `answer`, `decide`, `interrupt`, and close semantics
- Refactor `Bridge` to delegate session mechanics to `SessionRegistry` while
  retaining:
  - authorization
  - transport
  - broadcast and subscription policy
  - pairing concerns
- Implement the per-session replay model directly:
  - one sequence space per session
  - `replay(sessionId, afterSeq)` only
  - no compatibility layer that pretends per-session cursors can be merged
    back into a coherent global replay cursor
- Keep the existing normalized wire vocabulary intact so mobile and current UI
  consumers do not need a new protocol.
- Make stale approval-version validation part of the registry `decide` path.
  If the approval is missing or the supplied version is stale, the registry
  returns a conflict-style error and does not call the adapter.

### Completion Criteria

- `packages/web` and `apps/desktop` both compile against
  `@openscout/agent-sessions`.
- Existing bridge consumers still call `bridge.xxx` rather than importing the
  registry directly.
- A real session produces the same normalized event vocabulary as before.
- Replay, reconnect, `currentSeq`, and `oldestBufferedSeq` all work with
  session-scoped cursors.
- Stale approval decisions are rejected before adapter invocation.

## Track 2: Browser-Safe Trace Layer

### Goal

Create the shared trace-consumer packages so web, mobile, bridge-adjacent
surfaces, and future agent tooling can all render the same live session model
without duplicating trace logic.

### Scope

- Add `@openscout/agent-sessions/client` first, not later.
- Restrict that entrypoint to browser-safe exports:
  - protocol types
  - snapshot and event types
  - approval helpers
  - other pure helpers needed by trace consumers
- Do not export adapters, registry implementations, buffers, or other Node-only
  paths from the client boundary.
- Create `packages/session-trace/` as the framework-agnostic trace layer.
- Create `packages/session-trace-react/` as the React presentation layer on top
  of `@openscout/session-trace`.
- Move trace interpretation logic out of app-specific controllers and into
  `@openscout/session-trace`.
- Migrate the web trace UI to use the shared trace packages.
- Leave the current mobile renderer in place for now if it is still faster to
  land sco-003 that way. The important move here is to establish the shared
  model and React component layer so mobile can converge later without redoing
  the core logic.

### Completion Criteria

- `@openscout/session-trace` depends only on
  `@openscout/agent-sessions/client` for session-facing types.
- `@openscout/session-trace` contains no React or DOM imports.
- `@openscout/session-trace-react` contains reusable presentational components
  only.
- The web trace drawer renders from the shared packages rather than app-local
  trace reduction code.

## Track 3: Mesh Bridge Surface

### Goal

Expose the session capability over the mesh through the existing `Bridge`
policy plane, without inventing a second control model.

### Scope

- Formalize bridge-level authorization hooks for the remote surface. At
  minimum, the bridge needs policy decisions for:
  - list
  - get
  - subscribe
  - replay
  - sendTurn
  - answer
  - decide
  - interrupt
- Expose the proposal-aligned RPC surface:
  - `session.list`
  - `session.get`
  - `session.subscribe`
  - `session.replay`
  - `session.sendTurn`
  - `session.answer`
  - `session.decide`
  - `session.interrupt`
- Keep `attach` internal to the host and registry model rather than making it
  the main remote abstraction.
- Route all remote session writes through the bridge, then into the registry.
- Preserve the split of responsibility:
  - bridge performs authorization and remote fast-fail validation
  - registry remains authoritative for current approval-state validation
- Keep in-process callers simple. Local web and desktop code can keep a
  `Bridge` reference and do not need to learn a second abstraction.

### Completion Criteria

- A remote consumer can discover sessions, fetch session state, subscribe,
  replay, and issue typed write-backs through one coherent RPC surface.
- `session.interrupt` exists alongside the other write verbs rather than being
  treated as a special side path.
- `session.decide` rejects stale versions both at the bridge fast-fail layer
  and authoritatively in the registry.

## Practical Parallelization

The work is not evenly parallel. The substrate seam is the hard dependency
chain. After that, there is room to split.

### What Must Stay Sequential

- package carve into `@openscout/agent-sessions`
- `SessionRegistry` introduction
- `Bridge -> SessionRegistry` delegation
- per-session replay and sequence semantics

Those changes all touch the same runtime seam and should be treated as one
owner's lane.

### What Can Parallelize After The Core Stabilizes

Once Track 1 has stable exported types and stable replay semantics:

- one engineer can own `@openscout/agent-sessions/client` plus
  `@openscout/session-trace`
- one engineer can own `@openscout/session-trace-react` plus the web trace
  migration
- one engineer can own the bridge authz and RPC surface for remote consumers

That gives a practical three-person split:

1. **Substrate owner**
   `@openscout/agent-sessions`, `SessionRegistry`, per-session replay,
   approval version validation, bridge delegation.
2. **Trace-model owner**
   browser-safe client entrypoint, trace selectors, reducers, formatters, and
   interaction helpers.
3. **Surface owner**
   shared React trace components, web migration, then mesh bridge RPC once the
   registry surface stops moving.

## Recommended Working Order

1. Finish Track 1 end-to-end first. Do not leave replay semantics or approval
   validation half-migrated.
2. As soon as Track 1 exports stabilize, split into Track 2 and the bridge-side
   work for Track 3 in parallel.
3. Finish by aligning the web trace UI and the remote bridge surface to the
   same shared session substrate.

## Explicitly Out Of Scope

- broker-side raw trace persistence
- fleet or projection work above the live session substrate
- sco-004 identity, alias, binding, or crossover semantics
- forcing the mobile renderer migration into the same pass if it slows down the
  shared package carve
- type-level renames such as `PairingEvent -> SessionEvent` that do not change
  the architecture

## Summary

The real sco-003 work is:

1. carve a shared session substrate
2. carve a shared trace layer on top of a browser-safe client boundary
3. expose the same capability through the bridge for remote consumers

That is the correct scope. It keeps live trace out of durable storage, keeps
the bridge focused on policy and transport, and gives OpenScout one reusable
session and trace model that web, mobile, and future agent tooling can all
share.
