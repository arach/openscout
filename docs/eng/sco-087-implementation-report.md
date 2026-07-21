# SCO-087 implementation report — top row, chevron alignment, rail perf

Branch: `sco-087/top-row-and-rail-ux` · not committed · scope: `packages/web`
chrome only. Source of truth: `docs/eng/sco-087-top-row-chevron-rail-perf.md`.

Unrelated working-tree changes (MessageComposer / voice / design-studio) were
left untouched.

## Files changed

- `client/OpenScoutAppShell.tsx` — top row render + geometry, chevron placement,
  ghost resize, instant inset commit (all three problems).
- `client/scout/sidebar/CenterPaneHeader.tsx` — `variant="top-row"` (always
  mounts, non-sticky) + `onInteractiveMouseDown` for the drag region.
- `client/scout/sidebar/TopRowUtilities.tsx` — **new**: machine scope (single
  instance) + settings accelerator + ⌘K trigger for the top row.
- `client/scout/sidebar/ScoutSidebar.tsx` — removed machine scope + ⌘K + the
  edge toggle from the sidebar body (moved to top row / shell); footer keeps
  only the broker status line.
- `client/scout/sidebar/useSidebarCollapse.ts` — ghost resize: layout width
  ignores the live drag value; exposes `dragGhostWidth`.
- `client/app.css` — top-row + utility styles, sidebar-edge chevron + ghost
  line styles, Problem-3 transition rules + `prefers-reduced-motion`; removed
  dead resize-suppression + old `--sidebar` chevron CSS.

## Problem 1 — top row returns

**Approach.** Rather than add a second bar, `CenterPaneHeader` is promoted into
the app-wide top row: a fixed bar spanning the sidebar's right edge → right
viewport edge (`left: sidebarWidth`, `right: 0`, `top: chromeTopOffset`,
`height: 40`). The full-height sidebar is unchanged (logo top-left). Everything
right of the sidebar (side rail, inspector, center pane, collapsed rails,
terminal, resize handle) now starts at `contentTopOffset = chromeTopOffset + 40`.
The top row hosts, left→right: breadcrumb + area sub-nav + Ops/Chat secondary
strip (the existing `CenterPaneHeader` body) … then machine scope + settings +
⌘K (`TopRowUtilities`, the `rightUtility` slot). It **always** mounts in sidebar
chrome (it owns utilities + drag region), so flush landings feel anchored again.

**Drag region.** Applied to the top-row wrapper; the platform drag-region
`style` is *merged into* the wrapper style (not spread raw) so macOS
`-webkit-app-region` coexists with our fixed positioning. Interactive groups
(`-main`, `-utility`) opt out via `onInteractiveMouseDown`. Combined with the
sidebar brand strip's existing drag region, the whole top edge is draggable.

**Machine scope: exactly one instance** — the top row (`variant="nav"`). Removed
from the sidebar footer. Legacy `?ff.nav.sidebar=off` renders it in nav actions
only (unchanged); the two paths are mutually exclusive, so no duplicate id.

## Problem 2 — chevron alignment

All three rail chevrons now sit at a single shared band,
`railToggleTop = contentTopOffset + 8` — centered in each rail's panel-header
band, one row *below* the top row (so the collapsed-inspector chevron never
collides with the top-row utilities on the right). Each chevron is centered on
its rail's boundary x (sidebar right edge / side-rail right edge / inspector
left edge) and keeps the correct glyph/direction via the unchanged
`railToggleChevron`. Expanded and collapsed states share the band (the
collapsed-rail header padding already lands there), satisfying "same vertical
position in both states".

The sidebar chevron was moved out of the sidebar body into the shell as a fixed
element so it **rides the moving edge during drag** (`left` follows
`dragGhostWidth` while resizing, else the committed width). Side-rail and
inspector chevrons auto-align because their panels now receive
`top: contentTopOffset`.

## Problem 3 — rail collapse/expand + resize perf

**Collapse/expand.** Insets commit in a single React write — the center pane and
terminal overlay lost their `left/right` transitions, so a heavy page
(`/ops/lanes`, `/sessions`) reflows **at most once per toggle** instead of every
frame. The sidebar rail no longer eases `width/left` either (that drove a
transient gap against the instantly-committed content); the shadcn label
opacity/margin fade is the single composited motion. Commit point = animation
start (instant).

