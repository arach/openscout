# Comms — channel + DM navigation, sorted

Status: DIRECTION v3 (2026-07-29). v1 was prompted by the side-by-side with
Slack's client; v2 folds a three-lens panel review — IA/failure-modes (Grok),
visual craft (Kimi), product coherence (Opus); v3 adds the operator's
hierarchy rule (D1) — groupings over states, built for hundreds of sessions —
and neutralizes the palette (green is attention only, D4). Slack is not the taste bar — it
is the *convention* bar: its sidebar grammar is what every user's hands already
know. We borrow the grammar where our deviation is accidental, and keep the
deviations that are Scout's actual product (observation, agents, steering).

Working artifact: `/studies/comms-one-rail` (design/studio/views/comms-one-rail.tsx).
The earlier `/studies/messages-home` treatments are superseded (see D2) and kept
for the record.

## Diagnosis — why the combination feels tricky today

1. **Three competing switchers for one axis.** The app nav ships `Messages`,
   `Direct Messages`, and `Channels` as three destinations
   (`scout/nav-destinations.ts:112,120,376`), the rail then re-asks the same
   question as a segmented control (All | DMs | Channels), and the breadcrumb
   can say `Messages / Direct Messages` while the URL is `/channels`. Slack
   has ONE conversation list; "channel vs DM" is a *section boundary*, never a
   navigation decision. Every extra switcher is a place for state to disagree
   — and in the screenshot it does.
2. **A landing page where a conversation should be.** `/channels` renders an
   explainer ("A channel is a broker-backed conversation…") plus suggested
   channels in the main pane. Slack never spends the center screen teaching;
   you are always *in* the last conversation. Teaching belongs to the
   zero-state; discovery belongs to an intentional browser.
3. **Session plumbing leaks into the people list.** DM rows subtitle
   themselves with `session-ms54kjeh…` ids and project groups read `6/6`,
   `25/28` — inventory ratios, not conversations. House rule already exists:
   "conversation" is the user-facing noun; sessions are the execution layer.
4. **The rail reads as inventory, not attention.** Slack's sidebar is an
   attention instrument (bold unread, mention badge, starred pins). Ours
   shows counts-of-things and time-ago with no unread emphasis — nothing
   pulls rank, which contradicts the steering-loop direction (needs-you is a
   precedence layer).
5. **The suggested channels are unbacked.** `#releases / #triage / #reviews`
   render like joinable channels but don't exist until something creates
   them — precisely the affordance class we've banned.

## The decisions

**D1 — One destination, one rail.** `Messages` is the single nav entry;
`Direct Messages` and `Channels` leave the app nav (and the command palette
keeps deep-link entries, routing into the one surface). The rail's
All/DMs/Channels segmented control is deleted. The rail is one scrollable
list with collapsible sections, in fixed order:

    Needs you        — pinned, only when non-empty; the precedence layer
    Agents           — grouped BY PROJECT; sessions fold onto identities
    Channels         — # rows
    Observed         — collapsed by default, visually dimmer stratum

*Order (v2, Opus):* Agents before Channels — channels-first is Slack's
convention for people who live in channels; Scout's operator lives in agent
conversations (where asks land) and dips into channels, the agents'
coordination space.

*Mirror rule (v2, Grok):* Needs-you **mirrors** rows, it never moves them.
The origin row stays in its section carrying the dot in place, so positional
memory survives when an ask resolves; nothing reflows under the cursor.

*Hierarchy rule (v3, operator): the load-bearing thing is hierarchy and
groupings, not row states.* The fleet runs hundreds of sessions; a flat
Agents section cannot survive that. Apply the same collapse rule as the
Agents tree (project · identity · session): inside Agents, rows group **by
project**; sessions fold onto the durable named identity — a rail row is a
conversation with an identity, never a harness session; the unnamed churn
rolls up (`…28 more`); cold projects collapse to a name + count. Rows are
earned by recent conversation, never by roster (no readiness lists). The
arithmetic must be load-invariant: ~160 sessions → 13 rail rows, and the
row count barely moves at 500.

