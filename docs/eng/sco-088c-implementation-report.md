# SCO-088c implementation report — nav glyphs, Settings, collapsed-rail fix, Codex blockers

Branch: `sco-088/anchored-l-polish` (operator said "same tree"). Covers `docs/eng/sco-088c-nav-glyphs-settings.md`, the collapsed-rail label bug, Codex's PR #410 review (6 blockers + 2 nits + a doc nit), and three further live-feedback polish rounds (left gap / sub-nav breathing / section-name breadcrumb, and the collapsed-rail tooltip).

> Git-state note: I did **not** run `git commit`. An in-flight checkpoint automation on this shared tree committed most of my edits (`e66cac46`, `3ce70cfb`); my latest `app.css` tweaks remain uncommitted (`M app.css`). The full working tree (committed + uncommitted) is coherent and is what passes build + tests.

## Files changed

`app.css`, `OpenScoutAppShell.tsx`, `scout/sidebar/{ScoutSidebar,CenterPaneHeader,TopRowUtilities,ScoutSideRail,sidebar-collapse-state,useSidebarCollapse,center-pane-header.test}.tsx/ts`, `components/ui/tooltip.tsx`, and the sco-088b report (doc nit).

## sco-088c §1 — nav glyph bump

Root font-size is 13px, so shadcn's `[&_svg]:size-4` (`1rem`) rendered nav icons at ~13px and force-shrank the logo. Added `app.css` overrides (specificity beats `[&_svg]:size-4`): nav item icons **16px** (expanded + collapsed), SCOUT logo mark **18px**. 40px brand cell + one-band alignment unchanged. Chevrons, top-row utilities, in-content icons untouched.

## sco-088c §2 — Settings pinned bottom, Broker out

- `ScoutSidebar` footer: `BrokerStatusLine` removed; a **Settings** nav entry pinned there (gear + label expanded / centered gear collapsed, `openSettings()` → `/settings`, nav-item styling, left-accent when the settings route is active). Broker status now lives only in the 28px status bar.
- `TopRowUtilities`: gear removed (scope control + ⌘K stay).
- Settings removed from the rendered SYSTEM list (kept in the `primary-areas` data model for routing/active-state + integrity tests) — SYSTEM keeps Ops; Settings lives exactly once.

## Collapsed-rail bug — icons only

Collapsed nav buttons showed label boxes bleeding past the 48px rail. Fix: in the collapsed state (`.group[data-collapsible="icon"]`) hide the **label span only** (`> span:last-child`) — the icon/glyph (svg, or a scope item's first-span initial) stays; the hover tooltip still carries the label.

## Codex PR #410 blockers

1. **P3 — no layout animation.** Removed the chevron `left/right` CSS transitions + the `data-scout-rail-resizing` gate; the chevrons (sidebar + side rail) no longer ride the ghost — they stay pinned during drag and snap to the committed edge on commit. Only colour/hover fades remain. (`app.css`, `OpenScoutAppShell.tsx`, `ScoutSideRail.tsx`)
2. **Side-rail handle in overlay.** Dropped the `!leftPanelOverlaysContent` guard — the handle (and drag-collapse/expand) now works in overlay mode / narrow viewports.
3. **Legacy key.** The `leftW` clamp to 240–400 now applies only when sidebar chrome is ON; `?ff.nav.sidebar=off` keeps the legacy `SIDE_PANEL_MIN..max` clamp so legacy widths aren't truncated.
4. **Tabs scroll, not clip.** The inline tab cluster is `overflow-x: auto` (thin) instead of `overflow: hidden` — no clipped-but-focusable tabs.
5. **Reduced-motion.** `reducedMotion` is now a reactive state; under reduced motion ALL live drag ghosts are unmounted (not just the settle ghost) — instant, no moving overlays; width still commits on pointer-up.
6. **One-band hairline when expanded.** Moved the scope-section out of `SidebarHeader` so the header is always exactly the 40px brand row — its bottom hairline (ink 6%) stays aligned with the top-row hairline in scope AND non-scope.
- Nits: pointer gestures now share a `cleanup()` bound to `pointerup` + `pointercancel` + window `blur` (no stuck drag state); `center-pane-header.test.ts` wording updated off the superseded two-row DOM; report wording corrected to "8 test cases / 25 assertions". Pure threshold logic left unchanged (Codex confirmed correct).

## Further live-feedback polish

- **Left gap** tightened: top-row left padding 14→10.
- **Sub-nav breathing**: tab cluster gets small top/bottom padding inside the 40px row (height unchanged).
- **Section-name breadcrumb**: the top row leads with the primary-area label (e.g. `Sessions`) · a dim `/` · the tabs. No sub-nav → section name only. Using the section label (not the deep route breadcrumb) removes the duplicated dim leaf (the old `/ops/lanes` "Lanes") — consistent everywhere.
- **Collapsed-rail tooltip**: dark surface fill + a single low-ink hairline (no light border), a step larger in type + padding, vertically centered on the trigger with a consistent 8px offset — same for every item incl. the bottom Settings gear.

## Verification

- Focused sidebar/nav/router suites (`useSidebarCollapse`, `RailToggle`, `center-pane-header`, `useSidebarModel`, `empty-context-collapse`, `resolve-sidebar-context`, `primary-areas`, `router.navigation`) — **121 pass / 0 fail**.
- `bun run --cwd packages/web test` — **903 pass** + isolated server + node TAP. One isolated server test flaked once on a `git` probe **timeout** (5s, system under load) and passed 8/0 on isolated re-run — environmental, unrelated to these client-chrome changes.
- `bun run --cwd packages/web build` — ✓ built in ~22s.
- `tsc -p packages/web` — no new errors in touched files; remaining errors are the standing stale-fixture / route-union debt (`repo-diff`, `agents-v2`, `primary-areas.test`) CI does not enforce.

## Flagged for the user

- **Ops/Chat segmented switcher** (`SecondaryNav`) is still a rounded switch idiom (shared component) — left as-is; squaring it is a separate decision.
- **In-flight auto-commits** on this shared tree (above) — surfaced so you know some of this work is already committed and my latest `app.css` is not.
- Not run in-browser (headless): recommend a visual pass on the collapsed rail (icons-only + tooltip), glyph sizes, Settings-at-bottom, section-name row, and the drag matrix under reduced motion.
