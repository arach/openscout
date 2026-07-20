# Review: SCO-081 web navigation consolidation

Reviewed against the working tree on 2026-07-20. The source spec is
`docs/eng/sco-081-web-navigation-consolidation.md`.

## Decision

Choose **Option B (remove TanStack Router)**, but do not execute the spec's
three-step deletion literally. Phase 1 should first make `lib/router.ts` the
explicit owner of browser location, query/hash policy, history entry state, and
subscriptions; migrate the two real TanStack location consumers; then remove
TanStack. The current route table duplication is waste, but it is not the
highest production risk described by the spec.

The highest current risk is the location mutation contract:

- `navigate()` preserves nearly every query parameter from the current URL and
  preserves the current hash on every destination
  (`packages/web/client/lib/router.ts:1052-1066`,
  `packages/web/client/scope/paths.ts:149-163`).
- Several features mutate history outside that contract, with different
  notification behavior (`AgentLaneDetailSheet.tsx:651-655`,
  `studio/studio-injection.tsx:64-82`,
  `scope/views/useScopeLaneLayout.ts:37-49`, and the deliberately isolated
  terminal embed at `TerminalEmbedScreen.tsx:47-64`).
- TanStack enables its own scroll restoration while the Scout hook separately
  restores scroll (`router/tanstack/router.ts:5-9`,
  `lib/router.ts:1033-1050`).

Those are live history/URL-consistency hazards. By contrast, a new canonical
route omitted from the TanStack table still lands on the root splat and is
rendered from `routeFromUrl()`.

## Findings

### High: the spec overstates the TanStack table's authority and its parity coverage

The diagnosis "two routing systems kept in sync by hand" is directionally
right, but the two systems are not peers:

- The 48 adopted path patterns are declared at
  `packages/web/client/router/tanstack/route-tree.ts:84-146`; unadopted paths
  are caught by the splat at `route-tree.ts:175-179`.
- Adopted children have no components. Their only behavior is to put the result
  of the canonical parser into route context (`route-tree.ts:148-155`). The root
  component renders `OpenScoutAppShell` directly and has no outlet
  (`router/tanstack/ScoutAppRoot.tsx:4-6`).
- The app's actual rendered route still comes from `useRouter()` in
  `ScoutProvider` (`scout/Provider.tsx:240-260`) and pane resolution still
  switches on that `Route` (`screens/resolve-panes.tsx:25-146`).
- The "parity oracle" compares only `parsed.view` with a hand-authored expected
  view (`router/tanstack/router.ts:22-39`). It does not compare path params,
  search params, hashes, canonical serialization, or the complete `Route`
  object. The expected map is derived from the same adopted table
  (`route-tree.ts:158-162`).

Therefore these spec statements should change:

- "Every new route must be added in both systems" is false for runtime
  behavior. A new parser route works through the splat. Adding it to the table
  only advances the abandoned adoption/parity scheme.
- "Drift is silent in production" is true of the oracle but implies too much
  production impact. For adopted Scout children, pane rendering still uses the
  canonical parser. The more important production risk is having two history
  and scroll owners, not a missing expected-view entry.
- The inventory is slightly stale: there are **48** adopted patterns, not merely
  "~40 prefixes," and the `Route` union has **24** `view` variants at
  `lib/types.ts:1259-1359`, not approximately 25.

This lowers duplicated path declarations below the URL/history bugs in severity,
although removing the inert layer is still the right architectural decision.

### High: query and hash propagation are more serious than the spec records

`preserveLocationSearch()` copies every current query key except `select`
(`scope/paths.ts:149-163`), and it is applied both during canonicalization and
ordinary navigation (`lib/router.ts:1014-1026`, `1052-1062`). This can carry
route-local values such as `layout`, `q`, `session`, `tab`, `no-ops`, and studio
controls to unrelated screens.

The proposed whitelist should **not include `machineId` generically**. Machine
scope already has explicit view support and propagation rules
(`lib/router.ts:164-227`). A global query whitelist would let `machineId`
survive unsupported views and then reappear later. Persist only explicitly
global feature-flag keys in the URL layer; serialize `machineId` from the next
`Route` only.

The spec misses hash propagation. `navigate()` appends the current hash to every
new path (`lib/router.ts:1061-1062`). A lane-sheet section hash or message hash
can consequently follow an unrelated navigation. Hash should default to clear;
callers that mean to retain or set a hash should request that explicitly.

