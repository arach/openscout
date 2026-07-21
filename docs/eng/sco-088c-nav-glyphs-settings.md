# SCO-088c — Nav glyphs sizing + Settings pinned to sidebar bottom

Fast follow-up to sco-088/088b (`sco-088/anchored-l-polish`). User live-review
feedback after the one-band alignment landed ("we've got it perfect now").

Lands on its own branch (`sco-088c/nav-glyphs-settings`) AFTER #410 merges.

## §1 Bump up logo + glyphs

Nav chrome iconography is a touch too small. Bump one step:

- Sidebar nav item icons: 14 → 16px (expanded and collapsed icon rail — same
  glyph size in both).
- SCOUT logo mark: bump one step (16 → 18px) with wordmark baseline held;
  the 40px brand cell height does NOT change (one-band alignment is sacred).
- Optical alignment: icons stay optically centered against the 20px-ish label
  line; re-check collapsed rail centering at 48px.
- Do NOT bump the RailToggle chevron glyphs (just quieted on purpose), the
  top-row utility glyphs (26px ghost buttons stay), or in-content icons.

## §2 Settings to the sidebar bottom, Broker block out

- The sidebar-bottom `BROKER` status block is redundant (broker status already
  lives in the 28px status bar: `BROKER: UP`). Remove it from the sidebar.
- Pin a Settings entry at the sidebar bottom where Broker sits today:
  gear icon + `Settings` label when expanded; centered gear glyph when
  collapsed. Same destination as the current top-right gear (`/settings`
  route). Styling matches nav items (flat hover, no radius, left-accent when
  active if the settings route is active).
- Remove the gear from the top-right utilities (its function moves to the
  sidebar bottom). Scope control + ⌘K stay.
- Remove the duplicate `Settings` item from the sidebar SYSTEM nav section —
  Settings lives exactly once, pinned at the bottom. SYSTEM keeps `Ops`.

## Constraints (unchanged)

- One-band 40px top row, hairline alignment, one-accent rule, squared nav
  highlights, P3 motion, `?ff.nav.sidebar=off` legacy keeps working, URLs
  unchanged, no git commits.

## Verification

- Focused sidebar/nav tests + full `bun run --cwd packages/web test` + build.
- Visual: expanded + collapsed sidebar (glyph sizing, settings pinned bottom),
  top-right utilities without the gear, `/settings` reachable from the bottom
  entry, active state when on `/settings`.
