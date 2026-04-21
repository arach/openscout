# Scout And A2A

This document states how Scout currently relates to the A2A protocol.

Scout has read A2A and uses it as an adjacent reference point. Scout is not trying to rebrand itself as an A2A implementation, and Scout does not proactively implement A2A until there is product pressure to do so. The goal is simpler:

- avoid concept conflicts
- reuse compatible language where it helps
- make the correspondence obvious to future readers

## Position

Scout is a local-first coordination substrate. A2A is an interoperability protocol.

Scout keeps its own internal mechanics where they add real value:

- broker-owned routing and persistence
- `invocation` plus `flight` rather than one overloaded execution noun
- `question` and `work_item` as first-class collaboration semantics
- explicit delivery planning, bindings, and authority routing across nodes

At the same time, Scout intentionally overlaps with A2A in discovery-oriented vocabulary where the concepts are genuinely close:

- provider metadata
- skills
- interface descriptions
- security hints
- artifacts as durable outputs

## Term Mapping

| A2A Term | Scout Term | Note |
|---|---|---|
| `AgentCard` | `ScoutAgentCard` | Similar discovery role, but Scout's card can also carry Scout-local routing/runtime hints. |
| `Message` | `MessageRecord` | Close correspondence. |
| `Task` | `InvocationRequest` + `FlightRecord` | Scout intentionally splits request from execution lifecycle. |
| `Artifact` | `artifact` / durable artifact record | Scout treats artifacts as durable outputs, not ordinary chat turns. |
| skills / interfaces / auth | optional discovery fields on `ScoutAgentCard` | Added for future-friendly correspondence, not as a protocol commitment. |

## What Scout Does Not Claim

Scout does not claim that:

- every agent must be defined by Scout
- every agent must speak Scout's protocol
- every boundary in the system is owned by Scout
- Scout's internal nouns must be renamed to match A2A one-for-one

Scout is meant to play well with agents, frameworks, and protocols at its periphery.

## Current Practical Rule

If a new Scout concept would collide directly with an A2A concept, prefer one of these:

1. use a Scout-qualified name such as `ScoutAgentCard`
2. keep the Scout-native term and document the mapping explicitly
3. reserve the exact A2A term for the actual A2A wire shape

That keeps the repo readable today and makes future A2A work cheaper if users eventually ask for it.
