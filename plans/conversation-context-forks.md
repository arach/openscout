---
title: Conversation context forks
status: concept
blurb: Organizing note for starting a new Chat in another harness from an existing conversation, plus durable named context states.
source:
  - docs/eng/sco-049-session-forking-and-excellent-session-states.md
  - docs/eng/sco-072-chat-fork-points.md
  - docs/runtime-sessions.md
  - packages/protocol/src/invocations.ts
  - packages/scout-native-core/Sources/ScoutCapabilities/SessionInitiation.swift
order: 8
---

# Conversation context forks

## The product idea

From any useful point in an existing Chat, start a **new Chat and a new harness
session** that inherit the useful working state. The destination may use the
same harness or a different one.

This is broader than a provider-native “start from thread” operation:

- **Same-harness fork:** Scout may use a native thread clone when the harness
  supports one.
- **Cross-harness fork:** Scout must materialize a bounded, harness-neutral
  context state and rehydrate the destination harness from it.
- **Reusable context:** a particularly good materialized state can be named,
  promoted, and used again without reopening the original Chat.

The stable product promise is therefore **fork from state**, not “clone this
provider thread.” Native cloning is an implementation optimization.

## What already exists

This concept is not starting from zero. The repo already contains most of the
semantic design under two engineering notes:

- [SCO-049: Session Forking And Excellent Session States](/eng/file/docs/eng/sco-049-session-forking-and-excellent-session-states.md)
  defines `new`, `reuse`, `existing`, and `fork`; separates the work target
  from the fork source; and introduces excellent / curated base states.
- [SCO-072: Chat Fork Points](/eng/file/docs/eng/sco-072-chat-fork-points.md)
  defines message boundaries, materialized Chat moments, bounded rehydration,
  provenance, and “fork before / after this message.”

Current implementation posture:

| Layer | Present now | Still missing |
| --- | --- | --- |
| Protocol | `session: "fork"`, `forkFromSessionId`, `forkFromStateId`, fork context limits, and lineage fields | A first-class persisted context-state record and resolver |
| Session initiation | `/api/sessions` and the shared native capability accept fork source ids | A deterministic source-state materializer and rehydration assembler |
| Chat provenance | A new Chat can be anchored to a source message/conversation | Anchoring is not yet full-context rehydration |
| macOS | “Branch from message” seeds a fresh draft from one message | It does not yet reconstruct the useful context up to that point |
| Session inspector | A “Fork” affordance exists | It currently follows exact-session continuation semantics and must not imply a true fork yet |
| State library | The excellent-state / curated-base model is documented | Naming, promotion, versioning, search, archive, and compatibility UI |

So the contract shape exists, but the important middle step—turning a source
moment into a portable, inspectable context state—does not.

## Keep the nouns separate

| Noun | Meaning |
| --- | --- |
| **Chat** | The Scout-owned conversation container visible to the operator. |
| **Session** | One concrete harness conversation/context. |
| **Fork point** | A durable boundary in a source Chat, usually before or after a message. |
| **Context state** | A bounded, portable rehydration artifact derived from a Chat, session, flight, or work item. |
| **Fork** | A policy that creates a new session from a context state and leaves the source untouched. |
| **Native clone** | A harness-specific way to implement a fork when available. |
| **Context label** | A human reference to a useful, immutable context-state version. |

“Continue” and “fork” must remain visibly different:

- **Continue this session** sends the next turn to the exact existing harness
  context.
- **Start a new Chat from here** creates a new Chat/session with inherited
  context.
- **Start from a saved context** creates a new Chat/session from a promoted
  state that may outlive its source Chat.

## The cross-harness path

The important scenario is:

```text
source Chat / Codex session
        ↓ choose “Start a new Chat from here”
materialize immutable context state
        ↓ preview + choose destination
new Chat / Claude session
```

The materialized state should carry:

1. Source Chat, anchor message, and before/after boundary.
2. Goal and current task frame.
3. Decisions, constraints, non-goals, and unresolved questions.
4. Relevant files, artifacts, evidence, and verification results.
5. Recent raw Chat tail when it fits the budget.
6. A labeled summary of older context.
7. Workspace provenance: project, worktree, branch, HEAD, dirty-state caveat.
8. Recommended next move.
9. Assembly method, token estimate, truncation, and limitations.