There is also an end-to-end mismatch: `routeFromUrl()` can inspect a `#msg-*`
hash (`lib/router.ts:47-57`, `252-254`), and a unit test exercises that behavior
(`lib/router.test.ts:118-130`), but the live `routeFromLocation()` passes only
pathname and search (`lib/router.ts:910-916`, `1029-1032`). Thus that parser test
does not prove live hash deep-link behavior.

### High: Phase 3's raw-history remedy is underspecified

"Replace raw `pushState` escapes with `navigate()`" cannot work as written:
the current `navigate()` accepts only a `Route`, always pushes, and cannot patch
arbitrary query or hash state (`lib/router.ts:1052-1068`). The raw sites have
different requirements:

- Lane-sheet anchors need a hash update plus reactive back/forward handling
  (`AgentLaneDetailSheet.tsx:651-685`, `918-932`). Its `pushState(null, ...)`
  also discards router-owned entry state.
- Studio injection removes development-only query keys with replace semantics
  (`studio/studio-injection.tsx:64-82`).
- Scope layout updates one query key and local state with replace semantics
  (`scope/views/useScopeLaneLayout.ts:23-61`). Because it emits no Scout or
  TanStack location notification, the provider's current `searchStr` can remain
  stale until another location event.
- The terminal embed intentionally implements a nested terminal route inside
  `?route=` and supplies its own local `navigate` implementation
  (`screens/terminal/TerminalEmbedScreen.tsx:22-64`). It should not be forced
  through the shell router.

Phase 1 needs two APIs: typed `navigate(Route, options)` for product routes, and
a narrow `updateLocation({searchPatch, hash, replace, state})` for URL UI state.
Both must notify the same external location store and preserve/merge history
entry state by policy.

### Medium: the destination duplication is real, but "six copies" and "pure refactor" are too broad

There is strong duplication, especially the System and Ops tables:

- `nav-system-menu-config.ts:12-93`
- `secondaryNavConfig.ts:55-122`

But the six files do not enumerate the same set:

- Top nav is a four-item product taxonomy plus broad view classification and
  breadcrumbs (`topNavConfig.ts:20-128`).
- Secondary nav has contextual groupings (`secondaryNavConfig.ts:6-122`).
- Go shortcuts and the jump dock are different curated subsets
  (`lib/go-shortcuts.ts:9-23`, `scout/slots/GlobalJumpDock.tsx:91-106`).
- The command palette includes filtered destinations, settings overlays,
  Scoutbot actions, reload, capture, and dynamic per-agent commands
  (`scout/hooks.ts:37-209`).

A single flat `NAV_DESTINATIONS` row shape will either accumulate many
surface-specific flags or erase intentional differences. Prefer a canonical
destination catalog (id, label, route factory, active predicate, capability
gate) plus explicit projections for top nav, System/secondary nav, shortcut,
dock, and command palette. First derive the exact System/secondary duplicate;
then migrate the looser projections.

This is not wholly independent or automatically low risk: settings behavior,
ops gating, and legacy route deletion all change which projections exist.

### Medium: selection state needs classification, not a blanket "put it in the URL"

The cited durable selections are real (`scout/Provider.tsx:85-104`,
`256-284`): broker attempt, knowledge hit, and focused session are not URL
driven. The focused session is explicitly a fallback behind a routed session
id (`lib/session-catalog.ts:111-126`), so using the existing route `sessionId`
for user selection would remove a genuine split source of truth. Broker attempt
and knowledge hit also have stable ids and drive inspectable right-pane content,
so they are good URL candidates.

But `ScoutProvider` also owns a file-preview overlay and context-capture overlay
(`Provider.tsx:261-270`, `392`, `475-498`), and the shell owns other ephemeral
chrome state (`OpenScoutAppShell.tsx:272-279`, `337-368`). Their omission shows
that "all selection state belongs in the URL" is not the real rule. The rule
should be: resource/detail state that users expect to deep-link, reload, or
traverse with Back belongs in route/search/hash; transient commands and
temporary modal/chrome state may remain local.

### Medium: the two settings surfaces are not equivalent implementations

The routed `/settings` screen is primarily pairing/user-name state, while
`/settings/agents` is agent configuration
(`screens/settings/SettingsScreen.tsx:83-102`). The drawer contains operator,
communications, credentials, voice, and devices sections
(`SettingsDrawer.tsx:40`, `785-929`). They overlap around pairing/devices but
are not duplicate views of the same content.

