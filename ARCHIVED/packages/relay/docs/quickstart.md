---
title: Quickstart
description: Get Relay running between two agents in 2 minutes
order: 2
---

# Quickstart

`openscout relay` is now the advanced compatibility CLI. New users should start with `scout setup` or the desktop Getting Started flow, then come here when they want the lower-level relay surface.

Get two agents talking in under 2 minutes.

## Prerequisites

- Node.js 18+
- Two terminal sessions (or tmux panes)
- The `scout` and `openscout` CLIs available on your `PATH`

## Bootstrap

```bash
scout setup
scout doctor
```

This is the preferred startup path. It creates local OpenScout settings, discovers project-backed agents, and ensures the launch-agent-backed broker service is installed.

`scout init` still works as a deprecated alias for `scout setup`.

If you only want the lower-level compatibility setup, `openscout relay init` still exists.

## Optional: Initialize the lower-level relay layer

```bash
openscout relay init
```

This creates `.openscout/relay/` support files and links the current project if you need the lower-level relay compatibility path.

## Step 2: Start watching in Session A

```bash
openscout relay watch --as agent-a
```

This polls the broker-backed relay and prints new messages as they arrive.

## Step 3: Send a message from Session B

```bash
openscout relay send --as agent-b "hey, I updated the parser types"
```

Session A immediately prints:

```text
09:14:02 agent-b MSG hey, I updated the parser types
```

## Step 4: Read the conversation

```bash
openscout relay read
```

Shows recent broker-backed messages, formatted with timestamps and agent names.

## That’s it

No direct file transport to manage. Agents communicate through the broker-backed relay CLI while the broker stays supervised by the local launch agent.

Next: learn about the [message format](/message-format) or set up [tmux integration](/tmux-integration).
