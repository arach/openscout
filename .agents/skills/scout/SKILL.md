---
name: scout
description: Use Scout for agent-to-agent chat via the broker. Trigger this whenever an agent needs to tell, ask, or fan out a message to another agent — including any `/scout` request with one or more `@agent` mentions.
metadata:
  short-description: Agent-to-agent chat via the Scout broker
---

# scout

Use Scout when you need shared coordination state, not just message delivery.

Scout is the place to answer four questions before you start coordinating:

1. Who am I here?
2. Who is around?
3. What is the latest?
4. Do I need the full live UI?

Treat that as the default operator loop. Most routing mistakes happen because agents skip orientation and jump straight to `send` or `ask`.

## Resolve the CLI once

Before your first Scout command in a fresh shell, locate the binary:

```bash
scout env --json
```

If `scout` is not on `PATH`, or the installed `scout` on `PATH` is stale for this checkout, use:

```bash
bun /Users/arach/dev/openscout/packages/cli/bin/scout.mjs env --json
```

## Default loop

Run these in order whenever you are entering a Scout-heavy task, recovering context, or the user asks some version of "figure out what's going on":

```bash
scout whoami
scout who
scout latest
scout server open
```

Interpret them like this:

- `scout whoami` answers identity and default routing context from the current workspace.
- `scout who` answers who is online, discovered, or recently active.
- `scout latest` answers recent broker activity without making you tail raw logs.
- `scout server open` opens the full UI and will start the server if it is not already running.

Use the CLI for quick orientation. Use the web UI when you need conversation history, multiple agents at once, or spatial context.

## Frequent questions

Map common operator/agent questions to one command:

| Question | Command |
| --- | --- |
| "Who am I?" | `scout whoami` |
| "Who's around?" | `scout who` |
| "What's the latest?" | `scout latest` |
| "Open Scout" | `scout server open` |
| "Open a specific page in Scout" | `scout server open --path /agents/<agent-or-route>` |

Do not make agents rediscover these patterns from scratch. Teach them as the default Scout muscle memory.

## Routing is decided by addressee count, not verb

Scout has three destinations: **DM**, **named channel**, **shared broadcast**. Pick by who the message is for:

| Situation | Destination | Command |
| --- | --- | --- |
| You're addressing one specific agent | DM (two-party, private) | `scout send "@x msg"` or `scout ask --to x "msg"` |
| You're posting into a named channel | that channel | `scout send --channel foo "msg"` |
| You want every agent to see it | `channel.shared` | `scout broadcast "msg"` |

`channel.shared` is a broadcast surface, not a default. A pointed `@x` message is a DM. Do **not** rely on implicit fallback to `channel.shared`; if you do not name an addressee, the command is wrong.

## Tell vs Ask

Scout has two coordination modes. Choose intentionally.

### Tell

Use **Tell** when no reply is needed.

Phrasing:

- "tell @x ..."
- "let @x know ..."
- "@x done with X"
- status updates

Command:

```bash
scout send "@x msg"
```

This is inline, fire-and-forget, and lands in the `@x` DM.

### Ask

Use **Ask** when a reply, judgment, or investigation is needed.

Phrasing:

- "ask @x ..."
- "@x can you check ...?"
- anything ending in `?`
- slow targets
- multi-turn follow-up

Command:

```bash
scout ask --to x "msg"
```

If your host has a background worker or subagent primitive, **run Ask there instead of blocking the parent**. The parent should keep working and surface the reply when the background task completes.

Prompt shape for the background worker:

```text
Run: scout ask --to hudson "<your question>"
Return the reply text only.
```

Inline `scout ask` is acceptable only when your host cannot delegate background work.

## Fan-out and broadcast

### Fan-out

If the user's message contains multiple `@name` mentions, fan out one Scout action per target. Keep those conversations separate unless the user explicitly asked for a shared channel.

### Broadcast

For true broadcasts use `scout broadcast`:

```bash
scout broadcast "shipping 0.3.0 in 15min, pause long flights"
```

Confirm with the user before broadcasting to more than 4 targets.

## Addressing

Agent identity has five dimensions: `definitionId`, `workspaceQualifier`, `profile`, `harness`, `node`. Canonical form:

```
@<definitionId>[.<workspaceQualifier>][.profile:<profile>][.harness:<harness>][.node:<node>]
```

When a short `@name` could match multiple live agents, pin the dimension you care about with a typed qualifier:

- `@vox.harness:codex` — the Codex-backed Vox
- `@vox.harness:claude` — the Claude-backed Vox
- `@arc.profile:reviewer` — the reviewer profile of Arc
- `@vox.harness:codex.node:mini` — fully qualified across machines

Aliases:

- `runtime:` = `harness:`
- `persona:` = `profile:`
- `branch:` / `worktree:` = workspace qualifier

Use typed qualifiers any time the user's request implies a specific harness or profile. Do not rely on short-name resolution to guess right.

## Resolution rule

Short `@name` only resolves when **exactly one matching agent is currently routable**.

If `scout send "@x ..."` returns `unresolvedTargets: ["@x"]`, the agent is not online.

If the CLI reports multiple candidates, re-run with a typed qualifier. Options:

- Bring it up: `scout up <name-or-path>`
- Disambiguate with a typed qualifier: `@x.harness:codex`
- Use the full FQN: `@x.host.x-main-abc123`
- Tell the user the target is offline before silently moving on

## Decision rule

Use **Ask** by default when the next sentence is effectively:

- "Do this and get back to me."
- "Investigate this and tell me what you found."
- "Take ownership of the next step."
- "Review this and return a judgment."

Use **Tell** when the next sentence is effectively:

- "Heads up."
- "I am working on this now."
- "Please note this constraint."
- "You can ignore the earlier path."

When in doubt, use Ask.

## Dedicated agent cards

Use `scout card create` when you need a project-scoped relay identity with its own inbox and return address.

Use it when:

- you are in a worktree and want the agent bound to that exact path and branch
- you need a dedicated alias instead of reusing a shared project agent
- you want to hand another agent a clean reply target immediately

Examples:

```bash
scout card create
scout card create ~/dev/openscout-worktrees/shell-fix --name shellfix --harness claude
```

After creating the card, prefer the friendly handle such as `@shellfix`.

## Compatibility notes

- `scout relay ask` and `scout relay send` are accepted as namespace aliases. Do not use them in new prompts.
- `scout` is the canonical CLI binary. Do not use `openscout` in new prompts or examples.
- Use `--as <agent>` when you need the broker to record a specific sending agent identity instead of the default operator/current-project inference.

## When not to use Scout

- Do not use Scout for work inside the same agent when no cross-agent communication is needed.
- Do not invent ad hoc retry loops in prompts when the background worker already gives you tracked waiting.
- Do not read the broker's internal storage directly. Go through the `scout` CLI or Scout web UI.
