# Landing mission-sheet visual pass — report

Owner: session-mruvx8g6-q0k6ns · date: 2026-07-21
Page: `landing/openscout.app` (`http://localhost:3002/`)

## Brief
Take over the landing "NASA / mission-control" visual pass. Keep what the user
liked — the concept, the white translucent hero wash, page texture, the left
ruler idea — but fix poor execution. Hard constraint: **every original hero and
section eyebrow/title must visibly remain**; do not replace the content
hierarchy with rail labels. No commit.

## Diagnosis (from the live page, desktop + mobile)
Nothing was ever deleted in the markup — every `<h1>`, eyebrow, and section
title was still present. They *read* as "removed" because the mission scaffold
buried and paraphrased them. The real defects:

1. **Fake clock ruler** — a left margin rail titled `MISSION TIME` with
   fabricated timestamps `00:00 / 00:15 / … / 01:00`. Pure gimmick; the numbers
   meant nothing.
2. **Floating costume labels over the hero** — `FLIGHT PLAN / PROCEDURE /
   VERIFY` and a boxed `REV 02 / SESSION CONTROL / LIVE`. Unexplained, referred
   to nothing.
3. **Redundant section index** — each band rendered `data-mission="0N /
   <paraphrased title>"` (e.g. `02 / why scout`) as a rail label sitting
   directly above the real `WHY SCOUT` eyebrow → the section label appeared
   twice, in two different wordings. This is what made the titles feel replaced.
4. **Repeated-crop noise** — the same `mission-sheet-field.webp` was re-cropped
   six times (one bespoke position/mask/opacity per section), so every band
   read as "the same picture parked behind," plus two grid overlays = busy.

## The pass
Kept: NASA direction, the generated sheet as the hero's establishing artifact,
the white translucent hero wash (`.hero-editorial::before`), quiet page texture,
the left-ruler idea.

Changed:
- **Ruler → one honest rule.** Replaced the fake clock with a single measured
  margin line running the height of the page (`.mission-page-ruler`): strong
  across the hero with fine ticks ("measured sheet edge"), settling to a
  hairline below. No fabricated readouts.
- **Removed the hero costume labels** (`.mission-hero__rail`,
  `.mission-hero__revision`) entirely — markup and CSS.
- **Index → bare registration number.** `data-mission` is now just `02`…`07`
  (01 is the hero), rendered as a terse mono mark riding the ruler spine. It
  never restates the eyebrow; the eyebrow/title remain the content hierarchy.
- **Texture → one continuous sheet.** Dropped the six per-section webp crops;
  bands now carry a single quiet, uniform graph grid whose verticals share the
  hero field's 12.5rem rhythm, so the page reads as one surface. The mission
  plot stays the hero moment; nothing competes with the copy.
- Cleaned the now-dead mobile rules for the removed elements.

## Changed files
- `landing/openscout.app/src/app/page.tsx` — removed clock-ruler spans, hero
  rail/revision markup; `data-mission` values → bare numbers.
- `landing/openscout.app/src/app/globals.css` — rewrote ruler; removed
  rail/revision + 6 per-section crops; unified grid; slim index. Net simpler
  (~209 deletions / ~51 insertions).
- `landing/openscout.app/public/visuals/mission-sheet-field.webp` — untouched
  (pre-existing asset, still used as the hero sheet).

## Verification
- `tsc --noEmit` on the landing package: **0 errors**.
- Rendered checks at 1440px (full page + hero 2×) and 390px mobile: fake clock,
  hero costume labels, and duplicate index all gone; every eyebrow/title present
  and dominant; grid quiet and consistent; ruler/index suppressed on mobile as
  intended; hero wash retained.

## Resume (2026-07-21, later) — dark-mode QA + sheet visibility
Pass was paused then resumed. On resume the branch had merged to main
(`codex/grouped-product-polish`, my pass landed via PR #410 `c8ef24bb`; the GA
fix landed as `205ac0ec`), and the :3002 dev server had been stopped — restarted
it to keep inspecting.

Fresh QA in **both themes** confirmed the merged result is clean: every
eyebrow/title dominant, ruler/index restrained, grid quiet, no regression.

Key finding: `landing/src/lib/site-theme.ts` defaults **production
(openscout.app) to dark**, so dark is the version most visitors see — and there
the mission-sheet render sat at `opacity: 0.1`, effectively invisible. One
restrained fix: dark hero sheet `0.1 → 0.22` so the inverted plot registers as a
faint light-on-dark console-style backdrop. Light mode untouched; verified no
noise introduced. **Uncommitted.**

Next lever (not done, needs a call): the sheet's densest plot currently sits
behind the console mock. To make the render more present on dark/prod, nudge its
`background-position` into the visible gap left of the console. Left to the
operator.

## Note on repo state
The checkout moved during the session: branch went from
`sco-088/anchored-l-polish` → `codex/grouped-product-polish`, and a concurrent
process committed this exact working tree as `89db0119 "🎨 refine mission-sheet
visual hierarchy"` (authored by the user). I did **not** commit. HEAD now equals
these edits, so `git status` is clean. Flagging the branch move per the shared-
tree convention.
