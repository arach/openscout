---
name: Scout for macOS
description: The desktop dialect of the Lit Control Room — five named presets, five user accents, and hairline-precise SwiftUI instrument chrome.
colors:
  paper-bg: "rgb(251, 250, 248)"
  paper-chrome: "rgb(242, 241, 238)"
  paper-surface: "rgb(255, 255, 255)"
  paper-ink: "rgb(24, 23, 20)"
  paper-muted: "rgb(99, 96, 91)"
  paper-dim: "rgb(131, 128, 121)"
  paper-border: "rgb(226, 223, 218)"
  paper-hairline: "rgb(234, 232, 227)"
  paper-hairline-strong: "rgb(208, 205, 197)"
  nocturne-bg: "rgb(25, 25, 25)"
  nocturne-chrome: "rgb(15, 15, 15)"
  nocturne-surface: "rgb(41, 41, 41)"
  nocturne-ink: "rgb(245, 245, 245)"
  nocturne-muted: "rgb(182, 182, 182)"
  nocturne-dim: "rgb(134, 134, 134)"
  nocturne-border: "rgba(180, 180, 180, 0.22)"
  nocturne-hairline: "rgba(180, 180, 180, 0.12)"
  nocturne-hairline-strong: "rgba(180, 180, 180, 0.28)"
  graphite-bg: "rgb(18, 18, 20)"
  graphite-surface: "rgb(36, 36, 40)"
  graphite-ink: "rgba(255, 255, 255, 0.97)"
  graphite-border: "rgba(255, 255, 255, 0.17)"
  accent-indigo: "rgb(73, 84, 196)"
  accent-indigo-dark: "rgb(94, 106, 210)"
  accent-forest: "rgb(56, 122, 87)"
  accent-forest-dark: "rgb(79, 163, 115)"
  accent-cyan: "rgb(0, 125, 135)"
  accent-cyan-dark: "rgb(99, 199, 194)"
  accent-amber: "rgb(191, 105, 23)"
  accent-amber-dark: "rgb(232, 153, 61)"
  accent-rose: "rgb(179, 74, 97)"
  accent-rose-dark: "rgb(235, 89, 115)"
  status-ok: "rgb(47, 125, 85)"
  status-ok-dark: "rgb(76, 183, 130)"
  status-warn: "rgb(168, 98, 17)"
  status-warn-dark: "rgb(232, 154, 60)"
  status-error: "rgb(185, 54, 66)"
  status-error-dark: "rgb(229, 72, 77)"
typography:
  title:
    fontFamily: "SF Pro (HudFont.ui)"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "SF Pro (HudFont.ui)"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  body-compact:
    fontFamily: "SF Pro (HudFont.ui)"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "SF Mono (HudFont.mono)"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.12em"
  mono-body:
    fontFamily: "SF Mono (HudFont.mono)"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  tight: "3px"
  standard: "6px"
  card: "8px"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  xxl: "14px"
  xxxl: "20px"
  huge: "28px"
components:
  button:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.standard}"
    padding: "0 12px"
    height: "32px"
  field:
    rounded: "{rounded.standard}"
    padding: "0 8px"
    height: "36px"
  row-compact:
    rounded: "{rounded.standard}"
    padding: "0 8px"
    height: "28px"
  row-regular:
    rounded: "{rounded.standard}"
    padding: "0 10px"
    height: "44px"
  card:
    backgroundColor: "{colors.paper-surface}"
    rounded: "{rounded.card}"
    padding: "12px"
  badge:
    rounded: "{rounded.tight}"
    padding: "2px 6px"
---

# Design System: Scout for macOS

## Overview

**Creative North Star: "The Lit Control Room"** — desktop dialect.

The macOS app is the surface the operator leaves open all day, often at the edge
of a large display, often partially occluded. It is the only Scout surface that
treats appearance as a **user setting rather than a brand decision**: five named
presets crossed with five accents crossed with a Quiet/Vivid accent volume and a
window-opacity slider. That matrix is not indulgence — it is the honest response
to a tool that lives in someone's peripheral vision for eight hours.

