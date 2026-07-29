# Appearance — decomposed picker style spec

Style/taste lead pass for the `/settings/appearance` iteration. Read-only review;
no code changes were made. Architecture, persistence, and migration remain owned
by the coordinating parent.

Scope: `packages/web/client/screens/settings/SettingsDrawer.tsx`
(`AppearanceSection`, lines 142–245), `settings-drawer.css` (lines 131–359), and
theme option data in `packages/web/client/lib/theme.ts`.

Grounding: root `DESIGN.md` ("The Lit Control Room"), `packages/web/DESIGN.md`
(browser dialect), and the live page at `http://localhost:43120/settings/appearance`.

---

## 0. Diagnosis — why the current page fails on its own terms

Three findings, each verifiable in the token source.

**0.1 — The three "templates" are one welded bundle.**
`hudsonkit/dist/tokens.css` defines `hudson` / `editorial` / `drafting` as
monolithic blocks that each set canvas hue *and* accent hue *and* `--radius`
together (tokens.css:71–96, 153–206, 242–325). There is no way to ask for
Editorial's 4px corners on a neutral canvas, or Drafting's square corners with an
emerald accent. The picker is not offering three settings; it is offering three
opinions.

**0.2 — Editorial and Drafting read colorful because their *canvases* are tinted,
not because their accents are warm.**

| template | dark canvas | canvas chroma | accent |
|---|---|---|---|
| hudson | `0.145 0 0` | **0.000** | `0.72 0.18 162` emerald |
| editorial | `0.21 0.015 60` | **0.015** | `0.69 0.16 40` rust |
| drafting | `0.20 0.02 240` | **0.020** | `0.72 0.18 60` amber |

`packages/web/DESIGN.md` puts the doctrinal canvas at chroma 0.004–0.008 and
states the accent "has nowhere to hide" precisely *because* the canvas is near
achromatic. Editorial and Drafting run 2–5× that chroma. Every surface in the app
is tinted before the accent is even placed — which is why the specimens render as
a brown box and a navy box. **The fix is to pull canvas chroma into the 0.004–0.008
band and let the accent carry the hue.** Warm/cool character survives; the wash
does not.

**0.3 — In dark mode, selection is signalled by hue alone, and hover nearly
matches it.**

Current dark states on the mode tiles (settings-drawer.css:164–196):

| state | border | plate |
|---|---|---|
| rest | `--border` (L≈0.28 @ 82%) | `color-mix(srgb, surface 88%, bg)` ≈ L 0.176 |
| hover | `color-mix(accent **40%**, border)` ≈ L 0.44 | `color-mix(accent 5%, surface)` |
| selected | `color-mix(accent **70%**, border)` ≈ L 0.58 | `color-mix(accent 10%, surface)` ≈ L 0.19 |

Hover and selected are 30 mix-points apart on a 1px hairline, and the plates
differ by roughly ΔL 0.015. That is below the threshold for a glance from across
a desk — which is the north star's stated test. In the live dark screenshot the
three mode tiles are distinguishable only by a 15px check glyph.

The template cards are no better: `border: accent` plus `inset 0 0 0 1px accent`
is a doubled hairline on a 200px card — high hue, negligible area, zero luminance
change.

