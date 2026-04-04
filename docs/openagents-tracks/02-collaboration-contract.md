# Collaboration Contract Track

## Purpose

Define the collaboration semantics that every OpenScout harness must obey.

This track is about the contract between the broker, adapters, and agents:

- how identity is represented
- how work is delegated
- when an agent is woken
- how conversation differs from durable work
- how `@mentions` map to routing
- how a harness receives the same collaboration rules regardless of runtime

The goal is not a prettier chat layer. The goal is a stable broker-owned contract that lets Claude, Codex, tmux-based agents, and future runtimes participate in the same system without per-harness semantic forks.

## Non-Goals

- Do not redesign the native shell UI.
- Do not replace the broker protocol with a prompt-only system.
- Do not make routing fully LLM-dependent.
- Do not collapse questions, work items, and chat into one generic message stream.
- Do not require every harness to share the same transport or API surface.

## Canonical Concepts

OpenScout should treat these as distinct records:

- `identity`: who the agent is in the broker model
- `conversation`: the human-readable thread or channel
- `message`: a conversational turn inside a conversation
- `work_item`: durable execution with ownership, progress, and completion
- `invocation`: an explicit request to do work
- `delivery`: routing intent from the broker to a target agent
- `flight`: the lifecycle of a work request or delivery
- `binding`: a durable link from an external surface or harness into the same broker model

This aligns with the current broker-first direction in [OpenScout Architecture](/Users/arach/dev/openscout/docs/ARCHITECTURE.md) and the `question` / `work_item` split in [Collaboration Workflows V1](/Users/arach/dev/openscout/docs/collaboration-workflows-v1.md).

## Identity Model

Use a two-level identity model:

- `logicalAgentId`: stable human-facing name used in `@mentions` and routing
- `endpointId`: the concrete harness instance or process currently attached to that identity

Recommended broker fields:

```json
{
  "logicalAgentId": "codex-luna",
  "endpointId": "endpoint-01HXYZ",
  "harnessType": "codex",
  "workspaceId": "workspace-abc123",
  "projectPath": "/Users/me/dev/openscout",
  "status": "online"
}
```

Rules:

- `logicalAgentId` is stable across restarts when possible.
- `endpointId` changes when the harness process, machine, or session changes.
- routing should prefer `logicalAgentId` unless the user explicitly targets a specific endpoint.
- the broker owns the mapping from logical identity to active endpoints.

## Delegation Semantics

OpenScout should support three delegation forms:

- direct mention: `@codex-luna`
- explicit assignment: `ownerId=codex-luna`
- durable next-move assignment: `nextMoveOwnerId=codex-luna`

Semantics:

- a leading mention in a message is a hard routing signal
- mentions inside a message are soft routing hints unless the broker chooses to treat them as hard
- a `work_item` must always have a current owner and a current next-move owner
- a `question` may be answered without creating work
- if the answer reveals durable execution, the broker should spawn a `work_item` linked to the question

The current workflow guidance in [Collaboration Workflows V1](/Users/arach/dev/openscout/docs/collaboration-workflows-v1.md) should be treated as the semantic baseline:

- `question` for information-seeking interactions
- `work_item` for durable execution and coordination

## Waking Rules

The broker should wake the minimum set of targets needed to preserve responsibility.

Default waking order:

1. explicit `@mention`
2. `nextMoveOwnerId`
3. `ownerId`
4. conversation master or channel owner
5. no wake, if the message is final, informational, or terminal

Rules:

- wake only the current responsibility holder, not everyone in the conversation
- do not wake the sender for their own message unless the message explicitly requests a follow-up
- do not use broadcast wakeups for ordinary delegation
- treat `waiting` as a real state, not a failure state
- if a work item is waiting on a dependency, wake the dependency owner, not the entire work group

## Durable Work vs Conversation

Conversation is ephemeral enough to be read like chat.
Work is durable enough to survive restarts and handoffs.

OpenScout should keep these separate in storage and UI behavior:

- conversation records answer: "what was said?"
- work records answer: "what is owned, blocked, waiting, and done?"

Implementation guidance:

- messages may create or reference work, but they should not become the work record
- work items may summarize chat, but the summary is not the canonical thread
- progress, waiting, review, and completion belong to work items
- routing history must be reconstructable from durable records, not terminal scrollback

## Protocol Shapes

Use append-only broker events with explicit targets.

Core shape:

```json
{
  "id": "evt-123",
  "type": "collab.message.posted",
  "source": "openagents:codex-luna",
  "target": "conversation:thread-9",
  "payload": {
    "text": "Please review this change",
    "kind": "chat"
  },
  "metadata": {
    "mentions": ["claude-river"],
    "targetAgents": ["claude-river"],
    "inReplyTo": "evt-122"
  }
}
```

Recommended event families:

- `collab.message.posted`
- `collab.question.created`
- `collab.question.answered`
- `collab.work_item.created`
- `collab.work_item.updated`
- `collab.delivery.requested`
- `collab.delivery.woken`
- `collab.agent.heartbeat`
- `collab.agent.online`
- `collab.agent.offline`

