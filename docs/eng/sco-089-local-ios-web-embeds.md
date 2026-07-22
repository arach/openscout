# SCO-089: Local iOS Web Embeds and Scout Deck Transport

## Status

- **Status:** Implementation underway — closed v1 web contract and local-surface foundation verified; production renderer cutover remains gated
- **Owner:** OpenScout
- **Date:** 2026-07-21
- **Scope:** Scout iPad/iOS embedded Lanes and Dispatch surfaces, their web build, HudsonUIWeb, and the native bridge to paired Macs
- **Depends on:** [SCO-061 native capability architecture](./sco-061-native-app-shared-architecture-ios-macos-hudson.md)
- **Related optimization:** [SCO-063 multi-connection fleet client](./sco-063-multi-connection-fleet-client-proposal.md); it is not a migration prerequisite

## Implementation snapshot — 2026-07-21

The first implementation slice is complete and remains deliberately non-production while the canonical Lanes renderer is moved behind `ScoutSurfaceClient`:

- `packages/web` now owns a closed v1 method allowlist, typed request/reply/push shapes, bounded policies, a generated golden fixture corpus, and a native `WKScriptMessageHandlerWithReply` adapter.
- the native-surface build emits app-bundled Lanes and Dispatch entries, shared hashed assets, a content-security policy with no network access, and a deterministic hash manifest;
- the iOS build validates the manifest before compilation and embeds `WebSurfaces` as a signed folder resource;
- HudsonUIWeb can load a bundle entry with an explicit shared read root and supplies generic user-script, request/reply, navigation, process-reset, activity, and teardown hooks;
- Scout iOS has a first typed-boundary bridge over its existing keyed machine clients. It exposes opaque host ids plus bootstrap, agent-list, recent-tail, cancellation, external-link, and lane-selection capabilities; unsupported methods fail closed;
- Debug iPad builds render the signed local shell by default. `SCOUT_REMOTE_WEB_SURFACES=1` is a temporary troubleshooting escape hatch for the old host-served page. Release behavior stays on the current paired page until the shared Lanes renderer and Swift fixture parity meet the Phase 2 cutover gate.

Verified in this slice: strict TypeScript compilation, seven web contract/manifest tests, native-asset hash validation, eight focused Hudson tests, and a two-architecture iPad Simulator build whose pre-build asset validation passed. Still required before production Lanes cutover: concrete Swift `Codable` fixture parity, physical-device module/chunk loading, the adapter-backed canonical Lanes renderer, observe/live-tail streaming, and the Release-path assertion.

## Decision requested

Adopt this invariant for production iOS builds:

> Every iOS web surface loads its HTML, CSS, JavaScript, fonts, icons, and other executable UI assets from the signed app bundle. Paired Macs supply structured data, event streams, and commands; they do not serve the page.

Lanes is the first migration, Dispatch is the second, and every later iOS embed must use the same asset and transport architecture. A debug-only remote-page override remains available for web iteration, is visibly identified, and is absent from Release behavior.

This proposal does **not** make a separate Scout Deck app. It creates the reusable local web-surface foundation for a later iPad Scout Deck: native multi-select host picker above, shared React lane canvas/grid in the middle, and a native lane-targeted message composer below.

## Why now

The current iPad `MissionControlSurface` resolves `/embed/agent-lanes` or `/embed/dispatch` against the focused paired Mac and gives Hudson `.paired(sourceURL)`. As a result, a web deploy or host restart can change the iPad UI without a new app build. That is useful during development but violates the intended product boundary:

- the page is unavailable until a Mac web server is reachable;
- app UI code can drift independently of the reviewed/signed iOS binary;
- one focused host implicitly owns the page, which conflicts with a fleet-wide Deck;
- web code uses same-origin `fetch` and WebSocket calls, so presentation and transport are coupled;
- loading a trusted page from a host still grants that page the native surface's visual authority.

The paired bridge already provides the right data-plane topology: iOS holds authenticated connections to keyed Macs, and `AppModel` already owns multiple simultaneous `BridgeBrokerClient` instances. The page should sit above those clients, not beside them on a host web server.

## Current system

### iOS loading path

