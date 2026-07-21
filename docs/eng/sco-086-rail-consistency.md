# SCO-086: Rail consistency — unified expand affordance, sidebar resize, page title bar

Status: revised after Codex review, ready for implementation
Scope: `packages/web` chrome polish on top of sco-085 (full-height
sidebar, top bar removed). User-directed design consolidation after
reviewing the alternative lanes mock + annotated screenshot.

## Design directives (from the user, 2026-07-20)

1. **One expand/collapse affordance for all rails** — an **edge chevron**
   (`‹`/`›`) on the rail's boundary at header height (per the annotated
   mock). Same control, same position, same behavior for sidebar, side
   rail, inspector. No collapse glyph on the logo, no brand-row/footer
   triggers.
2. **The logo is static** — Scout mark + name top-left, click → Home,
   never a toggle.
3. **Consistent minimized widths** — all collapsed rails share one width
   (~48px).
4. **Sidebar drag-to-resize** — expanded sidebar gets a drag handle,
   min 200 / max 360 / default 260, persisted, double-click resets.
5. **Top bar remains a top bar** — the sco-085 `CenterPaneHeader` seam
   becomes the slim page title bar AND owns the page-level secondary nav
   strips (`OpsSubnav`, `ChatSubnav` move out of the content pane into it).

## Work items

### 1. Unified rail affordance (`components/RailToggle.tsx`)

Codex correction: do NOT extract from HudsonKit `SidePanel` — its
collapsed state is a private fixed button and expanded state has a private
header button; there is no toggle slot beyond omitting `onToggleCollapse`,
and the vendored fallback implements no collapse at all.

- Build a pure, app-owned `packages/web/client/components/RailToggle.tsx`:
  imports neither HudsonKit nor shadcn; props `side`, `collapsed`,
  label, `onToggle`; renders the edge chevron at the rail boundary at
  header height.
- Integration is shell/wrapper-owned:
  - Sidebar: bind to `useSidebar().toggleSidebar`; remove brand-row and
    footer triggers.
  - Expanded Hudson panels: omit `onToggleCollapse` (suppresses the
    built-in button) and render `RailToggle` externally or via
    `headerActions`.
  - Collapsed panels: `SidePanel isCollapsed` always yields HudsonKit's
    private button — so render an OpenScout-owned collapsed rail wrapper
    (see work item 3) hosting the shared chevron instead.
- `⌘B` stays shell-owned, drives the same control.

### 2. Static logo

Brand row: logo + name, click → Home, no collapse behavior. Drag-region
exemption stays.

### 3. Non-zero collapsed rails (Codex correction: they don't exist today)

Today only the sidebar has a real collapsed rail (48px). The side rail and
inspector collapse to **0px layout width** — HudsonKit replaces them with
a ~36px floating button, not a rail.

- Introduce one exported TS constant `RAIL_COLLAPSED_WIDTH = 48` reflected
  into `--scout-rail-collapsed-width` (CSS var alone cannot drive the
  numeric React inset arithmetic).
- Render OpenScout-owned collapsed rail wrappers for the side rail and
  inspector at that width (hosting the shared `RailToggle` + minimal
  state glyphs); update push-inset arithmetic: collapsed →
  `RAIL_COLLAPSED_WIDTH`, expanded → panel width.
- Keep HIDDEN distinct from COLLAPSED: `scopeHidesRight`, inactive side
  rail, broker-without-sheet stay 0px — no rail, no toggle.

### 4. Sidebar drag-resize (Codex corrections)

- `useSidebarCollapse` goes continuous: persisted
  `expandedWidth` (key `appshell.${appId}.sidebar.width`), constants
  DEFAULT 260 / MIN 200 / MAX 360;
  `width = effectiveCollapsed ? RAIL_COLLAPSED_WIDTH : expandedWidth`.
- All geometry sources consume the live value — including
  `SidebarProvider --sidebar-width` (currently hard-coded 260 at
  `OpenScoutAppShell.tsx:~935`).
- Drag lifecycle: live React state during drag, persist on pointer-up
  (no storage write per mousemove); double-click resets to 260.
- **Transition fight:** both sidebar and center pane animate width/left
  200ms — during live drag they trail the pointer while the side rail's
  `left` jumps immediately. Add an `isSidebarResizing` state/data
  attribute that disables those transitions until pointer-up.
- **Handle placement:** do NOT use stock `SidebarRail` (it toggles on
  click; cross-edge hitbox unsuitable). Render the handle only while
  expanded, as a shell-level fixed overlay at the computed sidebar edge
  with `z-index > 40` (the side rail sits at `left: navRailWidth`, also
  z-40, renders later, and would win hit-testing). Exempt the handle
  from the native drag region like other interactive controls.
- `titleBarInset` is vertical-only — no change.

### 5. Page title bar (expanded scope)

- `CenterPaneHeader` becomes the slim page title bar: define its title
  resolver API (route → title/breadcrumb) and a RIGHT-UTILITY slot
  (ReactNode) for screens that need header actions. Document which
  routes intentionally return `null` (big-header landings).
- Move `OpsSubnav` and `ChatSubnav` OUT of the content pane INTO the
  title bar, driven by the existing `secondaryNavConfig` projection.

### 6. Review follow-ups (Codex-confirmed)

- `areaSubNavForRoute` may import `ROUTE_AREA_BY_VIEW` directly (no real
  cycle; the "avoid circular import" comment is stale). Do that + parity
  test.
- Empty-CONTEXT: `nextLanesContextToggle` (`empty-context-collapse.ts:58-62`)
  flips stored `rightCollapsed` true→false on expand-while-empty, and the
  test at `:81-89` codifies that bug. Fix so the temporary open override
  never rewrites the stored pref; update the test.

## Constraints

- URLs unchanged; router/nav suites green unmodified.
- Sidebar and HudsonKit `SidePanel` remain separate components;
  `RailToggle` is a shared control, not a component merge.
- `?ff.nav.sidebar=off` legacy path untouched.
- Collapse semantics (manual persisted vs derived auto-collapse)
  unchanged; resize width persists independently.
- Scope + embeds unchanged.
- Do not git commit. Do not touch the unrelated MessageComposer /
  voice / design-studio files in the working tree.

## Verification

- `bun run --cwd packages/web test` + build green; focused nav/sidebar
  suites green.
- New tests: `RailToggle` rendering/behavior, collapsed-width constant
  consistency, `areaSubNavForRoute` parity, empty-CONTEXT
  pref-preservation, resize clamp/reset (pure logic where possible).
- Visual matrix: all 8 areas at 1280/900 (rail + expanded), edge chevron
  on all three rails in the same spot, sidebar drag to min and max +
  double-click reset, collapsed side rail/inspector at 48px, one scope
  surface, one embed, legacy flag-off path.
- Hit-test: edge chevrons and resize handle win `elementFromPoint`
  (resize handle specifically over the adjacent side rail).

## Report back

Files changed per work item, deviations, test/build results, visual
matrix, remaining gaps.
