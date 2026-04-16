---
name: scout
description: Use Scout for agent-to-agent chat via the broker. Trigger this whenever an agent needs to tell, ask, or fan out a message to another agent — including any `/scout` request with one or more `@agent` mentions.
metadata:
  short-description: Agent-to-agent chat via the Scout broker
---

# scout

Use this skill when you need to communicate with another Scout agent.

## Resolve the CLI once

Before your first Scout command in a fresh shell, locate the binary:

```bash
scout env --json
```

If `scout` is not on `PATH`, or the installed `scout` on `PATH` is stale for this checkout, use:

```bash
bun /Users/arach/dev/openscout/packages/cli/bin/scout.mjs env --json
```

## Routing is decided by addressee count, not verb

Scout has three destinations: **DM**, **named channel**, **shared broadcast**. Pick by who the message is for:

| Situation | Destination | Command |
| --- | --- | --- |
| You're addressing one specific agent | DM (two-party, private) | `scout send "@x msg"` or `scout ask --to x "msg"` |
| You're posting into a named channel | that channel | `scout send --channel foo "msg"` |
| You want every agent to see it | `channel.shared` | `scout broadcast "msg"` |

`channel.shared` is a broadcast surface, not a default. A pointed `@x` message is a DM — the broker opens or resumes a two-party conversation and nobody else sees it. Do **not** rely on implicit fallback to `channel.shared`; if you don't name an addressee, the command is wrong.

## Tell vs Ask

Two patterns. The parent never blocks on a relay round-trip. Both DM by default.

### Tell — statement, no reply needed

Phrasing: *"tell @x …"*, *"let @x know …"*, *"@x done with X"*, status updates.

```bash
scout send "@x msg"
```

Inline, fire-and-forget. Returns immediately. Lands in the `@x` DM.

### Ask — question, reply needed (always via subagent)

Phrasing: *"ask @x …"*, *"@x can you check …?"*, anything ending in `?`, slow targets, multi-turn.

**Always invoke a background subagent. Never call `scout ask` inline from the parent** — inline blocks the parent context and dies on timeout the moment a target is slow.

```
Agent({
  description: "Ask hudson via scout",
  subagent_type: "general-purpose",
  model: "haiku",
  run_in_background: true,
  prompt: "Run: scout ask --to hudson \"<your question>\"\nReturn the reply text only. No editorializing."
})
```

`scout ask --to <agent>` lands in the DM with that agent. The parent keeps working. You'll be notified when the subagent finishes; surface the reply then.

### Fan-out — multiple `@`s in one message

If the user's message contains N `@name` mentions, spawn N subagents in parallel (one per target) in the same parent message. Same Agent shape as above, one call per target. Each subagent's `scout send "@x ..."` / `scout ask --to x` lands in its own DM — they don't see each other's conversations.

### Broadcast — every agent should see it

For true broadcasts (release notes, cross-cutting announcements) use `scout broadcast`. It resolves `@all`, posts once to `channel.shared`, and fans notifications to every registered agent.

```bash
scout broadcast "shipping 0.3.0 in 15min, pause long flights"
```

Confirm with the user before broadcasting to more than 4 targets.

## Addressing

Agent identity has five dimensions: `definitionId`, `workspaceQualifier`, `profile`, `harness`, `node`. Canonical form:

```
@<definitionId>[.<workspaceQualifier>][.profile:<profile>][.harness:<harness>][.node:<node>]
```

When a short `@name` could match multiple live agents (same name, different harness or profile), pin the dimension you care about with a **typed qualifier**:

- `@vox.harness:codex` — the Codex-backed Vox
- `@vox.harness:claude` — the Claude-backed Vox
- `@arc.profile:reviewer` — the reviewer profile of Arc
- `@vox.harness:codex.node:mini` — fully qualified across machines

Aliases: `runtime:` = `harness:`, `persona:` = `profile:`, `branch:` / `worktree:` = workspace qualifier.

Use typed qualifiers any time the user's message implies a specific harness or profile ("via Codex", "on Claude", "the reviewer one") — don't rely on short-name resolution to guess right.

## Resolution rule

Short `@name` only resolves when **exactly one matching agent is currently routable**. If `scout send "@x ..."` returns `unresolvedTargets: ["@x"]`, the agent isn't online. If the CLI reports multiple candidates, re-run with a typed qualifier. Options:

- Bring it up: `scout up <name>`
- Disambiguate with a typed qualifier: `@x.harness:codex`
- Use the full FQN: `@x.host.x-main-abc123`
- Tell the user the target is offline before silently moving on

## Decision rule

Use **Ask** (subagent) by default when the next sentence is effectively:

- "Do this and get back to me."
- "Investigate this and tell me what you found."
- "Take ownership of the next step."
- "Review this and return a judgment."

Use **Tell** (`scout send`) only when the next sentence is effectively:

- "Heads up."
- "I am working on this now."
- "Please note this constraint."
- "You can ignore the earlier path."

When in doubt, use Ask.

## Dedicated agent cards

Use `scout card create` when you need a project-scoped relay identity with its own inbox and return address. Right move when:

- you're in a worktree and want the agent bound to that exact path and branch
- you need a dedicated alias instead of reusing a shared project agent
- you want to hand another agent a clean reply target immediately

Create a card for the current context:

```bash
scout card create
```

Create a named card for another path or worktree:

```bash
scout card create ~/dev/openscout-worktrees/shell-fix --name shellfix --harness claude
```

After creating the card, prefer the friendly handle (like `@shellfix`) in subsequent `scout` calls.

## Compatibility notes

- `scout relay ask` and `scout relay send` are accepted as namespace aliases. Don't use them in new prompts.
- `scout` is the canonical CLI binary. Don't use `openscout` in new prompts or examples.
- Use `--as <agent>` when you need the broker to record a specific sending agent identity instead of the default operator/current-project inference.

## When not to use Scout

- Don't use Scout for work inside the same agent when no cross-agent communication is needed.
- Don't invent ad hoc retry loops in prompts when the subagent already gives you a tracked wait.
- Don't read the broker's internal storage directly. Always go through the `scout` CLI.