- [`apps/ios/Scout/MissionControlSurface.swift`](../../apps/ios/Scout/MissionControlSurface.swift) maps Lanes and Dispatch to remote embed paths and constructs `HudWebSurfaceDescriptor(location: .paired(...))`.
- [`apps/ios/Scout/AppModel.swift`](../../apps/ios/Scout/AppModel.swift) resolves the focused Mac's `webAccessHost` and `webAccessPort`, with `SCOUT_WEB_BASE_URL` as a Debug override.
- [`apps/ios/Scout/AppModel.swift`](../../apps/ios/Scout/AppModel.swift) also owns a keyed bridge-client fleet and can enumerate connected clients. That is the correct fleet authority.
- [`packages/scout-ios-core/Sources/ScoutIOSCore/BridgeBrokerClient.swift`](../../packages/scout-ios-core/Sources/ScoutIOSCore/BridgeBrokerClient.swift) already exposes semantic listing, conversation, control, tail, comms, and terminal capabilities over the encrypted mobile bridge.

### Web surface path

- [`packages/web/client/screens/ops/AgentLanesView.tsx`](../../packages/web/client/screens/ops/AgentLanesView.tsx) registers `/embed/agent-lanes`. It reads agents from `ScoutProvider`, tail snapshots/events, and observe polling.
- [`packages/web/client/screens/broker/BrokerScreen.tsx`](../../packages/web/client/screens/broker/BrokerScreen.tsx) registers `/embed/dispatch`. It reads broker diagnostics/events and performs ask/review mutations.
- These components are the canonical implementations and should remain shared. The migration must not create iOS-only copies of Lanes or Dispatch.
- Their dependencies currently call relative `/api/*` endpoints and create tRPC WebSockets directly. A local `file:` page cannot and should not infer a remote HTTP origin to preserve those calls.

### HudsonUIWeb path

Hudson already defines `HudWebSurfaceLocation.bundled(directory:indexFile:)`, which is the correct public abstraction. Two additions are required before Scout should rely on it:

1. Bundled content should load with `WKWebView.loadFileURL(_:allowingReadAccessTo:)`. Hudson currently maps a bundle URL to a normal URL request. Because Lanes and Dispatch share hashed assets, the allowed `WebSurfaces` root is one explicit mutual file-read trust domain; it must never contain secrets or per-surface private material.
2. Hudson needs generic configuration hooks for a script-message bridge, initial user scripts, navigation and UI policy, process termination, activity state, and teardown. Scout-specific message names and payloads remain in Scout.

The Hudson changes belong in HudsonUIWeb rather than an app-local replacement for `WKWebView`.

## Target architecture

```text
Signed Scout.app
┌──────────────────────────────────────────────────────────────────┐
│ SwiftUI shell                                                    │
│  native host picker     native selected-lane composer            │
│          │                         ▲                              │
│          ▼                         │                              │
│ AppModel / FleetWebSurfaceGateway facade                         │
│  machine inventory · bridge clients · routing · snapshots        │
│          │ typed request/reply + snapshot/delta events            │
│          ▼                         │                              │
│ WKWebView — app-bundled React surface                            │
│  Lanes / Dispatch components + iOS transport adapter             │
└───────────────────────┬──────────────────────────────────────────┘
                        │ encrypted paired bridge connections
              ┌─────────┴──────────┐
              ▼                    ▼
         Mac A broker         Mac B broker
       data + commands       data + commands
       never page assets     never page assets
```

### Ownership boundaries

| Layer | Owns | Must not own |
| --- | --- | --- |
| Native Swift | trusted machines, live connections, selected host set, route provenance, credentials, app lifecycle, bridge version negotiation | React presentation state or a second lane renderer |
| Shared React surface | layout, density/grid/canvas state, lane rendering, web interactions, surface-local selection | network credentials, host discovery, direct paired-host URLs |
| Surface transport contract | typed methods, snapshots, deltas, errors, cancellation, protocol negotiation | visual components or broker persistence |
| Paired Mac | broker-authoritative records, observed harness material, command execution, streams | iOS HTML/JS/CSS |

