# SCO-004: Addressable Identities and Session Bindings

## Status

Proposed.

## Proposal ID

`sco-004`

## Intent

Define an implementation-oriented identity and binding layer on top of the
current OpenScout runtime architecture landed in SCO-003.

The goal is to make identities, aliases, live sessions, and Scout
conversations addressable without turning live session trace into durable
broker history. SCO-004 should explain how we route between:

- stable identities
- live sessions exposed by `@openscout/agent-sessions`
- Scout conversations and durable thread history
- direct human, agent, and agent-to-agent crossover writes

This proposal assumes:

- SCO-003 owns the live session substrate, replay, and approval-safe session
  writes
- `Bridge` remains the policy and transport surface
- `@openscout/session-trace` renders live session state, but does not become a
  second durable log
- Scout conversation history remains durable and separate from session trace

## Problem

Today OpenScout can observe live sessions and it can keep durable Scout
conversation history, but it does not yet have a clean address model for
connecting them.

The missing layer is not session capability. The missing layer is a stable way
to say:

- this is the canonical identity for a person, agent, or hybrid operator
- this alias resolves to that identity right now
- this identity is currently bound to that live session
- this Scout conversation is routed through that bound session
- this crossover message is a direct write to a live session, not a duplicate
  durable log entry

Without that layer, the system collapses different concepts into one:

- identity becomes a proxy for session
- session becomes a proxy for conversation
- conversation history starts to look like session logging
- direct crossover writes become ad hoc application-specific paths

SCO-004 needs to make these relationships explicit and routable.

## Decision

OpenScout should model crossover using three distinct address spaces and one
binding layer:

1. **Identity**
   A durable, searchable, addressable participant record.
2. **Session**
   A live session capability exposed by SCO-003.
3. **Conversation**
   Durable Scout thread history and work narrative.
4. **Binding**
   A live or durable relationship that maps an identity or conversation to a
   session.

The architectural rule is simple:

- identity is durable
- session is live
- conversation is durable
- binding is the routing state between them

The system MUST resolve any alias or handle to a canonical identity or session
before routing a crossover action.

## Normative Language

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as normative requirements.

## Design Principles

1. Identity and session remain separate concepts.
2. Alias resolution is convenience, not source of truth.
3. Bindings route work; they are not raw session history.
4. Scout conversations can target live sessions, but they remain durable
   thread records.
5. Live session trace stays in the session substrate, not in broker storage.
6. Crossover writes must be typed, actor-aware, and provenance-bearing.
7. Human, agent, and hybrid operators share the same routing rules.

## Goals

- provide stable addressable identities for humans, agents, and hybrid
  operators
- support canonical aliases such as `@handle` without making aliases the
  source of truth
- bind identities to live sessions without collapsing the two
- route Scout conversations through a bound session when appropriate
- support direct human-to-agent, agent-to-human, and agent-to-agent crossover
- preserve raw live trace in the SCO-003 session substrate
- avoid recreating session logging in durable Scout storage

## Non-Goals

- replacing SCO-003 session capability
- storing raw live session trace in broker or conversation tables
- making every session a durable Scout record
- forcing all crossover through a conversation
- inventing a new session transport or replay layer
- global identity federation beyond OpenScout-managed addressability

## Terminology

| Term | Meaning |
|---|---|
| **Identity** | A durable addressable participant record for a human, agent, or hybrid operator |
| **Alias** | A convenience handle such as `@codex-main` that resolves to a canonical identity or session |
| **Session** | A live session capability managed by SCO-003 |
| **Conversation** | Durable Scout thread history and work narrative |
| **Binding** | Routing state that connects an identity or conversation to a live session |
| **Crossover** | An authorized write or route across identity, session, and conversation boundaries |
| **Direct session write** | A typed session capability call such as `sendTurn`, `answer`, `decide`, or `interrupt` |
| **Conversation route** | A Scout message delivered through a bound identity/session instead of being stored only as thread history |

## Implementation Model

### 1. Canonical addresses

OpenScout SHOULD treat canonical IDs as the stable source of truth and aliases
as lookup conveniences.

