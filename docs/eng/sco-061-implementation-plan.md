# SCO-061 Implementation Plan — Next-Gen HudsonKit iOS App on Shared Capabilities

> Companion to [`sco-061-native-app-shared-architecture-ios-macos-hudson.md`](./sco-061-native-app-shared-architecture-ios-macos-hudson.md). That doc is the *why* and the shape; this is the *how* and the *order*.

## 0. Premise

We are **not** re-skinning `apps/ios/Scout` in place. We stand up a **next-gen, HudsonKit-first iOS app target** built from the ground up around shared **Capabilities**, and we **harvest** the existing app's proven iOS-only code into it. The old target stays alive as reference + fallback until the new one reaches parity, then we cut over.

Three inputs feed the new app:

1. **`ScoutCapabilities`** (cross-platform, new) — the semantic contracts + conversation projection + behavior. The thing the new app is built *around*.
2. **`scout-ios-core`** (iOS-only, new) — the harvested crown jewels: the encrypted transport (conforming to the capability protocols), `Security/*`, Bonjour/pairing/push, Voice/Parakeet, Terminal/SSH, caching, inbox. Shared by *both* the old and new targets so nothing is duplicated during the parity window.
3. **HudsonKit** — every surface built fresh on `HudsonShell` + `HudsonUI`, no bespoke routing/theme.

"Capability-first" therefore means: the contracts are the scaffolding for a clean rebuild, not patches to the legacy app. Each capability lands as a vertical slice — contract in `ScoutCapabilities`, transport adapter in `scout-ios-core`, surface built fresh on Hudson in the new target — and macOS adopts the same shared capability in parallel.

The current `feat/in-app-session-initiation` branch hands us the worked example: `ScoutSessionService.swift` already separates a pure spec (`SessionInitiationSpec`/`Result`), a transport call (`SessionInitiationService.start`), and a Hudson UI (`ScoutSessionComposer`). Session initiation is Phase 1 — the first real thing the new app does end-to-end.

## 1. Package & target shape

```
packages/scout-native-core   (cross-platform: iOS17 / macOS14, Foundation/SwiftUI only)
  ScoutCapabilities          ✅ added (Phase 0) — capability contracts + pure behavior + conversation projection
  ScoutCapabilitiesTests     ✅ added (Phase 0) — golden contract fixtures (anti-drift harness)
  ScoutNativeCore            existing helpers (compose routing, dictation, identity)
  ScoutSharedUI              SwiftUI atoms (message input, markup, code block, vox)
                             ⚠️ on this branch these live macOS-app-local in
                             apps/macos/Sources/ScoutSharedUI — promote to a cross-platform
                             package product in Phase 0 (the new iOS target needs them).

packages/scout-ios-core      NEW — iOS-only, harvested from apps/ios/Scout
  Transport: BridgeBrokerClient (WS+Noise+tRPC) conforming to ScoutCapabilities
  Security/*, BonjourRelayDiscovery, pairing, push, SessionCache, InboxStore
  Voice/Parakeet, Terminal/SSH (Termini)

apps/ios
  ScoutApp      existing target — donor + fallback. Re-pointed at scout-ios-core (no behavior change).
  ScoutNextApp  NEW target — HudsonKit-first. Depends on Hudson + ScoutCapabilities + scout-ios-core.
                (name provisional; product stays "Scout" at cutover)
```

`ScoutCapabilities` imports only `Foundation` — no `URLSession`, no `@MainActor` stores, no Hudson. Transports/views live outside it. `scout-ios-core` is the seam that lets one transport stack serve both targets, and extracting it **first** (with the old app still green) de-risks the harvest before the new app exists.

> Lighter alternative if a second package is too much scaffolding: share the donor sources between both targets via a common source group in `project.yml`. The package is preferred (the transport must depend on `ScoutCapabilities` anyway), but the source-group route is a valid fallback.

**Contract-test harness (built in Phase 1, used forever after):** `ScoutCapabilitiesTests` carries golden JSON fixtures (request bodies, responses, event frames). A transport adapter is "done" only when it passes them. This is codex's "semantic and contract-tested" requirement; it's what keeps the macOS HTTP adapter and the iOS bridge adapter from drifting.

## 2. The capability protocol pattern

Each capability is a small protocol naming *what the app needs*, never *which endpoint serves it*. `ScoutBrokerClient` is a **composition**, not a monolith:

```swift
public protocol SessionInitiationCapability {
    func start(_ spec: SessionInitiationSpec) async throws -> SessionInitiationResult
}
public protocol ConversationCapability {
    func send(_ turn: TurnRequest) async throws -> TurnAck
    func snapshot(_ id: ConversationID) async throws -> ConversationSnapshot
    func events(since: Seq?) -> AsyncStream<SequencedEvent>
}
public protocol ListingCapability { /* sessions, agents, workspaces */ }
public protocol TailCapability     { /* activity firehose */ }
public protocol ControlCapability  { /* interrupt, answer-question, decide-action */ }

public protocol ScoutBrokerClient:
    SessionInitiationCapability, ConversationCapability,
    ListingCapability, TailCapability, ControlCapability {}
```

iOS provides `BridgeBrokerClient` (in `scout-ios-core`, WS+Noise+tRPC). macOS provides `WebBrokerClient` (HTTP/SSE via `ScoutWeb.baseURL`). The new app's surfaces depend only on the protocols.

## 3. Phases

### Phase 0 — Scaffold + harvest
*Stand up the empty new app and prove the crown-jewel extraction without breaking the old app.*

- Add `ScoutNextApp` target (XcodeGen) wrapping `HudPhoneAppShell` + a `HudTheme` from `ScoutHudsonStyle`. It launches to an empty themed shell. Nothing else.
- Create `scout-ios-core`; move the transport stack + `Security/*` + Bonjour/pairing/push + Voice + Terminal + `SessionCache`/`InboxStore` out of `apps/ios/Scout` into it.
- Re-point the **existing** `ScoutApp` at `scout-ios-core`. **Acceptance: old app builds and behaves identically.** This is the harvest's safety proof.
- Add `ScoutCapabilities` + `ScoutCapabilitiesTests` targets (empty but wired).

### Phase 1 — First capability slice: Session Initiation
*The new app does its first real thing; the seam is proven contract → adapter → Hudson UI.*

- Move pure `SessionInitiationSpec`/`Result`/`Error` + the pure `makeSpec` out of `ScoutSessionService.swift` into `ScoutCapabilities`; define `SessionInitiationCapability`.
- macOS `SessionInitiationService` conforms (HTTP adapter, no behavior change).
- iOS `BridgeBrokerClient` implements it over `mobile/*` in `scout-ios-core`.
- **New app:** build a Hudson session-initiation surface (`HudMessageBar`/`HudField`) reusing the shared draft/spec.
- First golden fixture: the four-modality `POST /api/sessions` body.
- **Done when:** a session starts from the new app *and* macOS through the same spec; fixtures green.

### Phase 2 — Conversation projection + the conversation surface  ✅ landed (against the mock)
*The keystone. Promote behavior, not the store.*

- ✅ Extracted the **pure** reducer + model from iOS `SessionStore` — `Turn`/`Block`/`Action`/`Question`, `ScoutEvent`, the event→state reduction with snapshot recovery — into `ScoutCapabilities` (`ConversationModel.swift` + `ConversationProjection.swift`). `@MainActor`, observation, locks, and cache left behind (those land in `scout-ios-core`). `nowMillis`/`TurnHash` wall-clock concerns dropped so the reducer is deterministic for fixtures.
- ✅ Defined `ConversationCapability` (snapshot + event stream) + `ControlCapability` (send/answer/decide/interrupt); composed both into `ScoutBrokerClient`.
- ✅ **New app:** `ConversationSurface` renders turns/blocks via Hudson atoms (`HudCard`/`HudBadge`/`HudStatusDot`/`HudButton`) + `HudMessageBar`; Home rows deep-link in. Drives the projection off `MockBrokerClient`'s scripted live turn.
- ✅ Fixtures: 6 projection tests (streaming text, action output/status, seq cursor, snapshot recovery, unknown-event tolerance, wire round-trip) — green.
- ⏭ Remaining for "done against real transport": richer block rendering via `MessageMarkupParser`/`MessageCodeBlock`; `scout-ios-core` `@MainActor` store wrapping the projection + bridge stream + cache; iOS `BridgeBrokerClient` conformance replacing the mock.
- **Done when:** the new app renders live conversations off the shared projection; fixtures green. → **met against the mock seam**; real-transport conformance tracked under Phase 3+/the harvest.

### Phase 3 — Listing & Tail capabilities + surfaces
*Independent of Phase 2; parallelizable once Phase 1's pattern is set.*

