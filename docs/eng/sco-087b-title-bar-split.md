# SCO-087b: Title bar split + header/chevron alignment

Status: implemented, uncommitted (branch `sco-087b/title-bar-split`, off `main`
with sco-087 merged). Follow-up to `sco-087-top-row-chevron-rail-perf.md`.
Two operator directives handled in one pass; verified by build + focused suites +
headless screenshots. Legacy `?ff.nav.sidebar=off` path untouched; no git commit.

## Directive 1 — title bar sits empty of tabs; secondary nav gets its own row

The top row now stacks **two shell-owned rows** instead of cramming everything
into one:

- **Title band** (44px): breadcrumb / page title on the left, right-side
  utilities (machine scope · settings · ⌘K) on the right. No tabs.
- **Secondary-nav row** (directly below): the "tabs" — `OpsSubnav`,
  `ChatSubnav`, and the projects/sessions area sub-nav — moved down here.
  Still 100% shell-driven (`secondaryNavConfig` / `useContentOwnsSecondaryNav`);
  screens do not re-render their own strips.
- **Empty state**: routes with no content nav (Home, Search) render **no second
  row** — the title band stays flush and `contentTopOffset` omits it.

`contentTopOffset` stays a single consistent value across the center pane, side
rail and inspector: `chromeTopOffset + SIDEBAR_TOP_ROW_HEIGHT (44) +
(hasSecondaryNavRow ? SECONDARY_NAV_ROW_HEIGHT (38) : 0)`. The shell and
`CenterPaneHeader` derive the second-row presence from the same pure helper
(`hasSecondaryNavRow`) so the frame height and the render never drift.

## Directive 2 — header alignment: one clean top grid line + chevron band

1. **One top grid line** across sidebar + side rail + title bar. The side rail
   now **rises to the title band** (`top: chromeTopOffset`), so its header
   (HOME / OPS / CHAT …) shares the SCOUT brand + title-bar baseline. The title
   bar frame starts to the *right* of the side rail (`left = sidebar + side-rail
   width`) so the risen rail header is never overpainted. The SCOUT brand band is
   pinned to the same 44px height (was an `h-12` button + `p-2` sitting ~10px
   low).
2. **Chevrons on the boundary at the shared band.** Sidebar-edge + side-rail
   chevrons ride the title band (`chromeTopOffset + (44-28)/2`), centered on their
   rail's boundary line. The rail/inspector header titles get extra left
   clearance so they read as their own label, not glued to the chevron
   ("‹ OPS" / "› CONTEXT"). The inspector chevron keeps its own header-band offset
   (it sits below the full top row; not in scope for the top grid line).
3. Sidebar drag-resize handle + ghost edge re-anchored to the title band; the
   sidebar chevron still rides the ghost width during resize.

## Constants (OpenScoutAppShell.tsx)

- `RAIL_HEADER_HEIGHT = 44` → `SIDEBAR_TOP_ROW_HEIGHT` (one shared top-band height)
- `SECONDARY_NAV_ROW_HEIGHT = 38`
- `titleBandToggleTop` (sidebar + side rail) vs `inspectorToggleTop` (inspector)
- `railTopStyle` (side rail → title band) vs `panelTopStyle` (inspector →
  below top row)

## Files changed

- `client/scout/sidebar/center-pane-header-state.ts` — add `hasSecondaryNavRow`.
- `client/scout/sidebar/CenterPaneHeader.tsx` — two stacked rows for the top-row
  variant (title row + secondary row); legacy single-row branch preserved.
- `client/OpenScoutAppShell.tsx` — dynamic top-row height + `contentTopOffset`;
  frame starts after the side rail; side rail rises; split chevron offsets;
  resize-handle/ghost re-anchor.
- `client/scout/sidebar/ScoutSidebar.tsx` — brand row on the grid line
  (titleBarInset-only top padding + `data-sidebar="brand-row"` hook).
- `client/app.css` — two-row top-row styles; brand-band 44px pin; risen
  rail/inspector header left-clearance (scoped to sidebar chrome).
- `client/scout/sidebar/center-pane-header.test.ts` — cover `hasSecondaryNavRow`
  (Ops/Chat + area sub-nav true; Home/Search false).

## Verification

- `bun test` sidebar/nav/rail suites: 53 pass. Broader scout/components/ops/chat:
  165 pass. Client `vite build`: green.
- Headless screenshots (1280×900, `ff.nav.sidebar=on`): `/ops/lanes` (collapsed
  + expanded), `/agents-v2` (area sub-nav), `/inbox` (empty state, no 2nd row),
  `/messages` (chat subnav) — all show one clean top grid line, tabs in row 2,
  chevrons on the boundary in the title band. `?ff.nav.sidebar=off` unchanged.

## Notes / open items

- Pre-existing tsc error at `OpenScoutAppShell.tsx` (legacy left-`SidePanel`
  `route.view === "agents-v2"` title comparison) is standing debt on main — NOT
  introduced here (diff touches no `agents-v2` line).
- Inspector header/chevron intentionally stay below the full top row (operator
  scoped the grid line to sidebar + side rail). Easy to raise later if wanted.
