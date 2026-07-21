# SCO-088 implementation report — Anchored L polish

Branch: `sco-088/anchored-l-polish` · Not committed (per instruction).
Source of truth: `docs/eng/sco-088-anchored-l-polish.md` + `docs/design/navigation-study.md` § Option A.

## Files changed (6, all `packages/web/client`)

| File | Sections | What |
|---|---|---|
| `scout/sidebar/sidebar-collapse-state.ts` | §3 | `SIDE_RAIL_DEFAULT_WIDTH=260 / MIN=240 / MAX=400` + pure `clampSideRailWidth`. |
| `scout/sidebar/useSidebarCollapse.ts` | §3 | Re-export the new side-rail constants + `clampSideRailWidth`. |
| `styles/tokens.css` | §2 | `--scout-rail-motion: 160ms` token. |
| `app.css` | §1 §2 | Top-row rhythm, F1 softening, one-accent audit, chevron edge-glide, mount settle, settle-ghost, reduced-motion gate. |
| `scout/sidebar/ScoutSideRail.tsx` | §2 §3 | Drop HudsonKit live-resize (`onResizeStart`); add `dragGhostWidth` so the chevron rides the ghost edge. |
| `OpenScoutAppShell.tsx` | §1 §2 §3 | Side-rail ghost-resize handler + handle + ghost line, shared settle-ghost, `data-scout-double-rail` + `data-scout-rail-resizing` attributes, split left/right width clamp. |

Geometry unchanged (widths, offsets, `RailToggle`, collapsed 48px, chevron band, `?ff.nav.sidebar=off`). Inspector resize left as-is (HudsonKit `onResizeStart`).

## §1 Anchored L tightening

- **Top-row rhythm** — title band gap `8px 12px → 12px` (one 12px reading rhythm); the breadcrumb↔secondary-nav divider normalised to the ink 6–8% hairline band (`ink 5% → 7%`). Utilities already 26px ghost buttons; kept.
- **F1 double rail** — shell sets `data-scout-double-rail` only when the sidebar is collapsed **and** the side rail is collapsed **and** present. CSS then (a) drops the seam between them (`[data-slot="sidebar-container"]` right border → transparent) and (b) tints the collapsed side rail one step darker (`color-mix(--hud-bg 84%, --hud-surface)`, matching the mock). Outer boundary + both chevrons kept.
- **One-accent audit** — the only stray saturated chrome hue was a **dormant cyan fallback** (`#22d3ee`) on `.scout-nav-tab.active` (legacy nav, never rendered since `--hud-accent` is always defined); re-pointed to the green accent. Everything else already resolves to the single green (active nav bar/sub-nav underline, focus ring, ghost/resize lines) or ink. Kept honest status signals (broker-offline red, mesh amber/red) — these are state, not decoration.
- **Chevron spec** — all three already `22×28`, 1px hairline, `surface 92%`, radius 4 via `.scout-rail-toggle`; verified, no change.
- **Type spec** — already conformant to the study (brand 11/700/.08em, nav 11/500/.02em·16px·32px, group 9/.12em, broker 10/600/.04em + 6px dot); verified, no change.

## §2 Transitions — technique

Chosen so **P3 holds**: rail width + center-pane insets still commit in **one write** (no per-frame relayout); all added motion is composited overlay that "covers the snap":

1. **Chevron edge-glide** — `.scout-rail-toggle` transitions `left`/`right` (`--scout-rail-motion` ease-out) so chevrons glide with their edge on collapse/expand and on programmatic width changes. A chevron is a single `position:fixed` 22px element — repositioning it never reflows the center pane. Suppressed while any handle drags (`html[data-scout-rail-resizing]`) so it tracks the pointer live, and under reduced-motion.
2. **Collapsed-rail mount settle** — `.scout-collapsed-rail` fades in (`scout-rail-settle`, opacity only) once per collapse swap.
3. **Resize-commit settle ghost** — on pointer-up the width commits once (snap) while a 2px accent line is left at the committed edge and fades over 150ms (`scout-rail-settle-ghost`, opacity). Shared by both left handles. Skipped in JS under reduced-motion (+ CSS backstop).
4. Existing shadcn label opacity fade retained.

Durations 150–160ms ease-out (`--motion-ease-standard`), nothing bouncy. `prefers-reduced-motion` → all instant (extended the existing gate + JS guard).

## §3 Side-rail drag-to-resize

Ghost-edge, mirroring the sidebar: handle on the side rail's **right** edge (`x = navRailWidth + leftWidth − 3`, expanded + pushed only), committed `leftWidth` pinned during drag, ghost line previews the target, width commits once on pointer-up, double-click resets to 260. Persisted under the existing `appshell.<id>.leftW` key (its own key, separate from the inspector's `rightW`); collapse→re-expand restores it. Band clamped to 240/400 (left clamp split out from the inspector's viewport cap). Chevron rides the ghost via `dragGhostWidth`.

**Hit-testing** — the two handles live on different edges: sidebar handle at `x≈navRailWidth` (sidebar/side-rail boundary), side-rail handle at `x≈navRailWidth+leftWidth` (side-rail/content boundary), ≥240px apart, each `z-50`, 6px. HudsonKit's own side-rail handle was removed (`onResizeStart` dropped → it renders a static border instead), so there is no competing handle on that edge.

## Deviations

- **Top row stays 44px / two rows** (sco-087b geometry: title band + secondary-nav row), *not* the study's 40px single-row-with-vertical-hairline. The spec's "Geometry does NOT change" is a hard constraint and reverting the sco-087b split would regress recently-shipped work, so I applied the *rhythm/discipline* (12px gaps, hairline divider, ghost utilities) within the shipped geometry. The "one reading line" is the title band; the "hairline between breadcrumb and secondary nav" is the row divider.
- **Chevron `left`/`right` uses a positional transition**, not a FLIP transform. It's a single out-of-flow element (no center-pane reflow), so it honours P3 in spirit; full FLIP was unnecessary risk. Noted as available if strict transform-only is later required.
- **F1 tint** uses the mock's `--hud-bg 84%, --hud-surface` (concrete render) rather than the study prose's "bg 82%".

## Verification

- Focused nav/sidebar suites — **31 pass / 0 fail** (`useSidebarCollapse`, `RailToggle`, `empty-context-collapse`, `useSidebarModel`, `resolve-sidebar-context`).
- `bun run --cwd packages/web test` — **878 pass** (main) + isolated server suites (14/12/4/104/6/8) + node TAP (1), **0 fail** across the run.
- `bun run --cwd packages/web build` — ✓ built in 9.87s (only the pre-existing chunk-size warning). `dist` is gitignored.
- `tsc -p packages/web` — no new errors from these changes; the one error in a touched file (`OpenScoutAppShell.tsx:1341` `route.view === "agents-v2"`) is pre-existing standing debt in untouched legacy-panel code.

## Remaining gaps / follow-ups (not done here)

- Visual matrix (8 areas × rail states at 1280/900, both-collapsed F1, min/max resize + dbl-click, reduced-motion) not run in-browser here — recommend a screenshot pass.
- Expanded-panel *entrance* settle skipped (the side-rail body wrapper is `display:contents`, unanimatable); only the collapsed direction settles.
- Inspector ghost-edge treatment deliberately deferred (spec: follow-up only).
