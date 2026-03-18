---
title: Agent Guide
description: How to instruct AI agents to use the relay
order: 6
---

# Agent Guide

This page explains how to set up Claude Code sessions (or any AI agents) to use Relay for inter-agent communication.

## The Setup Prompt

When you start a Claude Code session that should participate in the relay, include instructions like this in your initial prompt:

```
You are agent-a working on the @openscout/core package.

There is a relay channel at .openscout/relay/channel.log that other
agents are watching. Use it to coordinate:

- To send a message: openscout relay send --as agent-a "your message"
- To check for messages: openscout relay read
- To watch live: openscout relay watch --as agent-a

When you complete a significant change that other agents need to know
about, send a relay message describing what changed and any actions
they should take.

Check the relay before starting work to see if other agents have
sent relevant context.
```

## What to Tell Agents to Communicate

Good relay messages are **actionable and specific**:

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
```
You are agent-a working on @openscout/core.
Relay is set up at .openscout/relay/channel.log.

Task: Refactor the Scout interface to support async tools.

When done, send a relay message so agent-b can update the CLI.
Use: openscout relay send --as agent-a "<your message>"
```

**Terminal 2 — Agent B (CLI package):**
```
You are agent-b working on the openscout CLI.
Relay is set up at .openscout/relay/channel.log.

Check the relay first: openscout relay read

Wait for agent-a to finish the type refactor, then update the CLI
to use the new async interface. Check relay periodically with:
  openscout relay read --since <last-timestamp>
```

### With Tmux Auto-Nudge

For fully autonomous operation, add a watcher that nudges each agent:

**Terminal 3 — Control pane:**
```bash
# Nudge agent-a's pane when agent-b sends a message
openscout relay watch --as watcher --tmux 0 &

# Nudge agent-b's pane when agent-a sends a message
openscout relay watch --as watcher --tmux 1 &
```

Now when agent-a sends a message, agent-b gets nudged automatically — no human in the loop.

## Workflow: Handoff Pattern

One agent finishes a task and hands off to the next:

```bash
# Agent A finishes and hands off
openscout relay send --as agent-a "Types refactored. All exports updated. agent-b: you can start the CLI migration now"

# Agent B picks it up
openscout relay send --as agent-b "Starting CLI migration. Will message when done."

# Agent B finishes
openscout relay send --as agent-b "CLI migration complete. All tests passing. Ready for release."
```

## Tips

1. **Use descriptive agent names** — `core-agent` and `cli-agent` are better than `agent-a` and `agent-b`
2. **Include file paths** — "Updated `src/types.ts`" is more useful than "Updated the types"
3. **Send on significant events** — Don't spam. Send when something another agent needs to act on happens
4. **Read before starting** — Always have agents check the relay for context before beginning work
5. **Keep messages under 200 chars** — They need to fit in a tmux nudge preview
