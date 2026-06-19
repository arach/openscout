# SCO-068 Unified Native Settings

Status: ready for implementation
Owner: Claude handoff
Created: 2026-06-17

## Prompt For Claude

Build a unified Settings surface in the main macOS Scout app and retire the separate Scout Menu settings window as a user-facing product surface.

The current menu-helper settings window is useful operationally, but as a product shape it is wrong: users should not have to understand that there are two apps. The menu helper should keep doing helper work, but settings should live in the main Scout app next to Comms, Agents, Tail, Repos, and Appearance.

Use this screenshot as the current-state reference, not as the desired final design:

`/Users/arach/Library/Application Support/Talkie/Tray/screenshots/Talkie Capture - 2026-06-17 16.16.31 - Window Scout Menu - 1105x745 - 70e25b9b.png`

## Product Decision

Scout has one user-facing settings home: `Scout.app` -> Settings.

`ScoutMenu.app` remains a supervision and wake helper:

- menu bar lights
- quick open actions
- broker / relay / web restart actions
- Tailscale launch
- `scout://services/*` execution
- wake or foreground Scout

`ScoutMenu.app` should not own a separate Settings window. Its Settings menu item should open Scout and route to the main Settings page.

## Current State

Main app settings live in:

- `apps/macos/Sources/Scout/ScoutSettingsView.swift`
- `apps/macos/Sources/Scout/ScoutRootView.swift`
- `apps/macos/Sources/Scout/ScoutApp.swift`

The main app settings page currently covers:

- Appearance
- About

Menu helper settings/status live in:

- `apps/macos/Sources/ScoutMenu/Views/SettingsWindow.swift`
- `apps/macos/Sources/ScoutMenu/OpenScoutAppController.swift`
- `apps/macos/Sources/ScoutMenu/Services/BrokerService.swift`
- `apps/macos/Sources/ScoutMenu/Services/PairingService.swift`
- `apps/macos/Sources/ScoutMenu/Services/TailscaleService.swift`
- `apps/macos/Sources/ScoutMenu/Services/OpenScoutNetworkSettingsStore.swift`
- `apps/macos/Sources/ScoutMenu/Services/OpenScoutToolchain.swift`

Recent OSN setting work added:

- persisted settings under `~/Library/Application Support/OpenScout/settings.json`
- `network.openScoutNetwork.discoveryEnabled`
- `network.openScoutNetwork.rendezvousUrl`
- `network.openScoutNetwork.pairingRelayUrl`
- `network.openScoutNetwork.keepPairingRelayRunning`
- service env propagation so OSN can switch broker advertising to mesh
- menu UI controls for publishing this Mac and keeping the mobile relay available

Keep that behavior, but move the user-facing controls to the main app.

## Desired Information Architecture

`ScoutSettingsView` should become the unified product settings surface with these sections:

1. **Overview**
   - Compact system state summary.
   - Broker, Web, Relay, Tailnet, and OpenScout Network status.
   - Should answer: "Is Scout healthy and reachable?"

2. **Network**
   - OpenScout Network controls:
     - Publish this Mac
     - Keep mobile relay available
     - Sign in / signed-in state
     - Discovery URL
     - Relay URL
   - Tailnet / Tailscale state:
     - installed / running / peer count
     - Open Tailscale action
   - Route posture:
     - local broker URL
     - mesh advertised broker URL when available
     - local / mesh advertise scope

3. **Services**
   - Broker, Web, Relay service cards.
   - Each card needs state, detail, pid where applicable, and primary repair action.
   - Actions:
     - Restart broker
     - Restart relay
     - Restart web
     - Reveal logs where available
   - This page is operational but still polished. It should not feel like a raw debug dump.

4. **Appearance**
   - Preserve the existing appearance controls.
   - Do not regress theme/accent/window material behavior.

5. **About**
   - Preserve version/build/bundle info.
   - Add settings file path if useful, but it should be secondary.

Do not keep an `Advanced` section just to hide important controls. If a control affects user reachability, it belongs in Network or Services.

## Visual Direction

Make it beautiful and more technical.

This should feel like a serious local control-plane console, not a generic preferences dialog:

