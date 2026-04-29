# Harness MCP And Reply Delivery

This note documents the current Scout MCP/tool surfaces, how the known harness
adapters integrate with tools, and where reply delivery works today versus where
Scout needs explicit native notify/callback semantics.

## Current Scout MCP Surfaces

### Canonical MCP tool server

`/Users/arach/dev/openscout/apps/desktop/src/core/mcp/scout-mcp.ts` exposes the
main stdio MCP server behind `scout mcp`.

Tools exposed today:

- `whoami`: inspects the default sender id and broker URL for a workspace when host context is unclear.
- `agents_search`: searches broker and discovered setup inventory when a target is unknown or ambiguous.
- `agents_resolve`: resolves an exact handle or returns ambiguity data when a host needs to pin one target.
- `messages_send`: posts a broker-backed tell/status/reply with explicit target fields or channel.
- `invocations_ask`: creates a broker-backed consult/work handoff with explicit target fields.
- `work_update`: updates durable work item state.
- `card_create`: creates a project-scoped reply-ready agent card.

`/Users/arach/dev/openscout/apps/desktop/src/cli/commands/mcp.ts` is only a CLI
wrapper. It parses `--context-root` and launches `runScoutMcpServer`.

Direct MCP sends should pass route intent as fields such as `targetLabel`,
`targetAgentId`, or `channel`; the `body` is payload. A host
does not need to call `whoami`, `agents_search`, or `agents_resolve` before every
explicit-target send. Use those tools only for orientation, ambiguity, or
advanced host UI flows.

Current limitation: explicit `targetLabel` / `targetAgentId` paths use the
broker delivery planner, but `mentionAgentIds` and body-mention compatibility
paths still carry some legacy client-side planning. The broker-owned routing
spec tracks collapsing those fallbacks into `/v1/deliver`.

`invocations_ask` defaults to non-blocking behavior. It now accepts
`replyMode: "none" | "inline" | "notify"`, with `awaitReply: true` retained as a
compatibility alias for `replyMode: "inline"`.

When `replyMode` is `inline`, the tool calls `waitForScoutFlight` and blocks the
MCP tool call until the flight reaches `completed`, `failed`, `cancelled`, or the
optional timeout. The returned `output` is `flight.output` with `flight.summary`
as fallback.

When `replyMode` is `notify`, the tool returns immediately with durable
`conversationId`, `messageId`, `flightId`, and optional `workId` data, then the
MCP server waits in the background and emits `notifications/scout/reply` when the
flight completes or fails. This is the native MCP callback path for hosts that
surface server notifications.

Important implication: `inline` is still an inline wait. `notify` is push-style
from the MCP server to the connected host, but it still depends on the current
MCP server process staying alive and the host choosing to surface custom server
notifications.

### Claude channel server

`/Users/arach/dev/openscout/apps/desktop/src/core/mcp/scout-channel.ts` exposes a
separate stdio MCP server intended for Claude Code channel mode. The CLI wrapper
is `/Users/arach/dev/openscout/apps/desktop/src/cli/commands/channel.ts`.

The channel server:

- resolves the current Scout agent id
- subscribes to the broker SSE event stream
- filters `message.posted` events where the current agent is mentioned or in
  `message.audience.notify`
- emits `notifications/claude/channel` to the host
- exposes `scout_reply` and `scout_send`

This is the only current native push path inspected here. It is provider-specific:
the server advertises experimental `claude/channel`, and the notification method
is `notifications/claude/channel`.

Observed limitation: `scout_reply` accepts `conversation_id`, but the current
implementation sends a fresh message to the target agent id via
`sendScoutMessageToAgentIds` and does not pass a reply-to message id or preserve
the incoming conversation id as a first-class reply route.

### Broker reply writes

The broker already records replies and notify audiences. In
`/Users/arach/dev/openscout/packages/runtime/src/broker-daemon.ts`,
`executeLocalInvocation` posts the target agent's final output back into the
invocation conversation with:

- `actorId` set to the responding agent
- `replyToMessageId` set to the original invocation message
- `audience.notify` containing the requester
- metadata for invocation, flight, responder harness, transport, session, cwd,
  and return address

So the durable reply model exists. What is missing is a general way to surface
that durable reply into every live harness session without inline waiting.

## Harness Capability Categories

### Native MCP-capable

Harnesses in this category can launch or consume MCP servers directly. Scout can
give them `scout mcp` as a tool server.

Codex is the clearest current example. The Codex adapter starts `codex
app-server` and injects Scout MCP config through
`buildScoutMcpCodexLaunchArgs` in
`/Users/arach/dev/openscout/packages/agent-sessions/src/codex-launch-config.ts`.
The runtime equivalent is in
`/Users/arach/dev/openscout/packages/runtime/src/codex-app-server.ts`.

Claude Code can consume MCP servers externally, but the current
`claude_stream_json` runtime path does not inject `scout mcp` automatically.
Scout instead has the separate `scout channel` path for Claude channel
notifications.

### CLI / stream-json

These harnesses are controlled by a long-running CLI process over stdin/stdout
or by one-shot CLI execution.

Claude stream-json:
`/Users/arach/dev/openscout/packages/runtime/src/claude-stream-json.ts` and
`/Users/arach/dev/openscout/packages/agent-sessions/src/adapters/claude-code.ts`
keep a `claude --print --input-format stream-json --output-format stream-json`
process alive, write user JSON messages to stdin, parse assistant/result/error
events, and resolve the invocation from the final assistant output.

Codex exec:
`/Users/arach/dev/openscout/packages/runtime/src/local-agent-executor.ts` uses
`codex exec --output-last-message` for one-shot local execution. This gives
inline final output, but no persistent live callback channel.

### App-server / event-server

These harnesses expose a richer local server protocol.

Codex app-server:
`/Users/arach/dev/openscout/packages/agent-sessions/src/adapters/codex.ts` and
`/Users/arach/dev/openscout/packages/runtime/src/codex-app-server.ts` manage a
persistent JSON-RPC process, thread lifecycle, `turn/start`, `turn/steer`,
interrupt, and streamed item events. Scout MCP is injected into Codex launch
config. The adapter still rejects host-side `item/tool/call` server requests as
unsupported, so native tool execution depends on Codex's own MCP server config
path rather than a generic Scout-hosted dynamic tool bridge.

OpenCode:
`/Users/arach/dev/openscout/packages/agent-sessions/src/adapters/opencode.ts`
starts `opencode serve`, sends prompts over HTTP, and observes replies via SSE.
The adapter comments note that OpenCode loads project `.opencode` config, plugins,
MCP servers, and LSP from cwd. Scout does not inject its own MCP server here.

### Web / terminal-only

The tmux fallback path in
`/Users/arach/dev/openscout/packages/runtime/src/local-agents.ts` sends prompts
into a terminal session and then polls broker messages for a tagged
`[ask:<flightId>]` reply. This is the least native path: it relies on prompting,
the harness following instructions, and polling durable messages.

### Unknown / limited

Pi and OpenAI-compatible adapters expose useful streaming sessions but no Scout
MCP injection or native reply callback path today.

- `/Users/arach/dev/openscout/packages/agent-sessions/src/adapters/pi.ts` starts
  `pi --mode rpc` and maps Pi RPC events into blocks.
- `/Users/arach/dev/openscout/packages/agent-sessions/src/adapters/openai-compat.ts`
  calls an OpenAI-compatible chat completions endpoint and parses streamed SSE.
  It can observe tool-call deltas as blocks, but it does not execute MCP tools.

## Adapter Behavior Today

