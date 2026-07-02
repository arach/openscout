# SCO-076: Xterm Super Component

## Status

Implementation direction. Use with `sco-075-terminal-pty-parity-inventory.md`.

## Date

2026-07-01

## Decision

OpenScout is going all-in on the xterm path for terminal experiences that need
more than one surface.

- Native Termini/Ghostty remains the Apple-native single-terminal path.
- Any multi-terminal, tiled, remote, attachable, agent-backed, or flexible
  layout experience should use the xterm component.
- Scout should consume the component. Hudson should own the reusable terminal
  primitive, protocol, and documentation.

The native macOS app should not grow a second competing terminal product. Its
xterm screen is a host for the Hudson terminal component.

## Product Shape

The default UI should be simple:

- Header controls: renderer switch, new shell, new variants, attach, reload all.
- Body: stable grid of terminal tiles.
- Empty state: new shell plus attach.
- Tile header: identity, backend, reload, close, open externally.
- No hidden home tab.
- No separate tab strip unless a later design proves it is necessary.
- No draggable/resizable cockpit until the stable grid is boringly reliable.

## Component Contract

The Hudson xterm component should expose one primary surface:

```ts
<HudTerminalGrid
  tiles={tiles}
  createTile={...}
  attachTile={...}
  closeTile={...}
  reloadTile={...}
  transport={terminalRelayTransport}
/>
```

The component owns:

- xterm construction and disposal.
- xterm add-ons: fit, webgl, search, serialize, unicode11, web-links.
- Renderer policy: DOM/WebGL selection, context-loss recovery, fallback.
- Stable tile identity so a selection, hover, resize, attach refresh, or parent
  render does not recreate a terminal.
- Fit and resize scheduling.
- Focus and keyboard capture.
- Paste/drop/read-only policy.
- Scrollback, alt-buffer, search, link handling, title, bell, and status.
- Loading, reconnecting, failed, readonly, paused, and detached states.
- Metrics hooks for throughput, dropped chunks, ACK lag, frame cost, and reloads.

Scout owns:

- Route construction.
- Agent/session registry.
- App-level toolbar placement.
- Native shell embedding only for the single-terminal native path.

## Reload Rule

A terminal tile must not reload unless one of these changes:

- The route/session identity changes.
- The user explicitly reloads the tile.
- The renderer process crashes and recovery requires remount.

Specifically, these must not reload a terminal:

- Hovering a tile.
- Selecting a tile.
- Refreshing attach targets.
- Parent SwiftUI/React render.
- Changing unrelated toolbar state.
- Recomputing grid dimensions.

## Performance Strategy

The xterm implementation should converge on the parity inventory from SCO-075:

- ACK-based output flow control from xterm write completion.
- Bounded pending queues on the server and client.
- Per-terminal high/low water marks.
- Active tile prioritization.
- Hidden/background tile throttling.
- Chunking large bursts before renderer writes.
- WebGL auto policy with DOM fallback.
- Renderer context-loss and blank-canvas recovery.
- Resize/fitting coalesced by animation frame.
- No unbounded scrollback or JSON-message storms.

## Current Native App Host

The macOS xterm host is intentionally plain:

- It renders only actual terminal tiles in a stable SwiftUI `LazyVGrid`.
- It no longer passes WKWebView tiles through `HudTiling`, because that tiler
  recreates hosted views during ordinary updates.
- It has no Home tile and no tab strip.
- It keeps the native renderer switch only so single-terminal native can still
  be reached.

This is a host-level simplification, not the final reusable component API.

## Verification Bar

Before calling the Hudson component production-ready:

- Create, attach, reload, and close tiles without unrelated reloads.
- Run at least 4 active tiles for several minutes with no flicker.
- Sustain large PTY output without UI lockup or unbounded memory growth.
- Verify WebGL on/off/auto and DOM fallback.
- Verify tmux and zellij attach paths.
- Verify read-only observe mode.
- Verify macOS native host and browser host.
- Add regression coverage for route config, relay ACKs, and no-remount identity.

