# Adversarial review: extend theme contract beyond color

**Target:** `docs/design/operator-console-harvest.md` §1 (type / radius / texture / bloom as theme axes)  
**Lens:** why this is a bad idea or costs more than it looks  
**Date:** 2026-08-05  
**No code changes** — review only.

---

## Ranked objections

### 1. Native cannot host the contract (severity: critical)

The harvest correctly says the contract must originate on native macOS because
native is source of truth and web follows. That requirement alone sinks §1 as
specified.

**What native themes actually are today:** pure color tables.

```28:42:apps/macos/Sources/Scout/ScoutTheme.swift
struct ScoutThemeColors {
    let bg: Color
    let chrome: Color
    let surface: Color
    let ink: Color
    let muted: Color
    let dim: Color
    let border: Color
    let hairline: Color
    let hairlineStrong: Color
    let accent: Color
    let accentSoft: Color
    let statusOk: Color
    let statusWarn: Color
    let statusError: Color
    let statusInfo: Color
```

`ScoutPalette` re-exports only those colors (`ScoutTheme.swift:418–451`). There
is no type face, no type size, no radius, no texture, no bloom field on the
preset. A theme swap today is `ScoutThemePreset` × `ScoutAccentPalette` color
math — nothing else.

**Typography on native is not a CSS-variable axis.** Hudson's `HudFont` is
hard-wired to system designs at fixed point sizes:

```11:24:/Users/art/dev/hudson/packages/native/apple/HudsonKit/Sources/HudsonUI/Tokens/HudTypography.swift
public enum HudFont {
    public static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
    public static func ui(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .default)
    }
```

```134:147:/Users/art/dev/hudson/packages/native/apple/HudsonKit/Sources/HudsonUI/Tokens/HudTypography.swift
public enum HudTextSize {
    public static var micro: CGFloat { 9 }
    public static var xxs:   CGFloat { 10 }
    // ...
    public static var base:  CGFloat { 13 }
    // ...
    public static var lg:    CGFloat { 16 }
```

Barlow Condensed / Playfair / Instrument / JetBrains Mono as *theme material*
does not express through this API. Every Comms call site is a concrete
`HudFont.ui(HudTextSize.base, …)` / `HudFont.mono(9, …)` invocation — e.g.
`ScoutCommsView.swift:830–854` (title, status, detail, pending-id chip). A
theme cannot rebind those without either (a) forking HudsonKit or (b) wrapping
every font call site in a Scout-level indirection that does not exist.

**Radius is the same story.** Hudson freezes three rungs globally:

```25:29:/Users/art/dev/hudson/packages/native/apple/HudsonKit/Sources/HudsonUI/Tokens/HudSpacing.swift
public enum HudRadius {
    public static var tight:    CGFloat { 3 }
    public static var standard: CGFloat { 6 }
    public static var card:     CGFloat { 8 }
}
```

Comms also bakes a non-token bubble radius:

```52:55:apps/macos/Sources/Scout/ScoutCommsView.swift
    /// Message-bubble corner radius. The Proposal's softer 11pt bubble — rounder
    /// than the 8pt `card` chrome so the turn reads as a speech surface, not a
    /// panel.
    static let bubbleRadius: CGFloat = 11
```

Mission's `0/0` and Unit 47's `8/10` cannot be expressed without replacing
`HudRadius` + every `RoundedRectangle(cornerRadius: HudRadius.standard)` call
(dozens of files) with environment-driven values. That is not "add a CSS var."

**Texture is not one overlay div on macOS.** The mock's cheap mechanism is CSS
`background-image: var(--texture), var(--bloom)`. Native already has a one-off
paper grain, and it is an `NSImage` tile with stochastic draw, not a theme
token:

```182:216:apps/macos/Sources/ScoutHUD/HUDChrome.swift
public struct HUDPaperGrain: View {
    var opacity: Double = 0.045
    static let image: NSImage = { /* 240×240 stochastic dots */ }()
    public var body: some View {
        Image(nsImage: Self.image)
            .resizable(resizingMode: .tile)
            .blendMode(.softLight)
            ...
    }
}
```

