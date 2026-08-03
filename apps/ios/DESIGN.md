---
name: Scout for iOS
description: The adaptive phone dialect of the Lit Control Room — warm paper by day, a genuinely lit cockpit after dark, and chamfered signal instrumentation in both.
colors:
  light-canvas: "rgb(246, 243, 237)"
  light-surface: "rgb(255, 253, 249)"
  light-chrome: "rgb(242, 238, 230)"
  light-ink: "rgb(35, 33, 29)"
  light-muted: "rgb(88, 83, 75)"
  light-dim: "rgb(105, 99, 90)"
  light-border: "rgb(205, 197, 184)"
  light-accent: "rgb(7, 120, 91)"
  warm-canvas-top: "rgb(16, 14, 11)"
  warm-canvas-floor: "rgb(6, 5, 4)"
  warm-key-light: "rgb(255, 240, 219)"
  warm-card-top: "rgb(33, 28, 24)"
  warm-card-bottom: "rgb(23, 20, 17)"
  warm-card-edge-top: "rgb(67, 58, 48)"
  warm-inset: "rgb(22, 19, 16)"
  warm-raised: "rgb(28, 25, 21)"
  neutral-canvas-top: "rgb(12, 13, 14)"
  neutral-canvas-floor: "rgb(5, 5, 5)"
  neutral-card-top: "rgb(27, 28, 30)"
  neutral-card-bottom: "rgb(19, 19, 21)"
  neutral-card-edge-top: "rgb(56, 58, 63)"
  cool-canvas-top: "rgb(11, 13, 16)"
  cool-canvas-floor: "rgb(4, 5, 7)"
  cool-key-light: "rgb(222, 240, 255)"
  cool-card-top: "rgb(26, 28, 33)"
  cool-card-bottom: "rgb(18, 19, 23)"
  cool-card-edge-top: "rgb(52, 57, 68)"
  accent-emerald-tail: "rgb(11, 197, 165)"
  ink-muted: "rgb(184, 184, 184)"
  ink-dim: "rgb(150, 150, 150)"
  vibe-accent: "#9ce86b"
  vibe-amber: "#f2b34d"
  vibe-red: "#f2725b"
  vibe-blue: "#7cc4f2"
  vibe-ink: "#eef0f2"
  vibe-hairline: "rgb(58, 58, 62)"
  vibe-card: "rgb(34, 34, 37)"
  signal-top: "rgb(19, 21, 22)"
  signal-bottom: "rgb(11, 13, 14)"
  signal-edge: "rgb(58, 62, 63)"
  signal-rule: "rgb(42, 46, 47)"
  signal-neutral: "rgb(118, 124, 125)"
typography:
  title:
    fontFamily: "SF Pro (HudFont.ui)"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "SF Pro (HudFont.ui)"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.4
  body-compact:
    fontFamily: "SF Pro (HudFont.ui)"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "SF Mono (HudFont.mono)"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.12em"
  mono-detail:
    fontFamily: "SF Mono (HudFont.mono)"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  tight: "3px"
  standard: "6px"
  card: "8px"
  signal-cut: "6px"
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
  card:
    rounded: "{rounded.card}"
    padding: "12px"
  card-vibe:
    backgroundColor: "{colors.vibe-card}"
    textColor: "{colors.vibe-ink}"
    rounded: "{rounded.card}"
    padding: "12px"
  signal-panel:
    backgroundColor: "{colors.signal-top}"
    rounded: "{rounded.signal-cut}"
    padding: "12px"
  inset-well:
    backgroundColor: "{colors.warm-inset}"
    rounded: "{rounded.standard}"
    padding: "8px"
  raised-chip:
    backgroundColor: "{colors.warm-raised}"
    rounded: "{rounded.tight}"
    padding: "2px 6px"
---

# Design System: Scout for iOS

## Overview

**Creative North Star: "The Lit Control Room"** — phone dialect, and the most
literal of the three.

Where web and macOS express the control room through restraint, iOS expresses it
through **light and material**. The phone is held close and glanced at in many
ambient conditions, so appearance is a first-class axis: warm paper in Light and
a genuinely lit cockpit in Dark. Light is not a color inversion; it is ivory
canvas, parchment surfaces, dark ink, restrained edges, and shallow shadows. Dark
keeps the faint top key-light, deep floor, film grain, lifted cards, and graphite
depth that established the surface.

The canvas also has **temperature**. Three user-selectable tones — Warm (default),
Neutral, Cool — shift the canvas, key-light, cards, and inset fills together in
either appearance. Crucially the warmth lives in the *neutrals*, not the accent.
Appearance defaults to Light; operators can choose Dark or System in Settings.

