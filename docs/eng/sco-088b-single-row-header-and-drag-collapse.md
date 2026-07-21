# SCO-088b — Match the Anchored L study: single 40px top row + drag-collapse rails

Follow-up to `sco-088-anchored-l-polish.md` (same branch, `sco-088/anchored-l-polish`).
User directive: **the Anchored L study is the spec** — the current build does not match it.

Source of truth:
- `design/navigation-study/option-a-anchored-l.html` (annotated mock)
- Studio study page: `/studies/app-nav` → Part 1 difference matrix, Option A column:
  - TOP-LEFT CORNER: sidebar · brand
  - TOP BAR SPAN: inset to content
  - COLLAPSED LEFT: 48 + 48 · double rail
  - PERMANENT HORIZONTAL: **40 top · 28 status**

## §1 Header: merge to ONE 40px top row

The build currently renders two shell header rows (sco-087b: 44px title row +
sub-nav row below). The study specifies ONE 40px top row. The two-row split is
**superseded** by this spec.

- One 40px row, inset to content (starts at the sidebar's right edge, spans
  context + center + detail columns to the right window edge).
- Row contents, left → right, following the mock (`projects / openscout · RECENT ALL`):
  1. Area title / breadcrumb (what row 1 shows today, e.g. `OPS`).
  2. The `AREA_SUB_NAV` tabs inline on the same row (today's row 2), separated
     from the title by a hairline or 12px+ gap per the sco-088 rhythm.
  3. Right utilities unchanged (26px ghosts, 12px gaps, scope control).
- Bottom hairline divider under the row, spanning the full inset width; columns
  begin below it.
- Tabs never wrap to a second row. If space is tight, condense (smaller gap,
  then horizontal scroll within the tab cluster). Utilities stay pinned right.
- Screens keep their in-content toolbars (e.g. the lanes `13 live · trace 5m …
  + Lane` strip) — that is content, not chrome; it stays.
- Top-left corner ownership unchanged: sidebar (brand) owns the corner; the top
  row never extends over the sidebar.
- Status bar stays 28px.

## §2 Drag-to-collapse / drag-to-expand on BOTH left rails

Today drag-resize clamps at min width (sidebar 200, side rail 240) and only the
RailToggle chevron changes collapse state. Add continuous drag through collapse:

- **Expanded → collapsed:** dragging the rail's edge inward past a collapse
  threshold commits collapse on pointer-up (to the shared 48px
  `RAIL_COLLAPSED_WIDTH`). Suggested threshold with hysteresis: collapse when
  the live drag width drops below `min - 40` (sidebar: 160, side rail: 200).
  Between min and threshold, clamp to min as today (no dead zone feel).
- **Collapsed → expanded:** the collapsed rail's edge remains a drag target.
  Dragging it outward past a small threshold (≥ 24px of rightward travel, or
  live width > 48 + 24) commits expand on pointer-up to the remembered
  width (the last committed expanded width, clamped ≥ min). A tiny accidental
  drag (< threshold) snaps back, no state change.
- Applies identically to the nav sidebar (right edge) and the side rail
  (right edge). Inspector rail is out of scope (still toggle-only).
- Remembered width: collapsing via drag does NOT overwrite the persisted
  expanded width; re-expand restores it (same as chevron collapse→expand).
- Double-click on the edge: if expanded, reset to default width (260) as
  today; if collapsed, expand to default width.
- Collapse via drag uses the same state machinery as the chevron
  (`setCollapsed` / `applySetCollapsed`), including the auto-collapse
  viewport layer — do not bypass `useSidebarCollapse`.

## §3 Hold the line (unchanged constraints)

- P3 motion: committed layout width and all insets stay pinned during drag;
  exactly one layout commit on pointer-up (width change, collapse, or expand —
  all commit once). Ghost edge paints the live target only.
  `prefers-reduced-motion`: instant, no overlays.
- RailToggle chevrons stay as the dedicated click toggles at the shared band;
  hit-testing: each handle wins its own edge; chevrons keep 22×28 hit area.
- One-accent rule, hairline dividers, F1 double-rail softening (48+48) — keep.
- `?ff.nav.sidebar=off` legacy chrome keeps working.
- URLs unchanged; scope stays path-driven.
- No git commits — leave changes in the working tree.

## §4 Live-review addenda (user feedback during implementation)

### §4.1 RailToggle chevrons: whisper-quiet

The boxed chevron button in the top band reads too loud. Resting state: no
fill, no border, glyph only at ~35–45% ink, ~14px glyph inside the existing
22×28 hit area. Hover only: full ink + hairline/faint surface. Same position
(shared band), same hit area, all three rails, expanded and collapsed.

### §4.2 Resize feel: continuous travel, no dead stops

- Inward drag must not dead-end at min width — ghost continues past min and
  eases/snaps toward the 48px collapsed target once the pointer crosses the
  collapse threshold (affordance only; layout still commits once on
  pointer-up, P3 holds).
- Outward drag from collapsed: ghost grows from 48 with the pointer; expand
  commits past the §2 threshold.
- No intermediate stepping anywhere on either left rail.

### §4.3 Top of the L reads as one band

Sidebar logo row (brand cell) and the content top row: identical 40px height,
shared text baseline, bottom hairlines on the same y — one continuous band
from logo to right window edge. Holds in expanded AND collapsed (icon rail
logo cell) states.

### §4.4 No border-radius on nav chrome highlights

Square off all navigation-chrome active/hover treatments:
sidebar nav items (flat rectangle or left-accent bar per the option-a mock),
sidebar sub-items, and the top sub-nav tab active treatment (clean squared
underline, no pill/box). One-green-accent rule kept. Nav chrome only —
in-content cards/buttons keep their own styling.

## Verification

- `bun test packages/web/client/scout/sidebar packages/web/client/components/RailToggle.test.tsx packages/web/client/lib/router.test.ts`
- `bun run --cwd packages/web test`
- `bun run --cwd packages/web build`
- Add/extend unit tests: collapse threshold transitions (pure functions in
  `sidebar-collapse-state.ts`), expand-from-collapsed threshold, remembered
  width restore, clamp behavior between threshold and min.
- Manual matrix (report screenshots not required, but verify): expanded,
  sidebar-collapsed, side-rail-collapsed, both-collapsed (48+48), drag each
  rail through collapse and back, dbl-click reset, narrow viewport
  auto-collapse, `?ff.nav.sidebar=off`.
