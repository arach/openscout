# Scout Web — Navigation Chrome Study

Status: design study (analysis + mockups only — no production code touched)
Scope: `packages/web` app chrome under the `nav.sidebar` flag (SCO-083 → SCO-087)
Companion mockups: [`design/navigation-study/`](../../design/navigation-study/) — open `index.html`
Grounded in: `OpenScoutAppShell.tsx`, `scout/sidebar/*`, `components/RailToggle.tsx`,
`components/ui/sidebar.tsx`, `app.css`, and specs `docs/eng/sco-083..087`.

This study inventories the current chrome to the pixel, distills the principles the
user has been driving toward across SCO-086/087, and lays out three arrangement
options with a recommendation and a migration delta. It does **not** change code.

---

## 1. Reference frame

All measurements below use a **web** viewport (`titleBarInset = 0`, so
`chromeTopOffset = 0`) at **1280 × 800** unless noted. On macOS the whole
column set shifts down by `titleBarInset`; nothing else changes.

### Constants (source of truth)

| Constant | Value | Source |
|---|---|---|
| `SIDEBAR_TOP_ROW_HEIGHT` | **40px** | `OpenScoutAppShell.tsx:85` |
| `RAIL_HEADER_HEIGHT` (panel header band) | **44px** | `:89` |
| `RAIL_TOGGLE_HEIGHT` / width | **28px / 22px** | `:87`, `app.css:389` |
| `RAIL_TOGGLE_HEADER_TOP` = round((44−28)/2) | **8px** | `:91` |
| `RAIL_COLLAPSED_WIDTH` (shared, all rails) | **48px** | `sidebar-collapse-state.ts:7` |
| `SIDEBAR_EXPANDED_WIDTH` (default / reset) | **260px** | `:13` |
| `SIDEBAR_MIN_WIDTH` / `MAX` | **200 / 360px** | `:14–15` |
| `SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH` | **1023px** | `:16` |
| `SIDE_PANEL_MIN_WIDTH` (side rail + inspector) | **240px** | `OpenScoutAppShell.tsx:70` |
| side-rail default width (`leftWidth`) | **260px** | `:359` |
| inspector default width (`rightWidth`) | **280px** | `:360` |
| inspector max | `min(900, max(500, ⌊0.45·vw⌋))` | `:105–110` |
| StatusBar height (content `bottom`) | **28px** | `app.css:128`, `:572` |
| `contentTopOffset` = `chromeTopOffset + 40` | **40px (web)** | `:334` |
| `railToggleTop` = `contentTopOffset + 8` | **48px (web)** | `:335` |

### Palette (dark, `scout/Provider.tsx` DARK)

```
--hud-bg      oklch(0.132 0.004 260)   near-black, faint blue
--hud-surface oklch(0.178 0.005 260)   panel surface
--hud-ink     oklch(0.965 0.006 260)   near-white
--hud-muted   oklch(0.72 0.008 260)
--hud-dim     oklch(0.57 0.007 260)
--hud-border  oklch(0.965 0.006 260 / 0.04)   hairline
--hud-accent  oklch(0.86 0.17 125)     the single green accent
--hud-status-ok oklch(0.80 0.15 155)   emerald (broker dot)
font-mono     JetBrains Mono
```

---

## 2. Current-state inventory (shipped SCO-087)

### 2.1 The seven chrome pieces

1. **Nav sidebar** — shadcn `Sidebar` (`ScoutSidebar.tsx`), full window height, left edge.
   Pure navigation: brand strip (static logo → Home), `Navigate` group (Home, Projects,
   Sessions, Chat, Dispatch, Search), `System` group (Ops, Settings), footer = broker
   status line only. Default presentation is the **48px icon rail**; expands to a
   drag-resizable **200–360px** (default 260). Active item = left inset bar
   `inset 2px 0 0 accent` + `bg sidebar-accent`.
2. **Side rail** — a **separate LEFT HudsonKit `SidePanel`** (`ScoutSideRail.tsx`) that
   sits *to the right of* the nav sidebar (`left: navRailWidth`). Holds per-area **context
   content** (`resolveSidebarContext(route)`). Collapses to a 48px `CollapsedRail`; HIDDEN
   (0px) on routes with no context (e.g. Settings, Search landing).
