# SCO-049: Session Forking And Excellent Session States

## Status

Proposed.

## Proposal ID

`sco-049`

## Intent

Define a first-class session continuity contract for Scout asks so callers can
say whether work should run in fresh context, opportunistically reuse an
existing context, continue one exact session, or fork from an excellent prior
session state.

The immediate motivation is the project-routed ask failure mode that surfaced
when `ask({ projectPath, harness })` exposed ambiguity from old same-project
agents. That bug belongs to routing and is fixed separately. This proposal is
the larger product and protocol plan: make the caller's context intent explicit
and make "excellent session state" a reusable source for future work, so Scout
does not make the user choose an agent or session when the user only asked for
work to be done.

## Context

Scout currently has several overlapping concepts:

- **Agent identity / card** — who can own work or receive messages.
- **Project route** — where work should happen when the caller does not care
  which specific worker handles it.
- **Harness session** — a concrete Claude, Codex, Pi, or future runtime
  context.
- **Session state** — a bounded, reusable representation of what made a prior
  session valuable: task frame, decisions, files, evidence, constraints, and
  next move.
- **Invocation** — broker-owned work request and flight lifecycle.

The bug fixed around `projectPath` routing showed the distinction matters.
When a caller provides a project path and no session id, they are not asking to
choose between historical sessions. They are saying: "have a suitable worker
for this repo handle the work." Existing agent registrations are broker
implementation detail unless the caller explicitly targets one.

At the same time, there are real cases where prior context matters:

- Continue an active Codex thread because the next instruction depends on its
  working memory.
- Reuse a warm local session for cheap latency when prior context is harmless.
- Start fresh work but seed it from a prior session's excellent state, summary,
  or chosen turn.
- Ask another project worker to branch off from a failed or stale attempt.

Those are different user intents and should not all be encoded as
`targetSessionId`.

Relevant prior work:

- [`docs/runtime-sessions.md`](../runtime-sessions.md) — current session,
  endpoint, card, and ask semantics
- [`sco-034`](./sco-034-agent-ask-primitive.md) — ask primitive
- [`sco-039`](./sco-039-durable-invocation-and-delivery-lifecycle.md) —
  invocation, delivery, and flight lifecycle
- [`sco-042`](./sco-042-harness-event-normalization-and-replay-boundary.md) —
  observed harness material boundary
- [`sco-046`](./sco-046-cross-machine-agent-ui-spec.md) — cross-machine route
  and capability gating
- [`docs/data-ownership.md`](../data-ownership.md) — Scout-owned records vs
  observed external harness transcripts

## Product Thesis

The caller should choose the work, not the worker plumbing.

Scout's routing modality is valuable because it lets the operator or another
agent say "review this repo," "continue that exact thread," or "branch from
that prior work" without manually inspecting stale sessions, agent labels,
transport types, or endpoint state.

Forking is the missing middle between "fresh" and "continue," but the source is
not the transcript. The source is an excellent session state: a compact,
high-signal checkpoint that captures why a session was useful and what the next
worker should inherit.

The product should encourage agents and operators to produce better session
states over time. A successful session can end by leaving behind a reusable
state. A fork can start from that state, improve it, and leave a sharper one
for the next fork. That is the compounding loop.

The strongest version is a small library of carefully constructed base states:
the handful of sessions that are in a really good place for a recurring class
of work. When similar work appears, the operator or broker can fork from the
right base state instead of rebuilding context from scratch or continuing a
busy live thread.

## Scope

In scope:

- Session policy vocabulary for asks and invocations
- Protocol shape for fork source references
- Session state snapshot and promotion model
- Broker routing behavior for `new`, `reuse`, `existing`, and `fork`
- Data ownership rules for fork context assembly
- Harness capability model for native fork vs synthesized handoff
- MCP and CLI surface wording
- Phased implementation plan and acceptance criteria

Out of scope:

- Full transcript import into Scout-owned messages
- Cross-harness perfect replay of provider-native context
- Merging diverged fork outputs back into one model session
- UI for comparing fork branches side by side
- Enterprise audit/compliance guarantees for fork lineage

## Terms

| Term | Meaning |
| --- | --- |
| Work target | The project, agent, card, or exact session that should execute the ask. |
| Return target | The requester session or conversation that should receive the reply. |
| Source session | A prior harness session used only as context input for a fork. |
| Session state | A bounded state snapshot derived from a session or work item. |
| Excellent state | A session state that is good enough to reuse: clear goal, decisions, constraints, relevant files, evidence, and next move. |
| Curated base state | An excellent state intentionally kept as a reusable fork source for a recurring class of work. |
| Execution session | The concrete session that runs the new ask. |
| Native fork | A harness-supported provider/runtime operation that branches from an existing thread. |
| Synthesized fork | A Scout-built handoff assembled from broker-owned records and observed harness material. |

