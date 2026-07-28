---
name: OpenScout — openscout.app
description: Basel — a reductive Swiss marketing world of near-monochrome paper, one grotesque, and a single rationed red.
colors:
  paper: "oklch(0.993 0 0)"
  paper-2: "oklch(0.972 0 0)"
  paper-3: "oklch(0.940 0 0)"
  ink: "oklch(0.205 0 0)"
  ink-2: "oklch(0.400 0 0)"
  ink-3: "oklch(0.560 0 0)"
  ink-faint: "oklch(0.720 0 0)"
  line: "oklch(0.885 0 0)"
  line-soft: "oklch(0.925 0 0)"
  rule: "oklch(0.205 0 0)"
  red: "oklch(0.575 0.218 27)"
  red-soft: "oklch(0.575 0.218 27 / 0.10)"
  dark-page: "#14151a"
  dark-docs: "#181a20"
  dark-panel: "#1c1e25"
  dark-surface: "rgba(35, 38, 49, 0.94)"
  dark-surface-strong: "#2a2e3a"
  dark-ink: "#ebe6dc"
  dark-copy: "#c4bda9"
  dark-muted: "#8a8472"
  dark-accent: "#f4b860"
  dark-border: "rgba(214, 200, 170, 0.13)"
  dark-border-strong: "rgba(214, 200, 170, 0.24)"
typography:
  hero:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(1.9rem, 3.1vw, 2.5rem)"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "-0.026em"
  hero-sub:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(14px, 1.2vw, 15.5px)"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  eyebrow:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.07em"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "0"
    padding: "12px 24px"
    typography: "{typography.eyebrow}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "12px 24px"
  panel:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "24px"
  command-strip:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "12px 16px"
    typography: "{typography.mono}"
---

# Design System: OpenScout — openscout.app

## Overview

**Creative North Star: "Basel"**

The marketing site is a deliberately separate world from the product surfaces, and
that separation is a decision, not drift. Where the apps are a lit dark control
room, the site is a printed page: near-monochrome paper, one grotesque, hairlines
and whitespace instead of shadows, and exactly one chromatic colour spent perhaps
once per view. It is Swiss reductive design applied to developer marketing — the
argument is that a coordination substrate for agents should look composed and
certain, not like every other AI product's gradient.

The discipline is total. There are no shadows (`--site-card-shadow: none`), no
glows (`--site-glow-*: transparent`), no gradients, and no second accent. Idle
status is neutral ink, because red is reserved for the *active* mark. Separation
comes from a hairline, a heavier structural rule, or empty space — nothing else.
Every legacy warm/RFC token from the previous identity was removed rather than
deprecated.

Dark mode is not an inversion of Basel; it is a second, warmer world. Warm
graphite surfaces on a deliberate luma ladder, cream ink, warm-tinted borders, and
a **CRT amber** accent standing in for the light mode's red. Its shadows are
luminous inset rims rather than drop shadows, because drop shadows do nothing on
dark.

This surface is **Persuade** mode: a visitor arrives undecided and leaves having
installed, starred, or understood. Composition and copy carry the argument; the
visual system's job is to make the argument look inevitable.

**Key Characteristics:**

- Near-monochrome OKLCH paper-to-ink ramp, zero chroma
- One grotesque (Archivo) plus one true monospace (IBM Plex Mono)
- A single rationed red, spent about once per view
- Zero shadows, zero glows, zero gradients in light mode
- Square corners — the form language is print, not product
- Hairline and rule as the only separators
- A warm graphite + CRT-amber dark world, with luminous rims instead of shadows

## Colors

A zero-chroma monochrome ramp with exactly one chromatic exception. Every neutral
in light mode is `oklch(L 0 0)` — literally no chroma at all, which is what makes
the single red land as hard as it does.

### Primary

- **Signal Red** (`oklch(0.575 0.218 27)`): the one chromatic colour. It marks the
  active state, the live indicator, and at most one emphatic moment per view. Its
  soft form (`/ 0.10`) backs the rare tinted surface, with `/ 0.16` and `/ 0.40`
  available for stronger fills and borders.

### Neutral

- **Paper** (`oklch(0.993 0 0)`): the page. Effectively white, a hair off.
- **Paper 2** (`oklch(0.972 0 0)`): panels, docs background, elevated surfaces.
- **Paper 3** (`oklch(0.940 0 0)`): the deepest paper step.
- **Ink** (`oklch(0.205 0 0)`): headings and primary type. Also serves as the heavy
  structural **rule**.
