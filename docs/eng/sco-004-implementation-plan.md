# SCO-004: Implementation Plan

Companion to
[sco-004-addressable-identities-and-session-bindings-proposal.md](./sco-004-addressable-identities-and-session-bindings-proposal.md).

## Status

Draft.

## Intent

This plan breaks SCO-004 into implementation-facing workstreams that fit the
current OpenScout architecture after SCO-003.

The goal is not to redesign live sessions. The goal is to add identity,
binding, and crossover routing on top of the existing runtime/session
substrate without introducing durable raw session logging.

## What This Plan Optimizes For

- clear separation between identity, binding, session, and conversation
- reuse of the SCO-003 session substrate instead of new trace storage
- explicit alias resolution and provenance
- typed crossover routing for human, agent, and agent-to-agent writes
- a path that can land incrementally without changing session semantics

## Core Constraints

1. `@openscout/agent-sessions` remains the live session substrate.
2. `Bridge` remains the policy and transport integration point.
3. `@openscout/session-trace` remains a read/model layer, not a durable log.
4. Conversation history stays durable and separate from live session trace.
5. Bindings are routing state, not session history.
6. No workstream should add raw live trace persistence.

## End-State Ownership

### Identity registry

Owns:

- canonical identity records
- alias lookup
- discoverability/search
- identity metadata and ownership

Does not own:

- live session trace
- conversation message bodies
- session replay buffers

### Binding registry

Owns:

- identity-to-session bindings
- conversation-to-session bindings
- binding lifecycle and provenance
- active routing mode and capability flags

Does not own:

- alias source-of-truth
- live session mechanics
- durable conversation content

### Router

Owns:

- request resolution
- policy checks
- target dispatch
- provenance attachment

Does not own:

- session lifecycle
- trace rendering
- durable session logging

## Workstream 1: Canonical Identity and Aliases

### Goal

Create a stable identity layer that can be referenced by handle, alias, or
canonical ID.

### Deliverables

- canonical identity records
- alias resolution
- explicit ambiguity handling
- searchable identity metadata

### Acceptance Criteria

- `@handle` and canonical references resolve to the same identity record
- alias collisions fail closed
- identities can exist independently of live sessions

## Workstream 2: Session and Conversation Bindings

### Goal

Make live session routing explicit by binding identities and conversations to
sessions.

### Deliverables

- identity-session binding records
- conversation-session binding records
- binding modes such as observe-only, write-through, and approval-gated
- revocation and rebind behavior

### Acceptance Criteria

- a live session can be bound to an identity
- a conversation can route through a bound session
- unbinding does not delete the underlying identity or conversation

## Workstream 3: Crossover Router

### Goal

Route cross-boundary writes through a single typed path.

### Deliverables

- source and target resolution
- policy decisions for human -> agent, agent -> human, and agent -> agent
- typed session writes for live session targets
- durable conversation writes for thread targets

### Acceptance Criteria

- all crossover writes carry actor and provenance metadata
- routing fails closed when the alias or binding is ambiguous
- session writes go through the SCO-003 session substrate

## Workstream 4: Conversation Mapping

### Goal

Define how Scout conversations use bindings without becoming session logs.

### Deliverables

- conversation route records
- thread-to-session mapping semantics
- reply publishing policy
- separation between thread history and live session trace

### Acceptance Criteria

- a Scout thread can target a bound session
- the thread history does not duplicate raw live session trace
- routed replies preserve the source conversation identity

## Workstream 5: Tests and Invariants

### Goal

Lock the separation between identity, binding, conversation history, and live
session trace.

### Must-Have Tests

- alias resolution returns a canonical endpoint
- binding updates do not mutate identity records
- routed writes preserve provenance
- live session trace remains outside durable conversation history
- unbound sessions remain addressable as live sessions

## Suggested Order

1. Implement identity and alias resolution.
2. Add binding records and binding lifecycle.
3. Add the crossover router and policy checks.
4. Wire Scout conversation routing through bindings.
5. Add tests that assert trace/history separation.

## Residual Risks

- ambiguous alias policy can become user-hostile if we over-automate it
- binding churn needs clear UX so operators understand which live session is
  active
- conversation routing can silently feel like session logging if the
  separation is not tested explicitly