The visual character is precision without weight. Everything is hairline-thin
(0.5pt, not 1pt — 1pt reads chunky on Retina), radii are tight (3/6/8), spacing
is compact (a 2–14pt working range), and the type is SF split almost exactly
50/50 between UI and mono. Color is spent carefully: at the Quiet default, the
accent appears as a soft wash behind ordinary ink rather than as a solid fill, and
is reserved at full strength for attention marks and primary actions.

This surface is also the system's color source of truth. The presets encode
decisions the other surfaces follow — that light mode should be *warm* paper
rather than cool office, and that a dark neutral should be genuinely neutral
(R=G=B) so the accent is the only hue in the window.

**Key Characteristics:**

- Five presets × five accents × Quiet/Vivid × window opacity, all user-selectable
- Indigo default, but the hue is a preference, not a brand fact
- Genuinely neutral dark grays so exactly one hue is live
- Warm light grays (R>G>B) so light mode reads as paper
- 0.5pt hairlines as the default structural weight
- Tight 3/6/8 radii and a 2–14pt spacing working range
- Every color resolves through NSColor's dynamic provider, so a window-level
  appearance override is honored

## Colors

Semantic tokens all the way down. Views consume `ScoutPalette.ink`,
`ScoutPalette.accent`, and so on; a preset swap changes every surface at once
without touching a view. Each token resolves through `Color.scoutAdaptive`, which
uses an `NSColor` dynamic provider so the palette follows the *window's*
appearance — not just the system's — and the Scout mode picker works.

### Primary

The accent is user-selected from five palettes, each with a light and dark form
plus a soft companion. **Indigo is the default.**

- **Indigo** (`rgb(73,84,196)` light / `rgb(94,106,210)` dark): the default signal.
- **Forest** (`rgb(56,122,87)` / `rgb(79,163,115)`): a muted green.
- **Cyan** (`rgb(0,125,135)` / `rgb(99,199,194)`): a deep teal.
- **Amber** (`rgb(191,105,23)` / `rgb(232,153,61)`): warm.
- **Rose** (`rgb(179,74,97)` / `rgb(235,89,115)`): the one warm-red option.

Each carries an `accentSoft`: a pale tint in light mode, and the same hue at
14–26% alpha in dark. `statusInfo` is bound to the active accent, so "informational"
always agrees with the user's chosen hue.

### Neutral

Five presets, each a full nine-token neutral set in light and dark:

- **Paper** (default): warm. Grays lean R>G>B (`rgb(251,250,248)` canvas,
  `rgb(24,23,20)` ink) with a **pure white surface**, so cards keep a crisp
  cool-white pop against a warm canvas. Luminance matches the older cool values —
  only the temperature moved.
- **Mist**: the cool option, kept deliberately as Paper's counterpart
  (`rgb(245,247,250)` canvas, blue-leaning grays).
- **Porcelain**: near-achromatic warm, a quieter Paper.
- **Graphite**: higher-contrast neutral dark. Surface lifted clearly off canvas
  (`rgb(18,18,20)` → `rgb(36,36,40)`) so cards separate; ink at 97%, muted 69%,
  dim 49%, and stronger white hairlines.
- **Nocturne**: true charcoal, genuinely neutral (R=G=B). Canvas `rgb(25,25,25)`,
  surface `rgb(41,41,41)`, ink `rgb(245,245,245)`. Its borders are warm-neutral
  gray alpha rather than pure white alpha.

### Status

- **OK** (`rgb(47,125,85)` / `rgb(76,183,130)`), **Warn** (`rgb(168,98,17)` /
  `rgb(232,154,60)`), **Error** (`rgb(185,54,66)` / `rgb(229,72,77)`). Constant
  across presets — status must not shift meaning when a theme changes.

### Named Rules

**The Only-Hue-In-The-Window Rule.** Nocturne was rebuilt from a steel-blue navy
to a true neutral charcoal for exactly one reason: tinted neutrals made the whole
window read cool *before* the accent arrived. Grays are R=G=B in dark presets, and
the accent is the only hue present. Do not re-tint them.

