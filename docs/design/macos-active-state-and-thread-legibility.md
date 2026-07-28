# Scout macOS — active-state treatment + thread legibility

Design and feasibility pass. **No code was modified.** Line references are from the
`studio-craft-pass` working tree at time of review (2026-07-27).

Scope, as asked:

0. What is actually rendering (orientation — this changes who owns each fix)
1. **P0 defect** — the collapsed reply column (from the owner's screenshots)
2. Layer 1 — replace the active-state animation with something purposeful
3. Layer 2 — make the agent avatar the active affordance
4. Layer 3 — multi-agent / multi-harness legibility in a DM
5. Smallest high-quality first slice
6. Constraints and risks

---

## 0. Orientation — which renderer owns what

The Chats surface is **two renderers side by side**, which decides where each fix lands:

| Region | Renderer | Source |
| --- | --- | --- |
| Conversation list, composer, in-flight turn row | native SwiftUI | `apps/macos/Sources/Scout/ScoutCommsView.swift` |
| The thread transcript | **web**, mounted as `/embed/thread` in a WKWebView | `packages/web/client/screens/chat/ConversationScreen.tsx` |

`ScoutThreadRenderer.fallback = .shared` mounts the web `ConversationScreen`
(`ScoutCommsSettings.swift:45`, `ScoutEmbedSurface.swift:88`) so the reading layout is
decided once for web, macOS and iOS. Presentation defaults to `.rail`
(`ScoutCommsSettings.swift:22`); this machine is running `ledger`.

**Consequence:** the reply defect is a **CSS bug in `conversation-screen.css`**, not SwiftUI.
Layers 1–2 are **native Swift**. Layer 3 spans both.

---

## 1. P0 — the reply body collapses to a one-word column

Two independent defects that compound. Neither is a rendering glitch; both are
deterministic and reproduce at any pane width.

### Defect A — every alternate treatment silently keeps the 760px bubble cap

```css
.s-thread-msg { max-width: min(100%, 760px); }

.s-thread-layout[data-thread-treatment] .s-thread-feed-block,
.s-thread-layout[data-thread-treatment] .s-thread-feed-block--you,
.s-thread-layout[data-thread-treatment] .s-thread-feed-block--full-width .s-thread-msg {
  max-width: 100%; align-self: stretch; align-items: stretch;
}
```

Only the **third** selector reaches `.s-thread-msg`, and it requires `--full-width`.
That class is applied at `ConversationScreen.tsx:1548`:

```jsx
showDayDivider && "s-thread-feed-block--full-width",
```

`--full-width` exists to let the **day divider** span the pane. It is accidentally
also the only thing that lifts the bubble cap in ledger/rail/document.

**Result:** the one row that happens to carry the "TODAY" divider is full-pane; every
other row is hard-capped at 760px however wide the pane is. This is directly visible in
the owner's capture — Arach's row (which carries the divider) wraps at ~1330px, Feynman's
reply is ~754px in the same pane.

### Defect B — the link embed joins the prose line instead of taking its own row

```css
[ledger] .s-thread-msg-card-content { flex-direction: row; flex-wrap: wrap; gap: 8px; }

/* intent: "anything that isn't byline or prose takes its own line" */
[ledger] .s-thread-msg-card-content > *:not(.s-thread-msg-header):not(.s-thread-msg-body) {
  flex: 1 0 100%;
}
[ledger] .s-thread-msg-body { flex: 1; min-width: 0; }

/* app.css */
.s-message-embeds { display: grid; max-width: min(460px, 100%); }
```

`flex: 1 0 100%` is meant to force a wrap. Flex **line-breaking** uses each item's
*hypothetical main size* — the flex basis **clamped by that item's own min/max-width**.
`.s-message-embeds` clamps itself to `460px`, so its hypothetical size is 460, not 100%.
It fits on the line and never wraps. The prose has `flex-basis: 0`, so it contributes
nothing to the break decision and simply absorbs whatever is left over.

The comment above that rule describes the intended behaviour correctly. The rule does not
implement it.

### The arithmetic reproduces the screenshot to the pixel

```
  760   .s-thread-msg cap                      (Defect A)
-  28   .s-thread-msg-card padding (14 × 2)
────────
  732   usable
- 188   header (4.5ch time + 17ch actor + 2 permalink buttons, flex:none)
- 460   .s-message-embeds                       (Defect B)
-  16   two 8px gaps
────────
 ~68px  left for the prose
```

Measured in the owner's capture: **~61px**. One word per line, ~40 lines tall, with ~750px
of empty pane to its right.

Either bug alone is survivable — A alone gives a 760px column in a 1400px pane; B alone
still leaves the prose ~660px. Together they produce the screenshot.

### Fixes — smallest first

**F1 — one line, fixes ledger, rail and document at once:**

```css
.s-thread-layout[data-thread-treatment] .s-thread-msg { max-width: 100%; }
```

**F2 — make "own row" robust; stop depending on a child's own max-width:**

```css
.s-thread-layout[data-thread-treatment] .s-thread-msg-card-content
  > *:not(.s-thread-msg-header):not(.s-thread-msg-body) {
  flex: 1 0 100%;
  max-width: 100%;              /* the item must not clamp its own break decision */
}
.s-thread-layout[data-thread-treatment] .s-message-embeds { justify-items: start; }
.s-thread-layout[data-thread-treatment] .s-message-embed  { max-width: 460px; }
```

The 460px cap moves **inward** to the card itself, so the embed still *looks* the same
size while the flex item is free to claim a full row.

**F3 — decouple the two jobs `--full-width` is doing.** Keep it for the divider; drive the
treatment stretch off `[data-thread-treatment]` alone (F1 already does this). Otherwise the
next person to touch day dividers re-breaks message width.

### The structural fix (recommended, still small)

The ledger row should be a **grid, not a wrapping flex line** — the same move `rail`
already makes. This also answers the owner's "correct left ledger inset" note directly:

Today `.s-thread-msg-header` is `flex: none`, so its width is **max-content** — it varies
with the actor name's length, and it includes two permalink buttons that are `opacity: 0`
at rest but **still occupy layout width** (`conversation-screen.css:676`). So the prose
edge jitters row to row, and part of the gutter is invisible furniture. A declared track
makes the prose edge one hard vertical line down the page:

```css
[ledger] .s-thread-msg-card-content {
  display: grid;
  grid-template-columns: 22ch minmax(0, 1fr);
  column-gap: var(--space-lg);
  row-gap: var(--space-xs);
  align-items: baseline;
}
[ledger] .s-thread-msg-header { grid-column: 1; grid-row: 1; }
[ledger] .s-thread-msg-card-content > *:not(.s-thread-msg-header) { grid-column: 2; }
[ledger] .s-thread-msg-body { max-width: 100ch; }   /* a log still deserves a measure */
```

Grid tracks are **declared, not negotiated**, so no future intrinsically-wide child — an
embed, a table, a code block, a diff, a chart — can ever steal the prose column again.
That is the difference between fixing this bug and fixing this class of bug.

Metadata stays subordinate by construction: it lives in a fixed 22ch track at
`--text-2xs`/`--dim`, and the hover-only glyphs no longer widen anything.

---

## 2. Layer 1 — the active-state animation

### What exists today

| Primitive | Where | Motion |
| --- | --- | --- |
| `ScoutBrailleSpinner` | `ScoutBrailleSpinner.swift`, 7 call sites | 10 braille frames at **0.08s → 12.5 fps**, plus a `cos()` opacity breathe |
| `ScoutListLivePulse` | `ScoutCommsView.swift:638` | green dot, `repeatForever(autoreverses:)` 1.4s, opacity 0.34→0.78, scale 0.78→1.0, 3pt shadow |
| `.s-conv-status-working .s-conv-status-dot` | `app.css:1863` | CSS `s-pulse` infinite |
| "WORKING" pill | conversation list | static green chip |

### Critique

- **Four vocabularies for one fact.** A terminal spinner, a breathing dot, a CSS pulse and
  a static chip all say "an agent is working". They don't compose; with several on screen
  the surface reads busier than the work actually is.
- **The braille spinner is the fastest-moving thing in the app by an order of magnitude**
  (12.5 fps next to prose). Terminal-native is the right instinct; that rate is not — it
  reads as *loading*, i.e. "the app is waiting on itself", rather than *thinking*.
- **It is honest about time, dishonest about progress.** It spins identically whether the
  agent is emitting tokens or is wedged. Motion that never varies carries no information.
- **`statusOk` green is categorical status colour**, which the house rules ban in favour of
  one rationed accent and contrast. It also collides with the accent used for unread.
- **`withAnimation(.repeatForever)` on `@State` in a list row** is the shape behind the
  earlier idle-CPU render storm. `TimelineView` (the spinner's approach) is the cheaper
  pattern and should be the only one.

### Recommendation — one primitive, three sizes

Introduce a single `ScoutWorkPulse`, and point every "working" surface at it.

- **Driver:** `TimelineView(.animation(minimumInterval: 1/20, paused: !active))`. No
  `@State`, no `repeatForever`, pauses when off-screen.
- **Cadence:** one breath per **2.4s**, ease-in-out, opacity 0.45 → 1.0, **no scale**.
  At 2.4s it reads as *alive* rather than *loading*, and nothing else in the app moves at
  that rate — so the cadence itself becomes the app's signature for "work is happening".
- **Colour:** `ScoutPalette.accent`, not `statusOk`. If work is the only ambient motion in
  the app, it does not need a hue to disambiguate it.
- **Make it mean something:** intensity keyed to **evidence of progress**, not elapsed
  time. When a new observe event lands (`ScoutTurnActivityItem`), take one brighter beat
  and settle. Then motion means "something just happened", which is the only honest thing
  motion can say — and a wedged agent visibly stops breathing.
- **Reduce Motion:** hold at 0.8 opacity, no animation. `ScoutListLivePulse` already does
  this correctly — keep that behaviour.
- **No spill.** Drop the 3pt shadow. In a dense list, glow is what makes motion read cheap.
- **Retire the braille spinner from Comms only.** It has 7 call sites; it stays legitimate
  in Tail and Terminal, where terminal telemetry is the right register.

---

## 3. Layer 2 — the avatar as the active affordance

### The actual finding

The sprite **already encodes state**, and the conversation list throws that away.

`SpriteAvatarView` (`SpriteAvatarView.swift`) is documented as:

```
shape      ← name      ·   hue ← harness
brightness ← state
```

and ships a convenience init that wires all three (`SpriteAvatarView.swift:35`):

```swift
init(agent: ScoutAgent, size: CGFloat, tile: Bool = true)   // hue from harness, tone from state
```

But `ScoutConversationRow.avatarTile` (`ScoutCommsView.swift:1152`) calls the **name-only**
init:

```swift
SpriteAvatarView(name: channel.rowTitle, size: 32, tile: true)
```

so the tile cannot carry harness hue or state tone. **The green "WORKING" pill exists to
compensate for an avatar that was constructed without an agent.** That is the whole bug in
this layer.

The web side has the same gap in a different form: `.s-thread-msg-avatar--working` does
exactly one thing — `--size: 24px → 28px` (`conversation-screen.css:805`). A working agent
makes the row **reflow**.

### Recommendation

1. **Give the row its agent.** Switch `avatarTile` to `SpriteAvatarView(agent:size:32)`
   when the channel resolves to an agent. Harness hue and state tone arrive for free — no
   new API, no model change.
2. **Active ring on the tile, not a badge beside the title.** A `HudStrokeWidth.thin`
   accent ring on the existing 9pt rounded rect, opacity driven by `ScoutWorkPulse`. It
   reuses the geometry of the current selection ring (`ScoutCommsView.swift:1155`), so
   selection and activity share one grammar and cannot collide: **selection is a steady
   ring, work is a breathing one.**
3. **Delete the "WORKING" pill.** It is a label doing an avatar's job, it costs ~62px of
   title width — visible in the capture, where titles truncate to `openscout-dalton-…`
   while a WORKING chip sits beside them — and it is a second green.
4. **Keep the pulse inside the tile bounds.** No glow, no shadow spill.
5. **Web parity:** `.s-thread-msg-avatar--working` should take the same ring instead of the
   size change, so a turn going live doesn't reflow the row.

**Feasibility:** ~30 lines in `ScoutConversationRow` plus one small shared view. No protocol
or store schema change.

**One constraint:** resolving the agent per row needs the agents store in scope. It already
is — `ScoutRootView` does this lookup for `selectedChannelMembers` (~line 4082) — but that
resolution should move into the store as an id-keyed map so it is O(1) per row rather than
recomputed per render. This is the same idle-CPU hazard class as the `repeatForever` above.

---

## 4. Layer 3 — multiple agents / harnesses in one DM

### Feasibility: already modelled end to end. Mostly **unmounted, not unbuilt.**

- `ScoutChannelParticipant` (`ScoutCommsModels.swift:20`) already carries
  `actorId, kind, displayName, label, scopedAlias, agentId, sessionId, **harness**,
  transport, workspaceRoot`. **Harness is already per-participant.**
- `ScoutChannel.directPeerLabel` already renders `a <> b` for 2+ peers.
- `ScoutChannel.isObserverThread` already distinguishes an agent↔agent thread the operator
  is *watching* from a DM they are *in*, and already drives observer-first chrome.
- `ScoutMemberStrip` (`ScoutCommsView.swift:1307`) already renders overlapping sprites at
  −4pt with an `A + B` label — and has **no call site anywhere in the app**. It is finished
  and never mounted.
- The web thread already ships a participants panel with per-participant live activity and
  a `MiniMeshSvg` (`ConversationPanels.tsx:120–220`).

### The one real modelling gap

```swift
public var scope: ScoutChannelScope {
    if kind == "direct", participantIds.count <= 2 { return .direct }
    return .shared
}
```

"Direct" is defined by **cardinality**, not by kind. A 3-party DM is silently reclassified
as `.shared` and gets the `#` channel tile — so the multi-agent DM is exactly the case the
model currently cannot express.

### Recommendation

1. **Fix `scope`:** `kind == "direct"` → `.direct` regardless of count. Cardinality then
   only picks the *title form*: `peer` · `a <> b` · `a + b + 2`.
2. **Mount `ScoutMemberStrip`** in the thread header when
   `participants.filter { !isOperator }.count > 1`. Single-peer DMs keep today's chrome —
   no new furniture for the common case.
3. **Stacked tile in the list** for multi-agent DMs: two sprites at the strip's −4pt
   overlap. The tile then answers "how many, and which" before the title is read.
4. **Do not add harness labels.** Hue *is* harness
   (`AgentSpriteFactory.hue(forHarness:)`). Two sprites of different hue in one tile is
   already the multi-harness signal, and it survives the ledger's density. Spell the
   harness out only in the hover card and the member-strip tooltip — reveal in context.
5. **Unify the web sidebar's identity.** `ConversationPanels` uses `s-ops-avatar` (a
   coloured letter circle), which contradicts the sprite identity that macOS, web and iOS
   otherwise keep bit-exact. Swap it to `SpriteAvatar`.

### Bug found while reading (unrelated to the visual pass)

`selectedChannelMembers` (`ScoutRootView.swift` ~4082) index-zips two independently derived
arrays:

```swift
let names = channel.participantDisplayNames           // from `participants`, then deduped
let participantId = channel.participantIds[index]     // separate, un-deduped array
```

`participantDisplayNames` passes through `uniqueMemberNames` (which dedupes), while
`participantIds` does not. When two participants share a label, or the two arrays disagree
in length or order, **a name is attached to the wrong agent** — and that agent is what the
member strip's click-through opens. Build the identities from `channel.participants`
directly; it already carries both `label` and `agentId` on the same record.

---

## 5. Smallest high-quality first slice

Ordered so each step is independently valuable and independently revertable.

**Slice 1 — P0, ~10 lines of CSS, no TSX.** The reply body.
- `.s-thread-layout[data-thread-treatment] .s-thread-msg { max-width: 100%; }`
- `max-width: 100%` on the ledger's non-header/non-body children; move the 460px cap to
  `.s-message-embed`.
- ledger `.s-thread-msg-body { max-width: 100ch; }`

Verify: a reply *with a link embed* in a ~1400px pane wraps at the measure, and the embed
sits on its own row beneath the prose. **This alone turns the screenshot from broken to
correct — ship it on its own.**

**Slice 2 — P1, CSS only.** Ledger gutter becomes a 2-track grid (`22ch minmax(0,1fr)`):
one hard prose edge, metadata boxed into a fixed track, hover-only glyphs no longer
widening it, and the whole "wide child steals the prose column" class closed.

**Slice 3 — P1, native, ~40 lines.** `ScoutWorkPulse` (2.4s breath, accent, `TimelineView`,
reduce-motion aware, progress-keyed). Repoint `ScoutListLivePulse` and the in-flight turn
row; retire the braille spinner **from Comms only**.

**Slice 4 — P2, native, ~30 lines.** Avatar carries the state: `SpriteAvatarView(agent:)`
in the list row, breathing accent ring, delete the WORKING pill.

**Slice 5 — P2.** Multi-agent: `scope` fix, mount `ScoutMemberStrip`, stacked tile, and fix
the index-zip bug.

Slices 1–2 land without a Swift build. 3–5 need `bun bin/scout-app.ts dev-build`.

---

## 6. Constraints and risks

- **Concurrent edits in this tree.** `openscout-dickens` is actively working reply-row
  alignment, and `packages/web/dist/client` was rebuilt twice during this review (the CSS
  asset hash changed from `index-BmQKaoum.css` to `index-CGOkznnx.css`).
  `conversation-screen.css` is already dirty (+67 lines, a pagination change).
  **Coordinate before applying Slice 1.**
- **The running app serves prebuilt static assets.** CSS-only changes need a `vite build`
  before :43120 picks them up — there is no HMR on that surface. Don't debug a stale
  bundle as a code bug.
- **Ledger is not the default.** `ScoutThreadPresentation.fallback = .rail`. Defect A hits
  `rail` and `document` too (both keep the 760px cap), so Slice 1 is worth shipping even if
  ledger is a minority setting.
- **Idle CPU.** Prefer `TimelineView(paused:)` over `withAnimation(.repeatForever)` in list
  rows; per-row agent lookups belong in the store, not the view body.
- **Don't delete `ScoutBrailleSpinner`.** 7 call sites; only the Comms usage is being
  retired.
