# Appearance iteration 2: the measured palette spine

Status: **design study, inspiration only.** No code changed. Read-only pass.

Companion to [appearance-granular-controls.md](./appearance-granular-controls.md), which already
covers the control-model argument. This doc does not restate it. It contributes three things
that iteration 1 does not have:

1. A **new defect** — selection is invisible in *light* mode, worse than the reported dark issue.
2. **Corrections** to three of iteration 1's six "distilled rules," which are stricter than any
   theme they cite and would make the UI look worse.
3. A **verified numeric spine** — one shared lightness ladder, with every target checked against
   measured values from the reference themes rather than asserted.

All oklch/contrast figures below were computed, not estimated. Reference themes were converted
from their published hex values.

---

## 1. The defect that was missed: light mode

Iteration 1 measured surface ramps. The number that actually explains "selected state is
unclear" is a different one: **selected border vs. resting border** — how far the selected
state travels from the state next to it.

| template × mode | sel-border vs surface | **sel-border vs resting border** |
|---|---|---|
| hudson dark | 4.10:1 | **3.32:1** ✅ |
| editorial dark | 2.89:1 | **2.21:1** ⚠️ |
| drafting dark | 3.23:1 | **1.97:1** ⚠️ |
| **hudson light** | 1.49:1 | **1.04:1** ❌ |

(`--hud-accent-line` = accent at 0.42 alpha; `--hud-border` = border at 0.82 alpha; both
composited over `--card`.)

Hudson light at **1.04:1** means the selected border and the resting border are the same color
to within a rounding error. Selection in light mode is carried by nothing. The reported dark
complaint is real (editorial/drafting are ~2:1 where hudson is 3.3:1), but light is the harder
failure and no one filed it — probably because dark is the default.

This also reframes the fix. The ordering of those numbers tracks accent *lightness*, not accent
chroma: hudson light's accent sits at L 0.53, below its own card at L 0.998, so a 42%-alpha
accent line composites *toward* the card instead of away from it. Alpha-based state borders
invert in light mode. That is a structural bug in the token, not a tuning miss.

---

## 2. Corrections to iteration 1's palette rules

Iteration 1 §2 lists six rules "distilled from One Dark, Nord, Gruvbox Material, GitHub Dark
Dimmed, Zed One." Rules 4, 5, 6 hold up well and are the heart of the fix. Rules 1–3 are
stricter than the themes they are drawn from:

| iteration 1 rule | measured reality | verdict |
|---|---|---|
| **1.** dark surface chroma ≤ 0.010 | Tokyo Night bg **C 0.021**; Catppuccin base **C 0.030**; GitHub Dark canvas C 0.014; One Dark bg C 0.016 | too strict — the ceiling is ~**0.030** |
| **2.** dark bg L 0.18–0.22, "not 0.145" | GitHub Dark canvas **L 0.176**; VS Code Dark+ **L 0.235**; Catppuccin L 0.243 | range is wider, ~**0.17–0.25**; the floor claim is not what separates good from bad |
| **3.** border L ≥ card L + 0.15 | VS Code **+0.121**; GitHub Dark **+0.110**; Tokyo Night **+0.080**; Catppuccin **+0.081** | **no reference theme reaches +0.15**; measured range is **+0.08 to +0.12** |

Rule 3 matters most: iteration 1 §6 warns against "over-bright borders that make dark UIs look
cheap," and rule 3 is the thing that would produce them. Following it puts Scout's hairlines
brighter than every theme cited as the model.

The corrected diagnosis of "too colorful": **chrome chroma is not the problem.** Editorial dark
(C 0.015) and Drafting dark (C 0.020) sit inside the normal band — Tokyo Night is 0.021. The
problem is entirely the pair iteration 1 identifies in rules 4/6:

| | accent C | accent L |
|---|---|---|
| Scout editorial dark | **0.16** | 0.69 |
| Scout drafting dark | **0.18** | 0.72 |
| One Dark blue | 0.121 | 0.730 |
| Tokyo Night blue | 0.132 | 0.719 |
| Catppuccin blue | 0.111 | 0.766 |
| Catppuccin green | 0.109 | 0.858 |

