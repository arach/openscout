---
name: OpenScout
description: The shared design grammar behind Scout's product surfaces — a lit control room you glance at, not a screen you stare at.
typography:
  eyebrow-xs:
    fontSize: "9px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.18em"
  eyebrow-sm:
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.08em"
  eyebrow-md:
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.12em"
  eyebrow-lg:
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.18em"
  body:
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  body-compact:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
  display:
    fontSize: "clamp(34px, calc(28px + 2vw), 52px)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "0"
rounded:
  tight: "3px"
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  pill: "999px"
spacing:
  3xs: "2px"
  2xs: "4px"
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
  2xl: "16px"
  3xl: "20px"
  4xl: "24px"
  5xl: "32px"
  6xl: "40px"
  7xl: "48px"
  8xl: "64px"
---

# Design System: OpenScout

## Overview

**Creative North Star: "The Lit Control Room"**

Scout is a room you glance into, not a screen you stare at. The operator running
five concurrent agents is doing something else most of the time; the interface's
job is to be readable at a glance from across the desk and to earn an
interruption only when something is genuinely blocked on them. That produces a
dark, calm, low-amplitude surface where light and depth do the structural work
that color and decoration would do in a louder product — a lit room rather than
a printed page, and instrumentation rather than a dashboard.

The system is deliberately near-monochrome. Neutral canvas, neutral chrome,
neutral cards; exactly one chromatic accent live at a time; a three-color status
vocabulary that stays rare enough to mean something. Density is high and
compact is the baseline — the operator's chrome lives between 2px and 12px, type
runs 9px to 13px, and structural separation is a hairline rather than a box.
What reads as restraint is really rationing: when almost nothing is colored,
almost nothing is loud, and the one thing that needs you is unmissable.

This is one grammar spoken in several dialects. The three product surfaces —
web, macOS, iOS — share the scales, the eyebrow voice, the dot and chip
vocabulary, the status triad, and the motion discipline documented here, but
each keeps its own accent hue and its own depth doctrine, and both of those
divergences are intentional. The marketing site is a separate world entirely
(see `landing/openscout.app/DESIGN.md`) and is not governed by this file.

**Key Characteristics:**

- Near-monochrome neutrals with exactly one live accent hue per window
- Compact, dense chrome — a 2–12px spacing floor and a 9–13px type ladder
- Uppercase-mono eyebrows as the structural label voice
- Hairline separation (0.5pt native / 1px web) instead of boxes and shadows
- Depth and light carry hierarchy; color is reserved for state
- Instrument-grade edges: hard corners, exact alignment, chamfers where structure matters
- Motion is short, purposeful, and gated on `prefers-reduced-motion`

## Colors

The root system defines color **roles**, not color values. Every product surface
implements the same seven-role structure — canvas, chrome, surface, ink/muted/dim,
border/hairline, accent/accent-soft, and a status triad — but resolves them to its
own values. Those values live in each surface's own DESIGN.md; asserting a
canonical hex here would be fiction, because macOS ships five user-selectable
accents and iOS ships three canvas tones.

### Primary

- **Accent** (per-surface): the single chromatic hue in the window. Drives
  interactive state, the working/active condition, primary actions, and attention
  marks. Its hue is not a brand fact — see the Free-Hue Rule.
- **Accent-soft**: a low-alpha wash of the same hue (10–26% depending on surface)
  for stateful fills that must not shout — your own turns in a thread, the active
  scope segment, selected rows.

### Neutral

- **Canvas**: the deepest plane. Nothing sits behind it.
- **Chrome**: darker than canvas on dark surfaces, lighter on light ones — the
  frame around the work (rails, bars, tab strips).
- **Surface**: the raised plane content actually sits on. On dark presets it must
  be lifted clearly off the canvas or cards dissolve.
- **Ink / Muted / Dim**: the three text rungs, in descending prominence. The
  hierarchy must stay visibly distinct at all three steps; both the web and iOS
  surfaces have already had to raise their secondary tiers off the AA floor.
- **Border / Hairline / Hairline-strong**: structural separation at three weights.

### Status

- **OK / Warn / Error**: the only categorical colors in the system. They are
  earned by real state, never used decoratively, and never borrowed for branding.

