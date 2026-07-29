# Web · New task composer — layout and look-and-feel pass

Status: in progress (studio-craft-pass branch)
Surface: web app, `packages/web/client/screens/agents/NewChatComposer.tsx`
Styles: `packages/web/client/screens/agents/agents-rail.css` (`.s-newchat-*`)
Sibling study: `/studies/scout-ios-new` (Scout iOS · New session — destination)

## What this dialog is

The Cmd+N "New task" modal. Three jobs: **where** (project), **how** (harness /
model / effort), **what** (the task text). It is the front door for starting work
from anywhere in the web app.

## Current state — assessment

The panel is 560px, `.s-newchat-body` is a flex column with a single repeated gap.

1. **Reading order is inverted against task priority.** The heaviest element is
   the "Run with" card — border, fill, an `<h3>`, a description sentence, three
   38px wells, and a note. The lightest is the task textarea, the only field that
   must be filled every time. The textarea already calls `.focus()` on mount, so
   focus and visual weight actively disagree.
2. **Rhythm is monotone.** One gap (`--space-md`) between every child, so project,
   chips, runtime, and composer all read at equal weight.
3. **Containers compensating for weak proximity.** panel → runtime card → control
   wells is three nested borders. DESIGN.md is "flat with hairlines"; the craft
   floor calls nested cards always wrong.
4. **Redundancy.** The project title appears twice — as the search field's value
   and again as the first chip. The `new worker` chip restates what the dialog
   title and the "Run with … for this worker" heading already say.
5. **Ceremony copy.** "Choose the harness, model, and thinking depth for this
   worker." restates three visible labels. "Claude Code is ready for workspace,
   collaboration." duplicates the Ready pill two lines above it.
6. **Two disagreeing label voices.** `.s-newchat-field-label` is mono/700/uppercase
   /`--tracking-lg`; `.s-newchat-runtime-field-label` is mono/650/sentence-case
   /`--tracking-sm`. Both hand-rolled, against DESIGN.md's Eyebrow-Tier Rule
   (there are exactly four legal eyebrows, `.label-xs`–`.label-lg`).

The mechanical detector (`detect.mjs --scope layout`) returns `[]`. These are
hierarchy and rhythm problems, which it cannot catch.

## Product constraint driving the direction

PRODUCT.md: *"Design optimizes for their hundredth session, not their first."*
By the hundredth session the project and runtime are usually already correct and
the task text is the only thing that changes. The layout must reflect that.

Operator selected direction: **task leads.** Composer moves directly under the
header and becomes the dominant element; project and runtime stay fully visible
below it, lighter. Nothing hidden behind a disclosure.

## Ideas adopted from `/studies/scout-ios-new`

The iOS "New session — destination" study solves the same problem on a phone.
Five ideas port directly:

1. **Runtime folds into the composer tool row.** iOS docks `✳ Opus | HIGH ▾`
   inside the composer next to send. That deletes the entire "Run with" card
   rather than restyling it — the strongest available simplification.
2. **Standing search, rows replaced in place.** "Search costs one permanent row.
   Typing replaces the three rows with curated matches in place; nothing moves,
   nothing opens." This removes the dropdown overlay entirely — and with it the
   clipping problem that a reorder would otherwise create, since an absolutely
   positioned list opening downward from a field low in a scrolling body gets cut
   off by `.s-newchat-body { overflow-y: auto }`.
3. **A foot that names what is held back.** "All 57 projects · 6 worktrees ·
   5 scratch · 3 folders ›". Honest truncation over silent truncation; matches
   the product principle that naming the gap beats filling it.
4. **A destination readout that costs the common case nothing.** With one obvious
   target, show a readout rather than a control demanding interaction.
5. **"Describe the task, or leave blank…"** — the placeholder admits that starting
   a session with no task is legitimate.

The curation point is load-bearing and matches this repo: PRODUCT.md's operating
context calls out "the same repo on several branches or worktrees". Worktree
clones and scratch checkouts are kept and labelled, not deleted, but they are not
peers of the main project.

## Constraints any proposal must respect

