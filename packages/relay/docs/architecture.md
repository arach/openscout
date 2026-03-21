---
title: Architecture
description: How Relay works under the hood
order: 7
---

# Architecture

Relay started as a single append-only chat log for dev agents.

That was the right first move. It proved that local file-based communication works and that agent coordination does not need a server, daemon, or hosted queue.

Relay is now evolving into a more mature communication platform while keeping the same local-first, low-infra posture.

The short version:

- Relay stays local-first
- Relay stays file-backed
- Relay uses an append-only event stream as the source of truth
- Relay supports both agent-to-agent and user-to-agent communication
- External channels such as Telegram and Discord sit at the edge through Chat SDK bridges

## Working Model

Relay now has three layers:

1. **Core**
2. **Adapters**
3. **Surfaces**

### Core

The core owns the canonical event stream and the product model:

- conversations
- participants
- messages
- presence
- deliveries
- bindings to external channels

The core should not know about tmux, Claude, Vox, Telegram, or Discord details.

### Adapters

Adapters connect Relay to specific runtimes and transports:

- filesystem append/read/tail
- tmux
- Claude session nudging
- TTS and voice input
- Chat SDK bridges for Telegram and Discord

Adapters are edge concerns. They are not the system of record.

### Surfaces

Surfaces are the user-facing entry points:

- CLI
- TUI
- future web or native shells

All surfaces should read from the same Relay core rather than reimplementing parsing and storage logic.

## Canonical Storage

Relay is moving from a plain-text channel log to a canonical append-only event stream.

Today, the near-term storage model is:

```text
~/.openscout/relay/
  channel.jsonl        ← canonical structured event stream
  channel.log          ← human-readable compatibility mirror
  config.json          ← local configuration
```

The important rule is:

- `channel.jsonl` is the source of truth
- `channel.log` is a projection for humans and compatibility

This keeps Relay simple and inspectable while giving it enough structure to support richer routing and delivery behavior.

## Event Model

Relay should treat all major actions as typed append-only events.

Examples:

- `message.posted`
- `agent.state_set`
- `agent.heartbeat`
- `flight.opened`
- `flight.completed`
- `delivery.requested`
- `delivery.succeeded`
- `delivery.failed`
- `binding.upserted`

The point is not to make Relay complicated. The point is to avoid shared mutable sidecar files as the coordination mechanism.

## A2A and U2A

Relay is now aiming at two communication modes:

- **A2A**: agent-to-agent coordination inside Relay
- **U2A**: user-to-agent communication through external channels

Local A2A remains native Relay behavior.

U2A comes in through channel bridges. A Telegram or Discord message should be normalized into a Relay conversation event, routed through the same core model, and replied to through the same delivery flow.

## Chat SDK Bridges

Relay should use Chat SDK as the bridge layer for external communication channels.

That means:

- Chat SDK handles Telegram and Discord platform details
- Relay keeps the canonical conversation history and delivery intent
- external threads and channels are bound into Relay conversations

Chat SDK is not the source of truth for Relay history. It is the edge adapter that converts external traffic into Relay events and converts Relay outbound deliveries back into platform messages.

## Conversation Bindings

To support external channels cleanly, Relay needs a stable binding model between a Relay conversation and an external thread or channel.

A binding should answer:

- which Relay conversation this belongs to
- which platform it maps to
- which external thread or channel it represents
- whether the binding is active, paused, or archived

This lets Relay keep one internal model even when the source is local chat, Telegram, or Discord.

## Why Files Still Work

Relay still wants the advantages of the original design:

- zero hosted infra
- local inspectability
- append-only history
- low operational overhead

Structured files are enough for a long stretch of that journey.

If Relay eventually outgrows JSONL and moves to SQLite or another local database, that should be a storage implementation change, not a product-model rewrite.

## Projections

Relay should compute read models from the event stream rather than storing critical shared state in mutable JSON blobs.

Examples of projections:

- current conversation view
- current presence view
- current flight status
- current twin registry
- outbound delivery queue

These projections can be rebuilt from the canonical event stream.

## Runtime Pattern

The long-term runtime loop looks like this:

1. Append typed events to the canonical JSONL stream
2. Rebuild or incrementally update projections
3. Let adapters react to projection changes or explicit delivery requests
4. Render CLI and TUI surfaces from those projections

That keeps the system local and cheap while making the architecture more stable.

## Identity Resolution

Agent identity is still resolved in the same practical order:

```text
--as flag  →  OPENSCOUT_AGENT env  →  agent-<pid>
```

That remains fine for local-first agent workflows.

## What Relay Is Not Trying To Be

Relay is still intentionally opinionated:

- not a hosted chat service
- not a heavyweight workflow engine
- not a database-first product
- not a replacement for Discord or Telegram

It is the local communication substrate that lets agents and users talk through one normalized system.

## Near-Term Refactor Direction

The next credible code moves are:

1. Introduce a package-local Relay core with protocol, store, and projections.
2. Move CLI and TUI onto that shared core.
3. Treat `channel.log` as a derived compatibility mirror.
4. Replace mutable sidecar coordination with event-driven projections.
5. Add Chat SDK bridges for Telegram first, then Discord.

That path preserves the original spirit of Relay while making it a better foundation for both A2A and U2A communication.
