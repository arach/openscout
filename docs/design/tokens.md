# Scout Web — Design Tokens & Primitives

The "middle layer" between HudsonKit's `--hud-*` theme primitives and component
CSS. It exists so components stop improvising pixel values, colors, and
near-duplicate chips/buttons. Source files:

- `packages/web/client/styles/tokens.css` — theme-independent scales (`:root`)
- `packages/web/client/styles/primitives.css` — `.label-*` / `.chip` / `.dot` / `.btn` / `.surface-card`
- `packages/web/client/scout/Provider.tsx` — theme-varying semantic colors (DARK/LIGHT)
- `packages/web/client/app.css` — HudsonKit alias layer (`--bg`, `--accent`, …)

Both files are imported at the **top of `main.tsx`**, before `arc-tailwind.css`
and `app.css`, so primitives load before per-component CSS (which is imported
per-`.tsx`). That ordering lets component CSS win as a contextual override.

> **Do not modify HudsonKit.** It's a shared external package (iOS/macOS depend
> on it). New tokens live web-side only.

---

## Scales (t-shirt naming, anchored xs=6 / sm=8 / lg=12)

### Spacing — `--space-*` (padding / margin / gap only)
| token | px | | token | px |
|---|---|---|---|---|
| `--space-3xs` | 2 | | `--space-2xl` | 16 |
| `--space-2xs` | 4 | | `--space-3xl` | 20 |
| `--space-xs` | 6 | | `--space-4xl` | 24 |
| `--space-sm` | 8 | | `--space-5xl` | 32 |
| `--space-md` | 10 | | `--space-6xl` | 40 |
| `--space-lg` | 12 | | `--space-7xl` | 48 |
| `--space-xl` | 14 | | `--space-8xl` | 64 |

### Radius — `--radius-*`
`xs=2, sm=4, md=6, lg=8, xl=12, 2xl=16, pill=999px`. `--radius` (=`--hud-radius`)
stays the default for HudsonKit chrome.

### Font size — `--text-*` (whole pixels only — no 9.5/10.5/11.5/12.5)
`2xs=9, xs=10, sm=11, md=12, lg=13, xl=14, 2xl=16, 3xl=18, 4xl=20, 5xl=24`

### Tracking — `--tracking-*` (letter-spacing)
`xs=0.02em, sm=0.04em, md=0.08em, lg=0.12em, xl=0.18em`

### Leading — `--leading-*` (line-height)
`none=1, tight=1.35, snug=1.45, normal=1.5`

### Layout constants (NOT spacing — never snap these)
`--statusbar-h: 28px` (Hudson `SHELL_THEME.layout.statusBarHeight` + `bottom:28`
offsets), `--sidebar-w: 280px` (in `app.css`).

---

## Semantic colors

Existing (via `app.css` aliases of `--hud-*`): `--bg --surface --ink --muted
--dim --border --accent --accent-soft --green --amber --red --radius
--shadow-soft --focus-ring`. Scout chrome (in `Provider.tsx`):
`--scout-chrome-avatar-ink` (avatar text — theme-aware), `--scout-chrome-hover`
/ `--scout-chrome-active` (ink tints), `--scout-chrome-ink-*` (ink layers).

New (in `Provider.tsx`, both themes):
| token | use |
|---|---|
| `--scrim` / `--scrim-soft` | modal / popover backdrops |
| `--info` | ops/tail blue highlight (scope: `ops-tail.css`, `ops-atop.css`) |
| `--shadow-card` / `--shadow-card-hover` | theme-aware card shadow |
| `--cat-gold` / `--cat-purple` / `--cat-sky` | categorical/brand accents (briefings gold, ops purple, mesh sky) |

### Color routing (raw literal → token)
`#4ade80`→`--green` · `#f59e0b`/`#d97706`/`#ffae42` *(status)*→`--amber` ·
`#16a34a`→`--green` · `#dc2626`→`--red` · `gold`/`crimson` keywords→`--amber`/`--red` ·
`#888`/`#9aa1ab`/`#6b727d`/`#ddd`→`--muted`/`--dim` ·
`rgba(255,255,255,.06/.08)`→`--scout-chrome-hover`/`--scout-chrome-active` ·
avatar text `rgba(0,0,0,.65/.7)`→`--scout-chrome-avatar-ink` ·
modal/scrim `rgba(0,0,0,.32/.45)`→`--scrim`/`--scrim-soft`.

**Do not blanket-route:**
- `var(--accent, #62b6ff)` fallbacks are already routed — leave them.
- Brand/categorical colors are **not** status: briefings gold `#d7a978`, ops
  purple `#c58cff`, mesh sky `#38bdf8` → `--cat-*`, not `--amber`. Routing them
  to status would flatten distinct styling.

---

## Snapping table (off-grid → token) — TWO biases

Round **up** for interactive padding (preserve touch targets); **to-nearest**
(ties down) for layout gaps/margins.