Shipping six themed textures + blooms as first-class theme material means
per-theme image assets (or Canvas recipes), compositing policy, and hit-test
discipline across every pane — not a single absolute overlay.

**Parity break is structural:** CSS can rebind faces, sizes, radii, and
background stacks under `[data-theme]`. SwiftUI Scout themes only rebind
`Color`. Declaring "native originates the contract" while the contract axes
only exist cleanly on web makes the proposal incoherent: either web diverges
(violates source-of-truth) or native is rewritten into a CSS-shaped design
system it does not have.

`docs/design/tokens.md:16–17` also freezes HudsonKit: *"Do not modify
HudsonKit… New tokens live web-side only."* Type and radius *are* HudsonKit
globals. Extending them as themes without touching HudsonKit means a parallel
Scout type/radius system fighting Hudson on every surface — the worst outcome.

---

### 2. Fixed geometry + single-line truncation assumes a known instrument
(severity: high)

§1 sells "same markup, genuinely different instrument" with
`--prose-size` swinging ~12.5→16.5px and `--prose` swapping condensed sans /
serif / mono. The product is full of geometry that was tuned for **one** type
instrument.

**Studio rail (the cited consumer).** Rows are single-line ellipsis on a fixed
padding rhythm, not fluid reflow:

```105:149:design/studio/views/comms-one-rail.module.css
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  font-size: var(--text-md);
  ...
}
.rowName {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

`var(--text-md)` is 12px on the locked ladder (`packages/web/client/styles/tokens.css:53`).
Swap in JetBrains Mono at ~12–13px and names die earlier (mono is wider).
Swap in a display serif at 16–17px and the same `padding: 5px 14px` +
`align-items: center` row gets taller, denser glyphs clip against the 16×16
avatar (`comms-one-rail.module.css:129–132`), and the rail that currently
shows ~13 hierarchy rows without scroll starts scrolling in the same frame
height (`min-height: 620px` at `.frame`, line 23–24).

**Load-invariant claim — precise attack.** The arithmetic at
`comms-one-rail.tsx:458–469` is about **structural** row count (13 rows for
162 sessions). Type does not invent more rows. What it **does** invalidate is
the *operational* claim that "the row count barely moves" is enough for
usability: the hierarchy only works if those 13 rows remain visible and
scannable. A 32% larger prose size (12.5→16.5) or a much wider face turns a
no-scroll instrument into a scroll list of the same 13 rows — same structural
invariant, dead as an operator surface. Section 4 of the harvest itself says
the mock has no compression scheme and our rail is load-bearing; §1 then
proposes a material swing that reintroduces scroll pressure without adding
rows.

**Shipped native Comms is worse.** Rows are multi-field `HStack`s with
`lineLimit(1)`, fixed mono `9` pt chips, and fixed vertical padding:

```829:869:apps/macos/Sources/Scout/ScoutCommsView.swift
Text(rowTitle)
    .font(HudFont.ui(HudTextSize.base, weight: isSelected ? .semibold : .medium))
    .lineLimit(1)
...
Text(pendingIdLabel)
    .font(HudFont.mono(9, weight: .semibold))
    .lineLimit(1)
    .fixedSize(horizontal: true, vertical: false)
...
.padding(.vertical, ScoutCommsMetrics.listRowVerticalPadding)
```

Channel rows repeat the pattern with session-id chips at mono 9
(`ScoutCommsView.swift:1070–1104`). A theme that rebinds body type but leaves
`mono(9)` and `HudSpacing.md` padding creates mixed-scale rows; a theme that
scales everything collides with `frame(height: 24)` on the New button
(`ScoutCommsView.swift:744`) and `HudLayout.fieldHeight` (36) on filters
(`ScoutCommsView.swift:802`).

**Reading measure is a closed world at ~13pt:**

```32:44:apps/macos/Sources/Scout/ScoutCommsView.swift
    /// 64ch at the ~13pt body font is ≈ 600pt; we keep the bubble's 840pt hard cap
    static let messageReadingMeasure: CGFloat = 600
    ...
    static let collapsedTurnMaxHeight: CGFloat = 220