`FleetWebSurfaceGateway` is not a second fleet brain. It is a thin surface-facing facade over the existing `FleetConnectionManager` and the future coalescing `FleetClient` described by SCO-063. It reuses the same internal machine ids, connection states, and write routing. Deck multi-selection is surface-scoped and must never mutate `focusedMachineId`, `BridgeBrokerClient.setActiveConnectionPublicKeyHex`, or the focus used by unrelated single-host tabs.

## Shared surface, replaceable transport

The React tree should depend on a `ScoutSurfaceClient`, not directly on browser globals. The first interface is intentionally semantic and limited to what the migrated surfaces use:

```ts
interface ScoutSurfaceClient {
  bootstrap(): Promise<SurfaceBootstrap>;
  agents: {
    list(scope: HostScope): Promise<FleetAgentSnapshot>;
    observe(scope: HostScope, agentIds: string[]): Promise<FleetObserveSnapshot>;
  };
  tail: {
    recent(scope: HostScope, cursor?: string): Promise<FleetTailSnapshot>;
    subscribe(scope: HostScope, listener: (delta: FleetTailDelta) => void): Unsubscribe;
  };
  dispatch: {
    diagnostics(scope: HostScope, cursor?: string): Promise<FleetDispatchSnapshot>;
    ask(request: RoutedAskRequest): Promise<RoutedAskReceipt>;
    review(request: RoutedReviewRequest): Promise<RoutedReviewReceipt>;
    subscribe(scope: HostScope, listener: (delta: FleetDispatchDelta) => void): Unsubscribe;
  };
  native: {
    setLaneSelection(selection: LaneSelection | null): Promise<void>;
    openExternalURL(url: string): Promise<void>;
    getPreferences(keys: SurfacePreferenceKey[]): Promise<SurfacePreferences>;
    setPreferences(values: SurfacePreferences): Promise<void>;
    cancel(requestId: string): Promise<void>;
  };
}
```

There are two adapters:

- `BrowserScoutSurfaceClient` preserves today's HTTP/tRPC WebSocket implementation for Scout Web.
- `NativeScoutSurfaceClient` speaks only to the injected Swift bridge. It performs no network requests.

Both adapters implement the full contract so the React tree never branches on platform. In the browser adapter, host scope resolves against the current web origin's host set, subscriptions retain their explicit `HostScope`, cancellation aborts the underlying request, preferences use namespaced origin `localStorage`, and external links use a guarded `window.open` path. Native applies its own allowlist and navigation policy rather than trusting browser behavior.

Existing `api()`, `useBrokerEvents`, `useTailEvents`, and polling hooks should be adapted behind this contract incrementally. Do not emulate an HTTP server in the iOS app and do not monkey-patch global `fetch`: both retain endpoint coupling and make capability/version failures opaque.

Surface components continue to register through the existing `defineSurface` registry. A surface declares the capabilities it requires; the browser and native hosts decide which adapter satisfies them. iOS persistence uses the bounded native preference methods rather than relying on opaque `file:` origin `localStorage`. Every preference key is enumerated in that surface's manifest. Values are limited to string, finite number, boolean, or string array, with each encoded value at most 4 KiB.

### Closed v1 method allowlist

Native dispatches only these named methods; there is no glob, arbitrary `mobile/*`, `/api/*`, fetch, or RPC passthrough:

- **Shared:** `bootstrap`, `native.openExternalURL`, `native.getPreferences`, `native.setPreferences`, `native.cancel`.
- **Lanes v1:** `agents.list`, `agents.observe`, `tail.recent`, `tail.subscribe`, `native.setLaneSelection`.
- **Dispatch v1:** `dispatch.diagnostics`, `dispatch.subscribe`, `dispatch.ask`, `dispatch.review`.

Every method maps to a named Swift gateway operation over `BridgeBrokerClient` or a new semantic mobile procedure. Before Phase 2, the implementation inventory must resolve missing observe/tail discovery coverage explicitly. The recommended direction is to extend semantic mobile capabilities for observe and tail discovery; Dispatch ask/review should reuse broker-owned send/ask semantics through named mobile mutations. Feature reduction is acceptable for the first read-only Lanes slice, but a generic proxy is not.

Phase 0 defines a closed params and result schema for every method. The wire envelope permits only bounded JSON scalars, arrays, and objects; no method accepts an open `unknown` dictionary. Swift decodes the selected method into its concrete `Codable` type, rejects unknown fields where practical, and applies method-specific depth, collection-count, string-length, and encoded-size limits before dispatch.