| raw | interactive padding → | layout gap/margin → |
|----|----|----|
| 3  | `2xs` (4)  | `3xs` (2) |
| 5  | `xs` (6)   | `2xs` (4) |
| 7  | `sm` (8)   | `sm` (8)  |
| 9  | `md` (10)  | `sm` (8)  |
| 11 | `lg` (12)  | `md` (10) |
| 18 | `3xl` (20) | `2xl` (16)|
| 22 | `4xl` (24) | `4xl` (24)|

Type snapping: fractional sizes → nearest `--text-*` (9.5→9, 10.5→11, 11.5→11,
12.5→12, 15→16). Letter-spacing → nearest `--tracking-*` (0.06→0.04 or 0.08,
0.1→0.08, 0.14→0.12, 0.16→0.18); sub-0.02em optical values may stay literal.
Line-height → nearest `--leading-*` (ties → snug).

### Properties to tokenize vs leave literal
**Tokenize:** `padding`, `margin`, `gap` (incl. 2-value `gap: 8px 12px`),
`border-radius`, `font-size`, `letter-spacing`, `line-height`.
**Leave literal:** `width`/`height`/`min`/`max-*`, `border-width`,
`inset`/`top`/`left`/`right`/`bottom`, `transform`, `box-shadow` geometry,
`backdrop-filter`/`blur()`, `flex-basis`, `grid-template-columns`/`-rows`
tracks, and `border-radius: 50%` (circles). Plus the layout constants.

---

## Primitives

Compose a base class + tone + modifiers.

### `.label-*` — uppercase-mono eyebrows
`.label-xs` (9/.18em) · `.label-sm` (10/.08em) · `.label-md` (11/.12em) ·
`.label-lg` (11/.18em). All `font-mono`, uppercase, `leading-none`, weight 600.
Pair with a color (`--muted`/`--dim`). For new code, use these instead of
hand-rolling `font-family/size/letter-spacing/text-transform`.

### `.chip` — status / label chips
Default = bordered, sans, weight 600 (was `.sys-chip`).
Tones: `--neutral --working --success --warning --danger --info`.
Mods: `--pill` (full radius), `--sm`, `--ghost` (no border/bg),
`--mono` (mono family), `--caps` (uppercase + tracking).
- `.sys-chip` → `.chip .chip--<tone>`
- `.s-pill` → `.chip .chip--pill .chip--mono .chip--caps .chip--<tone>`
- `.agent-card-cap` → `.chip .chip--mono .chip--ghost .chip--neutral`

### `.dot` — presence / status
Tone sets `color`; fill is `currentColor` so `--glow` echoes it.
Tones: `--neutral --success --working --warning --danger --info`.
Mods: `--sm` (5px) / `--lg` (7px), `--pulse`, `--glow`,
`--ring` (2px ring; parent sets `--dot-ring`).

### `.btn` — buttons
Default = neutral/secondary (was `.s-btn`). Inherits the global `:focus-visible`
ring (`app.css`) — don't strip outline without restoring it.
Variants: `--primary` (ink), `--accent` (accent CTA), `--ghost`, `--danger`.
Sizes: `--sm`, `--lg`, `--icon`. Family: `--mono` (uppercase-mono, e.g. the
fleet / nav-action buttons).

### `.surface-card` — content surfaces
Default = `.sys-panel`-style. Mods: `--stat`, `--inset`, `--accent` (left rail).

### Explicit exclusions (keep specialized, just token-source values)
- `.agent-card` / `.s-scoutbot-popover` — glass/blur, bespoke shadows.
- `.s-scoutbot-chip` — fixed-height stateful status widget, not a label chip.
- `.fleet-pill` — equal-fill segmented-control toggle (`flex: 1 1 0`).
- Bespoke component internals (e.g. `agent-card-*`) — tokenize in place; only
  swap to a primitive when it's a clean 1:1.

---

## Migration order

Foundation (done) → primitives (done) → per-file value tokenization, ordered by
independence: `components/*.css` → `scout/slots/*.css` → `screens/*.css` →
**`app.css` last** (shared base; ripples everywhere). Each file is one
self-contained pass: tokenize values, route colors, swap clean primitive
duplicates (+ delete the old class in the same change — no coexistence window).
Then the inline-style pass in `.tsx`.

## Verify
- `npm --prefix packages/web run build:client` (vite build = the TS+CSS gate).
- Run `npm --prefix packages/web run dev:client` → `http://127.0.0.1:43122`;
  check **dark and light**. Light mode is the main risk: avatar text visible,
  card shadows not too heavy, scrim present, eyebrows consistent, status bar 28px.

## Out of scope (follow-ups)
Reconcile Tailwind spacing utilities (`gap-2`≈6.5px at 13px root) to the scale;
a lint/CI guard against new raw values; tokenize border-width/shadow geometry.