**Drag-resize → ghost edge.** `useSidebarCollapse` now pins the committed layout
width during a drag (`expandedWidth` ignores the live value); the live value is
`dragGhostWidth`, which drives only a 2px accent ghost line + the riding sidebar
chevron. The real width commits once on pointer-up (`endResize`) → the center
pane reflows once, not per pointer-move. Final resting width is identical to
before.

**Reduced motion.** `@media (prefers-reduced-motion: reduce)` zeroes the
sidebar-container, collapsed-rail and rail-toggle transitions/animations →
instant commit, no fades.

**Parity.** No URL / route / state-model changes. Collapse/resize semantics
(manual persisted · derived auto-collapse · `expandedWidth` 200–360) unchanged.
Scope + embeds + the legacy path untouched. Removed the now-dead
`html[data-scout-sidebar-resizing]` suppression CSS.

## Verification

- `bun run --cwd packages/web build` → **green** (~11–15s).
- Focused nav/sidebar suites (`scout/sidebar/*`, `RailToggle`,
  `scout-flags-sidebar`, `router`) → **79 pass / 0 fail**.
- Full `bun run --cwd packages/web test` → **830 pass, 20 fail, 7 errors**. The
  20 fail / 7 errors are **all pre-existing server-side** tests
  (`loadAgentObservePayload`, `loadSessionRefObservePayload`, `agent service
  wiring`) — proven unrelated: with my six files stashed to HEAD the same
  `20 fail / 7 errors` reproduce. My changes add **zero** new failures.
- `tsc` on touched files → no new errors. (The lone `TS2367` at the
  `agentsV2Route` ternary is pre-existing on HEAD — one of the repo's ~97
  standing `tsc` errors CI does not enforce.)

## Remaining gaps / judgment calls

1. **Live visual matrix not run.** Verified by build/tests/reasoning, not a
   headless screenshot pass (would need `nav.sidebar` on). Reload the running
   web app to pick up the rebuilt `dist/client` and eyeball the 8 areas /
   3 rails / resize / a scope + embed / legacy path.
2. **Motion is commit-once + opacity fade, not a transform slide.** A true
   transform slide over a width change can't avoid distortion/clipping in this
   fixed push-layout; instant-commit is what kills the jank. FLIP-style slide is
   possible future polish.
3. **Chevron band = panel-header height** (deliberate, to dodge the
   collapsed-inspector ↔ top-row-utilities collision). Hoisting them into the
   top-row band is a small tweak if preferred, but reintroduces that collision.
4. **Side-rail / inspector legacy resize** still updates width live (spec named
   the *sidebar* drag-resize). Same ghost treatment there is a follow-up if
   wanted.
5. `TOP_ROW_HEIGHT = 40` chosen as "slim" — tune to taste.

## Review fixes (Codex, PR #406 — 2 blocking)

**B1 — collapsed chevron off the boundary.** `CollapsedRail` rendered the
`RailToggle` in a `width:100%` flex-centered header, so the collapsed side-rail
and inspector chevrons sat ~24px inside the 48px strip. Fixed by absolutely
positioning the chevron ON the strip's inner boundary line (`right:0`
translateX(50%) for a left rail; `left:0` translateX(-50%) for a right rail) at
`top:8` — the same band as the expanded chevrons. Removed the dead
`.scout-collapsed-rail-header` rule. Files: `CollapsedRail.tsx`, `app.css`.

**B2 — descendants still animated layout props.** The `transition:none` override
only covered `[data-slot="sidebar-container"]`; shadcn descendants still eased
`margin`/`opacity` (group label) and `width`/`height`/`padding` (menu buttons)
on collapse → per-frame subtree relayout. Added
`html[data-scout-sidebar-chrome] [data-slot="sidebar-container"] * {
transition-property: opacity, transform !important; }` so layout props snap and
motion stays compositor-only (opacity+transform); the label opacity fade is
preserved. File: `app.css`.

Re-verified: build green; focused nav/sidebar suites 79 pass / 0 fail; tsc no new
errors in touched files. Behavior otherwise unchanged; not committed.