At the same lightness, Scout's accents run **35–60% hotter** than every reference. The rule the
references share: **chroma falls as lightness rises.** Nothing sits at C 0.16+ above L 0.65.

Second factor, which iteration 1's rule 5 states but under-weights: Editorial pairs warm chrome
(H 60) with a warm accent (H 40) — Δ20°. There is no hue separation, so chrome and accent fuse
into one saturated wash. Hudson reads calm not because it is restrained but because its chrome
is **C 0.000** — the accent is the only hue in the room. Rule 5's "≥ 60°" should be ≥ **100°**,
or chrome chroma must drop below 0.010.

---

## 3. The spine: one lightness ladder, palette = hue + chroma only

The structural proposal. Every palette shares **one lightness ladder**; a palette is nothing but
a (hue, chroma) pair applied to it. This is what makes the combinatorics in iteration 1 §6
tractable for real — contrast ratios become a property of the *ladder*, verified once, instead
of a property of each palette, verified 8 times.

```
DARK    bg .150 · surface .215 · raised .252 · hover .262 · selFill .310
        borderQuiet .295 · border .340 · borderStrong .425
        ink3 .615 · ink2 .735 · ink .955

LIGHT   bg .962 · surface 1.000 · raised .992 · hover .952 · selFill .903
        borderQuiet .918 · border .865 · borderStrong .780
        ink3 .595 · ink2 .455 · ink .215
```

Palette = chrome hue + chroma ceiling. Four, mapping onto iteration 1's P1–P4:

| palette | dark (C, H) | light (C, H) | lineage |
|---|---|---|---|
| **Graphite** (default) | 0.004, 260 | 0.003, 250 | VS Code Dark+ (C 0.000), Xcode |
| **Slate** | 0.014, 258 | 0.012, 250 | GitHub Dark (C 0.014 H 258), One Dark (C 0.016 H 264) |
| **Ink** | 0.024, 282 | 0.018, 280 | Tokyo Night (C 0.021 H 280), Catppuccin (C 0.030 H 284) |
| **Paper** | 0.010, 80 | 0.020, 88 | Solarized Light base3 (C 0.026 H 90) |

Paper is what Editorial should have been: warm without rust, and — per iteration 1's correct
call — warmth is a light-mode property, so its dark chroma drops to 0.010.

Verified against the ladder (Graphite dark shown; all four palettes land within ±0.03 of these
because chroma at these levels barely moves luminance):

| pair | Scout proposed | reference range | target |
|---|---|---|---|
| surface vs bg | **1.12** | 1.28 (GitHub) | ≥1.12 ✅ |
| border vs surface | **1.49** | 1.27–1.55 | 1.45–1.65 ✅ |
| borderQuiet vs surface | 1.26 | — | quiet hairline ✅ |
| hover vs surface | **1.13** | — | 1.10–1.20 ✅ |
| selFill vs surface | **1.33** (light 1.32) | 1.39 VS Code, 1.43 One Dark | 1.30–1.45 ✅ |
| ink vs surface | 15.4 (light 17.5) | — | ≥12 ✅ |
| ink2 vs surface | 7.5 (light 7.3) | — | ≥4.5 ✅ |
| ink3 vs surface | 4.7 (light 4.0) | — | ≥3.0 ✅ |

Note `border vs surface` lands at 1.49 — inside the measured reference band, and well under
iteration 1's rule-3 target, which would have pushed it past 2:1.

### Accents

Chroma capped at **0.13** in dark, matching the One Dark / Tokyo Night / Catppuccin band.

| accent | dark (L, C, H) | vs surface | light (L, C, H) | vs surface |
|---|---|---|---|---|
| Signal (default) | .76 .13 155 | 8.60 | .55 .15 155 | 4.44 |
| Current | .74 .13 250 | 7.63 | .53 .16 250 | 5.24 |
| Ember | .80 .13 75 | 9.22 | **.555 .13 75** | 4.84 |
| Rust | .72 .13 42 | 6.89 | .55 .16 42 | 5.19 |
| Iris | .75 .13 300 | 7.71 | .52 .17 300 | 5.95 |

