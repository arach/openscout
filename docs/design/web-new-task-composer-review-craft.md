# Review · New task composer — visual craft and the design system

Lens: visual craft / DESIGN.md conformance. Reviewer: `session-ms669t29-7xy8hg`.
Reviewed against working-tree `NewChatComposer.tsx` (995 lines) and
`agents-rail.css` on `studio-craft-pass`, **not** the "current state" section of
[web-new-task-composer.md](./web-new-task-composer.md) — the reorder has already
landed in the tree. `TASK LEADS` is settled and not relitigated here.

## What already landed and is correct

- `RuntimePicker` in the composer `tools` slot. The `Run with` card, its `<h3>`,
  its sentence, and the three 38px wells are gone.
- `.s-newchat-field-label` reduced to `color: var(--muted)` with the type coming
  from `.label-md`. One legal eyebrow, correctly composed.
- The project title chip deleted; only the path survives as `.s-newchat-target`.
- Readiness reduced to bad-news-only (`s-newchat-runtime-note`).
- `.s-newchat-lead` / `.s-newchat-config` split with one `border-top`.

The remaining problems are weight and theme, not structure.

## 1. Grouping without a container

**The tonal step is not available in light mode.** This is the load-bearing fact
and it is why the card had to go, not merely that the card was heavy.

| | dark | light |
|---|---|---|
| `--bg` L | 0.132 | 0.978 |
| `--surface` L | 0.178 | 0.992 |
| \|bg − surface\| | **0.046** | **0.014** |

Every `color-mix(bg X%, surface)` recipe therefore yields a step ~3.3× weaker in
light. Measured on the two surfaces that mattered:

- Old runtime card vs panel: dark ΔL ≈ 0.024, light ΔL ≈ 0.007.
- **Composer shell vs panel** (`--bg 64%, --surface`, still live): dark ΔL ≈
  0.028, light ΔL ≈ 0.008.

So under `TASK LEADS` the *lead element itself* is 3.4× flatter in light and is
carried entirely by its border. Grouping and leading both have to be spent on
hairline weight in light, not fill.

**What carries grouping instead — three DESIGN.md primitives, no new container:**

1. **A hairline weight ladder.** Today the panel border (`ink 15%`), the
   composer shell (`ink 16%`) and the project field (`ink 14%`) are visually one
   weight. In light that is exactly the "loose floating rows" failure: no box
   leads, because all three boxes weigh the same. Ladder them:

   | selector | now | proposed |
   |---|---|---|
   | `.s-newchat-panel` | `ink 15%` | `var(--border)` — window chrome, theme-owned |
   | `.s-newchat-panel .s-msg-compose-shell` | `ink 16%` | keep `ink 16%`; the only **filled** box |
   | `.s-newchat-config` (rule) | `ink 8%` | `var(--scout-chrome-border-soft)` |
   | `.s-newchat-project-search` | `ink 14%` + `--bg 72%` fill | `ink 9%`, `background: transparent` |

   Three distinct weights instead of one. `--scout-chrome-border-soft` is the
   theme-aware hairline (4% ink dark → `--hud-border` 80% light), which is what
   DESIGN.md's "4–6% ink in dark or the border token in light" describes. The
   field losing its fill costs nothing in dark and buys the composer the only
   filled surface in the panel in both themes.

2. **A tier drop, carried by size not color.** See §2.

3. **Fusion, not containment.** `MessageComposer` already ships the house
   grouping primitive — `above` + `aboveAttached`
   (`message-composer.css:588-600`): *"the slot drops its bottom edge and the
   shell's own top border becomes the divider between them — one hairline, never
   two."* The attachments strip is currently a `.s-newchat-lead` sibling floating
   at an 8px gap; it belongs in `above` via the existing
   `ComposerAttachments.tsx`. Same slot for the mode toggle (see §5, Q4).

## 2. Label tiers — exactly

