# SCO-005: Implementation Plan

Companion to
[sco-005-trace-first-session-observability-proposal.md](./sco-005-trace-first-session-observability-proposal.md).

## Status

Draft.

## Intent

This plan turns SCO-005 into a concrete implementation track:

- stop treating `tmux/logs` as the canonical session model
- make trace the default session surface
- bring Claude Code and Codex to observer-grade coverage

This plan assumes SCO-003 and SCO-004 already exist as the substrate:

- SCO-003 owns session capability and shared trace
- SCO-004 owns addressability and broker projection of live sessions

## What This Plan Optimizes For

- one session model across product surfaces
- no host/API branches that make `tmux` vs `logs` vs `trace` separate product
  ontologies
- clear adapter completeness bar for Claude Code and Codex
- transport-aware session UX backed by the same broker/session contract

## Core Constraints

1. `@openscout/agent-sessions` remains the canonical session capability layer.
2. `@openscout/session-trace` and `@openscout/session-trace-react` remain the
   canonical trace-consumer layers.
3. No workstream adds durable session trace storage.
4. “Open session” should converge on a broker-backed session view that can open
   trace, tmux, or logs as current surfaces for the same endpoint.

## Workstream 1: Replace the Session Inspector Model

### Goal

Stop modeling `tmux/logs` as separate session modes outside the desktop
host/session API's shared endpoint model.

### Deliverables

- replace transport-shaped session inspector types
- return trace-first session references
- separate debug affordances from session opening

### Acceptance Criteria

- the host API no longer describes session inspection as a mutually exclusive
  `tmux | logs | none` route
- pairing-backed agents can be opened by session reference
- the desktop/web app routes “open session” into the shared trace view

## Workstream 2: Pairing-Backed Sessions Open Into Trace

### Goal

Complete the SCO-004 loop so projected pairing agents open into trace instead
of falling back to host transport logic.

### Deliverables

- trace route for `pairing_bridge` endpoints
- session reference propagation from broker projection to UI
- trace-first handling in Fleet / Agents / session-opening flows

### Acceptance Criteria

- a pairing-backed agent can be opened from the UI into trace directly
- tmux and logs are available as current endpoint surfaces, not required
  fallback routes for the primary open-session path

## Workstream 3: Claude Code Observer Completion

### Goal

Treat the existing Claude Code adapter as the canonical Claude inspection path
and close any remaining fidelity gaps at the adapter/trace layer.

### Deliverables

- trace-first Claude session opening
- parity between current adapter semantics and product session UI
- explicit tests for question/action/reasoning rendering and interaction

### Acceptance Criteria

- Claude Code sessions open directly into shared trace
- tool use, tool result, reasoning, and AskUserQuestion remain visible through
  the shared trace path
- Claude sessions can expose tmux/log surfaces without those surfaces becoming
  the canonical session route

## Workstream 4: Codex Observer Upgrade

### Goal

Upgrade Codex from managed final-text bridge to observer-grade adapter.

### Deliverables

- structured Codex event capture instead of final-text-only bridging
- action block mapping for commands, edits, tools, and subagents when the
  runtime exposes them
- interactive question / approval support if the runtime supports them
- stable session reopening via session identity instead of log/runtime heuristics

### Acceptance Criteria

- Codex trace contains structured turns and blocks, not just one final text
  block
- Codex sessions open and resume as trace sessions
- Codex reaches the SCO-005 “perfect” bar

## Workstream 5: Fold `tmux` and Logs Into The Session Model

### Goal

Present pane capture and raw logs as current endpoint surfaces under the shared
session model.

### Deliverables

- remove transport-first wording from UI and host API
- rename or relocate any remaining terminal/log features that imply legacy
  fallback status
- prevent “open session” from silently becoming terminal attach

### Acceptance Criteria

- terminal attach is not the default session opening behavior
- logs are not presented as the session surface
- terminal/log actions are clearly labeled as current endpoint surfaces

## Workstream 6: Cross-Surface Validation

### Goal

Make sure trace-first session semantics hold across desktop, web, mobile, and
broker-projected agents.

### Must-Have Tests

- opening a projected pairing-backed agent resolves to a trace session
- Claude Code trace contains structured blocks and interactive question updates
- Codex trace contains structured blocks rather than only final output
- interrupt works through the shared session contract
- product session APIs no longer treat `tmux/logs` as a separate ontology

## Suggested Order

1. Replace the desktop/web session inspector model.
2. Route pairing-backed session opening into shared trace UI.
3. Finish Claude Code trace-first product wiring.
4. Upgrade Codex to observer-grade structured trace.
5. Present `tmux/logs` as current endpoint surfaces inside the primary session
   journey, not as a separate route.
6. Add cross-surface tests and tighten the invariants.

## What Should Be Considered “Done”

SCO-005 should be considered done only when:

- “open session” is trace-first everywhere users reach it
- Claude Code is observer-grade
- Codex is observer-grade
- `tmux/logs` are current endpoint surfaces under the same product-level session
  concept

If Codex remains final-text-only or if the desktop host API still exports
`tmux/logs` as a separate model, SCO-005 is not done.