**Light accents cannot use a fixed lightness.** Ember at the naive L 0.62 measures 3.71:1 —
under 4.5:1, so it fails the moment the accent is used as text or an icon. Corrected to L 0.555.
Light accent L must be **solved per hue against a contrast target**, not assigned. Dark is
forgiving (everything clears 6:1); light is not.

One accent is spent at a time. A menu of five is the opposite of rainbow theming — rainbow is
many hues on screen *simultaneously*, which is what the current status+accent stack produces.

---

## 4. Selection contract: fill carries it, not the hairline

The counterintuitive finding, and the reason "make the selected border clearer" is the wrong
brief. Measured selected states in the reference themes:

| theme | selected treatment | contrast vs its surface |
|---|---|---|
| VS Code Dark+ | `#04395e` — **fill, no border** | 1.39:1 |
| One Dark | `#3e4451` — **neutral lightness lift, no hue** | 1.43:1 |
| GitHub Dark | subtle fill + accent **edge marker** | fill ~1.4:1, marker 5.05:1 |

None of them brightens a hairline. Selection is a **fill delta**, plus optionally a *solid*
accent marker on one edge. The accent appears at high contrast (VS Code focus 3.96:1, GitHub
accent 5.05:1) only as a marker or ring — never as a 42%-alpha line.

So, adopting iteration 1's state table with three amendments:

```css
--hover-fill: /* ladder `hover`  — 1.13:1 vs surface, neutral, no accent */
--sel-fill:   /* ladder `selFill` — 1.33:1 vs surface, neutral, no accent */
--sel-marker: /* solid accent, ≥3:1 vs surface AND ≥2:1 vs --border */
```

1. **`--sel-fill` must be a neutral lightness step, not an accent mix.** Iteration 1 specifies
   `color-mix(in oklab, var(--accent) 12%, var(--surface))` — that is the current formula, and
   it is what measures 1.10:1 in light and 1.54:1 in editorial dark. A ladder step is
   palette-independent and hits 1.33:1 everywhere by construction. This also removes the accent
   from the largest-area element of the selected state, which is most of the "too colorful" feel.
2. **No alpha on state borders.** Alpha composites toward the surface, which is why light mode
   inverts (§1). `--sel-marker` is a solid color.
3. **Verified floor: `--sel-marker` ≥ 2:1 against `--border`, not just ≥3:1 against `--surface`.**
   Iteration 1 §6 asserts only the latter; the former is the one that failed (1.04:1 in light).
   Against this ladder every accent clears it: 4.88–6.19:1 dark, 2.96–3.49:1 light.

Iteration 1's other §3 calls — drop the coincident inset ring, unify the two selected idioms,
non-color carrier, `in oklab` over `in srgb`, non-accent focus ring — all stand and are not
restated here.

---

## 5. What this changes about scope

Iteration 1's §1 control model, §4 bundling, §5 touchpoints, and §6 persistence/migration
analysis are unchanged and remain the reference. Two adjustments:

- **Authoring cost drops.** Iteration 1 counts "8 base ramps hand-authored." With a shared
  ladder it is **2 ladders + 4 (hue, chroma) pairs + 5 accent triplets** — and the contrast
  assertions become tests over the *ladder*, run twice, not over 8 ramps.
- **The override-layer call is right.** A Scout-owned `styles/palettes.css` keyed on
  `[data-scout-palette][data-scout-theme-mode]`, imported after hudsonkit's `tokens.css`, is
  the correct vehicle — `hudson-custom` (`tokens.css:327-443`) is the existing precedent. The
  ladder makes that file small: one `@media`-free block per palette, ~14 declarations each.

Risks are as enumerated in iteration 1 §6, with one addition: **`--radius-*` are literals on
`:root` (`styles/tokens.css:36-42`, confirmed) while `--radius` aliases `--hud-radius`
(`app.css:46`)** — so the shape axis is inert in Scout web today, exactly as iteration 1
finding (a) states. Verified; it should ship separately from the palette work.

---

## Open question for the next owner

Whether **Ink** earns its place. Graphite/Slate/Paper cover neutral, cool, and warm. Ink is
the only palette whose chrome chroma (0.024) is high enough to interact with the accent, and
it exists mainly because Tokyo Night and Catppuccin are popular. If the axis count needs
cutting, Ink is more cuttable than Density.
