# Review: SCO-083 sidebar navigation

Reviewed on 2026-07-20 against `1bf4c96c` and the current working tree. The
source proposal is `docs/eng/sco-083-sidebar-navigation.md`.

## Verdict

**Revise before implementation.** The sidebar direction, eight-item target,
URL-preservation constraint, and staged deletion are sound. The listed table is
also mechanically complete: it names each of the 21 current `Route["view"]`
variants exactly once.

The implementation model is not yet sound, however. A destination row is not a
route-view row; the existing catalog cannot prove the proposed partition. The
mapping also conflicts with current product groupings in several places, the
Ops gate would hide two deliberately ungated routes, deleting the jump dock
would delete the Mesh rack/minimap, Scope is path-gated rather than flag-gated,
and HudsonKit's current left-panel collapse is not a 48 px icon rail.

Focused current-state verification passed:

```text
bun test packages/web/client/lib/router.navigation.test.ts \
  packages/web/client/scout/nav-destinations.test.ts \
  packages/web/client/scout/topNavConfig.test.ts \
  packages/web/client/scout/secondaryNavConfig.test.ts

84 pass, 0 fail
```

## Findings

### High: the 21-view table is exhaustive, but `area` on each destination cannot prove it

The arithmetic in the proposal is correct: `1 + 4 + 3 + 3 + 1 + 1 + 7 + 1 =
21`, and those names match the union in `client/lib/types.ts`.

The proposed storage and active-state rules are not correct for the current
catalog:

- `NAV_DESTINATIONS` has 19 *destinations*, not one row per view. It has no row
  for `agent-info`, `conversation`, `repo-diff`, `briefings`, `work`, or
  `follow`; other rows' broad `active` functions cover some, but not all, of
  those cases.
- Conversely, `ops` is represented by several destination rows (`tail`,
  `mission-control`, `lanes`, `runtime`, and `plans`) with intentionally
  different mode predicates. An `area` on every row does not establish that
  the `ops` view maps once.
- The existing `projects.active` predicate does not include `repos` or
  `repo-diff`; `sessions.active` does not include `follow` or `terminal`; and
  `chat.active` does not include the separate `channels` destination. The
  sidebar therefore cannot derive area activity by merely reusing a single
  existing destination predicate.
- The current catalog does not actually put icons on destination rows. Its
  Lucide icons belong to the jump-dock projection.

Use two explicit layers instead:

1. `PRIMARY_AREAS`: eight rows containing area id, label, icon, default route,
   and visibility/default-route policy.
2. An exhaustive `ROUTE_AREA_BY_VIEW satisfies Record<Route["view"],
   PrimaryAreaId>` (or an exhaustive `primaryAreaForRoute(route)` switch when
   fields such as `ops.mode` matter).

The sidebar's active test should be `primaryAreaForRoute(route) === area.id`.
Destination predicates should continue to drive secondary navigation and the
command/shortcut projections. A compile-time `Record` proves all union members;
a runtime test can additionally assert eight non-empty buckets and exactly 21
keys. Do not describe the runtime fixture as a compile-time test.

### High: the proposed taxonomy is complete but not internally consistent

The proposed classification moves several views without acknowledging the
behavior change:

- `activity` and `briefings` are currently Home surfaces
  (`topNavKeyForRoute`), and `HomeLeft` links directly to Activity. Briefings
  are the archive for the Home/fleet brief. Moving both to Ops is a weak fit.
- `code` is source/repository work and fits the proposed Projects grouping for
  `repos`/`repo-diff` better than Ops.
- `settings(section: "agents")` is currently classified as Projects and is the
  sole Agents secondary-nav item. Moving it to Settings is reasonable, but it
  is an intentional IA change and requires deleting/replacing that secondary
  strip.
- `follow` is not intrinsically a Sessions screen. `FollowScreen` immediately
  resolves and redirects to chat, a session, a work item, Ops Tail, an agent,
  or Home according to `preferredView` and the identifiers returned by
  `/api/follow`. Its temporary active area should follow that resolution, or at
  least be documented as a fallback rather than a semantic Sessions member.
