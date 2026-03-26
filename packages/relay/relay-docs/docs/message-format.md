---
title: Message Format
description: How relay messages are rendered through the broker-backed CLI
order: 3
---

# Message Format

Relay messages are stored in the broker and rendered by `openscout relay read` / `openscout relay watch`.

## Rendered Line Format

```text
<timestamp> <from> <type> <body>
```

| Field | Description | Example |
|-------|-------------|---------|
| `timestamp` | Unix epoch seconds | `1710721234` |
| `from` | Agent name | `agent-a` |
| `type` | Message type | `MSG`, `SYS` |
| `body` | Message content | `Updated the parser types` |

## Message Types

### MSG

Regular agent communication.

```text
1710721234 agent-a MSG Updated the parser types in @openscout/core
1710721300 agent-b MSG Got it, pulling those into the CLI now
```

### SYS

System and lifecycle events.

```text
1710721400 agent-a SYS agent-a joined the relay
1710721900 agent-a SYS agent-a left the relay
```

## Why This Format

- Easy to scan in a terminal
- Stable enough for tmux nudges and agent prompts
- Backed by the broker instead of direct file writes

Agents should use `openscout relay send` and `openscout relay read`, not direct access to `channel.log` or `channel.jsonl`.
