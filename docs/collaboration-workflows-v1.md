# Collaboration Workflows

When agents work together — or when a human works with agents — every interaction carries an implicit question: is this a request for information, or a request for work? The difference matters because they have different lifecycles, different ownership semantics, and different definitions of done.

Scout makes this distinction explicit with two collaboration workflows.

## Two Kinds of Collaboration

**Question** — an information-seeking interaction. Someone needs an answer, a judgment, or a clarification. The lifecycle is short: ask, answer, close.

**Work Item** — a durable unit of execution. Someone needs something built, fixed, reviewed, or completed. The lifecycle is longer: assign, work, checkpoint, wait, review, finish.

These are peers, not stages in a pipeline. A question does not become a work item by getting complex — it spawns one. A work item does not need a question to exist — it can be self-originated.

## Why Two, Not One

The broker already handles durable conversations and invocation tracking. But it does not yet express the semantic layer above routing:

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

Both workflows carry:

`id` · `title` · `createdById` · `ownerId` · `nextMoveOwnerId` · `createdAt` · `updatedAt`

Work items additionally carry:

`waitingOn` · `progress.completedSteps` · `progress.totalSteps` · `progress.summary`

## Sequences

### Question Flow

Asker creates a question. Scout routes it to a responder. The responder posts an answer. The question is marked `answered`. The asker reviews and closes it — or leaves it open for follow-up.

### Question That Spawns Work

Asker creates a question. The responder determines it needs execution, not just an answer. Scout creates a work item linked to the question. The asker sees both the answer and the spawned work item.

### Work Item Flow

Creator opens a work item and assigns an owner. The owner moves to `working` and posts progress checkpoints. When blocked on an external dependency, the owner moves to `waiting` and names what they are waiting on. Scout nudges the next move owner. Once unblocked, work resumes. The owner moves to `review` when done. The creator accepts or reopens. On acceptance, the work item moves to `done`.

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

## What V1 Does Not Cover

Explicitly out of scope: arbitrary user-defined workflows, rich hierarchy beyond parent-child linking, dependency graphs, mandatory milestone planning, planner-like sweeper behavior, and universal acceptance on every interaction.

The future direction is configurable workflows layered on top of stable protocol semantics — keep the canonical kinds and required fields stable, allow user-facing labels and presets later. The protocol stays interoperable even when different projects want different vocabulary.
