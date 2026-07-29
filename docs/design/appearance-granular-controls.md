# Appearance: granular controls + restrained palettes

Status: **design study, inspiration only.** No code changed. Scope excludes routing,
persistence redesign, and broad refactors.

Requested by `openscout-agent-2.studio-craft-pass`. Feedback driving it: dark selected
borders read as unclear; Editorial and Drafting are too colorful in dark; palettes should
draw from restrained open-source IDE work; controls should be more granular.

---

## 0. What the code actually does today

Chain: `lib/theme.ts` writes four dataset attrs → `scout/Provider.tsx:630-637` puts them on
the shell node → hudsonkit `dist/tokens.css` resolves `[data-hudson-template][data-hudson-theme]`
into raw oklch triplets → `app.css:35-48` aliases `--hud-*` into Scout's `--bg/--surface/--ink/--accent/--border`.

Three findings from reading it, before any design opinion:

**(a) The shape axis is advertised but inert.** `THEME_TEMPLATES` (`SettingsDrawer.tsx:150-154`)
labels the templates "8px corners", "4px corners", "Square corners". The template `--radius`
does reach `--radius` via `app.css:46`. But Scout's component CSS almost entirely uses
`--radius-sm/md/lg/xl`, which are **hard literals** at `styles/tokens.css:37-40` on `:root`
and are never overridden by template. So picking Drafting changes corners in the
*settings specimen preview* and in hudsonkit chrome, and essentially nowhere else in the
Scout web UI. The preview is more square than the app it previews. This is the single
strongest argument for making shape a real axis — it is already promised.

**(b) Hover pre-empts selected on the mode cards.** `settings-drawer.css:164-167` vs `:185-189`:

```css
.s-settings-theme-mode:hover     { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
.s-settings-theme-mode[data-active] { border-color: color-mix(in srgb, var(--accent) 70%, var(--border)); }
```

Hover and selected are the same gesture 30% apart on one channel. In dark, where the
`--border` end of that mix is already low-contrast, 40% and 70% are close to
indistinguishable. That is a direct cause of "selected borders are unclear."

**(c) Selection is expressed three different ways in one panel.** Mode cards use
border-tint + 10% accent wash. Template cards (`:191-196`) use a solid accent border **plus**
`box-shadow: inset 0 0 0 1px var(--accent)` — a 1px border and a 1px inset ring in the same
color, which at fractional DPR renders as one fatter blurred line rather than a crisper one.
Focus is a fourth idiom: these buttons use `outline: 2px solid var(--accent)` while the rest
of the app uses `--focus-ring` (`app.css:48`), a 3px translucent accent glow. Focus and
selection therefore share a channel and compete.

Supporting numbers for "unclear in dark" — current dark ramps (oklch `L C H`):

| template | bg | card | secondary | border | Δ(card→border) |
|---|---|---|---|---|---|
| hudson | 0.145 0 0 | 0.18 0 0 | 0.24 0 0 | 0.28 0 0 | **+0.10** |
| editorial | 0.21 .015 60 | 0.245 .016 60 | 0.29 .015 65 | 0.34 .015 65 | **+0.095** |
| drafting | 0.20 .02 240 | 0.24 .02 240 | 0.28 .02 240 | 0.40 .012 240 | +0.16 |

Four surface steps packed into ΔL 0.10 (hudson) leaves hairlines no room. `--hud-border` also
carries `/ 0.82` alpha, so the effective separation is smaller still.

And "too colorful in dark" is measurable:

| | surface chroma | accent chroma |
|---|---|---|
| editorial dark | 0.015–0.016 | **0.16** (+ `--primary: 0.7 0.05 70`) |
| drafting dark | **0.020** | **0.18** |
| restrained OSS IDE darks | 0.006–0.017 | 0.05–0.13 |

Editorial dark additionally sets `--primary: 0.7 0.05 70` — a chromatic primary that tints
emphasis text and buttons. It is the most colorful single token in that theme.

---

