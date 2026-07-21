# SCO-081: Web navigation consolidation

Status: draft, under review
Scope: `packages/web` navigation architecture — routing, nav state, chrome surfaces, sequencing flows.

## Summary

The web app's core navigation model is sound: the URL is the single source of
truth, parsed by `routeFromUrl()` (`packages/web/client/lib/router.ts:245`)
into a ~25-variant `Route` discriminated union
(`packages/web/client/lib/types.ts:1259-1359`), distributed as
`{route, navigate}` through `ScoutContext`, and rendered by pane resolvers in
`packages/web/client/screens/resolve-panes.tsx`. `navigate()` serializes back
through `routePath()` (`lib/router.ts:640`) and pushes history. Deep-linking,
back/forward, per-route scroll memory (`routeKey`, `lib/router.ts:849`), and
`?machineId=` scoping all work off this loop.

The problems are in what has grown around that core. This document catalogs the
issues and proposes a phased consolidation.

## Problems, in order of severity

### 1. Two routing systems kept in sync by hand

TanStack Router is half-adopted ("Phase A" in progress):

- ~40 path prefixes duplicated in `packages/web/client/router/tanstack/route-tree.ts:84-146`.
- Adopted routes render no components; they only run `beforeLoad` to parse the
  canonical route. The splat defers to the legacy parser.
- A dev-only parity oracle (`client/router/tanstack/router.ts:26-40`) asserts
  TanStack matches and `routeFromUrl()` agree — drift is a console error in dev
  only, silent in production.
- The trailing-slash redirect ping-pong workaround documented at
  `route-tree.ts:17-31` shows this has already produced a real bug.

Every new route must be added in both systems. This is the highest-risk item.

### 2. Six copies of the destination table

The same view set is enumerated independently in:

- `packages/web/client/scout/topNavConfig.ts` (top tabs + breadcrumbs)
- `packages/web/client/scout/nav-system-menu-config.ts` (system dropdown)
- `packages/web/client/scout/secondaryNavConfig.ts` (per-screen strips)
- `packages/web/client/lib/go-shortcuts.ts` (`g`+key sequences)
- `packages/web/client/scout/slots/GlobalJumpDock.tsx` (jump buttons)
- `packages/web/client/scout/hooks.ts` `useScoutCommands()` (command palette)

Each carries its own active-predicate logic; ops-mode matching is duplicated
between `secondaryNavConfig.ts:68-71` and `nav-system-menu-config.ts:47-50`.
Adding or renaming a destination means touching six places consistently.

### 3. Navigation state that escapes the URL model

- Non-URL selection state in `ScoutContext` (`Provider.tsx:85-104`):
  `selectedBrokerAttempt`, `selectedKnowledgeHit`, `focusedSession`,
  `settingsOpen`. None are deep-linkable or participate in back/forward.
- A parallel back-stack in sessionStorage (`client/lib/nav-return.ts`,
  `openscout.navReturn.v1.<slot>`) that browser Back does not know about.
- Dual settings surfaces: `openSettings()` opens a non-URL `SettingsDrawer`
  overlay while `{view:"settings"}` is a full routed screen
  (`screens/settings/SettingsScreen.tsx`); `nav:settings` uses the drawer,
  `nav:agent-config` uses the route (`hooks.ts:146-156`).
- Raw `history.pushState/replaceState` outside the router:
  `screens/ops/AgentLaneDetailSheet.tsx:655`, `studio/studio-injection.tsx:81`,
  `scope/views/useScopeLaneLayout.ts:48`,
  `screens/terminal/TerminalEmbedScreen.tsx:57-62`.
- `OpenScoutAppShell.tsx:286` reads `window.location.pathname === "/search"`
  directly, bypassing the reactive route model.

### 4. Dead weight

- Legacy view aliases kept alive: `agents` (labeled "Agents .deprecated" in
  `topNavConfig.ts:31`), `conversations`, `fleet`, and the `/agents` vs
  `/agents-v2` vs `/projects` path triple, with special-case overrides sprinkled
  through `topNavKeyForRoute`, `isSystemRoute`, `canonicalHrefForRoute`.
