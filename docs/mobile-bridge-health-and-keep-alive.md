# Mobile Bridge Health + Keep Alive

## Goal

Design two related systems:

1. A non-fragile way for the iOS app to determine whether the user's Mac is actually offline.
2. A real Mac-side keep-awake subsystem that can support Amphetamine-style "extra keep alive please" behavior.

This document is the implementation spec to build against.

## Core Principles

- Pairing trust and bridge health are separate concerns.
- One weak failure signal must not produce an "offline" conclusion.
- Tailscale reachability is the first machine-liveness check.
- Bridge health is a second layer above machine reachability.
- Keep alive must be an explicit Mac-side capability, not prompt wording.
- Keep alive should use leases, not a single global boolean.
- The safest implementation path is layered: baseline first, advanced toggles after.

## Current Baseline

### iOS connection behavior

- The app shows pairing only when `hasTrustedBridge == false`.
- Ordinary reconnect failures do not currently unpair the user.
- The coarse behavior today is that one socket drop or one RPC timeout can immediately force reconnect logic.

Relevant files:

- [ContentView.swift](/Users/arach/dev/openscout/apps/ios/Scout/App/ContentView.swift)
- [ConnectionManager.swift](/Users/arach/dev/openscout/apps/ios/Scout/Services/ConnectionManager.swift)

### Existing broker wake behavior

- `ensureAwake: true` exists on invocations.
- That currently means "wake or start the agent endpoint if needed."
- It does not mean "prevent the Mac from sleeping."

Relevant files:

- [packages/protocol/src/invocations.ts](/Users/arach/dev/openscout/packages/protocol/src/invocations.ts)
- [apps/desktop/src/core/broker/service.ts](/Users/arach/dev/openscout/apps/desktop/src/core/broker/service.ts)
- [packages/runtime/src/broker.ts](/Users/arach/dev/openscout/packages/runtime/src/broker.ts)
- [packages/runtime/src/broker-daemon.ts](/Users/arach/dev/openscout/packages/runtime/src/broker-daemon.ts)

### Existing Tailscale hooks

- The runtime already reads Tailscale peer data.
- The pairing relay already knows how to use Tailscale DNS names and certificates.

Relevant files:

- [packages/runtime/src/tailscale.ts](/Users/arach/dev/openscout/packages/runtime/src/tailscale.ts)
- [apps/desktop/src/core/pairing/runtime/relay-runtime.ts](/Users/arach/dev/openscout/apps/desktop/src/core/pairing/runtime/relay-runtime.ts)
- [packages/protocol/src/mesh.ts](/Users/arach/dev/openscout/packages/protocol/src/mesh.ts)

## Part 1: Bridge Health Model

### Problem

The iOS app currently makes health decisions from transport failures that are too weak on their own:

- WebSocket stream ended
- one RPC timeout
- reconnect loop exhausted

Those events are useful, but they are not enough to conclude "Mac offline."

### Design

Keep pairing trust separate from bridge health.

Pairing trust:

- `paired`
- `unpaired`

Bridge health:

- `healthy`
- `suspect`
- `degraded`
- `offline`

### Health Evidence

Track these timestamps and counters in `ConnectionManager`:

- `lastSuccessfulRPCAt`
- `lastIncomingMessageAt`
- `lastConnectedAt`
- `lastBridgeProbeSuccessAt`
- `lastMachineProbeSuccessAt`
- `lastResolveSuccessAt`
- `lastResolve404At`
- `lastForegroundAt`
- `consecutiveRPCTimeouts`
- `consecutiveTransportDrops`
- `consecutiveBridgeProbeFailures`
- `consecutiveMachineProbeFailures`

### Probe Layers

#### Layer 1: machine probe

The primary liveness signal is a Tailscale-path probe to the Mac.

This should not shell out to `tailscale ping` on iOS.
Instead, the iOS app should probe a fast health endpoint on the Mac using the machine's Tailscale-reachable address or MagicDNS hostname.

Proposed endpoint:

- `GET /healthz`

Return shape:

```json
{
  "ok": true,
  "ts": 1760000000000,
  "hostName": "mbp",
  "bridgeVersion": "x.y.z",
  "nodeId": "node_123",
  "tailnetName": "example.ts.net"
}
```

Machine probe means:

- the Mac is reachable on the tailnet
- the Scout desktop/bridge HTTP surface is alive enough to answer