- **PROJECT** → `.label-md` (10px / `--tracking-lg` 0.12em) + `color:
  var(--muted)`. **Already correct as shipped.** It is now the only eyebrow in
  the panel body, which is why 10px rather than the old 9px is right.
- **RUN WITH** → **does not survive.** It headed a card that no longer exists.
  Re-adding it as an eyebrow over a toolbar chip would label a control that
  already names itself.
- **Harness / Model / Effort per-control labels** → they no longer exist as
  panel labels. They became the chip panel's band heads, and those are the
  remaining illegal voice — `.s-rt-label` in
  `packages/web/client/components/MessageComposer/runtime-picker.css:152` is
  9px mono 600 uppercase at **`letter-spacing: 0.22em`**, off the tracking scale
  entirely (it tops out at `--tracking-xl` 0.18em). DESIGN.md: *"Don't add
  fractional font sizes or off-scale letter-spacing."*
  → replace the rule with `.label-sm` (9px / 0.08em) on the element +
  `color: var(--muted)`.
- `.s-rt-chip-effort` (`runtime-picker.css:99`) also hand-rolls
  `.label-sm` geometry with 0.12em tracking. → `.label-sm` + its `data-effort`
  color.
- **Never `.label-lg` here.** 11px/0.18em is a screen-level eyebrow; in a 560px
  modal it out-shouts the 12px `.s-newchat-title`.
- Delete `.s-newchat-runtime-field-label` outright rather than aliasing it.

**Colour rule for the tier drop:** keep *both* tiers on `var(--muted)` and let
size + tracking do the work. Differentiating eyebrows by dropping to `--dim` is
the standard light-mode failure: light `--dim` is L 0.72 against a 0.99 surface
(ΔL 0.27) versus dark's ΔL 0.39, and DESIGN.md scopes `--dim` to *"tertiary text
and disabled affordances"*. SCO-085 raised the faint tier to 55–60% for exactly
this reason; do not walk it back through eyebrow colour.

## 3. Spacing rhythm for `.s-newchat-body`

Current ladder is 4 / 8 / 12 / 12 — the top two rungs are equal, which is the
monotone problem in smaller form. And `.s-newchat-config`'s comment says *"More
air above the hairline than below it"* while the CSS gives **12px above (body
gap) and 12px below (padding-top)** — comment and code disagree.

Off the 14-step scale:

| relationship | token | px | why |
|---|---|---|---|
| field → its path readout | `--space-3xs` | 2 | the readout *is* the field's value; it should look welded on |
| label → its control | `--space-xs` | 6 | tight, owned |
| within config (field ↔ mode ↔ note) | `--space-lg` | 12 | normal |
| within lead (composer ↔ attachments ↔ error) | `--space-sm` | 8 | tighter than config: these report on the message |
| **lead ↔ config (across the rule)** | `--space-3xl` above / `--space-lg` below | **20 / 12** | the one generous step; asymmetric so the rule reads as belonging to the block it introduces |

Concretely:

```css
.s-newchat-body   { gap: var(--space-3xl); padding: var(--space-2xl) var(--space-2xl) var(--space-lg); }
.s-newchat-lead   { gap: var(--space-sm); }
.s-newchat-config { gap: var(--space-lg);
                    padding-top: var(--space-lg);
                    border-top: 1px solid var(--scout-chrome-border-soft); }
.s-newchat-field  { gap: 0; }
.s-newchat-field-label { margin-bottom: var(--space-xs); color: var(--muted); }
.s-newchat-target { margin-top: var(--space-3xs); }
```

Ladder becomes **2 / 6 / 8 / 12 / 20** — five distinct rungs, ratio 10:1
end-to-end. Body padding goes 12 → 16 (`--space-2xl`) to match DESIGN.md's
`surface-card` padding; a 560px modal at 12px reads cramped once the composer is
the dominant object.

**The one hairline** goes exactly where it is now — `border-top` on
`.s-newchat-config`, between the composer object and the where/how block — with
the token swap above. There is no second rule anywhere in the body.

## 4. Light-mode check