Root cause: dark mode gets its hierarchy from **light and depth**
(root `DESIGN.md`: "light and depth do the structural work that color and
decoration would do in a louder product"). The current selected state uses color
only. It is fighting the system.

**0.4 — Two dead affordances found in passing.**
- Editorial declares `--hud-font-serif: "Source Serif 4"` (tokens.css:150), but
  `scout/Provider.tsx:211,250` sets `--hud-font-serif` as an **inline style** on
  the provider wrapper, which beats every stylesheet selector. Editorial's
  typographic promise never reaches the web app. This is an argument for naming
  palettes after their canvas rather than a literary register.
- The Appearance cards use `--radius-lg` (a *theme-independent* 8px from
  `styles/tokens.css:39`), not `--radius`/`--hud-radius`. So the page's own
  controls do not respond to the geometry setting they sell. The specimens do
  (`--hud-radius`, settings-drawer.css:272); the cards around them don't.

---

## 1. Page composition and control hierarchy

Four stacked axes, each introduced by the existing `SectionRule` (label left,
hairline, live value right). No cards-of-cards, no tabs, no accordion.

```
Appearance
Choose how Scout looks on this device.

COLOR MODE ───────────────────────────────── currently dark
  [ ☾ System | ☀ Light | ● Dark ]          ← segmented, 36px, no specimen

PALETTE ──────────────────────────────────── slate
  ┌ Slate ─────────┐ ┌ Bone ──────────┐ ┌ Graphite ──────┐
  │ ▬▬▬▬▬▬  ramp   │ │ ▬▬▬▬▬▬         │ │ ▬▬▬▬▬▬         │
  │ Neutral cool   │ │ Warm paper     │ │ Cool technical │
  │ CANVAS 0.145   │ │ CANVAS 0.21    │ │ CANVAS 0.20    │
  └────────────────┘ └────────────────┘ └────────────────┘

GEOMETRY ─────────────────────────────────── rounded
  ┌ Rounded ───────┐ ┌ Soft ──────────┐ ┌ Square ────────┐
  │ ▢ mono minimap │ │ ▢              │ │ ▢              │
  │ 8PX CORNERS    │ │ 4PX CORNERS    │ │ 0PX CORNERS    │
  └────────────────┘ └────────────────┘ └────────────────┘

ACCENT ───────────────────────────────────── emerald
  ● ● ● ● ●   Emerald · Cyan · Indigo · Amber · Rose
  ┌ live selected-row strip at chosen hue ─────────────┐

Saved on this device        Mode, palette, geometry, and accent are stored
                            per-device and stay in sync across tabs.
```

Ordering rationale: **mode → palette → geometry → accent** runs
most-consequential to least, and each row's specimen is legible only once the row
above it is settled. Mode leads because it changes every other specimen.

Hierarchy rules:
- Color mode is a **segmented control**, not three 68px cards. It is a three-way
  switch with no design content to preview; giving it card-weight equal to
  Palette misstates its importance. This reclaims ~40px and removes the page's
  most misleading equivalence.
- Palette and Geometry are **peer card rows**, 3-up, equal weight.
- Accent is a **dot row**, deliberately the lightest control on the page — it is
  the least structural choice.
- The `right=` slot on every `SectionRule` shows the live resolved value in mono
  lowercase (existing pattern, keep).
- Every card carries a mono uppercase **spec line** — the "serious design system"
  register the brief asks for. Spec lines state *facts*, not adjectives:
  `CANVAS 0.145 · CHROMA 0.004`, `8PX CORNERS`, `OKLCH 0.72 0.18 162`.

---

## 2. State visual language (dark-first)

**The governing move: selection is carried by luminance, confirmed by hue.**
Hover is *never* accent-tinted — that is what currently collapses the distinction.

All mixes in `oklab`, not `srgb`. The existing `in srgb` mixes compress badly at
the dark end and are a direct contributor to the flat states.

### 2.1 Plate and border ladder

| state | plate | border | ink |
|---|---|---|---|
| rest | `color-mix(in oklab, var(--ink) 3.5%, var(--bg))` | `var(--border)` | title `--ink`, sub `--muted`, spec `--dim` |
| hover | `color-mix(in oklab, var(--ink) 7%, var(--bg))` | `color-mix(in oklab, var(--ink) 18%, var(--border))` | spec lifts `--dim` → `--muted` |
| **selected** | `color-mix(in oklab, var(--ink) 10%, var(--bg))` | **`1px solid var(--accent)`** | title `--ink`, spec `--accent` |
| selected + hover | `color-mix(in oklab, var(--ink) 12.5%, var(--bg))` | `var(--accent)` | — |
| pressed | selected plate, `transform: scale(0.985)` (existing) | — | — |
| focus-visible | plate unchanged | border unchanged | `outline: 2px solid var(--accent); outline-offset: 2px` |

Derived against hudson dark (`--bg` L 0.145, `--ink` L 0.95, `--accent` L 0.72):

- rest ≈ L 0.173 → selected ≈ L 0.225. **ΔL ≈ 0.052**, roughly 3.5× today's step.
- accent border on selected plate ≈ **5.8:1** — clears the 3:1 non-text floor with
  margin, and the *hover* border (≈ L 0.32) is unambiguously below it.
- hover → selected is now a luminance step *and* a hue step, not 30 points of
  hairline mix.

Light mode uses the same ladder with `--ink` mixed into `--bg`; the percentages
hold because oklab keeps the steps perceptually even in both directions. No
separate light-mode table needed — that is the point of switching off `srgb`.

### 2.2 Why not a glow

Selection could be signalled with `box-shadow: 0 0 0 3px accent/14%`, but that is
the exact shape of `--focus-ring` (app.css:47). Keeping selection *on* the border
and focus *outside it with a 2px gap* is what makes keyboard traversal of a
selected card readable. Do not blur the two.

### 2.3 The confirmation mark

Replace the bare 15px lucide `Check` with a **filled accent disc**: 16px circle,
`background: var(--accent)`, glyph `var(--bg)` at 10px, `stroke-width: 2.5`.
This is solid accent used as an attention/confirmation mark, which the
Quiet-By-Default Rule explicitly permits ("solid accent is reserved for attention
marks and primary actions"). One disc per axis, top-right of the selected card.

Selection therefore has **three** redundant signals — plate lift, accent border,
filled disc — so it survives both color-blindness and a dimmed display. Today it
has one and a half.

### 2.4 Motion

Keep the existing 140ms `ease` on background/border/color. Add nothing. Gate the
`scale(0.985)` press under `prefers-reduced-motion` (already handled at
settings-drawer.css:959–966 — verify it covers the new selectors).

### 2.5 Accessibility

Each axis is single-select, so switch from `role="group"` + `aria-pressed` to
**`role="radiogroup"` + `role="radio"` + `aria-checked`**. Today three mutually
exclusive buttons announce "pressed / not pressed" three times instead of
"2 of 3." Roving tabindex, arrow keys move within the axis, Tab moves between
axes. Cheap, and it is the difference between a toggle bank and a picker.

---

## 3. Specimen composition — one register per axis

The central information-design correction: **a specimen must vary only the axis it
sits under.** Today one miniature varies palette, geometry, and accent at once, so
the eye reads color and never sees the corners.

**Color mode — no specimen.** The page itself is the preview. A 16px icon
(Monitor / Sun / Moon) inside the segmented control is sufficient. System shows
`resolves to dark` as its sub-label (existing, keep).

**Palette — a swatch ladder.** Six 24×24 chips in a row, hairline-separated,
drawn at the palette's real token values with mode locked to the currently
resolved mode:

```
canvas · surface · line · dim · ink · accent
```

Not a miniature UI. Reading a *ramp* is the design-system register the brief
asks for, and it makes the de-chroma work visible: Bone and Graphite differ from
Slate by a perceptible warmth in the first three chips, not by a colored box.
Under the ladder: `CANVAS L 0.21 · CHROMA 0.008 · HUE 78`.

**Geometry — a monochrome miniature.** Keep today's three-pane rail/list/detail
skeleton, but render it in the current palette's **neutrals only, zero accent**.
The selected-list-row and the action bar become `--ink` at 18% / 42% instead of
`--hud-accent`. Radius is then the only variable, and the eye actually lands on
it. Bump the preview to 116px and widen the detail pane so the corner arc is
legible at 8px vs 4px vs 0px.

**Accent — hue dots plus one live strip.** Five 20px discs at fixed L/C
(`oklch(0.72 0.18 <hue>)`), selected disc gets a 2px ring at
`color-mix(in oklab, var(--accent) 30%, transparent)` with a 2px gap. Below them,
one 28px strip showing the three things an accent actually does in Scout: an
`--accent-soft` filled row, an `--accent-line` hairline, and `--accent` label
text. That strip is the honest preview — it shows the accent in its rationed
role, not as a swatch.

No hover-to-preview anywhere, per the brief. Selection is the only thing that
changes the app.

---

## 4. Options and naming

Naming register: **one word, material, no brand, no adjective-of-mood.**
"Hudson" is a brand, "Editorial" and "Drafting" are literary registers that the
web app does not actually deliver (§0.4). Canvas-name them.

### Palette

| ship | replaces | dark canvas | chroma | character |
|---|---|---|---|---|
| **Slate** | hudson | `0.145 0 0` | 0.000 | neutral cool — default |
| **Bone** | editorial | `0.21 0.008 78` | 0.015 → **0.008** | warm paper |
| **Graphite** | drafting | `0.20 0.008 240` | 0.020 → **0.008** | cool technical |

The chroma reductions are the entire answer to "Editorial and Drafting should
feel less colorful." Keep their canvas *lightness* (0.21 / 0.20) — that is a
legitimate palette difference and it is what makes Bone feel like paper. Pull only
the saturation. Light-mode canvases get the same treatment: Editorial light
`0.962 0.012 78` → `0.962 0.006 78`.

Palettes no longer carry an accent. Editorial's rust and Drafting's amber move
into the Accent axis as options, where a user can still choose them — the warm
look remains reachable, it is just no longer compulsory.

### Geometry

| ship | `--radius` | applies |
|---|---|---|
| **Rounded** | 8px | default |
| **Soft** | 4px | |
| **Square** | 0px | |

Geometry sets `--radius` only. It must not touch shadow doctrine — Drafting's
shorter shadows (tokens.css:245–253) are a *palette* property (paper vs lit room),
not a corner property. Move them with the palette.

### Accent

Five, matching macOS's shipped count so the cross-surface story stays coherent
(root `DESIGN.md` Free-Hue Rule):

**Emerald** `0.72 0.18 162` (default) · **Cyan** `0.74 0.14 210` ·
**Indigo** `0.68 0.17 275` · **Amber** `0.76 0.16 70` · **Rose** `0.68 0.19 15`

Light mode drops L to ~0.55 and holds hue, following the existing
hudson-light pattern (`0.53 0.16 166`).

### Contrast — do not ship

It does not earn its complexity in this pass, and shipping it would be actively
harmful here: it lets the weak default stay weak. The dark selected state in §2 is
a **baseline correction**, not an option. Offering "high contrast" as a toggle
would frame the fix as a preference. Revisit only if a real accessibility request
arrives that §2 does not satisfy.

---

## 5. Ship / defer

**Ship this pass**
1. §2 state language across both existing axes — the actual complaint, and it
   stands alone even if decomposition slips.
2. Switch all state mixes from `in srgb` to `in oklab`.
3. Split Workspace style into **Palette** and **Geometry** with §3 specimens.
4. De-chroma Bone and Graphite canvases; move their accents to the Accent axis.
5. Accent axis with five hues.
6. Color mode → segmented control.
7. `role="radiogroup"` / `aria-checked` on all four axes.
8. Point the Appearance cards at `--radius` instead of `--radius-lg` so the page
   demonstrates the geometry it sells (§0.4).

**Defer**
- Contrast axis (§4).
- Density and type-scale axes — Editorial's serif is already dead in web (§0.4);
  reviving typography as an axis is its own pass.
- Free hue picker. The `hudson-custom` slot in tokens.css:327–443 is the landing
  place when it comes; five presets first.
- Per-surface accent overrides, cross-device sync, macOS/iOS parity port.
- Any change to the light-mode ladder beyond the oklab switch.

---

## 6. Implementation constraint the parent must rule on

`packages/web/DESIGN.md` states HudsonKit "is shared with iOS and macOS and is
never modified from here." Decomposition therefore **cannot** be done by editing
`hudsonkit/dist/tokens.css`.

Recommended shape, offered as style guidance and handed to the parent for the
architecture call: pin `data-hudson-template="hudson"` permanently (it carries
the chroma-0 neutral base and all the `--hud-*` plumbing), and express the three
new axes as **Scout-owned attribute layers** — `[data-scout-palette]`,
`[data-scout-geometry]`, `[data-scout-accent]` — that redefine `--background`,
`--card`, `--border`, `--accent`, `--radius` after HudsonKit's block. Because
every `--hud-*` token is declared as `oklch(var(--background))` etc., overriding
the raw channel values cascades through the whole system automatically. The
`hudson-custom` block (tokens.css:327–443) is precedent that this layering is
anticipated. Specimens set the same attributes locally so they render honestly.

Persistence, the `openscout.theme` shape, and migrating existing
`template: "editorial" | "drafting"` values are the parent's.

---

## 7. Risks and acceptance checks

**Risks**
- **R1 — QA surface.** 3 palettes × 3 geometries × 2 modes = 18 combinations, up
  from 6, across 60+ screens. Mitigated by orthogonality: geometry touches only
  `--radius`, palette only canvas/border/ink/shadow. Sweep 3 palettes × 2 modes
  fully; spot-check geometry on the three densest screens.
- **R2 — Square + hairline selection.** At `--radius: 0`, an accent border on a
  square plate reads as a table cell. Verify the selected card still reads as
  chosen and not as a header.
- **R3 — Migration optics.** Existing Editorial users see their canvas
  de-saturate. Their accent should migrate to Rose/Amber so the warm character
  survives the change. Parent owns the mapping; this spec asks that it not land as
  a silent flattening.
- **R4 — Doc drift.** `packages/web/DESIGN.md` documents the web accent as lime
  `oklch(0.86 0.17 125)`; the shipped hudson template is emerald `0.72 0.18 162`.
  This spec follows the shipped value. Someone should reconcile the doc.
- **R5 — Accent-soft at 12%.** `--hud-accent-soft` is a fixed 12% alpha. Amber and
  Rose at 12% on a Bone canvas may wash toward the canvas hue. Check the
  selected-row strip in every palette × accent pair before locking the five.

**Acceptance checks**
- **A1** — Dark, Slate: measured ΔL between rest and selected plate ≥ 0.05 OKLCH.
- **A2** — Dark, all palettes: selected border vs its own plate ≥ 3:1; hover
  border vs plate < 2:1. The gap between hover and selected must be unambiguous
  at 100% zoom from 1m.
- **A3** — Selection remains identifiable with hue removed (grayscale
  screenshot). Plate lift + disc must carry it alone.
- **A4** — Focus ring is visually distinct from the selected border on a card
  that is both selected and focused.
- **A5** — Each specimen changes **only** when its own axis changes, except the
  palette ladder and geometry miniature, which legitimately re-render on mode
  change. Geometry miniature shows zero accent in every combination.
- **A6** — Keyboard: Tab reaches each axis once; arrows move within; `aria-checked`
  reports "2 of 3" in VoiceOver.
- **A7** — `prefers-reduced-motion` suppresses the press scale on all four axes.
- **A8** — Regression: the page currently claims "URL theme overrides remain
  available for embeds and visual QA," but loading
  `/settings/appearance?theme=light` renders dark and the query is stripped from
  the URL. Either the claim or the behavior is wrong. Not in scope for this style
  pass — flagged for the parent.