## Native bridge protocol

Use a versioned JSON envelope over one named `WKScriptMessageHandlerWithReply` for page-to-native requests. The iOS deployment target supports it, so there is no older fallback. Native-to-page pushes enter the **page content world** through one receiver installed before application JavaScript, such as `globalThis.__scoutSurface.onPush`. An isolated content world may host guard code but cannot be the product event bus because React runs in the page world. Hudson owns handler registration, initial scripts, main-frame enforcement, and deterministic cleanup; Scout owns decoding, method allowlisting, routing, and authorization.

### Initial bootstrap and negotiation

Before application JavaScript starts on every main-frame load, native injects an initial bootstrap object:

```json
{
  "surface": "lanes",
  "assetRevision": "<web-build-sha>",
  "protocolVersion": 1,
  "minimumSurfaceProtocolVersion": 1,
  "minimumNativeProtocolVersion": 1,
  "capabilities": ["agents.list", "agents.observe", "tail.recent", "tail.subscribe"],
  "device": { "platform": "ios", "formFactor": "ipad" },
  "hosts": [{ "id": "<public-key-fingerprint>", "name": "Studio", "state": "connected" }],
  "selectedHostIds": ["<id>"],
  "connectionRevision": 42
}
```

Native and the built surface each advertise their supported protocol range. If the ranges do not intersect, the page renders a local incompatibility state and never falls back to remote HTML. `assetRevision` may change without a protocol bump; an incompatible protocol change requires an adapter compatibility window. Unknown or unadvertised methods still fail closed per call.

The same state is available through an idempotent `bootstrap()` request, allowing the adapter to recover if initialization ordering is disturbed. A reload or web-process respawn installs fresh scripts and bootstrap state and invalidates every earlier request id, subscription, epoch, and queued event. The page treats it as a full state reset; native never tries to resume page-owned state across the new document.

Host inventory, `selectedHostIds`, connection state, and surface activity change after bootstrap through a `session.update` push. The page treats that latest native event as authoritative and does not cache host trust. Host-set changes do not reload the page; they cancel removed-host work and request snapshots only for affected hosts.

### Request/reply envelope

```json
{
  "v": 1,
  "id": "uuid",
  "surface": "lanes",
  "method": "agents.list",
  "hostIds": ["machine-a", "machine-b"],
  "params": {},
  "deadlineMs": 15000
}
```

Replies contain exactly one of `result` or a structured `error`. Errors expose stable codes such as `not_connected`, `unsupported_capability`, `invalid_route`, `cancelled`, `deadline_exceeded`, and `payload_too_large`; raw server failures and secrets are not injected into page content.

Every method declares a default and maximum deadline in the contract. Native applies `min(requestedDeadlineMs, methodMaximum)`, uses the default when omitted, and echoes the applied deadline in reply metadata. Oversized deadlines are clamped rather than allowed to retain native work indefinitely.

The page can cancel a request by id through `native.cancel`. Reload, teardown, web-process termination, host deselection, and app backgrounding cancel all affected requests. Every reply closure is resolved exactly once; teardown resolves outstanding replies with `cancelled` so page promises cannot hang.

### Push events

Every push has `v`, `stream`, `hostId`, `epoch`, `sequence`, `connectionRevision`, and `payload`. Every snapshot returns the applied `epoch` and `sequence`. Epoch and sequence are adapter-issued, per-host opaque cursors: the page compares them but never interprets their contents. Each adapter guarantees monotonic sequence within an epoch, issues a new epoch on transport reconnection or resync, and emits an explicit reset when the epoch changes. The browser adapter issues an epoch per WebSocket connection and sequences delivered events; the native adapter issues them per connection revision.

The page keeps a per-host cursor and only applies a delta whose epoch matches the last successful snapshot. A sequence gap, epoch mismatch, explicit reset, connection revision change, page reload, process respawn, or foreground transition triggers a bounded snapshot refresh. Deltas from the previous epoch are discarded; deltas for the pending epoch are bounded until its snapshot is applied.