3. **Top row** — a fixed app-wide bar (`CenterPaneHeader variant="top-row"` inside
   `.scout-top-row-frame`), `left: sidebarWidth`, `right: 0`, `top: 0`, **height 40**.
   Left→right: breadcrumb · area sub-nav · Ops/Chat secondary strip · then machine scope +
   settings + ⌘K (`TopRowUtilities`). Owns the top drag region.
4. **Right inspector** — a RIGHT HudsonKit `SidePanel`, default 280px, collapses to a 48px
   `CollapsedRail`, HIDDEN on scope/overlay/dispatch-sheet.
5. **Edge chevrons** — one shared `RailToggle` (`‹`/`›`, 22×28) per rail, on the rail's
   boundary line at the shared band `y = 48`. Sidebar chevron is shell-rendered so it rides
   the ghost edge during resize.
6. **Sidebar resize handle** — 6px hit strip at `left: sidebarWidth − 3`, `top: 84`
   (below the header band so it never collides with the chevron), `z 50`.
7. **Status bar** — full-width, 28px, bottom (active-agents · mesh · scoutbot / build).

### 2.2 Vertical bands (web, all states)

| Band | y-range | Occupant |
|---|---|---|
| Brand strip | 0 – ~56 | Sidebar header (logo, `paddingTop 8`) — sidebar only |
| Top row | 0 – 40 | Top row, from `sidebarWidth` → right edge |
| Chevron band | 48 – 76 | All three edge chevrons (centered in the 44px header band) |
| Resize handle | 84 – (H−28) | Sidebar drag strip |
| Content columns | 40 – (H−28) | Side rail · center pane · inspector |
| Status bar | (H−28) – H | Full width |

