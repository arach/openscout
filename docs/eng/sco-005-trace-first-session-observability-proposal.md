# SCO-005: Trace-First Session Observability

## Status

Proposed.

## Proposal ID

`sco-005`

## Intent

Make live session trace the only first-class session inspection model in
OpenScout, and retire `tmux` capture and raw log tailing as product-level
session surfaces.

SCO-005 builds on SCO-003 and SCO-004:

- SCO-003 established `@openscout/agent-sessions` as the shared live session
  substrate and `@openscout/session-trace` as the shared trace layer
- SCO-004 established that live sessions can be projected into the broker as
  addressable agents

SCO-005 answers the next question:

How do we make every inspectable session look like a proper trace, across
desktop, web, mobile, and Scout routing, without falling back to transport-
specific terminal or log views?

The target outcome is:

- OpenScout session inspection is trace-only as a product concept
- `tmux` and raw logs stop being user-facing session modes
- Claude Code and Codex both have observer-grade coverage
- any inspectable live session can be opened through the shared trace surface
- interactive questions, approvals, and interrupts work through the same
  trace-first model

## Problem

OpenScout still leaks transport details into the session model.

The biggest example is the desktop host session inspector in
`apps/desktop/src/app/host/agent-session.ts`, which currently exposes session
inspection as:

- `tmux`
- `logs`
- `none`

That is the wrong abstraction.

The correct abstraction is:

- session
- turns
- blocks
- action output
- approvals
- questions
- interrupts

Today that mismatch causes two concrete failures:

1. Pairing-backed sessions are routable and observable at the broker/runtime
   level, but the desktop session surface still thinks it needs a terminal pane
   or a log file.
2. Adapter coverage is uneven:
   - Claude Code is close to a real observer adapter because it maps assistant
     content, tool use, tool results, and interactive questions into trace
     blocks.
   - Codex currently behaves more like a managed text bridge: it starts or
     resumes a thread, sends a prompt, and maps the final response back into a
     single text block, but it does not yet expose the full structured trace
     surface Scout wants to depend on.

As long as the product surface remains `tmux/logs`, the system keeps the wrong
mental model:

- a session looks like a terminal transport instead of a trace capability
- trace is optional instead of canonical
- adapter completeness is hard to reason about
- “open session” means “attach to a process” rather than “inspect and steer a
  live trace”

## Decision

OpenScout SHOULD become trace-first and, at the product level, trace-only.

The user-facing session model MUST be:

- trace snapshot
- live replay / subscription
- interactive questions
- interactive approvals
- interrupt / steer

The user-facing session model MUST NOT be:

- `tmux` pane capture
- raw log tail
- transport-specific attach behavior

`tmux` capture and raw logs MAY remain as engineering debug fallbacks, but they
MUST NOT define the primary session API, the primary session route, or the
primary session UI.

Claude Code and Codex are tier-1 observer targets for SCO-005. Both MUST reach
observer-grade coverage before OpenScout considers the trace-first migration
complete.

## Normative Language

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as normative requirements.

## Design Principles

1. Trace is the session product.
2. Transport is an implementation detail.
3. An inspectable session MUST expose turns and blocks, not just final text.
4. `tmux` and raw logs are debug artifacts, not product semantics.
5. Claude Code and Codex MUST be modeled by the same trace contract even if
   their native runtimes differ.
6. Session observability MUST work for Scout-created sessions and externally
   started sessions that can be attached or resumed.
7. Trace inspection MUST remain separate from durable broker history.

## Goals

- make trace the only first-class session inspection surface
- remove `tmux` and `logs` from the desktop host session model
- ensure pairing-backed sessions open into the shared trace surface
- define observer-grade acceptance criteria for Claude Code and Codex
- upgrade Codex from managed text bridge to full trace adapter
- preserve interactive question, approval, interrupt, and replay semantics
- keep one shared trace interpretation layer across web, desktop, and mobile

## Non-Goals

- introducing durable session trace storage
- preserving terminal attach as the primary “open session” behavior
- making every legacy runtime inspectable on day one
- inventing a second trace protocol
- coupling trace inspection to broker message history

## Terminology

| Term | Meaning |
|---|---|
| **Trace-first** | The product opens sessions as live turn/block traces rather than process panes or logs |
| **Observer adapter** | An adapter that maps native runtime events into the full OpenScout session trace contract |
| **Observer-grade coverage** | A harness implementation that meets the “perfect” acceptance criteria below |
| **Managed session** | A session OpenScout creates or resumes through its own runtime integration |
| **Attachable session** | A pre-existing live session OpenScout can discover and observe without reducing it to terminal/log scraping |

## What “Perfect” Means

For SCO-005, “perfect” does not mean “good enough to send a prompt and get a
final answer.”

It means the harness is observer-grade.

An observer-grade session integration MUST provide:

1. **Stable session identity**
   The session has a stable `sessionId` and can be reopened by the trace UI.
2. **Turn fidelity**
   Each user-visible turn is represented as a turn in the session substrate.
3. **Block fidelity**
   User-visible content is mapped into trace blocks instead of collapsing to a
   final text string.
