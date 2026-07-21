# PR #401 review — sco-083 sidebar navigation (steps 1–4 + partial 5)

Reviewer: session-mrtw23vh-tk6twr · 2026-07-20
Branch: `sco-083/sidebar-navigation` · flag-gated (`nav.sidebar`), default off.

**Verdict: merge-with-nits.** No blocking issues. All 7 verification points
pass on implementation. Exhaustiveness is genuine and tsc-proven; the seam is
clean; bun.lock carries a single Base UI copy; the canonical test runner is
green. Nits are test-coverage/robustness, not correctness.

Method: read the changed sources on the branch, ran `tsc -p packages/web`
(local binary), and ran the focused suites plus the full client shard exactly
as `packages/web/scripts/test.mjs` invokes it.

---

## Per-point verification

### 1. `ROUTE_AREA_BY_VIEW` exhaustive + matches the partition table — ✅ PASS
- `... as const satisfies Record<Route["view"], PrimaryAreaId>`
  (`primary-areas.ts:122-144`). `Route["view"]` is a 21-member union; tsc is
  clean, so this is a genuine **bijective** proof (every view classified,
  no stray keys), not vacuous.
- Runtime test asserts 21 keys / 8 non-empty buckets / exact per-area partition
  (`primary-areas.test.ts:45-68`) — matches the spec table 1:1.
- `follow` handled per spec: `primaryAreaForRoute` prefers the resolved
  `preferredView` (tail→ops, session→sessions, chat→chat, work→dispatch),
  else Dispatch fallback (`primary-areas.ts:163-179`).
- Ops gate policy correct: `defaultRouteForArea("ops", …)` → mission when
  `ops.control` on, tail when off; the area itself stays visible
  (`primary-areas.ts:189-202`). Matches "don't gate the whole Ops area."

### 2. `nav.sidebar` flag mechanics — ✅ PASS
- Registered default-off, tier `everyone`, tagged `experiment`
  (`scout-flags.ts:84-92`).
- **Not in max-pro** (nor light-prod): bundles only flip `OPS_FLAG_KEYS` +
  `SURFACE_FLAG_KEYS` (`scout-flags.ts:260-281`); guard test scans the source
  to assert no `flagValues(…nav.sidebar)` (`scout-flags-sidebar.test.ts:12-20`).
- Read reactively via `useOptionalFlag("nav.sidebar", false)`
  (`OpenScoutAppShell.tsx:295`).
- **Exactly one chrome tree**: ternary `sidebarChrome ? <ScoutSidebar/> :
  <>…legacy SidePanel…</>` (`OpenScoutAppShell.tsx:853-887`) — never both.
- `?ff.nav.sidebar=on` sticky across navigation: `ff.` is a
  `GLOBAL_STICKY_SEARCH_PREFIX` (`scope/paths.ts:177`) carried by
  `preserveLocationSearch`, invoked on every navigation
  (`router.ts:1171,1228`). Prefix stickiness is covered by existing tests
  (`router.test.ts:90`, `router.navigation.test.ts:187`) with `ff.ops.control`.

### 3. `resolveSidebarContext` exhaustive, no HomeLeft fallback, minimap kept — ✅ PASS
- Switch over all 21 views; `default` carries `const _exhaustive: never = route`
  — tsc-clean, so exhaustive (`resolve-sidebar-context.tsx:37-99`).
- `HomeLeft` used **only** for the Home area (inbox/activity/briefings), never a
  catch-all (`:39-42`).
- `MeshCanvasMinimap` preserved as the Mesh context footer (`:85`) — the
  jump-dock's sole host is migrated before deletion, per spec.
- Test scans the source for a `case` per view, forbids the old
  `default → HomeLeft`, and asserts `MeshCanvasMinimap`
  (`resolve-sidebar-context.test.ts`).

### 4. Scope seam — path-driven, no persisted-collapse mutation — ✅ PASS
- `useScopeShellChrome` no longer force-writes collapse: the
  `setLeftCollapsed(true)/setRightCollapsed(true)` calls are removed, setters
  deprecated/optional (`scope/hooks.ts` diff). It only toggles the document
  marker.
- Shell derives scope collapse instead: `scopeHidesLegacyLeft =
  scopePresentation && !sidebarChrome`, `scopeHidesRight = scopePresentation`
  (`OpenScoutAppShell.tsx:773-774`) — never persisted.
- `useSidebarModel` selects scope by `isScopePath(pathname)` regardless of the
  `nav.sidebar` flag (`useSidebarModel.ts:46-66`).