| Harness | Current integration | Scout MCP/tool path | Reply delivery today |
|---|---|---|---|
| Claude | Persistent stream-json CLI; separate Claude channel server exists | No automatic MCP injection in stream-json path; `scout channel` can be configured as Claude channel | Direct broker invocation captures final output inline; channel server can push incoming broker messages to Claude sessions |
| Codex | Persistent `codex app-server` plus older one-shot `codex exec` | App-server launch injects `mcp_servers.scout.*`; exec path does not | App-server/exec invocations return final output to broker; no generic live callback from broker to Codex session beyond Codex MCP request/response tools |
| Pi | Persistent `pi --mode rpc` | None found | Final output through adapter events only; no Scout notify path |
| OpenCode | Local HTTP server plus SSE event stream | Loads project config/MCP from cwd, but Scout does not inject `scout mcp` | Final output through adapter events only; no Scout notify path |
| OpenAI-compatible | Streaming `/chat/completions` client | None; tool calls are observed blocks, not executed | Final streamed response only; no Scout notify path |

## Inline Waiting Versus Callback Notification

Inline waiting requires all of the following:

- a broker flight exists
- the target can be invoked or queued
- the caller is willing to keep the MCP tool call open
- the timeout is acceptable for the host and user

Scout supports this today through `invocations_ask.awaitReply`. This is simple
and useful for short tasks, but it ties reply delivery to the initiating tool
call. It is fragile for long-running work, human-in-the-loop states, host
timeouts, and cases where the caller can continue doing other work.

Callback-style notification requires a live addressable receiver. Current
partial mechanisms are:

- Claude channel notification via `scout channel`
- broker SSE event stream and thread event APIs
- durable `message.audience.notify` on replies and status messages
- desktop/web/UI broker subscriptions

The gap is that MCP-capable harnesses do not all expose the same host-level
notification primitive. A stdio MCP server can return tool results and may send
notifications if the host supports them, but Scout currently only implements a
Claude-specific channel notification server. CLI-only harnesses generally cannot
be interrupted with native notifications unless Scout controls a terminal,
channel, or background session protocol for that harness.

## Proposed Reply Delivery Policy

Use an explicit reply mode on Scout ask/send surfaces and endpoint capabilities:

```ts
type ScoutReplyMode = "none" | "inline" | "notify";
```

### `none`

Durable broker delivery only. The tool returns `conversationId`, `messageId`,
`flightId`, and optional `workId`. The caller or UI can inspect history later.

Use for:

- default `invocations_ask`
- long-running work
- CLI-only or unknown harnesses
- unsupported callback targets

Fallback: always available if the broker accepts the delivery.

### `inline`

Block the current call until the flight completes or times out. This maps to the
existing `awaitReply` behavior.

Use for:

- short consults
- hosts that cannot background a wait
- explicit user/operator request for synchronous behavior

Fallback: if no flight is created, return durable identifiers with
`deliveryPolicy: "none"` and diagnostic data.

### `notify`

Return immediately, then deliver replies/status to the caller's live session
through the strongest supported callback path.

Preferred mechanisms by harness:

- Claude: `scout channel` / `notifications/claude/channel`
- Codex app-server: generic MCP notification or Codex session event bridge once
  implemented; durable broker reply today
- Desktop/web/pairing bridge: broker SSE/thread watch notification
- OpenCode: future SSE bridge if Scout owns a server-side integration point
- Pi: future RPC `steer`/notification equivalent if Pi supports it
- CLI/tmux/OpenAI-compatible: durable broker reply only unless a surface-level
  watcher is running

Fallback: downgrade to `none` and return durable ids plus a
`notifyUnsupportedReason`.

## Recommended Implementation Points

1. Add endpoint capability metadata in protocol/runtime.

   Candidate fields:

   - `supportsScoutMcpTools`
   - `supportsInlineAwait`
   - `supportsBrokerNotify`
   - `supportsHostNotifications`
   - `notificationTransport`
   - `notificationSessionId`

   The catalog in
   `/Users/arach/dev/openscout/packages/runtime/src/harness-catalog.ts` already
   exposes broad capabilities such as `chat`, `invoke`, `deliver`, and `execute`.
   Reply delivery needs finer-grained runtime/session capabilities.

