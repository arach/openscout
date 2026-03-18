---
title: Tmux Integration
description: How to use relay with tmux to nudge agents automatically
order: 5
---

# Tmux Integration

The `--tmux` flag is what makes Relay work for fully autonomous agent-to-agent communication. It types messages directly into another tmux pane — so a Claude Code session sees the message as user input.

## How It Works

```
Agent B sends a message
        │
        ▼
channel.log gets a new line
        │
        ▼
Agent A's watcher (fs.watch) detects the change
        │
        ▼
Reads the new line, prints it locally
        │
        ▼
Runs: tmux send-keys -t <pane> "[relay] agent-b: <message>" Enter
        │
        ▼
Agent A's Claude Code session sees the message as input
```

## Setup

### 1. Identify your tmux panes

```bash
tmux list-panes -a
```

Note the pane IDs (e.g., `%0`, `%1`) or use the simpler index format (`0`, `1`, `2`).

### 2. Start the watcher with --tmux

```bash
# In Agent A's session, watch and nudge pane 1
openscout relay watch --as agent-a --tmux 1
```

### 3. Send from another agent

```bash
# In Agent B's session
openscout relay send --as agent-b "Updated the types, pull latest"
```

Agent A's tmux pane receives:

```
[relay] agent-b: Updated the types, pull latest
```

This appears as if a user typed it into Agent A's Claude Code session.

## Recommended Tmux Layout

A typical 3-pane setup:

```
┌─────────────────────┬─────────────────────┐
│                     │                     │
│    Agent A          │    Agent B          │
│    (Claude Code)    │    (Claude Code)    │
│                     │                     │
│    pane 0           │    pane 1           │
│                     │                     │
├─────────────────────┴─────────────────────┤
│  Watcher / Control pane                   │
│  pane 2                                   │
└───────────────────────────────────────────┘
```

In the control pane, run both watchers:

```bash
# Watch for agent-a, nudge pane 0
openscout relay watch --as watcher-a --tmux 0 &

# Watch for agent-b, nudge pane 1
openscout relay watch --as watcher-b --tmux 1 &
```

Or keep it simpler — run the watcher in each agent's own session and nudge the other pane.

## What the Nudge Looks Like

For a regular message:
```
[relay] agent-b: Updated the parser types in @openscout/core
```

For a system event:
```
[relay] agent-a joined the relay
```

Long messages are truncated to 80 characters with an ellipsis.

## Without Tmux

If you're not using tmux, `relay watch` still works — it just prints messages to stdout. You'd need to manually check the output or use `relay read` to catch up.

```bash
# Still works, just no auto-nudge
openscout relay watch --as agent-a
```
