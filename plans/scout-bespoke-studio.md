---
title: Studio bespoke to scout
status: concept
blurb: Pivot the studio's visual identity from talkie-mirror to scout-native; queue component studies.
source:
  - packages/web/client/scout/Provider.tsx
  - design/studio/app/globals.css
order: 5
---

# Studio bespoke to scout

The studio's current chrome (cream canvas, Newsreader serif, JetBrains
Mono eyebrows) is borrowed wholesale from
[`talkie/design/studio`](https://github.com/arach/talkie). That bootstrap
served its purpose — getting the shell, sidebar, page strip, eng-doc
viewer, and file viewer in place fast. The next phase is making the
studio feel bespoke to scout: pulling in scout's actual design tokens
and starting opinionated component studies against them.

This is a destination, not an urgent pivot. No precedence over in-flight
eng-doc / plan work.

## Scout's actual tokens (source of truth)

Defined in `packages/web/client/scout/Provider.tsx:97-157` as inline
React style objects with two bundles (dark default + light):

**Color space**: `oklch` throughout. Perceptually uniform, modern.

**Dark theme (default)**
- `--hud-bg`: `oklch(0.14 0.008 80)` — near-black, faint warm tint
- `--hud-surface`: `oklch(0.18 0.009 80)`
- `--hud-ink`: `oklch(0.96 0.008 80)`
- `--hud-accent`: `oklch(0.86 0.17 125)` — **yellow-green**, not cyan. Cockpit phosphor.
- `--hud-status-ok`: `oklch(0.80 0.15 155)` (green)
- `--hud-status-warn`: `oklch(0.82 0.15 85)` (amber)
- `--hud-status-error`: `oklch(0.72 0.18 25)` (red)

**Light theme**
- `--hud-bg`: `oklch(0.978 0.004 85)` — warm off-white
- `--hud-accent`: `oklch(0.72 0.16 125)` — same hue, denser

**Chrome ink ladder** (`--scout-chrome-ink-*`): color-mix opacities of `--hud-ink` at 92/78/60/40/24/8/4% — used for hierarchy without color shift.

**Fonts**
- Sans: `'Inter Tight', 'Inter', ...`
- Mono: `'JetBrains Mono', ...`
- Serif: `'Instrument Serif', 'Spectral', Georgia` — *not* Newsreader. The editorial face is Instrument Serif.

**Shadows**: warm-dark `oklch(0.08 0.006 75 / N)` — quite different from neutral grays.

## What this means for the studio

A bespoke pass would touch:

1. **`app/globals.css`** — swap the `studio-canvas` / `studio-ink` / `studio-edge` static hex values for `oklch()` from scout's HUD palette. Replace Newsreader with Instrument Serif. Keep Inter Tight + JetBrains Mono.
2. **`tailwind.config.ts`** — recolor the `studio-*` namespace using scout tokens; possibly introduce a `--hud-*` mirror so studio components can read the same vars scout's web app does.
3. **`components/Studio*`** — sidebar dot, page strip, status pills get scout's amber/green/red instead of the cream-palette tones currently inlined.
4. **`components/EngMarkdown`** + `eng-doc.css` — recolor code blocks; consider scout's existing `app.css` syntax tokens.
5. **`/eng` index status counts** — reuse scout's status copy + palette.

Avoid the trap of doing 1–5 in one pass. Land one (probably the
globals.css recolor) and let it settle before the next.

## Component studies queue

Scout-specific component studies the studio should host (each is a
Next route under `app/studies/`, registered in `lib/studio-pages.ts`):

- **Inspector bar** — already seeded at `/studies/inspector-bar` (eight variants as colored skeletons). Next step: replace static mock with the live scout primitives once they're extracted as atoms.
- **Channel layout** — design exploration referenced in [project_channel_content_design.md](https://github.com/arach/openscout) memory.
- **Ops detail snapshot** — alternative to the `window.scoutOpsDetailSnapshot` side channel. Show the data shape, propose a `useOpsSelection()` store.
- **Agent pulse row** — single agent's status indicator, isolated. Drives a candidate `AgentPulseRow` atom for the Tier-2 atom list in `inspector-atom-rollout`.
- **Ranger panel** — the resizable bottom-rail. Today it lives in `Inspector.tsx` height-clamping logic. Study what the right resize model looks like.
- **Status pill grammar** — across web/iOS/macOS, scout uses many pill variants. Document and rationalize.
- **Mesh canvas minimap** — the floating minimap shown when the canvas mode is active. Study scale/placement variants.

## How to start

When ready, the lightest-touch first PR is just **globals.css + tailwind.config.ts**: replace the static studio palette with the scout HUD tokens. Everything downstream (status pills, prose, sidebar) inherits automatically. The result will be a darker, denser studio that reads as a peer of `packages/web/client`, not a peer of talkie.

The component studies don't depend on the recolor — they can start in parallel against the current chrome. Inspector-bar is the established
foothold.