- `work` is a durable record created by asks/dispatch and reached from Home,
  Activity, Chat, and Ops. If Dispatch remains primary, grouping Work (and the
  transient Follow resolver) with Dispatch gives that area a coherent
  work-execution purpose instead of leaving Dispatch as a one-view ledger.

Recommended initial partition:

| Area | Route views |
| --- | --- |
| Home | `inbox`, `activity`, `briefings` |
| Projects | `agents-v2`, `agent-info`, `repos`, `repo-diff`, `code` |
| Sessions | `sessions`, `terminal` |
| Chat | `messages`, `conversation`, `channels` |
| Dispatch | `broker`, `work`, `follow` (fallback only; prefer resolved target area) |
| Search | `search` |
| Ops | `ops`, `mesh`, `harnesses` |
| Settings | `settings` |

That is still exactly 21 views and keeps the requested eight primary areas.

The secondary projections must then respect the same boundaries. Today
`OpsSubnav` contains Dispatch, Repos, and Code and is rendered by Broker,
Repos, Harnesses, Mesh, and Ops screens. Leaving it unchanged would highlight
Projects or Dispatch in the sidebar while rendering an Ops strip in content.
Remove Dispatch/Repos/Code from the Ops strip and stop rendering `OpsSubnav` on
Broker/Repos if those routes move. Chat's Messages/Channels strip remains
coherent. `SEARCH_SECONDARY_NAV` is already production-dead, and the Agents
strip becomes dead once agent configuration moves to Settings.

### High: the proposed Ops gating changes current reachability/navigation

`SystemMenu` does hide its entire `SYSTEM_OPS_ENTRIES` group behind
`ops.control`, but its core group always includes Search, Terminals, **Tail**,
and Dispatch. The router also deliberately treats both Tail and Lanes as
ungated Ops modes (`isUngatedOpsSurface`).

Mapping every `ops` mode to an area that is wholly hidden when `ops.control` is
off removes the current primary navigation path to Tail and gives a direct Tail
or Lanes URL no visible active area. That is not “exactly” the existing gate.

Keep the Ops area visible and gate its context entries instead. Its default can
be Mission Control when `ops.control` is enabled and Tail (or Lanes) when it is
disabled. If the product requirement is to hide Ops completely, the mapping
must split `ops` by `mode` and place Tail/Lanes elsewhere; a view-only table
cannot express that policy.

### High: the left-pane migration is more than a resolver rename

`resolveLeftPane` has one production consumer (`ScoutLeftPanel`), so the call
site is contained. Its behavior is much broader than the rollout list implies:

| Current branch | Component |
| --- | --- |
| `ops` | `OpsLeft` |
| `agents-v2` | `ProjectsRail` |
| `agent-info` | `AgentsLeft` |
| Chat's three views | `ChatLeft` |
| `mesh` | `MeshLeft` |
| `terminal` | `TerminalLeft` |
| all other views, including Sessions, Dispatch, Search, Settings, Work, Repos, Code, Harnesses, Briefings, and Activity | `HomeLeft` fallback |

Do not carry that default into `resolveSidebarContext`; it would make “Recent
agents/activity/attention” look like contextual navigation for most areas.
Make the new resolver exhaustive and return an intentional component or `null`
for every view. The migration inventory must explicitly include Mesh,
Terminal, Settings, and every current fallback route, not only the seven area
names in rollout step 2.

There is also a shell-level mismatch. HudsonKit `SidePanel` collapses to zero
width and renders a floating expand button. It does not retain a 48 px icon
rail. Shipping the proposed collapsed state requires a new sidebar layout (or
an extension to `SidePanel`), different inset arithmetic, and separate
responsive/user state; it is not achievable by merely renaming the resolver.

### High: Scope needs a new integration seam, and it is not flag-gated today

`wireScopeOntoScout()` currently replaces Content, nav-center, nav-actions, and
takeover hooks. It does not replace the left-panel slot or expose a sidebar
hook. `useScopePresentation()` is simply `isScopePath(pathname)`, the wiring is
unconditional in `main.tsx`, and `useScopeShellChrome()` collapses both panels
on `/scope/*`.

