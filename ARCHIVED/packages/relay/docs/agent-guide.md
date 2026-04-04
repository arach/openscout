---
title: Agent Guide
description: How to instruct AI agents to use the broker-backed relay
order: 6
---

# Agent Guide

Relay is now broker-backed. Agents should communicate through `openscout relay`, not by reading or writing `channel.log` or `channel.jsonl` directly.

## The Setup Prompt

When you start a Claude Code session that should participate in Relay, use instructions like this:

```text
You are agent-a working on the @openscout/core package.

There is a broker-backed relay available through the openscout CLI.
Use it to coordinate with other agents:

- To send a message: openscout relay send --as agent-a "your message"
- To check recent context: openscout relay read
- To see who is active: openscout relay who

Do not read or write channel.log or channel.jsonl directly.

When you complete a significant change that other agents need to know
about, send a relay message describing what changed and any actions
they should take.

Check the relay before starting work to see if other agents have
sent relevant context.
```

## What to Tell Agents to Communicate

Good relay messages are actionable and specific:

```bash
# Good — specific, actionable
openscout relay send --as agent-a "Renamed UserConfig to AgentConfig in src/types.ts — update your imports"

# Good — status update with context
openscout relay send --as agent-a "Published @openscout/core@0.3.0 to npm — breaking change: run() is now async"

# Bad — too vague
openscout relay send --as agent-a "Made some changes"
```

## Workflow: Two Agents, One Project

### Scenario: Agent A works on types, Agent B works on CLI

**Terminal 1 — Agent A (core package):**

```text
You are agent-a working on @openscout/core.

Task: Refactor the Scout interface to support async tools.

When done, send a relay message so agent-b can update the CLI.
Use: openscout relay send --as agent-a "<your message>"
```

**Terminal 2 — Agent B (CLI package):**

```text
You are agent-b working on the openscout CLI.

Check the relay first: openscout relay read

Wait for agent-a to finish the type refactor, then update the CLI
to use the new async interface. Check relay periodically with:
  openscout relay read --since <last-timestamp>
```

### With Tmux Auto-Nudge

For autonomous operation, add a watcher that nudges each agent:

**Terminal 3 — Control pane:**

```bash
# Watch for agent-a, nudge pane 0
openscout relay watch --as watcher --tmux 0 &

# Watch for agent-b, nudge pane 1
openscout relay watch --as watcher --tmux 1 &
```

## Workflow: Handoff Pattern

```bash
# Agent A finishes and hands off
openscout relay send --as agent-a "Types refactored. All exports updated. agent-b: you can start the CLI migration now"

# Agent B picks it up
openscout relay send --as agent-b "Starting CLI migration. Will message when done."

# Agent B finishes
openscout relay send --as agent-b "CLI migration complete. All tests passing. Ready for release."
```

## Tips

1. Use descriptive agent names.
2. Include file paths and concrete change details.
3. Send on significant events, not every small edit.
4. Read before starting to pick up current context.
5. Keep messages short enough to fit cleanly in a tmux nudge preview.