## 1. Independent control hierarchy

`template` stops being a primitive and becomes a **preset that sets the axes**. Five axes,
each independently overridable; a template applies a full set, and any axis the user touches
is recorded as an override on top.

| axis | values | drives |
|---|---|---|
| **Mode** | system · light · dark | `data-scout-theme-mode` (exists) |
| **Palette** | graphite · slate · paper · mono | surface ramp + ink ramp + status hues |
| **Accent** | emerald · blue · rust · amber · violet · neutral | `--accent` / `--ring` only |
| **Shape** | square · soft · round | `--radius-*` **and** `--hud-radius` |
| **Density** | comfortable · compact | `--space-*` multiplier + row min-heights |
| **Contrast** | standard · high | border L delta + `--ink-2` L delta + ring target ratio |

Shape and density are geometry-only and never touch color — they can be QA'd once, not per
palette. Contrast is a **delta applied to two tokens**, not a second palette.

Layout: Mode and Palette stay visible. Accent, Shape, Density, Contrast sit under a
**Fine-tune** disclosure that stays expanded once used. One live specimen at the top of the
section reflects *all* axes at once, replacing the three per-template specimens — which today
cannot render shape truthfully anyway (finding a).

Talkie-style granularity is the pattern to borrow: each axis is its own labeled row of small
segmented controls with a single shared preview, rather than three big cards that each bundle
five decisions. The cards are what make the axes inseparable.

---

## 2. Four restrained palettes

Distilled rules from One Dark, Nord, Gruvbox Material, GitHub Dark Dimmed, Zed One — what
they have in common, stated as constraints:

1. Dark surface chroma **≤ 0.010**. Dark amplifies apparent chroma; what reads as warm on
   paper reads as a color cast on a screen.
2. Dark base bg L **0.18–0.22**, not 0.145. A too-dark floor is what compresses the ramp.
3. Adjacent surface steps ΔL **≥ 0.035**; border L **≥ card L + 0.15**.
4. Dark accent chroma **0.09–0.13**; light accent chroma **0.13–0.17** (light needs more to register).
5. Accent hue **≥ 60° from surface hue**, or the accent must not be the selection carrier (see §3).
6. Contrast comes from **L, not C**. An accent at C 0.11 and L 0.72 clears 3:1 against a dark
   card with room to spare. Editorial and Drafting spend chroma where they should spend lightness —
   which is exactly why they are simultaneously *more colorful* and *less clear*.

### P1 · Graphite (retuned Hudson) — neutral + emerald. Lineage: Zed One, VS Code Dark+.

```
dark   bg 0.175 0 0 · card 0.215 0 0 · elev 0.255 0 0 · border 0.375 0 0 · line 0.44 0 0
       ink 0.94 0 0 · ink-2 0.70 0 0 · accent 0.72 0.11 165
light  bg 0.975 0.002 250 · card 1.0 0 0 · elev 0.955 0.003 250 · border 0.87 0.004 250
       ink 0.22 0.006 250 · ink-2 0.47 0.008 250 · accent 0.55 0.13 165
```
Changes from today: bg +0.03, card +0.035, **border 0.28 → 0.375**, accent chroma **0.18 → 0.11**.

### P2 · Slate (Drafting's color story, restrained) — cool blue-gray. Lineage: One Dark, Nord.

```
dark   bg 0.19 0.009 255 · card 0.23 0.010 255 · elev 0.275 0.010 255 · border 0.39 0.012 255
       ink 0.93 0.005 255 · ink-2 0.70 0.008 255 · accent 0.70 0.10 235
light  bg 0.968 0.006 250 · card 0.995 0.002 250 · elev 0.94 0.008 250 · border 0.855 0.010 250
       ink 0.24 0.015 255 · ink-2 0.47 0.015 255 · accent 0.52 0.13 245
```
Surface chroma 0.020 → 0.009. Drafting's one genuinely good decision was pairing a cool
surface with a warm amber accent — 180° of hue separation. Keep that available, but as the
**Amber accent choice over Slate**, capped at C 0.12, rather than welded into the palette.