`connectionRevision` changes on connect, Noise re-handshake, bridge process replacement, and material route change. Cross-host ordering is undefined: fleet views are projections keyed by `hostId + entity id`, never one global sequence. This is snapshot-plus-delta synchronization, not a promise of exactly-once delivery.

Native coalesces noisy updates, enforces payload/count limits, and owns a `visible | hiddenWarm | background` activity state. Only visible surfaces receive live deltas in v1. Hidden-warm and background surfaces keep no unbounded push queue and recover from snapshots when visible again.

### Routing and fleet provenance

- Native internally keys machines by paired bridge public-key hex. The page receives only a stable derived fingerprint `hostId`, mapped in both directions by native; display names are labels and may collide.
- Every lane, event, agent, conversation, dispatch row, and command result crossing the boundary carries `hostId`.
- Host selection is a surface-scoped set (`selectedHostIds`), not a mutually exclusive global focus. Swift remains the authority because it owns connectivity and trust.
- The native picker sends selection changes to the page; the page returns `LaneSelection { hostId, agentId, conversationId?, sessionId? }` as an untrusted UI hint. Updating native selection chrome grants no write authority.
- Before any composer, ask, or review mutation, native requires exactly one currently connected destination, re-resolves the asserted route against that host's bridge-backed inventory or a fresh semantic RPC, and rejects mismatches with `invalid_route`. It never best-effort falls through to another selected host.
- Message text remains payload; it does not encode routing in body mentions.
- Cross-host aggregation is a read projection. Writes resolve to one explicit host, channel, or broker route and return ordinary Scout receipts. A channel write uses a host proven able to own or route that channel, or requires operator host selection; it never chooses an arbitrary member of `selectedHostIds`.

## Asset pipeline

### Build output

Add a dedicated Vite build mode for native surfaces rather than copying the full web application output. It should emit, for example:

```text
apps/ios/Scout/Resources/WebSurfaces/
  manifest.json
  shared/<content-hashed assets>
  lanes/index.html
  dispatch/index.html
```

Requirements:

- relative asset URLs suitable for `file:` loading;
- content-hashed immutable assets;
- one shared runtime/vendor graph where practical;
- only the registered native surface entry points;
- a generated manifest containing surface ids, entry files, asset revision, bridge protocol range, and integrity hashes;
- no source maps, dev server client, remote fonts, analytics, or runtime CDN imports in Release;
- a WebKit-tested Content Security Policy that defaults to no network (`connect-src 'none'`) and permits only the bundled `file:` scripts, styles, fonts, and images the build needs; do not assume `'self'` behaves like an HTTP origin under `file:`.

The generated directory is a release input, not hand-edited source. Its generation command must be deterministic and checked by CI. The manifest records the Bun/Node and Vite versions plus the lockfile hash used to produce it. CI builds the surfaces twice from clean checkouts and rejects hash divergence. The recommended repository policy is to commit generated assets and have CI regenerate and fail on a diff; if the repository instead chooses mandatory build-time generation, Xcode must still fail with an actionable error when the manifest or required entry is missing rather than shipping an empty surface.

### Xcode integration

Declare `Resources/WebSurfaces` as a synchronized resource directory in `apps/ios/project.yml`, regenerate the Xcode project, and add a pre-build validation step. The application selects:

```swift
.bundled(directory: "WebSurfaces/lanes", indexFile: "index.html")
```

Hudson resolves the index and calls `loadFileURL`, allowing read access to the common `WebSurfaces` root so shared hashed assets remain available. This makes all entries in that root mutual file-read peers by design; no secrets belong there. Navigation outside the root or to a non-file URL is denied. `https` links may be handed to a native allowlisted external-link action; `javascript:`, `file:` escalation, and custom schemes are rejected. New web-view creation, JavaScript panels, and service workers are disabled for embedded surfaces.

### Debug override

`SCOUT_WEB_BASE_URL` may keep loading a remote page only under `#if DEBUG`. When active:

- the toolbar displays a persistent `REMOTE WEB DEV` badge and the origin;
- the production native bridge is disabled in remote-page mode in v1—never mixed with same-origin host APIs;
- inspection is Debug-only, and bundled Release surfaces use a non-persistent store with back/forward gestures disabled;
- automated Release tests prove the override string/path cannot select `.paired` or `.hosted` content.

