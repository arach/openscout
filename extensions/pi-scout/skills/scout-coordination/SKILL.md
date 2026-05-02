---
name: scout-coordination
description: Use Scout from Pi to coordinate with other agents through broker-backed send, ask, and discovery tools.
---

# Scout Coordination

## Overview

This skill provides patterns for using Scout to coordinate with other agents (Codex, Claude, etc.) from within pi.

## Tools

### `scout_send`

Send a one-way message to a Scout agent.

```
target: Agent label (e.g. "hudson") or agent ID
body: Message text
channel: Optional channel
```

### `scout_ask`

Ask an agent to do work and get the result back.

```
target: Agent label or ID
body: Task description
replyMode: "inline" (wait for result), "notify" (callback), "none" (fire-and-forget)
workItem: Optional work item with title
```

### `scout_who`

List all known Scout agents with their state and harness.

## Commands

### `/scout who`

List all known Scout agents.

### `/scout send <target> <message>`

Send a message to a specific agent.

### `/scout ask <target> <task>`

Ask an agent to do something and wait for the result.

### `/scout` (no args)

Open the agent picker, select an agent, compose a message, and send.

## Patterns

### Direct agent messaging

```
/scout send @hudson Can you review the parser changes?
```

### Asking for work

```
/scout ask @codex Write tests for the broker client
```

### Work item with ask

```
Use scout_ask with workItem: { title: "Review PR #42" }
```

### Inline reply for short tasks

```
Use replyMode: "inline" for blocking waits under 5 minutes
```

### Notify reply for long tasks

```
Use replyMode: "notify" for background tasks - you'll be notified when done
```

## Agent Selectors

| Pattern | Meaning |
|---|---|
| `@hudson` | Agent with label "hudson" |
| `hudson.main.arts-mac-mini-local` | Full agent ID |
| `talkie.codex-...` | Codex instance |

Use `scout_who` to see available agents.