Six concrete defects, all in live selectors:

1. `.s-newchat-backdrop` (`agents-rail.css:127`) —
   `color-mix(in srgb, var(--bg) 76%, transparent)`. In light `--bg` is
   oklch(0.978): **a 76% white scrim over a white app.** No figure/ground; the
   panel floats on nothing. `--scrim` exists for this (`rgba(20,22,26,0.32)`
   light / `rgba(0,0,0,0.5)` dark). → `background: var(--scrim);`
2. `.s-newchat-panel` (`:141`) — `box-shadow: 0 24px 60px -28px rgba(0,0,0,0.6)`,
   hard black in both themes. DESIGN.md: *"a heavy black shadow on a light
   surface reads as dirt."* → `box-shadow: var(--hud-shadow-panel);`
   (Hudson-managed, per-theme.) Same for the `--starting` / `--dragging`
   variants, which repeat the literal.
3. `.s-newchat-project-results` (`:329`) — `0 18px 40px -22px rgba(0,0,0,0.85)`.
   Worst offender, and it is the surface you stare at while choosing.
   → `var(--hud-shadow-nav)`.
4. `.s-rt-panel` (`runtime-picker.css:126`) — `0 18px 40px -12px rgb(0 0 0 /
   0.45)`. Inherited with the chip. Same fix.
5. `.s-newchat-target` (`:398`) — `color: var(--dim)` at `--text-2xs` (9px)
   mono. A 9px mono path at light `--dim` L 0.72 on a 0.99 surface is precisely
   the case SCO-085 was written about. → `var(--scout-chrome-ink-faint)`.
6. `.s-newchat-runtime-note[data-warning="true"]` (`:556`) — `var(--amber)`.
   Light `--hud-status-warn` is oklch(0.72 0.15 85) on a **hue-85 warm paper
   canvas**: low contrast *and* hue-collision with the ground, on the one message
   that must not be missed ("harness unavailable"). An unavailable harness blocks
   the send — it is an error, not a warning. → `var(--red)`
   (light oklch(0.62 0.19 25): darker, and hue-distant from the paper).
   If the catalog-fetch failure should stay distinct as degraded-not-blocking,
   split the two states rather than keeping one amber for both.

## 5. The four open questions

**Q1 — does harness belong in the composer row too?**
Yes, and it already does. `RuntimePicker` ships on web at
`screens/home/content.tsx:1291` and folds all three. The premise — switching
harness is a materially bigger decision — is true, and the chip already honours
it: harness is a `HarnessMark` **glyph, not a word**, so the third control costs
~14px of the row while the decision itself lives one level deep in the panel's
first band. Materially-bigger decisions earn *depth*, not *width*. Splitting
harness back out would leave one lonely labelled select in the body and
reconstitute the config block the direction just deleted.

**Q2 — where does readiness live?**
The shipped answer (bad-news-only line) is right; two refinements:
- Readiness is a property of the runtime, so the *state* belongs on the runtime
  control and the *sentence* belongs next to what it blocks. Give the chip a
  tone under failure — `.s-rt-chip[data-ready="false"] { background:
  color-mix(in srgb, var(--red) 12%, transparent); color: var(--red); }`, the
  DESIGN.md chip-tone recipe — and keep the sentence as the single `role="alert"`
  line under the composer, which is what is actually disabled.
- Ready state shows nothing. A permanent "● Ready" is the status band the
  direction removed, and it violates *earned by real state only*.
- Loading: do not spin. `RuntimePicker` already renders the resolved default;
  a spinner for a local route is noise. If it must register,
  `[aria-busy="true"] { opacity: .6 }`.

**Q3 — curation rule for web.**
The resting list today is `buildProjectLaunchTargets` sorted **alphabetically by
title** (`session-start.ts:64`), sliced to 40. On this machine that puts the
umbrella folders `Art`, `Dev` at the top by accident. Web rule, using only data
already in the component:
1. Route/context project first, as a **readout** not a row — `chooseInitial
   ProjectLaunchTarget` already computes it.
