# SCO-083: Sidebar navigation + convergence to 8 primary views

Status: revised after Codex review (docs/eng/sco-083-sidebar-navigation-review.md), ready for implementation
Scope: `packages/web` chrome — replace top-tab navigation with a classic
sidebar, adopt shadcn component conventions + Base UI primitives, and
converge the 21 route views onto 8 primary navigation areas.

## Background

The navigation stack has been consolidated (sco-081/082): one canonical
router (`client/lib/router.ts`), one destination catalog
(`client/scout/nav-destinations.ts`) with per-surface projections, and
URL-driven selection state. What remains is an information-architecture
problem the code cleanup could not fix: 21 route views cannot be a tab row,
so the app carries four overlapping navigation surfaces — top tabs, System
menu, jump dock, go-shortcuts — plus a per-route left rail
(`resolveLeftPane`) that is effectively a second, ungoverned navigation
layer.

A look-and-feel review (2026-07-20) confirmed the symptoms: near-duplicate
destinations across surfaces, a `SCOPE` label that reads as a dead tab, and
a tab-strip layout fragile enough to overlap the System menu (patched in
PR #400 as a stopgap).

## Goals

1. **8 primary views.** Every route variant belongs to exactly one primary
   area. The sidebar shows 8 destinations, never 21.
2. **One navigation surface.** The sidebar absorbs the top tabs, System
   menu, jump dock, and the per-route left rail. Go-shortcuts and the
   command palette stay — they are power-user accelerators, not chrome.
3. **shadcn + Base UI alignment.** Sidebar anatomy follows the shadcn
   sidebar pattern (icon rail + collapsible expanded state + grouped
   sections); interactive primitives come from a direct
   `@base-ui-components/react` dependency. Styling stays on the existing
   Tailwind 4 + oklch HUD token system. "Classic" describes structure, not
   aesthetics.
4. **URLs do not change.** All 21 route variants keep parsing and
   serializing exactly as today (deep links, macOS-embedded surfaces,
   `/scope/*`, `/embed/*`). The 8 areas are a navigation projection, not a
   router change.

## IA model (two explicit layers)

The destination catalog is NOT one-row-per-view (19 destination rows vs 21
views; no rows for `agent-info`, `conversation`, `repo-diff`, `briefings`,
`work`, `follow`; `ops` split across several mode rows). Do not hang `area`
on destination rows. Instead:

1. `PRIMARY_AREAS`: 8 rows — area id, label, icon, default route, and
   visibility/default-route policy.
2. `ROUTE_AREA_BY_VIEW satisfies Record<Route["view"], PrimaryAreaId>` — an
   exhaustive compile-time map (or exhaustive `primaryAreaForRoute(route)`
   switch where fields like `ops.mode` matter). The compile-time `Record`
   proves all union members; a runtime test asserts 8 non-empty buckets and
   exactly 21 keys.

Sidebar active state: `primaryAreaForRoute(route) === area.id`. Existing
destination predicates keep driving secondary nav and command/shortcut
projections unchanged.

### The partition (revised per review)

| Area | Route views |
| --- | --- |
| Home | `inbox`, `activity`, `briefings` |
| Projects | `agents-v2`, `agent-info`, `repos`, `repo-diff`, `code` |
| Sessions | `sessions`, `terminal` |
| Chat | `messages`, `conversation`, `channels` |
| Dispatch | `broker`, `work`, `follow` (fallback only — FollowScreen resolves and redirects; active area should follow the resolution where practical) |
| Search | `search` |
| Ops | `ops`, `mesh`, `harnesses` |
| Settings | `settings` (includes the `agents` section, which moves out of the Agents secondary strip) |

### Secondary projections must respect the same boundaries

- Remove Dispatch/Repos/Code from `OpsSubnav`; stop rendering `OpsSubnav`
  on Broker/Repos screens.
- Chat's Messages/Channels strip stays (coherent).
- `SEARCH_SECONDARY_NAV` is already production-dead — delete it.
- The Agents secondary strip dies when agent configuration moves to
  Settings.

### Ops gating (corrected)

Do NOT gate the whole Ops area behind `ops.control` — Tail and Lanes are
deliberately ungated today (`isUngatedOpsSurface`; System menu core group
always shows Tail). The Ops area stays visible; gate its context entries
instead. Its default route is Mission Control when `ops.control` is on,
Tail (or Lanes) when off.

## Sidebar anatomy

Following the shadcn sidebar pattern, restyled on HUD tokens. Note:
HudsonKit `SidePanel` collapses to zero width with a floating expand
button — it has no 48px icon rail. The sidebar is a NEW shell layout (or a
real extension), with its own inset arithmetic; it is not a rename.

- **Expanded (default, ~260px):**
  - Header: Scout mark + name (click → Home).
  - "Navigate" section: Home, Projects, Sessions, Chat, Dispatch, Search.
  - "System" section: Ops, Settings.
  - "Context" section: per-area content from the new exhaustive
    `resolveSidebarContext(route)` (see migration below).
  - Footer: broker status + collapse toggle.
- **Collapsed (~48px icon rail):** area icons with Base UI Tooltips (label
  + shortcut); context hidden; click expands. Manual collapse persists via
  its OWN persisted key (separate from the legacy left-panel key during the
  soak). Auto-collapse below 1024px is DERIVED state and must never
  overwrite the persisted manual preference.
- **Scrolling:** header, destinations, and footer pinned; only Context is
  the `min-height: 0; overflow-y: auto` region. Context components must not
  add a second scroller unless virtualized.
- **Keyboard:** `Cmd+[` retargets to the sidebar; `Cmd+]` stays right
  inspector; add `Cmd+B` for collapse (only outside editable/terminal
  targets); update command palette + keyboard-help overlay.
- **Top bar after:** slim utility bar — breadcrumb, machine scope control
  (ONE canonical placement: here, not duplicated in the sidebar footer —
  beware duplicate `machine-scope-select` ids), command palette trigger.
  Settings shortcut retained only as an accelerator; the Settings sidebar
  area is canonical.
- **Breadcrumbs:** move `topNavBreadcrumbForRoute` output into a neutral
  `route-breadcrumb.ts` (complete for all primary/detail routes) BEFORE
  deleting `topNavConfig`.

## Context migration (exhaustive, no HomeLeft fallback)

`resolveLeftPane` today: `ops`→OpsLeft, `agents-v2`→ProjectsRail,
`agent-info`→AgentsLeft, chat views→ChatLeft, `mesh`→MeshLeft,
`terminal`→TerminalLeft, and EVERYTHING ELSE (sessions, broker, search,
settings, work, repos, code, harnesses, briefings, activity) → HomeLeft
fallback. The new `resolveSidebarContext` must be exhaustive: an
intentional component or `null` for every view — carrying the HomeLeft
fallback over would make "Recent agents/activity" look like contextual
navigation for most areas. Migration inventory explicitly includes Mesh,
Terminal, Settings, and every current fallback route.

**Jump dock:** the jump buttons die, but `GlobalJumpDock` is the ONLY host
of `MeshCanvasMinimap` (rack/map, machine visibility/focus,
`openscout.globalJumpDock.mode.v1` preference). Migrate the Mesh rack/map
into the Mesh sidebar context/footer BEFORE deleting the component; decide
whether to migrate or intentionally retire the stored mode.

## Scope integration (new seam)

`wireScopeOntoScout()` replaces Content/nav-center/nav-actions/takeover —
it does NOT touch the left-panel slot. `useScopePresentation()` is
`isScopePath(pathname)`: scope is path-driven, NOT ffBundle-driven.

- Add an explicit sidebar seam (`useSidebarModel` or sidebar slot) so scope
  can supply its own model; the new Scout sidebar must stay path-aware.
- Scope must be selected by path regardless of the sidebar experiment flag.
- Stop scope from force-writing the persisted left-collapse value;
  responsive/presentation collapse must not overwrite the user's stored
  preference.
- Test 4 combinations: old/new chrome × ordinary paths/`/scope/*`.

## Flag (concrete key, not a bundle name)

- Add `nav.sidebar` to `scoutFlags`, default off. Read reactively via
  `useOptionalFlag` in the shell; render exactly ONE chrome tree (never
  both accessibly at once).
- Experiment via `?ff.nav.sidebar=on` (the `ff.` sticky prefix already
  preserves it across navigation). Do NOT add it to `max-pro` — that would
  silently switch every max-pro user.
- Add URL/local/bootstrap precedence tests.

## Base UI adoption (scoped)

- Add `@base-ui-components/react` as a DIRECT `packages/web` dependency,
  version-aligned with HudsonKit's transitive copy
  (`hudsonkit@0.3.3` already depends on `^1.0.0-rc.0` for
  `HudsonContextMenu`) to avoid duplicate copies.
- Now: Tooltip for the icon rail.
- Later slices (NOT blocking sidebar parity): Dialog for Settings (the
  current drawer already has focus trap/Escape/URL state — separate
  conversion), Menu for machine scope only if the native select is
  intentionally redesigned (needs keyboard/SR parity tests), CommandPalette
  changes go upstream in HudsonKit.
- The 260↔48px transition is shell state + CSS, not a "collapse animation
  hook."
- Measure bundle delta: clean production-build baseline vs post-change
  chunk sizes; report the INCREMENTAL delta (Base UI may already be present
  transitively).

## Rollout (7 steps; land as many as stay green)

1. **IA model + tests only:** `PRIMARY_AREAS`, exhaustive
   `ROUTE_AREA_BY_VIEW`/`primaryAreaForRoute`, Ops gate/default policy,
   corrected secondary projections, `route-breadcrumb.ts`. No visual change.
2. **`nav.sidebar` flag + shell:** expanded and icon-rail sidebar alongside
   the old chrome; distinct persisted manual collapse; derived responsive
   collapse.
3. **Context migration:** Home, Projects/Agent, Chat, Terminal, Mesh, Ops
   custom contexts first; explicit `null` or new context for every former
   HomeLeft fallback; Mesh rack/map preserved.
4. **Scope sidebar model:** path-based presentation; stop scope mutating
   sidebar preference; 4-combination tests.
5. **Parity:** breadcrumbs, machine scope, broker status, command trigger,
   onboarding, returnTo, right inspector, keyboard help, gated entries.
   Accessibility + visual matrices here.
6. **Flip/soak/delete:** remove top-tab rendering, System menu, jump
   buttons, obsolete projections/tests/CSS, legacy left-pane resolver.
7. **Base UI Dialog/Menu slices:** after parity, separately.

Partial landing is acceptable — stop after the last green step and report.
Do not git commit.

## Non-goals

- Redesigning screen content (center panes stay).
- Changing the URL scheme, route union, or embed surfaces (embeds bypass
  the shell entirely — the icon rail is required for narrow NORMAL windows,
  not embeds).
- Replacing HudsonKit wholesale; touching iOS/macOS navigation.

## Verification

- `ROUTE_AREA_BY_VIEW` exhaustiveness (compile-time `satisfies Record`) +
  runtime test: 8 non-empty buckets, exactly 21 keys.
- Router suites (`router.test.ts`, `router.navigation.test.ts`,
  `nav-destinations.test.ts`, `topNavConfig.test.ts`,
  `secondaryNavConfig.test.ts`) green — URL behavior unchanged.
- Full `packages/web` suite + production build green at each step.
- Visual matrix (screenshots): all 8 areas × expanded/collapsed, one embed,
  one scope surface, 1280px expanded and 900px collapsed.

## Resolved open questions (from review)

1. Context scrolling: pinned header/destinations/footer; only Context
   scrolls.
2. Dispatch: top-level, owns `broker` + `work` + follow fallback — the
   work-execution area, not a one-view ledger.
3. Auto-collapse: below 1024px, derived state, manual expand always
   available, never overwrites persisted preference.