The surface's signature is the **signal panel** — a chamfered eight-sided frame
with corner registration marks and a single datum line. It is the sharpest
statement of the instrument metaphor anywhere in Scout. Signal panels remain
neutral rather than following Warm/Cool: graphite in Dark and instrument paper in
Light, because instrumentation should not look like furniture.

**Key Characteristics:**

- Light-default appearance with Light / Dark / System controls
- Warm ivory paper by day; key-light, deep floor, and 2.8%-opacity grain in Dark
- Three canvas tones (Warm default / Neutral / Cool) that move the neutrals, not the accent
- Solid semantic fills everywhere — no hardcoded dark pixels in Scout surfaces
- Emerald→teal accent gradient so the accent reads as one light source
- A second, brighter "Vibe" palette scoped to the Home dashboard
- Chamfered signal panels with registration marks and a state-carrying datum
- One shared entrance choreography: 7pt settle, 35ms stagger, one spring

## Colors

### Primary

- **Emerald** (HudsonKit accent) with a **teal tail** (`rgb(11,197,165)`): the
  accent is a directional gradient — top-leading emerald to bottom-trailing teal —
  shared by the brand mark and primary CTAs so the accent reads as a single light
  source rather than a flat fill.

### Appearance and neutral tones

Light starts at canvas `rgb(246,243,237)`, surface `rgb(255,253,249)`, and chrome
`rgb(242,238,230)`, with ink `rgb(35,33,29)`. The accent deepens to
`rgb(7,120,91)` so small text and controls clear contrast on paper. Status colors
also use their deeper light variants. Dark preserves the established palette.

Each tone is a complete eight-token set in both appearances. Values below describe
the Dark Warm set; Neutral and Cool shift the same slots, while Light maps those
slots to ivory, parchment, or cool paper.

- **Canvas top** (`rgb(16,14,11)`) → **canvas floor** (`rgb(6,5,4)`): a vertical
  wash so the screen reads lit rather than printed.
- **Key light** (`rgb(255,240,219)` warm amber; cold white in Cool; pure white in
  Neutral): a radial gradient from the top edge, composited `.screen` at 6%
  (8.2% when the fleet is live), radius 360–392pt.
- **Card top / bottom** (`rgb(33,28,24)` → `rgb(23,20,17)`): the gradient fill of a
  raised card.
- **Card edge top** (`rgb(67,58,48)`): the lifted top edge that catches the
  key-light. The bottom edge anchors to HudsonKit's shared `border` so cards settle
  onto the same floor across every tone.
- **Inset** (`rgb(22,19,16)`) and **raised** (`rgb(28,25,21)`): solid toned fills
  for chips, pills, and fields.

### Text

- **Dark Muted** (`rgb(184,184,184)`) and **Dark Dim** (`rgb(150,150,150)`): both lifted a
  notch above the shared HudsonKit values, which sat at or below the AA floor for
  small mono labels on the near-black canvas. This is app-level only — the shared
  palette and the macOS app are untouched.
- **Light Muted** (`rgb(88,83,75)`) and **Light Dim** (`rgb(105,99,90)`): warm
  dark neutrals that remain legible on paper without reading as pure black.

### Tertiary — the Vibe palette

Home's fleet dashboard runs a higher-energy set. Dark uses **Lime** (`#9ce86b`)
as the canvas signature and **Amber** (`#f2b34d`)
for permission/confirm, **Coral** (`#f2725b`) for blocked, **Sky** (`#7cc4f2`) for
decision, a brighter **ink** (`#eef0f2`), a crisper **hairline** (`rgb(58,58,62)`),
and a deliberately **neutral** card fill (`rgb(34,34,37)`). Light resolves the
same roles to darker accessible hues on an off-white card; status meaning does
not change with appearance.

### Signal surface

A narrower, deliberately non-tonal set for instrumentation. Dark uses graphite:
top `rgb(19,21,22)`, bottom `rgb(11,13,14)`, edge `rgb(58,62,63)`. Light uses
instrument paper: top `rgb(255,254,250)`, bottom `rgb(243,239,231)`, edge
`rgb(195,188,176)`.

### Named Rules

**The Tone-Lives-In-The-Neutrals Rule.** Warmth and coolness belong to the canvas,
cards, and insets — never to the accent. A tone change must not shift what the
accent means or how status reads.

**The Semantic-Pixel Rule.** Chips, pills, fields, insets, text, and card edges
resolve through Scout's adaptive palette. Do not introduce raw dark-only fills or
white-alpha controls; both break one appearance and desaturate the tone system.

**The Signal-Stays-Neutral Rule.** Signal panels ignore the Warm/Cool canvas tone:
graphite in Dark, instrument paper in Light. A warm room must not turn the
instruments brown.

