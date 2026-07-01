# HUD Skins — visual tokens & implementation guidance

> Proposal only. No implementation here. Grounded in
> `apps/macos/Sources/ScoutHUD/{HUDChrome,HUDStatusView,HUDRunnerView}.swift`,
> `OverlayPanelShell.swift`, and the existing Tail transparency machinery.

> Implementation note, 2026-06-30: the first pass landed as `HUDSkin.current`,
> `HUDSkin.metal`, and `HUDSkin.glass`, persisted through `HUDSkinState` /
> `UserDefaults` and resolved by computed `HUDChrome` tokens. A full
> Environment-key migration remains optional cleanup if static token call sites
> stop repainting reliably.

## Goal

Same HUD **data, forms, and layout**. Three selectable visual **skins**:

1. **Default** — today's "broadsheet": warm near-black solid canvas, paper grain,
   warm-cream rim hairline, lime accent. Baseline; zero change.
2. **Matte** — cool brushed/anodized dark metal: directional sheen, beveled edge,
   harder elevation.
3. **Glass** — transparent liquid-glass: desktop blurs through, bright meniscus
   edge, legibility veil.

## What varies vs. what is invariant

A skin is **(material recipe + substrate layer stack + a few re-tinted surface
tokens + edge/elevation treatment)**. Nothing else.

**Invariant across all skins (this is the brand identity — do not touch):**
- Accent family: `accent` / `accentDim` / `accentSoft` / `accentWhisper` (lime).
- Type system: `HUDType` (Inter + JetBrains Mono), `eyebrowTracking`.
- Glyphs: `HUDMastheadMark`, `HUDHarnessMark`, `RobotGlyphShape`, pulses.
- Per-agent hue logic (`HUDChrome.agentHue`).
- Layout: every padding, the content router, masthead/footer/dock structure.
- Corner-radius *policy* (`activeCornerRadius` already varies by tail state —
  skins must not add a 4th radius axis; they restyle the stroke/material *within*
  whatever radius the state picks).

**Varies per skin:** the `ZStack` substrate branch in `HUDStatusView.body`
(lines ~184–204), the edge `strokeBorder` (lines ~261–269), the grain/rim
overlays, and a small set of surface tokens (`canvas`, `canvasAlt`, `canvasLift`,
`border`, `borderSoft`, `borderRim`).

## Proposed tokens

Keep the **semantic token names identical** and resolve them per skin. Add a
`HUDPalette` value type holding the variable tokens, plus skin-specific
material/texture descriptors. `accent*` and `HUDType` stay invariant; carrying
accent through the palette is fine as long as the values do not drift.

### Skin 1 — Default (`.broadsheet`)
Returns today's `HUDChrome` values verbatim. Regression-proof baseline.
- `canvas (0.045, 0.040, 0.035)` warm-black · grain = `HUDPaperGrain` softLight 4.5%
- edge = `borderRim (0.395, 0.370, 0.320)` warm-cream, 1px flat hairline
- rim overlay = `HUDPanelRim` (top-edge lime+warm specular, corner halos)
- elevation = NSPanel native shadow

### Skin 2 — Matte metallic (`.matte`)
The tell of "metal" is **cool neutral ground + directional (anisotropic) texture +
a beveled edge**, not paper's warm stochastic dots.

| token            | value / treatment                                                        |
|------------------|--------------------------------------------------------------------------|
| `canvas`         | cool graphite `~(0.105, 0.107, 0.112)` (drop the warm bias)              |
| `canvasAlt`      | `~(0.140, 0.143, 0.150)`                                                 |
| `canvasLift`     | `~(0.185, 0.190, 0.200)`                                                 |
| `border`         | cooler/brighter than default `~(0.30, 0.31, 0.33)`                       |
| `surfaceSheen`   | faint diagonal linear-gradient sweep, neutral white, ≤6% — milled look   |
| `bevelLight`     | top-edge specular line, cool white ~0.85 @ low alpha (1px)               |
| `bevelDark`      | bottom-edge occlusion line, near-black @ ~0.5 alpha (1px)                |
| texture          | **brushed metal**: horizontal-streak noise (see below), `.overlay` ~7%   |
| elevation        | tighter, darker drop shadow → reads machined                             |

Ink: the warm ink (0.90/0.89/0.86) shifts slightly green/warm over cool graphite —
nudge ink ~+0.01–0.02 brighter for matte and verify contrast.

### Skin 3 — Transparent glass (`.glass`)
**Reuse the Tail path's existing glass machinery — do not build a parallel one.**
The Tail surface already does `VisualEffectBackground(material: .hudWindow,
blendingMode: .behindWindow)` + `tailReadabilityVeil`. Generalize that to the
default (non-tail) surface.

| token            | value / treatment                                                        |
|------------------|--------------------------------------------------------------------------|
| substrate        | `VisualEffectBackground` (`.hudWindow` or `.underWindowBackground`)      |
| `readabilityVeil`| skin-owned veil over the blur (the existing `tailReadabilityVeil` shape) |
| `canvas` (veil)  | `HUDChrome.canvas` @ ~0.30–0.45 — tune for contrast, this is the floor   |
| edge / meniscus  | brighter, thinner glass hairline: white-ish ~0.5 alpha on top, fade sides|
| grain            | near-zero, or a faint specular smudge instead of paper dots              |
| `glassEffect`    | on macOS 26+, gate Apple `.glassEffect()` behind availability; else the  |
|                  | NSVisualEffectView + veil fallback (see the repo `liquid-glass` skill)   |

