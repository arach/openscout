---
title: Message Format
description: The IRC-inspired line format for relay messages
order: 3
---

# Message Format

Every message is a single line in `channel.log`. Plain text, human-readable, `cat`-able.

## Line Format

```
<timestamp> <from> <type> <body>
```

| Field | Description | Example |
|-------|-------------|---------|
| `timestamp` | Unix epoch seconds | `1710721234` |
| `from` | Agent name | `agent-a` |
| `type` | Message type | `MSG`, `ACK`, `SYS` |
| `body` | Message content | `Updated the parser types` |

## Message Types

### MSG — Regular message

The primary message type. One agent communicating with others.

```
1710721234 agent-a MSG Updated the parser types in @openscout/core
1710721300 agent-b MSG Got it, pulling those into the CLI now
```

### ACK — Read receipt

Acknowledges a specific message by referencing its timestamp.

```
1710721256 agent-b ACK 1710721234
```

### SYS — System event

Lifecycle events: joins, leaves, initialization.

```
1710721400 agent-a SYS agent-a joined the relay
1710721900 agent-a SYS agent-a left the relay
```

## Raw Log Example

```bash
$ cat .openscout/relay/channel.log

1710721200 agent-a SYS agent-a initialized the relay
1710721234 agent-a MSG Updated the parser types in @openscout/core
1710721256 agent-b SYS agent-b joined the relay
1710721260 agent-b MSG Got it, pulling those into the CLI now
1710721300 agent-a MSG Tests are passing, you're good to go
1710721350 agent-b MSG Done. CLI updated and published
1710721400 agent-b SYS agent-b left the relay
```

## Formatted Output

When displayed via `relay read` or `relay watch`, messages are formatted with readable timestamps:

```
  09:13:20 ∙ agent-a initialized the relay
  09:14:02 agent-a  Updated the parser types in @openscout/core
  09:14:16 ∙ agent-b joined the relay
  09:14:20 agent-b  Got it, pulling those into the CLI now
  09:15:00 agent-a  Tests are passing, you're good to go
  09:15:50 agent-b  Done. CLI updated and published
  09:16:40 ∙ agent-b left the relay
```

System messages are dimmed. Agent names are bold. Timestamps are `HH:MM:SS` local time.

## Why This Format?

- **One line per message** — easy to `tail -f`, `grep`, `wc -l`
- **Unix timestamps** — sortable, filterable, timezone-agnostic
- **Plain text** — no JSON parsing needed, works with any unix tool
- **Append-only** — safe for concurrent writers (filesystem handles atomicity for short lines)
