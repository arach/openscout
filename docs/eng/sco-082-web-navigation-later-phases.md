# SCO-082: Web navigation consolidation — later phases

Status: draft, assigned for implementation
Scope: `packages/web` navigation — destination catalog, durable selection
state in the URL, legacy alias migration and deletion.

## Background

Phase 1 landed in commit `99991c9c` (branch `codex/hotzone-composer-theme`):
TanStack Router is removed and `packages/web/client/lib/router.ts` is the sole
router. Read these before starting:

- `docs/eng/sco-081-web-navigation-consolidation.md` (original spec)
- `docs/eng/sco-081-web-navigation-consolidation-review.md` (review; its
  severity order and corrections govern this document)

Post-Phase-1 router API you should build on (all in `client/lib/router.ts`
unless noted):

- `useRouter()` → `{route, navigate}`; `navigate(route, options?)` with
  `NavigateOptions {replace?, hash?, state?, preserveSearch?}`.
- `updateLocation({searchPatch, hash, replace, state})` for URL UI state that
  is not a route change. `hash`: `undefined` keeps, `null` clears, value sets.
- `useBrowserLocation()` → reactive `{pathname, searchStr, hash, state}` from
  the single location store.
- `planNavigation()` (pure), `canonicalHrefForRoute()`, `routeKey()` exported.
- URL policy already enforced: route-local search keys do not leak across
  navigation; `machineId` propagates only via `MACHINE_SCOPED_VIEWS` /
  `resolveNavigatedMachineScope`; hash clears by default on `navigate()`;
  sticky search is a named feature-flag whitelist in `client/scope/paths.ts`.

Hard constraints for all phases:

- Do NOT git commit or perform any git mutation. Leave changes uncommitted.
- The working tree contains unrelated in-progress work (CI workflow, macOS,
  crates/runtime, broker/harnesses/ops screens, TailView, CSS redesign,
  server, `design/studio`, HarnessMark, `OpenScoutAppShell.tsx`,
  `Inspector.tsx`). Do not touch, revert, or "clean up" those files except
  where a phase below explicitly names them.
- Keep the public `{route, navigate}` consumption API stable.
- Embed entry points (`/embed/*`, `/ops/lanes/embed`) and the `/scope/*`
  presentation namespace must keep working; scope stays a namespace over the
  existing `Route` union — no new `scope-*` view variants.
- Implement the phases in order (A, then B, then C). Each phase must leave
  the test suite green before the next begins. If a phase turns out to be
  too entangled to land safely, stop after the last green phase and report
  why — a partial landing is acceptable, a broken tree is not.

## Phase A — destination catalog with projections

Today the nav destination set is enumerated independently in six places:

- `client/scout/topNavConfig.ts` — 4 top tabs, view classification, breadcrumbs
- `client/scout/nav-system-menu-config.ts` — System dropdown (core + ops-gated)
- `client/scout/secondaryNavConfig.ts` — per-screen secondary strips
- `client/lib/go-shortcuts.ts` — `g`+key sequences
- `client/scout/slots/GlobalJumpDock.tsx` — jump buttons
- `client/scout/hooks.ts` `useScoutCommands()` — command palette (static nav
  commands plus dynamic per-agent `Open X` / `Message X`)

These are intentionally NOT the same set (per the sco-081 review): top nav is
a product taxonomy, secondary nav has contextual groupings, shortcuts/dock are
curated subsets, the palette includes overlays, Scoutbot actions, reload,
capture, and dynamic agent commands.

Design and implement:

1. A canonical destination catalog, e.g. `client/scout/nav-destinations.ts`:
   one entry per destination with `id`, `label`, `icon`, `route` (or route
   factory), `active(route)` predicate, and capability gate (ops-mode flag).
   This is the single place a destination's identity, route, and
   active-semantics are defined.
2. Explicit projections that derive each surface from the catalog:
   top tabs (+ breadcrumb mapping), System menu, secondary nav groups,
   go-shortcuts, jump dock, command palette. Surface-specific concerns (tab
   grouping, breadcrumb text, palette subtitle/keywords, shortcut key) live in
   the projection, not the catalog row — do not force one flat row shape to
   serve every surface.
3. Migration order: first replace the exact System/secondary-nav duplication
   (ops-gate predicates duplicated at `nav-system-menu-config.ts:47-50` and
   `secondaryNavConfig.ts:68-71` are the canonical example), then migrate the
   looser projections (top nav, shortcuts, dock, palette).
4. Preserve behavior exactly: ops gating, breadcrumb text, keybindings, the
   dynamic per-agent palette commands, and the `nav:settings` (drawer) vs
   `nav:agent-config` (route) distinction — Phase B changes settings; Phase A
   must not.
5. Tests: keep `topNavConfig.test.ts` and `go-shortcuts.test.ts` green
   (update them to test the projections, not the old tables), and add catalog
   tests asserting every projection entry resolves to a catalog destination
   with a valid route and active predicate.

## Phase B — durable selection state in the URL

Rule (from the review): resource/detail state users expect to deep-link,
reload, or traverse with Back belongs in route/search/hash; transient commands
and temporary modal/chrome state stay local.

1. **Focused session**: `ScoutContext.focusedSession`
   (`client/scout/Provider.tsx`) is explicitly a fallback behind a routed
   session id (`client/lib/session-catalog.ts:111-126`). Make the routed
   `sessionId` the single source of truth for user selection; remove the
   split.
