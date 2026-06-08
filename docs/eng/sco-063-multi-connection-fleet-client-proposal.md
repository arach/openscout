# SCO-063: Multi-Connection Fleet Client

## Status

Proposed.

## Proposal ID

`sco-063`

## Intent

Let Scout (iOS) stay connected to **N paired Macs at once** and present them as **one
fleet** — "talk to each, coalesce" — with a top filter that scopes the view to All or a single
Mac. Do this entirely in the **iOS client layer**, with no change to the bridge transport or the
broker.

The primary target is not "connect to a different Mac." It is:

- hold a live connection to every connected Mac simultaneously,
- merge their sessions / agents / activity into one coalesced view,
- tag every row with the Mac it came from, so a filter can scope by machine,
- keep each Mac's broker the authoritative source for its own work (local-first, unchanged).

## Problem

Scout is **single-connection by construction.** There is one `AppModel.bridge:
BridgeBrokerClient`, and `var client { bridge }` (`AppModel.swift:122`). On connect,
`BridgeConnection.connect()` resolves exactly one Mac via
`currentTrustedBridge(preferredPublicKeyHex: nil)` — the most-recently-seen trusted bridge
(`BridgeConnection.swift:512, :529`). Every other paired Mac stays idle: it carries a last-seen
timestamp but never a live route, which is exactly why the Settings "Macs" list can only show the
others as "Paired."

So "multiple paired" ≠ "multiple connected." An operator running agents on a mini *and* a studio
sees only one at a time and must (today, implicitly) flip between them. There is no unified fleet
and no way to ask "what's running everywhere right now."

## Proposal

**The unit of multiplicity is the client, not the bridge.** `ScoutBrokerClient` is already a
*composition* of small capability protocols (`BrokerClient.swift:15`: SessionInitiation, Listing,
Tail, Conversation, Control, Comms), and every Scout surface consumes exactly one value —
`model.client`, handed in as `client:` in `RootView`. The bridge (Noise + WebSocket to one Mac) is
just the transport *under* a client.

So multi-Mac is not a transport problem. It is two pieces:

1. Hold **one `ScoutBrokerClient` per connected Mac.**
2. Put a **coalescing `ScoutBrokerClient` in front of them** that fans each read out to all N,
   merges the results, and tags each row with its source Mac.

Because the aggregate is *itself* a `ScoutBrokerClient`, nothing downstream changes type — the
surfaces never learn there is more than one Mac. The top filter just decides which client
`model.client` resolves to: the aggregate (All) or one Mac's client.

```
                         ┌─ BridgeBrokerClient(mac-mini) ── Noise/WS ─▶ mini
  surfaces ─ model.client ─ FleetClient ─┼─ BridgeBrokerClient(studio)   ── Noise/WS ─▶ studio
   (unchanged)        (a ScoutBrokerClient) └─ BridgeBrokerClient(laptop) ── Noise/WS ─▶ laptop
                              │
                    fan-out reads → coalesce + tag by machine
                    route per-entity / per-target ops to one client
```

One enabling detail: `currentTrustedBridge` already accepts a `preferredPublicKeyHex:` (always
`nil` today). Pinning a client to a *specific* Mac is a small change; the *simultaneous N* is the
new architecture.

### `FleetConnectionManager` — owns N clients

A `@MainActor @Observable` that replaces the single `bridge` with a set keyed by trusted-bridge
`publicKeyHex`:

- `connections: [MachineID: MachineConnection]`, where `MachineConnection = { client:
  BridgeBrokerClient, state: ConnectionState, route: TransportKind?, log: ConnectionLog }`.
- Per-Mac lifecycle: connect on entering the shell (or on demand), independent reconnect/backoff,
  teardown on forget. N WebSockets + N Noise sessions + N polls — fine for the realistic 2–4 Macs;
  the cost is bookkeeping, not throughput.
- Each `BridgeBrokerClient` is built against one Mac by passing its key through the now-used
  `preferredPublicKeyHex`, pinning *that* bridge instead of "most recent."

### `FleetClient` — the coalescing aggregate

A `ScoutBrokerClient` holding an ordered `[MachineConnection]` and an optional `focus: MachineID?`
(nil = All). Each capability resolves by one of three strategies:

| Capability | Strategy | Notes |
| --- | --- | --- |
| `ListingCapability` (sessions, agents, workspaces) | **coalesce** | fan out, await all, union, tag each row with `machineId`/`machineName`, sort. Partial failure ⇒ drop that Mac's slice, keep the rest — a down Mac never blanks the fleet. |
| `TailCapability` (event stream) | **merge** | interleave N streams into one, tag each event by machine. |
| `ConversationCapability` (one session's turns) | **route by provenance** | a session lives on one Mac → dispatch to that Mac's client (resolved from the row's `machineId`). Never coalesced. |
| `ControlCapability` (steer / queue an agent) | **route by provenance** | targets the agent's home Mac. |
| `CommsCapability` (channels / inbox) | **coalesce or focus** | open — broker comms may already be mesh-aware; default coalesce+tag, revisit. |
| `SessionInitiationCapability` (create / send-to-new) | **route by selection** | composer picks the target Mac. |
| `TerminalAccessProviding` (SSH/PTY) | **route by selection** | inherently one host. |

The headline insight: it is **not** "all reads coalesce, all writes target." It is *list/tail
coalesce; per-entity ops route by the entity's home Mac; creation + terminal route by explicit
selection.* Provenance is what makes per-entity routing free.

### Provenance / machine tagging

`AgentSummary` / `SessionSummary` (`Listing.swift`) gain optional `machineId: String?` +
`machineName: String?`. The aggregate stamps them as it merges; the underlying single-Mac clients
leave them nil. Rows, conversation routing, and the filter all read this tag. This is the only
shared-model change, and it is additive.

### The top filter = client selection (surfaces unchanged)

A machine selector at the top of the list surfaces — `[ All ][ mini ][ studio ]`, sourced from the
manager's connected Macs. Selecting sets `FleetClient.focus`; `All` clears it. Surfaces keep taking
one `client:` and re-query — they never branch on machine. (Mirrors
[SCO-046](./sco-046-cross-machine-agent-ui-spec.md)'s cross-machine UI.)

### Single-host operations (Terminal, composer)

- **Terminal** binds to a *chosen* Mac's `BridgeBrokerClient` (it is `TerminalAccessProviding`), not
  the aggregate. It follows the filter; if All is selected with >1 Mac it prompts for which Mac.
- **New/composer** already shows the target machine read-only; it becomes a **picker** over
  connected Macs (the session is created on the selected one), defaulting to the focused Mac.

### Status bar, counts, connection log

- Bottom-bar counts (`agentCount`, `activeAgentCount`) sum across connected clients; the machine
  count already comes from `pairedMachines`.
- Per-Mac `ConnectionLog`, so a flaky route on one Mac stays legible; Settings → Connection's Macs
  list shows each Mac's live route/state instead of one global line.

## Alternatives considered

- **Switch-active only** (one live, explicit switch via `preferredPublicKeyHex`). Much smaller, and
  worth doing as step 0 — but it does not meet the goal ("both at once"). Kept as the first rollout
  step, not the destination.
- **Broker/mesh-side fan-out** — a broker federates its peers and the phone talks to one. Pushes
  coalescing server-side, but adds cross-broker trust/federation and weakens the local-first stance
  (each Mac's broker should stay authoritative for its own work). Phone-side coalescing is simpler
  and keeps the brokers untouched. Rejected for now.
- **Per-Mac tabs / separate contexts** (N connections, no merge). Avoids the tagging work but
  defeats the "one fleet" goal — the operator is back to flipping. Rejected.
- **Multiplex N Macs over one bridge** (aggregate at the transport). Wrong layer — bridges are
  per-Mac Noise sessions; this is exactly the conflation the client framing avoids. Rejected.

## Rollout (incremental, each shippable)

0. **Switch-active** — thread `preferredPublicKeyHex` so tapping a Mac in the Settings list
   reconnects the *single* bridge to it. Still one-at-a-time, but explicit; de-risks key-pinning.
1. **`FleetConnectionManager`** — N live clients, per-Mac state/log/reconnect. `model.client` still
   resolves to one (focused) Mac. Proves concurrency + lifecycle, no coalescing yet.
2. **`FleetClient` coalescing** — aggregate Listing + Tail with machine tagging; `model.client`
   becomes the aggregate; counts sum; conversation/control route by provenance.
3. **Top filter** — the machine selector drives `focus`.
4. **Single-host binding** — Terminal + composer pick a target Mac.

## Open questions

- **Comms across Macs:** does each Mac's broker own distinct channels, or is comms already mesh-wide
  (so coalescing would double-count)? Decides whether Comms coalesces or scopes to focus.
- **Connect-all vs connect-on-demand:** hold all N live always, or connect a Mac lazily on first
  view? Battery/relay cost vs instant switching.
- **Failure surfacing in All mode:** a quiet per-Mac chip vs a fleet-level banner when one Mac is
  unreachable and the rest are fine.
- **Tag granularity:** `machineId` (publicKeyHex) is stable but ugly; `machineName` is friendly but
  can collide/restale. Likely carry both, key on id, display name.

## Non-goals

- No change to the bridge / Noise / tRPC transport, or to the broker. Entirely an iOS client-layer
  composition.
- Not macOS — it is co-located with one broker; multi-Mac coalescing is a remote-phone concern.

## Decision requested

Approve the **client-layer coalescing aggregate** (`FleetClient` + `FleetConnectionManager`, with
additive provenance tags on the summary models) as the path to simultaneous multi-Mac, and approve
the **staged rollout** starting at switch-active (step 0). Builds on
[SCO-061](./sco-061-native-app-shared-architecture-ios-macos-hudson.md).