2. Then agent-recency: `agents` is already sorted by `updatedAt`
   (`NewChatComposer.tsx:259`); group by `projectRoot ?? cwd`, take max per root.
   That is iOS's "device-recent" with **zero new routes**.
3. Then the remaining inventory, alphabetical — demoted, not deleted.
4. Cap the resting list at 3–5 rows, not 40. Forty rows in a
   `max-height: min(320px, 42vh)` scroller is a haystack.
5. **Foot: ship only what web can derive.** `registrationKind` is broker
   registration (`current` / `discovered` / `configured`) — it is **not** a
   worktree/scratch taxonomy. Porting iOS's *"12 worktrees · 5 scratch ·
   3 folders"* today would be an unbacked affordance. Ship `All 57 projects ›`
   now; add `· N worktrees` / `· N scratch` only behind a real path-shape test
   (`/\.codex\/worktrees\/|\/worktrees\//`, `^/(private/)?tmp/`). There is no
   backing for a "folders" class at all — name the gap instead of faking it.

**Q4 — does the attachments case survive?**
Mostly yes, with one structural move and one real conflict:
- `.s-newchat-attachments` should move from a `.s-newchat-lead` sibling into the
  composer's `above` + `aboveAttached` slot via `ComposerAttachments.tsx`. As a
  sibling it floats; fused it reads as cargo on the message.
- **The mode toggle is a destination switch, not a config switch.** Existing chat
  vs New chat answers *where this lands*, so it belongs with the destination, not
  stranded in `.s-newchat-config` below the composer with nothing to attach to.
  Move `.s-newchat-mode` into the same `above` slot and rebuild it on the
  DESIGN.md segmented recipe (`.chip--pill`, `--accent-soft` fill for the on
  state) instead of its bespoke buttons.
- **Conflict the reorder creates:** when `mode === "existing-chat"`,
  `usesNewWorker` is false and `RuntimePicker` unmounts from the toolbar
  (`NewChatComposer.tsx:787`). A control that appears and disappears from a
  toolbar on a toggle is worse than one that is disabled. Keep the chip mounted
  and `disabled`, showing the existing chat's runtime — that *is* the truth about
  where the message lands. This is a behaviour decision the direction forces and
  the implementing agent should make explicitly.

## 6. Two defects outside the four questions

**Dropdown clipping is now live.** `.s-newchat-project-results` is
`position: absolute` inside `.s-newchat-body { overflow-y: auto }`. With the
field moved *below* the composer, the list opens downward from near the bottom of
a scrolling box and gets cut off — the exact hazard the brief anticipated, now
real. `RuntimePicker` already solved it in-repo: portal to `<body>`,
`position: fixed`, measured up/down placement (`RuntimePicker.tsx`, `measure()` /
`anchor`). Reuse it rather than re-solving it. Keyboard access must survive the
portal — the combobox contract (`aria-activedescendant`, arrow nav) is a
functional requirement per the brief.

**Dead CSS to delete** (verified: zero `.tsx` consumers) —
`.s-newchat-chip`, `.s-newchat-select`, `.s-newchat-well` (which also carries a
**resting** `box-shadow`, a Flat-At-Rest violation), `.s-newchat-foot`,
`.s-newchat-start`, `.s-newchat-start:disabled`, and the whole
`.s-newchat-runtime` / `-head` / `-grid` / `-field` / `-control` / `-readiness` /
`-value` block — plus the `@media` rules for `.s-newchat-runtime-grid` and
`.s-newchat-runtime-field--wide`. `.s-newchat-runtime-note` and `.s-newchat-mode*`
stay. That is roughly 150 lines of `agents-rail.css`; leaving it behind is how
the next person concludes the card is still a thing.

## Verification not run

`vite build` was not run — the working tree is being edited concurrently by
`openscout-agent-2` and a build here would race it. DESIGN.md requires it as the
TS+CSS gate before calling the change done; that is the implementing agent's step.