#### Layer 2: bridge probe

Use a lightweight authenticated bridge RPC or HTTP route to verify the bridge is actually responsive, not just the host.

Examples:

- `bridge.status`
- a very small `mobile/ping`

Bridge probe means:

- Scout bridge process is responsive
- app-level request path is healthy

### State Transitions

#### `healthy -> suspect`

Any one of:

- one WebSocket close
- one RPC timeout
- foreground resume with no recent success yet

Do not show "offline" here.
Reconnect in the background.

#### `suspect -> healthy`

Any one of:

- machine probe success
- bridge probe success
- normal RPC success
- inbound event/message received

#### `suspect -> degraded`

Require multiple failures over a short window, for example:

- 2+ machine or bridge probe failures within 20-30 seconds
- repeated RPC timeout plus reconnect failure

UI should say reconnecting / temporarily unavailable, not offline.

#### `degraded -> offline`

Require strong evidence, for example:

- repeated machine probe failures over a longer window
- repeated reconnect exhaustion
- `resolveRoom() == 404` plus failed machine probe

`resolveRoom() == 404` is stronger evidence than generic network failure and should weigh heavily.

#### `degraded/offline -> healthy`

Any successful machine or bridge probe should aggressively recover state.

### Hysteresis Rules

- On app foreground, wait a grace period before showing `offline`.
- Do not move to `offline` from a single failure.
- Recover quickly on success.
- Keep the user in the logged-in shell for `suspect`, `degraded`, and `offline` as long as trust still exists.

### UI Mapping

- `healthy`: normal connected UI
- `suspect`: subtle reconnecting indicator
- `degraded`: "Trying to reach your Mac"
- `offline`: "Your Mac is probably offline or asleep"

Do not use "Not paired" unless trust is actually gone.

## Part 2: Keep Alive Model

### Problem

The system currently has wake/start behavior for agent endpoints, but no explicit concept of keeping the Mac awake.

The user request implies two classes of behavior:

- default background resilience while work is active
- explicit "max level" keep alive before leaving the house

### Design

Add a Mac-side `KeepAliveManager` owned by the desktop host layer.

Suggested location:

- `apps/desktop/src/app/host/keep-alive.ts`

This manager owns keep-alive leases and adapter-specific execution of sleep-prevention mechanisms.

### Keep Alive Lease

```ts
type KeepAliveStrength = "normal" | "strong" | "max";

type KeepAliveLease = {
  id: string;
  source: "manual" | "heuristic" | "session_policy";
  requester: "ios" | "desktop" | "broker";
  reason: string;
  strength: KeepAliveStrength;
  startedAt: number;
  expiresAt?: number;
  options: KeepAliveOptions;
};
```

### Keep Alive Options

```ts
type KeepAliveOptions = {
  preventIdleSystemSleep: boolean;
  preventIdleDisplaySleep: boolean;
  allowClosedDisplay: boolean;
  enablePowerProtectFallback: boolean;
  autoExtendWhileWorkIsActive: boolean;
  autoDisableWhenIdle: boolean;
  requireExternalPowerForClosedDisplay: boolean;
};
```

### Strength Presets

#### `normal`

- wake/start agent as needed
- prevent idle system sleep while active work exists
- auto disable when idle

#### `strong`

- everything in `normal`
- longer lease
- auto extend while work remains active
- optional display sleep prevention, but off by default

#### `max`

- everything in `strong`
- optional closed-display mode
- optional Power Protect-style fallback
- explicit duration
- visible in status UI

### Mechanism Layers

#### Layer 1: system sleep assertion

Baseline and default.

Use a native assertion equivalent to:

- prevent idle system sleep

This is the safest and most general first implementation.

#### Layer 2: display sleep assertion

Optional.

Only needed when the display must remain awake too.

#### Layer 3: closed-display mode

Advanced and explicit.

Needed for the real "Amphetamine-style before leaving the house" case if the lid may close.

This should not be silently enabled.

#### Layer 4: Power Protect-style fallback

Advanced, privileged, opt-in.

Only for edge cases where closed-display mode is insufficient, especially under Apple Silicon power-source transitions.

This must have:

- explicit enablement
- cleanup on quit
- crash recovery cleanup on next launch
- clear status reporting

### Safety Rules

