# SCO-085: Full-height sidebar, top-bar removal, entry points, polish

Status: revised after Codex review, ready for implementation
Scope: `packages/web` chrome — complete the sco-084 end state (sidebar to
the top of the window, top bar removed), restore mouse entry points lost in
the nav transition, and a visual polish pass on sidebar + lanes.

## Background

sco-083/084 shipped: 8 primary areas, exhaustive view→area map, real shadcn
sidebar component (pure navigation, icon-rail-first), `ScoutSideRail` for
per-area context, default on (`?ff.nav.sidebar=off` for legacy). A
reachability audit found the "get out of jail" layers intact
(go-shortcuts, command palette, Ops secondary nav) but two genuine
mouse-path gaps: **Repos and Code** (pulled from OpsSubnav, no longer in
any menu) and **Terminals** (lost its jump-dock path).

## Work item 1 — full-height sidebar + top-bar removal (REVISED)

The sidebar becomes the full-height left edge; `ScoutNavigationBar` is
**conditionally unmounted** in the sidebar-chrome path (NOT CSS-hidden —
duplicate controls/IDs must not exist). The legacy flag-off path keeps the
bar untouched.

Complete relocation inventory (Codex review — all must be handled):

- **Layout offsets:** center content uses `top: navTotalHeight`; both
  HudsonKit `SidePanel`s default to `panelTopOffset === navTotalHeight`;
  `ScoutSideRail` does not override `top`. In sidebar mode set explicit
  zero/titlebar-safe top offsets for center pane, side rail, and inspector
  — removing the bar without this leaves a 48px ghost gap.
- **Brand row:** Scout mark + name (click → Home) at the very top of the
  window, `top: 0`. Preserve `titleBarInset` padding so the brand row does
  not collide with macOS window controls.
- **Drag region:** `dragRegionProps` currently covers the bar; move onto
  the sidebar brand/header strip, keeping `onInteractiveMouseDown`
  exemptions for the Home-brand click AND the collapse trigger. The
  onboarding takeover is a fixed z-80 overlay OUTSIDE the inert background
  tree — a drag region inside the sidebar will be covered/inert during
  onboarding; put the drag strip above/outside the inert tree or add an
  equivalent strip to the takeover.
- **Breadcrumb:** `routeBreadcrumbForRoute` is consumed only by
  `useScoutNavCenter`. Create ONE shared center-pane header seam (a shell
  slot rendered above `ScoutContent`/`ScopeAppContent`) — do NOT hand-edit
  every screen.
- **Machine scope control:** exactly ONE instance — sidebar footer in
  sidebar mode, top bar in legacy mode; never render-and-hide both
  (`machine-scope-select` id would duplicate). Define a usable collapsed
  presentation for the 48px rail (the bare select does not fit; e.g. icon
  + popover, or omit from rail with expanded-only presence — document the
  choice). Note: the control already disappears on non-machine-scoped
  views (Code, Terminal, repo-diff, Ops/Lanes, Settings) — that is existing
  router policy, not a relocation regression; expanding it is out of scope.
- **⌘K trigger:** there is NO existing top-bar ⌘K button to relocate —
  this is a NEW sidebar footer button; the shell must pass it the
  command-palette open callback.
- **Settings:** sidebar area already; remove the top-bar button in sidebar
  mode.
- **Nav actions:** sidebar-mode `useScoutNavActions` contains only machine
  scope + Settings; System menu is already replaced. Nothing else needs a
  home.
- **Search hook:** `ScoutNavigationBar` supports `app.hooks.useSearch` but
  `createScoutApp` does not wire one — nothing is lost. Document that the
  generic search hook is intentionally unsupported in sidebar mode.
- **Scope (`/scope/*`):** use the EXISTING sidebar projection of
  `SCOPE_TOP_NAV_ITEMS` (already in `useSidebarModel`) and remove the
  duplicate nav-center contract in sidebar mode. Note `scopeBrandLabel` is
  the active section label ("Lanes" etc.), not a fixed brand — handle
  accordingly in the scope sidebar header.