**The Warm-Paper Rule.** Light presets lean warm (R>G>B). Paper, Porcelain, and
the web light theme all follow this; Mist is the deliberate cool exception and is
the *only* one. A new cool-gray light preset is a regression.

**The Quiet-Volume Rule.** At the default Quiet volume, stateful fills — your
turns in a thread, the active scope segment, the activity chart — use an
`accentSoft` wash with standard ink prose. Vivid restores solid fills. Attention
marks and primary actions stay full accent in both. New stateful surfaces must
respect the setting rather than hard-coding a solid accent.

**The Status-Is-Constant Rule.** The status triad does not vary by preset or by
accent. A user switching from Indigo to Rose must not change what "error" looks like.

## Typography

**UI Font:** SF Pro, via `HudFont.ui`
**Mono Font:** SF Mono, via `HudFont.mono`

**Character:** An almost exactly even split — 244 `HudFont.ui` call sites against
256 `HudFont.mono` — which is the clearest possible statement of the system's
two-voice rule. Half of this interface is prose and half of it is instrumentation,
and the type says so before you read a word.

### Hierarchy

- **Title** (semibold, 16px, 1.35): window and panel titles.
- **Body** (regular, 13px, 1.45): prose, message bodies, descriptions.
- **Body-compact** (regular, 12px, 1.35): list rows and dense detail.
- **Mono body** (regular, 12px): ids, paths, commands, transcript content.
- **Label** (mono, semibold, uppercase, 9–11px, 0.08–0.18em tracking): section
  headers, column labels, status words, chip text.

### Named Rules

**The Two-Voice Rule.** `HudFont.ui` for what a person wrote; `HudFont.mono` for
what the machine knows. The near-1:1 ratio in the codebase is the target state,
not an accident to be normalized away.

**The Dynamic-Type-Respect Rule.** Sizes are set through the shared font tokens
rather than as raw point literals, so the app follows the user's text-size
preference.

## Layout

Spacing runs on `HudSpacing`: 2, 4, 6, 8, 10, 12, 14, 20, 28pt. Usage is heavily
weighted to the compact end — `sm` (6) and `md` (8) together account for the
majority of call sites, with `xs` (4) and `xl` (12) next. That distribution *is*
the density: this is an 8-point-ish interface with a 4-point conscience, not a
16-point one.

Chrome dimensions come from `HudLayout` and are never snapped to spacing: nav
48pt, panel width 280pt, status bar 28pt, panel offsets 48/28pt. Control metrics
are fixed: button 32pt, field 36pt, compact row 28pt, regular row 44pt. Content
widths cap for legibility: readable 720pt, dialog 560pt, popover 380/340pt.

The window itself is part of the layout. A floating titlebar style lets content
planes reach the top of the window with actions sitting on the traffic-light line,
and a user-controlled opacity multiplies the three surface tokens (canvas, chrome,
surface) — note that ink, borders, and status deliberately stay opaque so text
never dims with the window.

## Elevation & Depth

**Flat with hairlines, plus real window material.** Content surfaces are flat at
rest and separate through a 0.5pt hairline and a tonal step. The app does not
stack shadows on content to create hierarchy; where genuine lift is needed, it
comes from the window (opacity, the floating titlebar, native materials).

`ScoutSurface` supplies the interaction ladder as solid fills rather than as
shadows: `inset`, `control`, `controlFocused`, `hover`, `press` — each with a light
value and a dark white-alpha value — plus tint helpers at fixed alphas
(`selected` 12%, `tintGhost` 10%, `tintFill` 16%, `tintBorder` 32%).

### Shadow Vocabulary

- **`ScoutSurface.shadow(darkOpacity)`**: the single shadow constructor. It takes
  the opacity that reads correctly on near-black chrome and derives light mode at
  **30% of it**, because a heavy black shadow on a light surface reads as dirt.

### Named Rules

**The Derived-Light-Shadow Rule.** Never specify a light-mode shadow directly.
Pass the dark opacity to `ScoutSurface.shadow` and let it derive.

