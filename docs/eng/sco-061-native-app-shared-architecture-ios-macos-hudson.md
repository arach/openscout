# SCO-061: Native App Shared Capability Architecture (iOS / macOS / HudsonKit)

## 1. Status

- **Status:** Draft — assessment, reviewed by Codex (see §9)
- **Owner:** OpenScout
- **Scope:** iOS and macOS Scout apps, HudsonKit adoption, `scout-native-core` shared package
- **Intent:** Make each capability (turn handling, listing, tail, control/steering, queuing) a **shared semantic capability** — a transport-agnostic contract plus pure behavior — authored once and differing only in **UX** per platform. Shared UI atoms are a convenience on top, not the organizing principle.

## 2. Summary

The product goal is "add a capability to one app, get it on the other with UX-only changes." The way to get there is **less shared UI, more shared capability**: define each capability as a semantic contract (a protocol) plus pure behavior (models, reducers, state machines), and let each platform supply a thin transport adapter and its own Hudson-skinned views. The shared UI atoms that already exist (`ScoutSharedUI`) are useful, but they are the smallest part of the story.

The structural fact that forces this shape: **macOS and iOS do not share a transport, and should not.** macOS is co-located with the broker and speaks HTTP + SSE to localhost (`HudComposeService.swift:111-131`, `:167-228`; web `/api/send`, `/api/events`). iOS is remote and speaks encrypted WebSocket + Noise + tRPC to a paired bridge over a relay (`RPC.swift:35-80`; `ConnectionManager.swift:1713-1758`). So the shareable code is everything *above* transport (the conversation projection, control/queue behavior, rendering) and *below* it (pure data types), with transport implemented per-platform **behind semantic capability protocols** — not one endpoint-shaped client.

The donor relationship flows both ways. iOS donates its **conversation projection** up into shared code (its event-reduced model is the better one). macOS donates Hudson adoption patterns and steering **UX** across. Queuing is **net-new** — neither app has it today — so it is new shared architecture, not donated code.

## 3. Current State

### 3.1 Transport divergence (the structural fact)

| | macOS | iOS |
| --- | --- | --- |
| Topology | Co-located with broker | Remote, paired bridge over relay |
| Transport | HTTP + SSE to localhost (`/api/*`) | WebSocket + Noise + tRPC (`mobile/*`) |
| Discovery / trust | n/a (local) | Bonjour, QR pairing, trusted-bridge gate, push |
| Send path | `HudComposeService.postToBroker` / `runReplyStream` | `ConnectionManager.sendPrompt` → `mobile/message/send` |
| Listing | `HudFleetService` / `CommsService` (HTTP polling) | `listMobileSessions` / `listMobileAgents` (tRPC) |
| Conversation model | Flat `HUDAssistantMessage` local echo | Event-reduced projection + snapshot recovery |

The two broker surfaces (`/api/*` vs `mobile/*` tRPC) are genuinely different and drift independently. Converging them is a §7 question — and it means converging *semantic shapes*, not the physical wire.

### 3.2 What is already shared (`scout-native-core`)

- **ScoutNativeCore** (pure logic, iOS 17 / macOS 14, no Hudson, no transport): `ScoutComposeRouting` (mention parsing / envelope), `ScoutDictation` (dictation state machine), `ScoutNativeAppIdentity`. This is the seed of the capability layer.
- **ScoutSharedUI** (cross-platform SwiftUI atoms): `MessageInputAtoms`, `MessageMarkupParser` (pure), `MessageSuggestions` (pure engine), `MessageSuggestionPopover`, `MessageCodeBlock`, `ScoutVoiceService`. Recently extracted out of `apps/macos` (uncommitted move). **iOS already declares the dependency (`apps/ios/project.yml:50-53`) but has not meaningfully adopted the components.**
- **mobile-keyboard-kit**: iOS-only custom keyboard. Correctly separated.

### 3.3 HudsonKit (presentation only)