- Never leave a global max-strength keep-alive running without a visible owner.
- Manual `max` leases must be duration-bounded by default.
- If privileged fallback is enabled, the app must clean up on shutdown and on next launch if stale state exists.
- Closed-display mode and privileged fallback should be code-level toggles even if hidden from the public UI at first.

## Part 3: API Surface

### Desktop Host API

Add IPC surface for:

- `getKeepAliveState`
- `acquireKeepAliveLease`
- `releaseKeepAliveLease`
- `updateKeepAliveDefaults`

Relevant file:

- [apps/desktop/src/app/host/channels.ts](/Users/arach/dev/openscout/apps/desktop/src/app/host/channels.ts)

### iOS Bridge API

Add a small keep-alive request path so the app can trigger real behavior instead of only altering prompt text.

Possible tRPC route:

- `mobile.keepAlive.request`

Input:

```ts
{
  conversationId?: string;
  strength: "normal" | "strong" | "max";
  durationMinutes?: number;
  reason?: string;
}
```

### Shell State

Expose current keep-alive state in desktop shell state and mobile home/session surfaces:

```ts
type KeepAliveState = {
  active: boolean;
  strength: "normal" | "strong" | "max" | null;
  source: "manual" | "heuristic" | "session_policy" | null;
  expiresAt?: number | null;
  options: KeepAliveOptions;
};
```

## Part 4: Heuristics

### Automatic keep alive

Heuristic acquisition is allowed for:

- active streaming work
- queued/running/waking flights
- recent operator request that implies long-running work

Heuristic keep alive should default to `normal`, not `max`.

### Explicit "extra keep alive please"

The user phrase should eventually trigger a real lease request.

Suggested behavior:

- phrase detection in iOS/desktop composer can still exist as a convenience
- but it should map to `mobile.keepAlive.request` or desktop equivalent
- default mapping should be `max` with a bounded duration

## Part 5: Implementation Order

### Phase 1: health model foundation

- Add bridge health state and evidence tracking to iOS `ConnectionManager`
- Add machine probe endpoint on the Mac
- Add machine and bridge probes from iOS
- Update UI copy to use health state, not raw connection failure state

### Phase 2: baseline keep alive

- Add `KeepAliveManager`
- Implement lease tracking
- Implement baseline idle system sleep prevention
- Surface keep-alive state in desktop shell state

### Phase 3: request path

- Add keep-alive IPC and tRPC request paths
- Allow iOS to explicitly request keep alive
- Map phrase-level UI to real keep-alive requests

### Phase 4: advanced modes

- Add closed-display mode support
- Add Power Protect-style fallback support behind advanced configuration
- Add crash recovery cleanup

## Proposed Files

### New

- `docs/mobile-bridge-health-and-keep-alive.md`
- `apps/desktop/src/app/host/keep-alive.ts`

### Likely changed

- [apps/ios/Scout/Services/ConnectionManager.swift](/Users/arach/dev/openscout/apps/ios/Scout/Services/ConnectionManager.swift)
- [apps/ios/Scout/Models/RPC.swift](/Users/arach/dev/openscout/apps/ios/Scout/Models/RPC.swift)
- [apps/desktop/src/app/host/channels.ts](/Users/arach/dev/openscout/apps/desktop/src/app/host/channels.ts)
- [apps/desktop/src/app/host/service.ts](/Users/arach/dev/openscout/apps/desktop/src/app/host/service.ts)
- [apps/desktop/src/core/mobile/service.ts](/Users/arach/dev/openscout/apps/desktop/src/core/mobile/service.ts)
- [apps/desktop/src/core/pairing/runtime/bridge/router.ts](/Users/arach/dev/openscout/apps/desktop/src/core/pairing/runtime/bridge/router.ts)
- [apps/desktop/src/core/pairing/runtime/relay-runtime.ts](/Users/arach/dev/openscout/apps/desktop/src/core/pairing/runtime/relay-runtime.ts)
- [packages/protocol/src/invocations.ts](/Users/arach/dev/openscout/packages/protocol/src/invocations.ts)

## Open Decisions

- Whether the machine probe should be a plain HTTP route, authenticated route, or lightweight RPC.
- Whether closed-display mode should ship in the first public UI or remain advanced-only.
- Whether privileged fallback should be implemented in the first pass or left as a later capability behind configuration.
- Whether `max` should require external power by default.

## Recommendation

Build the iOS health model and baseline keep-alive manager first.
Do not ship closed-display or privileged fallback in the first pass unless the baseline proves insufficient.