- **Embeds:** unchanged (no chrome).

## Work item 2 — entry-point restoration (mechanism approved, corrections)

New `AREA_SUB_NAV` projection in `nav-destinations.ts` (destinations
already exist — this is a projection, not new destinations):

- Projects area: `Projects · Repos · Code`. Sessions area:
  `Sessions · Terminals`.
- **Correction:** extend the canonical `repos.active` predicate to include
  `repo-diff` (today `/repo-diff` shows Projects active but no sub-item
  active).
- Render as `SidebarMenuSub` under the area item when the area is active
  and the sidebar is expanded, AND as ONE shared route-aware strip around
  `ScoutContent`/`ScopeAppContent` (not per-screen edits) so icon-rail mode
  has a mouse path too.
- Do NOT put these links in `ScoutSideRail` — that rail is contextual and
  may be absent/collapsed.

## Work item 3 — polish pass

Sidebar:
- Active area: strengthen to match the old tab underline's glanceability —
  accent left-bar or brighter surface on the active `SidebarMenuButton`.
- Brand row: collapse trigger in the brand row (top) in addition to the
  footer trigger.
- Secondary text contrast: raise timestamps/meta from ~35% to ~55-60%
  opacity across sidebar, side rail, and lane lists.

Lanes surface (`/ops/lanes`):
- Lane list rows (side rail): two-line rows — lane name, then
  project/machine + harness badge; status dot with real semantics
  (running / waiting / failed / idle); consider grouping by machine.
- Lane column headers: replace the large ornamental ✳ loader with inline
  status.
- Lane columns: stronger separators (or subtle background shift).
- Trace rows: subtle background on command/code rows.

Empty CONTEXT panel (REVISED — needs explicit state design, do not just OR
emptiness into `effectiveRightCollapsed`):
- Expose empty/loading state ABOVE the panel: `ScoutbotStateContext` does
  not currently expose message count/loading — add it, so the shell can
  distinguish empty from populated WITHOUT depending on mounted panel
  children (a collapsed HudsonKit `SidePanel` unmounts its children; a
  direct `/ops/lanes` load must not deadlock on that).
- Preserve the stored manual preference: emptiness derives collapse, but
  clicking expand must add a TEMPORARY route-scoped open override (not
  flip stored `rightCollapsed` to true permanently).
- Only then: auto-collapse the right panel on `/ops/lanes` when the
  Scoutbot conversation is empty, and move suggested prompts to the top of
  the empty state.

## Constraints

- URLs unchanged; router/nav suites green unmodified.
- Sidebar and HudsonKit `SidePanel` remain separate components; the side
  rail stays a distinct slot.
- `?ff.nav.sidebar=off` legacy path keeps working — top bar stays for it.
- Icon-rail default and collapse semantics (manual persisted vs derived
  auto-collapse) unchanged.
- Scope stays path-driven; embeds unchanged.
- Do not git commit.

## Verification

- `bun run --cwd packages/web test` + build green; focused nav/sidebar
  suites green.
- New tests: `AREA_SUB_NAV` projection covers repos/code/terminals;
  `repos.active` includes `repo-diff`; breadcrumb header seam renders for a
  sample of routes; collapse state-transition coverage for the empty-panel
  override.
- Visual matrix: all 8 areas at 1280px and 900px (rail default + expanded),
  full-height sidebar with no top bar, Projects sub-nav visible in both
  sidebar and center strip, `/ops/lanes` before/after polish, one scope
  surface, one embed, legacy flag-off path renders old chrome, onboarding
  takeover drag still works.
- Hit-test: sidebar/side-rail items win `elementFromPoint`; brand clickable
  at top of window; macOS-embed drag region still drags (manual or
  documented).

## Report back

Files changed per work item, deviations, test/build results, visual matrix,
bundle delta vs the sco-084 build.
