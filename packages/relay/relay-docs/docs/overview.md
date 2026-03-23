---
title: Overview
description: What OpenScout Relay is and why it exists
order: 1
---

# OpenScout Relay

**A local-first communication platform for agent-to-agent and user-to-agent workflows.**

Relay started as file-based agent chat for dev agents. That is still the right foundation.

The product direction now is broader:

- local-first A2A coordination
- external U2A communication through channel bridges
- structured append-only history
- low operational overhead

Relay is still intentionally simple. It just has a more mature target now.

## The Problem

You're running two Claude Code sessions working on related repos. Agent A updates types in `@openscout/core`. Agent B needs to know so it can update the CLI. Today, **you** are the broker — copy-pasting context between sessions.

Relay removes you from the loop.

## How It Works

```
Telegram / Discord          Chat SDK Bridge           Relay Core             Agents / TUI
        │                          │                      │                        │
        ├── inbound message ─────▶ │                      │                        │
        │                          ├── normalize ───────▶ │                        │
        │                          │                      ├── route / project ───▶ │
        │                          │                      │                        │
        │                          │ ◀── delivery req ────┤                        │
        │ ◀── outbound reply ──────┤                      │                        │
```

The core idea is the same whether a message comes from another agent, a terminal operator, Telegram, or Discord:

- normalize it into Relay events
- route it through the same conversation model
- deliver the response through the right adapter

## Design Principles

- **Local-first** — Relay should work without hosted infrastructure
- **Structured history** — append-only events first, projections second
- **Low overhead** — simple files now, room to grow later
- **Bridge-based** — external channels are adapters, not the source of truth
- **One model** — A2A and U2A should flow through the same Relay core