### 5. Manual collapse vs derived auto-collapse separation — ✅ PASS (impl) / ⚠️ under-tested
- Implementation is correct (`useSidebarCollapse.ts`): `manualCollapsed`
  persisted under its **own** key `appshell.${appId}.sidebar.manualCollapsed`;
  `autoCollapsed` derived from viewport (≤1023); under auto-collapse
  `toggleCollapsed` flips **session-only** `forceExpanded` and never calls
  `setManualCollapsed`; `effectiveCollapsed = autoCollapsed ? !forceExpanded :
  manualCollapsed`.
- **Gap:** the test asserts only the three exported constants — the actual
  manual-vs-derived invariant (auto-collapse never overwrites the persisted
  preference) is not exercised. See nit N1.

### 6. Base UI dependency alignment — ✅ PASS
- `packages/web/package.json` adds `@base-ui-components/react: "1.0.0-rc.0"`;
  hudsonkit@0.3.3 depends on `^1.0.0-rc.0`.
- **bun.lock resolves exactly one copy** — a single
  `@base-ui-components/react@1.0.0-rc.0` node shared by web + hudsonkit
  (`bun.lock:162,225,1079`). No duplicate copies.

### 7. Old chrome intact when the flag is off — ✅ PASS (one intentional delta)
- Default off → legacy `<SidePanel side="left">` renders unchanged; ScoutSidebar
  is not mounted. `useSidebarCollapse` runs unconditionally but only seeds a
  localStorage key — harmless to old chrome.
- One deliberate runtime delta in old chrome: scope presentation now **derives**
  left/right collapse rather than persisting it (the point-4 fix). Rendering is
  intact; only the previous persisted side-effect (scope writing collapse=true,
  which leaked out of scope) is gone. This is an improvement, but the PR line
  "Old chrome untouched" slightly overstates it. See nit N4.

---

## Findings by severity

### Blocking — none.

### Medium
- **M1 — `useSidebarCollapse.test.ts` is order-dependent / brittle.**
  `import { usePersistentState } from "@hudsonkit"` (a **runtime value**) makes
  bun mis-resolve the `@hudsonkit` graph to `@types/react/index.d.ts`
  (`Unexpected as`) whenever the file runs without another test in the same
  process priming `@hudsonkit` first. Repro: `bun test --isolate
  ./client/scout/sidebar/useSidebarCollapse.test.ts` → 0 pass / 1 error; the
  scout subtree fails the same way. The **full client shard is green**
  (`bun test --isolate ./client` → 629 pass / 0 fail / 0 error), which is how
  `scripts/test.mjs` runs it, so CI passes today — but any test-sharding change
  or isolated dev run silently breaks. Fix is cheap: the test only checks
  exported constants, so avoid dragging in the hook module / `@hudsonkit`
  (e.g. put the width/breakpoint constants in a hook-free module, or assert them
  without importing the hook). *(`useSidebarCollapse.test.ts`,
  `useSidebarCollapse.ts:10`.)*

### Low / nits
- **N1 — the collapse test doesn't test collapse logic.** It asserts only
  `SIDEBAR_*` constants; the manual-vs-derived separation (point 5, the whole
  reason the hook exists) is unverified. Add a hook test (or pure-function
  extract) proving auto-collapse never writes `manualCollapsed` and
  `forceExpanded` is session-only.
- **N2 — spec test items not landed.** The spec's step-2 "URL/local/bootstrap
  precedence tests" for `nav.sidebar` and step-4 "4 combinations (old/new chrome
  × ordinary/`/scope/*`)" are not present. Current coverage leans on the generic
  `ff.` prefix tests + `isScopePath` truthiness. Non-blocking for a
  default-off flag, but worth closing before the step-6 flip.
- **N3 — Base UI pin style.** web pins **exact** `1.0.0-rc.0` while hudsonkit
  uses caret `^1.0.0-rc.0`. Aligned to one copy today; if hudsonkit later bumps
  to `rc.1`, the exact pin could split the tree. Consider matching the caret.
- **N4 — PR wording.** "Old chrome untouched" is ~true for rendering but the
  scope-collapse persistence side-effect was intentionally removed (point 7).
  Minor doc accuracy only.

---

## Test evidence
- `tsc -p packages/web` (local binary): **no errors** in any new file
  (primary-areas, resolve-sidebar-context, useSidebarCollapse, useSidebarModel,
  scout-flags, route-breadcrumb, OpenScoutAppShell, scope/hooks).
- `bun test --isolate ./client` (canonical runner path): **629 pass / 0 fail /
  0 error**, 73 files.
- Focused suites (primary-areas, resolve-sidebar-context, useSidebarModel,
  scout-flags-sidebar, nav-destinations, route-breadcrumb, secondaryNavConfig,
  topNavConfig, router, router.navigation) pass **within the primed shard**; the
  M1 brittleness is the only anomaly and does not fail the canonical run.
