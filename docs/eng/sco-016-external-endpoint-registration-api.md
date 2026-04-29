# SCO-016: External Agent Registration API

## Status

Proposed.

## Context

SCO-015 introduces `pi-scout`, a pi extension that bridges pi sessions to Scout's broker for cross-harness coordination. For pi sessions to participate as Scout agents — both sending/receiving messages — they need to register with the broker.

Currently, only locally-invoked agents (relay via tmux, `invokeClaudeStreamJsonAgent`, etc.) self-register via `local-agents.ts`. External harnesses (pi, Codex, Claude Code when not launched via Scout) have no API to announce themselves.

## Problem

1. pi sessions cannot receive messages routed to them by other Scout agents
2. pi sessions cannot be discovered via `scout_who` as routable agents
3. External harnesses have no way to upsert their presence with the broker
4. The broker has `runtime.upsertEndpoint()` internally but no HTTP API for external harnesses to call it

## Proposal

Extend the broker daemon with HTTP routes that expose the existing internal registration APIs. This lets external harnesses (pi-scout, Codex via MCP, etc.) register as Scout agents.

### Routes to Add

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/endpoints` | Upsert an `AgentEndpoint` — delegates to `runtime.upsertEndpoint()` |
| `DELETE` | `/v1/endpoints/{id}` | Delete an endpoint — delegates to `runtime.deleteEndpoint()` |
| `GET` | `/v1/agent-cards` | List all `ScoutAgentCard` instances |
| `POST` | `/v1/agent-cards` | Upsert a `ScoutAgentCard` (computes `returnAddress` automatically) |

### Why agent cards?

`ScoutAgentCard` is richer than a raw endpoint — it includes `returnAddress`, `handle`, `selector`, `displayName`, `skills`, `projectRoot`, and other metadata that makes an agent routable and discoverable. Rather than making callers assemble all fields manually, `POST /v1/agent-cards` accepts a partial card and computes the full structured return address via `buildScoutReturnAddress()`.

The existing `buildScoutAgentCard()` in `scout-agent-cards.ts` already handles local agent bindings. We extend it to handle external harnesses too.

## API Design

### `POST /v1/endpoints`

Register or update an `AgentEndpoint`. Delegates to existing `runtime.upsertEndpoint()`.

**Request body:** `AgentEndpoint` (full record as defined in protocol)

**Response:**
```typescript
interface UpsertEndpointResponse {
  ok: boolean;
  endpoint: AgentEndpoint;
}
```

### `DELETE /v1/endpoints/{id}`

Deregister an endpoint (e.g. on session end). Delegates to `runtime.deleteEndpoint()`.

**Response:**
```typescript
interface DeleteEndpointResponse {
  ok: boolean;
}
```

### `GET /v1/agent-cards`

List `ScoutAgentCard` instances for all registered agents. Uses `buildScoutAgentCard()` internally.

**Response:**
```typescript
interface ListAgentCardsResponse {
  cards: ScoutAgentCard[];
}
```

### `POST /v1/agent-cards`

Register or update a full agent card. Accepts a partial card; computes `returnAddress` via `buildScoutReturnAddress()`.

**Request body:** `Partial<ScoutAgentCard>` — caller provides identity fields, broker fills in the rest.

**Response:**
```typescript
interface UpsertAgentCardResponse {
  ok: boolean;
  card: ScoutAgentCard;
}
```

## Implementation

### Broker Daemon

Add to `broker-daemon.ts` route handler:

```typescript
// POST /v1/endpoints
if (method === "POST" && url.pathname === "/v1/endpoints") {
  const endpoint: AgentEndpoint = await parseJson(request);
  const result = await runtime.upsertEndpoint(endpoint);
  respondJson(res, { ok: true, endpoint: result });
}

// DELETE /v1/endpoints/{id}
if (method === "DELETE" && url.pathname.startsWith("/v1/endpoints/")) {
  const id = decodeURIComponent(url.pathname.slice("/v1/endpoints/".length));
  await runtime.deleteEndpoint(id);
  respondJson(res, { ok: true });
}

// GET /v1/agent-cards
if (method === "GET" && url.pathname === "/v1/agent-cards") {
  const cards = await buildAllScoutAgentCards(runtime);
  respondJson(res, { cards });
}

// POST /v1/agent-cards
if (method === "POST" && url.pathname === "/v1/agent-cards") {
  const card: Partial<ScoutAgentCard> = await parseJson(request);
  const result = await upsertScoutAgentCard(runtime, card);
  respondJson(res, { ok: true, card: result });
}
```

### Runtime (broker.ts)

`runtime.upsertEndpoint()` and `runtime.deleteEndpoint()` already exist. No runtime changes needed for endpoints.

### scout-agent-cards.ts

Add two functions:

```typescript
export async function upsertScoutAgentCard(
  runtime: InMemoryControlRuntime,
  card: Partial<ScoutAgentCard>,
): Promise<ScoutAgentCard> {
  // 1. Resolve or create AgentDefinition from card.id / card.agentId
  // 2. Upsert the agent definition in runtime
  // 3. Upsert endpoint from card.endpoint fields
  // 4. Return full card built via buildScoutAgentCard(binding, { brokerRegistered: true })
}

export async function buildAllScoutAgentCards(
  runtime: InMemoryControlRuntime,
): Promise<ScoutAgentCard[]> {
  // For local bindings: use existing buildScoutAgentCard()
  // For external agents registered via POST /v1/agent-cards:
  //   reconstruct from registry.agents + registry.endpoints
}
```

## Security Considerations

External endpoint registration should be restricted to local Unix socket connections. The socket is already restricted to localhost, and the runtime directory is `0700`. No additional auth needed for local extensions.

HTTP connections (mesh/web) should be authenticated via the mesh's existing auth mechanism.

## Backwards Compatibility

Pure addition — no existing APIs change. External agents that don't register simply won't appear as routable agents.

## References

- SCO-015: Pi-Scout Integration
- `packages/protocol/src/scout-agent-card.ts` — `ScoutAgentCard`, `buildScoutReturnAddress()`
- `packages/runtime/src/scout-agent-cards.ts` — `buildScoutAgentCard()`
- `packages/runtime/src/broker.ts` — `runtime.upsertEndpoint()`, `runtime.deleteEndpoint()`
- `packages/runtime/src/broker-daemon.ts` — route handler patterns