- dense but calm
- strong typography hierarchy
- technical labels with human summaries
- status lights and small glyphs
- tabular metadata for URLs, PIDs, paths, and scopes
- subtle linework and precise spacing
- no decorative gradients, blobs, or hero treatment
- no giant cards inside cards
- do not make everything one color family
- use existing Scout/Hudson design tokens (`ScoutDesign`, `ScoutPalette`, `HudSpacing`, `HudFont`, `HudRadius`, `HudStrokeWidth`)

Suggested layout:

- left settings sidebar remains
- content width can grow beyond the current appearance page if needed
- Overview page uses a compact status grid
- Network page uses a route/status composition:
  - "This Mac" column
  - "OpenScout Network" column
  - "Tailnet" column
  - route metadata underneath
- Services page uses repeated service rows/cards with clear actions

Avoid the current helper-window feeling: the screenshot reads like a small debug panel. The new surface should feel like the main app’s technical settings cockpit.

## Architecture Guidance

Do not duplicate service/status logic between targets.

Move shared, product-relevant settings/status clients into `ScoutAppCore` where possible:

- OSN settings store
- OSN session state helpers already live in `ScoutAppCore` (`OpenScoutNetworkSessionStore`)
- broker status/control client
- pairing relay status/control client
- tailscale state/control client if shared by both apps

Keep helper-only process launch logic in the helper target when it truly belongs there:

- `OpenScoutToolchain`
- launch-agent specific wiring
- helper popover/menu-only presentation

The main app can use shared `ScoutAppCore` service clients for status and actions. The menu helper can also consume those shared clients instead of owning duplicate implementations.

If moving all services at once is too large, first move only the minimal shared pieces needed by `ScoutSettingsView`, but leave clear ownership boundaries:

- product settings data model in `ScoutAppCore`
- user controls in `Scout.app`
- supervision helper window retired

## Routing From Menu Helper

Change the menu helper Settings item:

- Do not open `SettingsWindowController`.
- Instead foreground `Scout.app` and route to Settings.

Preferred implementation:

- add a Scout app command for opening Settings, similar to the existing open-channel command:
  - `ScoutExternalCommand.openSettings()`
  - notification name such as `com.openscout.app.open-settings`
  - `ScoutRootView` handles it by setting `section = .settings`
- teach `ScoutAppBridge` or the helper to launch Scout with a settings command if Scout is cold.
- keep this consistent with current `--channel` and HUD routing patterns.

Do not route this through web settings. This is native app settings.

## Main App Behavior Requirements

The unified settings page must:

- read and write the same `~/Library/Application Support/OpenScout/settings.json`
- preserve unknown keys in the settings file
- use the same OSN Keychain session (`OpenScoutNetworkSessionStore`)
- changing "Publish this Mac" must persist `network.openScoutNetwork.discoveryEnabled`
- changing "Keep mobile relay available" must persist `network.openScoutNetwork.keepPairingRelayRunning`
- enabling publish with a valid session should ensure the OSN relay bridge is started or restarted
- disabling publish should stop auto-maintaining OSN presence, but should not destroy trusted pairings
- sign-in opens the configured rendezvous auth URL:
  - default `https://mesh.oscout.net/v1/auth/github/start?return_to=/v1/auth/native/complete`
  - derive host from `rendezvousUrl` so non-default deployments still work

## Menu Helper Retirement Scope

Retire only the standalone settings window, not the helper app.

Remove or stop using:

- `SettingsWindowController`
- `SettingsRootView`
- `SettingsWindow.swift` user-facing Settings window entry point

Keep or migrate:

- menu popover service lights
- context menu quick actions
- `scout://services` HMAC execution
- OSN auth callback forwarding
- helper auto-start behavior

If it is safer to leave `SettingsWindow.swift` temporarily unused, that is acceptable for a first PR, but the Settings menu item must no longer open it. Add a TODO only if deletion would create churn.

## Copy Guidelines

Use concise, product-grade labels:

- "Publish this Mac"
- "Keep mobile relay available"
- "OpenScout Network"
- "Tailnet"
- "Broker"
- "Relay"
- "Web"
- "Signed in"
- "Not signed in"
- "Advertised URL"
- "Local URL"
- "Launch agent"

Avoid:

- "OSN disco"
- "debug"
- "advanced"
- "bridge absent" in ordinary UI
- long explanatory paragraphs

When a problem exists, use actionable language:

- "Sign in to publish this Mac through OpenScout Network."
- "Relay is stopped. Restart relay to allow paired mobile clients to reconnect."
- "Broker is local-only. Enable OpenScout Network or Tailnet advertising to reach it from other devices."

## Non-Goals

- Do not change iOS route preferences.
- Do not change broker ownership rules.
- Do not change OSN relay protocol.
- Do not persist OSN session tokens into launchd plists.
- Do not move Scout-owned records out of the broker.
- Do not add a web settings page for this.
- Do not add a marketing or onboarding page.

## Implementation Plan

1. Add a shared settings/status model in `ScoutAppCore`.
   - Start with OSN settings and session state.
   - Add status structs for broker, pairing, tailscale, and web if they can be shared cleanly.

2. Extend `ScoutSettingsView`.
   - Add `Overview`, `Network`, and `Services` sections.
   - Keep `Appearance` and `About`.
   - Use local state objects or shared stores that poll only while Settings is visible.

3. Add main-app settings actions.
   - Toggle OSN discovery.
   - Toggle keep-relay-running.
   - Sign in to OSN.
   - Restart broker / relay / web.
   - Open Tailscale.
   - Reveal logs.

4. Route helper Settings into Scout.
   - Add an open-settings command path.
   - Change the helper context menu Settings action to use it.
   - Confirm cold-start and already-running behavior.

5. Retire helper settings UI.
   - Stop presenting `SettingsWindowController`.
   - Remove the old window if low-risk, otherwise leave unused with a clear TODO.

6. Polish.
   - Verify text does not overlap at 1040x680 minimum.
   - Verify long paths/URLs truncate in the middle.
   - Verify toggles and buttons remain aligned in light/dark themes.
   - Verify the design reads technical and first-class, not like a small utility panel.

## Acceptance Criteria

- Main Scout app Settings contains Overview, Network, Services, Appearance, and About.
- OpenScout Network settings are editable from the main app.
- The menu helper Settings item opens the main Scout Settings page.
- The separate helper settings window is no longer reachable from normal UI.
- Existing appearance settings still work.
- Broker/Web/Relay/Tailscale status are visible in the main settings surface.
- Restart actions still work.
- OSN publishing still results in:
  - broker advertised as mesh when setting is enabled
  - relay using `wss://mesh.oscout.net/v1/relay`
  - pairing runtime remains live when "Keep mobile relay available" is on
- Settings file preserves unrelated keys.
- No OSN session secret is written to launchd or JSON settings.

## Verification

Run:

```bash
swift build --package-path apps/macos
bun run macos:restart
bun run scout:dev
```

Then verify manually:

- Open Scout main app.
- Navigate to Settings.
- Confirm Network page shows OpenScout Network controls.
- Toggle "Publish this Mac" off and on.
- Toggle "Keep mobile relay available" off and on.
- Confirm settings JSON updates:

```bash
cat "$HOME/Library/Application Support/OpenScout/settings.json"
```

- Confirm pairing runtime when enabled:

```bash
cat "$HOME/.scout/pairing/runtime.json"
```

- Confirm mesh posture when enabled:

```bash
bun apps/desktop/bin/scout.ts mesh --json
```

Expected:

- `localNode.advertiseScope` is `mesh`
- `localNode.brokerUrl` uses the Tailscale host, not `127.0.0.1`
- no mesh warning about local-only advertising
- pairing relay is `wss://mesh.oscout.net/v1/relay`

## Worktree Safety

Before implementation, check `git status`.

At the time this spec was written, there were unrelated local edits in:

- `apps/macos/Sources/Scout/ScoutCommsView.swift`
- `apps/macos/Sources/Scout/ScoutRootView.swift`

Do not revert or silently include unrelated work. If those files still have unrelated changes, work around them or ask before staging.