Therefore:

- `ffBundle` does not activate Scope presentation. The `scope-instrument`
  bundle layers ops/surface flags, while `/scope/*` activates the presentation
  by path. `surface.scope` is registered but is not consulted by
  `useScopePresentation()`.
- A Scope sidebar cannot work by “swapping the nav center” as today. Add an
  explicit `useSidebarModel`/sidebar slot seam, or make the new Scout sidebar
  path-aware and accept a Scope model.
- Stop forcing the persisted left-collapse value to `true` when Scope opens;
  responsive/presentation collapse must not overwrite the user's stored
  preference. Otherwise leaving Scope can leave the normal app collapsed.

Test the four combinations independently: old/new chrome on ordinary paths and
old/new chrome on `/scope/*`. Scope should remain selected by path regardless
of the sidebar experiment flag.

### Medium: most deletions are valid only after preserving hidden consumers

**Top tabs:** deletable after the cutover, but not as one blind file deletion.
`topNavConfig` also owns the breadcrumb mapping retained by the proposal, and
`SystemMenu` consumes `isSystemRoute`. Move breadcrumb labels to a neutral
`route-breadcrumb.ts` (preferably complete for all primary/detail routes), then
delete the tab keys/projection and System-only classifier. Scope's
`renderNavCenter`/`SCOPE_TOP_NAV_ITEMS` also need replacement by the new sidebar
model.

**System menu:** deletable after sidebar parity. Its hand-rolled component has
no other production consumer. The canonical destination rows and command/go
projections must remain.

**Jump dock:** the jump buttons can be deleted, but `GlobalJumpDock` is also the
only host for `MeshCanvasMinimap` (rack/map, machine visibility/focus, and its
`openscout.globalJumpDock.mode.v1` preference). The separate
`CanvasMinimapProvider` footer currently serves Mission Control, not Mesh.
Migrate the Mesh rack/map into the Mesh sidebar context/footer before deleting
the component and decide whether to migrate or intentionally retire its stored
mode.

**Embeds:** the statement that collapsed mode is required because embeds depend
on it is stale. Legacy and discovered embeds bypass `OpenScoutAppShell` and
render no sidebar. Collapsed mode is still required for narrow normal windows.

**Keyboard:** `Cmd+[` already toggles the left panel and `Cmd+]` the inspector.
Retargeting the former is straightforward; the latter should remain the right
inspector toggle. Add `Cmd+B` only outside editable/terminal targets, update the
command palette and keyboard-help overlay, and avoid having auto-collapse
mutate the persisted manual preference.

**Utility placement:** the proposal puts `MachineScopeControl` in both the
sidebar footer and the retained top utility bar. Pick one canonical placement
(recommended: top utility bar, because it remains visible while the rail is
collapsed) and do not render two controls with the same fixed
`machine-scope-select` id. The top-bar Settings shortcut is also redundant with
the new Settings area; retain it only if it is explicitly treated as an
accelerator rather than a second navigation model.

### Medium: Base UI is appropriate, but the plan overstates what HudsonKit provides

The current dependency situation is:

- Published `hudsonkit@0.3.3` already depends on
  `@base-ui-components/react@^1.0.0-rc.0` and uses Base UI for
  `HudsonContextMenu`.
- The checked-in `client/vendor/hudsonkit` fallback provides
  `usePersistentState`, shell/chrome stubs, flags, and simple overlay stubs. It
  provides no Tooltip, Dialog, Menu, or Collapsible wrapper.
- The published HudsonKit package likewise exports no generic versions of
  those primitives. Its current `CommandPalette` and `HudPanelSection` are
  hand-rolled; `SidePanel` is its own shell component.
- Vite can resolve HudsonKit from a sibling source checkout or the published
  package. A direct Base UI import from OpenScout therefore needs a direct
  `packages/web` dependency even though the same package is presently
  transitive. Pin/align it with HudsonKit's installed version to avoid duplicate
  copies.

