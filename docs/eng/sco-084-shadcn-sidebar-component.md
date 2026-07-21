# SCO-084: Adopt the real shadcn sidebar component

Status: draft, ready for review
Scope: `packages/web` — replace the hand-rolled `ScoutSidebar` (sco-083)
with the actual shadcn `sidebar` component family, on Base UI primitives,
keeping the sco-083 IA model, flag, context resolver, and scope seam.

## Background

sco-083 (merged, PRs #401/#402) shipped a classic sidebar behind/under
`nav.sidebar` (now default on): `PRIMARY_AREAS` + exhaustive
`ROUTE_AREA_BY_VIEW` over all 21 route views, `resolveSidebarContext`,
`useSidebarModel` scope seam, `useSidebarCollapse` (persisted manual vs
derived <1024px auto-collapse), and a hand-rolled `ScoutSidebar.tsx` with
custom CSS. The user asked for shadcn + Base UI; the hand-rolled component
only follows the shadcn *pattern*. This spec adopts the real component.

## What the real component is

The shadcn `sidebar` block (docs: ui.shadcn.com/docs/components/sidebar) is
copy-in source, not an npm package. Component tree:

```
SidebarProvider
├── Sidebar (side, variant, collapsible: offcanvas|icon|none)
│   ├── SidebarHeader            (sticky top — brand)
│   ├── SidebarContent           (the only scroll region)
│   │   ├── SidebarGroup (+ SidebarGroupLabel/Action/Content)
│   │   │   └── SidebarMenu > SidebarMenuItem > SidebarMenuButton
│   │   │       (+ SidebarMenuAction / SidebarMenuBadge / SidebarMenuSub)
│   ├── SidebarFooter            (sticky bottom)
│   └── SidebarRail              (drag-resize handle; optional)
├── SidebarInset                 (only for the `inset` variant)
└── SidebarTrigger               (toggle button)
```

`SidebarProvider` owns open/collapsed state (controlled via
`open`/`onOpenChange`), ships the `Cmd/Ctrl+B` shortcut, and exposes
`useSidebar()` (`state`, `open`, `setOpen`, `toggleSidebar`, `isMobile`…).
Widths via `--sidebar-width` / `--sidebar-width-icon` CSS vars. shadcn's
registry now ships a Base UI variant; the upstream default still uses
Radix `Slot`/`Collapsible`/`Tooltip` in places.

## Requirements

1. **Copy in the real component family** as
   `packages/web/client/components/ui/sidebar.tsx` (plus any small ui
   helpers it needs, e.g. `button`, `tooltip` wrappers, `use-mobile`),
   keeping upstream file structure so future `shadcn` CLI diffs stay
   reviewable. Preserve upstream comments/attribution.
2. **Base UI, not Radix.** Where the copied source uses Radix primitives
   (`Slot`, `Collapsible`, `Tooltip`, `Dialog` for the mobile sheet):
   - Tooltip → `@base-ui-components/react/tooltip` (already a direct dep).
   - Collapsible → `@base-ui-components/react/collapsible`.
   - `Slot` → replace with Base UI's render-prop pattern or a ~20-line
     local `Slot` equivalent; do NOT add a Radix dependency.
   - Mobile sheet/off-canvas → **delete** (`collapsible="offcanvas"` and
     the `isMobile` sheet path). This product is desktop-first; the icon
     rail is the only collapsed mode. Document the deletion in the file.
3. **HUD tokens.** Map shadcn's `--sidebar`, `--sidebar-foreground`,
   `--sidebar-accent`, `--sidebar-border`, `--sidebar-ring`,
   `--sidebar-width` (260px), `--sidebar-width-icon` (48px) onto the
   existing oklch HUD token set in `app.css`. The sidebar keeps the current
   mono HUD skin — component anatomy changes, aesthetics don't.
4. **State integration (the delicate part):**
   - `SidebarProvider` runs CONTROLLED: `open`/`onOpenChange` bound to
     `useSidebarCollapse`, so the persisted manual preference vs derived
     auto-collapse (<1024px, never overwrites manual) semantics are
     preserved exactly. Add tests proving provider state and
     `useSidebarCollapse` can't diverge (e.g. window resize while manually
     collapsed).
   - `Cmd+B`: shadcn's provider ships this shortcut; the shell's existing
     keyboard handler also maps `Cmd+B`. Keep exactly one binding — remove
     the shell's duplicate and let the provider own it (verify it doesn't
     fire in editable/terminal targets; if the provider's guard is weaker
     than the shell's, keep the shell's and disable the provider's).
   - The shell's `leftInset` arithmetic (`sidebarCollapse.width`) must be
     driven from provider state so content, sidebar, and rail never
     disagree. Frame/HUD overlay behavior (pointer-events, z-order,
     StatusBar 28px bottom inset) must be preserved — the sco-083
     pointer-events bug must not regress: sidebar items must win
     `elementFromPoint` over the content pane (add a test or documented
     manual check).
5. **Composition mapping (preserve current UX):**
   - `SidebarHeader`: Scout mark + product name (click → Home).
   - `SidebarContent`: `SidebarGroup` "Navigate" (Home, Projects, Sessions,
     Chat, Dispatch, Search) and `SidebarGroup` "System" (Ops, Settings)
     rendered from `PRIMARY_AREAS` via `SidebarMenu*`;
     `SidebarMenuButton` gets `isActive` from
     `primaryAreaForRoute(route)`; tooltips on collapsed rail via the
     component's built-in tooltip path.
   - Context section: `resolveSidebarContext(route)` output renders as a
     third `SidebarGroup` (label "Context") — the component must accept
     arbitrary children here, not just `SidebarMenu`.
   - `SidebarFooter`: broker status + `SidebarTrigger`.
   - `SidebarRail`: omit (fixed 260/48 widths for now).
6. **Keep everything presentation-agnostic:** `primary-areas.ts`,
   `ROUTE_AREA_BY_VIEW`, `resolveSidebarContext`, `useSidebarModel`
   (scope seam — scope keeps supplying its model; the scope sidebar also
   renders through the shadcn tree), the `nav.sidebar` flag (now default
   on; `?ff.nav.sidebar=off` falls back to legacy chrome), breadcrumbs,
   machine scope in the top bar.
7. **Delete** `scout/sidebar/ScoutSidebar.tsx`'s custom markup and
   `scout-sidebar.css` once the shadcn tree is live (keep
   `useSidebarCollapse`/`useSidebarModel` — they're state, not markup).
   The legacy left panel stays untouched behind the flag-off path.

## Constraints

- URLs unchanged; router/nav suites green unmodified.
- No Radix dependency. No new npm dependency beyond what's already present
  (`@base-ui-components/react`, `lucide-react`, tailwind).
- Embeds unchanged (no sidebar). Scope remains path-driven.
- Auto-collapse remains derived; manual preference never overwritten.
- Do not git commit.

## Verification

- `bun run --cwd packages/web test` + `bun run --cwd packages/web build`
  green; focused nav/router/sidebar suites green.
- Bundle delta reported vs the sco-083 baseline (+99 kB raw / +33 kB gzip).
- Visual matrix with flag on: all 8 areas × expanded/collapsed at 1280px
  and 900px, one scope surface, one embed (no sidebar), settings drawer
  over sidebar, dispatch sheet over sidebar.
- Hit-test: `elementFromPoint` over sidebar menu items returns the item,
  not the content pane (regression guard for the sco-083 bug).

## Report back

Files added/changed/deleted, how Slot/Radix usages were handled, the
controlled-provider wiring (and any divergence tests), keyboard shortcut
decision, bundle delta, visual matrix results, remaining gaps.
