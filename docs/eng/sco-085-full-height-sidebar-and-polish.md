# SCO-085: Full-height sidebar, top-bar removal, entry points, polish

Status: draft, ready for review
Scope: `packages/web` chrome — complete the sco-084 end state (sidebar to
the top of the window, top bar removed), restore mouse entry points lost in
the nav transition, and a visual polish pass on sidebar + lanes.

## Background

sco-083/084 shipped: 8 primary areas, exhaustive view→area map, real shadcn
sidebar component (pure navigation, icon-rail-first), `ScoutSideRail` for
per-area context, all behind no flag (default on; `?ff.nav.sidebar=off` for
legacy). A reachability audit (2026-07-20) found the "get out of jail"
layers intact (go-shortcuts, command palette, Ops secondary nav) but two
genuine mouse-path gaps: **Repos and Code** (pulled from OpsSubnav, no
longer in any menu) and **Terminals** (lost its jump-dock path).

## Work items

### 1. Full-height sidebar + top-bar removal

The sidebar becomes the full-height left edge of the window; the top bar
(`ScoutNavigationBar`) is removed in the sidebar-chrome path (it still
exists behind `?ff.nav.sidebar=off` — do not delete the legacy chrome in
this spec).

- Sidebar brand (Scout mark + name, click → Home) moves to the very top of
  the window; sidebar `top: 0` (drop the `--scout-sidebar-top` offset in
  the sidebar path).
- Top-bar contents relocate:
  - **Breadcrumb** (`route-breadcrumb.ts`) → a slim per-screen header row
    at the top of the center pane (each screen already has a header
    pattern; reuse it — do not invent a second breadcrumb style).
  - **Machine scope control** → sidebar footer, next to broker status.
    Exactly one instance (watch the `machine-scope-select` id).
  - **⌘K command trigger** → sidebar footer button (status bar already
    shows the hint; a footer button makes it discoverable).
  - **Settings** → already a sidebar area; remove the top-bar button in the
    sidebar path.
  - **Nav actions/System menu remnants** → already covered by areas;
    verify nothing else lives in `useScoutNavActions` that lacks a home.
- The drag region for frameless hosts (macOS embed uses the top bar as a
  drag region) must be preserved — check `usePlatform().dragRegionProps`
  and provide an equivalent drag strip (the sidebar header or a thin
  full-width strip above the content, invisible but draggable).
- Scope (`/scope/*`) presentation: keep working — its nav-center content
  currently lives in the top bar; give scope its own header treatment or
  fold into the scope sidebar model. Embeds unchanged (no chrome).

### 2. Entry-point restoration

- **Projects area gains a sub-nav**: `Projects · Repos · Code`, rendered
  as `SidebarMenuSub` under the Projects item (visible when Projects is
  active and sidebar is expanded) AND as a small strip at the top of the
  Projects center pane (so it works in icon-rail mode too).
- **Sessions area gains `Sessions · Terminals`** the same way.
- Wire both through `nav-destinations.ts` (the destinations already exist
  with routes and active predicates — this is a new projection
  `AREA_SUB_NAV`, not new destinations).

### 3. Polish pass

Sidebar:
- Active area: strengthen to match the old tab underline's glanceability —
  accent left-bar or brighter surface on the active `SidebarMenuButton`.
- Brand row: place the collapse trigger in the brand row (top) in addition
  to the footer trigger.
- Secondary text contrast: raise timestamps/meta from ~35% to ~55-60%
  opacity across sidebar, side rail, and lane lists.

Lanes surface (`/ops/lanes`, per 2026-07-20 review of the live build):
- Lane list rows (side rail): two-line rows — lane name, then
  project/machine + harness badge; a status dot with real semantics
  (running / waiting / failed / idle); consider grouping by machine.
- Lane column headers: replace the large ornamental ✳ loader with inline
  status in the header.
- Lane columns: slightly stronger separators (or subtle background shift)
  so the grid reads at a glance.
- Trace rows: subtle background on command/code rows to separate machine
  action from prose.
- Right CONTEXT panel: auto-collapse when it has no content (empty Scout
  conversation state currently occupies a full column); when open and
  empty, surface suggested prompts at the top, not the bottom.

## Constraints

- URLs unchanged; router/nav suites green unmodified.
- Sidebar and HudsonKit `SidePanel` remain separate components (sco-084
  constraint). The side rail stays a distinct slot.
- `?ff.nav.sidebar=off` legacy path must keep working — top bar stays for
  it.
- Icon-rail default and collapse semantics (manual persisted vs derived
  auto-collapse) unchanged.
- Scope stays path-driven; embeds unchanged.
- Do not git commit.

## Verification

- `bun run --cwd packages/web test` + build green; focused nav/sidebar
  suites green.
- New tests: `AREA_SUB_NAV` projection covers repos/code/terminals routes;
  breadcrumb renders in the center-pane header for a sample of routes.
- Visual matrix: all 8 areas at 1280px and 900px (icon-rail default +
  expanded), full-height sidebar with no top bar, Projects sub-nav visible,
  `/ops/lanes` before/after polish, one scope surface, one embed, legacy
  flag-off path still renders the old chrome.
- Hit-test: sidebar and side rail items win `elementFromPoint`; brand
  clickable at the top of the window; drag region still drags in the macOS
  embed (manual check or documented).

## Report back

Files changed per work item, deviations, test/build results, visual matrix,
bundle delta vs the sco-084 build.
