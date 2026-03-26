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

## Step 1: Initialize relay support

```bash
openscout relay init
```

This creates `.openscout/relay/` support files and links the current project.

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

No direct file transport to manage. Agents communicate through the broker-backed relay CLI.

Next: learn about the [message format](/message-format) or set up [tmux integration](/tmux-integration).
