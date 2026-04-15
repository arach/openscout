# Collaboration Workflows

When agents work together — or when a human works with agents — every interaction carries an implicit question: is this a request for information, or a request for work? The difference matters because they have different lifecycles, different ownership semantics, and different definitions of done.

Scout makes this distinction explicit with two collaboration workflows.

## Two Kinds of Collaboration

| | Question | Work Item |
|---|---|---|
| **Goal** | Get information back | Get something built, fixed, or reviewed |
| **Lifecycle** | Ask → answer → close | Assign → work → checkpoint → review → done |
| **Duration** | Short | Long, potentially multi-turn |
| **Ownership** | Rotates between asker and responder | Stays with assigned owner until handoff |

These are peers, not stages in a pipeline. A question doesn't become a work item by getting complex — it spawns one. A work item doesn't need a question to exist — it can be self-originated.

## Why Two, Not One

The broker already handles durable conversations and invocation tracking. But it doesn't yet express the semantic layer above routing:

- Some interactions only need an answer.
- Some interactions need ownership, waiting states, review, and completion tracking.
- Some interactions start as questions and reveal real execution work along the way.

Forcing all of these into one noun creates either ceremony (every question gets a kanban board) or ambiguity (is this "done" because someone replied, or because the work shipped?).

## Question

Use a question when the goal is getting information back.

**States:** `open` · `answered` · `closed` · `declined`

A question can be closed immediately after an answer. It can also stay open if the asker is not satisfied — "answered" means someone responded, not that the asker agrees. If the answer reveals real execution work, the question spawns a work item rather than growing into one.

## Work Item

Use a work item when the goal is durable execution, progress tracking, or multi-turn coordination.

**States:** `open` · `working` · `waiting` · `review` · `done` · `cancelled`

A work item can be self-originated, requested by another party, or spawned from a question. Progress tracking is optional but first-class — "3 of 7 steps complete" is a work item concern, never a question concern. The `waiting` state (preferred over "blocked") signals that the current owner cannot proceed until someone else acts.

## Acceptance Is Orthogonal

Acceptance is separate from workflow state. This avoids collapsing "I replied" into "we both agree this is done."

- A question can be `answered` but not yet `closed` — the asker has not confirmed satisfaction.
- A work item can be in `review` with `acceptanceState=pending` — the reviewer has not weighed in.
- A self-driven work item uses `acceptanceState=none` — there is no external reviewer.

## Ownership

Every non-terminal collaboration record must have a `nextMoveOwnerId` — the party who needs to act next. This is the foundation of the sweeper, notification routing, and stale detection. Ownership transfers explicitly with each state transition.

### Required Fields

| Field | Question | Work Item |
|---|---|---|
| `id` | yes | yes |
| `title` | yes | yes |
| `createdById` | yes | yes |
| `ownerId` | yes | yes |
| `nextMoveOwnerId` | yes | yes |
| `createdAt` | yes | yes |
| `updatedAt` | yes | yes |
| `waitingOn` | — | yes |
| `progress.completedSteps` | — | yes |
| `progress.totalSteps` | — | yes |
| `progress.summary` | — | yes |

## Sequences

### Question Flow

1. Asker creates a question
2. Scout routes it to a responder
3. Responder posts an answer → state becomes `answered`
4. Asker reviews and closes — or leaves open for follow-up

### Question That Spawns Work

1. Asker creates a question
2. Responder determines it needs execution, not just an answer
3. Scout creates a work item linked to the question
4. Asker sees both the answer and the spawned work item

### Work Item Flow

1. Creator opens a work item and assigns an owner
2. Owner moves to `working` and posts progress checkpoints
3. If blocked, owner moves to `waiting` and names the dependency
4. Scout nudges the next move owner
5. Once unblocked, work resumes
6. Owner moves to `review` when done
7. Creator accepts or reopens → on acceptance, state becomes `done`

## Sweeper

The sweeper is an insurance policy, not a planner. It periodically inspects stale non-terminal records and nudges the current `nextMoveOwnerId` — the one party whose action would unblock progress.

Rules:

- Do not invent new work.
- Do not reinterpret goals.
- Do not ping everyone in the thread.
- Only ask the current next move owner whether they can transition the state.

| Stale state | Sweeper action |
|---|---|
| `question.open` | Ask the responder to answer or decline |
| `question.answered` | Ask the asker to close or reopen |
| `work_item.working` | Ask the owner for a progress update or waiting transition |
| `work_item.waiting` | Ask the `nextMoveOwnerId` to resolve the dependency |
| `work_item.review` | Ask the reviewer to accept or reopen |

## Invariants

1. Every non-terminal record must have a `nextMoveOwnerId`.
2. `waiting` is only valid for work items.
3. A `waiting` work item must name `waitingOn`.
4. Acceptance is only used when a requester or reviewer exists.
5. Questions do not accumulate long-running execution state. If the interaction becomes durable work, spawn a work item.

## Next Iteration

V1 keeps the surface small on purpose. The canonical kinds (question, work item) and required fields are stable — future iterations layer on top without breaking interop.

What's coming next:

- **Configurable workflows** — user-defined labels and state presets on top of the same protocol semantics
- **Richer hierarchy** — dependency graphs and parent-child linking beyond simple spawn relationships
- **Milestone planning** — optional structure for tracking groups of related work items
- **Selective acceptance** — per-project control over which interactions require reviewer sign-off
