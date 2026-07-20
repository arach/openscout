# iOS Home — "elite" pass (grain/light · motion · identity)

Handoff spec, round 2. Builds on `ios-home-tightness-pass.md` (already implemented, uncommitted in the working tree — do not revert it; `git status` shows it as the same three files you'll touch).

Repo root: `/Users/art/dev/openscout`. Scope: iOS app only.

Files you may touch:

- `apps/ios/Scout/Theme.swift` — canvas, tones, tokens
- `apps/ios/Scout/HomeSurface.swift` — the Home dashboard
- `apps/ios/Scout/RootView.swift` — masthead, tab bar, ask dock area
- NEW files under `apps/ios/Scout/` are allowed for self-contained helpers (grain view, motion modifiers) — prefer that over growing Theme.swift.

Guardrails (same as round 1):

- Do NOT touch anything outside `apps/ios/Scout/`. Other uncommitted work exists in the repo; leave it alone.
- Canvas grammar stays: caps-mono headers, hairlines, ScoutVibe palette, dark cockpit. No new dependencies, no white-alpha fills on dark surfaces.
- No commits. Leave the diff for review.
- Verify with a simulator build: `xcodebuild -project apps/ios/Scout.xcodeproj -scheme Scout -configuration Debug -destination 'platform=iOS Simulator,id=C97CB588-2448-4341-BA7C-80868C710C40' -derivedDataPath apps/ios/.deriveddata/screenshots SDKROOT=iphonesimulator CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="-" AD_HOC_CODE_SIGNING_ALLOWED=YES CODE_SIGN_ENTITLEMENTS=apps/ios/scripts/Scout.simulator.entitlements build` with `HUDSONKIT_WITH_TERMINAL=1` set. (That destination sim exists and is booted.)
- Everything honors `Reduce Motion` (`@Environment(\.accessibilityReduceMotion)`): when on, all animation from this spec collapses to instant/static.

## Experiment toggles

Gate each of the three ideas behind its own `@AppStorage` flag so effects can be
judged independently via simulator screenshots (flipped with `defaults write`):

- `scout.home.fx.grain` (idea 1)
- `scout.home.fx.motion` (idea 2)
- `scout.home.fx.identity` (idea 3)

Default all three to **true**. Keep the gating trivial to strip later (one
`@AppStorage` + one `if` per effect, grouped where readers can find them).

## 1. Grain + reactive light (`scout.home.fx.grain`)

The near-black gradients band on OLED; banding is the amateur tell.

- Add a fine film-grain overlay above `ScoutCanvas` (Theme.swift, the
  `ScoutCanvas` view), ~2-3% opacity, monochrome noise. Implementation choice is
  yours but keep it cheap: a small procedurally-generated noise texture tiled,
  or a Canvas-drawn dither — no per-frame work, no third-party assets. It must
  be `.allowsHitTesting(false)` and behind all content interactions exactly like
  the existing canvas layers.
- Make the existing top key-light reactive: subtly brighter (and very slightly
  wider) while any agent is live, settled when idle. Source of truth already
  exists (`model.activeAgentCount` / live agents on Home). The transition must
  be slow (≥1.2s ease) — a breathing room, not a blink. The light state is a
  function of fleet state, so derive it, don't add state machines.

## 2. Instrument choreography (`scout.home.fx.motion`)

State changes currently cut. Make instruments arrive. All springs match the
existing tab-switch family (`response: 0.34, dampingFraction: 0.82`) unless noted.

- `FleetSparkline`: draws itself left-to-right on first appearance (a `trim`
  animation, ~0.9s, ease-out). When new samples arrive while visible, animate
  the path change rather than swapping.
- Quota `windowMeter`s: fill animates from 0 to value on first appearance with a
  spring; the percent text counts up over the same duration (keep
  `monospacedDigit`; a simple `TimelineView`/`withAnimation` number tween is
  fine — no text morphing tricks).
- First-load lane assembly: on the loading→loaded transition, each lane
  (vitals, needs-you, working, activity) fades+settles in staggered ~35ms
  apart, 6-8pt of vertical settle, no spring overshoot. Once per surface
  appearance, not on every 30s poll.
- Activity rows: when a poll adds newer rows, they insert with a slide+fade
  from the top of the lane (SwiftUI `withAnimation` on the list change); rows
  leaving do so quietly. No animation for reorder-only updates.
- The live key-light from idea 1 participates in this system (same timing
  language) when both flags are on.

## 3. Signature artifacts (`scout.home.fx.identity`)

- Masthead wordmark: "SCOUT" (RootView.swift `titleBar`) becomes etched —
  render the tracked wordmark with a hairline stroke and a faint inner shadow
  (letterpress on the dark canvas; e.g. stroked text over a subtly offset dark
  duplicate). Keep size/tracking/position identical; this is a finish change,
  not a layout change.
- Ask dock as fleet lamp: the ask capsule's hairline edge carries a
  slow-breathing accent glow while any agent is live (≥2.4s breath cycle, low
  amplitude — a lamp, not a beacon), resting to the current neutral hairline
  when idle. Same fleet-state derivation as idea 1.
- Quiet-fleet emblem: when Home is loaded, connected, and there is genuinely
  nothing to show (no needs-you, no working rows, no activity), replace the
  sparse lanes with a composed "all clear": the scout/home glyph from
  `Glyphs.swift` drawn large in hairline strokes, one short accent datum line,
  and a single quiet caption (e.g. "All clear — the fleet is quiet." in the
  lane-header grammar). Centered in the content lane, generous negative space.
  This state is rare on busy fleets; it must not disturb any state that has
  content.

## Report back

Changed/added files, build result, the exact `@AppStorage` keys, and any
deviations from the spec (with why).