```

If Mission sets prose to 16.5px, 64ch is no longer ~600pt, collapsed turns show
fewer lines of meaning inside 220pt, and the "comfortable line length" comment
is a lie for every non-base theme.

**Web chrome is the same class of bug.** Status bar locked to 28px against
root type assumptions:

```124:129:packages/web/client/app.css
/* Hudson's StatusBar uses Tailwind `h-7` (1.75rem), but our root font-size is
 * 13px (--hud-text-base), so h-7 resolves to ~22.75px — short of the
 * documented `SHELL_THEME.layout.statusBarHeight: 28`. Lock to 28px ... */
[data-scout-theme] [data-frame-panel="status-bar"] {
  height: 28px;
}
```

Badge line-height is a hand-tuned literal for the current mono size
(`app.css:2762`: `line-height: 16px /* tuned line-height for badge */`).
Inbox rows force `min-height: 56px` (`app.css:3345`) while activity titles use
`-webkit-line-clamp: 2` (`app.css:1746–1749`). None of these survive a
prose-family + size swing without a second pass of geometry.

**Family swap breaks ops semantics, not just layout.** The product leans hard
on mono for ids, timestamps, counts, and eyebrows (`app.css` alone has dozens
of `font-family: var(--font-mono)` / `--hud-font-mono` sites; Comms mono chips
above). Unit 47's "prose is JetBrains Mono" either (a) collapses the
prose/chrome distinction the app uses for scan hierarchy, or (b) requires a
third face axis so mono chrome stays mono while "prose mono" is something
else — at which point the mock's simple `--prose` token is a fiction.

---

### 3. Per-theme `--prose-size` is at war with the fixed type ladder
(severity: high)

The house contract is explicit and recent:

```38:40:docs/design/tokens.md
### Font size — `--text-*` (whole pixels only — no 9.5/10.5/11.5/12.5)
`3xs=8, 2xs=9, xs=10, sm=11, md=12, lg=13, xl=14, 2xl=15, 3xl=17, ...`
```

```44:48:packages/web/client/styles/tokens.css
  /* Whole pixels only — fractional 9.5/10.5/11.5/12.5 sizes are retired. */
  --text-3xs: 8px;
  ...
  --text-md: 12px;
  --text-lg: 13px; /* matches --hud-text-base */
```

And the scales are **theme-independent by design**:

```5:7:packages/web/client/styles/tokens.css
 * These scales are theme-INDEPENDENT (a pixel is a pixel in
 * dark or light), so they live in :root rather than the [data-scout-theme]
 * wrapper.