Recommended broker invariants:

- every routed event has a single canonical source and target
- every non-terminal work record has `ownerId` and `nextMoveOwnerId`
- every wake decision is explainable from stored metadata
- a delivery should be derivable from a message, work item, or explicit invocation

## Routing Behavior

Routing should be deterministic first, adaptive second.

Suggested order:

1. parse explicit mentions
2. resolve the target logical agent
3. check whether the target is active
4. if not active, resolve the next available endpoint for that logical agent
5. if multiple candidates exist, choose the current workspace/project-local endpoint first
6. only then consider any model-assisted fallback

Rules:

- the broker is the only component that decides canonical delivery
- adapters may help form a prompt or submit a delivery, but they do not own routing truth
- message routing should preserve the original message even when the wake target changes
- ambiguous multi-agent threads may use an LLM router, but only as a fallback behind explicit broker rules

## Harness Adapter Responsibilities

Every adapter should do four things and only four things:

- present the broker with the harness identity and capabilities
- inject the collaboration contract into the harness prompt or session context
- emit heartbeats and lifecycle changes for the attached endpoint
- wake or resume the harness when the broker assigns work

Adapter requirements:

- include the current logical agent identity in every prompt contract
- include the current conversation/work context in the prompt
- include the allowed collaboration verbs: delegate, answer, wait, review, complete
- suppress accidental broad wakeups
- translate harness-specific events back into broker events without losing semantics

Adapters should not:

- invent new collaboration nouns per harness
- reinterpret `@mentions`
- rewrite work state transitions
- turn a wake request into an unbounded restart loop

## Prompt Contract Guidance

Every harness prompt should contain the same collaboration contract sections:

- identity
- current workspace or project context
- current conversation or work item
- delegation rules
- mention rules
- stop/wait/review semantics
- allowed tools and resources

Prompt rules:

- `@mention` only when delegating real work
- do not mention an agent to say thanks or acknowledge receipt
- if the task is complete, answer the human without waking other agents
- if more work is required, create or update the work item and set the next owner
- if the harness cannot act safely, mark the work as waiting instead of guessing

The prompt contract should be identical in meaning across harnesses even if the exact syntax differs.

## Rollout Phases

### Phase 1: Contract Freeze

- write the canonical collaboration nouns and state transitions
- define the event payload shapes
- decide the identity split between logical agent and endpoint

### Phase 2: Broker Enforcement

- validate mention parsing and target resolution in the broker
- persist work and delivery records before waking any harness
- make wake decisions explainable from stored metadata

### Phase 3: Adapter Standardization

- update each harness adapter to inject the same collaboration contract
- standardize heartbeat and resume behavior
- normalize harness-specific lifecycle events into broker events

### Phase 4: Recovery and Sweeping

- add stale-work sweeps for `waiting`, `review`, and unanswered delegation
- wake only the current next-move owner
- make restart recovery deterministic from durable state

### Phase 5: Surface Consistency

- expose identity, ownership, and routing state consistently in UI surfaces
- show when an agent is online, waiting, or requires attention
- keep the same semantics across native shell, CLI, and web surfaces

## Testing And Verification

This track needs tests that prove the semantics, not just the syntax.

Required coverage:

- mention parsing routes to the intended target
- leading mention vs soft mention behavior
- `question` stays non-durable unless it spawns work
- `work_item` always has a next-move owner
- broker wakeups target only one responsibility holder
- adapter prompt snapshots include the collaboration contract sections
- restart recovery reconstructs routing from durable records

Useful test forms:

- pure unit tests for mention parsing and routing selection
- broker integration tests for work item state transitions
- adapter snapshot tests for prompt contract generation
- harness-mock tests that verify no accidental broadcast wakeups occur

## Risks

- If mention semantics drift across adapters, routing will become inconsistent and users will not trust delegation.
- If the broker does not own the canonical target decision, the same message can wake different agents on different harnesses.
- If work and conversation stay conflated, recovery and retry logic will remain fragile.
- If the prompt contract is left ad hoc per adapter, the system will accumulate hidden behavioral forks.
- If wakeups are too broad, the collaboration layer will become noisy and expensive.

## Open Questions

- Should `@mentions` resolve to bare logical agent names only, or should they also support fully qualified endpoint addresses?
- When both `ownerId` and `nextMoveOwnerId` exist, should the broker ever wake the owner instead of the next-move owner?
- Should model-assisted routing be enabled only for multi-agent channels, or also for single-agent fallback recovery?
- Do we want a first-class `agent.mention` event, or is metadata on `message.posted` enough?
- How much of the collaboration contract should live in shared docs versus generated adapter prompt templates?

## Practical Next Step

Implement the broker-side routing and identity rules first, then make every adapter consume that contract unchanged. That keeps the root cause in one place and prevents each harness from becoming its own policy engine.