The rail header carries creation and the one stat: a quiet `+ New chat`
(ink + weight, not accent — on a triage surface accent belongs to attention)
and the mono `N need a reply` readout. Filter-as-you-type stays and searches
the collapsed Observed stratum too; sort toggles collapse into one default
(attention, then recency) — sorting is a preference, not chrome.

**D2 — Always land in a conversation.** There is **no landing page** — the
rail + open conversation IS the triage surface. (Panel verdict: both
`/studies/messages-home` treatments were landing pages, the exact thing
diagnosis #2 kills; the split-inbox variant was this rail wearing different
labels. Salvaged from them: the coalesced-notice fold and the need-a-reply
stat.) A fleet overview, if wanted, belongs to Home or the notifications
ledger — never to comms.

*Landing precedence (v2, Grok):* **unseen** needs-you (newer than your last
Messages visit) → last-active *participant* conversation → zero-state.
Landing once marks it seen — a deliberately deferred ask must not hijack
every entry all day. Never auto-land in an Observed thread.

*Compact clause (v2, Opus):* on compact width (iOS; collapsed macOS split)
the rail becomes the screen and landing-in-a-conversation would hide the
precedence layer — so compact lands on the **list** with Needs-you pinned.
Timestamps return as trailing row meta (no hover on touch), and the channel
browser becomes a sheet/push. Prerequisite decision: the iOS tab bar
currently has no Messages destination at all.

*Discovery (v2, Grok+Opus):* discovery lives in the **channel browser**
(reached from `+` on the Channels section header and the palette). The
browser lists what *exists* — no template pseudo-rows. The verb is
**follow/pin** (visibility — the operator already sees all broker traffic),
never "join": membership is Slack grammar Scout doesn't have. Inline dimmed
rows in the rail are deferred until there are real existing-but-unfollowed
channels to show; templates are deferred until channels are created by real
work — a template that creates an empty room with no agents in it is backed
but inert.

**D3 — One row grammar for both kinds.** Channel rows (`#` prefix) and agent
rows (sprite avatar + activity) share typography, height, badge position, and
selection treatment. A DM row is `name · activity`, never `name · session-id`
— session identity lives in the inspector. Group/channel meta is activity
grammar, not people grammar: `5 agents · 2 working`, never `8 members`.
Project groups keep their collapse but lose ratio-counts.

*Craft ledger (v2, Kimi):* four type stops — 13px (titles at 600 + reading
body), 12.5px (all row/list text, buttons, composer), 11.5px (compact
controls: kbd, inline code), 10px (every mono meta: eyebrows, sections, ages,
counts, activity verbs). Two mono trackings: 0.14em for the uppercase
eyebrow/section register, 0.08em for inline meta. ASCII marks (`+`, `×`),
never fullwidth forms. Activity verbs render only where there is activity
(`working`, `watching`) — idle is expressed by absence, or it becomes a
readiness roster.

**D4 — Attention is the visual system, and it fires only for you.** Emphasis
(bold + count) belongs to **needs-you and direct address** (asks/mentions)
only. Agent-to-agent traffic is ambient — steering philosophy says that
churn is not owed a read — and is expressed by sort recency alone: no bold,
no count, no dot. This kills the inbox-zero treadmill Slack's
bold-everything grammar imports. The accent splits cleanly: the emerald
**dot = needs-you**; **bold + mono count = addressed items**; nothing else
carries either. Identical broker notices coalesce to **one read unit**
inside their conversation (solid-hairline fold row, count pill + chevron;
dashed reads as placeholder) — seen once when the fold is seen, excluded
from every headline count. Time-ago lives on hover/inspector on pointer
surfaces, trailing meta on touch.

*Palette (v3, operator):* surfaces are **neutral gray** — the v2 study
tinted bg/panels/hairlines green and the frame read as one color
("st-patricks"). The only green pixels are attention: the needs-you dot,
the addressed count, the need-a-reply stat, the ask card's tinted hairline.
Selection is a neutral fill; creation (New chat, Send) is ink + weight.
The values are not bespoke: they are the **shared Hudson tokens** all three
shipped surfaces already consume (iOS `HudPalette`, macOS via HudsonKit,
web `--hud-*`) — bg `#0a0a0a`, surface `#171717`, ink `#e5e5e5` / muted
`#a3a3a3` / dim `#737373`, border `#272727`, accent emerald-500 `#10b981`.
Any port binds to the theme tokens, not these hex values, so macOS preset
and accent choices flow through.