### P3 · Paper (Editorial's color story, restrained) — warm in light, drained in dark. Lineage: Gruvbox Material, Solarized Light.

```
light  bg 0.965 0.012 85 · card 0.995 0.004 85 · elev 0.935 0.014 85 · border 0.845 0.012 82
       ink 0.22 0.014 70 · ink-2 0.46 0.014 70 · accent 0.53 0.14 40
dark   bg 0.195 0.006 80 · card 0.235 0.007 80 · elev 0.275 0.007 80 · border 0.385 0.008 80
       ink 0.93 0.006 85 · ink-2 0.70 0.008 80 · accent 0.72 0.115 30
```
The governing idea: **warmth is a light-mode property.** Editorial keeps its character on
paper and mostly sheds it in dark, where the same chroma reads as a brown cast. Surface
chroma 0.016 → 0.007, accent 0.16 → 0.115, and `--primary: 0.7 0.05 70` → `0.93 0.006 85`
(neutral ink, not tinted). Accent hue moves 40 → 30 to buy separation from the h80 surface;
even so, Paper dark is the case where the selection ring should **not** be the accent (§3).

### P4 · Mono (new) — zero-chroma surfaces, accent is the only color on screen. Lineage: GitHub Dark Dimmed.

```
dark   bg 0.185 0 0 · card 0.225 0 0 · elev 0.265 0 0 · border 0.38 0 0
       ink 0.945 0 0 · ink-2 0.70 0 0 · accent <chosen> capped C 0.10
light  bg 0.98 0 0 · card 1.0 0 0 · elev 0.955 0 0 · border 0.865 0 0
       ink 0.20 0 0 · ink-2 0.46 0 0 · accent <chosen> capped C 0.11
```
This is the palette the "too colorful" feedback is implicitly asking for, and it is also the
best stress test for the selection contract — with no surface chroma, geometry and lightness
have to carry every state.

**Status colors (ok/warn/error/info) stay palette-derived and are never user-choosable.**
They are semantic, and per [[feedback_minimal_dots_single_accent]] the accent axis must not
become categorical color-coding — it changes *the one accent*, it does not add more.

---

## 3. Exact selected / hover / focus styling

The headline fix: **the selection ring is not required to be the accent.** Define it as its
own token per palette×mode, chosen to clear the contrast bar against the adjacent surface.
That decouples "which accent do I like" from "can I see what's selected," which is the
coupling that makes Paper/Editorial dark fail.

```css
/* per palette × mode, defined once */
--sel-ring:  /* dark: oklch L ≥ 0.50 · light: L ≤ 0.55 — must clear 3:1 vs --surface */
--sel-fill:  color-mix(in oklab, var(--accent) 12%, var(--surface));
--hover-fill: color-mix(in oklab, var(--ink) 5%, var(--surface));
--focus-ring-color: /* fixed per mode, NOT accent-derived */;
```

Why L ≥ 0.50 in dark: against a card at L 0.215 (Y ≈ 0.010), 3:1 needs Y ≈ 0.13, i.e.
oklch L ≈ 0.50. Every accent above lands at L 0.70–0.72, so a *restrained* accent still
clears the bar comfortably — again, L does the work, not C. For Paper dark, set
`--sel-ring` to a neutral high-L ink derivative (`oklch(0.72 0.008 80)`) instead of the rust,
and let the accent live in the fill and the marker only.

**The one rule that fixes finding (b):**

> Hover changes **fill only**. Selection changes **border + fill + marker**. They never
> compete on the same channel.

| state | border | background | marker |
|---|---|---|---|
| resting | `1px solid var(--border)` | `var(--surface)` | — |
| hover | *unchanged* | `var(--hover-fill)` | — |
| selected | `1px solid var(--sel-ring)` | `var(--sel-fill)` | filled accent check chip |
| selected + hover | `1px solid var(--sel-ring)` | `--sel-fill` mixed 6% toward `--ink` | chip |
| focus-visible | *unchanged* | *unchanged* | `outline: 2px solid var(--focus-ring-color); outline-offset: 2px` |
| selected + focused | both, simultaneously and distinguishably | | |

