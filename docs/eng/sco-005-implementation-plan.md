# SCO-005: Implementation Plan

Companion to
[sco-005-trace-first-session-observability-proposal.md](./sco-005-trace-first-session-observability-proposal.md).

## Status

Draft.

## Intent

This plan turns SCO-005 into a concrete implementation track:

- remove `tmux/logs` as the primary session model
- make trace the default session surface
- bring Claude Code and Codex to observer-grade coverage

This plan assumes SCO-003 and SCO-004 already exist as the substrate:

- SCO-003 owns session capability and shared trace
- SCO-004 owns addressability and broker projection of live sessions

## What This Plan Optimizes For

- one session model across product surfaces
- no host/API branches on `tmux` vs `logs` vs `trace`
- clear adapter completeness bar for Claude Code and Codex
- aggressive retirement of transport-shaped session UX

## Core Constraints

1. `@openscout/agent-sessions` remains the canonical session capability layer.
2. `@openscout/session-trace` and `@openscout/session-trace-react` remain the
   canonical trace-consumer layers.
3. No workstream adds durable session trace storage.
4. “Open session” should converge on “open trace,” not “attach terminal.”

## Workstream 1: Replace the Session Inspector Model

### Goal

Remove `tmux/logs` as first-class session modes in the desktop host/session
API.

### Deliverables

- replace transport-shaped session inspector types
- return trace-first session references
- separate debug affordances from session opening

### Acceptance Criteria

- the host API no longer describes session inspection as `tmux | logs | none`
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
- no `tmux` or log fallback is required for the primary open-session path

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
- no Claude session requires the legacy `tmux/logs` session route

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

## Workstream 5: Kill the Product Dependence on `tmux` and Logs

### Goal

Demote pane capture and raw logs to explicit engineering tools.

### Deliverables

- remove transport-first wording from UI and host API
- rename or relocate any remaining terminal/log features as debug affordances
- prevent “open session” from silently becoming terminal attach

### Acceptance Criteria

- terminal attach is not the default session opening behavior
- logs are not presented as the session surface
- any remaining debug actions are explicitly labeled as such

## Workstream 6: Cross-Surface Validation

### Goal

Make sure trace-first session semantics hold across desktop, web, mobile, and
broker-projected agents.

### Must-Have Tests

- opening a projected pairing-backed agent resolves to a trace session
- Claude Code trace contains structured blocks and interactive question updates
- Codex trace contains structured blocks rather than only final output
- interrupt works through the shared session contract
- product session APIs no longer branch on `tmux/logs`

## Suggested Order

1. Replace the desktop/web session inspector model.
2. Route pairing-backed session opening into shared trace UI.
3. Finish Claude Code trace-first product wiring.
4. Upgrade Codex to observer-grade structured trace.
5. Remove `tmux/logs` from the primary user journey.
6. Add cross-surface tests and tighten the invariants.

## What Should Be Considered “Done”

SCO-005 should be considered done only when:

- “open session” is trace-first everywhere users reach it
- Claude Code is observer-grade
- Codex is observer-grade
- `tmux/logs` are no longer product-level session concepts

If Codex remains final-text-only or if the desktop host API still exports
`tmux/logs` as first-class modes, SCO-005 is not done.
