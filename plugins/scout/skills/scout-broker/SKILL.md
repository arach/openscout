---
name: "MCP"
description: Use Scout MCP tools for agent discovery, precise handle resolution, direct messages, and ask-style invocations. Trigger this when the user wants to contact another Scout agent, delegate work, inspect who is online, or check Scout routing state from Codex.
metadata:
  short-description: Use Codex tools for Scout messaging and coordination
---

# Scout MCP

Use this plugin when the task is about Scout coordination through Codex MCP tools rather than local shell delegation.

Fast path:

1. If you know the repo/worktree, pass `currentDirectory`.
2. If you know one target handle, call `messages_send` with `targetLabel` for tell-style writes or `invocations_ask` with `targetLabel` for ask-style handoffs.
3. Use `whoami`, `agents_search`, or `agents_resolve` only when sender context is unclear, the target is ambiguous, or the broker says the route failed.

## Working directory

- Pass `currentDirectory` whenever you know the relevant repo or worktree path.
- If you do not pass `currentDirectory`, Scout falls back to the plugin's default setup root.
- This plugin wrapper sets that fallback to the user's home directory instead of the plugin folder, which is a safer default but still weaker than a real workspace path.

## Tell vs ask

Use `messages_send` when the user is notifying or updating another agent.
When there is one intended recipient and you only know a handle such as `@hudson` or `@lattices#codex?5.5`, prefer a single `messages_send` call with `targetLabel` over a separate resolve round-trip.

Use `invocations_ask` when the user wants another agent to investigate, review, decide, or report back.
When there is one intended recipient and you know a handle such as `@hudson` or `@lattices#claude?sonnet`, prefer a single `invocations_ask` call with `targetLabel`.

- Set `awaitReply: true` only when the parent task is blocked on the answer now.
- Leave `awaitReply` false when the request is background work or the user only asked you to hand it off.

## Targeting rules

- Prefer `targetLabel` for one known target when the write can go straight through.
- Use `agents_resolve` before sending only when the user names one specific agent and there is real risk of ambiguity.
- When you already have exact target agent IDs, pass them via `mentionAgentIds` to `messages_send` or `targetAgentId` to `invocations_ask`.
- If the user names multiple agents, fan out one action per target unless they explicitly want a shared broadcast-style update.
- Target shorthand is accepted: `#<harness>` maps to a harness qualifier and `?<model>` maps to a model qualifier, e.g. `@lattices#codex?5.5`.

## Practical defaults

- Start with `agents_search` when the user asks who is online, available, or routable.
- Start with a direct write when the user already told you the single target and the relevant workspace is known.
- Start with `agents_resolve` when the user names a handle such as `@hudson` and the direct write path reports ambiguity.
- Use `messages_send` for "tell", "notify", "let them know", or status updates.
- Use `invocations_ask` for "ask", "review", "investigate", "check", or anything that clearly expects a reply.