- DESIGN.md "Scout Web": OKLCH neutral canvas hue 260, lime accent hue 125, flat
  at rest, 1px hairlines, shadow only as a response to state.
- Eyebrow-Tier Rule: compose `.label-xs`–`.label-lg`; do not hand-roll a fourth
  label voice out of font-family + transform + tracking + size.
- Color-Mix Rule: derived colors from `color-mix()` off a semantic token.
- No left accent bar on a rounded well — that treatment is for flat rows only.
- No unbacked affordances: every control maps to a real route. The runtime
  catalog comes from `/api/runner/options`, projects from
  `/api/agent-config/snapshot`.
- Vocabulary: "conversation" is the user-facing noun; "session" is reserved for
  the harness execution layer.
- Keyboard operability is a functional requirement, not only an accessibility
  one. The project picker is a `role="combobox"` with arrow-key navigation and
  `aria-activedescendant`; whatever replaces it keeps equivalent keyboard access.

## What landed

Verified in the running app at `:43120`.

- **Composer leads.** It sits directly under the header at `min-height: 84px`, and
  the runtime rides in its tool row as one `RuntimePicker` chip. The "Run with"
  card is deleted rather than restyled — panel → card → well became panel → chip.
- **Project picker is a standing search.** Filter input, five rows in normal flow,
  and a foot reading `5 of 23 projects · type to narrow`. No overlay at all, which
  is what finally fixed the clipping: an absolutely positioned list opening out of
  a field this low in a scrolling body gets cut off downward *and* upward.
- **Readiness only speaks when it matters** — unavailable, catalog error, or
  loading. The "● Ready" pill and its restating note are gone.
- **Rhythm** is `lead` (gap `sm`) / hairline / `config` (gap `lg`), with 20 above
  the hairline against 12 below.
- **Labels** collapsed onto `.label-md`; the two hand-rolled voices are gone.
- `RuntimeOption` widened to `string | { value, label, disabled }` so the chip can
  show `Opus 5` while the value stays the round-tripping id `claude-opus-5`.

### Answers to the open questions

1. **Harness in the composer row?** Yes — all three, as one chip. The harness reads
   as its mark, not a word, which is what keeps it short.
2. **Where readiness lives:** nowhere, when it is fine. Loading and unavailable get
   a single line in the config block.
3. **Curation rule:** none is possible. `ProjectLaunchTarget` carries only
   `{ id, title, root, defaultHarness, source, registrationKind }` — no worktree or
   scratch taxonomy and no recency timestamp. The foot therefore reports counts it
   can prove and nothing else. Five rows rather than the study's three, because the
   study's three works only *because* its list is curated.
4. **Attachments case** survives: the mode toggle moved into the config block and
   the runtime chip goes disabled rather than unmounting.

### Known follow-ups

- `Cmd+P` to jump to the project field — it is now after the composer in DOM order.
- A debounced `role="status"` count, so filtering a standing list is not silent to
  assistive tech.
- Fixed-height row container, so "nothing moves" holds at the pixel level.
- Seven hand-mixed hairline alphas that should be one token.
- `.s-newchat-title` still sits off the Title tier.
- Worktree/scratch classification wants to land server-side on
  `ProjectLaunchTarget`; only then can the foot say what the iOS study's says.

## Open questions for review

1. Harness, model, and effort are three controls. iOS docks only model + effort
   (`✳ Opus | HIGH`) and leaves harness implied. On web, does harness belong in
   the composer row too, or does it stay a separate control because switching
   harness is a materially bigger decision than switching model?
2. With the runtime card gone, where does harness readiness ("● Ready" /
   "Unavailable" / the model-catalog load error) live so it is still noticed
   without reintroducing a status band?
3. The curated project list needs a curation rule for web. iOS uses
   device-recent-first with worktree/scratch/folder rows labelled and pushed
   behind a foot. What is the right web equivalent given route context already
   supplies a preferred project?
4. Does the attachments case (`Route capture` title, existing-chat vs new-session
   mode toggle) survive the reorder cleanly, or does it need its own treatment?
