# SCO-035: Ranger Chip Unification

## Status

Proposed. Supersedes the unmerged work on `codex/local-pr-stack` (SCO-033).

## Proposal ID

`sco-035`

## Intent

Fold the Ranger status / activity / attention / brief-fresh surface into
the existing `RangerBroadcastChip` on the left of the status bar. One
chip, one stream, one surface — Ranger's identity, what it's doing, and
what it has to say all come through the same affordance.

Drop the parallel right-side `RangerStatusPill` introduced on the local
branch. The chip pattern on `main` already encodes the load-bearing
idea ("broadcast belongs close to Ranger") and is the better home for
the rest of the state machine.

## Pivot from SCO-033

SCO-033 (drafted and shipped locally on `codex/local-pr-stack`, never
merged to `main`) proposed a right-side status-bar pill as a parallel
surface. While that work was in flight, `main` shipped
`RangerBroadcastChip` on the left of the status bar — a chip-style
surface that already realizes the "broadcast close to Ranger"
direction.

The two surfaces overlap. Keeping both means two clickable Ranger
affordances in the chrome, two stylistic conventions, two places
attention competes. This proposal consolidates onto the chip and
moves SCO-033's gains onto it.

What carries over from SCO-033:

- Activity states (`listening`, `thinking`, `speaking`, `briefing`)
- Brief-fresh decay window
- Attention states for reminders, voice-offline, error
- Action surface (Brief / Ask state / Settings) — now via the chip
  popover, not a `⋯` button or context menu
- Panel simplifications (collapsed → null, drop wordmark, mic inline
  next to textarea, voice toggle in panel header)
- Post-brief broadcast emission via `emitBroadcast()`

What is dropped:

- The right-side `RangerStatusPill` component
- The parallel `RangerStateContext`'s role as a peer of the pill; the
  context still lifts state, but the consumer is the chip
- The right-side spatial-continuity argument (under-panel placement)

## Decision

OpenScout SHOULD extend `RangerBroadcastChip` into the unified Ranger
surface, **retire the dedicated `BroadcastTicker` row**, and remove
any parallel pill on the right.

After this proposal lands, the chrome carries one Ranger affordance
(the chip) and one popover (anchored to the chip). The horizontal
ticker between the content area and the status bar — currently a
second always-on visual band — goes away. Status-bar visual load
drops; broadcast information consolidates onto a surface the user
already associates with Ranger.

### Chip surface — what shows when

Priority (highest wins, only one visible at a time):

1. **Activity** — `listening` / `thinking` / `speaking` / `briefing`
   with dot/spinner. Visually preempts broadcast text; Ranger doing
   something now is the most urgent signal.
2. **Active broadcast** — the chip's current behavior on main:
   tier-coloured chip with one-line broadcast text. Includes
   reminders-due, voice-offline, and error states delivered as
   client-emitted broadcasts (see below).
3. **Brief-fresh** — small `Nm` chip for ~5 min after a brief lands.
   This is a derived state from the post-brief broadcast; could also
   live as a brief-class broadcast that decays via the existing
   `VISIBLE_LIFETIME_MS` and `PROMOTE_LIFETIME_MS` windows.
4. **Idle** — Bot icon at low opacity (current main behaviour).

### Click model

The chip stays visually minimal — just the Bot icon and the current
"something to say" beside it. No ellipsis, no inline overflow
button. Discoverability comes from a single contextual popover, not
from extra chrome.

- **Hover** — tooltip surfaces the full broadcast text (when
  truncated) plus secondary context (active session title, time
  since last brief, etc.). Lightweight, read-only.
- **Click** — opens the chip popover anchored above the chip,
  reusing the status-bar's own footprint rather than introducing a
  separate floating menu. The popover carries both the contextual
  details and the actions. See the Popover section below.
- **Right-click** — synonym for click; opens the popover. Provides a
  fallback for users who expect right-click on chrome.

The existing `toggleRanger` "click toggles the panel" behaviour
moves into the popover as an explicit **Open chat** button. This is
a small regression in efficiency for the most common action (one
extra click to open the panel) in exchange for a single, consistent
interaction model: click the chip, get the chip's world.

### Popover

The popover is anchored to the chip and absorbs four existing
surfaces: the broadcast ticker, the broadcast ticker popover, the
in-panel reminders banner, and the SCO-033 right-side pill menu.