Additional calls:

- **Drop** `box-shadow: inset 0 0 0 1px var(--accent)` from `.s-settings-template-choice[data-active]`
  (`settings-drawer.css:194`). A 1px border plus a coincident 1px inset ring is a blurrier line,
  not a stronger one.
- **Unify** the two selected idioms — mode cards and template cards should use the table above
  verbatim. Two selection languages in one panel is itself a legibility cost.
- **Non-color carrier is required.** Today selection is 100% chromatic: the only non-border
  signal is the `Check` icon, itself tinted `var(--accent)` (`:245-249`). Make it a filled
  chip (accent disc + `--accent-foreground` glyph) so it survives Mono, low-chroma palettes,
  and color-vision differences. These cards are rounded, so per
  [[feedback_no_left_bar_on_rounded]] the carrier is the chip, **not** a left accent bar.
- **Switch every `color-mix` on this surface from `in srgb` to `in oklab`.** srgb is
  gamma-encoded and non-perceptual; mixing a high-chroma accent toward a dark neutral in srgb
  loses roughly a third of the intended chroma and lands at an unpredictable lightness. Every
  mix in `settings-drawer.css:146-196` currently uses srgb.
- **Focus stops being accent-derived.** `--focus-ring` (`app.css:48`) is
  `color-mix(in srgb, var(--accent) 35%, transparent)` — a 3px translucent glow that is weak
  in dark and identical in hue to the selection. Give focus a fixed per-mode ring so it reads
  on all four palettes and never reads as "selected."

---

## 4. What stays bundled

Bundled into the named template presets (not user-facing axes):

- **The preset → axes mapping itself.** `Editorial` = `{palette: paper, shape: soft, density: comfortable, accent: rust, contrast: standard}`. Users who never open Fine-tune see exactly today's three choices.
- **Typography.** `--hud-font-serif` is template-bound (`tokens.css:150`) and should stay that
  way — font pairing is a design decision, not a slider. Drafting's serif+mono register is part
  of what the preset *is*.
- **Shadow and dot-grid recipes.** `--hud-shadow-*`, `--hud-canvas-dot-*`, `--hud-edge-fade-*`.
  These are already tuned per template×mode and have no user-legible axis.
- **Status colors.** ok / warn / error / info stay derived from the palette.

Not bundled — the six axes in §1.

---

## 5. Component / CSS touchpoints

| file:line | role |
|---|---|
| `packages/web/client/lib/theme.ts:3-8` | `ScoutThemeTemplate` type + default; axis types go here |
| `packages/web/client/lib/theme.ts:20-47` | `normalizeScoutThemeTemplate`, `readStoredAppearance` — the single storage blob |
| `packages/web/client/lib/theme.ts:94-106` | `applyScoutThemeToDocument` — writes the dataset attrs; new axis attrs land here |
| `packages/web/client/lib/theme.ts:116-145` | native `?themeVars=` bridge — overrides at `--hud-*`, unaffected by any of this |
| `packages/web/client/lib/theme.test.ts` | existing test surface (currently untracked/modified) |
| `packages/web/client/scout/Provider.tsx:630-637` | the shell node carrying `data-hudson-template` etc. — axis attrs go on the same element |
| `packages/web/client/screens/settings/SettingsDrawer.tsx:144-154` | `THEME_MODES`, `THEME_TEMPLATES` (incl. the misleading corner specs) |
| `packages/web/client/screens/settings/SettingsDrawer.tsx:156-245` | `AppearanceSection` — the two card grids and the specimen markup |
| `packages/web/client/screens/settings/settings-drawer.css:133-196` | mode/template card states — **the hover/selected collision and the srgb mixes** |
| `packages/web/client/screens/settings/settings-drawer.css:263-350` | specimen preview; only real consumer of `--hud-radius` in Scout web |
| `packages/web/client/app.css:35-48` | `--hud-*` → Scout alias bridge, `--radius: var(--hud-radius)`, `--focus-ring` |
| `packages/web/client/styles/tokens.css:37-40` | `--radius-*` literals — **the inert-shape bug (finding a)** |
| `hudsonkit@0.3.5 dist/tokens.css:1-325` | palette source of truth for all three templates |
| `hudsonkit@0.3.5 dist/tokens.css:327-443` | `hudson-custom` — existing precedent for a host-owned override layer |