Recommended canonical forms:

- `identity://<authority>/<identityId>`
- `session://<node>/<sessionId>`
- `conversation://<authority>/<conversationId>`

Recommended aliases:

- `@handle`
- short names for local session-backed identities
- conversation-scoped mentions that resolve through the binding layer

Resolution rules:

1. Aliases MUST resolve to a canonical identity or session before dispatch.
2. Ambiguous aliases MUST fail closed.
3. Alias resolution SHOULD preserve provenance about the original source
   string.

### 2. Identity records

An identity record SHOULD include:

- canonical identity ID
- authority node or owning namespace
- display name
- searchable aliases
- kind: `human`, `agent`, or `hybrid`
- discoverability flag
- optional metadata

Identity records answer the question: "Who is this addressable participant?"

### 3. Session bindings

A session binding connects one identity to one live session.

Binding rules:

1. A live session MAY exist without a binding.
2. An identity MAY exist without an active session.
3. A binding MUST reference a canonical identity and a canonical session.
4. A binding MUST encode whether it is observe-only, write-through, or
   approval-gated.
5. A binding MUST be revocable without deleting the underlying identity.
6. A binding MUST NOT be treated as durable session history.

Binding records answer the question: "Which live session currently speaks for
this identity?"

### 4. Conversation bindings

Scout conversations need a routing record separate from thread history.

The conversation binding SHOULD record:

- conversation ID
- target identity or target session
- routing mode
- whether replies are published manually or automatically
- provenance for the binding event

This lets Scout say:

- this thread is routed through the currently bound Codex session
- this thread is observing a human-operated session
- this thread should surface results back into the durable conversation

without storing the full live session trace in the conversation record.

### 5. Crossover routing

All crossover should flow through the same routing sequence:

1. Resolve source identity, source session, or source conversation.
2. Resolve the target alias or canonical endpoint.
3. Check binding state and policy.
4. Dispatch to the correct typed sink.
5. Record provenance for the route, not the whole session trace.

Typed sinks should map to the current architecture:

- session capability write paths use the SCO-003 session substrate
- durable conversation writes go through Scout conversation storage
- alias resolution and binding updates go through identity/binding state

### 6. Human, agent, and agent-to-agent crossover

SCO-004 should support three main crossover shapes:

1. **Human -> agent**
   A human actor sends a typed session write or conversation message to a
   bound agent session.
2. **Agent -> human**
   An agent or session-backed identity routes a message into a human-bound
   conversation or session.
3. **Agent -> agent**
   One identity writes to another identity's bound session or conversation
   route through the same binding layer.

The important constraint is that these are not special-case application flows.
They are all routed through the same identity, binding, and session resolution
machinery.

### 7. No recreated session logging

SCO-004 MUST NOT duplicate raw live trace into durable Scout storage.

Instead:

- session trace stays in `@openscout/agent-sessions` and `@openscout/session-trace`
- Scout conversation history stores the messages, decisions, and provenance
  relevant to the conversation
- bindings capture routing state, not the full execution trace

This preserves the split between durable narrative and live execution.

## Proposal Shape

The implementation should land as three cooperating layers:

1. **Identity registry**
   Owns canonical identity records and alias resolution.
2. **Binding registry**
   Owns identity-session and conversation-session bindings.
3. **Router**
   Resolves crossover requests into session writes or conversation writes.

That shape matches the current runtime structure instead of inventing a new
control plane.

## Completion Criteria

- identities are canonical and searchable
- aliases resolve to identities or sessions through a single routing path
- live sessions can be bound and unbound without recreating session history
- Scout conversations can route through bound sessions
- direct human/agent crossover uses typed session writes
- agent-to-agent crossover uses the same routing and provenance rules
- session trace still comes from the SCO-003 substrate, not durable history

## Open Questions

- whether identity records live in the broker, control plane, or both
- whether bindings are stored per node or replicated as a shared routing view
- how much of alias resolution should be human-managed versus auto-generated
- how auto-routing should behave when a bound session disappears mid-thread
- whether conversation bindings should support queued delivery or only live
  delivery