**The Opaque-Ink Rule.** Window opacity applies to canvas, chrome, and surface
only. Ink, borders, hairlines, and status stay fully opaque so a translucent
window never costs legibility.

## Shapes

Three radii and nothing else: **3pt** for badges and micro-elements, **6pt** for
inset rows and small controls (the workhorse), **8pt** for surface containers and
cards. Usage confirms the hierarchy — `standard` (6) at 124 call sites, `card` (8)
at 76, `tight` (3) at 44.

Strokes are hairlines. `HudStrokeWidth.thin` (0.5pt) is the default at 114 call
sites; `standard` (1pt) appears 13 times and `bold` (2pt) four times. That ratio is
correct and should be preserved: 1pt is visibly chunky on Retina, and the studio's
1px designs correspond to `thin`, not `standard`.

### Named Rules

**The Thin-Is-Default Rule.** Reach for `HudStrokeWidth.thin`. A studio mock drawn
at 1px ports to 0.5pt on Retina, not to `HudStrokeWidth.standard`.

**The Three-Radii Rule.** 3 / 6 / 8. A fourth radius needs a reason that the
existing three genuinely cannot serve.

## Components

Crisp and machined. Controls are fixed-height, hairline-bordered, and tight-radius;
state reads through fill and hairline shifts rather than through motion or shadow.

### Buttons

- **Shape:** 6pt radius, 32pt height, hairline border.
- **Default:** `ScoutSurface.control` fill, hairline border, ink label.
- **Hover / Press:** `ScoutSurface.hover` then `.press` — solid fill steps, not
  shadows.
- **Primary:** accent-driven. At Quiet volume, an `accentSoft` fill with an accent
  border and accent label; Vivid fills solid.
- **Focus:** `ScoutSurface.controlFocused` plus the native focus ring.

### Fields

- **Shape:** 6pt radius, 36pt height.
- **Rest:** `ScoutSurface.control`; **Focus:** `ScoutSurface.controlFocused` (pure
  white in light, 8.5% white in dark) with a hairline shift.

### Rows

Two heights, and the choice is semantic: **28pt compact** for dense lists where
scanning dominates, **44pt regular** where a row carries an avatar, two lines, or
touch-equivalent targets. Selection uses `ScoutSurface.selected(accent)` at 12%.

### Cards

- **Corner style:** 8pt.
- **Background:** the preset's `surface` token, one clear step off `bg`.
- **Border:** 0.5pt `hairline`; `hairlineStrong` where a card must assert itself.
- **Shadow:** none at rest.
- **Padding:** 12pt typical (`xl`), 8pt in dense contexts.

### Badges / Chips

3pt radius, `2px 6px` padding, uppercase mono at 9–11px, tone-tinted with
`tintGhost` (10%) or `tintFill` (16%) and `tintBorder` (32%).

## Do's and Don'ts

### Do:

- **Do** consume `ScoutPalette` and `ScoutSurface` tokens; never hard-code a Color
  in a view.
- **Do** use `HudStrokeWidth.thin` (0.5pt) as the default structural weight.
- **Do** respect `ScoutAccentVolume` on any new stateful fill.
- **Do** keep dark preset grays genuinely neutral (R=G=B).
- **Do** keep light preset grays warm (R>G>B) — Mist is the only cool one.
- **Do** derive light-mode shadows via `ScoutSurface.shadow(darkOpacity)`.
- **Do** pick row height semantically: 28pt to scan, 44pt to carry.
- **Do** build with `bun bin/scout-app.ts dev-build`.

### Don't:

- **Don't** re-tint the dark neutrals toward navy, steel, or violet. Nocturne was
  explicitly de-purpled; that work is not to be undone.
- **Don't** use `HudStrokeWidth.standard` (1pt) as a default — it reads chunky on
  Retina.
- **Don't** apply window opacity to ink, borders, or status colors.
- **Don't** let the status triad vary by preset or accent.
- **Don't** introduce a fourth corner radius.
- **Don't** stack shadows on content to create hierarchy; use the tonal step and
  the hairline.
- **Don't** hand-edit SwiftUI to explore a layout — design it in the studio first,
  then port.
