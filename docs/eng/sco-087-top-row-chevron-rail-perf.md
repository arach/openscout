# SCO-087: Top row returns, chevron alignment, rail animation performance

Status: draft, user-directed fixes
Scope: `packages/web` chrome — three problems the user hit while using the
sco-085/086 build live. Solve them together; the user asked for a strong
model to decompose and fix all three in one pass.

## Problem 1 — bring back the top row

The sco-085 top-bar removal went too far: in daily use the app feels
unanchored without a horizontal top row. Restore one — but slim and
deliberate, not the old `ScoutNavigationBar`:

- A single app-wide top row in the sidebar-chrome path, at a consistent
  height, owning: page title/breadcrumb (from `CenterPaneHeader`), the
  page-level secondary nav (already moved there by sco-086), machine
  scope control, and the right-side utilities (settings accelerator,
  command trigger).
- The sidebar no longer pretends to be the full app frame: keep the
  full-height sidebar as-is (logo top-left is fine and liked), but
  utilities that landed awkwardly in its footer (machine scope popover,
  ⌘K) may move back to the top row where they fit. Machine scope: exactly
  one instance, either top row or sidebar footer — pick the top row.
- Preserve what worked: `CenterPaneHeader` as the content/title seam,
  sub-nav in the title area, breadcrumbs. The top row is the natural home
  for all of it — consolidate rather than duplicate.
- The legacy `?ff.nav.sidebar=off` chrome is untouched.
- Frameless/macOS drag region must keep working (a top row makes this
  easier, not harder — put the drag region back where users expect it).

## Problem 2 — edge chevrons don't align with their edges

The sco-086 `RailToggle` edge chevrons sit awkwardly relative to the rail
boundaries they belong to (visually off the edge line / wrong side /
inconsistent across the three rails). Fix placement so each chevron:

- sits exactly ON the boundary line of its rail (centered on the border),
- at the same vertical position (header/title-bar height) for all three
  rails (sidebar, side rail, inspector),
- points the correct direction for its side and state (`‹`/`›` per
  expanded/collapsed, left/right),
- stays attached to its rail during sidebar drag-resize (the sidebar's
  chevron must ride the moving edge, not lag or detach).

## Problem 3 — rail collapse/expand is too expensive on heavy pages

Today a rail toggle animates layout properties (`width`/`left`) across
multiple elements simultaneously (sidebar, side rail, center pane,
insets), forcing full-page relayout + repaint on every frame. On heavy
screens (lanes, sessions) this is visibly janky.

Goal: make collapse/expand ONE composited animation, then commit final
layout once. Approach is the implementer's call, within these guardrails:

- Animate only GPU-composited properties (transform/opacity) during the
  motion — the rail slides/fades over static content; no per-frame
  relayout of the page.
- Commit the real inset arithmetic exactly once (at animation start or
  end — pick and document), in a single write, so the page reflows at
  most once per toggle.
- Same treatment for the sidebar drag-resize: during drag, do not
  continuously relayout the center pane — resize visuals via transform
  (or a ghost edge) and commit the width once on pointer-up.
- Respect `prefers-reduced-motion` (instant commit, no animation).
- Keep the existing `isSidebarResizing` transition-suppression hooks if
  still useful; remove transition CSS that becomes dead.
- Behavior parity: final resting states (widths, insets, persisted prefs)
  identical to today; no URL or state-model changes.

## Constraints

- URLs unchanged; router/nav suites green unmodified.
- Sidebar and HudsonKit `SidePanel` stay separate components; `RailToggle`
  stays the single affordance.
- `?ff.nav.sidebar=off` legacy path untouched.
- Collapse/resize state semantics unchanged (manual persisted, derived
  auto-collapse, persisted expandedWidth 200–360).
- Scope + embeds unchanged.
- Do not git commit. Do not touch the unrelated MessageComposer / voice /
  design-studio files in the working tree.

## Verification

- `bun run --cwd packages/web test` + build green; focused nav/sidebar
  suites green; update/add tests for any state-transition changes.
- Visual matrix: all 8 areas at 1280/900 with the top row; chevron
  alignment on all three rails in expanded + collapsed states; resize
  drag; one scope surface; one embed; legacy path.
- Performance: describe the before/after frame cost qualitatively (what
  animates now vs before), and verify by feel on `/ops/lanes` and
  `/sessions` — collapse/expand must not visibly jank.

## Report back

Files changed per problem, the animation approach chosen and why, any
behavior changes, test/build results, remaining gaps.
