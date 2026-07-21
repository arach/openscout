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

0. **Upstream source and dependency reality (Codex blocker):** pin an exact
   upstream revision of the shadcn Base UI sidebar
   (`apps/v4/registry/bases/base/ui/sidebar.tsx` in shadcn-ui/ui) and record
   the commit hash in the copied file header. That source imports
   `@base-ui/react` (the renamed package), `class-variance-authority`, and
   a `cn()` backed by `clsx` + `tailwind-merge` — none resolvable here
   today. Resolution:
   - `@base-ui/react` imports → port to the installed
     `@base-ui-components/react@1.0.0-rc.0` APIs (do NOT add the renamed
     package alongside the old one — same library, would duplicate).
   - `clsx`, `tailwind-merge`, `class-variance-authority` MAY be added as
     direct `packages/web` deps (small, standard for shadcn). A trivial
     class joiner is NOT sufficient where HUD overrides conflict with
     upstream layout classes (`inset-y-0`, `h-svh`, z-index) — use
     `tailwind-merge` via a proper `cn()` in `client/lib/utils.ts`.
   - Tailwind v4: mapping `--sidebar*` in `app.css` alone does not make
     classes like `bg-sidebar` resolve. Register the color namespace via
     `@theme inline` in Tailwind-processed CSS (`--color-sidebar:
     var(--sidebar)`, `--color-sidebar-foreground`, etc.) per shadcn's
     Tailwind v4 guidance.

1. **Copy in the real component family** as
   `packages/web/client/components/ui/sidebar.tsx` (plus any small ui
   helpers it needs, e.g. `button`, `tooltip` wrappers — `use-mobile` is
   NOT needed, see 2), keeping upstream file structure and attribution so
   future `shadcn` CLI diffs stay reviewable.
2. **Base UI, not Radix, and no mobile sheet.** Tooltip → installed Base
   UI tooltip; Collapsible → installed Base UI collapsible; `Slot` → Base
   UI render-prop pattern or a ~20-line local equivalent; NO Radix
   dependency. Delete the offcanvas/mobile path completely: `openMobile`,
   `isMobile`, `use-mobile`, the `"offcanvas"` type/default, the sheet
   Dialog, and upstream `hidden md:block` / `hidden md:flex` gating.
   `collapsible` supports `"icon"` (default) and `"none"` only. Document
   the deletion in the file header.
3. **HUD tokens.** Map `--sidebar`, `--sidebar-foreground`,
   `--sidebar-accent`, `--sidebar-border`, `--sidebar-ring`,
   `--sidebar-width` (260px), `--sidebar-width-icon` (48px) onto the HUD
   oklch tokens (registered per 0). Mono HUD skin preserved.
4. **Shell geometry (Codex blocker):**
   - The Frame HUD layer is full-screen `pointer-events-none`. Apply
     `pointer-events-auto` ONLY to the actual sidebar container/controls —
     never to the full-screen `SidebarProvider` wrapper, which would
     intercept the content pane.
   - Replace upstream `inset-y-0 h-svh` with explicit `top`/`bottom: 28px`
     geometry so the footer is not hidden beneath the StatusBar.
   - Resolve the top edge explicitly: today the fixed z-50 nav bar covers
     the sidebar header (the sco-083 brand is unreachable). Either start
     the sidebar below `navTotalHeight`, or layer it above the nav and
     inset the nav — pick one, document it, and verify the brand is
     clickable.
5. **Controlled state (Codex correction):** `useSidebarCollapse` stays
   canonical. Drive `SidebarProvider open={!effectiveCollapsed}` AND the
   shell `leftInset`/width from it. Add an idempotent
   `setCollapsed(next)` on the hook: wide viewport → updates
   `manualCollapsed`; auto-collapse viewport → updates session-only
   `forceExpanded`. Do NOT wire `onOpenChange` as
   `setManualCollapsed(!open)` — that breaks narrow-screen expansion.
   Delete shadcn's `sidebar_state` cookie write (usePersistentState owns
   persistence). Extract the state-transition logic into a pure function
   and test it (current tests cover only constants).
6. **Keyboard:** the SHELL owns `Cmd+B` — disable/remove shadcn's provider
   listener entirely (it has no editable/terminal guard; leaving both
   double-toggles because the shell doesn't stop propagation).
7. **Composition mapping (preserve current UX):**
   - `SidebarHeader`: Scout mark + product name (click → Home).
   - `SidebarContent`: "Navigate" group (Home, Projects, Sessions, Chat,
     Dispatch, Search) and "System" group (Ops, Settings) from
     `PRIMARY_AREAS` via `SidebarMenu*`; `SidebarMenuButton isActive` from
     `primaryAreaForRoute(route)`; collapsed-rail tooltips via the
     component's built-in tooltip path.
   - Context section: `resolveSidebarContext(route)` output as a third
     `SidebarGroup` ("Context") accepting arbitrary children, not just
     `SidebarMenu`. **Preserve `resolveSidebarContext().footer` as pinned
     UI OUTSIDE the scrolling `SidebarContent`** (current Mesh footer
     behavior must not change).
   - `SidebarFooter`: broker status + `SidebarTrigger`.
   - `SidebarRail`: omit (fixed 260/48 widths).
   - Scope rail: `useSidebarModel` scope items have no icons — preserve the
     current initial-letter fallback (or add icons) so the collapsed scope
     rail isn't blank.
8. **Keep everything presentation-agnostic:** `primary-areas.ts`,
   `ROUTE_AREA_BY_VIEW`, `resolveSidebarContext`, `useSidebarModel`, the
   `nav.sidebar` flag (default on; `?ff.nav.sidebar=off` → legacy chrome),
   breadcrumbs, machine scope in the top bar.
9. **Delete** `scout/sidebar/ScoutSidebar.tsx`'s custom markup and
   `scout-sidebar.css` once the shadcn tree is live (keep
   `useSidebarCollapse`/`useSidebarModel` — state, not markup). The legacy
   left panel stays untouched behind the flag-off path.

## Constraints

- URLs unchanged; router/nav suites green unmodified.
- **The HudsonKit `SidePanel` and the shadcn nav sidebar are separate
  components with separate jobs.** Do not extend, subclass, wrap, or
  restyle `SidePanel` into a sidebar, and do not route sidebar rendering
  through HudsonKit chrome. The shadcn sidebar owns left navigation
  (destinations + context); HudsonKit `SidePanel` owns the right inspector
  and, until the flag-off path is deleted, the legacy left rail. Shared
  concerns (collapse persistence, inset arithmetic) integrate through shell
  state/CSS vars, not through component coupling.
- No Radix dependency. `clsx`, `tailwind-merge`,
  `class-variance-authority` are permitted (see Requirement 0); nothing
  else new. Do NOT add the renamed `@base-ui/react` package — port to the
  installed `@base-ui-components/react@1.0.0-rc.0`.
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