```

The mock's material claim *is* the banned rungs (12.5 / 15.5 / 16.5) as theme
identity. The harvest's own caveat says any port snaps to `--text-*`. After
snap:

| Mock | Snap (ties down per tokens.md:123–125) | Differentiation left |
|---|---|---|
| 12.5 | 12 (`--text-md`) | same as current rail body |
| 15.5 | 15 (`--text-2xl`) | one step above body |
| 16.5 | 17 (`--text-3xl`) or 15 if ties-down from 16 | display-adjacent |

So you either:

- **Keep the ladder** → themes no longer feel like different instruments; you
  paid for a type axis and got ±1 rung of body size; or
- **Allow per-theme off-scale `--prose-size`** → re-legalizes the fractional
  ladder the token migration just retired, and every consumer that snapped to
  `--text-*` is wrong again for themed surfaces.

Both cannot be first-class. `Provider.tsx` already pins the *same* sans/mono/
serif stacks in both DARK and LIGHT (`Provider.tsx:219–221` and `258–261`);
theme today is color only, deliberately. §1 is not "extend the contract" — it
is "reverse the theme-independent type decision."

Hudson native reinforces the same wall: `HudTextSize` is a fixed public API
with no per-preset override path. A Scout-only `--prose-size` on web that
native cannot mirror is another parity lie.

---

### 4. Cost is not "add tokens" — it is N themes × 4 axes × three clients
(severity: high)

**Status quo (color-only):**

| Surface | Theme surface area |
|---|---|
| Native | `ScoutThemeColors` (~15 colors) × 5 presets × light/dark (+ accent palette) — `ScoutTheme.swift:141–390` |
| Web | `DARK_THEME_VARS` / `LIGHT_THEME_VARS` color maps — `Provider.tsx:180–262` |
| Scales | One shared `:root` ladder — `tokens.css` |

New theme ≈ fill another color table. Geometry and type stay put. QA is two
appearances × accents.

**Proposed (type + radius + texture + bloom):**

Rough touch inventory (counts from this tree, not aspirational):

| Area | Files already encoding type or radius |
|---|---|
| `packages/web/client` CSS with `font-size` | ~88 |
| `packages/web/client` CSS with `border-radius` | ~89 |
| `apps/macos/Sources` Swift with `HudFont` / `cornerRadius` / `HudTextSize` / `HudRadius` | ~55 |
| `apps/ios` Swift same pattern | ~28 |
| `design/studio` CSS/TSX | ~68 |

Plus HudsonKit itself (external, "do not modify") for any true shared type/radius
origin.

Blunt ship estimate for a *real* (native-origin, web-following, six material
themes) port:

- **Foundation:** ScoutTheme material model, font registration (custom faces on
  macOS/iOS), environment/theme object for type+radius, texture asset pipeline,
  web CSS variable rebinding, studio parity — **~15–25 files**, multi-package.
- **Consumer migration:** most of the ~200 files above need audit; many need
  changes where size/radius/face are literals (`mono(9)`, `bubbleRadius = 11`,
  `line-height: 16px`, fixed `frame(height:)`, reading measure 600). Call it
  **80–150 files** touched if done honestly; **200+** if iOS + studio + docs
  count.
- **QA matrix:** status quo ≈ 2 modes × accents. Proposed ≈ N material themes
  × light/dark × 3 clients × key surfaces (Comms rail, thread, composer,
  status bar, sidebar). At N=6 that is roughly an order of magnitude more
  visual states. Truncation and density bugs only show under specific
  face×size pairs (serif at 17 in a mono-tuned chip row).

**Ongoing tax:** every new row, chip, or panel must be correct under the full
matrix. Color-only regressions are "wrong green." Material regressions are
"Mission clips the session id; Unit 47 double-wraps the ask card; Porcelain
overflows the 28px status bar." That tax does not go to zero after the first
port; it is permanent product surface area.

Texture/bloom specifically: cheap on a static mock (one absolute div). In
product, every scrollable pane, every frosted turn (`harvest` §4 already
rejects full frost), every native material/vibrancy window, and reduced-motion
/ performance budgets all become theme concerns. The harvest's open call #2
already half-admits this ("texture on at most one theme, off by default") —
which is an admission that three of the four new axes are optional decoration,
not a contract.

---

### 5. The mechanism that *is* cheap is not the contract that is claimed
(severity: medium)

The harvest's best technical idea is the non-interactive overlay
(`harvest.md:40–44`). That can be a *single optional skin*, marketing-only or
one preset, without inventing `--prose` / `--r-sm` / per-theme type ladders.

§1 bundles that cheap overlay with the expensive claim that themes are
different *instruments* (type + radius). Those are different proposals:

- Overlay texture/bloom → additive, skippable, mostly CSS, native analogue
  already exists as `HUDPaperGrain`.
- Material type+radius themes → rewrite of the design system, native source of
  truth, ladder conflict, geometry audit.

Selling them as one "theme contract extension" launders the expensive half
behind the cheap half. If the real desire is richer skins, ship optional
texture on one preset. If the real desire is six instruments, budget a design-
system rewrite — do not pretend it is four CSS variables on `[data-theme]`.

---

## Would I ship it?

No — not as a product theme contract. Keep themes color-only; if anything
lands, land optional texture/bloom as a single non-default skin, and leave
type + radius on the fixed theme-independent ladder.
