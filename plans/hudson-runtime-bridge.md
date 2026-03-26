---
id: PLN-8914
agent: Hudson
twin: hudson-twin
status: in-progress
updated: 2026-03-25T18:40:00-04:00
summary: Define how ScoutApp, ScoutAgent, and the TypeScript runtime exchange plan snapshots without hard-coding orchestration into Swift.
tags: native, runtime, bridge
---
# Local Runtime Bridge for Plans

## Goal
Turn plan markdown into a durable artifact the shell and helper can both understand.

## Proposed Shape
- `ScoutAgent` watches for plan updates and emits a lightweight index.
- The shell reads the index for inventory metadata and lazy-loads markdown on selection.
- TypeScript packages own plan generation and mutation rules.

## Milestones
- [x] Confirm the shell owns chrome while helpers own continuity.
- [x] Keep the first transport file-based.
- [x] Define a minimum metadata contract for plan cards.
- [x] Leave markdown bodies as the source of truth.
- [ ] Replace seeded examples with generated plan snapshots.

## Risks
The shell should not become the planner. It should surface plan state and hand off action flows cleanly.
