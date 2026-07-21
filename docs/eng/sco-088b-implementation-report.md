# SCO-088b implementation report — single 40px row + drag-collapse + live polish

Branch: `sco-088/anchored-l-polish` · Not committed (per instruction).
Covers `docs/eng/sco-088b-single-row-header-and-drag-collapse.md` plus two rounds of
live user feedback (the "addendum" and the "one-band / squared-nav" polish).

## Files changed (8, all `packages/web/client`)

| File | Scope |
|---|---|
| `scout/sidebar/sidebar-collapse-state.ts` | Pure `resolveRailDragGhostWidth` + `resolveRailDragCommit` + drag constants. |
| `scout/sidebar/useSidebarCollapse.ts` | Raw drag session + `dragStartedCollapsed` + `commitDrag` (same state machinery). |
| `scout/sidebar/useSidebarCollapse.test.ts` | +8 test cases / 25 assertions (side-rail band, ghost width, commit decision). |
| `scout/sidebar/CenterPaneHeader.tsx` | Merge to one inline row (breadcrumb · hairline · tabs · utilities). |
| `scout/sidebar/ScoutSideRail.tsx` | (from §3) chevron rides ghost — unchanged this round. |
| `OpenScoutAppShell.tsx` | Single-row geometry, drag-collapse handlers (both rails/both states), collapsed-edge handles. |
| `app.css` | Single-row header, whisper-quiet chevrons, one-band logo cell, squared nav highlights. |
| `styles/tokens.css` | (from §2) `--scout-rail-motion` — unchanged this round. |

## §1 — One 40px top row (supersedes sco-087b two-row)

- `SIDEBAR_TOP_ROW_HEIGHT 44→40`; removed the secondary-row height. `contentTopOffset = chromeTopOffset + 40`; all three chevrons share one `railToggleTop = contentTopOffset + 8` (the study's y≈48 band).
- Top row is now inset to the **sidebar only** (`left: sidebarCollapse.width`, was `+ sideRailPushWidth`) and spans over the context/center/detail columns. The side rail now begins **below** the row (`railTopStyle.top = contentTopOffset`, was `chromeTopOffset`).
- `CenterPaneHeader` top-row variant renders ONE row: breadcrumb · vertical hairline (`.scout-top-row-divider`) · `AREA_SUB_NAV` tabs inline · utilities pinned right. Tabs never wrap (`.scout-area-subnav` → `nowrap` + clip). Bottom hairline spans the inset width. Screens keep their in-content toolbars (content, not chrome).

## §2 — Drag-to-collapse / drag-to-expand (both left rails)

- **Pure logic** (tested): `resolveRailDragGhostWidth` previews continuously from the 48px collapsed target up to max — never dead-clamped at min (addendum's "no dead-end at min"); an expanded-rail drag past the collapse threshold snaps the ghost to 48 as a "release = collapse" affordance; a collapsed-rail drag grows from 48. `resolveRailDragCommit`: expanded → `collapse` below `min−40` (sidebar 160 / side rail 200), else `resize` clamped to [min,max]; collapsed → `expand` past `48+24` travel, else `none` (snap back).
- **Sidebar**: `useSidebarCollapse` gained a raw drag session + `commitDrag`, which routes through the SAME `setCollapsed`/persisted-width machinery as the chevron (incl. the auto-collapse layer); collapse/expand never overwrite the remembered expanded width. Handle now renders in BOTH states.
- **Side rail**: same gesture set in the shell against `leftCollapsed`/`leftWidth` (own `leftW` key, remembered on collapse). Handle renders in both states, on the side rail's own right edge.
- **Double-click**: expanded → reset to 260; collapsed → expand to 260. Both rails.
- **P3 held**: committed width + insets pinned during drag; exactly one commit on pointer-up (resize, collapse, or expand); ghost previews only; settle ghost + chevron easing skipped under reduced-motion.
- Hit-testing: sidebar handle on the sidebar/side-rail boundary, side-rail handle on the side-rail/content boundary (≥240px apart), each `z-50`; handles start below the chevron band so they never collide with a chevron. Inspector stays toggle-only.

## Addendum — whisper-quiet chevrons + continuous drag

- `.scout-rail-toggle` resting = **no fill, no border**, glyph at ~40% ink (14px) in the unchanged 22×28 hit area; hover/focus only = full ink + faint surface + hairline. Applies to all three chevrons in expanded AND collapsed.
- Continuous drag feel is the `resolveRailDragGhostWidth` behaviour above (no min dead-clamp, snap toward 48 past threshold, grow-from-48 on expand) — no intermediate stepping.

## Live polish — one band + squared nav highlights

- **One band**: SCOUT logo cell height `44→40` (button too) so the logo cell and the top row share height + a bottom hairline at the same y (both `ink 6%`), reading as one continuous horizontal arm from the logo to the right edge — in expanded and collapsed (icon-rail) states. macOS `titleBarInset` is carried by both, so they stay aligned.
- **Squared nav highlights** (scoped to `html[data-scout-sidebar-chrome]`, content untouched): sidebar menu-button + sub-button `border-radius: 0` (active nav item = flat rect + left 2px accent bar, like the mock); area sub-nav tab = clean squared underline only (removed the pill background + radius; hover signals by ink). One-green-accent preserved.

## Verification

- New pure-fn tests — **8 test cases / 25 assertions**, all green.
- Focused suites (`useSidebarCollapse`, `RailToggle`, `empty-context-collapse`, `useSidebarModel`, `resolve-sidebar-context`, `center-pane-header`, `router.navigation`) — **114 pass / 0 fail**.
- `bun run --cwd packages/web test` — **903 pass** (main) + isolated server (14/12/4/104/6/8) + node TAP (1), **0 fail**.
- `bun run --cwd packages/web build` — ✓ built in 11.4s; `dist` gitignored.
- `tsc -p packages/web` — no new errors in touched files; remaining errors are the known standing debt (stale test fixtures, `repo-diff`/`agents-v2` route-union) that CI does not enforce.

## Follow-ups / decisions flagged to the user

- **Ops/Chat secondary switcher** (`SecondaryNav`, `s-secondary-nav-*`) is a **segmented-switch** idiom (rounded container), distinct from the AREA_SUB_NAV underline tabs and used on other surfaces. I left it as-is rather than restyle a shared component globally. Decision for the user: should the Ops/Chat switch also be squared to match, or keep its switch idiom?
- Top-row vs sidebar **backgrounds** aren't forced to match (sidebar keeps `bg-sidebar`, top row `surface 92%`); the "one band" cue is the aligned hairline + height. Say if you also want identical fills.
- Not run in-browser here (headless): recommend a visual pass on the drag-collapse matrix, the one-band hairline at 1280/900, and reduced-motion.
