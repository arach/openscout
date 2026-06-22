# Glossary

This document is the definitive meaning of Scout's core nouns.

Scout is aware of adjacent standards such as A2A, but these definitions are for Scout itself. When Scout intentionally overlaps with A2A terminology, that is noted explicitly rather than implied.

## Core Terms

| Term | Meaning In Scout | A2A Relationship |
|---|---|---|
| `broker` | The local canonical writer for routing, durable state, and event streams. | Scout-specific. |
| `runtime` | The layer that starts, resumes, stops, and health-checks sessions across harnesses. | Scout-specific. |
| `harness` | The execution backend for a session, such as Codex or Claude. | Roughly analogous to an implementation choice behind an A2A agent, not an A2A core noun. |
| `agent` | A durable autonomous target Scout can address. The agent may be defined outside Scout. | Broadly compatible. |
| `@scoutbot` | The conversational assistant handle for the human operator. Friendly UI may call it Scout; use `@scoutbot` when routing, mentioning, or disambiguating it from platform Scout. | Scout-specific assistant identity. |
| `endpoint` | A route/binding from one agent identity to a session, transport, and node. | Roughly analogous to an advertised interface endpoint. |
| `session` | A concrete runtime context, such as a harness conversation or process, which may or may not be live now. | Scout-specific. |
| `Scout address` | Scout's canonical routing address for an agent target, including qualifiers such as workspace, harness, and node when needed. | Richer than A2A identity. |
| `ScoutAgentCard` | Scout's local discovery card for one addressable agent target. It may include provider, skills, interfaces, and security hints; route state belongs to endpoints and diagnostics. | Overlaps intentionally with A2A `AgentCard`, but is not the A2A wire shape. |
| `chat` | The user-facing communication place where Scout-owned messages live. Internally this is a conversation record; product surfaces use an opaque Chat ID. See [`chat-model.md`](./chat-model.md). | Broadly compatible with A2A conversation/thread context. |
| `conversation` | An addressable communication boundary such as a channel, DM, or thread. | Broadly compatible with A2A conversation/thread context. |
| `message` | A durable communicative turn in a conversation. | Broadly compatible with A2A `Message`. |
| `invocation` | Scout's explicit request for work. | Closest A2A analog is `Task` request. |
| `flight` | The tracked execution lifecycle of one invocation. | Closest A2A analog is task run/state progression. |
| `delivery` | A planned transport-specific fan-out for a message or invocation. | Scout-specific. |
| `binding` | A mapping between a Scout conversation and an external thread or channel. | Scout-specific integration term. |
| `question` | A lightweight information-seeking collaboration record. | Richer than base A2A messaging. |
| `work_item` | A durable owned execution record with progress, waiting, review, and done states. | Richer than base A2A task semantics. |
| `artifact` | A durable published output linked back to work and execution where possible. | Broadly compatible with A2A `Artifact`. |
| `helper` | A session-bound assistant acting on behalf of a person inside Scout's actor model. | Scout-local term, not a required interop concept. |

## Naming Rules

1. Scout-specific mechanics keep Scout-specific names when they express real differences in model or behavior.
2. Exact A2A terms should only be reused when the meaning is intentionally close.
3. When Scout uses a richer internal model than A2A, the docs should say so directly instead of hiding the distinction.
4. Legacy terms such as `relay` and `pairing` are historical or compatibility language, not the preferred canonical vocabulary.

## Discovery Rule

If you are looking for the one place where discovery-oriented information should converge in Scout, start with `ScoutAgentCard`. That is the right place for provider, skills, interface hints, documentation links, and security hints, even when Scout is not proactively implementing A2A.