It must not pretend to reproduce hidden provider state or silently import a
harness transcript as Scout-owned Chat messages. Observed harness material may
inform the handoff, but it remains labeled observed material.

## Context references and labels

There are two different identity needs:

1. **Immutable identity:** a `stateId` identifies exactly what was captured.
   Fork provenance always stores this id.
2. **Human organization:** a label makes a good state findable and reusable.
   The label may move to a newer immutable version.

A safe initial model:

```ts
type ContextState = {
  id: ScoutId;                 // immutable version
  projectPath?: string;
  source: ContextSource;
  title: string;
  summary: string;
  decisions: string[];
  constraints: string[];
  evidence: ContextEvidenceRef[];
  nextMove?: string;
  compatibility?: {
    sourceHarness?: AgentHarness;
    portableAcrossHarnesses: boolean;
    preferredHarnesses?: AgentHarness[];
    requiredCapabilities?: string[];
  };
  createdAt: number;
};

type ContextLabel = {
  id: ScoutId;
  projectPath?: string;        // project scope by default
  slug: string;                // human handle; syntax not frozen yet
  title: string;
  stateId: ScoutId;            // current immutable version
  previousStateIds: ScoutId[];
  tags: string[];
  archivedAt?: number;
};
```

This avoids making a friendly label itself the source of truth. A launched
fork resolves the label once and records the resulting immutable `stateId`.

Do not freeze CLI sigils yet. `context:<name>`, `state:<name>`, and the existing
`--fork-base <name>` wording are all candidates. The durable model matters
first: project-scoped label → immutable state version, with explicit history.

## First useful product slice

V1 should prove cross-harness portability rather than native cloning:

1. Add **Start a new Chat from here** to a durable Chat message menu.
2. Materialize the Chat prefix through that message into a bounded context
   state.
3. Show a preview answering: **What will the new model remember?**
4. Let the operator choose project, harness, model, and optional instructions.
5. Launch a new Chat and a new destination session with
   `session: "fork" + forkFromStateId`.
6. Show source provenance and truncation on the first turn.
7. Let the operator **Save this context** with a title after materialization.

The preview is essential. Without it, a synthesized fork looks like magical
memory and the user cannot tell whether decisions, files, or recent turns were
lost.

## Studio study to add next

The plan itself now appears in Studio. A later interactive study can live at
`/studies/context-fork` and show one complete flow rather than separate form
fragments:

1. **Source moment** — Chat timeline with a selected fork boundary.
2. **Memory preview** — included sections, raw vs summarized content, token
   budget, truncation, and workspace provenance.
3. **Destination** — project + harness + model, making the harness change
   explicit.
4. **Saved context** — title, tags, immutable version, compatibility, and
   “supersedes” history.
5. **Result** — new Chat header with “Started from …” provenance and a link
   back to the source moment.

The study should compare these three verbs side by side:

- Continue exact session
- Start new Chat from here
- Start from saved context

## Decisions held for now

- A fork always creates a new execution session and leaves the source session
  untouched.
- The source context and destination worker are separate choices.
- Cross-harness portability is built on a context state, not transcript copy.
- `stateId` is immutable; a human label resolves to a version.
- Context state is inspectable before launch.
- Workspace state is provenance unless Scout has an explicit captured commit,
  patch, or artifact.

## Open decisions

1. Is a new Scout Chat always created for a fork, or can advanced callers fork
   a session while keeping messages in the current Chat?
2. Are labels project-scoped by default, with an explicit global library, or
   always global with project tags?
3. When should an automatic checkpoint become eligible for a human label?
4. Can a label point to a moving “latest good” version, or must updates always
   create a new label?
5. What minimum quality fields make a state portable across harnesses?
6. Should the operator be able to edit the rehydration bundle before launch?
7. How long do unpromoted materialized states live?
8. When a native clone exists, do we still generate the portable state for
   preview, provenance, and future cross-harness reuse?

## Near-term cleanup

- Align the current macOS **Fork** action with actual fork semantics or rename
  it **Continue** until materialization exists.
- Keep **Branch from message** described as a one-message seed until it carries
  the bounded Chat prefix and rehydration preview.
- Use SCO-049 for the session policy contract and SCO-072 for message-boundary
  materialization rather than creating a third competing protocol design.
- Implement the persisted context-state model before investing in label syntax.

