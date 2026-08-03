# Scout Native Look-and-Feel Pass — implementation report

Companion to `scout-native-look-feel-opus-pass.md`. Working tree only; nothing
committed or pushed.

## Treatment chosen

**Centered rail, contained float** — a refinement of the shipping `rail`
treatment (the macOS default, set in `ScoutCommsSettings.ScoutThreadPresentation`),
not a new identity.

Three things were tried against the real 1735px-wide native canvas:

1. *Left-anchored, wider measure* — kept the asymmetry the brief calls out; the
   dead half just moved.
2. *Centered column, grid gutter* — fixed the asymmetry but kept the grid's
   worst artifact: the author stack and the reply backlink shared grid row 1,
   so a four-line author stack set the height of a one-line backlink and
   dropped ~80px of dead space between the backlink and its own prose.
3. *Centered column, floated margin note* (**kept**) — the gutter is a
   contained float rather than a grid cell, so it sizes itself and the prose
   starts where the turn starts.

Why this one: it is the smallest change that fixes both the horizontal problem
(a 660px lane pinned to the left of a 1735px pane) and the vertical one (dead
gaps inside every turn), and it leaves the ledger/document/standard treatments
untouched.

Geometry: `--thread-rail-gutter: 168px`, `--thread-rail-measure: 700px`,
column = gutter + gap + measure, `margin-inline: auto`. At the reference window
that is a 892px column with ~420px of symmetric margin. 168px is the width at
which real agent names (`studio-dostoevsky-2`) stop wrapping.

## Follow-up revision from the native review

The first capture read too much like a centered book page. The current rail
keeps the contained-float structure but is left-anchored within the conversation
canvas and uses a bounded fluid measure:

- gutter: `clamp(196px, 14vw, 240px)`;
- prose measure: `clamp(760px, 60vw, 1040px)`;
- no inherited 760px message cap;
- author metadata is left-aligned and flows horizontally within the wider lane.

This keeps a deliberate right-side breathing zone for the native inspector while
using substantially more of the desktop canvas. The current native acceptance
capture is `/tmp/scout-native-current.png`; the matching channel canvas capture
is `/tmp/scout-visual-precision-rail-native-canvas-v2.png`.

## What changed, by priority

| # | Priority | Outcome |
|---|---|---|
| 1 | Conversation is focal | Prose is the first thing read on every turn. Backlink demoted (see below); inline code chips neutralised. Mono kept for metadata, identifiers, telemetry. |
| 2 | Use the desktop canvas | Reading column centered and widened 68ch → 700px. |
| 3 | Plane hierarchy | **Partly deferred — see below.** Reduced hairlines/nesting instead of re-toning planes. |
| 4 | Channel header | **Already satisfied** — see below. |
| 5 | macOS inspector | `ScoutAgentCardStack` rewritten: compact roster first, one detail second. |
| 6 | State semantics | Green freed from decoration; roster dot is the one state signal. |
| 7 | Collapse fan-out | Implemented against real record fields, with tests. |
| 8 | Preserve behaviour | Keyboard/a11y/resize/actions/routing preserved; see notes. |

### Priority 1 — inline code and the reply backlink

The global `.s-inline-code` chip is emerald-on-emerald. That reads well where a
chip is rare; in a transcript where every second sentence carries a filename it
turned the canvas into a field of green and spent the accent on decoration.
Overridden **inside `.s-thread-msg-body` only** — other surfaces keep the
global chip.

The `REPLY TO <title> · <from> · done` backlink ran the full canvas width in
mono uppercase at the top of every turn. Because every reply to one fan-out
carries the *same* originating title, it was the loudest and most repeated
element on screen. Held to `min(38ch, measure)` at `--text-2xs` and 0.72
opacity, full opacity on hover/focus.

### Priority 5 — the inspector

`ScoutAgentCardStack` previously rendered a full `ScoutAgentInspector` per
channel member, so a six-agent channel stacked six equally loud panels each
repeating its own RUNTIME table. Now:

- a compact roster row per member — state dot, sprite avatar, name, harness;
- one full inspector below, for the selected member;
- selection defaults to the first member, so the pane is never empty.

Roster rows are `Button`s (keyboard-reachable), carry `.isSelected`, a `help`
tooltip with the agent state, and a context menu to open the conversation.

### Priority 7 — fan-out collapse

Reliable against the record, not inferred from prose. Verified on the live
`#visual-precision` channel: seven deliveries, byte-identical bodies, distinct
`deliveryRequestId`s, spread over 206ms, each carrying `targetDisplayName`.

`buildConversationFeedRows()` folds a run when every member has a
`deliveryRequestId`, shares a byte-identical body and class, lands no more than
60s from the run's first row, and addresses a recipient the run has not already
covered. The recipient boundary matters because the broker currently records
no shared dispatch identity across the delivery legs: a repeated recipient is
the reliable signal that an identical resend has begun. It renders as one quiet
mono line — `▸ SENT TO 7 AGENTS · 1h` — that expands to the recipient list plus
the text that went out once.

This also fixes a genuine misrepresentation: those rows are attributed to the
agent each was *delivered to*, so the transcript read as seven agents having
independently said the same paragraph.

Rows that fail any condition stay separate. Two agents that genuinely typed the
same text are never folded, and an immediate resend to the same group starts a
new row. Both cases are covered by tests.

The collapsed row also preserves every underlying `msg-<id>` target. Following
a reply backlink or message permalink expands the owning fan-out row, scrolls
to it, and briefly highlights it. A collapsed row that begins a new calendar
day now carries the same day divider as an ordinary message row.

## Deliberately not done