Purely presentational, zero app logic, cross-platform (iOS 17 / macOS 14). Relevant products: **HudsonShell** (`HudPhoneAppShell`, `HudAppShell`, nav scaffolding) and **HudsonUI** (`HudListRow`, `HudTable`, `HudCard`, `HudField`, `HudButton`, `HudBadge`, `HudMessageBar`, `HudTextDocument`, `HudStatusDot`, `HudLiveIndicator`, `HudEmptyState`, `HudQRScanner`). Theming via `HudTheme` / `HudThemePalette` / `HudAppManifest` through the environment.

> **Caveat:** HudsonKit is distinct from OpenScout's bespoke macOS HUD patterns. `apps/macos/Package.swift:21-35` shows `OpenScoutMenu` and `Scout` are separate targets with different dependencies. "macOS is on Hudson" is true for the `Scout` shell; not every HUD pattern is a HudsonKit pattern.

### 3.4 iOS Hudson foothold (uncommitted)

The iOS app has a thin, uncommitted Hudson start: `ContentView` wraps content in `HudPhoneAppShell` and a `ScoutHudsonStyle` bridge maps the Scout palette into `HudTheme`. It is a foothold for the presentation layer, not a capability migration.

## 4. Target Architecture — capability-first

```
HudsonKit            presentation primitives — purely visual, zero app logic
  (iOS17/macOS14)    HudListRow, HudTable, HudCard, HudMessageBar, HudLiveIndicator, HudTextDocument…
─────────────────────────────────────────────────────────────────
scout-native-core    SHARED CAPABILITY (both platforms)
  Capability contracts   semantic protocols: Conversation, Listing, Tail, Control  ← new
  Pure behavior          conversation projection (reducer + model + snapshot recovery)  ← from iOS
                         queue + steering state machine  ← net-new
                         compose routing, dictation, suggestions, markup  ← exists (ScoutNativeCore)
  ScoutSharedUI          message atoms, code block, vox  ← exists; convenience, not the spine
─────────────────────────────────────────────────────────────────
Transport adapter    PER-PLATFORM, satisfies the capability contracts (NOT shared)
  macOS: HTTP/SSE  •  iOS: WS+Noise+tRPC
─────────────────────────────────────────────────────────────────
App views            PER-PLATFORM, Hudson-skinned — UX differs, behavior doesn't
```

**Capability contracts** are the spine. Each is a small semantic protocol that names *what the app needs*, not *which endpoint serves it*:

- **ConversationCapability** — send a turn; fetch a snapshot; stream events; (control belongs here or in Control).
- **ListingCapability** — list sessions, agents, workspaces.
- **TailCapability** — subscribe to the activity firehose.
- **ControlCapability** — interrupt / steer / answer-question / decide-action.

`ScoutBrokerClient` is then a **composition** of these protocols, not a monolith. Each platform's transport adapter implements them differently (SSE vs WS+tRPC), and the contracts get **contract-test fixtures** from day one so the two adapters cannot silently drift.

**Principle:** behavior (state machines, models, reducers, routing) lives in `scout-native-core`; only views differ per platform; transport is an adapter that satisfies the contracts. Shared UI atoms are adopted where convenient — they are not what makes a capability shared.

## 5. Donor Map (current iOS app)

- **Keep as-is (iOS-specific, no macOS equivalent):** the encrypted transport stack — `ConnectionManager`, `Security/*` (Noise, Identity, QRPayload, SecureTransport), `BonjourRelayDiscovery`, pairing, push, `InboxStore`, `SessionCache`; plus Voice/Parakeet (`ScoutVoice`), Terminal/SSH (`Termini`), `mobile-keyboard-kit`. These become the iOS *adapter* behind the capability contracts.
- **Promote up to `scout-native-core` — the pure projection, not the store class.** iOS's `SessionStore` is `@MainActor`, observable, cache-aware, lock-using, and snapshot-merging (`SessionStore.swift:70-99`, `:282-294`, `:324-365`). Promote the **pure reducer + model + projection** (`Primitives.swift`, `Events.swift`, the event→state reduction). Leave the app store, caching, and `@MainActor` plumbing on iOS. Describe the result as an **event-reduced conversation projection with snapshot recovery**, not "event sourcing."
- **Re-skin on Hudson (rebuild the ~30 bespoke views):** `ScoutRouter` + `ScoutNavigationShell` → `HudPhoneAppShell` + `NavigationStack`; `HomeView` / `AllSessionsGridView` / `AgentDetailView` → `HudListRow` / `HudTable` / `HudCard`; `TimelineView` → Hudson message components + shared renderer; `ComposerView` → `HudMessageBar`; `TailFeedView` → `HudLiveIndicator` + `HudTextDocument`; `Theme.swift` → fold into `HudTheme`.
- **Adopt what's already declared:** iOS already depends on `ScoutSharedUI` (§3.2) but hasn't used it — adopt `MessageMarkupParser` + `MessageSuggestions` + `MessageCodeBlock` in place of bespoke block rendering.