## Session Policy Contract

Scout should expose four caller-facing policies.

| Policy | Meaning | Target behavior |
| --- | --- | --- |
| `new` | Run in fresh model context. | Route by project/agent and create a fresh compatible worker if needed. Existing same-project sessions must not force user-visible ambiguity. |
| `reuse` | Prefer a compatible existing session, but start fresh if none is suitable. | Broker chooses the best warm compatible session as an optimization; user did not request exact continuity. |
| `existing` | Continue one exact session. | `targetSessionId` is required and resolves to the session owner. Failure is actionable if the session is stale or unavailable. |
| `fork` | Start a new execution session from a specified source state. | `forkFromStateId` or `forkFromSessionId` identifies source context. Work target remains project/agent unless explicitly inferred. |

Current protocol uses `session: "any"` internally for what the MCP surface calls
`reuse`. The implementation should either add `reuse` as the public protocol
spelling and keep `any` as a compatibility alias, or continue mapping
MCP/CLI `reuse` to wire `any` until the protocol can safely change.

## Proposed API Shape

Extend invocation execution preferences:

```ts
type InvocationExecutionPreference = {
  harness?: AgentHarness;
  permissionProfile?: ScoutPermissionProfile;
  session?: "new" | "reuse" | "any" | "existing" | "fork";
  targetSessionId?: ScoutId;
  forkFromStateId?: ScoutId;
  forkFromSessionId?: ScoutId;
  forkContext?: {
    maxMessages?: number;
    maxBytes?: number;
    includeBrokerRecords?: boolean;
    includeObservedHarnessMaterial?: boolean;
  };
};
```

Rules:

- `targetSessionId` means exact continuation and implies `session: "existing"`.
- `forkFromStateId` means source state and implies `session: "fork"` unless
  explicitly rejected for ambiguity.
- `forkFromSessionId` means "derive a source state from this session" and
  implies `session: "fork"` unless explicitly rejected for ambiguity.
- `targetSessionId` and `forkFromSessionId` may not be the same field by
  accident. If both are present, `targetSessionId` is the execution target and
  `forkFromSessionId` is only source context; this should be rare and logged.
- `projectPath + session: "fork" + forkFromStateId` is the preferred fork
  shape: do work in this project, in a new execution session, seeded from a
  known-good state.
- `projectPath + session: "fork" + forkFromSessionId` is the V1-compatible
  shape when no promoted state id exists yet.
- `projectPath + session: "new"` remains the default when no session policy is
  given.

Example:

```json
{
  "projectPath": "/Users/arach/dev/openscout",
  "harness": "codex",
  "session": "fork",
  "forkFromStateId": "state-session-abc123-review-ready",
  "body": "Continue the review, but take a stricter pass on routing semantics."
}
```

## Routing Semantics

### `new`

The broker resolves work by project or agent identity. If existing candidates
are ambiguous and no exact target was requested, the broker should create a
fresh one-time project card/session rather than ask the caller to pick between
stale or equally plausible workers.

### `reuse`

The broker may choose an existing compatible session by policy:

1. exact project root match
2. requested harness/profile match
3. local and reachable before remote or stale
4. idle/waiting before active
5. most recently healthy endpoint

If no compatible session exists, start fresh. A `reuse` miss is not an error.

### `existing`

The broker resolves the target session directly. If the session cannot be
found, belongs to an incompatible harness, or is stale, the response should
fail with remediation such as "start a new ask," "fork instead," or "wake this
session."

### `fork`

The broker resolves the source state separately from the work target. If the
caller provides only a session id, the broker first derives a bounded state from
that session. The source session never receives the new ask unless the caller
also explicitly targets it. The broker then chooses or creates a new execution
session using the requested project/agent/harness constraints.

## Excellent Session States

Fork sources should be excellent states, not arbitrary transcript tails.

An excellent state should include:

- the goal and current task frame
- the project root, branch/worktree, and relevant files
- key decisions already made
- constraints and non-goals
- evidence gathered, including verification commands and results
- known failures, stale assumptions, or unresolved questions
- the recommended next move

States can be created in three ways:

- **Automatic checkpoint**: broker/runtime creates a state when an invocation
  reaches a meaningful boundary such as completed, blocked, or review.
- **Agent-authored promotion**: the worker explicitly marks a state as worth
  reusing and supplies a compact handoff.
- **Operator promotion**: the UI lets the operator promote a session, flight,
  message, or work item into a reusable fork source.

Excellent state is a quality bar, not just a storage type. The default UI
should show promoted states before raw sessions when asking "fork from where?"

## Curated Base State Library

Some states should be treated as durable bases rather than incidental
checkpoints. These are the carefully prepared sessions that are useful to fork
from repeatedly: a review posture for routing changes, a docs editor posture,
a mobile UI implementation posture, a broker-debug posture, or any other
recurring work shape.

