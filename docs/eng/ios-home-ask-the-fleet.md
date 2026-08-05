# iOS Home — "Ask the fleet" on the standard composer

**Status:** shipped. `askSection` is a `ScoutMessageComposer` and the
`homeStyle == .entry` gate on `sendAskDraft` is gone; this note records why.

## What was wrong

Home has two front doors (`ScoutHomeStyle`): `.fleet` (the dashboard, and the
default) and `.entry` (composer-first, opt-in).

Entry already docked the standard component — `ScoutMessageComposer` — with the
runtime chip, paperclip, dictation and send.

The **fleet dashboard did not**. Its ask lane was a hand-rolled
`TextField` + arrow button in a recessed well:

- no runtime chip, no attach, no dictation, no resting send
- unlabelled, so it read as a footer rule rather than a lane
- last section in the scroll, under an Activity lane that can run the length of
  the screen — on a busy fleet you never reached it
- `sendAskDraft` explicitly dropped harness/model/effort/attachments for the
  fleet style (`guard homeStyle == .entry else { … }`)

## What changed

`apps/ios/Scout/HomeSurface.swift`

- `askSection` is now `ScoutMessageComposer` (`density: .lead`,
  `appearance: .panel`) with `ScoutRuntimeChip` in its tools slot and a real
  `ScoutComposerAttach`. Same component, same grammar as Entry and as
  `/atoms/message-composer` in the studio — nothing new was designed.
- Given a `laneHeader("Ask the fleet")` so it is a named lane like every other
  section.
- Moved above `activitySection` in the scroll order. It also *needs* the room
  above it: the runtime panel grows upward out of its chip.
- The composer plumbing (`scoutRuntimePicker`, `photosPicker`, `fileImporter`,
  the `SCOUT_OPEN_RUNTIME` debug hook) moved from `entrySurface` up to `body`,
  so it hosts the chip for both front doors.
- `sendAskDraft` now carries the runtime pick and staged attachments on the seed
  for **both** styles. A chip that says "Opus 5 · auto" has to actually start
  Opus 5 · auto.
- The runtime-capability fetch in `load()` is no longer gated on
  `homeStyle == .entry` — the dashboard's chip would otherwise be fed only by
  the static fallback catalog and offer harnesses this fleet may not have.
- State renamed `entry*` → `ask*` where it is now genuinely shared
  (`askHarnessId`, `askAttachments`, `showAskModelPicker`, …). Entry-layout
  state (`entryDock`, `entryRecents`, `entryKeyboardRequested`, …) kept its name.
- Dropped the now-dead `@FocusState askFocused` — the composer owns its focus.

## Bug found and fixed along the way

`apps/ios/Scout/RuntimePicker.swift`

Placing the chip in-flow clamps `ScoutRuntimePanel.bodyHeight` for the first
time. The model column was a `ScrollView` with `.clipped()`; **the harness rail
was a plain `VStack` with neither**, so once the panel clamped, the last rail
rows drew straight over the effort ladder ("Cursor" overlapping "AUTO").

The rail now scrolls and clips on the same terms as the model column, and the
two-column frame is `.clipped()` so the invariant is owned in one place. This
was latent on Entry too — any fleet with more harnesses than the panel had room
for would have hit it.

## Verification

Built for the simulator and photographed on an iPhone 16 (iOS 26.5):

- fleet dashboard — named lane, full control row, above the Activity log
- fleet runtime panel — opens upward out of the chip, takes the composer's
  column, clears the masthead, no collision with the effort ladder
- entry front door — unregressed after the plumbing moved to `body`

```
cd apps/ios && HUDSONKIT_WITH_TERMINAL=1 HUDSONKIT_WITH_VOICE=1 \
  xcodebuild -project Scout.xcodeproj -scheme Scout -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath .deriveddata/dev build
```

`** BUILD SUCCEEDED **`

## Not done

- Not committed — this branch is shared and busy.
- The fleet lane has no smart-action line (Entry's "Catch me up" pills). That is
  an Entry affordance; adding it to the dashboard is a separate call.
- No studio change: this adopted an existing signed-off component rather than
  inventing a treatment.