4. **Action fidelity**
   Commands, file edits, tool calls, and subagent actions are surfaced as
   action blocks with output and status.
5. **Interactive fidelity**
   Questions and approvals round-trip through the session substrate when the
   underlying runtime supports them.
6. **Interrupt fidelity**
   Stop / interrupt is routed through the same session capability.
7. **Replay fidelity**
   Reconnect and resume produce coherent snapshots and replay.
8. **No pane scraping requirement**
   The primary inspection path does not depend on `tmux` capture or raw logs.

### Claude Code: “Perfect”

Claude Code is close already because the existing adapter maps:

- assistant text and reasoning
- tool use and tool result
- AskUserQuestion
- interrupt

Claude Code reaches “perfect” for SCO-005 when:

- its current trace mapping becomes the primary product surface
- the desktop/web session inspector opens Claude sessions directly into trace
- any remaining missing interactive semantics are represented in the shared
  trace layer instead of hidden in host-specific logic

### Codex: “Perfect”

Codex is not there yet.

Today the Codex path is a managed app-server integration that:

- starts or resumes a thread
- sends a prompt
- collects final assistant text
- maps the final result into one text block

That is useful, but it is not observer-grade.

Codex reaches “perfect” for SCO-005 when:

- OpenScout consumes structured Codex turn/item events rather than final text
- Codex actions are mapped into action blocks
- Codex interactive semantics are surfaced when the runtime supports them
- the session can be reopened by trace reference, not just by process/runtime
  bookkeeping
- the primary inspection path is trace, not app-server stdout/stderr or host
  logs

## Architecture

### 1. Trace-Only Session Surface

The desktop/web host session contract SHOULD stop returning a transport-shaped
mode such as `tmux | logs | none`.

Instead it SHOULD return a trace-shaped session reference:

- target agent ID
- canonical or local session ID
- adapter/harness type
- capability flags such as `canInterrupt`, `canAnswer`, `canDecide`
- trace route / session reference
- optional debug affordances

Recommended direction:

- `trace`
- `unavailable`

Not:

- `tmux`
- `logs`

### 2. Shared Trace Opening

“Open session” SHOULD mean:

1. resolve the agent or session reference
2. load the session snapshot
3. subscribe / replay from the shared session substrate
4. render the shared trace UI

Terminal attach and log tail MAY exist as explicit debug tools, but not as the
session route.

### 3. Observer Adapters as the Boundary

`@openscout/agent-sessions` remains the canonical source of session capability.

SCO-005 does not introduce a new trace protocol.

Instead it raises the bar for adapters:

- if a runtime is “session inspectable,” it MUST speak the session trace
  contract
- if a runtime cannot yet do that, it is not a first-class session surface

### 4. Managed vs Attachable Sessions

SCO-005 MUST support both:

- managed sessions that OpenScout starts or resumes itself
- externally started sessions that OpenScout can discover and attach to as
  proper trace sessions

This matters especially for Codex and Claude Code because human-operated
sessions are part of the long-term model.

## Product Rules

1. The session UI MUST open trace first.
2. The user SHOULD NOT have to know whether the underlying runtime is pairing,
   app-server, stream-json, or something else.
3. The broker projection of a live session SHOULD be enough to open that
   session in trace UI.
4. A product route named “open session” MUST NOT silently degrade to terminal
   attach unless the user explicitly asked for a debug affordance.

## Required Changes

### Desktop / Web Session API

- replace the transport-shaped host session inspector API
- return trace-first session references instead
- separate debug actions from “open session”

### Claude Code

- keep the current observer adapter as the primary Claude inspection path
- route session opening directly into shared trace UI
- close any remaining fidelity gaps inside the adapter/trace layer, not in the
  host UI

### Codex

- upgrade from final-text bridge to structured observer adapter
- request or derive raw turn/item events instead of only final output
- map native events into OpenScout action/question/error/text blocks
- support session reopening and trace continuity by stable session identity

### Pairing and Broker

- pairing-backed agents projected by SCO-004 SHOULD open directly into trace
- broker-projected session-backed agents SHOULD expose enough metadata to open
  the shared trace UI without transport branching

## Acceptance Criteria

SCO-005 is done when all of the following are true:

1. The primary desktop session route no longer models sessions as
   `tmux | logs | none`.
2. Pairing-backed agents open into the shared trace surface.
3. Claude Code sessions open into shared trace with no transport-specific host
   fallback required.
4. Codex sessions open into shared trace with structured turn/block/action
   fidelity.
5. “Open session” means “open trace,” not “attach terminal.”
6. `tmux` and raw logs, if still present, are explicit debug affordances only.

## Risks

- Codex raw event coverage may require deeper app-server integration than the
  current final-text wrapper exposes.
- Some legacy local-agent paths may temporarily lose inspection until they are
  upgraded into true observer adapters.
- If we leave the transport-shaped API in place during migration, product code
  will keep branching on `tmux/logs` and the old model will survive.

## Recommended Direction

SCO-005 should be pursued aggressively.

The current `tmux/logs` model is not just incomplete. It is the wrong product
model.

The clean move is:

- trace-only as the session UX
- observer-grade Claude Code
- observer-grade Codex
- explicit debug tools as a separate concern