Consolidation should reuse shared settings section components/data first, then
choose a URL presentation. Simply declaring the routed screen the winner would
drop most drawer functionality. A route such as `/settings/:section`, optionally
presented as an overlay by shell policy, is clearer than an undifferentiated
`?settings=1` flag.

### Medium: `nav-return` is load-bearing, but it is not a back-stack

`lib/nav-return.ts:7-70` stores one return `Route` per content slot in memory and
`sessionStorage`; it never pushes or pops a stack. `openAgent()` and
`openContent()` set it (`scout/slots/openAgent.ts:33-51`,
`slots/openContent.ts:23-38`), and `BackToPicker` consumes it
(`slots/BackToPicker.tsx:56-71`). There are many production callers across
home, mesh, projects, ops, broker, work, chat, sessions, and agent screens.

It is therefore load-bearing for contextual "return to origin" buttons. It is
also vulnerable to stale per-slot values and overwrites. Replace it only after
`navigate()` can attach a typed `returnTo` to the destination history entry.
`BackToPicker` can then read the current entry's state, use its fallback for a
deep link, and optionally use `history.back()` only when the preceding entry is
known to be the recorded origin.

### Medium/low: the legacy cleanup list conflates dead aliases with active contracts

- `conversations` appears to be a true input-only alias: outside parsing,
  serialization, tests, and view dispatch, no producer was found.
- `fleet` still has server-side producers (`server/routes/scoutbot.ts:766`,
  `server/scoutbot-assistant.ts:1186,1480`) even though it currently renders the
  Home panes (`screens/resolve-panes.tsx:43-46`, `69-71`, `106-109`). It is not
  dead cleanup yet.
- The deprecated `agents` view is still produced from server and client code,
  including `server/routes/scoutbot.ts:251,280`,
  `server/create-openscout-web-server.ts:3593`, and multiple files under
  `screens/agents/`. Deleting it is a migration, not dead-code removal.
- `/projects` is the canonical projects/index path; `/agents/:agentId` is the
  canonical unscoped agent-detail path; `/agents-v2/*` is legacy input
  (`lib/router.ts:676-712`, `router.test.ts:523-571,631-674`). Those are not a
  simple three-way alias. Native macOS code also constructs `/agents` deep
  links, for example `apps/macos/Sources/ScoutHUD/HUDTailView.swift:1563-1566`
  and `apps/macos/Sources/Scout/ScoutRootView.swift:3470`.

The dead `scout:open-terminal` listener claim is verified: only the listener at
`OpenScoutAppShell.tsx:551-560` was found in the repository. The shim statement
needs correction: `screens/HomeScreen.tsx` has no caller, while
`screens/TerminalScreen.tsx` is imported by
`client/terminal-relay-config.test.tsx:66`.

### Low: constraints need two corrections

- Embeds do bypass shell route parsing/canonicalization as entry-point surfaces,
  but most do **not** bypass TanStack entirely. Observe, repo-diff, and session
  embeds are wrapped in `RouterContextProvider` (`client/main.tsx:56-73`), and
  discovered embeds are too (`surfaces/embed-entry.tsx:16-23`). The terminal
  embed is the explicit local-router exception (`main.tsx:74-75`).
- Scope is already folded into the semantic `Route` model: its URLs parse into
  existing `ops`, `sessions`, and `agents-v2` variants
  (`scope/paths.ts:114-146`). What remains parallel is the namespace and shell
  presentation. Scope currently uses TanStack `useLocation()` solely to observe
  pathname (`scope/ScopeAppContent.tsx:1-15`, `scope/hooks.ts:1-15`) and projects
  routes back under `/scope/*` based on current pathname
  (`scope/presentation.ts:27-49`).

## Recommended severity order

1. **Location/history correctness:** explicit query/hash policy, one reactive
   location store, one scroll owner, and safe history entry state.
2. **Durable detail state:** routed session/broker/search selection; coherent
   settings URL/presentation; replace `nav-return` without losing workflows.
3. **Remove the inert TanStack adoption layer:** this is important ownership and
   maintenance cleanup, but duplicated path declarations are not currently the
   highest runtime risk.
4. **Consolidate destination metadata in projections.**
5. **Migrate, then delete, genuinely legacy views and shims.**

## Phase 1: drop TanStack, with a stronger cutover plan

The spec's reasons for Option B should be revised:

- A pane resolver does not inherently fight TanStack. A flat route tree can
  render one shell at the root; outlets are optional architecture, not a
  requirement.