## Texture / noise approach

`HUDPaperGrain` (HUDChrome.swift:166) is the template: a **cached static
`NSImage`** generated once, tiled, blended low-opacity. Each skin gets its own
cached static — never regenerate per frame.

- **Paper (default):** stochastic warm dots, `.softLight`, ~4.5%. Keep as-is.
- **Brushed metal (matte):** same dot field but **smeared horizontally** — after
  plotting noise, run a 1×N horizontal box blur (or draw thin horizontal streaks
  of varying luminance) so it reads as directional brushing. Neutral/cool luminance
  (not paper-cream). Blend `.overlay` or `.softLight`, ~6–8%.
- **Glass:** drop tactile grain; optionally one soft off-center specular highlight
  (a single radial gradient) to suggest a caustic, ≤4%.

## Implementation guidance

1. **Skin enum — clone the `HUDTailTreatment` pattern** (HUDTailView.swift:99).
   `enum HUDSkin: String, CaseIterable, Identifiable` with
   `storageKey = "scout.hud.skin.v1"`, `title`, `shortLabel`, `systemName`, `next`.
   Cases in the landed pass: `.current` (default), `.metal`, `.glass`.

2. **`HUDPalette` struct** holds the variable surface tokens + a material/texture
   descriptor (e.g. `material: MaterialRecipe?` where `nil` = solid fill, plus
   `grain` and `edge` style enums). `static func palette(for: HUDSkin) -> HUDPalette`;
   `.broadsheet` returns today's exact values.

3. **Inject through the SwiftUI Environment, or use an observed skin store.** Add an
   `EnvironmentKey` (`\.hudPalette`); at `HUDStatusView` root read
   `@AppStorage(HUDSkin.storageKey)` and `.environment(\.hudPalette, palette)`.
   Static token reads need an explicit invalidator; the landed pass uses
   `HUDSkinState` on the HUD shell and computed `HUDChrome` tokens.

4. **Phased migration (recommended).** `HUDChrome.*` is referenced statically in
   nearly every view; a full migration is a large diff. ~80% of the perceived skin
   difference lives in **three places** — do these first:
   - `HUDStatusView.body` substrate branch (lines ~184–204): solid `canvas` vs
     `VisualEffectBackground` vs cool-canvas+brushed-texture.
   - the edge `strokeBorder` overlay (lines ~261–269) + grain/rim overlays.
   - `OverlayPanelShell`/`HUDController`: the NSPanel is *already*
     `isOpaque=false, backgroundColor=.clear` (lines 169–170) — glass needs **no**
     panel change; the SwiftUI substrate does all the work.
   Token-color re-tints (canvas/border/ink) can follow in a second pass.

5. **The toggle.** Reuse `HUDTailTreatmentToggle` (HUDStatusView.swift:892) — the
   3-segment pill with `systemName` + `shortLabel`, `canvasLift` fill on selected.
   Place it in `defaultMasthead`'s right cluster next to `HUDSizeToggle`
   (line ~372), and/or surface it in the settings view. Persist via `@AppStorage`.

## Pitfalls

- **Static tokens don't re-render.** `HUDChrome` is `static let`; you can't mutate
  it and expect SwiftUI to repaint. Use Environment injection (or an
  `ObservableObject` skin store). Never try to swap statics at runtime.
- **Tail already owns transparency.** `HUDTailAppearance` (blur/tint/idle/active
  opacity + AIRY/BAL/SOLID presets) and `tailReadabilityVeil` exist. The glass
  skin must compose with these, not double-blur/double-veil. Decide precedence:
  when `state.view == .tail`, let the tail surface treatment win (or feed the
  tail's defaults from the skin). This is the highest-risk interaction.
- **Legibility on glass is the #1 failure.** Warm-white ink over a bright desktop
  fails contrast without a veil. Always layer the skin's readability veil; treat
  its opacity floor as a hard constraint, not a taste knob.
- **Modal/field backgrounds go see-through on glass.** `HUDRunnerView` uses
  `canvasAlt.opacity(0.75)` for `TextField`/`TextEditor` and `.background(canvas)`
  for popovers (HUDStatusView.swift:1038). On glass these become unreadable —
  either bump field/popover fills toward opaque per-skin, or simplest & safest:
  keep the Runner overlay **solid regardless of skin** (it's a modal; the
  scrim `canvas.opacity(0.82)` already implies a solid sheet).
- **Don't add `.drawingGroup()`/`.compositingGroup()`.** The substrate comment
  (HUDStatusView.swift:207–209) deliberately avoids them to preserve subpixel
  text; they also break behind-window blur sampling. A material skin must not
  introduce them to "flatten" layers.
- **Matte ink contrast.** Cool graphite ground shifts the warm ink toward muddy —
  verify and lift ink slightly for `.matte`.
- **Appearance is pinned `.darkAqua`** (OverlayPanelShell.swift:141). All three
  skins stay dark; note this pin if a light skin is ever wanted.
- **`glassTop`/`glassBottom` are now palette-resolved.** They were legacy
  near-black solids before the skin pass; if used by `.glass`, keep their glass
  values genuinely translucent/cool instead of reusing the old near-black stops.
- **Cache textures statically.** Follow `HUDPaperGrain`'s static-image pattern for
  the brushed-metal/specular textures; no per-frame regeneration.