- **Ink 2** (`oklch(0.400 0 0)`): body copy.
- **Ink 3** (`oklch(0.560 0 0)`): muted copy and **idle status**.
- **Ink Faint** (`oklch(0.720 0 0)`): the faintest legible tier.
- **Line** (`oklch(0.885 0 0)`) and **Line Soft** (`oklch(0.925 0 0)`): the hairline
  and faintest divider.

### Dark mode — a second world

- **Warm Graphite Page** (`#14151a`), **Docs** (`#181a20`), **Panel** (`#1c1e25`),
  **Surface** (`rgba(35,38,49,0.94)`), **Surface Strong** (`#2a2e3a`): a surface
  ladder where each step sits at least 8 luma above the page so cards actually
  separate.
- **Cream Ink** (`#ebe6dc`) → **Copy** (`#c4bda9`) → **Muted** (`#8a8472`): warm ink
  that ties dark mode back to the paper world.
- **CRT Amber** (`#f4b860`): the dark-mode accent — the broker/transmit signal
  colour, replacing red entirely.
- **Warm borders** (`rgba(214,200,170, 0.08 / 0.13 / 0.24)`): tinted to harmonise
  with amber rather than reading as neutral grey.

### Named Rules

**The One Colour Rule.** Red is spent about once per view. If two things on a
screen are red, one of them is wrong. Idle and inactive states are neutral ink —
red belongs to the active mark.

**The Zero-Chroma Rule.** Light-mode neutrals carry no chroma at all
(`oklch(L 0 0)`). A warm or cool grey is not a mood here; it is a regression to the
retired identity.

**The Not-Infra-Navy Rule.** Dark mode is warm graphite with amber, explicitly not
the generic infra-navy every developer-tooling site defaults to. Borders and glows
are warm-tinted for this reason.

## Typography

**Display Font:** Archivo (with `system-ui, sans-serif`)
**Body Font:** Archivo — the same face
**Label/Mono Font:** IBM Plex Mono (with `ui-monospace, monospace`)

**Character:** One grotesque doing every prose job, and one true monospace doing
every machine job. Archivo is a compact, slightly condensed grotesque with real
authority at display sizes and no personality tics at body sizes — the closest
thing to a neutral Swiss workhorse available as a web font. Every prose slot
(`--font-geist-sans`, `--font-display`, `--font-spectral`) resolves to it, so the
whole site re-types from one variable. IBM Plex Mono replaced the previous mono
specifically for true fixed-width in terminals, commands, status bars, and spec
tables.

### Hierarchy

- **Hero** (600, `clamp(1.9rem → 2.5rem)`, 1.06, −0.026em): tight, negative-tracked,
  composed as a two-line statement stack rather than a four-line ramp. The second
  line drops to muted ink, so the headline reads as statement-then-qualifier.
- **Hero sub** (400, `clamp(14px → 15.5px)`, 1.55): one paragraph, no more.
- **Body** (400, 15px, 1.6): prose and docs.
- **Eyebrow** (mono, 10.5px, 0.07em, uppercase, muted): section labels, sitting
  baseline-aligned in an inline-flex row.
- **Mono** (13px, 1.5): commands, terminal content, spec tables, status bars.

### Named Rules

**The One-Face Rule.** Archivo for everything a person reads; Plex Mono for
everything a machine emits. There is no third face, and the display/serif slots are
aliases rather than opportunities.

**The Statement-Stack Rule.** Display headlines are composed as two lines that each
hold on one line in the editorial column, with the second line in muted ink. Sizes
exist to preserve that composition — don't retune them to fill a ramp.

## Layout

An editorial column on paper. Content sits in a measured column with generous
vertical rhythm, sections separated by hairlines or by heavy ink rules rather than
by cards. Panels are flat `paper-2` fields, not floating objects.

Section structure is consistent: a mono eyebrow, then a display statement, then one
paragraph of support, then the evidence — figures, plates, or record bands. The
"Why Scout" section is the reference implementation: an editorial head row, two
matched plates (problem → solution) over a shared hairline, and the capability
records pulled out into their own band beneath.

Dark mode keeps the same geometry and only changes material.

### Named Rules

**The Whitespace-Separates Rule.** Separation is whitespace first, hairline second,
heavy rule third. A card, a shadow, or a border box is not on the list.

