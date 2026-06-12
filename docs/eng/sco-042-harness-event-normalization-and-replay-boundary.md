# SCO-042: Harness Event Normalization And Replay Boundary

## Status

Proposed.

## Proposal ID

`sco-042`

## Intent

Define how OpenScout should normalize observed harness activity while preserving
the boundary between Scout-owned coordination records and harness-owned
transcripts.

The goal is a shared event vocabulary for UI, status, metrics, and debugging
without importing every harness turn as a first-party Scout message.

## Context

OpenScout integrates with multiple harnesses. Each harness exposes different
event shapes, transcript files, tool events, session ids, plans, approvals, and
terminal results. Surfaces need a common way to render activity, but the broker
must not pretend to own all external transcript material.

The existing data boundary remains:

- Scout owns messages, invocations, flights, deliveries, bindings, work items,
  questions, and broker-created records.
- Harnesses own their transcripts, logs, native thread ids, and raw event
  streams.
- Scout may observe, tail, summarize, link, and index lightweight metadata from
  harness material.

## Decision

OpenScout SHOULD define a canonical observed event model for harness activity.

Canonical observed events are read-model material. They are suitable for live UI,
search snippets, status projections, and debugging. They are not automatically
Scout-owned conversation messages.

## Principles

1. Normalize for rendering and diagnosis, not ownership.
2. Preserve raw source references when available.
3. Keep canonical events small and bounded.
4. Use one shared schema across runtime, web, desktop, mobile, and tests.
5. Validate harness adapters with common fixtures.
6. Never require full transcript import to compute status.
7. Treat missing or unknown event fields as adapter limitations, not protocol
   failures.

## Canonical Observed Event Types

```ts
export type ScoutObservedHarnessEvent =
  | ScoutObservedAssistantEvent
  | ScoutObservedReasoningEvent
  | ScoutObservedToolEvent
  | ScoutObservedCommandEvent
  | ScoutObservedFileChangeEvent
  | ScoutObservedPlanEvent
  | ScoutObservedApprovalEvent
  | ScoutObservedSubagentEvent
  | ScoutObservedUsageEvent
  | ScoutObservedTerminalEvent
  | ScoutObservedErrorEvent;
```

Required common fields:

```ts
export interface ScoutObservedEventBase {
  id: string;
  source: {
    harness: AgentHarness;
    sessionId?: string;
    transcriptPath?: string;
    cursor?: string;
    rawEventId?: string;
  };
  observedAt: number;
  ownership: "harness_observed";
  traceId?: string;
  invocationId?: ScoutId;
  flightId?: ScoutId;
}
```

Event-specific payloads SHOULD be compact. Large command output, screenshots,
files, and full tool responses should be referenced by source cursor or artifact
id rather than embedded.

## Replay Boundary

Scout SHOULD support two replay modes:

1. **Coordination replay**
   Replays broker-owned facts from the broker journal and SQLite projections.
   This reconstructs messages, invocations, flights, deliveries, work items, and
   questions.
2. **Observed activity replay**
   Re-reads bounded harness source material from adapters using cursors,
   transcript paths, or session ids. This reconstructs the visible harness
   activity view when the source is still available.

Coordination replay MUST NOT depend on observed activity replay.

## Fixture Contract

Every harness adapter SHOULD have shared fixtures:

```plaintext
fixtures/harness-events/
|-- codex/
|   |-- command-output.raw.jsonl
|   `-- command-output.expected.json
|-- claude/
|   |-- tool-use.raw.jsonl
|   `-- tool-use.expected.json
`-- echo/
    |-- basic.raw.jsonl
    `-- basic.expected.json
```

The same expected fixtures SHOULD be consumed by runtime tests and UI rendering
tests. If TypeScript, Swift, or another language needs a mapper, it should be
checked against the same fixture contract.

## Adapter Requirements

A harness adapter SHOULD report:

- supported raw event sources
- supported canonical event types
- whether cursors are stable across process restarts
- whether usage metrics are authoritative, estimated, or unavailable
- whether terminal result detection is authoritative
- whether approvals and permission prompts are observable
- maximum retained backlog

This report SHOULD feed the harness capability model and UI diagnostics.

## Status Projection

The broker MAY derive lightweight status from observed events:

- idle
- working
- waiting for approval
- running command
- editing files
- using tool
- blocked
- completed
- failed

The status projection should cite the observed event cursor or broker record
that caused the transition.

## Non-Goals

- making Scout the canonical transcript store for every harness
- requiring each harness to emit the same native event format
- persisting unbounded command output in broker records
- replacing harness-native replay tools
- guaranteeing old observed activity can be replayed after the harness deletes
  its source files

## Implementation Sequence

1. Add protocol types for canonical observed harness events.
2. Define fixture layout and expected JSON format.
3. Move current adapter normalization tests onto the fixture contract.
4. Add adapter capability reports for event coverage and replay support.
5. Update runtime/web/mobile consumers to render canonical observed events.
6. Add diagnostics that distinguish broker-owned facts from observed harness
   material.

## Acceptance Criteria

- Every observed harness event carries `ownership: "harness_observed"`.
- Broker-owned coordination replay works without harness transcript access.
- Adapter normalization is tested against shared fixtures.
- UI surfaces can render common activity without harness-specific branching for
  basic assistant, tool, command, plan, approval, usage, terminal, and error
  events.
- Large raw output is referenced or bounded, not copied into broker records.