## HudsonUIWeb changes

Extend Hudson with general primitives, covered by Hudson tests:

- a file source with explicit read-access root and `loadFileURL` behavior;
- user-script/content-world configuration;
- named request/reply message handlers with deterministic teardown and no retain cycle;
- navigation-policy and `WKUIDelegate` callbacks that block replacement/new windows by default;
- process-termination notification and reload support;
- visible/hidden-warm/background activity input;
- no Scout protocol types or Scout handler names in Hudson.

Hudson teardown must remove the named handler and installed user scripts, cancel or resolve every outstanding reply, stop loading, and release delegates. `webViewWebContentProcessDidTerminate`, explicit reload, and dismantle use the same cleanup path before reconstruction.

`HudWebSurfaceLifecycle.keepWarm` remains a host hint, not an activity signal. The Swift host explicitly tells the gateway whether the surface is visible, hidden-warm, or backgrounded. The gateway, not page-side unsubscribe behavior, stops forwarding deltas when the surface is not visible.

## Surface migration

### Phase 0 — contract and fixtures

1. Define protocol TypeScript types in a small shared module under `packages/web`, with no schema-codegen dependency in v1. Generate a golden JSON fixture corpus from those types; hand-maintained Swift `Codable` types must decode the corpus in parity tests. Revisit code generation only if fixture drift escapes CI.
2. Add Swift `Codable` counterparts and fixture parity tests.
3. Inventory the exact Lanes and Dispatch calls; do not expose a generic arbitrary-RPC escape hatch.
4. Add protocol/version and per-method size/deadline limits.
5. Resolve each closed v1 method to an existing semantic mobile procedure, a named new procedure, or an intentionally deferred feature.

### Phase 1 — local shell and assets

1. Add the native-surface Vite entries and manifest.
2. Add Hudson local-file and bridge hooks.
3. Meet the Hudson blocking gate: file read root, reply handler lifecycle, navigation and UI delegate policy, process-termination recovery, activity state, and zero Scout-specific types.
4. On a physical device, prove the Vite module entry and at least one dynamic-import chunk load from the bundle. If WebKit file-origin behavior is unreliable, emit a single-file IIFE/classic entry per surface instead of weakening the trust boundary.
5. Bundle both pages and render useful disconnected/loading/incompatible states with airplane mode enabled.
6. Retain the current remote route only as the explicit Debug override.

### Phase 2 — Lanes first

1. Move agent listing, observe polling, recent tail, and live tail behind `ScoutSurfaceClient`.
2. Implement the Swift Lanes gateway over every selected connected `BridgeBrokerClient`.
3. Namespace lane identity as `hostId + agent/session identity` and merge snapshots deterministically.
4. Return lane selection to native, preparing the later Deck composer.
5. Preserve the current list/grid/floor modes and fixture-driven rendering in browser and native adapters.

### Phase 3 — Dispatch

1. Move diagnostics, control-event subscription, ask, forward, and review behind the same client boundary.
2. Add explicit host or channel routing to mutations; never broadcast because multiple hosts are selected.
3. Preserve Scout receipts (`messageId`, `conversationId`, `flightId`, `workId`, `ref`) across the bridge.

### Phase 4 — enforce the rule

1. Cut over each surface independently: Lanes switches its production descriptor to `.bundled` when Phase 2 acceptance passes; Dispatch switches when Phase 3 acceptance passes. Neither waits for the other, and both gateways operate over the existing keyed `BridgeBrokerClient` map without requiring SCO-063.
2. After the final surface cutover, remove the remaining production uses of paired/hosted page loading from iOS mission-control surfaces.
3. Add a lint/test that every iOS `HudWebSurfaceDescriptor` is `.bundled` outside a clearly named Debug factory.
4. Remove or narrow App Transport Security exceptions that only existed for the production HTTP paired-page path.
5. Document the local-asset/host-data rule as the template for future iOS embeds.
6. Add telemetry limited to local diagnostics: asset revision, protocol version, method, latency bucket, payload size, truncated host fingerprint, and stable error code—never prompts, full pairing keys, or agent output.

### Phase 5 — Scout Deck assembly

Once Lanes returns typed selection and accepts a host-set projection, build the iPad Deck shell:

- native multi-select host picker using the existing fleet inventory;
- bundled Lanes grid/canvas as the central surface;
- native message input bound to one exact selected lane route;
- optional union/all-host read mode, while every write remains explicit.

This phase is a consumer of the architecture, not a prerequisite for converting Dispatch.

## Security and reliability rules

- The page receives no bridge secrets, bearer tokens, relay rooms, raw public keys beyond the stable opaque/fingerprinted host id needed for provenance, or direct host URLs.
- Native validates method, surface, protocol version, host scope, field lengths, collection counts, and encoded byte size before dispatch.
- Page-supplied lane and route identifiers never authorize writes. Native re-validates one exact route against the selected connected host before every mutation.
- The page cannot navigate to or execute paired-host content. Only allowlisted `https` external links may reach native policy handling.
- Release assets make no network requests. A WebKit content-rule/CSP defense in depth should reject accidental requests.
- Each request has cancellation and a deadline. Page reload, surface teardown, host deselection, and app backgrounding cancel obsolete work.
- Snapshot concurrency is bounded per host; one unreachable Mac must not block rendering data from the rest of the selected fleet.
- Partial failure is first-class: results include per-host readiness/errors, never one misleading global `connected` bit.
- The broker remains the canonical writer for Scout-owned messages, invocations, flights, deliveries, and bindings. The bridge only submits commands and observes results.
- Harness transcript material remains observed data and is not promoted into Scout-owned messages by the embed gateway.

### Backpressure defaults for v1

- At most four host fan-out reads run concurrently.
- A request/reply payload is at most 1 MiB encoded; one push is at most 256 KiB encoded.
- Tail and diagnostics deltas coalesce per host over a 50–100 ms window.
- The native-to-page push queue is bounded at 32 items. Queue overflow or JavaScript evaluation failure drops that stream, advances its epoch, and forces snapshot recovery; it never grows an unbounded buffer.
- Host deselection cancels its in-flight work promptly, and every multi-host result carries per-host readiness or error state.

## Verification and acceptance criteria

### Build and asset integrity

- Native-surface build is reproducible from a clean checkout; CI performs two clean builds with the manifest-pinned toolchain and compares hashes.
- Every manifest hash matches the embedded file; missing/stale assets fail CI and Xcode validation.
- A Release archive contains the Lanes and Dispatch entries and no dev-server client.
- Static analysis of Release iOS source/build settings finds no enabled paired/hosted page path.

### Local-page behavior

- With all networking disabled, both tabs render their branded local shell plus disconnected state.
- A network capture while loading/reloading shows no HTML, JavaScript, CSS, font, or image request to a paired Mac or public host.
- Relative modules, shared chunks, fonts, and icons load from the allowed bundle directory.
- A device test exercises an actual dynamic import; the accepted fallback is a tested single-file classic/IIFE entry, not remote loading.
- Invalid navigation and `window.open` are rejected or routed through native policy.
- Instrumented Lanes JavaScript cannot make a network request or replace its document with an external URL.

### Protocol behavior

- TypeScript and Swift decode the same golden request/reply/event fixtures.
- Unsupported versions and methods render actionable local errors.
- Duplicate deltas are idempotent; epoch mismatches, sequence gaps, reconnects, and process replacement force snapshot recovery without applying stale deltas.
- Cancellation, background/foreground, web-process termination, page reload, and host disconnect are covered.
- Handler teardown resolves outstanding replies, removes scripts/handlers, and does not retain the coordinator.
- Oversized payloads, invalid host ids, and mutations without one explicit destination fail closed.

### Product behavior

