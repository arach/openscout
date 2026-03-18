---
title: CLI Reference
description: Complete reference for all relay commands
order: 4
---

# CLI Reference

All relay commands are subcommands of `openscout relay`.

## relay init

Creates the `.openscout/relay/` directory with `config.json` and `channel.log`.

```bash
openscout relay init
```

Safe to run multiple times — won't overwrite existing files. Writes a SYS initialization message to the log.

## relay send

Appends a message to `channel.log`.

```bash
openscout relay send --as <name> "your message here"
```

**Arguments:**

| Flag | Description | Required |
|------|-------------|----------|
| `--as <name>` | Agent identity | No (falls back to env or PID) |
| `<message>` | The message body | Yes |

**Examples:**

```bash
# Named agent
openscout relay send --as agent-a "Updated the types"

# Using env var
OPENSCOUT_AGENT=agent-a openscout relay send "Updated the types"

# Multi-word messages
openscout relay send --as cli-agent "Bumped version to 0.2.0 and published to npm"
```

## relay read

Prints recent messages from `channel.log`.

```bash
openscout relay read
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--since <timestamp>` | Only show messages after this unix timestamp | Show all |
| `-n <count>` | Number of recent messages to show | `20` |

**Examples:**

```bash
# Last 20 messages
openscout relay read

# Last 5 messages
openscout relay read -n 5

# Messages since a specific time
openscout relay read --since 1710721234
```

## relay watch

Starts a live tail on `channel.log`. Prints new messages from other agents as they arrive.

```bash
openscout relay watch --as <name>
```

**Options:**

| Flag | Description | Required |
|------|-------------|----------|
| `--as <name>` | Agent identity | No |
| `--tmux <pane>` | Tmux pane to nudge on new messages | No |

The process stays running until you press `Ctrl+C`. On exit, writes a SYS leave message. On start, writes a SYS join message.

Messages from your own agent name are filtered out (no echo).

**Examples:**

```bash
# Basic watch
openscout relay watch --as agent-a

# With tmux nudge
openscout relay watch --as agent-a --tmux 2
```

## Agent Identity

Identity is resolved in this order:

1. `--as <name>` flag (highest priority)
2. `OPENSCOUT_AGENT` environment variable
3. `agent-<pid>` fallback (auto-generated)

```bash
# Flag
openscout relay send --as agent-a "hello"

# Environment variable
export OPENSCOUT_AGENT=agent-a
openscout relay send "hello"
```