- `ListingCapability` + shared `SessionSummary`/`AgentSummary`/`WorkspaceSummary` (reconcile iOS `Mobile*Summary` with macOS fleet shapes); shared filter/sort.
- `TailCapability` + shared `TailEvent` model + projection.
- **New app surfaces:** Home / AllSessions / AgentDetail on `HudListRow`/`HudTable`/`HudCard`; Tail on `HudLiveIndicator`/`HudTextDocument`.
- Fixtures for both transports.

### Phase 4 — Queue & Steering (net-new — SCO-062)
*Not donated code. New architecture.*

- Spin **SCO-062**: a shared state machine in `ScoutCapabilities` — draft queue, local echo, ack/failure, client-id dedupe, offline retry, active-turn follow-up, interrupt, routing, backpressure.
- iOS contributes control semantics (existing interrupt paths); macOS contributes engagement UX (`HUDEngageState`).
- Wire the new app's composer to the shared queue via `ControlCapability`. This is a capability the *old* app never had.

### Phase 5 — Parity + cutover
*Retire the donor.*

- **Parity checklist** — the new app must cover what the old app does: pairing/trusted-bridge gate · Home (active/recent/search) · conversation/timeline · voice-first composer · tail/activity · sessions + agents/fleet listing · inbox (approvals/questions/actions) · terminal/SSH · settings · push deep-links.
- When the checklist is green: rename `ScoutNextApp` → product "Scout", retire `ScoutApp`, drop dead bespoke views/routing/theme.
- `scout-ios-core` stays as the shared iOS substrate.

## 4. Sequencing & parallelism

```
Phase 0 (scaffold + harvest, old app stays green)
   └─► Phase 1 (session-init slice) ──┬──► Phase 2 (projection + conversation surface)
                                       ├──► Phase 3 (listing/tail + surfaces)
                                       └──► Phase 4 / SCO-062 (queue/steering)
                                                     └─► Phase 5 (parity gate → cutover)
```

Phase 0 is the gate: empty new shell + a clean crown-jewel extraction that doesn't regress the old app. Phase 1 sets the vertical-slice pattern and the fixture harness. Phases 2/3/4 are independent and each lands its own surface in the new app. Phase 5 only begins once the parity checklist is materially covered.

## 5. Risks & guards

- **Harvest regresses the old app** → Phase 0 acceptance is "old `ScoutApp` builds and behaves identically on `scout-ios-core`"; do the extraction before the new target consumes it.
- **Two targets diverge during parity** → both stay green in CI; new features land via shared capabilities, not target-local code.
- **Endpoint-shaped contracts** freeze drift → keep protocols semantic; review each method for "names a need or a route?"
- **Promoting the store, not the reducer** → Phase 2 extracts pure types only; CI asserts `ScoutCapabilities` imports nothing but `Foundation`.
- **Adapter drift** → no adapter merges without passing `ScoutCapabilitiesTests`.
- **HUD vs HudsonKit conflation** → this touches the `Scout` shell, not `OpenScoutMenu` HUD patterns (`apps/macos/Package.swift:21-35`).
- **Package-as-offering discipline** → ship `ScoutCapabilities`/`scout-ios-core` with an adoption recipe; the explicit ask here sanctions wiring the new target, but we don't wire other consumers without one.

## 6. First concrete steps (Phase 0 kickoff)

1. ✅ **Done** — `ScoutCapabilities` + `ScoutCapabilitiesTests` targets added to `packages/scout-native-core/Package.swift` (Foundation-only module + contract-version fixture; builds + test green).
2. Promote `ScoutSharedUI` from macOS-app-local (`apps/macos/Sources/ScoutSharedUI`) to a cross-platform product of `scout-native-core`; re-point `apps/macos` at the package product (no behavior change). Use `wip/inflight-snapshot-2026-06-02` as reference — it already did this move.
3. Create `packages/scout-ios-core` (iOS-only) and move the transport/security/voice/terminal/cache/inbox sources out of `apps/ios/Scout` into it.
4. Re-point existing `ScoutApp` at `scout-ios-core`; build + smoke — must behave identically.
5. Add `ScoutNextApp` target: `HudPhoneAppShell` + `ScoutHudsonStyle` theme, launching to an empty themed shell.
6. Land Phase 1's session-initiation slice as the new app's first real surface.

> **Branch-state note:** this branch (`feat/in-app-session-initiation`) does **not** carry the native-sharing groundwork (ScoutSharedUI package move, iOS `scout-native-core` deps, iOS Hudson foothold) — that was uncommitted WIP, now parked on `wip/inflight-snapshot-2026-06-02` (based on stale main, mixed with ~75 unrelated files). We build on `feat` and rebuild the small groundwork properly, using the snapshot only as reference.