A curated base state should have:

- a human-readable name and short description
- tags for the work class it supports
- project and harness compatibility
- a freshness signal, including last verified date and relevant branch
- an owner or maintainer
- a compact state body that can be inspected before forking
- optional constraints such as preferred model, permission profile, or
  required tools

Curated bases should not be hidden inside session history. They should be first
class fork sources that appear in picker/search surfaces ahead of raw sessions.
The operator should be able to update, supersede, archive, and compare them.

The broker can still create automatic state snapshots, but automatic snapshots
and curated base states serve different purposes:

| State kind | Purpose |
| --- | --- |
| Automatic snapshot | Capture useful state at natural work boundaries. |
| Promoted state | Mark a snapshot as worth reusing. |
| Curated base state | Maintain a stable, intentionally prepared fork source for recurring work. |

## Fork Context Assembly

Fork context assembly turns a source state into the input for a new execution
session. It must respect the existing data-ownership boundary:

- Broker-owned records can be copied or summarized as Scout-owned context.
- External harness transcripts remain observed material.
- Scout must not bulk-import observed transcript turns as first-party Scout
  conversation messages.
- Fork provenance should record source state id, source session id when known,
  source harness, source project root when known, assembly strategy,
  byte/message limits, and whether native or synthesized fork was used.

For synthesized forks, the broker should construct a bounded handoff:

1. Source state identity, source session identity, project, and harness
2. Related invocation, flight, work item, and conversation ids
3. Promoted state body: goal, decisions, constraints, evidence, and next move
4. A compact summary or excerpt of observed harness material, clearly labeled
   as observed material
5. The new ask body

This handoff is input to the execution session, not new durable conversation
history.

## Harness Capability Model

Harnesses should advertise fork support through capabilities rather than
special-case checks in callers.

Candidate capability names:

| Capability | Meaning |
| --- | --- |
| `session.fork.native` | Harness can branch from a provider/runtime thread without synthetic context. |
| `session.fork.synthetic` | Harness can accept a Scout-built handoff in a fresh session. |
| `session.resume.exact` | Harness can continue a specific session id. |
| `session.reuse.compatible` | Harness can safely receive asks in an existing compatible session. |

Codex may support native thread resume today, but a true provider-native fork
needs to be verified before advertising `session.fork.native`. Until then,
Codex should support synthesized forks.

Claude stream JSON should likely start with synthesized forks. Pi and future
harnesses can opt in later through the same capability registry.

## UI And Tooling

MCP `ask` should describe the session policy plainly:

- no session field: fresh project/agent work
- `session: "reuse"`: reuse only as an optimization
- `targetSessionId`: continue exact session
- `session: "fork" + forkFromStateId`: start new work from a promoted state
- `session: "fork" + forkFromSessionId`: derive state from a prior session

CLI examples:

```bash
scout ask --project /Users/arach/dev/openscout "review the routing change"
scout ask --project /Users/arach/dev/openscout --reuse "do the next small fix"
scout ask --session codex-thread-abc123 "continue exactly here"
scout ask --project /Users/arach/dev/openscout --fork-from-state state-review-ready "take a fresh pass"
scout ask --project /Users/arach/dev/openscout --fork-from codex-thread-abc123 "take a fresh pass"
scout ask --project /Users/arach/dev/openscout --fork-base broker-routing-review "review this ask change"
```

The web and native UI should avoid asking users to choose from sessions unless
they explicitly select "continue exact session" or "fork from this session."
For forking, promoted excellent states should appear before raw sessions.
Curated base states should appear before ordinary promoted states.

## Decisions

### Fork source is state, not target identity

Rationale: a fork source answers "what prior state should seed this?" It does
not answer "which worker should execute this?" Keeping those separate preserves
the project-routed modality.

### Forks should prefer excellent states over raw sessions

Rationale: raw session history is often noisy. The product value comes from
capturing a high-quality operational state that another worker can inherit
without replaying the entire transcript.

### Recurring work should fork from curated base states

Rationale: many agent workflows repeat. A carefully constructed base state for
that class of work is more valuable than rediscovering context each time. This
turns session work into reusable operational capital.

### `new` remains the default for project asks

Rationale: project-routed work should be cheap and low ceremony. Historical
session state should not leak into fresh asks without an explicit policy.

### `reuse` is best-effort

Rationale: reuse is an optimization for latency and continuity when harmless.
If the broker cannot confidently reuse a compatible session, it should start
fresh rather than block the caller.

### `existing` is strict

Rationale: exact continuation is high intent. If the target session is missing
or stale, silently falling back to a different worker would corrupt the user's
mental model.

### Synthesized forks are acceptable V1

Rationale: native fork support varies by harness. A bounded, clearly labeled
handoff from an excellent state gives the product value now while preserving
the option to use native provider forks later.

