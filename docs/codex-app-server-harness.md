# Codex App-Server Harness For Scout

## Thesis

Scout should keep its current broker semantics as the canonical model.

The improvement is lower in the stack: add a harness-session plane for long-running agent runtimes, then map those sessions back into the existing `message`, `invocation`, and `flight` model.

This lets OpenScout reuse the strongest part of the pairing runtime without replacing Scout's richer collaboration semantics.

## What We Are Borrowing

The useful pattern is:

- a thin adapter boundary per harness
- a persistent session per agent instead of one-shot exec calls
- a live event stream for deltas, actions, interruptions, and steering
- replayable session state that can survive broker restarts

For Codex, that means using `codex app-server` over stdio JSON-RPC instead of `codex exec` plus prompt-file polling.

## What We Are Not Replacing

The broker remains the source of truth for:

- conversations
- messages
- invocations
- flights
- deliveries
- bindings
- collaboration records

The harness-session plane is an execution substrate, not a second canonical protocol.

## Immediate Design

### Transport

Add a first-class local endpoint transport:

- `codex_app_server`

This transport means:

- the endpoint is backed by a persistent Codex app-server session
- the runtime owns the child process and thread lifecycle
- the broker can invoke the agent directly without going through tmux nudges

### Session Model

For each Codex-backed Scout agent:

1. Start or reuse one `codex app-server` child process.
2. Initialize the JSON-RPC connection once.
3. Resume a stored thread id if available.
4. Otherwise create a fresh thread with the agent's system prompt.
5. Route invocations to `turn/start`.
6. Capture final assistant output from the streamed items.

The runtime should persist the Codex thread id in the agent runtime directory so a broker restart can resume the same long-running thread.

### Prompting

Codex app-server agents should no longer be told to send their final reply through Scout shell commands.

They should instead be told:

- they are invoked directly by the OpenScout broker
- their final assistant message becomes the broker-visible reply
- they may still inspect broker context with Scout commands if they need surrounding history

That preserves current Scout semantics while removing the brittle `[ask:<id>]` tagging loop.

## Why This Is Better

Compared with the current Codex path:

- no prompt queue files
- no `codex exec resume` loop
- no broker polling for tagged replies
- no fake tmux transport for a non-tmux runtime

Compared with replacing Scout semantics wholesale:

- no downgrade in collaboration richness
- no duplicate source of truth
- no protocol fork per harness

## First Implementation Slice

1. Add `codex_app_server` to protocol and runtime endpoint transport unions.
2. Derive Codex-backed Scout agents to that transport instead of `tmux`.
3. Add a persistent `CodexAppServerSessionManager` in `@openscout/runtime`.
4. Resume or create a Codex thread per agent and persist its thread id locally.
5. Route broker invocations for Codex agents through `turn/start`.
6. Keep the existing tmux path unchanged for Claude agents.

## Next Steps After This Slice

- expose interrupt and steer as first-class runtime operations
- project harness deltas into richer flight status
- add replay and snapshot APIs for live session inspection
- generalize the adapter boundary so Claude, Codex, and future harnesses share one session abstraction
