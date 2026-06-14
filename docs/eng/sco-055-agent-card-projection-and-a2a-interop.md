# SCO-055: Agent Card Projection And A2A Interop

## Status

Proposed.

## Proposal ID

`sco-055`

## Intent

Define how Scout should project its local `ScoutAgentCard` model into external
agent-card shapes, including A2A-style discovery, without renaming Scout's
internal model or replacing broker-owned routing.

The borrowed idea is an agent card served at a well-known location with
capabilities, endpoints, security metadata, and skills. The Scout version treats
cards as discovery and routing descriptions. Work still enters Scout as
messages, invocations, flights, and deliveries.

## Context

Scout already has:

- [`docs/a2a-alignment.md`](../a2a-alignment.md), which states that Scout is a
  local-first coordination substrate and A2A is an interoperability protocol
- `ScoutAgentCard` in `@openscout/protocol`
- [`sco-018`](./sco-018-a2a-aligned-agent-manpages.md), which renders agent
  manpages from card fields
- external endpoint registration in [`sco-016`](./sco-016-external-endpoint-registration-api.md)

The next useful layer is projection. Scout can expose its agents to external
clients and consume external agents more cleanly if it has a small boundary that
maps between Scout-local cards and adjacent card formats.

## Decision

Scout SHOULD introduce explicit card projections.

A card projection is a derived external view of a Scout-owned or observed agent
card. It is not the canonical identity record. It records:

- source card id
- target format
- endpoint URL or transport
- projected skills and interfaces
- security requirements
- freshness and provenance
- known lossy fields

Scout MAY later serve A2A-compatible cards for selected agents and MAY consume
A2A-compatible cards as observed external agents. Both paths should pass through
the projection layer.

## Principles

1. `ScoutAgentCard` remains the canonical local card.
2. Use A2A-compatible vocabulary for fields that truly correspond.
3. Keep Scout routing fields Scout-local.
4. Treat external cards as discovery input, not as trusted authority by default.
5. Preserve lossy projection warnings.
6. Do not claim full A2A implementation until Scout actually supports the wire
   behavior required by that protocol.
7. Make card refresh and signature/trust state visible without treating the
   durable card itself as stale.

## Projection Record

```ts
export interface ScoutAgentCardProjection {
  id: ScoutId;
  source:
    | { kind: "scout_card"; cardId: ScoutId }
    | { kind: "external_card"; url: string; format: ScoutAgentCardProjectionFormat };
  targetFormat: ScoutAgentCardProjectionFormat;
  projectedAt: number;
  expiresAt?: number;
  status: "current" | "refresh_required" | "failed" | "unsupported";
  url?: string;
  trust: ScoutAgentCardTrust;
  lossyFields: string[];
  warnings: string[];
  body: unknown;
}
```

```ts
export type ScoutAgentCardProjectionFormat =
  | "scout"
  | "a2a_agent_card"
  | "mcp_server_manifest"
  | "custom";
```

```ts
export interface ScoutAgentCardTrust {
  source: "local_broker" | "mesh_peer" | "external_url" | "operator_import";
  verified: boolean;
  verification?: "none" | "local_broker" | "mesh_trust" | "signature" | "pinned_key";
  verifiedAt?: number;
  issuer?: string;
  warnings?: string[];
}
```

## Scout To A2A-Style Projection

The projection SHOULD map fields conservatively:

| Scout field | A2A-style field | Notes |
| --- | --- | --- |
| `displayName` | `name` | Human-readable identity. |
| `description` | `description` | Purpose text. |
| `provider` | `provider` | Compatible shape when present. |
| `version` | `version` | Optional. |
| `documentationUrl` | `documentationUrl` | Optional. |
| `skills` | `skills` | Discovery metadata only unless the endpoint supports skill invocation. |
| `defaultInputModes` | `defaultInputModes` | Pass through when known. |
| `defaultOutputModes` | `defaultOutputModes` | Pass through when known. |
| `supportedInterfaces` | protocol-specific endpoints | Only expose externally reachable interfaces. |
| `securitySchemes` | `securitySchemes` | Omit Scout-local secret locations that cannot project safely. |
| `securityRequirements` | `security` | Preserve only compatible requirements. |