- TanStack's static route tree and validated search/params can provide strong
  compile-time types. The `Route` union does not uniquely own that advantage.
- No SSR and embed entry points reduce the payoff of a framework router, but do
  not by themselves make TanStack unsuitable.

Option B still wins here because the app uses almost none of TanStack's value:
no route components below the root, no outlets, no loaders, no search
validation, no typed links/navigation, and no route-level error/not-found
surfaces. Finishing adoption would require re-expressing 24 domain route variants,
48 current path patterns, aliases, params, search validation, canonical output,
Scope namespace projection, and embed exceptions. Keeping a `Route` domain union
would still require a Route-to-URL mapping, so "finish adoption" does not remove
all translation code.

Recommended Phase 1 sequence:

1. Add a small browser-location store in `lib/router.ts` (prefer
   `useSyncExternalStore`) exposing `{pathname, search, hash, state}`. Subscribe
   to `popstate`/`hashchange`, and make all internal push/replace operations
   publish through it.
2. Define URL policy explicitly:
   - route serialization owns route-local search;
   - `machineId` propagates only through the existing supported-view rules;
   - only named global feature-flag keys may persist;
   - hash clears by default;
   - query/hash patching and replace/push are explicit options.
3. Expose pathname/namespace from that store through the Scout router/context.
   Replace the two Scope `useLocation()` calls. Preserve Scope as a URL/presentation
   namespace mapped to the existing `Route` union.
4. Preserve `/scout/*` compatibility in the canonical path. This already works
   without the TanStack redirect: `parseScopeRouteFromUrl()` accepts the legacy
   segment (`scope/paths.ts:114-146`) and canonical serialization maps it back to
   `/scope/*` (`lib/router.ts:1014-1026`). Keep and expand the test at
   `lib/router.test.ts:35-40`.
5. Replace `RouterProvider`/`RouterContextProvider` bootstrapping with direct
   provider/shell rendering in `main.tsx` and `surfaces/embed-entry.tsx`; delete
   `client/router/tanstack/*`, the adapter at `lib/router.ts:919-933`, and the
   TanStack dependency from `packages/web/package.json` and `bun.lock`.
6. Keep the custom scroll memory as the sole owner initially. Add browser-level
   tests for push, replace, Back/Forward, scroll keys, query isolation, default
   hash clearing, Scope namespace retention, and legacy `/scout` canonicalization.
   Replace the view-only parity oracle with table-driven URL/Route/canonical-path
   fixtures covering all 24 variants and supported aliases.

Do not combine Phase 1 with the settings redesign, destination registry, or
legacy view deletions. Those change product semantics and will obscure whether
the router cutover preserved behavior.

## Answers to the open questions

1. **External TanStack or `/scout/$` dependencies:** No import or dependency on
   `@tanstack/react-router` was found outside `packages/web` (apart from the root
   lockfile entry). No literal product use of legacy `/scout/*` was found outside
   web code/tests. However, `/scout` is explicitly documented in shared web
   constants as an accepted old-brand URL contract
   (`packages/web/shared/scope-integration.js:9-16,64-81`), so repository search
   cannot prove that old external bookmarks do not exist. Keep the redirect in
   the canonical router; TanStack is not required to preserve it.
2. **Fold Scope into `Route` or keep it parallel:** Keep Scope as a sanctioned
   **URL and presentation namespace**, not a second semantic route union. It
   already parses to the main `Route` variants. Make pathname/namespace explicit
   router state so Scope no longer needs TanStack `useLocation()` or implicit
   `window.location` checks. Avoid adding duplicate `scope-*` view variants.
3. **Is `nav-return` load-bearing?:** Yes. It is widely used for contextual
   return buttons, but it is a one-value-per-slot return store, not a stack. It
   is safe to replace only with typed per-history-entry `returnTo` state plus
   tested fallbacks; deleting it or blindly changing buttons to browser Back
   would regress deep links and cross-surface drill-ins.

## Verification performed

The following focused tests pass in the reviewed working tree:

```text
bun test packages/web/client/lib/router.test.ts \
  packages/web/client/lib/go-shortcuts.test.ts \
  packages/web/client/scout/topNavConfig.test.ts

48 pass, 0 fail
```

These tests validate parser/serializer and nav configuration units. They do not
currently exercise the live browser history bridge, TanStack matches, raw
history mutations, or end-to-end hash behavior; that missing test layer is part
of the Phase 1 recommendation.
