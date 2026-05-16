# SCO-030: Claude Code Tmux For Personal Dev Agents

## Status

Accepted.

## Intent

Record the product and architecture decision that OpenScout should keep
tmux-backed interactive Claude Code sessions as a first-class transport for
personal developer agents.

The immediate trigger is Anthropic's Agent SDK credit announcement:

- [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

That announcement separates Agent SDK and `claude -p` usage from interactive
Claude Code usage for eligible Claude plans starting June 15, 2026. It makes
clear that `claude -p` is a distinct product and billing surface from the
interactive Claude Code experience.

## Decision

OpenScout should implement tmux-backed interactive Claude Code as the primary
Claude transport for developer-facing agent sessions.

For local developer workflows, tmux-backed Claude Code is the default Claude
path. When a developer asks Scout to start or coordinate a real feature-building
agent in their workspace, Scout should create or reuse a normal interactive
Claude Code session hosted in tmux.

`claude -p` / Claude Agent SDK should be available, but it is not the default
and should not be presented as the general Claude agent path. It is reserved for
known production-agent use cases where the operator explicitly wants
non-interactive, service-style execution.

## Rationale

OpenScout is currently optimized for high-trust local developer pilots. The
core experience is a developer working alongside their agents, not a sealed
backend job runner.

For that use case, the developer needs to be able to:

- start long-running Claude Code sessions for feature work
- attach to a session at any time
- inspect the same interactive state Claude Code users expect
- recover from stuck or waiting states without reverse-engineering a batch
  adapter
- keep Scout next to the normal development harness instead of replacing it

tmux is the right substrate for that shape. It preserves the real interactive
Claude Code experience while giving Scout a stable local process/session anchor
that can be started, named, attached, observed, and recovered.

`claude -p` remains useful, but it should be treated as a specialized production
path rather than a parallel default. It gives OpenScout a structured
non-interactive mode with stream-json I/O and a clearer Agent SDK billing model.
That is a fit for deliberate production automation, not for the ordinary case
where a developer wants to jump into the live session while building.

## Boundaries

This decision does not make tmux the Scout protocol.

The broker remains the canonical writer for Scout-owned coordination records:
messages, invocations, flights, deliveries, bindings, questions, and work
items. tmux is a harness transport and operational attach surface.

Scout should continue to build product state from broker records, normalized
harness events, hooks, transcript observation, and projections. Terminal
scrollback is useful for inspection, but it is not canonical coordination
state.

This decision also does not apply equally to every harness. Codex should use
its native app-server transport where available. A future harness should expose
its own declared transport instead of being forced through tmux.

## Implementation Direction

The implementation priority is the tmux path:

1. Add or preserve `claude_tmux` as the first-class interactive Claude Code
   transport.
2. Make local Claude session creation use `claude_tmux` by default.
3. Make attach, inspect, and recovery flows work cleanly against the tmux
   session.
4. Keep `claude_stream_json` or equivalent for explicit `claude -p` / Agent SDK
   execution.

Runtime selection should use the operator intent:

- local personal developer workflow: choose tmux-backed Claude Code
- known production-agent, batch, service, or Agent SDK workflow: choose
  `claude -p`
- unknown or ambiguous workflow: surface the distinction instead of silently
  substituting one mode for the other

The runtime should make tmux sessions easy to start, attach, inspect, and
recover. Routing should still flow through Scout's normal broker semantics.

## Consequences

OpenScout keeps compatibility with the developer-facing Claude Code experience
even when Anthropic changes `claude -p` plan limits, credits, or billing
behavior.

The adapter layer becomes more honest: Claude Code has an interactive transport
and a non-interactive transport, each with a clear reason to exist.

The product can lean into developer-first agentic tooling without pretending
that a batch SDK command is the same thing as sitting alongside a live Claude
Code session.