Note the **8px vertical seam**: the chevron band (`y 48`) sits one row *below* the top row
(`y 0–40`) by design — it keeps the collapsed-inspector chevron from colliding with the
top-row utilities on the right (SCO-087 report §Problem 2, gap #3).

### 2.3 Horizontal bands — the four collapse combinations (vw = 1280)

Left chrome = nav sidebar (48 | 260) + side rail (0 hidden | 48 collapsed | 260 expanded).
Inspector is independent (0 | 48 | 280).

| # | sidebar / side-rail / inspector | Sidebar | Side rail | Center pane (width) | Inspector | Chevrons @ x (y=48) |
|---|---|---|---|---|---|---|
| 1 | **260 / 260 / 280** (all expanded) | 0–260 | 260–520 | 520–1000 (**480**) | 1000–1280 | 260 · 520 · 1000 |
| 2 | **48 / 260 / 280** | 0–48 | 48–308 | 308–1000 (**692**) | 1000–1280 | 48 · 308 · 1000 |
| 3 | **260 / 48 / 280** | 0–260 | 260–308 | 308–1000 (**692**) | 1000–1280 | 260 · 308 · 1000 |
| 4 | **48 / 48 / 48** (all collapsed) | 0–48 | 48–96 | 96–1232 (**1136**) | 1232–1280 | 48 · 96 · 1232 |
| — | **48 / 0 / 0** (Settings; no context, no inspector) | 0–48 | — | 48–1280 (**1232**) | — | 48 |

Insets commit in a **single write** on toggle/resize (`contentStyle`, SCO-087 Problem 3):
the center pane carries no `left/right` transition, so a heavy page (`/ops/lanes`,
`/sessions`) reflows at most once per toggle. During drag-resize the committed width is
pinned and a 2px accent **ghost line** previews the target; width commits on pointer-up.

### 2.4 Frictions the current arrangement carries

- **F1 · The double rail.** State #4 puts two adjacent 48px strips on the left
  (nav icon rail `0–48` + collapsed side rail `48–96`) — 96px of near-identical vertical
  chrome, two boundary chevrons 48px apart. It reads as "two sidebars," blurring the
  pure-nav vs. context separation the user just enforced.
- **F2 · Chevron / top-row seam.** The chevron band is 8px *below* the 40px top row, so the
  top-left region has three stacked horizontals in 76px (brand row, top row, chevron band).
  Deliberate (collision avoidance) but busy.
- **F3 · Brand vs. top row corner.** The logo lives in the sidebar header at `y 0`; the top
  row starts to its right at `y 0`. When the sidebar collapses to 48px the brand shrinks to
  a bare mark while the top row's left edge jumps left — the top-left "masthead" moment is
  split between two owners.
- **F4 · Two panel systems on the left.** Nav sidebar is shadcn; side rail is HudsonKit
  `SidePanel`. Correct architecturally (SCO-086), but they animate and resize on different
  code paths, and only the sidebar drag-resize got the ghost-edge treatment (side-rail resize
  still updates width live — SCO-087 gap #4).

---

## 3. Principles (distilled from the user's directives, SCO-086/087)

1. **Pure-nav sidebar.** The sidebar holds destinations, scope items, and broker status —
   nothing else. Context content never returns to it. *(ScoutSidebar header comment, SCO-086 Req 7)*
2. **One expand/collapse affordance, everywhere.** A single edge chevron on each rail's
   boundary line, same control / same band / same behavior for sidebar, side rail, inspector.
   No logo-toggle, no footer/brand-row triggers. *(SCO-086 directive 1)*
3. **Consistent minimized widths.** Every collapsed rail is the same width (48px). *(directive 3)*
4. **Static logo.** Scout mark + name, top-left, click → Home, never a toggle. *(directive 2)*
5. **Drag-resize with memory.** Expanded sidebar drags 200–360 (default 260), persisted,
   double-click resets. *(directive 4)*
6. **The top row stays a top row.** A slim horizontal band owns page title/breadcrumb +
   page-level secondary nav + machine scope + utilities — consolidated, not duplicated.
   *(SCO-087 Problem 1)*
7. **Context belongs to the side rail.** Per-area context lives in the side rail — not the
   sidebar, not the top row. *(SCO-086 Req 7)*
8. **Heavy pages must not relayout on rail motion.** Commit insets once; animate only
   compositor properties (transform/opacity); respect reduced-motion. *(SCO-087 Problem 3)*

A ninth, implicit from the memory log and the annotated mock: **editorial restraint** —
one green accent, hairline dividers, mono chrome, no categorical color, no unbacked
affordances. Signal by contrast, not by adding.

---

## 4. Arrangement options

Three options, ordered from smallest to largest structural delta. Each keeps all eight
principles; they differ in **where the top-left corner belongs** and **how the two left
rails relate**.

### Option A — "Anchored L" *(recommended; the annotated-mock direction)*

**Concept.** Keep the shipped structure — full-height sidebar owning the top-left, top row
inset to the content columns — but apply the editorial discipline of the user's annotated
mock so the pieces read as one system. The name: the vertical sidebar and the horizontal
status bar form an **L** that frames content; the top row is the third, quiet arm.

**Layout (unchanged from shipped):** sidebar full-height at left; top row `left: sidebarWidth`,
`right: 0`, `y 0–40`; side rail beside the sidebar; inspector at right; all three chevrons on
the `y 48` band. What changes is *discipline*, not geometry.

**Refinements over the shipped state:**
- **Top row as one reading line.** Breadcrumb (mono 11px/600/0.04em, `ink-soft`) · thin
  vertical hairline · secondary nav in the title area (mono 10px/600/0.06em uppercase, active =
  `inset 0 -2px accent`) · flex spacer · machine scope + Settings + ⌘K right-grouped. Height
  **40**, padding `0 12 0 14`, background `surface 92% / bg`. (This is already the top-row
  contract — the study just fixes the *rhythm*: consistent 12px gaps, one hairline divider
  between breadcrumb and sub-nav, utilities as 26px ghost buttons.)
- **Soften the double rail (F1).** When both left rails are collapsed, drop the border
  *between* them and tint the collapsed side rail one step darker than the icon rail
  (`surface 96%` vs sidebar `surface 96%` → side rail `bg 82%`), so 0–48 reads as "nav" and
  48–96 reads as "context handle," not two identical strips. Keep the single outer boundary +
  the two chevrons (they mark two independently-collapsible things — honest).
- **One accent.** The only saturated color anywhere in the chrome is the green: active nav
  bar, active sub-nav underline, focus ring, broker OK dot, ghost resize line. Everything else
  is ink at 48–92% opacity.
- **Chevron band = the header line.** All three chevrons centered on their boundary at `y 48`,
  22×28, hairline border, `surface 92%` — exactly as the mock draws them.

**Type & spacing spec:** brand 11px/700/0.08em uppercase; nav items 11px/500/0.02em, 16px
icons, 32px rows; group labels 9px/0.12em uppercase; broker line 10px/600/0.04em uppercase +
6px dot. Column min-widths: side rail 240, inspector 240. Hairlines `ink 6–8%`.

**Tradeoffs.**
- 👍 Smallest delta — the shipped code already has this structure; the change is CSS/token
  polish, low risk, ships fast. Matches exactly where the user has been steering.
- 👍 Keeps the liked full-height sidebar + top-left logo (SCO-087 explicitly kept it).
- 👎 Does not *resolve* the double rail (F1) — only softens it. The top-left still stacks
  three horizontals in 76px (F2/F3 persist, quieted).

---

### Option B — "Full-width Mast"

**Concept.** Make the top row a **true full-width masthead** across the entire viewport
(`top 0`, `left 0`, `right 0`, height **44**). The sidebar, side rail, inspector, and center
all start *below* it (`top: 44`). The logo moves into the mast's left corner. This is the most
literal reading of "the top row remains a top row" — one horizontal band that spans
everything, the way most web apps (GitHub, Slack, Linear-web) frame the app.

**Layout (vw 1280):**

| Piece | Rect |
|---|---|
| Mast | `x 0–1280`, `y 0–44` — logo (left) · breadcrumb · sub-nav · spacer · machine scope + Settings + ⌘K (right) |
| Sidebar | `x 0–48`(rail)/`0–260`(exp), `y 44 → H−28` |
| Side rail | `x 48/260 → +width`, `y 44 → H−28` |
| Center | between side rail and inspector, `y 44 → H−28` |
| Inspector | right, `y 44 → H−28` |
| Status bar | `x 0–1280`, `y H−28 → H` |

Chevrons move to the new header band `y = 44 + 8 = 52`; the mast is the drag region (whole
top edge, obvious). The sidebar becomes a pure vertical nav column with **no brand strip** —
its first row is the top nav item, so it gains ~56px of vertical space.

**Type & spacing:** mast 44px, logo mark 18px + name 11px/700/0.08em; a **12px vertical
hairline** separates logo from breadcrumb so the corner reads as "brand, then page." Nav
column and rails identical to Option A below the mast.

**Tradeoffs.**
- 👍 The cleanest answer to principle 6 — an unambiguous, full-width top row; the drag region
  is the entire top edge; brand + machine scope + utilities live on one horizontal, no split
  corner (fixes F3).
- 👍 Sidebar collapse no longer strands a shrinking logo; the mast is the fixed frame.
- 👍 Fixes F2: only two horizontals in the top-left (mast, then the column header band).
- 👎 **Sacrifices the liked full-height sidebar + logo-in-sidebar**, which SCO-087 kept on
  purpose. This is a real reversal of a stated preference — needs the user's explicit sign-off.
- 👎 More horizontal chrome (44px mast + 28px status = 72px of permanent horizontal bands).
- 👎 Larger delta: `contentTopOffset` becomes `mastHeight` for the sidebar *too*; the sidebar
  loses its `SidebarHeader`; every column's `top` changes. Still contained, but structural.
- ⚠️ Does not by itself resolve the double rail (F1) — orthogonal to it.

---

### Option C — "Telescoping Rail" *(most ambitious)*

**Concept.** Attack the double rail (F1) directly. When the nav sidebar and the side rail are
both present, treat the left as **one continuous region with an internal seam**, not two
bordered panels. Collapsed, they *telescope* into a **single 48px rail** that hosts both the
area icons and a context handle; the context content flies out as a second column on demand.

**Layout:**
- **Expanded:** nav sidebar (48 icon or 200–360) **+** side rail as one panel with a single
  1px internal seam (no doubled border, no gap). One outer boundary, one chevron for the pair;
  a second, smaller handle on the internal seam toggles just the context column.
- **Collapsed:** a single **48px** rail. Top: the 8 area icons (the nav rail). Below a hairline:
  a `⊟` context handle that opens the side rail as an **overlay flyout** (`left: 48`) rather
  than pushing a second 48px strip. Left chrome collapsed = **48px, not 96**.
- Top row: identical to Option A (inset to `sidebarWidth`), or to B (full-width) — composable
  with either.

**Type & spacing:** internal seam `ink 6%`, 1px; the context flyout carries a `18px 0 48px`
shadow (reusing `panelOverlayStyle`) so it reads as "over," not "beside." Icons and rows
identical to A.

**Tradeoffs.**
- 👍 Kills F1 entirely — collapsed left chrome is one honest 48px rail; most space-efficient on
  heavy pages; strongest "one system" feel.
- 👍 Composable with A or B for the top row.
- 👎 Highest implementation risk: merges the visual treatment of two separate component systems
  (shadcn sidebar + HudsonKit SidePanel) that SCO-086 deliberately kept apart — the seam must
  be faked in CSS without merging components.
- 👎 Introduces a **mode** (context-as-flyout) — a new interaction the user hasn't asked for,
  and flyouts can feel less permanent than a pushed column for content you keep referring to.
- 👎 Slightly blurs principle 7's crispness (context is still the side rail, but now sometimes
  an overlay).

---

## 5. Recommendation

**Ship Option A now; hold B and C as explicit forks for the user to choose.**

Reasoning:
- **A *is* the annotated-mock direction** and the destination the user has been steering toward
  since SCO-086. It keeps every stated preference (full-height sidebar, top-left logo, top row,
  one chevron, one accent) and its delta is polish, not restructure — lowest risk, fastest, and
  it makes the existing chrome read as one system.
- **B is the strongest *idea*** if the user is willing to give up the full-height sidebar for a
  true full-width masthead. That is a genuine preference reversal (SCO-087 kept the sidebar
  full-height on purpose), so it must not be adopted silently — it is a **decision to put to the
  user**, which is exactly what the mockups are for.
- **C is the right answer to the one real structural wart (the double rail)** but spends the most
  implementation risk and adds a mode. Best sequenced *after* A lands, as a follow-up if the
  double rail keeps bothering the user in daily use — and it can layer on top of either A or B.

Put concretely: **A is the safe, on-brief default; B is the "do we want a masthead?" question;
C is the "do we want to kill the double rail?" question.** The mockups let the user feel all
three before committing.

---

## 6. Migration delta

### Option A (recommended)
Structure is already shipped (SCO-087). Delta is **editorial CSS + tokens**, no geometry, no
state model:
- `app.css` — top-row rhythm (consistent 12px gaps, one breadcrumb↔sub-nav hairline); collapsed
  side-rail tint one step off the icon rail + drop the inter-rail border (F1 softening);
  audit every chrome color down to the single accent.
- No changes to `OpenScoutAppShell.tsx` geometry, `useSidebarCollapse`, routing, or the flag.
- Risk: low. Verifiable by the SCO-087 visual matrix (8 areas × rail states) with no behavior
  change.

### Option B (masthead — needs sign-off)
- `OpenScoutAppShell.tsx`: top-row wrapper → `left: 0, right: 0, height: 44`; `chromeTopOffset`
  for the **sidebar** becomes `mastHeight` (sidebar no longer starts at window top);
  `contentTopOffset = mastHeight`; `railToggleTop = mastHeight + 8`.
- `ScoutSidebar.tsx`: remove `SidebarHeader` brand strip; move logo into `TopRowUtilities`' left
  (or a new mast-left slot); footer/broker unchanged.
- Drag region moves entirely to the mast (simplifies the current merged-style dance).
- Legacy `?ff.nav.sidebar=off` path untouched (it already has its own full-width `ScoutNavigationBar`).
- Risk: medium; contained to shell + sidebar; router/state untouched.

### Option C (telescoping — sequence after A)
- New collapsed-left composition: single 48px rail hosting area icons + a context handle;
  side rail opens as an overlay (`panelOverlayStyle('left')`) instead of a pushed 48px strip.
- Inset arithmetic: collapsed left = `sidebarWidth` only (no `+ RAIL_COLLAPSED_WIDTH` for the
  side rail); expanded pair shares one boundary.
- Keep components separate (per SCO-086) — the seam and the single-boundary look are CSS only.
- Risk: medium-high; new interaction mode; most testing.

---

## 7. Open questions for the user

1. **Masthead vs. full-height sidebar (Option B core).** Willing to trade the liked
   full-height sidebar + top-left logo for a true full-width top row? This is the one real
   preference call the study can't make for you.
2. **The double rail (F1).** Is the collapsed 48+48 left chrome actively bothering you (→ pursue
   C), or is A's softening enough?
3. **Top-row height.** 40 (current) vs 44 (masthead). 40 stays "slim"; 44 seats a logo + a
   12px divider more comfortably.

---

## 8. Mockups

Static, self-contained, dark-HUD HTML in [`design/navigation-study/`](../../design/navigation-study/):

- `index.html` — compare hub (links + legend + the state matrix).
- `option-a-anchored-l.html` — recommended / annotated-mock direction.
- `option-b-full-width-mast.html` — full-width masthead alternative.
- `option-c-telescoping-rail.html` — double-rail consolidation.

Each shows the sidebar + side rail + top bar in **expanded and collapsed** states side by
side, with the real palette, mono type, single green accent, and clickable chevrons.
