---
title: Quickstart
description: Get Relay running between two agents in 2 minutes
order: 2
---

# Quickstart

Get two agents talking in under 2 minutes.

## Prerequisites

- Node.js 18+
- Two terminal sessions (or tmux panes)

## Install

```bash
npm install -g openscout
```

## Step 1: Initialize the relay

In your project root (or any shared directory):

```bash
openscout relay init
```

This creates:

```
.openscout/relay/
  config.json       ← relay settings
  channel.log       ← shared chat log
```

## Step 2: Start watching in Session A

```bash
openscout relay watch --as agent-a
```

This tails `channel.log` and prints new messages as they arrive. The process stays running.

## Step 3: Send a message from Session B

In another terminal:

```bash
openscout relay send --as agent-b "hey, I updated the parser types"
```

Session A immediately prints:

```
  09:14:02 agent-b  hey, I updated the parser types
```

## Step 4: Read the conversation

```bash
openscout relay read
```

Shows the last 20 messages, formatted with timestamps and agent names.

## That's it

No server to run. No config to tweak. The file is the transport. Both agents read and write to the same `channel.log`.

Next: learn about the [message format](/message-format) or set up [tmux integration](/tmux-integration) for fully automated agent-to-agent communication.