Use Base UI Tooltip for the icon rail and Dialog for Settings; those replace
real accessibility mechanics (portal/focus/escape/outside interaction). Menu
is reasonable if the native machine `<select>` is intentionally redesigned,
but that change needs keyboard and screen-reader parity tests. Use Collapsible
for optional context groups if useful; the sidebar's 260 px ↔ 48 px layout
transition is controlled shell state plus CSS, not a “collapse animation hook.”

Keep Settings Dialog conversion in a separate rollout slice. The current drawer
already has a focus trap, Escape handling, modal roles, and URL-backed section
state, so mixing its replacement into first sidebar parity enlarges the risk
without unblocking navigation. Likewise, evolve CommandPalette upstream in
HudsonKit if needed rather than forking its behavior in this spec.

Measure a clean production-build baseline and post-change JS chunk sizes (raw
and gzip/brotli if the build tooling exposes them). Base UI may already be
present through HudsonKit/Frame, so report the incremental delta rather than
claiming the entire dependency size.

### Medium: use a real sidebar flag, not a bundle name as the condition

The flag machinery can support this rollout, but the spec needs a concrete key
and layering policy:

- Add `nav.sidebar` (or `chrome.sidebar`) to `scoutFlags`, default off.
- Read it reactively with `useOptionalFlag` inside the shell and render exactly
  one chrome tree. Do not render both navigation implementations accessibly at
  once.
- Use `?ff.nav.sidebar=on` for the narrow experiment. Add a dedicated
  `sidebar-preview` bundle only if a named bundle is operationally useful.
  Adding the flag to `max-pro` would silently switch every existing max-pro
  user and is not an isolated soak.
- Preserve the flag query through navigation (the existing `ff.` sticky prefix
  already does this), and add URL/local/bootstrap precedence tests.
- Keep the old and new left-panel persisted keys separate during the soak.

## Recommended rollout

1. **Land the IA model and tests only:** `PRIMARY_AREAS`, exhaustive route-area
   classifier, gate/default-route policy, and corrected secondary projections.
   No visual change.
2. **Add `nav.sidebar`:** implement the expanded and icon-rail shell alongside
   the old shell, with distinct persisted manual collapse state and responsive
   collapse derived from viewport state.
3. **Migrate context deliberately:** Home, Projects/Agent, Chat, Terminal,
   Mesh, and Ops custom contexts first; explicitly choose `null` or a new
   context for every former HomeLeft fallback. Preserve Mesh rack/map.
4. **Add the Scope sidebar model:** keep path-based presentation and stop Scope
   from mutating the normal sidebar preference.
5. **Reach parity:** breadcrumbs, machine scope, broker status, command trigger,
   onboarding, return-to behavior, right inspector, keyboard help, and all
   capability-gated entries. Run accessibility and visual matrices here.
6. **Flip/soak/delete:** remove top-tab rendering, System menu, jump buttons,
   obsolete projections/tests/CSS, and finally the legacy left-pane resolver.
7. **Adopt Base UI Dialog/Menu separately:** Tooltip may land with the rail;
   Settings Dialog and any command-palette change should follow parity rather
   than block it.

## Answers to the open questions

1. **Context scrolling:** keep header, primary destinations, and footer pinned;
   make only Context the `min-height: 0; overflow-y: auto` region. This avoids a
   nested whole-sidebar scroll while allowing long project/session/channel
   lists to work. Context components should not add a second vertical scroller
   unless they virtualize content.
2. **Dispatch:** keep it top-level. Do not fold it into Home. Give it `broker`,
   `work`, and the Follow fallback so it represents dispatched/owned work, not
   merely one diagnostics ledger.
3. **Auto-collapse breakpoint:** start at **below 1024 px** (`max-width: 1023px`)
   for the icon rail, with manual expand still available; consider an
   off-canvas treatment below ~720 px if normal web usage must support that
   width. Auto-collapse must be derived state and must not overwrite the
   persisted manual choice. Validate 900 px collapsed and 1280 px expanded as
   the proposal's matrix requests.
