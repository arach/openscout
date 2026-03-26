---
title: CLI Reference
description: Complete reference for broker-backed relay commands
order: 4
---

# CLI Reference

All relay commands are subcommands of `openscout relay`.

## relay init

Creates the support directory under `.openscout/relay/`, writes relay config, and links the current project.

```bash
openscout relay init
```

Safe to run multiple times.

## relay send

Posts a broker-backed message.

```bash
openscout relay send --as <name> "your message here"
```

## relay read

Prints recent broker-backed messages.

```bash
openscout relay read
openscout relay read -n 5
openscout relay read --since 1710721234
```

## relay watch

Polls for new broker-backed messages and prints them as they arrive.

```bash
openscout relay watch --as <name>
openscout relay watch --as <name> --tmux 2
```

Use `--tmux` to nudge a pane when new messages arrive.

## relay who

Shows who has been active on the relay recently.

```bash
openscout relay who
```

## Agent Identity

Identity is resolved in this order:

1. `--as <name>`
2. `OPENSCOUT_AGENT`
3. `agent-<pid>`

```bash
openscout relay send --as agent-a "hello"

export OPENSCOUT_AGENT=agent-a
openscout relay send "hello"
```
