# SCO-088: Anchored L tightening, rail transitions, dual drag-resize

Status: approved direction (user green-lit Option A, 2026-07-21)
Scope: `packages/web` chrome — apply the Anchored L refinements from
`docs/design/navigation-study.md` (§ Option A), make rail transitions feel
deliberate, and give BOTH left rails drag-to-resize.

## 1. Anchored L tightening (study § Option A — follow it)

Geometry does NOT change (full-height sidebar, inset top row, chevron band
at y 48). Discipline does:

- **Top row as one reading line:** consistent 12px gaps; one hairline
  divider between breadcrumb and secondary nav; utilities as 26px ghost
  buttons; height 40; padding `0 12 0 14`.
- **Soften the double rail (F1):** when both left rails are collapsed,
  drop the border BETWEEN them and tint the collapsed side rail one step
  darker than the icon rail, so 0–48 reads as "nav" and 48–96 as "context
  handle" — not two identical strips. Keep the single outer boundary and
  both chevrons.
- **One accent:** the only saturated chrome color is the green — active
  nav bar, active sub-nav underline, focus ring, broker OK dot, ghost
  resize line. Everything else ink at 48–92% opacity. Audit and remove any
  stray saturated chrome.
- **Chevron spec:** all three chevrons 22×28, hairline border,
  `surface 92%`, centered on their boundary at the y 48 band.
- **Type/spacing spec:** brand 11px/700/0.08em uppercase; nav items
  11px/500/0.02em, 16px icons, 32px rows; group labels 9px/0.12em
  uppercase; broker line 10px/600/0.04em uppercase + 6px dot; hairlines
  ink 6–8%.

## 2. Transitions that feel deliberate

Current state (sco-087): collapse/expand commits insets in one write and
the only motion is the shadcn label opacity fade. Functional but abrupt.

Make the motion feel intentional WITHOUT regressing sco-087 P3 (no
per-frame relayout; composited properties only; `prefers-reduced-motion`
instant):

- Sidebar collapse/expand: the rail slides/clips smoothly between 48px and
  the expanded width using composited techniques (e.g. animate a clip or
  transform on a fixed-width inner, or FLIP-style transform from old to
  new edge), labels fading in AFTER the rail reaches its width (or out
  before it leaves). The content pane must not relayout per frame — commit
  insets once, as today, and make the visual motion cover the snap.
- Side rail + inspector collapse/expand: same treatment.
- The chevrons should glide with their rail's edge, not jump.
- Drag-resize ghost edge: animate the commit on pointer-up (a quick
  settle, ~120ms) rather than an instant jump.
- Keep durations honest: 120–200ms, ease-out; nothing bouncy.

## 3. Both left rails drag-to-resize

The sidebar already has ghost-edge resize (persisted 200–360, dbl-click
reset). Give the SIDE RAIL the same treatment:

- Drag handle on the side rail's right edge (expanded only), ghost edge
  during drag, commit once on pointer-up.
- Width: default 260, min 240, max 400 (study: side rail min-width 240).
- Persisted under its own key; double-click resets to 260.
- The resize must not fight the sidebar's own resize (handles on
  different edges of the same boundary region — sidebar's right edge is
  the sidebar/side-rail boundary; the side rail's right edge is the
  side-rail/content boundary. Make sure each handle wins hit-testing on
  its own edge).
- Collapsing then re-expanding restores the user's resized width.
- Inspector resize already exists via HudsonKit `onResizeStart` — leave
  it, but note whether it deserves the ghost treatment (follow-up only,
  don't rebuild it here).

## Constraints

- URLs unchanged; router/nav suites green unmodified.
- sco-087 P3 holds: composited properties during motion, ≤1 layout commit
  per toggle; `prefers-reduced-motion` instant.
- `RailToggle` stays the single collapse affordance; logo static;
  collapsed-width constant unchanged.
- `?ff.nav.sidebar=off` legacy path untouched; scope + embeds unchanged.
- Do not git commit. Do not touch the unrelated MessageComposer / voice /
  design-studio / landing files in the working tree.

## Verification

- `bun run --cwd packages/web test` + build green; focused nav/sidebar
  suites green.
- Visual: all 8 areas × expanded/collapsed at 1280/900; both-collapsed
  rails show the F1 softening; resize both left rails to min and max,
  double-click reset, collapse → re-expand restores width; transitions
  feel smooth on `/ops/lanes` and `/sessions`; reduced-motion instant.
- Hit-test: both resize handles win `elementFromPoint` on their own
  edges.

## Report back

Files changed per section, the transition technique chosen, deviations,
test/build results, remaining gaps.
