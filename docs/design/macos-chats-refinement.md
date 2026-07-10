# macOS Chats — refinement pass (subtraction first)

Date: 2026-07-09
Status: proposed
Surface: native macOS Scout, Chats (comms) — list · thread · composer · file viewer
Source: design critique of a live window capture (1917×1329, 2026-07-08), grounded
in the code below. Line numbers are against the working tree at the time of
writing and will drift — anchor on the symbol names.

The through-line: this surface's biggest wins are **subtraction**. The chrome,
sprites, instrument fact-strips, and minimal status bar are working; what's
dragging it is duplicated signals, harness vocabulary leaking into user copy,
and one real reading-flow bug (clipped thread over an empty pane). Nothing here
is a re-architecture.

---

## 1. Un-clip short threads (the one real bug)

**Observed:** a two-message thread renders both turns clamped to 220pt behind
"Show more" fades while the bottom ~60% of the pane is empty above the
composer. Reading a two-message design review takes two clicks and the pane
still looks vacant.

**Cause:** the clamp decision is purely per-turn. `isLongTurn`
(`ScoutCommsView.swift:1547` — body > 600 chars or > 10 newlines) collapses
every non-latest long turn (`ScoutCommsView.swift:1442`,
`isLongTurn && !isLatestMessage`) to
`ScoutCommsMetrics.collapsedTurnMaxHeight = 220` (`ScoutCommsView.swift:44`).
The thread's total size never enters the decision.