- Web Lanes and bundled Lanes render the same fixture data and retain list/grid/floor behavior.
- Selecting two or more Macs produces one deterministic lane union with visible host provenance and independent partial-failure states.
- Selecting a lane returns its exact host and route to native.
- Dispatch preserves durable Scout receipts and never turns a selected host set into an implicit broadcast.
- Debug remote mode remains fast to use, visibly marked, and unavailable in Release.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Web and native adapters drift | Golden semantic fixtures, adapter contract tests, one React component tree |
| Bridge becomes a generic second API | Surface capability allowlist; no arbitrary endpoint/RPC passthrough |
| Large snapshots stall WebKit | Pagination, bounded concurrency, payload limits, coalesced deltas, instrumentation |
| Multi-host ids collide | Key every projected entity with stable `hostId`; labels are presentation only |
| File-origin quirks break chunks/assets | Dedicated relative-base build; explicit shared read domain; physical-device module/dynamic-import gate; IIFE fallback |
| Warm hidden surfaces leak work | Native-authoritative activity state; hidden/background delta forwarding disabled |
| Stale generated bundle ships | Manifest hashes plus pre-build and CI validation |
| Release accidentally regains remote UI | Compile-time Debug factory, source lint, archive/network tests |
| Native composer routes to wrong Mac | Page selection is untrusted; native re-resolves one explicit route before every write |

## Alternatives considered

### Keep the paired Mac web page

Rejected for production. It keeps development iteration simple but makes the app shell dependent on a host web server, prevents honest offline rendering, and couples one page origin to one focused host.

### Ship a tiny HTTP server inside iOS

Rejected. It makes relative fetches easy but preserves endpoint-shaped coupling, adds a local server lifecycle and attack surface, and hides the desired native capability boundary.

### Patch `window.fetch` and WebSocket

Rejected. It is clever but fragile, hard to version, and obscures which operations are supported. A typed adapter gives compile-time discovery and explicit errors.

### Rewrite Lanes and Dispatch in SwiftUI

Rejected. The web implementations are already the canonical, rapidly evolving surfaces—especially for dense grid/canvas interaction. Native should own fleet trust, routing, and the surrounding Deck chrome, not duplicate the renderers.

### Let local JavaScript connect directly to every Mac

Rejected. It would duplicate host discovery/auth/reconnect in JavaScript, expose connection material to page code, fight iOS lifecycle rules, and bypass the existing native fleet.

## External review synthesis

Three independent high-effort reviews approved the invariant with amendments and found no reason to retain production remote HTML:

| Reviewer | Model / effort | Scout receipt | Verdict | Material changes incorporated |
| --- | --- | --- | --- | --- |
| Grok | Grok 4.5 / highest | `ref:n-aft8ei` | Conditionally approve | Native write reauthorization, page-world event bridge, epoch recovery, closed allowlist, explicit shared file trust domain, Hudson blocking gate |
| Claude Code Fable | Claude Fable 5 / high | `ref:i-ivf3s2` | Adopt with amendments | Normative handler teardown, native activity authority, device module gate/IIFE fallback, derived host ids, navigation/UI policy, ATS follow-up |
| Kimi | Moonshot Kimi k3 / maximum | `ref:j-uglt87` | Feasible; approve with amendments | Adapter-issued cursors, closed Swift-decodable schemas, reload reset, per-surface cutover, deadline ceilings, toolchain pinning, browser adapter parity |

The amendments are incorporated in revision 2. The resulting implementation posture is deliberately narrow: no generic RPC bridge, no direct JavaScript networking in Release, no remote-page fallback, no implicit fleet broadcast, and no new fleet authority beside `AppModel` and the broker-backed clients.

## Remaining implementation decisions

1. Inventory the exact Lanes observe/tail fields absent from current mobile procedures and decide whether each extends an existing semantic capability or becomes a named surface projection.
2. Confirm the recommended committed-generated-assets policy, or document why mandatory build-time generation gives equivalent deterministic Xcode behavior.
3. Choose the smallest useful Dispatch capability slice after Lanes proves the bridge; diagnostics plus read-only subscription is the likely first increment.

Resolved by this review: v1 contract types live under `packages/web` with golden fixtures and no code generation; Hudson exposes generic plugin/configuration hooks rather than Scout types; host-set changes use `session.update` plus affected-host snapshots without reloading the page.

## Review rubric

Reviewers should classify findings as:

- `must_fix`: unsafe or infeasible before implementation;
- `should_fix`: material improvement to the proposed first release;
- `follow_up`: valid work that can land after the local-page invariant;
- `reject`: conflicts with the product boundary or adds unjustified scope.

Requested review lenses: WebKit/Hudson correctness, Swift concurrency and lifecycle, bridge protocol/versioning, Vite/Xcode asset reproducibility, fleet routing/provenance, broker data ownership, security, and migration sequencing.
