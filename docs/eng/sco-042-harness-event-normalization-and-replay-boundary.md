# SCO-042: Harness Event Normalization And Replay Boundary

## Status

Implemented baseline on 2026-08-07, pending commit and review. Codex and Claude
Code are required and have passing recorded replay evidence. Echo supplies
synthetic contract probes. ACP, Cursor ACP, Grok ACP, and Kimi ACP are migrated
to the v2 declaration as explicitly grandfathered adapters; the conformance
runner reports their missing recorded evidence as warnings rather than treating
them as verified.

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

### External implementation evidence

The Autonomous Harness engine integration guide records a useful failure mode:
handwritten fixtures passed while a real recorded subagent session left the UI
in `Processing` forever. Its integration contract requires a recorded source
session, normalized expected events, and an end-to-end lifecycle check for each
engine.

SCO-042 adopts that evidence standard without adopting Autonomous Harness's
engine architecture. OpenScout keeps its adapter factory, explicit session
model, broker ownership boundary, and harness-owned transcript boundary.

Sources reviewed at Autonomous Harness commit
[`49ef7d6`](https://github.com/autonomous-ai/autonomous-harness/commit/49ef7d684d6ebcd67932ba69d988a0fc39678813):

- [engine integration guide](https://github.com/autonomous-ai/autonomous-harness/blob/49ef7d684d6ebcd67932ba69d988a0fc39678813/cli/src/engines/README.md)
- [contribution and conformance rules](https://github.com/autonomous-ai/autonomous-harness/blob/49ef7d684d6ebcd67932ba69d988a0fc39678813/CONTRIBUTING.md)

Kimi reviewed the implementation-ready draft through Scout flight
`flt-msjfqi38-r9k7wt` on 2026-08-07. The review confirmed the ownership and
conformance model and identified contract gaps in scope discovery, reducer
selection, deterministic replay, and adapter side effects. This revision
incorporates those findings.

## Decision

OpenScout SHOULD define a canonical observed event model for harness activity.

Canonical observed events are read-model material. They are suitable for live UI,
search snippets, status projections, and debugging. They are not automatically
Scout-owned conversation messages.

OpenScout MUST validate adapter normalization with replayable recordings from
real harness sessions. Synthetic fixtures may test isolated parser errors, but
they do not prove adapter conformance.

The conformance boundary is the adapter's normalized event stream and the
shared display-state reducer. The runner does not import the source transcript
into broker storage and does not require the source harness to be installed.

## Normalization boundary

Harness-specific parsing MUST be callable without starting the harness process.
The live adapter and the replay runner MUST use the same normalizer
implementation. A test-only parser would test a second implementation and would
not prove live adapter behavior.

The first implementation should expose internal contracts with this shape:

```ts
export type AdapterReplayRecord =
  | { source: "harness"; sequence: number; payload: unknown }
  | {
      source: "adapter_control";
      sequence: number;
      event:
        | "prompt_accepted"
        | "question_answered"
        | "topology_observed"
        | "interrupt"
        | "transport_closed"
        | "transport_error";
      turnId?: string;
      payload?: unknown;
    };

export interface HarnessEventNormalizerContext {
  sessionId: string;
  now(): string;
  nextId(kind: "turn" | "block" | "event"): string;
}

export interface HarnessEventNormalizer {
  ingest(record: AdapterReplayRecord): readonly AgentSessionStreamEvent[];
  finishReplay(): readonly AgentSessionStreamEvent[];
  readonly turnOpen: boolean;
}
```

`adapter_control` records describe adapter lifecycle edges that affect the
normalized stream but do not come from the harness transcript. For example,
Claude Code currently opens a turn when the adapter accepts a prompt. The
fixture must represent that edge instead of pretending that the harness emitted
it. A scenario's `sequence` values MUST start at 0 and increase by 1. The runner
fails on a duplicate or missing sequence value.

The live adapter remains responsible for process launch, transport, writes,
interrupt delivery, and shutdown. It passes decoded harness records and adapter
control records to the normalizer, then emits the returned session events.

The normalizer MUST be pure after construction. It MUST NOT read the filesystem,
environment, clock, process state, network, stdin, or stdout. The live adapter
shell performs those operations. The shell passes resulting semantic edges to
the normalizer as `adapter_control` records. For example, the Claude Code shell
writes an answer to stdin and separately passes `question_answered` to the
normalizer. It reads topology files and passes a bounded topology snapshot as
`topology_observed`.

The replay runner passes the checked-in records to the same normalizer in
sequence order. `finishReplay()` may flush buffered framing or incomplete
source records. It MUST NOT manufacture a successful `turn:end` because the
capture reached end of file.

The runner constructs the normalizer with `HarnessEventNormalizerContext`.
`scenario.json` supplies ordered `clockValues` and ordered `idValues`. Each call
to `now()` or `nextId()` consumes one value. The runner fails if the normalizer
exhausts a list or leaves declared values unused. Wildcard matchers, ignored
fields, regular-expression replacements, and wall-clock tolerances are not
permitted in expected output.

## Principles

1. Normalize for rendering and diagnosis, not ownership.
2. Preserve raw source references when available.
3. Keep canonical events small and bounded.
4. Use one shared schema across runtime, web, desktop, mobile, and tests.
5. Validate harness adapters with common fixtures.
6. Never require full transcript import to compute status.
7. Treat missing or unknown event fields as adapter limitations, not protocol
   failures.

## Proposed canonical observed event types

This section is a phase-two design sketch. The initial conformance runner
targets the shipped `AgentSessionStreamEvent` contract, `StateTracker`, and
`projectSessionDisplayState()`. The canonical observed event union does not
become normative until recorded fixtures also contain
`expected.observed-events.json`.

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
  observedAt: number; // Unix epoch milliseconds
  ownership: "harness_observed";
  traceId?: string;
  invocationId?: ScoutId;
  flightId?: ScoutId;
}
```

Event-specific payloads SHOULD be compact. Large command output, screenshots,
files, and full tool responses should be referenced by source cursor or artifact
id rather than embedded.

## Native Interaction Mapping

Harness-native interaction tools should map into Scout records and projections
instead of becoming separate product contracts. Obvious names should stay
obvious, but Scout owns the meaning at the broker boundary.

| Native interaction | Scout mapping |
| --- | --- |
| user question, such as `ask_user` | `question` plus `session_projection` |
| plan review, such as `submit_plan` | `work_item` plus `session_projection` |
| task tools, such as `task_write` / `task_update` / `task_complete` / `task_check` | work item task projection plus session projection |
| native child agent or `subagent` event | `invocation`, `flight`, and `session_projection` when Scout owns the child, or observed child activity otherwise |
| tool approval event | `session_projection`; durable unblock creation is a separate broker operation |
| follow-up queue | `message` plus `session_projection` in the current conversation/session context |
| steer/redirect | `flight`, `message`, and `session_projection` with an explicit reason |

Adapters may use different native names. The normalized mapping lives in
`packages/protocol/src/native-interactions.ts`; native names are source aliases,
not Scout's durable record model.

## Display-state projection

Every UI surface needs the same answer to "what is happening now?" and "what
needs the operator?" Raw harness events are too detailed and too
harness-specific for each surface to fold independently.

OpenScout already ships two related display-state paths. SCO-042 MUST use the
production session path for conformance:

```ts
AgentSessionStreamEvent[]
  -> StateTracker
  -> SessionState
  -> projectSessionDisplayState()
  -> ScoutSessionDisplayState
  -> web / desktop / iOS / CLI
```

The display state is a projection, not canonical storage. It may include
observed harness details such as active tools, current streamed message,
pending approvals, pending questions, subagent activity, task snapshots, and
usage. It must cite or link to source records where durable ownership matters.

`packages/protocol/src/session-display-state.ts` also exports
`reduceScoutSessionDisplayState()` for consumers that already produce
`ScoutSessionDisplayEvent`. The initial fixture runner MUST NOT invent a second
stream-event-to-display-event mapper only for tests. It feeds normalized events
through `StateTracker`, then calls the shipped
`packages/runtime/src/session-display-projection.ts` projection.

The display state remains a disposable projection. Scout-owned coordination
records remain canonical, and external harness transcript turns remain observed
material.

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

`packages/runtime/src/tail/` already provides bounded transcript discovery,
cursors, source decoders, and replay buffers for observed activity. The fixture
work should reuse recorded source shapes and decoder utilities where the source
contract matches. It must not turn tail events or external transcripts into
broker-owned coordination records.

## Fixture Contract

Every adapter whose v2 spec declares `conformance.status: "required"` MUST have
shared fixtures under
`packages/agent-sessions/fixtures/harness-events/`:

```plaintext
packages/agent-sessions/fixtures/harness-events/
|-- scenario.schema.json
|-- codex/
|   `-- command-output-completed/
|       |-- scenario.json
|       |-- capture.raw.jsonl
|       |-- expected.session-events.json
|       `-- expected.display-state.json
|-- claude-code/
|   |-- text-completed/
|   |   |-- scenario.json
|   |   |-- capture.raw.jsonl
|   |   |-- expected.session-events.json
|   |   `-- expected.display-state.json
|   |-- tool-completed/
|   |   |-- scenario.json
|   |   |-- capture.raw.jsonl
|   |   |-- expected.session-events.json
|   |   `-- expected.display-state.json
|   `-- question-open/
|       |-- scenario.json
|       |-- capture.raw.jsonl
|       |-- expected.session-events.json
|       `-- expected.display-state.json
`-- echo/
    `-- basic-completed/
        |-- scenario.json
        |-- capture.raw.jsonl
        |-- expected.session-events.json
        `-- expected.display-state.json
```

`scenario.schema.json` MUST validate this normative shape:

```json
{
  "schemaVersion": "1.0.0",
  "id": "codex-command-output-completed",
  "adapterId": "codex",
  "fixtureSet": "codex",
  "source": {
    "kind": "recorded",
    "harnessVersion": "observed version or revision",
    "transport": "jsonrpc-stdio-jsonl",
    "capturedAt": "2026-08-07T00:00:00.000Z"
  },
  "redactions": [
    { "line": 4, "pointer": "/payload/cwd", "replacement": "<workspace>" }
  ],
  "expected": {
    "endState": "completed",
    "evidenceKeys": ["event:block:action:output"]
  },
  "determinism": {
    "clockValues": ["2026-08-07T00:00:00.000Z"],
    "idValues": ["fixture-block-001"]
  }
}
```

`source.kind` is `recorded` or `synthetic`. `expected.endState` is the projected
state after the complete capture has replayed, including every turn in a
multi-turn capture. It is `completed`, `failed`, `stopped`, or `open`. An
evidence key uses one of these closed forms:

- `event:<AgentSessionStreamEvent event name>`
- `capability:<RFC 6901 pointer>` for a scalar capability
- `capability:<RFC 6901 pointer>#<array member>` for a declared list member

For example, `event:block:delta`,
`capability:/capabilities/streaming/text`, and
`capability:/capabilities/outputBlocks#text` are valid. The scenario schema MUST
reject free-form evidence keys.

Each line in `capture.raw.jsonl` MUST be one `AdapterReplayRecord`. Harness
payloads preserve source event order and source event shapes.
The checked-in capture MUST remove credentials, user content that is not
required by the test, absolute home paths, and machine identifiers. A redaction
must not remove an event discriminator, correlation id, lifecycle edge, or
payload shape that the adapter consumes.

Redaction uses exact replacement at one JSON line and one RFC 6901 pointer. The
closed redaction vocabulary contains no delete, wildcard, regular-expression,
or code-execution operation. The manifest records the replacement that was
already applied to the checked-in capture; the runner does not need the private
original.

`expected.session-events.json` MUST contain the bounded
`AgentSessionStreamEvent` output from the current adapter protocol.
`expected.display-state.json` MUST contain the final shared display projection.
When the canonical observed event types ship, a scenario MAY add
`expected.observed-events.json` for that derived layer without replacing the
session-event expectation.

Expected output MUST contain exact ids and timestamps. Injected `clockValues`
and `idValues` control values created by the normalizer. Redacted source values
are already stable in the checked-in capture. Correlation between turns,
blocks, tools, questions, and terminal events must remain intact.

The expected fixtures use language-neutral JSON. A shipped runtime or UI mapper
must use the same fixture contract instead of maintaining a private copy.

Synthetic fixtures MUST use `source.kind: "synthetic"`. A synthetic fixture may
cover malformed input or an upstream event that cannot be recorded safely. It
cannot satisfy the recorded-session requirement for an adapter capability.

Echo is a synthetic self-test for the runner. Echo has no `adapter.spec.json`
and is not presented as a conformant production adapter.

### Adapter-spec scope and shared normalizers

Adapter spec v2 MUST add this object:

```json
{
  "conformance": {
    "status": "required",
    "normalizerId": "acp",
    "fixtureSets": ["acp"]
  }
}
```

`status` is `required` or `grandfathered`. The runner discovers adapter specs
and reads this object instead of maintaining a second adapter list. A new
adapter spec MUST use `required`. `grandfathered` exists only to migrate the six
current v1 specs without making the first runner invocation fail before fixture
evidence exists. A grandfathered adapter produces `WARN` and remains
unverified.

`normalizerId` identifies the implementation under test. `fixtureSets`
identifies the evidence owned by that normalizer. ACP-derived adapters may cite
the shared `acp` fixture set when they pass the same records through the same
normalizer. A wrapper that transforms source records or normalized output MUST
add its own fixture set. Reusing an adapter id does not prove shared-normalizer
coverage.

## Conformance requirements

Requirement ids are stable. Tests and review findings should cite these ids.

| ID | Requirement |
| --- | --- |
| `SCO-042-C001` | Replaying the same capture twice produces byte-identical session events and final display state. |
| `SCO-042-C002` | For every opened turn whose scenario declares a terminal state, the output contains one `turn:start` and one matching `turn:end`. Multi-turn captures check each turn independently. |
| `SCO-042-C003` | An open scenario declares why the turn remains open and does not emit a false terminal event. |
| `SCO-042-C004` | Each block starts within an open turn. Each completed block ends once. Block ids remain unique within their turn. |
| `SCO-042-C005` | Action and tool updates use one normalized block id from start through output, status, approval, and end events. An available source correlation id remains in the action or block metadata. |
| `SCO-042-C006` | If the source omits an explicit start record, the adapter opens the turn or block at the first source record that proves it exists. |
| `SCO-042-C007` | An unknown source record does not terminate replay. The adapter ignores it or emits a bounded diagnostic according to its adapter spec. |
| `SCO-042-C008` | The adapter does not invent usage, progress, status, capability, or terminal data that the source does not provide. |
| `SCO-042-C009` | Each serialized session event is at most 64 KiB of UTF-8. `StateTracker` retains at most 64 KiB of UTF-8 action output per block. Excess data uses explicit truncation metadata plus a source or artifact reference. A diagnostic message is at most 4 KiB of UTF-8. |
| `SCO-042-C010` | A terminal event moves the shared display state out of an active state. An open scenario remains active only for its declared reason. |
| `SCO-042-C011` | Live execution and fixture replay pass records through the same pure normalizer implementation. A structural test rejects filesystem, process, transport, and environment imports from the normalizer module. |
| `SCO-042-C012` | Every emitted event name exists in the `AgentSessionStreamEvent` union and in the adapter spec's `normalizedSurface.emitsPairingEvents`. Every declared event has recorded fixture evidence or an explicit unverified result. |

## Conformance runner

`@openscout/agent-sessions` MUST expose this command:

```bash
bun run --cwd packages/agent-sessions adapter:conformance
```

The command MUST support one-adapter execution and machine-readable output:

```bash
bun run --cwd packages/agent-sessions adapter:conformance -- --adapter codex
bun run --cwd packages/agent-sessions adapter:conformance -- --format json
```

The runner reports one of four results for each requirement:

- `PASS`: automated evidence satisfies the requirement.
- `FAIL`: automated evidence contradicts the requirement or replay crashes.
- `SKIP`: the adapter spec declares that the scenario capability is not
  supported. The result includes the spec path and reason.
- `WARN`: the check needs live or manual evidence. A warning does not satisfy a
  required recorded-session check.

The process exits with a nonzero status if a requirement fails, if a `required`
adapter has no passing recorded fixture, or if replay emits an event omitted
from `adapter.spec.json`. A declared event or authoritative signal without
recorded evidence reports an explicit `WARN` and remains unverified. A
`grandfathered` adapter also reports a warning until recorded evidence lands.
The JSON report MUST include the adapter id, normalizer id, fixture set,
scenario id, requirement id, result, reason, evidence keys, and failure
evidence.

The runner MUST NOT contact a live harness, broker, or network service. A
separate smoke test may verify a currently installed harness. Passing replay
conformance does not prove that the installed harness can launch.

## Change policy

A change to adapter normalization MUST add or update a recorded fixture when
the source shape or normalized output changes. A new adapter spec MUST declare
`conformance.status: "required"` and include at least one recorded
completed-turn fixture before the adapter can be listed as conformant.

The pull request for a new adapter MUST also record one live launch and terminal
lifecycle check. The live check supplies the source capture but remains separate
from the offline conformance command. CI does not need credentials or an
installed harness to replay the checked-in capture.

When an upstream harness version changes an observed source shape, the adapter
spec and the affected scenario metadata MUST record the new evidence. Reviewers
must reject expected-output changes that have no corresponding source evidence.

## Adapter-spec requirements

`adapter.spec.json` remains the only adapter capability contract. SCO-042 does
not define a parallel capability report. Adapter spec v2 adds `conformance` and
evidence status to the existing session, capability, native protocol, normalized
surface, and limitation fields.

The v2 schema MUST add fields for source cursor stability, terminal-signal
authority, usage authority, and maximum retained backlog when the current v1
keys cannot express them. Scenario `expected.evidenceKeys` MUST use the same
field vocabulary. Each claimed emitted event and each authoritative terminal or
usage signal MUST cite at least one recorded scenario. Missing evidence leaves
the claim `unverified`; the product must not present it as confirmed.

The runner MUST validate spec drift in both directions:

- Every `normalizedSurface.emitsPairingEvents` value is a valid
  `AgentSessionStreamEvent["event"]` discriminator.
- Every event emitted during replay appears in
  `normalizedSurface.emitsPairingEvents`.
- Every declared event has recorded evidence or an explicit unverified result.

The adapter-spec README and generated adapter inventory MUST list every current
spec as part of the v2 migration.

## Status projection

OpenScout already defines `ObservedActivity` in
`packages/protocol/src/observed-status.ts`. Harness activity MUST use that
vocabulary instead of defining another status enum. For example, reasoning maps
to `thinking`, command and tool execution map to `executing`, questions and
approvals map to `waiting_for_input`, and terminal results map to `completed`,
`failed`, or `cancelled`.

The status projection MUST cite the observed event cursor or broker record that
caused the transition. A new activity value requires a change to
`ObservedActivity`; an adapter must not create a private synonym.

## Non-Goals

- making Scout the canonical transcript store for every harness
- requiring each harness to emit the same native event format
- persisting unbounded command output in broker records
- replacing harness-native replay tools
- guaranteeing old observed activity can be replayed after the harness deletes
  its source files
- replacing the adapter factory with shared `session.engine` branches
- defining caller-minted turn ids, early cancellation receipts, or remote
  provider transport semantics
- defining pairing cryptography or relay encryption
- proving that a live installed harness can launch from replay fixtures alone
- requiring a Swift fixture consumer before a shipped Swift surface consumes
  normalized harness events

## Implementation Sequence

1. Add adapter spec v2 with the `conformance` object and evidence fields. Update
   the adapter-spec README and inventory in the same change.
2. Add `AdapterReplayRecord`, `HarnessEventNormalizerContext`, and
   `HarnessEventNormalizer`.
3. Extract Codex and Claude Code normalization from their process and transport
   shells without changing normalized production behavior.
4. Add the scenario schema, closed redaction vocabulary, injected id and clock
   values, and `SCO-042-C001` through `SCO-042-C012`.
5. Implement `adapter:conformance` and prove the runner first with the synthetic
   Echo fixture.
6. Record and redact one completed-turn fixture for Codex and Claude Code. Mark
   those v2 specs `required`.
7. Add failure, open-question, unknown-event, and large-output scenarios where
   the source harness can produce them.
8. Add the shared ACP fixture set. Point ACP-derived adapters at that fixture
   set only when they use the same normalizer without wrapper transformations.
9. Cross-check spec event declarations and capability claims against fixture
   evidence. Keep unmigrated v1 adapters grandfathered and visibly unverified.
10. Move current adapter normalization tests onto the fixture contract.
11. Feed replayed session events through `StateTracker` and
    `projectSessionDisplayState()`. Compare the result with
    `expected.display-state.json`.
12. In phase two, add the canonical observed event types and corresponding
    fixture expectations. Update consumers only after that layer is normative.
13. Add diagnostics that distinguish broker-owned facts from observed harness
    material.

## Acceptance Criteria

| Setup | Action | Required result |
| --- | --- | --- |
| Codex and Claude Code use v2 specs with `conformance.status: "required"`. | Run `bun run --cwd packages/agent-sessions adapter:conformance`. | The runner reports no `FAIL`, finds recorded evidence for both adapters, and exits with status 0. |
| A fixture and its deterministic context are unchanged. | Replay the fixture twice. | The two session-event outputs and final display states are byte-identical. |
| A fixture contains one or more terminal source turns. | Replay the fixture through its adapter normalizer, `StateTracker`, and `projectSessionDisplayState()`. | Every opened terminal turn has one matching `turn:end`, and the final display state is not active. |
| A fixture ends at a native question or approval wait. | Replay the fixture. | The scenario remains open for the declared reason and emits no false `turn:end`. |
| A fixture contains an unknown source record. | Replay the fixture. | Replay continues, later valid records appear, and any diagnostic is bounded. |
| A fixture contains more than 64 KiB of command or tool output. | Replay the fixture and inspect session state. | Each event is at most 64 KiB, retained action output is at most 64 KiB, truncation metadata gives the omitted byte count, and a source or artifact reference remains. |
| The normalizer modules exist. | Run the structural conformance check. | The modules contain no filesystem, process, network, environment, stdin, or stdout imports and are used by both live and replay construction paths. |
| Harness transcript files are unavailable. | Replay broker-owned coordination records. | Messages, invocations, flights, deliveries, work items, and questions reconstruct without harness transcript access. |
| A required adapter claims an event or authoritative signal in `adapter.spec.json`. | Run conformance in JSON mode. | The report cites at least one passing recorded scenario for that claim or marks it with an explicit unverified warning. A required adapter with no passing recorded fixture fails. |
| An adapter emits an event omitted from `normalizedSurface.emitsPairingEvents`. | Run conformance. | `SCO-042-C012` fails and identifies the adapter, scenario, and missing event declaration. |

Broker-owned coordination replay remains independent from harness transcript
access. When phase-two canonical observed events ship, each one must carry
`ownership: "harness_observed"`. The implementation must preserve both
boundaries throughout the sequence above.