Sections, top to bottom:

- **Now** — what the chip is currently surfacing, expanded:
  - Active broadcast (full text + tier + timestamp)
  - Current activity (if `listening` / `thinking` / `speaking` /
    `briefing`) with a Stop affordance where it makes sense
  - Brief-fresh chip details (when fresh)
  - Error detail (when red)
- **Reminders** — the panel's old reminders list, with per-reminder
  Ask / Dismiss actions
- **Recent broadcasts** — last 5–10 from the broadcast history.
  Subsumes the current `BroadcastTicker` popover content.
- **Actions** — Brief me now / Ask state / Toggle voice replies /
  Settings / **Open chat**
- **Alerts footer** — broadcast filter (`All` / `Warn+` / `Errors`),
  `Mute 30m`, `Go dark`. Migrated from the BroadcastTicker popover.
  The chip honours these (see Mute Migration below).

The popover is the discoverability surface. Right-click on a chat
bubble already opens a context menu via `useContextMenu`; we do not
need to use that pattern here.

### Ticker Removal

`BroadcastTicker` (`packages/web/client/screens/BroadcastTicker.tsx`
and `broadcast-ticker.css`) and its mount in
`OpenScoutAppShell.tsx` are removed. The chip absorbs the latest
broadcast (already its behaviour on `main`); the popover absorbs
"N more" history; the popover's Alerts footer absorbs filter / mute
controls.

### Mute Migration

The ticker today owns `MuteState` (`filter` + `goDark` + `muteUntil`)
in `openscout.broadcast.mute` localStorage. After removal:

- Move ownership of the mute state into `ranger-broadcast-store.ts`
  (or a sibling `ranger-broadcast-mute.ts`) so the chip honours it.
  Storage key unchanged; existing user preferences carry over.
- `selectChipBroadcast` and `selectActiveBroadcast` apply the same
  `shouldDisplay` predicate the ticker did today (`isFullyMuted` and
  `tierAllowed`). Muted broadcasts still land in `history` for the
  popover; they just don't surface on the chip.
- The popover's Alerts footer drives the mute state.

## Internal-Only Broadcasts

Rather than carry separate "reminder pill state" / "voice-setup
state" / "error state" on the chip, the panel emits **client-side
broadcasts** for these conditions and the chip surfaces them through
its normal display path.

- `reminder.due` — tier `warn`, text e.g. `2 reminders due`, dismissed
  when the panel handles the reminders
- `voice.offline` — tier `warn`, text `Voice setup`, dismissed when
  Vox connects
- `ranger.error` — tier `error`, text from the error banner

This unifies the data model: one store, one stream, one priority
mechanism. The chip already knows how to surface and decay these.

Implementation: add `emitClientBroadcast(input)` to
`ranger-broadcast-store.ts` that appends to the same `history` array
the SSE stream uses, with the same `Broadcast` shape and a synthetic
`ruleId: "client.*"`. Server-side `emitBroadcast()` (from SCO-033)
stays for the post-brief headline.

## Panel Deltas (from SCO-033, retained)

- `openscout.ranger.collapsed` default → `true`; collapsed branch
  returns `null` (no inline strip)
- `RANGER_DEFAULT_HEIGHT` → `260`
- Header: just `Bot` icon (left) + Volume toggle + Minimize chevron
  (right). `+ new chat` lives in Sessions picker; `Settings` lives in
  the chip menu.
- ChatInput: 3-column grid `[mic | textarea | send]`. Mic is small
  and icon-only.
- Inline brief panel block deleted; brief delivery is voice + UI nav
- Reminders banner removed from the panel; surfaced as a chip
  broadcast (see above)
- `RangerStateContext` retained — the chip needs activity, voice,
  error, session state lifted from `RangerPanel`
- User-facing "Ranger" wordmark stripped from h2, placeholders,
  tooltips, empty-state copy, etc.; the Bot icon carries identity

## Wiring on Top of `main`

- **Chip extension**: edit `packages/web/client/components/RangerBroadcastChip.tsx`
  to consume `useRangerState()` and render activity / menu. Keep the
  `useRangerBroadcastStore` integration; add the menu via
  `useContextMenu`.
- **State context**: bring over `packages/web/client/scout/ranger/RangerStateContext.tsx`
  and mount the provider in `scout/Provider.tsx`.