2. **Broker attempt**: `selectedBrokerAttempt` (drives the Dispatch detail
   sheet, force-opened in `OpenScoutAppShell.tsx:330-335`) → search param
   (e.g. `?attempt=<id>`) on the relevant ops routes. Back/forward and
   deep-link must open/close the sheet. Keep the sheet auto-width behavior.
3. **Knowledge hit**: `selectedKnowledgeHit` → `?hit=<id>` on the search
   route, same deep-link/Back expectations.
4. **Settings consolidation**: the routed `/settings` screen
   (`client/screens/settings/SettingsScreen.tsx` — pairing/user-name, and
   `/settings/agents` agent config) and the `SettingsDrawer`
   (`SettingsDrawer.tsx` — operator, communications, credentials, voice,
   devices) are NOT equivalent; the drawer holds functionality the routed
   screens lack. Consolidate content first: extract shared settings section
   components/data so each section renders identically in either surface,
   then unify on routed `/settings/:section` (sections: pairing, agents,
   operator, communications, credentials, voice, devices). Overlay-vs-screen
   presentation may remain a shell policy, but there must be one URL-addressable
   settings surface with all sections. Update `nav:settings` /
   `nav:agent-config` commands accordingly. Nothing the drawer does today may
   be dropped.
5. **nav-return replacement**: `client/lib/nav-return.ts` is one return
   `Route` per slot (memory + sessionStorage), consumed by
   `client/scout/slots/BackToPicker.tsx` and set by `openAgent.ts` /
   `openContent.ts`. It is load-bearing — replace, don't delete:
   - extend `navigate()`/`NavigateOptions` with a typed `returnTo: Route`
     stored in the history entry state;
   - `BackToPicker` reads the current entry's `returnTo`, falls back to its
     current default route for deep links, and only uses `history.back()` when
     the preceding entry is known to be the recorded origin;
   - then remove the sessionStorage side channel.
6. **Small fixes while here**: replace the non-reactive
   `window.location.pathname === "/search"` read in `OpenScoutAppShell.tsx`
   with `useBrowserLocation()` or the route model; delete the dead
   `scout:open-terminal` listener (`OpenScoutAppShell.tsx:~551-560` — verified
   no emitter exists). Touch nothing else in that file.
7. Tests: deep-link and Back/Forward coverage for `attempt`/`hit`/session
   selection and settings sections; `returnTo` round-trip including the
   deep-link fallback. Route-level params must integrate with the Phase 1 URL
   policy (they are route-local; they must not leak to unrelated views).

## Phase C — legacy alias migration, then deletion

Per the review, these are migrations, not dead-code deletion. Migrate all
producers first, verify zero producers remain, then delete.

1. **`agents` view** (".deprecated"): still produced by server code
   (`server/routes/scoutbot.ts:251,280`,
   `server/create-openscout-web-server.ts:3593`) and client files under
   `client/screens/agents/`. Repoint producers to the canonical
   `agents-v2`/`projects` routes, then remove the alias from parser,
   serializer, `topNavConfig`, `isSystemRoute`, and tests.
2. **`fleet` view**: still produced server-side
   (`server/routes/scoutbot.ts:766`, `server/scoutbot-assistant.ts:1186,1480`)
   though it renders Home panes. Repoint producers to `inbox`, then remove.
3. **`conversations` view**: no producer found outside parsing/serialization/
   tests — delete directly.
4. **Path canonicals**: `/projects` is the canonical projects path;
   `/agents/:agentId` is the canonical unscoped agent-detail path and is
   deep-linked by native macOS code
   (`apps/macos/Sources/ScoutHUD/HUDTailView.swift:1563-1566`,
   `apps/macos/Sources/Scout/ScoutRootView.swift:3470`) — do NOT change macOS
   behavior or break those URLs. `/agents-v2/*` remains accepted legacy input
   that canonicalizes; keep that redirect working.
5. **Shims**: `client/screens/HomeScreen.tsx` has no caller — delete it.
   `client/screens/TerminalScreen.tsx` is imported only by
   `client/terminal-relay-config.test.tsx:66` — repoint the test to the real
   screen and delete the shim.
6. Tests: parser/serializer fixture table in
   `client/lib/router.navigation.test.ts` must be updated so removed aliases
   are gone and retained legacy-input redirects (`/agents-v2/*`, `/scout/*`)
   keep passing.

## Verification (all must pass at the end of each phase)

```bash
bun test packages/web/client/lib/router.test.ts \
  packages/web/client/lib/router.navigation.test.ts \
  packages/web/client/lib/go-shortcuts.test.ts \
  packages/web/client/scout/topNavConfig.test.ts
bun run --cwd packages/web test     # full suite
bun run --cwd packages/web build    # vite client + server bundles
```

Note: `packages/web` has no `check` script and `tsc --noEmit` has a
pre-existing dirty baseline (~95 errors at HEAD). If you touch typechecking,
only ensure you add zero new errors relative to that baseline; do not try to
fix the baseline.

## Report back

Changed/created/deleted files per phase, any behavior that intentionally
changed (there should be almost none), deviations from this spec and why,
test/build results, and which phases landed vs stopped short.
