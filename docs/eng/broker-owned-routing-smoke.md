# Broker-Owned Routing Smoke Notes

Companion verification notes for broker-owned routing and context. Keep these
outside the SCO-014 spec so live smoke details can change without destabilizing
the main design doc.

## Scope

These checks exercise the operator-facing contract:

- `scout up` starts or revives the concrete registered agent, not a hidden
  caller-side routing guess.
- `scout card create` mints a reply-ready address with broker-owned sender,
  inbox, and return-address context.
- MCP `card_create`, `messages_send`, and `invocations_ask` can resolve sender
  and workspace context inside the tool call. A caller should not need to call
  `whoami`, `who`, `agents_search`, or `agents_resolve` when it already has a
  usable target label or exact target id.

## Unit Coverage Added

`apps/desktop/src/core/mcp/scout-mcp.test.ts` now includes
`routes a direct ask by label without whoami or agents_resolve preflight`.

The test deliberately makes `agents_search` and `agents_resolve` throw. It then
calls `invocations_ask` with only `body`, `targetLabel`, and `replyMode: "none"`
and asserts that the tool:

- resolves the default sender from the MCP server's default current directory
- passes the target label directly to broker-backed ask routing
- returns durable `conversationId`, `messageId`, and `flightId`
- does not require a separate route-discovery preflight

## Live Smoke: Fresh Claude Agent Uses Simplified Path

Run from `/Users/arach/dev/openscout`.

1. Ensure the Scout web/broker surface is available:

```bash
bun ./apps/desktop/bin/scout.ts server open --cwd /Users/arach/dev/openscout
```

2. Create a fresh Claude-backed reply-ready card:

```bash
bun ./apps/desktop/bin/scout.ts card create /Users/arach/dev/openscout \
  --name route-smoke-claude \
  --display-name "Route Smoke Claude" \
  --harness claude \
  --model sonnet \
  --no-input
```

Record the rendered `Agent:` line, for example
`route-smoke-claude.main.mini`.

3. Start or revive that concrete agent:

```bash
bun ./apps/desktop/bin/scout.ts up route-smoke-claude
```

Acceptance:

- output names the same concrete agent id from step 2
- no project-name alias silently redirects to a different agent
- if the agent cannot be revived, the error says whether the name is unknown,
  ambiguous, offline, or bound to another project root

4. Ask the fresh Claude agent to use the simplified broker path:

```bash
bun ./apps/desktop/bin/scout.ts ask --to route-smoke-claude --timeout 180 \
  'Use the simplified Scout broker path only. Do not run scout whoami, scout who, agents_search, or agents_resolve first. Create a reply-ready card for this workspace with scout card create, then send a short broker-backed status with scout send --to route-smoke-claude. Include the literal text @codex in the message body. Reply with the exact Scout commands you ran and the returned conversationId/messageId values.'
```

Acceptance:

- the agent uses `scout card create` directly, without a preceding `scout whoami`
  or `scout who`
- the agent uses `scout send --to` or `scout ask --to` directly with an explicit
  target label/id or card return context, without a separate who/search/resolve
  preflight
- the body text can include literal `@codex` without creating a second route
- the final reply includes durable broker ids: `conversationId` plus either
  `messageId` or `flightId`
- the broker conversation shows the same sender id and current directory that
  the tool result returned

Note: the current Claude stream-json runtime does not automatically inject
`scout mcp`; this live Claude smoke therefore validates the simplified
broker-owned route through the CLI commands that Claude-backed local agents are
prompted to use today. Use the MCP host variant below when validating direct MCP
tool calls.

## MCP Host Smoke Variant

If testing from a Codex or Claude host with `scout mcp` connected, ask the host:

```text
Use Scout MCP without whoami, who, agents_search, or agents_resolve preflight.
Call card_create for /Users/arach/dev/openscout, then call invocations_ask with
targetLabel "@route-smoke-claude", replyMode "none", and a short status body.
Report the senderId, currentDirectory, conversationId, messageId, and flightId.
```

Acceptance is the same as the CLI smoke: the host should be able to complete the
flow from tool-local sender/context resolution and broker-owned routing.

## Useful Test Commands

```bash
bun test apps/desktop/src/core/mcp/scout-mcp.test.ts
bun test apps/desktop/src/cli/commands/up.test.ts apps/desktop/src/cli/options.test.ts
bun test apps/desktop/src/core/agents/service.test.ts packages/runtime/src/scout-agent-cards.test.ts
```
