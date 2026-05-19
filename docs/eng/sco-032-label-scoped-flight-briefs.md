# SCO-032: Label-Scoped Firehose and Briefs

## Status

Accepted for implementation.

## Proposal ID

`sco-032`

## Context

Scout agents are beginning to coordinate across harnesses by delegating long
turns to each other. The missing operator and agent affordance is not more chat.
It is a compact way to know whether related work is still moving.

Earlier thinking framed this as a "goal" object above flights. That is heavier
than the first version needs to be. A label can bind related records without
requiring Scout to own a new lifecycle or workflow state machine.

## Decision

Scout will treat labels as lightweight coordination metadata.

Labels are durable strings attached to records that should be understood
together. A label can mean a goal, release, milestone, incident, experiment, or
any other local convention. Scout does not assign lifecycle semantics to the
label.

For V1, labels apply to asks, their flights, broker-created work items, and
broker-visible messages. The primary operator and agent primitive is a
normalized label feed:

```text
scout ask --to hudson --label release:0.2.66 "review the package bump"
scout label feed release:0.2.66
scout label watch release:0.2.66
scout label brief release:0.2.66
```

`watch` is a firehose-style stream over normalized Scout-owned events. `brief`
is a digest built from the same label-scoped material.

## Goals

- Let multiple agents join, resume, or audit related work without reading every
  conversation.
- Keep coordination non-chatty: a label watch should show movement without
  requiring agents to narrate in chat.
- Make `brief` a digest over the same normalized activity, eventually backed by
  an LLM summarizer rather than a hand-maintained label lifecycle.
- Avoid lifecycle modeling for labels.
- Preserve existing broker-owned flight and work item semantics.
- Leave room for unified tail activity to enrich the same feed shape.

## Non-goals

- Creating a new goal or milestone database table.
- Inferring labels from message bodies or mentions.
- Adding label state such as active, blocked, review, or done.
- Replacing work items, conversations, or flights.
- Building a full UI surface in the first pass.

## V1 Shape

Records may carry:

```ts
labels?: string[]
```

The broker copies ask labels onto:

- the `InvocationRequest`
- the corresponding `FlightRecord`
- request metadata for forward compatibility
- any broker-created work item when the work item does not supply its own labels

The label feed normalizes broker-owned records into chronological events:

- broker messages carrying the label
- invocation creation
- flight start/state/terminal transitions available from current flight records
- collaboration/work events such as `created`, `progressed`, `waiting`,
  `review_requested`, and `done`
- work item snapshots when event history is unavailable

Each feed event carries stable ids, timestamps, category/kind, actor, target,
conversation/message/invocation/flight/work ids when known, state when known,
summary text, and labels.

The label brief is a compact digest over the same labelled work. V1 keeps it
deterministic and snapshot-derived:

- matching active and recent flights
- matching work items
- participants inferred from requester and target ids
- last activity derived from flight timestamps and work item updates
- counts by flight state

A later brief implementation can call an LLM over the normalized label feed to
produce a short natural-language summary. That is a presentation layer over the
feed, not a new lifecycle object.

## CLI

```text
scout ask --to <agent> --label <label> ...
scout ask --to <agent> --labels <a,b,c> ...
scout label feed <label> [--since <timestamp-or-duration>] [--limit <n>]
scout label watch <label> [--interval <seconds>] [--since <timestamp-or-duration>] [--limit <n>]
scout label brief <label>
```

`feed` is one-shot backlog. `watch` prints new normalized feed events as they
appear. `brief` remains the one-shot digest.

## MCP

Agents can read the same material without shelling out:

- `labels_feed` returns the normalized event backlog for a label.
- `labels_brief` returns the compact digest.

## Future Direction

Unified tail should enrich label feeds with derived proof-of-life events:

- last observed output
- last tool call start/finish
- file activity
- command/test activity
- quiet duration

Those facts should remain derived observations in the normalized feed, not
manual label state.

## Acceptance Criteria

- CLI asks can attach one or more labels.
- Broker-created invocations and flights persist those labels.
- `scout label feed <label>` returns a normalized event backlog.
- `scout label watch <label>` streams new normalized events.
- `scout label brief <label>` aggregates matching flights and work items.
- MCP exposes both `labels_feed` and `labels_brief`.
- Labels do not create a new lifecycle or state machine.