- `scout:open-terminal` event listener (`OpenScoutAppShell.tsx:558`) has no
  emitter anywhere in `packages/`.
- `screens/HomeScreen.tsx` and `screens/TerminalScreen.tsx` are re-export shims
  used only by tests.
- `preserveLocationSearch` (`scope/paths.ts:152-160`) sticks every query param
  except `select` across navigations — `machineId`, `no-ops`, and dev flags
  silently follow the user everywhere.

## Constraints

- All routing is client-side; no SSR. The SPA is served statically by the Bun
  server (`packages/web/server/index.ts`), vendored into the published `scout`
  CLI, and reused by the transitional desktop app.
- The macOS app embeds web surfaces with no browser chrome
  (`/embed/*`, `/ops/lanes/embed`); embed paths bypass the router entirely
  (`main.tsx`, canonicalization skipped at `lib/router.ts:939-941,1015`), and
  the lanes surface is deliberately onboarding-exempt.
- The `/scope/*` overlay (`client/scope/`) is a sanctioned parallel namespace
  that monkey-patches shell slots via `wireScopeOntoScout()`.

## Proposal

### Phase 1 — One router (the real decision)

Option A: finish the TanStack adoption — move `Route` parsing into TanStack
params/search validation, delete `routeFromUrl()` as primary, render panes via
outlets. Proper end state on paper, but a large risky rewrite, and TanStack's
nested-tree idiom fights the flat three-pane pane-resolver model.

Option B (recommended): drop TanStack, keep the canonical parser. The
`Route` union + `routeFromUrl`/`routePath` is a better fit for this app than a
nested route tree: the app is a three-pane shell over flat views, not a nested
hierarchy, and the union gives exhaustive compile-time checking a path-string
tree never will. The migration is mostly deletion:

1. Remove the TanStack history adapter (`router/tanstack/router.ts:14-20`);
   `navigate()` already has a raw `pushState` fallback
   (`lib/router.ts:1006-1011`) that becomes the only path.
2. Delete `route-tree.ts` and the parity oracle.
3. Keep the `scout:locationchange` rebroadcast loop as the reactivity bridge.

Keep the parity oracle in place during the transition as a safety net, then
delete it. Given the embed constraints and no SSR, Option B is less code, less
risk, and matches how the app actually renders.

### Phase 2 — One destination registry

Define a single `NAV_DESTINATIONS` table (view, path, label, icon, keybinding,
active predicate, ops-gated flag) and derive the top tabs, system menu,
secondary navs, go-shortcuts, jump dock, and command palette entries from it.
Pure refactor, low risk, independent of Phase 1.

### Phase 3 — Push selection state into the URL

- `selectedBrokerAttempt` → `?attempt=`, `focusedSession` → `?session=`,
  knowledge hit → `?hit=`.
- Pick one settings surface: the routed screen. The drawer's only advantage is
  overlaying any route, which a `?settings=1` search param also solves.
- Remove the sessionStorage back-stack, or rebuild it on `history.state` so
  browser Back agrees with it.
- Replace raw `pushState` escapes and the direct `window.location` read with
  `navigate()`.

### Phase 4 — Cleanup

Delete `.deprecated` views and aliases, the dead `scout:open-terminal`
listener, and the re-export shims (move tests to the real screens). Change
`preserveLocationSearch` from stick-everything to an explicit whitelist
(`machineId` + dev flags).

Phases 2–4 are independent and can land in any order once Phase 1 is decided.
Do not add new routes under the dual-parser regime in the meantime.

## Open questions

- Does anything outside `packages/web` depend on the TanStack router package or
  the `/scout/$` legacy redirect behavior?
- Should scope (`/scope/*`) routes be folded into the `Route` union, or do they
  stay a sanctioned overlay namespace?
- Is the `nav-return` back-stack load-bearing for any workflow, or safe to
  replace with `history.state`?
