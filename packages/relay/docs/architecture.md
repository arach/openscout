---
title: Architecture
description: How Relay works under the hood
order: 7
---

# Architecture

Relay is intentionally simple. Understanding the internals takes about 2 minutes.

## The Transport: A Single File

```
.openscout/relay/channel.log
```

That's it. One append-only text file. Every agent reads from it and writes to it.

There is no server, no socket, no message queue. The filesystem handles concurrency — short line appends to a file are atomic on all major operating systems.

## Detection: fs.watch

When `relay watch` runs, it uses Node's `fs.watch()` to monitor `channel.log` for changes. On each change event:

1. Check if file size grew (ignore truncations)
2. Read only the new bytes (seek to last known position)
3. Parse new lines
4. Filter out messages from self (no echo)
5. Print to stdout
6. Optionally run `tmux send-keys` to nudge a pane

## Nudge: tmux send-keys

The tmux integration is a single `execSync` call:

```bash
tmux send-keys -t <pane> "[relay] agent-b: <message preview>" Enter
```

This types text into a tmux pane as if a user typed it. For Claude Code sessions, this means the agent sees it as a new user message.

Messages longer than 80 characters are truncated with an ellipsis to keep nudges readable.

## Identity Resolution

Agent name is resolved in order:

```
--as flag  →  OPENSCOUT_AGENT env  →  agent-<pid>
```

The PID fallback ensures every process has a unique identity even without explicit naming.

## File Structure

```
.openscout/
  relay/
    config.json          ← metadata (creation time, agent list)
    channel.log          ← the single shared channel
```

Config is minimal and mostly for future use. The log file is the only thing that matters.

## Concurrency Model

Relay uses a **last-writer-wins, append-only** model:

- Writers append single lines (atomic on POSIX for lines under PIPE_BUF, typically 4096 bytes)
- Readers track byte position and only read new content
- No locking, no coordination
- Messages are naturally ordered by write time

This works because:
- Messages are independent (no transactions)
- Lines are short (well under 4096 bytes)
- The channel is low-throughput (agents, not users)
- Append-only means no data loss

## What's NOT in Relay

Intentionally omitted to keep things simple:

- **No encryption** — it's local files on your machine
- **No authentication** — any process can write to the log
- **No message deletion** — append-only, forever
- **No multiple channels** — one channel per relay (for now)
- **No persistence layer** — the file IS the persistence
- **No network** — filesystem only
