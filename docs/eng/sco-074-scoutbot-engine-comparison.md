# SCO-074: Scoutbot Engine Comparison Harness

## Status

Proposed, with first contract slice in progress.

## Proposal ID

`sco-074`

## Intent

Define a narrow evaluation harness for comparing Scout-native Scoutbot reasoning
against an external agent runtime such as Mastra, without creating a second
product assistant or letting the external runtime own Scout state.

The useful question is not "should Scoutbot become a Mastra app?" The useful
question is:

```text
Can Scout host, compare, and supervise an external agent runtime while keeping
Scout's broker, records, routing, and writes authoritative?
```

This gives us a real architecture test and a practical way to pressure-test the
Scoutbot implementation.

## Context

Scoutbot is already defined as one operator-facing assistant identity:

- `@scoutbot` is the routeable handle.
- Scoutbot reads the current Scout state and explains it to the operator.
- Scoutbot may request durable coordination, but the broker remains the
  canonical writer for Scout-owned records.
- Internal substrates should not become product nouns.

SCO-050 and SCO-051 push Scoutbot toward a normal fleet agent with explicit
threads. This proposal adds a smaller seam below that identity: multiple
candidate engines can be evaluated behind the same product surface.

## Non-goals

- Do not introduce `@maskbot`, `@mastrabot`, or any second durable assistant
  identity.
- Do not let Mastra own Scout memory, scheduling, routing, work items, flights,
  or checkbacks.
- Do not add a new always-on scheduler in this proposal.
- Do not use an external runtime to mutate broker state directly.

## Boundary

Engines propose. Scout disposes.

Every engine receives the same Scout-owned situation input and returns the same
Scout-owned report shape. Proposed actions are inert data until Scout code turns
one into a broker write, UI action, briefing, or checkback.

```text
Scout collectors
  broker snapshot
  attention report
  git/worktree inventory
  recent completed or unlanded work
  current route/operator context
        |
        v
ScoutbotSituationInput
        |
        +--> native engine
        +--> mastra engine
        |
        v
ScoutbotSituationReport[]
        |
        v
Scout comparison artifact / briefing / dev endpoint
```

## Engine Contract

The first code slice defines a contract equivalent to:

```ts
interface ScoutbotEngine {
  id: "native" | "mastra" | string;
  describe(): EngineCapabilities;
  run(input: ScoutbotSituationInput): Promise<ScoutbotSituationReport>;
}
```

The input is intentionally Scout-native:

- current directory and route
- broker or attention snapshot metadata
- worktree/git signals
- recently completed but not landed signals
- explicit allowed actions
- constraints that say engines may not execute durable writes

The output is normalized:

- headline
- perspectives
- evidence references
- proposed actions
- missing data
- confidence

## Native Baseline

The native baseline is deterministic. It should wrap existing Scout evidence,
starting with the attention report and git/worktree probes, and produce an
operator-readable situation report without any model call.

It is deliberately boring. That gives the Mastra candidate a real bar to clear:
better structure, better workflow ergonomics, better observability, or better
future extensibility.

## Mastra Candidate

Mastra is a candidate external engine, not a product surface. The adapter should
be behind a dev flag and should implement the same `ScoutbotEngine` contract.

The adapter is allowed to use Mastra's agent, tool, memory, workflow, or
observability primitives internally, but it must not:

- write directly to the Scout broker
- persist authoritative Scout memory
- schedule durable work independently of Scout checkbacks
- expose Mastra vocabulary in operator-facing copy

## First Evaluation Prompts

Each engine should run against identical snapshots for:

- "What needs attention?"
- "How many worktrees are open and which are risky?"
- "What completed recently but has not landed?"
- "What should I look at next?"

## Comparison Criteria

Judge each run on:

- fidelity to Scout facts
- useful prioritization
- concrete evidence links
- actionability without overreaching
- honesty about missing data
- clean failure behavior
- adapter observability

## Ship Order

1. Add the `ScoutbotEngine` contract and deterministic native engine.
2. Add a dev-only comparison runner that can execute one or more engines against
   one `ScoutbotSituationInput`.
3. Add a collector that adapts the existing attention report and git/worktree
   data into the situation input.
4. Add a Mastra adapter behind a dev flag, with no production route by default.
5. Persist comparison runs as briefing or eval artifacts so outputs can be
   reviewed side by side.
6. Decide whether any Mastra primitives should graduate into Scout-native
   implementation work.

## Acceptance Criteria

- `@scoutbot` remains the only product assistant identity.
- The broker remains the canonical writer for Scout-owned coordination records.
- Native and external engines consume the same input and return the same output
  shape.
- Proposed actions are data only.
- A Mastra adapter can be added without editing Scoutbot UI or broker write
  paths.
