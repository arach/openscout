# SCO-086: Rail consistency — unified expand affordance, sidebar resize, page title bar

Status: draft, ready for review
Scope: `packages/web` chrome polish on top of sco-085 (full-height
sidebar, top bar removed). User-directed design consolidation after
reviewing the alternative lanes mock.

## Design directives (from the user, 2026-07-20)

1. **One expand/collapse affordance for all rails.** Sidebar, side rail,
   and inspector share a single expand/collapse control pattern in a
   dedicated, consistent place — the floating expand-control pattern the
   HudsonKit `SidePanel` already uses. Kill the ad-hoc triggers: no
   collapse glyph on the logo, no duplicate brand-row + footer triggers.
2. **The logo is static.** Scout mark + name stays at the top-left of the
   sidebar. It is never a collapse toggle (click → Home is fine).
3. **Consistent minimized widths.** Sidebar icon rail, collapsed side
   rail, and collapsed inspector share one collapsed width family (~48px).
4. **Sidebar is drag-to-resize.** The expanded sidebar gets a drag handle
   (shadcn `SidebarRail` pattern) with sensible min/max (~200–360px) and a
   persisted width, like the other panels' `onResizeStart` behavior.
5. **Top bar remains a top bar.** Keep a slim page-level header bar (per
   the alternative mock: page title/breadcrumb, utilities at right) —
   formalize the sco-085 `CenterPaneHeader` seam into this role rather
   than letting each screen invent its own.

## Work items

### 1. Unified rail affordance

- Define ONE collapse/expand control: an **edge chevron** (`‹`/`›`) on the
  rail's boundary at header height — the pattern shown in the user's
  annotated mock (2026-07-20). Same control, same position, same behavior
  for sidebar, side rail, and inspector. Extract as a shared component
  (e.g. `components/RailToggle.tsx`).
- Sidebar: remove the brand-row trigger and the footer `SidebarTrigger`;
  the edge chevron handles expand/collapse. In icon-rail mode the chevron
  sits at the same boundary spot (pointing right to expand).
- Side rail + inspector: replace the current floating expand glyph with
  the shared edge chevron (same behavior, one implementation).
- `⌘B` keeps working (shell-owned) and drives the same control.

### 2. Static logo

- Sidebar brand row: logo + product name, click → Home, no collapse
  behavior, no minify glyph. Drag-region exemption stays (brand is a
  click target, not a drag handle, and not a toggle).

### 2b. Page title bar owns secondary nav

- The page title bar (work item 5) also owns the page-level secondary nav
  strips: `OpsSubnav` (Lanes · Mission Control · Providers · Mesh · Tail ·
  Runtime · Plans) and `ChatSubnav` move OUT of the content pane and INTO
  the title bar, per the mock. One shared placement, driven by the
  existing `secondaryNavConfig` projection.

### 3. Consistent collapsed widths

- One CSS var (e.g. `--scout-rail-collapsed-width: 48px`) drives the
  sidebar icon rail, collapsed side rail, and collapsed inspector.
  Verify the three actually render at the same width at 1280px and 900px.

### 4. Sidebar drag-resize

- Add a resize handle on the expanded sidebar's right edge (shadcn
  `SidebarRail` pattern, wired to the shell, not the shadcn default —
  our shell owns width via `useSidebarCollapse`).
- Min ~200px, max ~360px; persist width (new key, separate from collapse
  state); double-click handle resets to 260px default.
- `leftInset` arithmetic consumes the dynamic width (it already reads
  `sidebarCollapse.width`).

### 5. Page title bar

- Formalize `CenterPaneHeader` as the slim page title bar: page
  title/breadcrumb, right-side utilities where a screen needs them.
- Document the pattern in the component header (screens must not render
  their own competing title bars; big-header landings keep the null
  behavior from sco-085).

### 6. Review follow-ups (from sco-085 PR #404 review)

- `areaSubNavForRoute` must derive from `ROUTE_AREA_BY_VIEW` instead of
  inlining the area map; add a parity test.
- Empty-CONTEXT Case C: expanding while empty currently flips stored
  `rightCollapsed` true→false, which can erase a manual collapse
  preference — fix so the temporary open override never rewrites the
  stored pref; extend the transition tests.

## Constraints

- URLs unchanged; router/nav suites green unmodified.
- Sidebar and HudsonKit `SidePanel` remain separate components; the
  shared rail toggle is a control, not a merge of the components.
- `?ff.nav.sidebar=off` legacy path untouched.
- Collapse semantics (manual persisted vs derived auto-collapse)
  unchanged; resize width persists independently.
- Scope + embeds unchanged.
- Do not git commit. Do not touch the unrelated MessageComposer /
  voice / design-studio files in the working tree.

## Verification

- `bun run --cwd packages/web test` + build green; focused nav/sidebar
  suites green.
- New tests: rail width var consistency (unit-level where possible),
  `areaSubNavForRoute` parity with `ROUTE_AREA_BY_VIEW`, empty-CONTEXT
  pref-preservation transition.
- Visual matrix: all 8 areas at 1280/900 (rail + expanded), sidebar
  drag-resize to min and max, double-click reset, one scope surface, one
  embed, legacy flag-off path.
- Hit-test: rail toggle clickable in all three rails; resize handle wins
  `elementFromPoint` at the sidebar edge.

## Report back

Files changed per work item, deviations, test/build results, visual
matrix, remaining gaps.