Scout-local fields such as `handle`, `selector`, `defaultSelector`,
`projectRoot`, `currentDirectory`, `harness`, `transport`, `sessionId`,
`inboxConversationId`, and `returnAddress` should not leak into strict external
cards unless wrapped in a Scout extension namespace.

## External Card Intake

When consuming an external agent card, Scout SHOULD create an observed external
agent entry rather than pretending the remote agent is Scout-owned.

The intake flow:

1. Fetch or import the card.
2. Validate basic schema and endpoint reachability.
3. Record provenance, freshness, and trust state.
4. Project compatible fields into a `ScoutAgentCard`-like observed card.
5. Register a routable external endpoint only if the operator or policy allows
   it.
6. Route work through a protocol adapter, not by copying remote task state into
   Scout's internal tables.

## Well-Known Serving

For selected local agents, Scout MAY expose card projections at stable local or
mesh URLs:

```plaintext
/.well-known/openscout/agents/<agent-id>/card.json
/.well-known/agent-card.json
```

The first path is Scout-native and can expose Scout extensions. The second
should be reserved for a strict external protocol card when Scout supports the
required semantics.

Local-only developer pilots can serve these from the broker or mesh front door.
Public internet serving should require an explicit operator choice.

## Work Routing Boundary

Agent cards describe reachability and capability. They do not execute work.

In Scout:

- a card can help resolve an agent
- a message records conversation
- an invocation records requested work
- a flight records execution lifecycle
- a delivery records transport fan-out

If an external protocol models work as a single task object, Scout should map it
at the boundary rather than collapse its internal records.

## Security And Trust

Projection should surface:

- whether the card is local, mesh, or external
- whether a signature or pinned key verified
- whether endpoint URLs point outside local or mesh trust boundaries
- which credentials or headers are required
- which fields were omitted because they are Scout-local or unsafe

Unsigned external cards can still be useful in a high-trust pilot, but they
should be labeled as unverified.

## Non-Goals

- renaming `ScoutAgentCard` to `AgentCard`
- implementing the full A2A wire protocol in this proposal
- treating remote protocol task state as Scout-owned flight state without an
  adapter
- exposing local project paths or session ids in public cards by default
- building enterprise trust policy
- requiring all Scout agents to publish external cards

## Implementation Sequence

1. Add projection types and lossy-field reporting to `@openscout/protocol`.
2. Add a pure `ScoutAgentCard -> A2A-style card` mapper with fixtures.
3. Add a pure `external card -> observed Scout card` mapper with trust metadata.
4. Add broker read endpoints for local Scout card projections.
5. Add CLI inspection:
   - `scout card project <agent> --format a2a`
   - `scout card inspect <url>`
6. Add optional local well-known serving behind an explicit flag.
7. Add route adapters only after projection and trust labels are correct.

## Acceptance Criteria

- Scout can project a local `ScoutAgentCard` into an A2A-style card without
  leaking Scout-local routing fields.
- The projection reports fields it omitted or transformed.
- External cards are recorded with provenance and trust state.
- Scout docs continue to distinguish Scout cards from A2A wire cards.
- No work execution semantics change as part of card projection.

## Relationship To Other Docs

- [`docs/a2a-alignment.md`](../a2a-alignment.md) defines Scout's A2A posture.
- [`sco-018`](./sco-018-a2a-aligned-agent-manpages.md) defines human-readable
  card rendering.
- [`sco-016`](./sco-016-external-endpoint-registration-api.md) defines external
  endpoint registration.
- [`sco-040`](./sco-040-capability-registry-and-tool-boundaries.md) defines
  capability metadata that card skills may point at.