**The Vibe-Is-Scoped Rule.** The Vibe palette belongs to Home's fleet dashboard.
It is a deliberate second dialect for one dense surface, not a replacement for the
app accent, and it does not leak into the rest of the app.

## Typography

**UI Font:** SF Pro, via `HudFont.ui`
**Mono Font:** SF Mono, via `HudFont.mono`

**Character:** Same two-voice split as the other surfaces, but at phone sizes and
with a lower mono share — a phone screen has less room for machine detail, so mono
concentrates in section headers, row meta, and activity readouts, where its
fixed-width alignment does real work.

### Hierarchy

- **Title** (semibold, 17px): navigation and section titles.
- **Body** (regular, 17px, 1.4): the iOS body size. Prose and message content.
- **Body-compact** (regular, 15px, 1.35): dense row content.
- **Mono detail** (regular, 12px): ids, paths, counts, timing.
- **Label** (mono, semibold, uppercase, 11px, 0.12em): section headers, row
  details, activity meta.

### Named Rules

**The Dynamic-Type Rule.** Text is set through system text styles so it follows
the user's reading size. Do not hard-code point sizes into new views.

**The 11pt-Floor Rule.** No text below 11pt, and mono labels at that size use the
lifted `ScoutInk` tiers, not the shared muted/dim.

## Layout

Spacing and radii come from the shared HudsonKit scales (2/4/6/8/10/12/14/20/28pt;
3/6/8pt), same as macOS. Home's operational cards standardize on an 8pt corner;
capsules and chips keep their own geometry.

Because this is a native iOS app, the platform's structure rules outrank the
system's expression:

- Content lays out inside the **safe-area insets**. Nothing sits under the Dynamic
  Island, the home indicator, or the rounded corners.
- The floating **tab rail** carries top-level sections (Home · Agents · Tail ·
  Comms · Shell · New), never actions. It is a tall system-glass capsule with
  one fixed-width tinted-glass selection seat per column; the seat never changes
  shape to fit a longer label. Hierarchy uses a navigation stack; self-contained
  tasks use sheets.
- The masthead **host scope** is a quiet pointy hex beside the Scout wordmark,
  never a card, rail, or destination. Every paired host owns one facet dot:
  filled means included in fleet-readable views, hollow means excluded, and
  accent versus dim is the secondary online signal. A native menu edits any
  non-empty subset; with one selected host the label names it, otherwise it
  reports full count or subset coverage.
- The **left-edge back gesture** stays alive. It is never disabled or overlaid.
- Every tappable control clears **44×44pt** with breathing room between adjacent
  targets.

### Motion

One entrance language for the whole app: a 7pt vertical settle plus fade, staggered
35ms per index (capped at 8), on a `spring(response: 0.34, dampingFraction: 0.82)`.
The phase is owned by a top-level surface rather than by individual rows, so data
arriving from a later poll renders in place instead of replaying the screen's
first-activation choreography.

The canvas key-light animates on a 1.4–1.6s ease-in-out when fleet-live state
changes. Everything is gated on `accessibilityReduceMotion`.

Tab selection is the intentionally faster exception: the seat travels on a
short `spring(response: 0.18, dampingFraction: 0.88)` while the destination
crossfades in 100ms. It should feel attached to the finger, not choreographed.

### Named Rules

**The Entrance-Latch Rule.** First-activation choreography plays once per launch
per surface, owned by the surface. New rows arriving later appear in place —
re-running the stagger on every poll is the bug this rule exists to prevent.

**The HIG-Wins Rule.** Where the visual system and the platform disagree on
structure, navigation, or interaction, the platform wins. Brand expresses through
tint, type, motion, and content — not through reinvented navigation.

## Elevation & Depth

**Lit material** — the fullest depth doctrine in the system, and a peer to the
other surfaces' flatness rather than an exception.

The canvas is built in layers: the shared HudsonKit background, a vertical
gradient from the tone's canvas-top through that background at 36% to the tone's
canvas-floor, a radial key-light from the top edge composited in `.screen`, and a
film grain. All of it sits behind content and never takes a hit.

The **film grain** is a cached, deterministic 48px monochrome tile generated once
per process from a fixed-seed LCG with a narrow mid-grey distribution (82–175), then
composited by the GPU as an `ImagePaint` in `.softLight` at 2.8% opacity. There is
no `TimelineView` and no per-frame noise work — the texture is free to animate over.

Cards (`scoutCard`) raise off that canvas with three coordinated moves: a
top-to-bottom gradient fill (`cardTop` → `cardBottom`), a gradient stroke from the
lifted `cardEdgeTop` down to the shared border, and a soft drop shadow
(`black 33%`, radius 9, y 3).

Signal panels use a shallower shadow (`black 24%`, radius 4, y 2) and a hairline
edge, because instrumentation should sit *in* the panel rather than float above it.