### Named Rules

**The One Hue Rule.** Exactly one chromatic hue is live in a window at a time.
Everything else is neutral plus the status triad. The `juniper` / "Nocturne"
preset was rebuilt for precisely this reason — its grays were neutralized to
R=G=B so the accent is the only hue present.

**The Free-Hue Rule.** The accent's *hue* is a surface and user choice, not a
brand constant. macOS ships five accents (Forest, Cyan, Indigo, Amber, Rose) with
Indigo as default; web ships lime; iOS ships emerald. Converging these is not
owed. What converges is the grammar in this file — scales, eyebrow voice, dot and
chip vocabulary, status triad, motion. Never "fix" a surface's accent to match
another's.

**The Quiet-By-Default Rule.** Stateful fills default to an accent-soft wash with
ordinary ink prose on top, not to solid accent. Solid accent is reserved for
attention marks and primary actions. macOS exposes this as a user setting
(`ScoutAccentVolume`, default `.quiet`); other surfaces should behave as if Quiet
is always on.

**The Status-Is-Not-Brand Rule.** Categorical and brand colors are not status
colors, in either direction. Never route a brand gold to `warn`, a mesh sky to
`info`, or a status green to a category. Flattening them destroys both vocabularies.

## Typography

**Body / UI:** a neutral grotesque — Inter on web, SF on Apple platforms.
**Mono:** JetBrains Mono on web, SF Mono on Apple platforms.

**Character:** Two voices, sharply divided by function rather than taste. The
grotesque carries content — names, prose, message bodies. The monospace carries
structure — labels, section headers, counts, ids, paths, status. That split is
the single most recognizable thing about Scout's type, and it is the reason the
interface reads as instrumentation: the machine-legible parts of the screen
literally look machine-set. Native surfaces show the ratio plainly — `HudFont.mono`
and `HudFont.ui` are used almost exactly equally across the macOS app.

### Hierarchy

- **Display** (600, `clamp(34px → 52px)`, 1.12): rare. Empty states, onboarding
  moments, marketing-adjacent panels. Not used in dense chrome.
- **Title** (600, 16–20px, 1.35): screen and panel titles.
- **Body** (400, 13px, 1.45): the default reading size. Message bodies, prose,
  descriptions.
- **Body-compact** (400, 12px, 1.35): dense list rows, table cells, secondary
  detail.
- **Eyebrow** (mono, 600, uppercase, 9–11px, 0.08–0.18em): section headers, column
  labels, chip text, status words. Four tiers on the tracking scale — the wider
  the tracking, the more structural the label.

### Named Rules

**The Eyebrow Rule.** Small structural labels are uppercase *monospace* on the
tracking scale. Never uppercase sans, never sentence-case mono. This is the
system's signature voice; hand-rolling
`font-family + size + letter-spacing + text-transform` instead of using the
eyebrow tiers is how it erodes.

**The Whole-Pixel Rule.** Type sizes are whole pixels on the type scale. The
fractional 9.5 / 10.5 / 11.5 / 12.5 sizes were deliberately retired; do not
reintroduce them.

**The Two-Voice Rule.** Content is grotesque, structure is mono. If you cannot
decide which a piece of text is, ask whether a machine wrote it or a person did.

## Layout

The system is built for density. Padding, margin, and gap come off a 14-step
scale anchored at `xs=6 / sm=8 / lg=12`, fine-grained at the bottom because
operator chrome genuinely lives between 2px and 12px, and coarser at the top for
page-level rhythm.

The scale is for **padding, margin, and gap only**. Width, height, insets, grid
tracks, transforms, border-width, shadow geometry, and blur are never snapped to
it — a pixel of layout is not a unit of rhythm. Chrome dimensions are separate
constants and must never be rounded to the spacing scale: nav height 48, panel
width 280, status bar 28, compact row 28, regular row 44, button 32, field 36.

Reading measures are capped for legibility (readable width 720, dialog 560,
popover 380/340). Dense surfaces run full-bleed inside their rail.

Motion is a scale, not an improvisation: 120ms for hover color changes, 150ms for
hover, 220ms for state changes, 340ms for entry, 600ms for reveal, and longer
ambient loops (1.1s typing, 1.6s pulse, 2s breathe, 3.2s scan) for live state.
Standard easing is `cubic-bezier(0.2, 0.7, 0.2, 1)`; emphasis is
`cubic-bezier(0.16, 1, 0.3, 1)`.