## 6. Capability-by-Capability

| Capability | Lives now | Verdict |
| --- | --- | --- |
| **Conversation / turn** | iOS event-reduced projection (good); macOS flat `HUDAssistantMessage` (SSE) | Promote iOS's *pure* reducer/model to shared; both consume via `ConversationCapability` |
| **Message input** | iOS `ComposerView`; atoms already in `ScoutSharedUI` | Routing/suggestions/markup → shared behavior; shell → `HudMessageBar`; UX per platform |
| **Queuing** | **Neither has it** — iOS fires `sendPrompt` immediately; macOS `HUDDockState.send` is single-in-flight, not a queue | **Net-new shared state machine; its own SCO.** Not donated. |
| **Steering / control** | iOS has interrupt paths (`ComposerView.swift:801-837`, `ScoutBottomBar.swift:85-91`); macOS has `HUDEngageState` cursor UX | iOS donates control *semantics*; macOS donates *UX*. Behind `ControlCapability` |
| **Tail** | iOS `TailFeedView` + `TailEvent`; macOS `ScoutTailStore` | Shared `TailEvent` model + projection; per-platform source via `TailCapability`; UI via `HudLiveIndicator` |
| **Session / agent listing** | iOS `MobileSessionSummary`/`MobileAgentSummary` (tRPC); macOS `HudFleetService`/`CommsService` (HTTP) | Shared summary models + filter/sort; transport via `ListingCapability`; UI via `HudListRow`/`HudTable` |

## 7. Strategic Fork

- **Option A — ship now: multiple transports behind one *semantic capability contract*.** Each platform implements the capability protocols its own way. Pure Swift, no backend changes, incremental. The risk to avoid: if the contracts are endpoint-shaped, they freeze the drift in place — so they must be **semantic and contract-tested**.
- **Option B — north star: one broker-owned semantic surface, multiple delivery mechanisms.** Converge the *shapes/projections*, **not the wire**. iOS keeps WS+Noise; macOS keeps local HTTP/SSE or broker-local access. "One native domain contract," not "one transport."

**Recommendation:** ship **A now** with semantic capability protocols + contract fixtures; pursue **B** as convergence of semantic shapes over time. A done right makes B a shape-alignment exercise, not a rewrite — and it unblocks the iOS Hudson re-skin immediately.

## 8. Resolved Direction (from review)

1. **Protocol seam altitude:** capability protocols (Conversation, Listing, Tail, Control), composed by `ScoutBrokerClient`. Not a monolith.
2. **Promote engine before reskin:** yes — promote the **pure reducer first**, then reskin against the shared model.
3. **Converge broker surfaces:** yes, on roadmap, but as semantic-shape convergence, not one wire.
4. **Queue/steering:** **its own SCO** — a real state machine: draft queue, local echo, ack/failure, client-id dedupe, offline retry, active-turn follow-up, interrupt, target/session routing, backpressure.

## 9. Review Notes (Codex)

Codex reviewed this doc and confirmed the core premise, with corrections now folded in: (a) `ScoutBrokerClient` must be semantic capability protocols, not endpoint-shaped; (b) promote the pure projection, not the `@MainActor` `SessionStore`; (c) "event-sourced" → "event-reduced projection with snapshot recovery"; (d) macOS does **not** donate queuing (it is net-new); (e) steering splits into iOS control-semantics + macOS UX; (f) iOS already declares the `ScoutSharedUI` dependency but hasn't adopted it; (g) HudsonKit ≠ bespoke macOS HUD patterns. Bottom line: ship Option A, define the seam as semantic capability protocols with contract fixtures immediately, and treat queue/steering as new architecture.