- **Priority 4 (header).** Already simplified by a previous pass: the header is
  title + a glyph-led mono fact strip (repo · branch · session) + two ghost
  icons, with an in-code note that participants live in the inspector. The full
  title is legible and truncates tail-first. Churning it would have been change
  for its own sake.
- **Priority 3 (plane re-toning).** The dark presets already carry a correct
  ladder — `chrome` 0.055 < `bg` 0.075 < `surface` 0.102 — mapped to
  rail/inspector, canvas, and cards. Re-toning lives in
  `ScoutTheme.swift:287` and is global to every surface in the app, which is
  outside "narrowly scoped to the native Messages/channel presentation". What
  I did instead was the other half of that priority: fewer hairlines and nested
  boxes (grid nesting removed, seven nested repeated messages → one line, N
  nested inspector cards → roster + one card).

## Bug found and fixed en route

The live-turn card carries its avatar as a *sibling* of the card content rather
than inside the header, so under the floated gutter it collided — the agent
name, the avatar and the `Live` chip drew on top of each other. That card now
places its avatar in the gutter and keeps its header in flow.

## Files changed

| File | Change |
|---|---|
| `packages/web/client/screens/chat/conversation-screen.css` | Centered rail geometry, floated margin note, avatar-row fix, backlink compression, fan-out row styling, thread-scoped inline-code override |
| `packages/web/client/screens/chat/conversation-model.ts` | Fan-out row model, head-anchored window, recipient boundary, shared day-divider rule |
| `packages/web/client/screens/chat/conversation-model.test.ts` | 11 tests for folding, resend boundaries, time span, labels, and day dividers |
| `packages/web/client/screens/chat/ConversationFeedRows.tsx` | Collapsed/expanded fan-out row, preserved message anchors, shared day divider |
| `packages/web/client/screens/chat/ConversationScreen.tsx` | Feed renders rows; expansion state; fan-out-aware permalink/backlink scrolling |
| `apps/macos/Sources/Scout/ScoutRootView.swift` | `ScoutAgentCardStack` → roster + detail; new `ScoutAgentRosterRow` |

## Checks

| Check | Result |
|---|---|
| `bun run --cwd packages/web check` | **pass** — `ok - no new type errors (84 baselined)` |
| `bun test packages/web/client/screens/chat/ packages/web/client/components/MessageEmbeds.test.tsx packages/web/client/lib/` | **pass** — 533 pass, 0 fail across 57 files |
| `bun test packages/web/client/screens/chat/conversation-model.test.ts` | **pass** — 27 pass, 0 fail (independent final check) |
| `bun ./apps/macos/bin/scout-app.ts dev-build` | **pass** — `Build of product 'Scout' complete!` |
| `bun run scout:up --no-ios` | **pass** — `scout:up complete`, broker health ok, web ready, Scout relaunched |

## Screenshots (native Scout window, 2560×1557)

Session scratchpad — copy them out if they need to outlive the session:

```
…/scratchpad/00-baseline.png       before
…/scratchpad/03-native-after.png   after canvas + inspector
…/scratchpad/04-final-native.png   after scout:up --no-ios (acceptance)
…/scratchpad/web-00.png            canvas before, at native canvas geometry
…/scratchpad/web-03.png            canvas after, same geometry
```

Full scratchpad root:
`/private/tmp/claude-501/-Users-arach-dev-openscout/5a72732b-8296-4932-846e-a6d1ab931098/scratchpad/`

## Dirty files deliberately left untouched

Every pre-existing modification is intact; nothing stashed, reset or
overwritten. Untouched: `apps/desktop/src/cli/commands/card.{ts,test.ts}`,
`apps/ios/.../lanes/app.js`, all five `design/studio/**` files and the two
untracked `comms-follow-tail.*`, all `packages/agent-sessions/**`,
`packages/protocol/src/runtime-execution.ts`, all `packages/runtime/**`,
`packages/web/server/{create-openscout-web-server.ts,image-blob-store.ts}`,
and `packages/web/client/components/MessageEmbeds.{tsx,test.tsx}`.

The pre-existing work *inside* the files I edited is preserved and was verified
after the fact: the follow-tail / `jumpToLatest` / `handleFeedScroll` work and
`s-thread-new-messages` styling in `ConversationScreen.tsx` and
`conversation-screen.css`, and the `nearBottom` autoscroll guard in
`conversation-model.ts`. My changes are additive on top of them.

## Verification gap

Native acceptance was captured on a DM thread, not on `#visual-precision`.
Switching the app's selected conversation needs a synthetic click, and this
environment has no Accessibility permission for System Events — the attempt
hung and was abandoned rather than retried. The multi-agent inspector roster is
covered natively anyway (the DM has two members, so `ScoutAgentCardStack` is
the code path in `03-native-after.png` / `04-final-native.png`). The channel
case — rail gutter with real names, and the collapsed `SENT TO 7 AGENTS` row —
is verified in `web-03.png`, captured at the exact native canvas geometry
(1735×1090) against the same production bundle the web view loads.

To close it properly: select `#visual-precision` in the running app and
re-capture. One click.

## Follow-ups deferred

- **Metadata margin on ultrawide.** At >2000px the right half is still unused.
  A third column for time and hover actions would use it and thin the gutter
  stack further.
- **DM gutter.** In a two-party DM the 168px author gutter is mostly redundant.
  A per-kind gutter width would tighten DMs without touching channels.
- **Conversation list repetition.** Eight consecutive `Broker notice: #… has a
  work request for …` rows are the same fan-out problem one pane to the left,
  and the same grouping key would collapse them.
- **`inbox-thread-redesign.css`** (897 lines) is imported by nothing. Pre-existing
  and out of scope, but it is dead.
