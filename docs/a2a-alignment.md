# Scout And A2A

This document states how Scout currently relates to the A2A protocol.

Scout uses A2A as the main external agent interoperability reference point.
OpenScout's internal control-plane model remains Scout-native, but the broker
now has concrete A2A primitives at the boundary:

- A2A-style external agent-card intake
- A2A agent-card serving for the local broker and per-agent routes
- JSON-RPC `SendMessage`, `GetTask`, `ListTasks`, `CancelTask`, and
  `GetExtendedAgentCard`
- legacy slash-method compatibility for existing frameworks such as
  `message/send`
- Scout flight to A2A task projection

This is not yet a full A2A conformance claim. Streaming, push notifications,
authenticated extended cards, active cancellation, production security controls,
and formal conformance tests remain open. See
[`protocol-readiness-a2a-acp.md`](./protocol-readiness-a2a-acp.md) for the
current readiness matrix.

The goal is:

- avoid concept conflicts
- reuse compatible language where it helps
- make the correspondence obvious to future readers
- expose real A2A wire shapes at the interoperability boundary

## Position

Scout is a local-first coordination substrate. A2A is an interoperability protocol.

Scout keeps its own internal mechanics where they add real value:

- broker-owned routing and persistence
- `invocation` plus `flight` rather than one overloaded execution noun
- `question` and `work_item` as first-class collaboration semantics
- explicit delivery planning, bindings, and authority routing across nodes

At the same time, Scout intentionally overlaps with A2A in discovery-oriented
vocabulary where the concepts are genuinely close:

- provider metadata
- skills
- interface descriptions
- security hints
- artifacts as durable outputs

## Term Mapping

| A2A Term | Scout Term | Note |
|---|---|---|
| `AgentCard` | `ScoutAgentCard` | Similar discovery role. Scout's internal card can also carry Scout-local routing/runtime hints; A2A endpoints project it to the A2A wire shape. |
| `Message` | `MessageRecord` / `InvocationRequest.task` | A2A inbound text messages become Scout invocations for work-style requests. |
| `Task` | `FlightRecord` | A2A tasks are projected from Scout flight lifecycle state. Scout still keeps the original `InvocationRequest` separately. |
| `Artifact` | `FlightRecord.output` / future durable artifacts | Text output maps to A2A text artifacts today. Rich artifact persistence is still future work. |
| skills / interfaces / auth | fields on `ScoutAgentCard` and A2A projection | Skills and interfaces are projected. A2A-specific auth policy is not implemented yet. |

## What Scout Does Not Claim

Scout does not claim that:

- every agent must be defined by Scout
- every agent must speak Scout's protocol
- every boundary in the system is owned by Scout
- Scout's internal nouns must be renamed to match A2A one-for-one
- current A2A streaming, push notification, security, and conformance
  requirements are complete

Scout is meant to play well with agents, frameworks, and protocols at its periphery.

## Current Practical Rule

If a new Scout concept would collide directly with an A2A concept, prefer one of these:

1. use a Scout-qualified name such as `ScoutAgentCard`
2. keep the Scout-native term and document the mapping explicitly
3. reserve the exact A2A term for the actual A2A wire shape

That keeps the repo readable today and makes future A2A work cheaper if users eventually ask for it.
