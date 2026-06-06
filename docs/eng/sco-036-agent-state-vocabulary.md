# SCO-036: Agent State Vocabulary

## Status

Proposed.

## Proposal ID

`sco-036`

## Intent

Replace the current three-state agent vocabulary (`offline` / `available` / `working`) with a richer set that carries real meaning. `available` today is the everything-else bucket — any agent whose raw state is not literally `"offline"` and isn't currently running a flight gets labelled "available," regardless of whether it has a fresh heartbeat, has capacity, or can actually take new work.

This proposal defines a new vocabulary, the signals that drive each state, and how the existing surfaces should adopt it. It does not yet redesign any surfaces — that lives downstream in the agent-presentation work (see [[sco-037-agent-presentation]] when written).

## Problem

Both ends of the stack treat agent state as a three-state enum and bucket anything not actively executing into `available`.

**Server side** — `packages/web/server/db/internal/sql-helpers.ts:71`:

```ts
function summarizeAgentState(rawState, isWorking, wakePolicy): AgentSummaryState {
  if (isWorking) return "working";
  if (rawState === "offline" && wakePolicy === "on_demand") return "available";
  return rawState && rawState !== "offline" ? "available" : "offline";
}
```

**Client side** — `packages/web/client/lib/agent-state.ts:3`:

```ts
function normalizeAgentState(state: string | null): AgentDisplayState {
  if (state === "working") return "working";
  if (!state || state === "offline") return "offline";
  return "available"; // everything else
}
```

The downstream effect:

- An agent whose endpoint last reported 3 hours ago appears `available` next to one that pinged 5 seconds ago.
- An agent at its concurrency limit appears `available` next to a truly idle one.
- An agent currently subscribed to a channel and actively listening for an `@mention` looks identical to one that has never joined.
- An agent that just failed three turns in a row looks identical to one whose last turn succeeded.

When users glance at a fleet list, "available" carries no information. When users pick an agent to ask, the list does not help them rank. When a router routes by state, it has nothing useful to route on.

## Decision

OpenScout SHOULD adopt a five-state vocabulary keyed on signals we already have or can cheaply derive:

| State       | When                                                             | Tone   |
| ----------- | ---------------------------------------------------------------- | ------ |
| `offline`   | No endpoint, or last endpoint heartbeat older than the reachability expiry TTL and no `on_demand` wake policy | neutral / dim |
| `wakeable`  | No live endpoint, but `wake_policy` says we can summon one      | neutral / faint accent |
| `idle`      | Live endpoint (heartbeat ≤ fresh TTL), no in-flight work, capacity remaining | ready / muted accent |
| `engaged`   | Live endpoint, no in-flight work, but listening on at least one channel/DM or has unread pings | ready / accent |
| `working`   | At least one in-flight flight (`running` / `waking` / `waiting` / `queued`) | active / strong accent |

Two additional modifiers ride on top of the base state (not separate states; they decorate `idle` / `engaged` / `working`):

- `saturated` — in-flight count at the agent's configured concurrency limit. Visible as a small chip; on `working` this hides any "send another ask" affordance.
- `degraded` — most recent N turns failed, or harness signalled a recoverable error. Visible as a warning marker.

### Signal sources

All available in the schema today:

- **Endpoint heartbeat** — `agent_endpoints.updated_at`. Define `FRESH_HEARTBEAT_TTL_MS = 90s` (one std broker tick + slack) and `REACHABILITY_EXPIRY_TTL_MS = 10m`.
- **Wake policy** — `agents.wake_policy`. `on_demand` agents can come back from offline via a wake; show `wakeable` rather than `offline`.
- **In-flight flights** — `flights.state IN ('running', 'waking', 'waiting', 'queued')` per `ACTIVE_FLIGHT_STATES_SQL` in `sql-helpers.ts:102`. `ACTIVE_FLIGHT_MAX_AGE_MS = 24h` caps lookback.
- **Channel membership / pings** — `conversation_participants` join + recent `messages` with audience.notify or mentions targeting this agent.

To add (out of scope for v1, sketched for `saturated` / `degraded`):