*Turn grammar (v3):* inside a conversation the registers are — **ambient**
(flat, quiet), **ask** (the steering atom: the only carded, only accented
unit; composer pre-addressed), **status** (compact mono line, not a full
turn), **notices** (coalesced fold), **artifact** (a path chip — work
points at files, never pastes them).

**D5 — Observed is a stratum, not a sibling.** Observation has no Slack
analog and is Scout's real product — keep it, but as a visibly *different
register*: collapsed by default, dimmer ink, no activity dots, "watching"
verbs. It must never interleave with conversations you're a participant in,
and it has **no unread state at all** (v2, Grok): its count is inventory,
activity inside the section is sort order — otherwise "Observed · 49" is a
permanent pressure source, the ops-noise this redesign exists to kill.

*Click contract (v2, Opus — open ratification):* an observed row is a
watched transcript, not a conversation — it has no composer. Direction:
selecting one opens a **watch pane** with a single *step-in* affordance that
promotes it to a real conversation (that promotion IS the steering loop, and
the server-side needs-attention/pendingAsk lane already points there). If
step-in isn't buildable now, Observed moves to Agents/Tail and a session
enters Messages only when it produces a needs-you. Ratify one.

**D6 — One source of title truth.** The breadcrumb derives from the actual
route/selection or it goes. A surface may never display two different
answers to "where am I".

## Deliberately not Slack

- No workspaces rail, no Huddles, no Later/Files pillars — our far-left nav
  is surfaces, not attention modes; Activity/attention is solved by D1's
  Needs-you section plus the notification ledger.
- No bold-everything unread, no join/membership, no member counts — see
  D4/D2/D3.
- Avatar-led turns (not bubbles), the flat crisp composer, and the grouped
  filter toggle stay as decided in the comms design calls.
- Agents are not "people": activity means *working/needs-you*, never
  online/offline availability, and idle is silence.

## Implementation surface (for the study, then the port)

**Web port landed 2026-07-29 (uncommitted, branch `studio-craft-pass`).**
Route unification (one `messages` route; `channels` view, `MessagesFilter`,
and the DM/Channels secondary strip deleted; `/channels/<id>` parses as a
legacy alias and never serializes), rail rebuilt to D1 (Needs-you mirrors ·
Pinned · Agents · Channels · Observed collapsed · Archived; addressed-only
emphasis, no sort/filter chrome), bare `/messages` lands per D2 precedence.
Channel `@you` mentions still have no backend, so channel rows carry no
emphasis (gap named in `left.tsx`). Observed dimmer-ink (D5) deferred to the
craft pass. macOS/iOS ports not started.

- **Route unification first (v2, Grok — blocker).** D1 collapses
  destinations but must also collapse routes: `view:"channels"` stays a
  separate route the rail navigates into (`screens/chat/left.tsx:205-207`)
  while `chat.active()` matches only `messages|conversation`
  (`nav-destinations.ts:114-117`) — after Channels leaves the nav, a channel
  deep link lights NO destination (D6 broken). The palette also keeps
  `filter:"dm"/"channel"` params (`nav-destinations.ts:553-562`) whose only
  rendering UI D1 deletes. Fix: one conversation route (channels included),
  delete `MessagesFilter` from Route, palette deep links become
  focus-section commands, retire the `channels` NavDestinationId.
- `packages/web/client/screens/chat/left.tsx` — the rail rebuild (D1/D3/D4/
  D5); `OBSERVED_PREVIEW_LIMIT` logic survives inside the collapsed stratum;
  the shipped `isUnread` computation must NOT port into Observed (D5) and
  narrows to addressed-only elsewhere (D4).
- `packages/web/client/screens/chat/ChannelsScreen.tsx` — landing removal
  (D2); explainer → zero-state; browser affordance.
- Studio: `/studies/comms-one-rail` is the working frame; K-lane note — the
  rebuilt rail adopts the shared list-focus primitive when K5 lands, so the
  study rows already use the same roving/cursor grammar.