### Named Rules

**The Glance Rule.** Every top-level surface answers "what needs me?" without
interaction. If the operator has to click, hover, or scroll to learn that
something is blocked, the layout has failed regardless of how it looks.

**The Scale-Is-For-Rhythm Rule.** Spacing tokens go on padding, margin, and gap.
Everything dimensional stays a literal. Snapping a 280px panel to a spacing step
is a bug, not a cleanup.

**The Reduced-Motion Rule.** Every animation passes through a single
`prefers-reduced-motion` gate. Entrance choreography collapses to instant;
ambient loops stop.

## Elevation & Depth

Depth is the one thing this system deliberately does **not** unify. Each surface
has exactly one depth doctrine, chosen for its material and its viewing distance,
and does not borrow another's:

- **Web — flat with hairlines.** Surfaces are flat at rest. Separation comes from
  a 1px hairline and a tonal step. A card shadow token exists but is a response
  to state (hover, elevation), not a resting condition.
- **macOS — flat with hairlines, plus real window material.** Same resting
  flatness as web, at 0.5pt. Depth beyond that comes from the window itself
  (opacity, the floating titlebar), not from stacked shadows on content.
- **iOS — lit material.** The canvas is genuinely lit: a top key-light over a deep
  floor, a fine film grain, gradient card fills, solid lifted edges, and soft drop
  shadows. This is a peer doctrine, not an exception; the phone is held close and
  needs the material.

### Named Rules

**The Depth-Is-Local Rule.** A surface uses its own depth doctrine and only its
own. Do not port iOS's gradient cards to web, and do not flatten iOS's lit canvas
to match web. Each doctrine is an invariant of its surface.

**The No-White-Alpha Rule.** On dark toned surfaces, fills and edges are solid
lifted neutrals — never `white.opacity()`. White alpha desaturates the canvas
tone back to grey, which is exactly what the tone system exists to prevent.

**The Shallow-Shadow Rule.** Where shadows exist they stay shallow and soft.
Light-mode shadows derive at roughly 30% of their dark-mode opacity, because a
heavy black shadow on a light surface reads as dirt.

## Shapes

The form language is machined: hard, exact, tight-radius geometry that reads as
instrumentation rather than as consumer chrome.

Radii are small and purposeful — 3px for badges, 6px for inset rows and small
controls, 8px for surface containers, 12–16px only for large content cards, and a
999px pill reserved for capsule chips and segmented controls. Circles (50%) are
for dots and avatars only.

Strokes are hairlines. `thin` (0.5pt native, 1px web) is the default structural
weight; `standard` (1pt) is already chunky on Retina and is used sparingly;
`bold` (2pt) is rare and structural.

The system's signature silhouette is the **chamfered signal frame** — an
eight-sided panel with corners cut at 6px, corner registration marks, and one
short datum line carrying state. It is the most literal expression of the
instrument metaphor in the codebase and is worth propagating deliberately rather
than decoratively.

### Named Rules

**The Hairline Rule.** Structural separation is a hairline, not a border and not
a box. Reach for `thin` first; justify anything heavier.

**The Rounded-Edge Rule.** A left accent bar belongs only on flat or square
elements — list rows, pinned bands. Rounded elements (composer wells, modal
wells, cards) signal active state through a focus border, never a left edge.

## Components

Components are **crisp and machined**: hard edges, exact alignment, thin strokes,
and structure made visible rather than softened. They are confident rather than
shy — but they earn attention through precision, not through fills.

Each surface implements these against its own tokens; the contracts below are what
must stay the same across all three.

### Eyebrow labels

The structural label primitive, in four tiers (9px/0.18em, 10px/0.08em,
11px/0.12em, 11px/0.18em). Always uppercase mono, weight 600, line-height 1,
paired with a muted or dim color. Wider tracking signals a more structural label.

### Chips

- **Shape:** small radius (6px) by default; pill only for capsule/segmented use.
- **Color:** tone-driven — the chip's text, background wash, and border are all
  derived from one tone color at roughly 12% / 18% alpha. Tones are neutral,
  working, success, warning, danger, info.
