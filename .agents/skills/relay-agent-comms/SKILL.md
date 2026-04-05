---
name: relay-agent-comms
description: Use OpenScout Relay for broker-native agent communication. Trigger this when an agent needs to ask another agent for work, wait for a reply, send a non-blocking message, or avoid legacy relay-send mistakes.
metadata:
  short-description: Broker-native agent asks and replies
---

# relay-agent-comms

Use this skill when you need to communicate with another OpenScout agent.

## Core Rule

Prefer explicit broker-tracked asks over ambient shared-channel chatter.

Before your first Scout command in a fresh shell, resolve the command surface once:

```bash
scout env --json
```

If `scout` is not on `PATH`, use the fallback command from `scout env` or:

```bash
bun /Users/arach/dev/openscout/apps/scout/bin/scout.ts env --json
```

- Use `scout ask --to ...` when you need a reply or completion.
- Use `scout send --as ... "@target ..."` only for lightweight non-blocking messages.

## Primary Commands

Blocking ask:

```bash
scout ask --to talkie --as plexus "Port the real keyboard, not the simplified rewrite."
```

Non-blocking message:

```bash
scout send --as plexus "@talkie Heads up: I’m reviewing your last patch now."
```

Voice/human-facing message:

```bash
scout speak --as scout "Here’s what I found."
```

## What `ask` Means

`scout ask --to <agent>` is the default for agent-to-agent work.

It:
- creates a broker-tracked ask
- waits on the broker flight
- prints status while the target is working
- exits only on completion or failure

If the work matters, use `ask`.

## What `send` Means

`scout send` is for communication, not guaranteed completion.

Use it for:
- heads-up messages
- status notes
- lightweight coordination
- human-readable replies that do not require waiting

## Rules

- Always include `--as <agent>` when speaking as a specific agent.
- Do not use positional target syntax like `scout send talkie "..."`.
- If targeting an agent with `send`, include an explicit `@mention` in the message body.
- Do not assume a chat message means the work completed. Completion comes from `ask` returning successfully.
- Prefer `ask` over `send` whenever the other agent is expected to write code, inspect files, or bring back a real answer.
- Prefer short project-root agent names like `talkie` or `hudson` for `--to` and `@mentions`.
- Only switch to a fully qualified agent id when multiple live agents share the same short name and you need to disambiguate.
- Avoid shell interpolation like `"${OPENSCOUT_AGENT:-codex}"` unless you truly need it. The CLI already resolves `OPENSCOUT_AGENT` by default.
- If a command appears to hang with no output, check for broken quoting or an unterminated shell expansion before debugging Relay or PATH.

## Decision Rule

Use `ask` by default when the next sentence is effectively:

- "Do this and get back to me."
- "Investigate this and tell me what you found."
- "Take ownership of the next step."
- "Review this specific thing and return a judgment."

Use `send` only when the next sentence is effectively:

- "Heads up."
- "I am working on this now."
- "Please note this constraint."
- "You can ignore the earlier path."

If there is any doubt, use `ask`.

## Recommended Patterns

Ask another agent to do work:

```bash
scout ask --to talkie --as plexus "Inspect ~/dev/plexus/... and fix the recording path."
```

Ask and wait longer:

```bash
scout ask --to talkie --as plexus --timeout 900 "Take another pass on the keyboard port."
```

Send a quick follow-up without blocking:

```bash
scout send --as plexus "@talkie Please focus on UIKit touch handling, not a SwiftUI rewrite."
```

## Dedicated Agent Cards

Use `scout card create` when you need a dedicated project-scoped relay identity with its own inbox and return address.

This is the right move when:
- you are in a worktree and want the agent bound to that exact path and branch
- you need a dedicated alias instead of reusing a shared project agent
- you want to hand another agent a clean reply target immediately

Create a card for the current context:

```bash
scout card create
```

Create a named card for another path or worktree:

```bash
scout card create ~/dev/openscout-worktrees/shell-fix --name shellfix --harness claude --as arc
```

The resulting card gives you:
- the friendly handle, like `@shellfix`
- the canonical selector and default selector
- the broker-backed inbox conversation
- the structured return address used for replies

After creating the card, prefer using the handle or selector from the card in later `scout ask` and `scout send` calls.

Compatibility note:
- `scout relay ask ...` and `scout relay send ...` are accepted as namespace aliases.
- `scout` is the canonical CLI binary. Do not use `openscout` in new prompts or examples.

## When Not To Use Relay

- Do not use Relay for work inside the same agent when no cross-agent communication is needed.
- Do not use legacy file-log assumptions (`channel.log`, `channel.jsonl`) as the source of truth.
- Do not invent ad hoc retry loops in prompts when `relay ask --to ...` already gives you a tracked wait.

## Operating Heuristic

If you would otherwise say:

- "please do this and get back to me"
- "stay on this until it’s done"
- "tell me what you found"

then use `scout ask --to ...`.
