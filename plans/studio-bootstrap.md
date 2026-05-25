---
title: Studio bootstrap
status: shipped
blurb: Why design/studio/ exists and what lives in it.
source:
  - design/studio/README.md
order: 1
---

# Studio bootstrap

A small Next.js app at `design/studio/` that hosts plans, design
studies, and a live atom gallery. Modeled on
`talkie/design/studio` — same shell vocabulary so context-switching
between the two projects is cheap.

## Why a separate app

The public `landing/` site is a marketing surface. It already has its
own conventions, dependencies (Tailwind 4, MDX, dewey, arc), and SEO
discipline. Stuffing internal planning into it would:

- Ship internal docs to the public bundle.
- Couple internal iteration speed to a more conservative dependency
  set.
- Blur the line between "what we tell the world" and "what we're
  arguing about internally."

A second Next app is cheap. Stack:

- Next 16 + React 19 + Tailwind 3.4 (matches talkie's studio so the
  two can share patterns).
- `marked` for plan rendering, `gray-matter` for frontmatter.
- Runs on port 3030 to stay out of the way of the landing dev server.

## What's in it

- **Plans** — markdown under `plans/` (this folder) renders at
  `/plans/<slug>`. Frontmatter sets status (`draft / in-flight / shipped /
  shelved / concept`), blurb, related source paths.
- **Studies** — React mockups for openscout UI under
  `app/studies/<slug>/page.tsx`. Seed: an inspector-bar skeleton
  comparing the eight current inspector shapes side by side.
- **Atoms** — proposed shared web primitives, live-rendered. Seed:
  `InspectorSection` (from the inspector audit's Tier-1 atom list).

## What's NOT in it

- The existing `docs/` tree. Those are reference; this is direction.
  Cross-reference via plan frontmatter `source:`.
- Auth or any kind of public-facing surface. This is for the team.

## Adding to it

The studio's own [README](../design/studio/README.md) covers the
three add-a-thing recipes (plan, study, atom). The pattern is
deliberately small: one file + one registry entry, no scaffolding
required.