- **Modifiers:** pill, small, ghost (no border/background), mono, caps.
- Chips are composed from a base plus a tone plus modifiers, never re-rolled.

### Dots

The presence and status primitive: a 6px circle (5px small, 7px large) whose fill
is `currentColor` so that a glow modifier echoes the tone automatically.
Modifiers: pulse (breathing, for live state), glow (halo), ring (2px ring in the
parent's background color, for overlap).

Dots are the system's lowest-cost state signal and the reason categorical color
is unnecessary elsewhere.

### Buttons

- **Shape:** default radius (6px), compact padding.
- **Default:** neutral/secondary — surface fill, hairline border, ink text.
- **Primary:** solid ink on the canvas color. The highest-contrast action, used once.
- **Accent:** accent-soft fill with an accent border and accent text — the
  Quiet-By-Default treatment of a CTA.
- **Ghost / Danger:** transparent, and danger-toned respectively.
- **Hover:** border tightens toward the dim step and a shallow shadow appears.
- **Focus:** a visible focus ring is mandatory. Variants must never strip the
  outline without restoring an equivalent.
- **Mono family:** an uppercase-mono variant exists for nav and fleet actions.

### Cards / Containers

- **Corner style:** 8px for standard containers, 12px for large content cards.
- **Background:** the surface step, lifted clearly off the canvas.
- **Border:** hairline. On dark toned surfaces, a solid lifted neutral.
- **Shadow:** per the surface's depth doctrine.
- **Padding:** 16px standard, 12–14px for stat and inset variants.

### Signal panel (signature)

The chamfered instrument frame: an eight-sided shape with 6px corner cuts, a
gradient graphite fill, a hairline edge, four corner registration marks at ~82%
opacity, and a single short datum line at the top-left whose length and color
carry state (18px neutral when idle, 30px accent when active).

Signal panels deliberately sit on a **neutral graphite plane even when the
surrounding canvas is warm or cool**, because the content is instrumentation, not
a conventional card. The accent reaches only the registration marks and the datum
line; it never washes the panel.

## Do's and Don'ts

### Do:

- **Do** keep exactly one chromatic hue live in a window; let neutrals and the
  status triad do everything else.
- **Do** use the eyebrow tiers for structural labels instead of hand-rolling
  uppercase type.
- **Do** separate with a hairline (0.5pt native / 1px web) before reaching for a
  border, a box, or a shadow.
- **Do** default stateful fills to an accent-soft wash with ordinary ink on top;
  save solid accent for attention marks and primary actions.
- **Do** keep each surface on its own depth doctrine — flat-with-hairlines on web
  and macOS, lit material on iOS.
- **Do** use solid lifted neutrals for fills and edges on dark toned surfaces.
- **Do** put spacing tokens on padding, margin, and gap only, and leave
  dimensional values literal.
- **Do** gate every animation on `prefers-reduced-motion`.
- **Do** make every top-level surface answer "what needs me?" without interaction.
- **Do** preserve a visible focus ring on every interactive variant.

### Don't:

- **Don't** build frosted glass or heavy blur. Hand-rolled glassmorphism is not
  this system, and on dark toned surfaces white-alpha fills grey the canvas tone
  back out.
- **Don't** drift toward generic infra-navy or AI-purple SaaS chrome. The dark
  presets were explicitly neutralized to R=G=B for this reason; a steel-blue or
  violet tint in the neutrals is a regression, not a mood.
- **Don't** normalize the surfaces' accent hues to each other. Grammar converges;
  hue does not.
- **Don't** route brand or categorical colors to status tokens, or status colors
  to categories.
- **Don't** reintroduce fractional type sizes (9.5 / 10.5 / 11.5 / 12.5).
- **Don't** snap dimensional values — widths, heights, insets, grid tracks,
  border-widths, shadow geometry, blur — to the spacing scale.
- **Don't** put a left accent bar on a rounded element; rounded surfaces signal
  active state with a focus border.
- **Don't** use 1pt strokes as the default structural weight; they read chunky on
  Retina.
- **Don't** let shadows sit at rest on web or macOS surfaces — they are a response
  to state.
