# OpenScout Control Protocol

`@openscout/protocol` defines the new local communication/control model for OpenScout.

This package is intentionally not named `relay` and does not carry the old `twin`
terminology forward. The core model is:

- people
- helpers
- agents
- conversations
- messages
- invocations
- flights
- deliveries
- bindings

## Why A New Protocol

The older Relay model proved that local, inspectable communication works. It also
mixed a few distinct concerns:

- chat messages
- wakeup signals
- runtime nudges
- agent invocation

The new control protocol separates those concerns while keeping the same local-first
spirit:

- a local broker is the only writer
- storage stays file-based through SQLite
- all durable state is represented as typed records and events
- transport adapters sit at the edge

## Identity Model

The important distinction is between a helper and an agent:

- `person`: the actual human identity
- `helper`: a session-bound assistant working on behalf of a person
- `agent`: a durable autonomous player with its own identity and capabilities
- `system`: runtime-owned internal identity
- `bridge`: external platform adapter identity
- `device`: a concrete endpoint such as a native app client or speaker session

This lets a person work with a helper in Codex or Claude while still invoking real
agents as first-class targets.

## Core Design Rules

1. A message is conversation.
2. An invocation is work.
3. A flight is the tracked lifecycle of that work.
4. Delivery is planned explicitly per target and transport.
5. Voice is metadata and transport, not the canonical message body.

## Storage Model

The runtime package owns the SQLite schema, but the high-level model is:

- `actors`
- `agents`
- `agent_endpoints`
- `conversations`
- `conversation_members`
- `messages`
- `message_mentions`
- `message_attachments`
- `invocations`
- `flights`
- `deliveries`
- `delivery_attempts`
- `bindings`
- `events`

SQLite is the canonical store because it keeps the system local and inspectable while
solving append races, indexing, leases, retries, and subscriptions better than raw
JSONL.

## Conversation vs Invocation

### Conversation

Conversation is human-readable history:

- channels
- direct messages
- group direct messages
- threads
- system conversations

Conversation state is designed for:

- visibility
- unread tracking
- mentions
- search
- auditability

### Invocation

Invocation is a request for action:

- consult an agent
- execute a task
- summarize state
- change mode
- ping or wake

Invocations create flights. Flights can stream progress and complete independently of
the chat surface they came from.

## Delivery Model

Each authored message exists once. Delivery fans out into typed intents.

The runtime plans deliveries separately for:

- visibility
- notifications
- explicit invocations
- external bridges
- speech playback

That means a message can be:

- visible to a whole channel
- notified only to a mentioned subset
- invoked against one or two agents
- bridged to Telegram or webhooks
- spoken on one voice-enabled device

without duplicating the message body.

## Modalities

The protocol supports multiple modalities, but text remains canonical.

- HTTP: commands, admin, webhook intake
- WebSocket: subscriptions, streaming flight updates, typing/presence
- local socket: trusted local clients such as the native app and CLI
- bridges: Telegram, Discord, telecom adapters
- voice: transcripts, playback directives, media references

Raw media does not belong in the primary message log. The protocol stores transcript,
speech, and attachment metadata while media transport stays on a dedicated transport.

## Migration Direction

The control protocol replaces Relay as the core architecture.

Any remaining Relay-specific tools are outside the control-plane contract and
should be treated as separate utilities, not as canonical storage or runtime
paths.