- **Publisher**: bring over the `useMemo` + `useEffect` blocks added
  to `RangerPanel` to publish state and register action handlers.
- **Client broadcasts**: add `emitClientBroadcast` to
  `ranger-broadcast-store.ts`. Hook it from `RangerPanel` for
  reminders-due / voice-offline / error transitions.
- **Server post-brief broadcast**: re-apply
  `emitBroadcast()` addition in `core/broadcast/service.ts` and the
  brief endpoint call in `create-openscout-web-server.ts`.
- **Panel simplifications**: re-apply on top of `main`'s
  `RangerPanel.tsx`. Three-way merge with the SCO-033 diff for the
  parts that don't conflict.
- **Remove**: `RangerStatusPill.tsx` (not landing); status-bar right
  side returns to just the build label.

## Ship Order

1. **Branch off `origin/main`** as `codex/sco-035-ranger-chip`.
2. **Lift state context** — port `RangerStateContext.tsx`, mount in
   provider, publish from panel. No UI change yet.
3. **Extend chip** — activity states preempt broadcast text;
   brief-fresh decays through existing lifetime windows. Hover
   tooltip with full state.
4. **Migrate mute state** — move `MuteState` ownership from the
   ticker into `ranger-broadcast-store.ts`; have the chip honour
   it. Storage key unchanged.
5. **Chip popover** — click / right-click opens; carries Now /
   Reminders / Recent broadcasts / Actions / Alerts-footer
   sections. Move `toggleRanger` into the popover as
   **Open chat**.
6. **Retire BroadcastTicker** — remove the mount in
   `OpenScoutAppShell.tsx`, delete `BroadcastTicker.tsx` and
   `broadcast-ticker.css`. Verify no other consumers.
7. **Client broadcasts** — `emitClientBroadcast` helper; wire
   reminders-due / voice-offline / error.
8. **Server post-brief broadcast** — re-apply `emitBroadcast()` and
   the brief endpoint emission.
9. **Panel simplifications** — collapsed → null, header trim, mic
   inline, "Ranger" wordmark strip, etc.
10. **Cleanup** — verify the abandoned right-side pill is gone and
    no imports reference `BroadcastTicker` or the unused pill.

## Non-Goals

- No move of the chip from left to right. The chip stays in the
  actor cluster on the left of the status bar where `main` placed
  it.
- No change to the SSE broadcast protocol or server schema beyond
  the `emitBroadcast()` helper from SCO-033.
- No change to the broadcast tier system (`info` / `warn` /
  `error`). Internal broadcasts reuse those tiers.
- No retroactive flip of `openscout.ranger.collapsed` for existing
  users; new default only.

## Open Questions

- **Activity preempts broadcast text — or coexist?** Lean preempt:
  one signal at a time. If users want both, we can interleave (e.g.,
  briefing → activity; broadcast surfaces after briefing completes).
- **Open chat as click vs. popover-only?** This proposal moves
  `toggleRanger` into the popover as an explicit button. The cost
  is one extra click on the most common action. If that drag is
  felt in practice, restore left-click → toggle and use right-click
  / a chip-edge keyboard chord for the popover.
- **Should internal broadcasts hit the broadcast popover too?** The
  existing popover lists buffered broadcasts. If `reminder.due`
  shows up there, it might clutter; if it doesn't, the chip and the
  popover disagree. Default: include them, with a `source: "client"`
  flag so the popover can filter if needed.
- **Brief-fresh as broadcast vs. derived state?** As broadcast: free
  decay, popover history, ticker consistency. As derived: tighter
  control. Lean broadcast.
- **What happens to the unmerged SCO-033 commit on
  `codex/local-pr-stack`?** Stays as a reference. The doc
  `sco-033-ranger-status-pill-and-panel-collapse.md` will note in its
  Status section that it is superseded by SCO-035 (when this lands
  on `main`).

## Reference

- SCO-033 (unmerged, on `codex/local-pr-stack`): `docs/eng/sco-033-ranger-status-pill-and-panel-collapse.md`
- Existing on `main`:
  - `packages/web/client/components/RangerBroadcastChip.tsx`
  - `packages/web/client/components/ranger-broadcast-chip.css`
  - `packages/web/client/lib/ranger-broadcast-store.ts`
