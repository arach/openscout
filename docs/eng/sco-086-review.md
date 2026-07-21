# SCO-086 rail consistency — review (PR #405)

Reviewer: session-mru3m59t-5ma6cw · against spec `docs/eng/sco-086-rail-consistency.md`
Verdict: **MERGE-READY** (3 low/nit notes, all optional)

Tests: `bun run --cwd packages/web test` exit 0; focused suites (RailToggle,
useSidebarCollapse, empty-context-collapse, center-pane-header) 33 pass / 0 fail.

## Spec checklist

### (1) RailToggle pure + only collapse control — PASS
- `RailToggle.tsx` imports only `react` types — no HudsonKit/shadcn
  (`components/RailToggle.tsx:10`). Test asserts no `data-sidebar`/`data-hudson`
  in markup (`RailToggle.test.tsx:58-59`).
- Sidebar: one `SidebarEdgeToggle` → `useSidebar().toggleSidebar`
  (`ScoutSidebar.tsx:234-244,327`). Brand-row + footer `SidebarTrigger` both
  **removed** (diff confirms `- SidebarTrigger`). Logo is a static button →
  `goHome` (`ScoutSidebar.tsx:296-315`).
- Side rail: expanded `SidePanel` has **no** `onToggleCollapse`; external
  RailToggle on the trailing edge (`ScoutSideRail.tsx:104-137`).
- Inspector: `onToggleCollapse={sidebarChrome ? undefined : …}`,
  `isCollapsed={sidebarChrome ? false : …}` (`OpenScoutAppShell.tsx:1122-1124`),
  external RailToggle when expanded (`:1157-1171`).

### (2) CollapsedRail @48 + inset arithmetic + hidden≠collapsed — PASS
- One const `RAIL_COLLAPSED_WIDTH = 48` (`sidebar-collapse-state.ts:7`),
  reflected to `--scout-rail-collapsed-width` (`OpenScoutAppShell.tsx:368-371`,
  `app.css`). `--sidebar-width-icon` now derives from it.
- Side rail collapsed → `CollapsedRail edgeOffset=navRailWidth`
  (`ScoutSideRail.tsx:91-101`); push `leftCollapsed ? 48 : leftWidth`
  (`OpenScoutAppShell.tsx:865-867`).
- Inspector collapsed → `CollapsedRail` (`:1093-1103`); push
  `effectiveRightCollapsed ? (sidebarChrome ? 48 : 0) : rightWidth` (`:873-878`).
- HIDDEN stays 0: `scopeHidesRight`→`showRightPanel=false` (`:852,857`);
  inactive side rail via `sideRailActive` (`:863-867`); broker-without-sheet via
  `showRightPanel` gate (`:852`). No rail, no toggle in those.

### (3) Sidebar resize — PASS
- No write per mousemove: `updateResize` sets `dragWidth` state only; persist in
  `endResize` on pointer-up (`useSidebarCollapse.ts:136-149`).
- Clamp MIN200/MAX360/round (`sidebar-collapse-state.ts:34-40`, tested).
- Double-click → `resetExpandedWidth` → 260 (`useSidebarCollapse.ts:122-125`;
  handle `onDoubleClick` `OpenScoutAppShell.tsx:1006`).
- `isSidebarResizing` suppresses transitions on **both** sidebar container and
  center pane — inline `contentStyle` (`:909-912`), ScoutContent wrapper
  (`:1201-1204`), and CSS `html[data-scout-sidebar-resizing] …` (`app.css`).
- Handle z-50 over side-rail z-40 (`:1017`); starts `chromeTopOffset+40`, below
  the header chevron at `top:10` (`:1012`) — documented deviation, sound.

### (4) Subnav single-render + rightUtility — PASS
- `CenterPaneHeader` mounted only under `sidebarChrome`
  (`OpenScoutAppShell.tsx:1250`); all six content screens gate their own subnav on
  `!contentOwnsSecondaryNav` (Ops/Mesh/Harnesses/Conversations/Messages/Channels,
  both Channels branches). Exactly one renders.
- `rightUtility` optional; header returns `null` when nothing applies incl. no
  utility (`CenterPaneHeader.tsx:83`) — screens without utilities unaffected. No
  per-route registrations yet (documented follow-up).

### (5) Parity + empty-CONTEXT — PASS
- `areaSubNavForRoute` derives from `ROUTE_AREA_BY_VIEW` (`nav-destinations.ts`);
  parity test iterates the full map (`center-pane-header.test.ts:65-78`). No
  cycle — `primary-areas.ts` does not import `nav-destinations`. Mapping matches
  the old inline set exactly (projects: agents-v2/agent-info/repos/repo-diff/code;
  sessions: sessions/terminal).
- Empty-CONTEXT: `nextLanesContextToggle` preserves stored `rightCollapsed` when
  empty (`empty-context-collapse.ts:58-71`); test updated to codify preservation
  (`empty-context-collapse.test.ts:81-89`).

### (6) Legacy `?ff.nav.sidebar=off` — untouched
- `useContentOwnsSecondaryNav = !useOptionalFlag("nav.sidebar", false)` mirrors
  the existing shell gate (`OpenScoutAppShell.tsx:314`); legacy renders in-content
  subnav and keeps HudsonKit's floating collapse button (`onToggleCollapse` kept
  when `!sidebarChrome`).

## Notes (non-blocking)

- **N1 (low).** Right `CollapsedRail` renders on `sidebarChrome &&
  effectiveRightCollapsed` (`OpenScoutAppShell.tsx:1092`) without excluding
  `rightOverlay`/`autoOverlayRight`, while `rightPushInset` returns 0 in the
  overlay branch (`:874`). Reachable only if a user pin-overlays the inspector
  then collapses it (persisted `rightOverlay=true` + collapsed): the 48px rail
  floats over the content's right edge with no push. **Not a regression** — the
  old collapsed+floating SidePanel also had 0 push + a floating button (~36px);
  the rail is just wider now. Optional: skip CollapsedRail when
  `rightPanelOverlaysContent`, or accept the float.
- **N2 (nit).** Side-rail/inspector external RailToggles (`ScoutSideRail.tsx:124`,
  `OpenScoutAppShell.tsx:1157`) don't pass `onInteractiveMouseDown` for the macOS
  drag-region exemption the sidebar edge toggle uses (`ScoutSidebar.tsx:327`).
  They sit over the panels (not the brand drag strip), so likely fine — worth a
  quick macOS-embed click test; web unaffected.
- **N3 (nit).** `MessagesScreen`/`ChannelsScreen` return bare `content` in the
  sidebar-chrome branch (`MessagesScreen.tsx:51`, `ChannelsScreen.tsx:729,780`)
  while `ConversationsScreen` wraps in `s-secondary-nav-body--scroll`
  (`ConversationsScreen.tsx:214`). Intentional asymmetry (conversation screens
  self-manage height; the list needs the scroll wrapper) — just noting.

Next owner: **arach** — decide on N1 or accept; nothing blocking.
