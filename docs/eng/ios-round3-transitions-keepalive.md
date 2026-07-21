# iOS — round 3: system-wide transitions + instant back (keep-alive surfaces)

Handoff spec, round 3. Builds on `ios-home-tightness-pass.md` and
`ios-home-elite-pass.md` — both implemented, uncommitted in the working tree.
Do not revert them; you'll touch some of the same files.

Repo root: `/Users/art/dev/openscout`. Scope: `apps/ios/Scout/` only.

Files you may touch:

- `apps/ios/Scout/RootView.swift` — surface switching lives here
- `apps/ios/Scout/*.swift` — the other surfaces (AgentsSurface, TailSurface,
  CommsSurface, TerminalSurface, NewSessionSurface, HomeSurface)
- NEW files under `apps/ios/Scout/` for shared transition helpers (preferred
  over duplicating per surface).

Guardrails (unchanged):

- `apps/ios/Scout/` only. No commits. No new dependencies. No white-alpha fills.
- Verify with the same simulator build invocation as round 2 (destination
  `platform=iOS Simulator,id=C97CB588-2448-4341-BA7C-80868C710C40`, DerivedData
  `apps/ios/.deriveddata/screenshots`, `HUDSONKIT_WITH_TERMINAL=1`, ad-hoc
  signing with `apps/ios/scripts/Scout.simulator.entitlements` as an ABSOLUTE
  path — relative breaks SwiftPM targets).
- Honor `accessibilityReduceMotion` everywhere: transitions collapse to
  instant.
- Do NOT touch the etched wordmark / `scout.home.fx.*` toggles — they stay
  as they are.

## A. Keep-alive surfaces (instant back)

Today `RootView.body` mounts exactly one surface via `switch surface` inside a
`Group` (RootView.swift:92-149). Switching tabs DESTROYS the previous surface:
state, scroll position, and any in-flight `.task` work are lost, and returning
to Home re-fetches and replays its entrance. The operator feels this as "back
is slow".

Replace with a keep-alive container:

- All top-level surfaces the tab bar can show (phone: Home, Agents, Tail,
  Comms, Terminal, New; iPad adds Lanes/Dispatch) stay mounted in a `ZStack`.
  The active one is fully visible; inactive ones get `.opacity(0)`,
  `.allowsHitTesting(false)`, and `.accessibilityHidden(true)`.
- Each surface keeps its own `@State`, scroll position, and loaded data —
  returning must be instant: no refetch flash, no skeleton, no entrance replay.
- Tab switch itself: a quick, quiet crossfade (~160-200ms ease-out) between
  surfaces. No sliding, no hero moves.
- Gate per-surface polling while hidden: pass an `isActive` Bool (or
  equivalent) into each surface so its `.task` poll loops (e.g. Home's 30s
  `load()` cycle, Root's `refreshFleetStats` loop at RootView.swift:182-191)
  sleep while the surface is inactive, and resume on return. First activation
  after a hidden period may refresh immediately if its data is stale, but must
  render existing state first — no skeleton on revisit.
- The entrance choreography from round 2 (staggered lanes, draw-on sparkline)
  plays ONCE per surface per app launch, on its first activation only. Revisit
  = instant static render.
- Watch for: TerminalSurface holding terminal resources — keep-alive is the
  desired behavior there (no reconnect on revisit); just make sure nothing
  double-subscribes when the surface becomes active again.

## B. Transitions for every screen

Extend the round-2 entrance language beyond Home so every surface assembles
the same way on first appearance:

- Extract the pattern into one small reusable modifier (e.g. a
  `cockpitEntrance(index:)` view modifier: opacity 0→1 + 6-8pt vertical
  settle, staggered ~35ms by index, matched spring `response: 0.34,
  dampingFraction: 0.82`) and apply it to the primary content blocks of each
  surface — Agents rows/groups, Tail event rows, Comms conversation rows,
  New composer's sections. Don't invent per-screen snowflakes; one language,
  same timing.
- Row-insertion animation (new items slide+fade in) where surfaces already
  animate list changes — keep consistent with Home's activity lane.
- First-appearance only, per surface, per launch (same rule as A).

## Report back

Changed/added files, build result, how keep-alive interacts with each
surface's polling, and any deviations (with why).
