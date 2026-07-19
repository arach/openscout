# iOS Home — elegance & tightness pass

Handoff spec. Scope: the iOS Home surface only. Repo root: `/Users/art/dev/openscout`.

Primary files:

- `apps/ios/Scout/HomeSurface.swift` — the Home dashboard (vitals, needs-you, working, activity, dock)
- `apps/ios/Scout/RootView.swift` — chrome around it (masthead host chips, tab bar, bottom readout bar)
- `apps/ios/Scout/Theme.swift` — ScoutVibe / ScoutInk / surface tokens

Guardrails:

- Other agents have uncommitted work in this repo (landing page, runtime). Do NOT touch `landing/`, `packages/runtime`, `packages/web`, or revert anything outside the three files above. Keep diffs scoped.
- Canvas grammar stays: caps-mono lane headers, hairlines, ScoutVibe palette, dark cockpit. No new dependencies, no white-alpha fills on dark surfaces (banned per Theme.swift).
- Everything stays real-data. No fake affordances, no placeholder content.
- Do not commit. Leave the diff for review.
- Verify with a simulator build before reporting: `xcodebuild -project apps/ios/Scout.xcodeproj -scheme Scout -destination 'platform=iOS Simulator,name=iPhone 16 Pro Max' build` (any recent iPhone sim destination is fine; `apps/ios/scripts/capture-screenshots.sh` shows the known-good invocations).

## A. Correctness — the Activity lane's silent failure (do first)

Diagnosed 2026-07-18: broker data and the `mobile/activity` bridge are healthy
(verified live: 48 rows returned, bridge log shows `✓ mobile.activity` at ~30-100ms),
but Home's first `load()` can miss the activity leg (transient first-connect race;
no RPC reaches the bridge, no `mobile/comms/conversations` fallback either).
`try?` at `HomeSurface.swift:522` swallows it, the section hides
(`if !recentActivity.isEmpty`), the vitals sparkline flatlines (same empty array),
and the user reads it as "activity is dead". It self-heals on the next 30s poll
or pull-to-refresh, but nothing on screen ever says what happened.

Fixes:

1. Distinguish empty from unavailable in `load()`. Track whether the activity leg
   last succeeded (there is already `sawActivityRead` / `activityScopeKey`; add an
   explicit "last activity read failed" state). When the read failed, render a
   quiet inline note in the Activity lane ("Activity unavailable — retrying")
   styled like `notConnectedHint`, instead of hiding the lane. Genuine emptiness
   keeps hiding the lane.
2. Make the 30s poll retry the failed leg independently: if the activity read
   failed but agents succeeded, the next cycle must re-attempt activity (it
   already re-runs `load()`; just make sure a failed activity leg doesn't get
   masked by the `activityScopeKey == scopeKey` early-keep path at
   `HomeSurface.swift:539-544`).
3. `sortedActivity` (`HomeSurface.swift:497`): dedupe by broker event id before
   sorting/trimming. The same broker event visible through 2+ paired machines
   currently lands once per machine (`machine.id::event.id` keying only feeds
   `Identifiable`). Collapse on the raw `event.id`.

## B. Tightness

4. Activity lane: remove the fixed 8-row inner `ScrollView`
   (`activityViewportRows` / `.frame(maxHeight:)` at `HomeSurface.swift:360-377`) —
   a vertical scroll inside the outer scroll is a gesture trap. Render up to 5
   rows inline, no inner scroll; the existing "All ›" header action covers the
   rest. While there: drop the leading clock column in `ActivityRow` in favor of
   a trailing relative age, matching the Working/Needs-you rows (one time grammar
   per surface).
5. Delete `machineRail` (`HomeSurface.swift:195-214`) — it duplicates the masthead
   host chips in `RootView.swift:443-467` on the same screen. The masthead keeps
   the control.
6. Unify card radii: NeedCard 11 / WorkingCard 4 / TerminalTile 7 → one radius
   (8, continuous) for all three. Keep chips and the ask dock capsule.
7. Vitals strip: when the sparkline has no pulse (`samples.count < 3`), hide the
   chart segment entirely instead of drawing the flat hairline placeholder
   (`HomeSurface.swift:641-649`). When there are no quota segments, drop the
   agents/machines count fallback too (those numbers already live in the bottom
   readout bar) — and if that leaves the strip empty, hide the strip and its
   bottom rule. Quota meters stay as-is when present.
8. Bottom dock: collapse the Terminals strip behind a small "TERMINALS n"
   disclosure header (persist with `@AppStorage`, default collapsed) — it's a
   display-only readout competing with the primary CTA. In `askDock`, drop the
   mic icon's circle-stroke orbit (plain glyph), keep the capsule + accent send.
9. Working cards: light touch — drop `AgentAvatar` (the initials repeat on every
   card and carry no identity at this size) and only reserve the goal text's
   `minHeight: 30` when a goal exists (`HomeSurface.swift:878-885`).

## C. States

10. First load: replace the bare "Loading fleet" empty state with a skeleton that
    mirrors the real layout — a vitals-height placeholder block plus 2-3 ghosted
    card/row shapes using SwiftUI `.redacted(reason: .placeholder)`, fading into
    real content.
11. Not-connected: turn the one-line `notConnectedHint` into a composed empty
    state (icon + one line + a connect affordance that surfaces the existing
    connection flow), instead of a bare hint over black.

## Report back

Changed files, build result, and anything deliberately skipped (with why).
