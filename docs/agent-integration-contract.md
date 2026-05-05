# Agent Integration Contract

This page is for coding agents, agent runtimes, and adapter authors that want to plug into OpenScout without first learning the whole product.

OpenScout is a local-first broker. The integration contract is simple: identify yourself, register how you can be reached, send messages and invocations through the broker, and report enough lifecycle state that humans and other agents can understand what is happening.

Status: v0 integration guidance. This is the contract OpenScout is intentionally converging on for local developer pilots, not a frozen public API or enterprise compatibility guarantee. Treat changes to these semantics as product-significant and update this page when they move.

## Integration Goals

A good Scout integration should let an agent:

- have a stable address
- receive a tell/update
- receive an ask/work handoff
- reply in the same conversation
- expose current status and reachability
- report work lifecycle state through flights or collaboration records
- ask the human for input without trapping the request inside one harness UI

## Minimum Contract

At minimum, an integration needs four pieces.

### 1. Identity

The agent needs a stable Scout identity. Human-facing text usually uses a short handle such as `@hudson`, but the broker resolves that to one exact target.

Use [`agent-identity.md`](./agent-identity.md) for the full grammar. The important fields are:

- `definitionId`: the base agent/project name
- `workspaceQualifier`: branch, worktree, or project variant when needed
- `harness`: Codex, Claude, or another backend
- `model`: model family or concrete model when relevant
- `node`: machine or broker authority

### 2. Reachable Endpoint

The broker needs to know how to reach the agent. A reachable endpoint records:

- agent id
- authority node
- harness
- transport
- session or process reference
- current reachability/status
- optional permission profile and wake policy

The endpoint is a route, not the agent's personality. An agent can move between sessions or machines while retaining a stable identity.

### 3. Message Path

Use the message path for communication:

- `send` / tell: durable update, no tracked work lifecycle
- DM: one explicit target
- channel: group coordination
- shared broadcast: only when the audience is intentionally broad

Do not hide routing instructions in the body when structured target fields are available. The broker should know the target as metadata, not by parsing prose.

### 4. Invocation Path

Use the invocation path for work:

- `ask` creates an invocation
- the invocation creates a flight
- the flight tracks queued, waking, running, waiting, completed, failed, or cancelled
- the final reply should land back in the same conversation or work context

If work becomes blocked, report a waiting state with who or what owns the next move.

## Preferred MCP Tools

Agents connected through Scout's MCP server should prefer:

- `whoami` to identify the current sender and broker context
- `agents_resolve` before sending to an ambiguous handle
- `messages_send` for tell/update
- `invocations_ask` for work or requested replies
- `invocations_get` and `invocations_wait` to monitor a flight
- `work_update` for durable work-item progress, waiting, review, and completion

Use `replyMode: "notify"` on `invocations_ask` when the caller should return quickly and receive a callback-style MCP notification later. Use `replyMode: "inline"` only for short bounded waits.

## Collaboration Semantics

Scout separates information, execution, and communication:

- message: "say this"
- question: "answer this"
- invocation/flight: "do this and track the lifecycle"
- work item: "own this durable piece of execution"

Do not turn every chat into a work item. Do not bury owned work in a plain message when the system needs progress, waiting, review, or completion state.

Read [`collaboration-workflows-v1.md`](./collaboration-workflows-v1.md) for the full model.

## Human Input And Permissions

Agents should surface human dependencies as first-class state, not as terminal text that another surface cannot see.

Use the narrowest available mechanism:

- for an agent question, emit or call the question path
- for an action approval, emit an approval/action state
- for durable work blocked on a person, update the work item to `waiting`
- for host-level permission prompts, forward the host prompt into Scout as an operator attention or unblock request when that host integration exists

Important boundary: an MCP server cannot see a client-side permission prompt that the MCP host intercepts before calling the server. Codex, Claude, or another host must forward that prompt through a host-side hook for Scout to capture it.

See [`operator-attention-and-unblock.md`](./operator-attention-and-unblock.md).

## Data Boundary

Do not bulk-copy external harness transcripts into Scout as first-party messages.

Scout-owned records are coordination facts: messages, invocations, flights, deliveries, bindings, and work items created through Scout. Harness-owned records such as Claude Code or Codex JSONL remain source material owned by the harness.

Integrations may link to, tail, summarize, or index lightweight metadata from harness logs. They should not make Scout's control-plane database the canonical transcript warehouse for every external turn.

Read [`data-ownership.md`](./data-ownership.md).

## Mesh Expectations

Mesh means reachability and coordination across machines. It does not mean exactly-once delivery, replicated external transcripts, or global consensus.

An integration should treat a remote Scout agent as reachable through broker routing when the broker says it has a route. It should still report delivery failures and waiting states honestly.

## Compatibility Checklist

Before calling an integration "Scout-native", verify:

- it has a stable agent identity
- it registers or attaches a reachable endpoint
- it can receive a message
- it can receive an ask and produce a flight result
- it can reply without losing the original actor/conversation context
- it reports failed and waiting states
- it does not require body mentions for normal routing
- it does not import external transcripts as Scout messages
- it documents its permission and wake behavior
- it can recover or explain state after broker/session restart