## Elevation & Depth

**Zero elevation in light mode.** This is stated in the tokens themselves:
`--site-card-shadow`, `--site-card-shadow-hover`, `--site-panel-shadow`, and
`--site-toggle-shadow` are all literally `none`, and the three glow tokens are
`transparent`. Depth does not exist here. Hierarchy is carried by tone steps
across the paper ramp, by hairlines, and by space.

Dark mode reintroduces material, but as **luminous rims rather than drop shadows** —
a 1px inset white highlight over a 1px black bottom edge, with hover adding a faint
amber ring. Drop shadows do nothing on dark; a lit edge does.

### Shadow Vocabulary

- **Light:** none. All four shadow tokens are `none`.
- **Dark card** (`0 1px 0 rgba(255,255,255,0.07) inset, 0 1px 0 rgba(0,0,0,0.4)`):
  a lit top edge and a grounded bottom edge.
- **Dark card hover** (adds `0 0 0 1px rgba(244,184,96,0.12)`): a faint amber ring.
- **Dark toggle** (`… inset, 0 12px 32px rgba(0,0,0,0.5)`): the one genuinely
  lifted element.

### Named Rules

**The No-Shadow Rule.** Light mode has no shadows and no glows. If a surface needs
to separate, change its paper step or give it a hairline. Adding a shadow here
breaks the world.

**The Lit-Rim Rule.** Dark-mode elevation is an inset highlight plus a grounded
bottom edge, never a drop shadow.

## Shapes

Square. The form language is print, not product: panels, plates, buttons, and
command strips have straight corners, and the rounding that appears elsewhere in
Scout is deliberately absent. That squareness is most of why the site reads as
composed rather than as an app landing page.

Borders come at three weights: `line-soft` for the faintest divider, `line` for the
standard hairline, and `rule` — full ink — for heavy structural separation. A rule
at ink weight is a strong compositional move and should be used where a section
genuinely ends.

Figures and mocks are drawn as flat plates with hairline frames, not as
screenshots floating in space.

## Components

Flat, square, and typographically led. There are very few decorated components on
this site; most of what reads as a component is a typographic arrangement over a
hairline.

### Buttons

- **Shape:** square. No radius.
- **Primary:** solid ink field with paper text, mono uppercase label at eyebrow
  tracking, generous horizontal padding.
- **Ghost:** transparent with ink text; hover moves to pure black
  (`--site-ink-hover`) in light and pure white in dark.
- **Hover:** a tone shift only. No lift, no shadow.

### Panels and plates

`paper-2` field, hairline frame, square corners, no shadow. Matched plates are laid
in pairs over a shared hairline so their tops and baselines align exactly — the
alignment is the effect.

### Command strips

Mono type on a `paper-2` field with a copy affordance. These carry the install
commands and are the closest the site comes to a product surface; they stay flat
and square like everything else.

### Record bands

The capability records under "Why Scout": a label in mono eyebrow, then one line of
text, repeated in a band. No cards, no icons, no borders between entries beyond a
hairline.

### Status marks

A neutral ink dot when idle; red only when genuinely active. `--site-status-online`
resolves to `ink-3`, not to red, precisely so the active mark keeps its meaning.

## Do's and Don'ts

### Do:

- **Do** keep light-mode neutrals at zero chroma.
- **Do** spend red once per view, on the active mark.
- **Do** separate with whitespace, then a hairline, then a heavy ink rule.
- **Do** keep corners square.
- **Do** compose display headlines as a two-line statement stack with the second
  line in muted ink.
- **Do** use Archivo for prose and IBM Plex Mono for machine text — those two only.
- **Do** use lit rims for dark-mode elevation.
- **Do** re-theme from the `:root` token block; every surface token routes through it.

### Don't:

- **Don't** add shadows or glows in light mode. The tokens are `none` and
  `transparent` on purpose.
- **Don't** introduce a second accent, a gradient, or a tinted neutral.
- **Don't** drift dark mode toward generic infra-navy; it is warm graphite with CRT
  amber.
- **Don't** round corners to match the product surfaces. This world is print.
- **Don't** colour idle or inactive states — idle status is neutral ink.
- **Don't** import the product surfaces' tokens, primitives, or dark palette. The
  separation from `packages/web` is deliberate.
- **Don't** reintroduce the retired warm/RFC identity tokens.
