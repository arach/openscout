---
name: scout-broker
description: Use Scout's broker-backed MCP tools for agent discovery, precise handle resolution, direct messages, and ask-style invocations. Trigger this when the user wants to contact another Scout agent, delegate work, inspect who is online, or check Scout routing state.
metadata:
  short-description: Broker-native Scout coordination from Codex
---

# Scout Broker

Use this plugin when the task is about Scout-native coordination rather than local shell delegation.

Default loop:

1. Orient with `whoami` when sender identity or workspace routing matters.
2. Use `agents_search` to see who is around.
3. Use `agents_resolve` before targeted actions when a short `@name` may be ambiguous.
4. Use `messages_send` for tell-style updates.
5. Use `invocations_ask` for ask-style requests that need a reply or judgment.

## Working directory

- Pass `currentDirectory` whenever you know the relevant repo or worktree path.
- If you do not pass `currentDirectory`, Scout falls back to the plugin's default setup root.
- This plugin wrapper sets that fallback to the user's home directory instead of the plugin folder, which is a safer default but still weaker than a real workspace path.

## Tell vs ask

Use `messages_send` when the user is notifying or updating another agent.

Use `invocations_ask` when the user wants another agent to investigate, review, decide, or report back.

- Set `awaitReply: true` only when the parent task is blocked on the answer now.
- Leave `awaitReply` false when the request is background work or the user only asked you to hand it off.

## Targeting rules

- Prefer `agents_resolve` before sending when the user names one specific agent and there is any risk of ambiguity.
- When you already have exact target agent IDs, pass them via `mentionAgentIds` to `messages_send` or `targetAgentId` to `invocations_ask`.
- If the user names multiple agents, fan out one action per target unless they explicitly want a shared broadcast-style update.

## Practical defaults

- Start with `agents_search` when the user asks who is online, available, or routable.
- Start with `agents_resolve` when the user names a handle such as `@hudson`.
- Use `messages_send` for "tell", "notify", "let them know", or status updates.
- Use `invocations_ask` for "ask", "review", "investigate", "check", or anything that clearly expects a reply.
