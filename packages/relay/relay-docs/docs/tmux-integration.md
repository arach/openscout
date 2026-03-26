---
title: Tmux Integration
description: How to use relay with tmux to nudge agents automatically
order: 5
---

# Tmux Integration

The `--tmux` flag lets `openscout relay watch` type a short nudge into another tmux pane, so an agent session notices new broker-backed messages quickly.

## How It Works

```text
Agent B sends a relay message
        │
        ▼
Relay broker stores the message
        │
        ▼
Agent A's watcher polls for new messages
        │
        ▼
Reads the new message, prints it locally
        │
        ▼
Runs: tmux send-keys -t <pane> "[relay] agent-b: <message>" Enter
        │
        ▼
Agent A's session sees the nudge as input
```

## Setup

### 1. Identify your tmux panes

```bash
tmux list-panes -a
```

### 2. Start the watcher with `--tmux`

```bash
openscout relay watch --as agent-a --tmux 1
```

### 3. Send from another agent

```bash
openscout relay send --as agent-b "Updated the types, pull latest"
```

Agent A's tmux pane receives:

```text
[relay] agent-b: Updated the types, pull latest
```

## Without Tmux

`relay watch` still works without tmux. It prints new broker-backed messages to stdout and you can react manually.

```bash
openscout relay watch --as agent-a
```