**Ownership call worth making early:** the palettes live in **hudsonkit, a published dep**.
Retuning them means either a hudsonkit release or a Scout-owned override layer. For a study,
the override layer is right — a `packages/web/client/styles/palettes.css` keyed on
`[data-scout-palette][data-scout-theme-mode]`, imported after hudsonkit's `tokens.css`,
redefining the `--hud-*` set. That is precisely the mechanism `hudson-custom` already
demonstrates: no dep bump, fully reversible, and it keeps native (which reads
`ScoutPalette/ScoutTheme.swift`) out of scope until the palettes are signed off.

---

## 6. Risks

**Accessibility.** Three invariants, written as assertions a unit test can run over every
generated palette×mode×accent×contrast combination:
1. `--sel-ring` ≥ **3:1** against `--surface` (WCAG 1.4.11 — this is state information, not decoration).
2. `--ink` ≥ 4.5:1 and `--ink-2` ≥ 4.5:1 against `--surface`.
3. `--focus-ring-color` ≥ 3:1 against **both** `--surface` and `--sel-fill`.

Resting hairlines are explicitly exempt from 3:1 — they are decorative, and forcing them to
3:1 is what produces the over-bright borders that make dark UIs look cheap. Also handle
`prefers-contrast: more` (map to Contrast=high) and `forced-colors: active` (drop `--sel-fill`,
let system colors through).

**Combinatorics.** 4 palettes × 2 modes × 6 accents × 3 shapes × 2 densities × 2 contrasts =
576 combinations. Nobody QAs that. It is tractable because the axes are not equally expensive:
only **8 base ramps** (4 palettes × 2 modes) are hand-authored. Accent and contrast are
generated deltas covered by the assertion test above; shape and density are pure geometry,
verified once. Visual QA = 8 ramps + one screenshot matrix of the settings panel, not 576.

**Persistence.** Extend the existing `openscout.theme` JSON blob with optional fields — no new
storage key, no migration table. `normalizeScoutThemePreference` / `normalizeScoutThemeTemplate`
already return `null` for unknown values and callers already `?? default`, so an old client
reading a new blob ignores the extra fields and a new client reading an old blob falls back
per-axis. Forward and backward safe by construction.

**Migration.** `template` stays authoritative and is written on every preset pick. Axis fields
are written **only when the user touches that axis control**, and a preset pick clears them.
Result: users who never open Fine-tune have byte-identical behavior to today. The `?template=`
and `?theme=` query overrides (`theme.ts:64-92`) keep working for embeds and visual QA; add
axis params only if QA needs them.

**Noise.** Six control rows in one panel is a real regression in cognitive load, against
[[feedback_minimum_cog_load]]. Mitigations already in §1: two axes visible, four behind
Fine-tune, and one shared live specimen instead of three static ones. Worth stating plainly —
if Fine-tune ends up with low engagement, the honest outcome is to **cut axes rather than keep
them for completeness**. Shape and Contrast are the two with the clearest user-visible payoff
(one is a promised-but-broken feature, the other is an accessibility need); Density is the most
cuttable.

**Scope discipline.** Fixing finding (a) means routing `--radius-*` through the shape axis,
which touches every `border-radius` in the web client's CSS by way of the token. That is a
large blast radius for a token change and should ship on its own, behind its own review —
not folded into the palette work.