2. Extend `invocations_ask` with a first-class reply mode. **Implemented for the
   main MCP server.**

   `replyMode` is now available as `"none" | "inline" | "notify"`.
   `awaitReply` remains a compatibility alias for `"inline"`. The notify path
   schedules `notifications/scout/reply` and returns callback metadata in
   structured content.

3. Generalize `scout-channel` into a notification bridge.

   Keep the Claude channel implementation, but move the broker SSE filtering and
   message-to-notification projection into a reusable bridge module. Provider
   adapters can then implement Claude channel, generic MCP notifications, Codex
   app-server notifications, or UI/pairing bridge notifications.

4. Use thread events as the normalized notify source.

   `/Users/arach/dev/openscout/packages/protocol/src/thread-events.ts` already
   models event notifications with tiers, target actor ids, reasons, and summary.
   Native notify delivery should consume those envelopes instead of inventing a
   second notification model.

5. Preserve broker-first semantics.

   Every notify path should be an acceleration of durable broker state, not a
   replacement for it. The broker should write the message/flight/work update
   first, then notify live sessions from that record.

6. Fix reply routing in `scout-channel`.

   `scout_reply` should preserve `conversation_id` and `replyToMessageId` when
   present. The current shape can send a DM-like message to the sender, but it
   does not fully preserve the incoming thread context.

7. Avoid prompt-only reply tags where direct transports exist.

   The tmux `[ask:<id>]` loop should remain a fallback for terminal-only
   harnesses. Codex app-server and Claude stream-json should continue returning
   final assistant output directly to the broker.

## Risks

- Host notification APIs are not uniform across MCP-capable harnesses.
- A generic MCP notification path may exist technically but still be ignored by
  a given host UI.
- Inline waits can hide slow or queued work behind host timeouts.
- Prompt-only callback instructions can produce false positives, missing tags,
  or replies in the wrong conversation.
- If Scout lets each harness invent reply semantics, broker history and UI
  notifications will diverge.
- The current workspace has both MCP request/response tools and Claude channel
  notifications; treating them as one surface would obscure real capability
  differences.

## Open Questions

- Which MCP hosts used by Scout actually surface server notifications to the
  model or user, and with what method names?
- Should `notify` be requested per ask, per MCP client session, or as a durable
  endpoint preference?
- How should Scout authenticate a callback target when multiple sessions share
  one agent id?
- Should channel notifications target only mentions/audience notify, or also
  flight state changes and work item next-move changes?
- Can Codex app-server expose a host-visible notification path that is separate
  from tool result handling?
- Should OpenCode Scout MCP injection be automatic, or should it remain project
  config owned by `.opencode`?

## Tests To Add

- `scout-mcp` unit test: `invocations_ask` maps `replyMode: "inline"` to
  `waitForFlight` and preserves existing `awaitReply` behavior.
- `scout-mcp` unit test: `replyMode: "notify"` emits
  `notifications/scout/reply` when the background flight completes. **Added.**
- `scout-mcp` unit test: `replyMode: "notify"` downgrades to `none` with a
  structured reason when the current sender/session has no callback capability.
- `scout-channel` unit test: incoming `message.posted` events are filtered by
  mention and `audience.notify`, excluding messages from self.
- `scout-channel` unit test: `scout_reply` preserves conversation and
  reply-to metadata once that routing is implemented.
- Broker/runtime scenario test: local direct invocation posts the agent reply
  with `audience.notify` containing the requester and responder harness metadata.
- Harness catalog/runtime test: Codex app-server endpoints advertise Scout MCP
  tool support, while tmux/OpenAI-compatible endpoints do not.
- Adapter integration test: Codex launch args include `mcp_servers.scout.*` when
  a Scout executable or repo script is resolvable.