## Implementation Phases

### Phase 1 — Contract and diagnostics

Update protocol, MCP schemas, CLI parsing, and docs to distinguish `new`,
`reuse`, `existing`, and `fork`, and to represent source state separately from
target session.

Acceptance criteria:

- `InvocationExecutionPreference` can represent `forkFromSessionId`.
- `InvocationExecutionPreference` can represent `forkFromStateId`.
- MCP `ask` rejects invalid combinations with actionable errors.
- CLI help includes `--reuse`, `--session`, `--fork-from-state`, and
  `--fork-from` examples.
- Existing `targetSessionId` behavior remains exact-session continuation.

### Phase 2 — Broker routing policy

Teach broker delivery and invocation routing to resolve source session and work
target separately.

Acceptance criteria:

- `projectPath + forkFromStateId` creates a new execution session and does
  not deliver the ask into the source session.
- `projectPath + forkFromSessionId` derives source state before creating a new
  execution session.
- `targetSessionId` still routes to the exact session owner.
- `reuse` never returns ambiguity solely because multiple old project sessions
  exist; it starts fresh when no clear compatible session wins.
- Flight metadata records session policy, fork source state, and source session
  when present.

### Phase 3 — Excellent state snapshots

Create and expose reusable session states.

Acceptance criteria:

- Completed, blocked, and review-state invocations can produce state snapshots.
- Agents can promote a state with goal, decisions, constraints, evidence, and
  next move.
- Operators can promote a state from session, flight, message, or work detail.
- State snapshots record source ids and do not duplicate full external
  transcripts.

### Phase 4 — Curated base state library

Add durable management for intentionally maintained fork sources.

Acceptance criteria:

- Operators can name, tag, archive, and supersede curated base states.
- Curated bases record project, harness, model, permission, and verification
  metadata.
- Fork source pickers show curated bases before ordinary promoted states and raw
  sessions.
- A curated base can be forked by id or stable handle.

### Phase 5 — Synthesized fork context

Build a bounded fork handoff assembler using broker-owned records and observed
harness material.

Acceptance criteria:

- Handoff includes source state identity, related Scout records, and the new ask
  body.
- Observed harness content is labeled as observed material.
- Byte/message limits are enforced.
- No observed transcript turns are imported as first-party Scout messages.

### Phase 6 — Harness integration

Wire synthesized forks through Codex and Claude local-agent paths, with
capability flags for native fork support when proven.

Acceptance criteria:

- Codex can receive a forked ask in a new thread/session with the synthesized
  handoff.
- Claude stream JSON can receive the same synthesized handoff in a new session.
- Unsupported harnesses return a clear capability error.
- Capability summaries expose fork support to UI and remote routing.

### Phase 7 — Operator surfaces

Add UI affordances only after the broker contract is stable.

Acceptance criteria:

- Session detail exposes "Continue here" and "Fork from here" as separate
  actions.
- Ask composer can attach a promoted state or raw-session fork source without
  changing the work target.
- State library surfaces let operators maintain the handful of best fork bases.
- Flight/session views show fork provenance.
- Ranger and mobile surfaces can display forked work without introducing new
  first-party transcript storage.

## Open Questions

1. Should `reuse` become the public protocol spelling, with `any` retained only
   as a deprecated wire alias?
2. Do we need `forkFromMessageId` or `forkFromFlightId`, or is session id plus
   broker context enough for V1?
3. Should `forkFromStateId` be the only stable API after V1, with session,
   message, and flight ids treated as promotion inputs?
4. How should the broker choose the cut point inside a long source session if
   the caller only supplies a session id?
5. What is the default fork context budget for local developer pilots?
6. What qualifies a state as excellent enough to surface above raw sessions?
7. How many curated bases should be visible by default before the picker becomes
   cluttered?
8. Should curated bases be project-local, user-local, or shareable across a
   trusted mesh?
9. Should native fork support be opt-in per harness version, per endpoint, or
   per active session?
10. How should cross-machine forks behave when the source session lives on a
   peer broker?

## Non-Goals

- Fork diff/merge UI
- Shared mutable session branches
- Exactly-once distributed fork execution
- Persistent storage of full external harness transcripts
- Policy claims beyond high-trust local developer pilots

## References

- [`docs/runtime-sessions.md`](../runtime-sessions.md)
- [`docs/data-ownership.md`](../data-ownership.md)
- [`docs/agent-integration-contract.md`](../agent-integration-contract.md)
- [`sco-034`](./sco-034-agent-ask-primitive.md)
- [`sco-039`](./sco-039-durable-invocation-and-delivery-lifecycle.md)
- [`sco-042`](./sco-042-harness-event-normalization-and-replay-boundary.md)
- [`sco-046`](./sco-046-cross-machine-agent-ui-spec.md)