### Shadow Vocabulary

- **Card lift** (`color: black 33%, radius: 9, y: 3`): genuine cards and
  containers.
- **Signal lift** (`color: black 24%, radius: 4, y: 2`): instrument frames.
- **Light floating chrome**: a broad warm ambient shadow around 10% plus a tiny
  7–8% contact shadow. Never use one dense black halo on paper.
- **Floating tab rail**: native regular Liquid Glass, a faint semantic backing,
  and a top-to-bottom rim. Do not recreate its blur by hand.

### Named Rules

**The Cards-Not-Rows Rule.** `scoutCard` is for genuine cards and containers, not
for flat list rows. A list of lifted cards reads as clutter at phone density.

**The Solid-Edge Rule.** Card and panel edges are solid lifted neutrals with a
gradient from top edge to shared border — never a white-alpha hairline.

## Shapes

Tight radii shared with macOS (3 / 6 / 8pt), with Home's operational cards
standardized at 8pt and capsules keeping their own geometry.

The distinctive form is the **chamfered signal shape**: an eight-sided path with
each corner cut at 6pt (clamped to a third of the smaller dimension). It reads as
a machined plate rather than a rounded card, and it is the reason the instrument
metaphor lands visually instead of only in copy.

Four **corner registration marks** — 9pt arms inset 4pt, stroked at 1pt, at 82%
opacity — sit inside the frame, and a single **datum line** at the top-left carries
state: `HudStrokeWidth.thin` tall, 18pt wide and neutral when idle, 30pt wide and
accent-tinted when active.

## Components

Crisp and machined, made of light. Every fill is solid and toned; every edge is a
lifted neutral.

### Cards (`scoutCard`)

- **Corner style:** 8pt continuous.
- **Background:** vertical gradient, tone `cardTop` → `cardBottom`.
- **Border:** 1pt gradient stroke, tone `cardEdgeTop` → shared border.
- **Shadow:** `black 33%`, radius 9, y 3.
- **Use:** genuine cards and containers only.

### Signal panel (signature)

- **Shape:** chamfered eight-sided, 6pt corner cut.
- **Background:** `signal-top` → `signal-bottom` vertical gradient on a neutral
  graphite plane, regardless of canvas tone.
- **Border:** `signal-edge` at `HudStrokeWidth.thin`.
- **Marks:** four corner registration marks at 82% opacity, tinted by the state
  accent or by `signal-neutral` when idle.
- **Datum:** one top-left line, 18pt neutral / 30pt accent.
- **Shadow:** `black 24%`, radius 4, y 2.
- **Rule:** the accent reaches the marks and the datum only. It never washes the panel.

### Insets, chips and fields

Solid toned fills from `ScoutSurface.inset` (recessed) and `.raised` (lifted),
resolved from the active tone at access time. These deliberately replace the shared
white-alpha surface tokens.

### Vibe cards (Home)

8pt radius, neutral `rgb(34,34,37)` fill, crisp `rgb(58,58,62)` hairline, brighter
`#eef0f2` ink — a scoped, higher-contrast card for dashboard density.

## Do's and Don'ts

### Do:

- **Do** use `ScoutSurface.inset` / `.raised` / `.card` so surfaces carry the active
  tone.
- **Do** keep warmth and coolness in the neutrals; leave the accent alone.
- **Do** use `scoutCard` for genuine containers and leave list rows flat.
- **Do** keep signal panels on neutral graphite whatever the canvas tone.
- **Do** let the accent reach only the registration marks and the datum line on a
  signal panel.
- **Do** own entrance phase at the surface, not the row.
- **Do** lay out inside the safe area, keep the tab bar to sections, and leave the
  edge-swipe back gesture alive.
- **Do** keep every tab selection seat the same width and use compact rail copy
  ("Shell" in the rail, "Terminal" as the destination name) when a label would
  distort that rhythm.
- **Do** clear 44×44pt on every tappable control.
- **Do** honor `accessibilityReduceMotion` on every animation.

### Don't:

- **Don't** use `white.opacity()` for fills, chips, pills, fields, or edges on dark
  surfaces. It greys out the tone.
- **Don't** build frosted glass or hand-rolled blur; use system materials where
  translucency is genuinely wanted.
- **Don't** let the Vibe palette leak off Home.
- **Don't** tint signal panels with the canvas tone.
- **Don't** replay entrance choreography when a poll inserts new data.
- **Don't** hard-code point sizes that defeat Dynamic Type, or ship text below 11pt.
- **Don't** reinvent navigation bars, back gestures, or system controls — the
  "ported from a website" tells are the fastest way to lose a fluent iPhone user.
- **Don't** add per-frame noise work; the grain tile is generated once per process
  on purpose.