**Change:** make the clamp thread-aware, keeping the existing cheap structural
heuristic (the code comment at `ScoutCommsView.swift:1544` is right that
GeometryReader measurement is an idle-CPU hazard — don't reintroduce it):

- If the thread has **≤ 4 turns**, never clamp. Short threads are read
  end-to-end; clipping them buys nothing.
- Otherwise keep today's behavior (clamp long non-latest turns), and extend
  the latest-message exemption to the **last 2** turns so the live tail of a
  long thread reads without clicks.
- Keep a pathological-turn safety ceiling: in the never-clamp case, still
  clamp any single turn beyond ~4× the current height (880pt) — a pasted log
  shouldn't own the pane.

**Accept when:** the captured thread (2 turns, both > 600 chars) renders both
bodies in full with zero "Show more" affordances; a 20-turn thread still
collapses its middle.

## 2. Sweep session vocabulary and raw IDs out of the default surfaces

Our copy rule is *conversation* for users, *session* only at the harness /
diagnostics layer. This screen currently says "session" three ways at once and
shows raw IDs at rest.

- **List rows** (`ScoutConversationRow`, `ScoutCommsView.swift:1048–1062`):
  drop the `session session-mrclcs` / `chat chn-…` mono chip from the default
  row entirely. It is high-entropy noise repeated the full height of the list,
  and it is what forces titles to truncate ("Faraday <> T…"). The ID keeps two
  homes: the existing row context menu (add "Copy session ID" alongside the
  message-level copy actions) and the thread header fact strip. The `.help`
  tooltip dies with the chip.
- **Thread header fact strip** (`chatHeaderFacts()`,
  `ScoutRootView.swift:1588–1599`): the `#` glyph + `session session-mrcjye`
  chip reads the word twice. Keep the glyph, show the bare short id
  (`mrcjye`), keep the full id in `.help`. The glyph carries the category;
  the word was ballast.
- **Composer hint** (`ScoutRootView.swift:2769`): `Type / for commands ·
  @ for agents · session: for sessions` — the last clause is circular. The
  token syntax is genuinely `session:` so the hint must teach it; reword to
  `/ commands · @ agents · session: attach a session`. (Renaming the token
  itself is out of scope here; if the token ever becomes conversation-shaped,
  this hint follows it.)
- **Reply reference** (`custodyLabel`, `ScoutCommsView.swift:1555+`): `Reply
  to msg-mrcjye…` shows a machine ID where a quote belongs. When the
  referenced message is in the loaded page, render `Replying to {actorName}:
  "{first ~60 chars of body}"` and make it click-to-scroll. Fall back to
  today's short-ID form only when the referent isn't loaded.

**Accept when:** the word "session" appears at most once in the visible
surface at rest (the composer hint), and no raw `session-…`/`chn-…`/`msg-…`
string is visible without hover or menu.

## 3. One title grammar for list rows

**Observed grammar drift:** `openscout-cobalt-2 · Kepler`,
`Openscout <> openscout-pi…`, `talkie-mendel-2 · Tesla <> Ta…`, bare
`Hudson`, bare `openscout`. When `·` (alias) and `<>` (pairing) stack, the
title becomes unparseable — in `Tesla <> Ta…` you can't tell who is talking
to whom, and truncation always eats the meaningful half.

**Rule (Gmail model — agent is the sender, work is the subject):**

- **Primary text:** the human-meaningful pairing or alias — `Faraday <>
  Talkie`, `Kepler`, `Hudson`. Never the generated instance id.
- **Instance id** (`talkie-virgil-2`) demotes to the hover card / inspector /
  context menu, alongside the session id from §2. It is provenance, not
  identity.
- **Fallback:** rows with no alias or pairing show the instance id as today —
  a rule, not an exception.
- With the §2 chip gone, give the title `layoutPriority` over the age label so
  the pairing survives truncation.

This is a display-layer rule on `channel.rowTitle` composition
(`ScoutCommsModels.swift`); no protocol change.

**Accept when:** every row in the capture reads either `A <> B`, an alias, or
(only when nothing better exists) an instance id — never two grammars stacked.

## 4. Failure rows: mark quietly, then let them decay

**Observed:** three rows whose preview is "… failed to respond…", all 3 days
old, styled identically to live conversations. They needed attention once;
now they're clutter wearing a conversation costume.

The preview text is real channel content (last message via
`ScoutChannel.preview`, `ScoutCommsModels.swift:46`) — the client currently
has no idea these are failures, and there is **no archive/dismiss on chat
rows at all** (confirmed: nothing in the row code or context menu; the broker
has `setLocalAgentArchived` for *agents* but no archived flag on
chats/channels).

- **Mark:** carry a structured delivery-failure flag on the channel (server
  work — the failure event exists at the relay layer; surface it as e.g.
  `lastDeliveryFailed: true` on the channel payload) and render it as a quiet
  error-tint glyph in the row, mirroring the failed-pending treatment
  (`ScoutPendingConversationRow`). Do **not** string-match "failed to
  respond" client-side.
- **Dismiss:** add archive to the row context menu (`archive = dismiss ≠
  stop`, same triage semantics as the agents-directory Gmail model). This
  needs an archived flag on the chat record + a broker route, parallel to the
  local-agent one. **Named gap:** until that lands, ship the mark only — no
  client-side pretend-archive.
- **Decay:** once archive exists, failed channels with no activity for 48h
  auto-fold into a collapsed `DISMISSED` group at the tail of EARLIER (header
  style of `recencyHeader()`, `ScoutCommsView.swift:490`), one click to
  expand. Ambient by default; the row is never destroyed.

**Accept when:** a 3-day-old failed chat is visually distinct at a glance, can
be archived from the row, and no longer sits peer-to-peer with live work.

## 5. Deduplicate signals (pure removals)

- **Observing banner title echo:** `ScoutObservingBanner`
  (`ScoutRootView.swift:4699–4726`) repeats `channel.rowTitle` at its trailing
  edge, verbatim, ~40px under the header that already shows it. Remove the
  trailing `Text(channel.rowTitle)`; keep the eye + state text. (Header eye
  *button* is an action, banner is state — that pair stays.)
- **Pending-row "Starting" twice:** `ScoutPendingConversationRow`
  (`ScoutCommsView.swift:787–1005`) shows the state as both the detail line
  ("Starting…") and the right-edge status label ("Starting"). Keep the
  right-edge label (it's the scannable one); the detail line shows the flight
  summary or nothing.

## 6. Ration the accent — IMPLEMENTED 2026-07-09

The accent means *attention, liveness, or primary action*. A live capture
(operator turn = solid amber slab filling the pane) showed how far the surface
had drifted, so this section was implemented ahead of the rest. The rule that
fell out: **solid accent is reserved for primary-action chrome (New, Send) and
attention marks (unread, pending, failed); everything else that wants "yours /
selected / active" gets a wash (`accentSoft` / `ScoutSurface.selected`) or
plain ink.**

Landed changes:

- **Operator bubble** (`ScoutMessageRow.bubbleFill`): solid `accent` + white
  prose → `accentSoft` wash + `accent.opacity(0.28)` hairline edge + standard
  ink/muted/accent prose. Same treatment for the queued
  `ScoutPendingOperatorTurnRow`. Differential elevation (incoming floats,
  yours flat) unchanged. The collapse fade gained a `bg` underlay so it stays
  opaque over the translucent wash.
- **Filter segment** (`ScoutConversationFilterControl`): solid accent block +
  bg glyph → `ScoutSurface.selected(accent)` wash + ink glyph (the idiom
  `ScoutAgentScopeControl` already used).
- **Show more/less**: accent → muted.
- **In-flight activity timeline icons**: accent → muted (the spinner alone
  carries liveness).
- **Inspector activity sparkline**: accent bars → ink at intensity opacity
  (history is a quantity; the accent stays on the `now` label).
- **Inspector diff links / files-changed marks / thread reply count**:
  accent → ink.

Kept deliberately: New + Send buttons, unread dot/count, pending "PENDING"
chip, failed Retry, selected-row left bar (flat row — allowed idiom), avatar
"you" ring, braille spinners, live-well amber seam, `ScoutLiveCaret`, composer
focus washes, file links in prose. The HudsonKit sidebar rail (accent glyph on
the selected item) is shared shell and out of scope here.

**User control (added same day):** `ScoutAccentVolume` (Quiet default / Vivid)
in Settings → Accent, persisted at `scout.appearance.accentVolume` via
`ScoutAppearance`. Vivid restores the classic solid fills at the four gated
spots (operator bubble, queued operator turn, filter segment, sparkline);
everything moved to plain ink (links, marks, Show more, timeline icons) stays
neutral at both volumes. `ScoutActivitySparkline` and
`ScoutPendingOperatorTurnRow` observe `ScoutAppearance` directly — their
inputs are value-equal across renders, so a `.current` read alone could go
stale when the setting flips.

## 9. Thread-switch transition — IMPLEMENTED 2026-07-09

Switching conversations used to hard-cut through a zero state that read "No
messages yet · This chat has no visible messages" while the fetch was in
flight — a false claim and a jarring bounce. Three-part fix in
`ScoutCommsStore` + `ScoutRootView`:

- **Per-conversation transcript cache** (24 entries, insertion-order
  eviction): `selectChannel` / `selectPendingConversation` /
  `openAgentChannel` paint `messageCache[cId]` immediately, so revisited
  threads render instantly and refresh in place. Fetches populate the cache
  even when the user has already navigated away. This also fixed
  `openAgentChannel` flashing the *previous* thread's rows under the new
  header (it never cleared `messages`).
- **`isLoadingMessages`** — set on selection, cleared when the fetch settles;
  the steady-state poll never sets it, so it only gates the first paint.
- **`ScoutThreadLoadingSkeleton`** — three avatar-led ghost turns (neutral
  inset washes, gentle group pulse, reduce-motion holds steady) replace the
  empty state during cold loads; skeleton ↔ transcript ↔ empty state crossfade
  at 0.18s. The header and composer hold steady, so the switch reads as the
  thread filling in. The "No messages yet" copy now only appears once the
  fetch has actually settled empty.

## 7. Single-unit relative timestamps

`ScoutTimestamp.relativeAge` (`packages/scout-native-core/Sources/
ScoutCapabilities/Time.swift:33–35`) emits two-unit hour strings — `8h 50m`,
`19h 35m` — which read as *durations*, not ago-times, and spend precision
nobody uses in a list. Change the hours branch to `"\(hours)h"`
unconditionally. If a diagnostics surface genuinely wants the precise form,
add a `precise:` variant there — the default everywhere (list ages, turn
timestamps) goes single-unit: `14m`, `8h`, `3d`.

## 8. Small legibility items

- **Filter segment** (`ScoutConversationListBar`,
  `ScoutCommsView.swift:442–451`): the briefcase/person/# icon toggles are
  cryptic. Add `.help` tooltips, and reflect the active filter in the search
  placeholder ("Search chats" / "Search agents" / "Search channels") so state
  is readable without decoding the glyph.
- **File viewer provenance** (`ScoutFileViewerPanel.swift`,
  `ScoutFileViewer.shared.open(path:line:)`): the pinned pane survives thread
  switches with nothing saying why the file is open — in the capture it shows
  `ProjectsInbox.tsx` beside a thread about `ScopeDesign.swift`, reading as
  stale state. Thread `open()` an optional source (channel id + display
  handle); render a quiet `from {handle}` caption in the header,
  click-to-return. When the selected thread isn't the source, dim the header
  a step. Pinning behavior is otherwise unchanged.

---

## Sequencing

1. **Subtraction pass** — §2 chips/copy, §5 dedupes, §6 accent, §7 timestamps,
   §8 tooltips. Pure removals and copy; no data changes; one PR.
2. **Reading pass** — §1 thread-aware clamp, §2 reply-quote resolution.
3. **List pass** — §3 title grammar, §4 failure mark (needs the server flag).
4. **Triage pass** — §4 archive route + decay group (broker + client).
5. §8 file-viewer provenance rides with whichever pass touches the panel.

## Out of scope, deliberately

- **Turn material (wells vs flat turns).** The comms design call was
  avatar-led turns, not bubbles; the current implementation wraps bodies in
  filled rounded wells (`bubble {}`, radius 11, fills per side). Flattening
  incoming turns to bare text under the name line would be calmer and is
  worth exploring — but it's a material change, so it goes through the studio
  comms lab first, not straight into SwiftUI.
- **Renaming the `session:` composer token** — copy follows in §2 if/when the
  token changes.
- **Web/iOS parity** — this spec is macOS-first; the same rules (title
  grammar, timestamp format, id demotion) should port to the web comms
  surface as a follow-up so the One System grammar holds.