- **Concurrency limit** — likely belongs on `agents.metadata_json` (`maxConcurrentFlights` default 1). v1 can hard-code 1 for non-router agents.
- **Recent turn outcome** — derive from last K flights' final `state` (`completed` / `failed`). 3-of-3 failures or 1 hard failure flips `degraded`.

### Migration

- Add `AgentSummaryState = "offline" | "wakeable" | "idle" | "engaged" | "working"` to `db/types/*` and `lib/types.ts`.
- Rewrite `summarizeAgentState` to honour heartbeat freshness, wake policy, listening state, and in-flight work. Sketch:

  ```ts
  function summarizeAgentState({
    rawState, isWorking, wakePolicy,
    endpointUpdatedAt, isListening, now,
  }): AgentSummaryState {
    if (isWorking) return "working";
    const ageMs = endpointUpdatedAt ? now - endpointUpdatedAt : Infinity;
    const fresh = ageMs <= FRESH_HEARTBEAT_TTL_MS;
    if (!fresh) {
      if (wakePolicy === "on_demand") return "wakeable";
      return "offline";
    }
    return isListening ? "engaged" : "idle";
  }
  ```

- Rewrite client `normalizeAgentState` to pass through the new vocabulary (server is authoritative; client falls back to `offline` for unknown values).
- Surfaces already using `AgentDisplayState` ("offline" / "available" / "working") will type-error after the swap. That's the point: each call site needs to decide which of the new states it cares about.
- Persist the mapping `available → idle` for one release to give external consumers a window. Compatibility shim lives in `lib/agent-state.ts`.

### Modifiers

- Add `AgentModifier = "saturated" | "degraded"`.
- Server surfaces a `modifiers: AgentModifier[]` field next to `state` on the projection. Empty on day one.
- v1.0: ship without modifiers (5 base states only). Modifier wiring follows in a small follow-up after concurrency-limit metadata + recent-outcome derivation land.

## Non-Goals

- No change to the database schema. All signals already exist in `agent_endpoints` / `agents` / `flights` / `conversation_participants` / `messages`.
- No change to the broker protocol or transport. State remains a derived projection, not a transmitted field.
- No presentation work in this SCO. Tone hints are advisory; the actual color/dot/density choices land in the agent-presentation SCO.
- No change to routing / auto-assignment logic. Router-side use of richer state is a separate proposal.

## Open Questions

- **`engaged` vs `idle` granularity.** Is "currently subscribed to a channel" enough to be engaged, or do we require recent unread/mention activity? Lean: subscribed-and-fresh-heartbeat is enough; add a `lastActivityAt` field on the projection so callers can sort within.
- **TTL values.** `FRESH_HEARTBEAT_TTL_MS = 90s` is a guess. Right answer depends on the broker's tick cadence and the harness types — codex sessions ping more often than tmux scrapes. May need per-source TTL.
- **`saturated` source of truth.** Concurrency limit could live in `agents.metadata_json` (per-agent override) or be derived from `agentClass` (per-class default). Probably both.
- **`degraded` window.** Last 3 turns? Last hour? Configurable per harness? Start with last-3-turns and iterate.
- **Sort key change.** With richer states, the natural sort becomes `working > engaged > idle > wakeable > offline`, with `lastActivityAt` as tiebreaker. Surfaces that sort by raw state ranks today (`STATE_RANK` in `LeftPanel.tsx:60`) need updating. Define the rank table here so all surfaces share it.

## Reference

- Server derivation: `packages/web/server/db/internal/sql-helpers.ts:71-83`
- Client derivation: `packages/web/client/lib/agent-state.ts:3-15`
- Active flight states constant: `packages/web/server/db/internal/sql-helpers.ts:102`
- Surfaces touched by `AgentDisplayState`: `AgentsScreen`, `MissionControlView`, `MeshCanvas`, `ChannelsScreen`, `ConversationScreen`, `RecentAgentsSection` (`BaseLeftRail`), `AgentsInspector`, `MeshInspector`, `useAgentHoverCard`, `OpsAgentsView`, `PlanArchiveView`, `PlanView`, `RailRow` (via tone)
