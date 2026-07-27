# Scout Deck — control-surface pass

**Status:** implemented web variant

**Route:** `/ops/lanes` and `/ops/lanes/embed`

**Branch:** `codex/scout-deck-control-surface`

**Date:** 2026-07-27

## Design thesis

Scout Deck should feel like the place an operator *works the fleet*, not a
dashboard that happens to contain agent cards. The existing lane model already
had the correct product semantics: ordered live sessions, stable lane identity,
pinned positions, trace horizons, detailed inspection, keyboard focus, and
alternate grid/floor readings. This pass gives that model a stronger physical
grammar without replacing it.

The composition is now a shallow control rack:

1. a compact identification and telemetry rail names the surface and reports
   the real rendered roster;
2. a tactile channel bank makes every visible lane directly addressable;
3. the existing full-information lane columns remain the working surface;
4. grid and floor remain alternate readings of the same roster.

OpenScout green is the live signal. Neutral graphite carries structure. Motion
is restricted to live lamps, lane entry, and direct manipulation, with reduced
motion respected.

## Adapted from SpeakEasy

- **Channel bank, not lane duplication.** SpeakEasy's 1–9 inset keys become a
  horizontally scalable bank generated from Scout's actual resolved deck. Each
  key has a real lane label, pin state, activity state, accessible status, and a
  focus/scroll action.
- **Instrument hierarchy.** Eyebrow telemetry, two-digit channel numbers,
  status lamps, hairline divisions, and shallow inset/outset depth create a
  control-surface read before the trace detail takes over.
- **Tactility on glass.** Keys depress on activation; segmented controls sit in
  recessed wells; the rack carries subtle fasteners and panel shadows. These
  cues use Scout tokens and remain useful in light and dark themes.
- **State-specific motion.** Only real live channels pulse. New lanes retain
  the existing enter motion. `prefers-reduced-motion` removes both CSS motion
  and smooth channel navigation.
- **Graceful compression.** The bank scrolls horizontally rather than crushing
  names. At narrow container widths, secondary metadata gives way before the
  surface identity or channel controls.

## Deliberately left behind

- Voice phase, push-to-talk, narration transport, and connection leases belong
  to SpeakEasy's remote-control contract, not Scout Deck.
- Fixed slots 1–9 do not match a dynamic Scout roster.
- Lever positions, rotary encoders, and joystick controls would invent state
  and commands the broker does not own.
- Milky hardware housing and cyan brand signal were not transplanted. Scout's
  existing graphite surfaces and green live signal keep this variant native to
  the product.
- The agent card, trace, pinning, sizing, horizon, inspection, and roster
  architecture remain intact. This is a design and interaction pass, not a new
  source of truth.

## Accessibility and responsive behavior

- Channel entries are semantic buttons inside a labelled navigation region.
- Each key announces channel number, lane label, and the real lane status.
- Focus-visible treatment is distinct from hover and activation.
- The rack is fully keyboard reachable; selecting a channel focuses its
  existing lane article.
- Motion honours `prefers-reduced-motion`.
- At compact widths, controls and channel keys remain reachable through bounded
  horizontal tracks instead of causing page overflow.

## Artifacts

- `docs/eng/artifacts/scout-deck-control-surface/deck-wide-1440x1000.png`
- `docs/eng/artifacts/scout-deck-control-surface/deck-compact-1024x768.png`
- `docs/eng/artifacts/scout-deck-control-surface/deck-embed-834x1112.png`

## Verification

```text
bun test packages/web/client/screens/ops/agent-lanes-layout.test.ts packages/web/client/screens/ops/lane-deck.test.ts
# 9 pass, 0 fail

bun run --cwd packages/web build:client
# pass; existing bundle-size and generated CSS-property warnings remain
```

The visual loop used the repository's bounded `capture:web` helper against a
fresh Vite process on `127.0.0.1:43122`, at 1440×1000, 1024×768, and an embedded
834×1112 viewport.

## Tradeoffs

- The narrow full-app capture still exposes the shell's existing fixed context
  inspector, leaving a deliberately tight center canvas. Deck controls and the
  channel bank therefore scroll within their own tracks rather than attempting
  to collapse the surrounding shell.
- Channel numbers describe the current resolved deck order, not durable agent
  identity. Labels and lane IDs remain authoritative; pinning or roster change
  can renumber channels.
- The control bank mirrors visible lanes only. Hidden automatic lanes are not
  implied as empty hardware slots.
