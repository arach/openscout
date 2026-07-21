# SCO-083 implementation status

Branch: `sco-083/sidebar-navigation`  
Date: 2026-07-20  
Source of truth: `docs/eng/sco-083-sidebar-navigation.md`  
Review folded in: `docs/eng/sco-083-sidebar-navigation-review.md`

## Steps landed (green)

### 1. IA model + tests only — **done**

| File | Change |
| --- | --- |
| `packages/web/client/scout/primary-areas.ts` | `PRIMARY_AREAS` (8), exhaustive `ROUTE_AREA_BY_VIEW`, `primaryAreaForRoute`, Ops default-route gate policy |
| `packages/web/client/scout/primary-areas.test.ts` | 8 areas, 21 keys, 8 non-empty buckets, follow preferredView, ops gate |
| `packages/web/client/scout/route-breadcrumb.ts` | Neutral breadcrumb labels (survives top-tab deletion) |
| `packages/web/client/scout/route-breadcrumb.test.ts` | Breadcrumb coverage |
| `packages/web/client/scout/topNavConfig.ts` | Re-exports breadcrumb module; keeps legacy sparse top-tab breadcrumb contract |
| `packages/web/client/scout/nav-destinations.ts` | Ops secondary: remove Dispatch/Repos/Code; Search secondary emptied |
| `packages/web/client/scout/secondaryNavConfig.ts` | Drop `SEARCH_SECONDARY_NAV` export |
| `packages/web/client/screens/broker/BrokerScreen.tsx` | Stop rendering `OpsSubnav` |
| `packages/web/client/screens/repos/ReposScreen.tsx` | Stop rendering `OpsSubnav` |

### 2. `nav.sidebar` flag + shell — **done**

| File | Change |
| --- | --- |
| `packages/web/client/lib/scout-flags.ts` | `nav.sidebar` default off, not in max-pro |
| `packages/web/client/lib/scout-flags-sidebar.test.ts` | Flag registration + bundle exclusion |
| `packages/web/client/scout/sidebar/ScoutSidebar.tsx` | Expanded + icon-rail shell, Base UI Tooltip on rail |
| `packages/web/client/scout/sidebar/scout-sidebar.css` | Anatomy styles; context-only scroll |
| `packages/web/client/scout/sidebar/useSidebarCollapse.ts` | Distinct persisted manual key; derived auto-collapse ≤1023px |
| `packages/web/client/OpenScoutAppShell.tsx` | Exactly one chrome tree via `useOptionalFlag("nav.sidebar")` |
| `packages/web/package.json` | Direct `@base-ui-components/react@1.0.0-rc.0` (aligned with HudsonKit) |

Experiment: `?ff.nav.sidebar=on`

### 3. Context migration — **done** (exhaustive resolver)

| File | Change |
| --- | --- |
| `packages/web/client/screens/resolve-sidebar-context.tsx` | Exhaustive switch; intentional `null` for former HomeLeft fallbacks; **no HomeLeft default** |
| Mesh | `MeshLeft` + `MeshCanvasMinimap` footer (preserves rack/map before jump-dock deletion) |
| Home | `HomeLeft` only for `inbox` / `activity` / `briefings` (intentional) |
| Projects / Chat / Terminal / Ops | Existing left panels reused |
| Sessions / Dispatch / Search / Settings / Repos / Code / Harnesses | intentional `null` |

### 4. Scope sidebar seam — **done**

| File | Change |
| --- | --- |
| `packages/web/client/scope/hooks.ts` | **Stop** force-writing left/right collapse prefs |
| `packages/web/client/scout/sidebar/useSidebarModel.ts` | Path-aware model; Scope supplies its own destinations when `isScopePath` |
| Shell | Scope presentation derived; sidebar stays path-aware independent of `nav.sidebar` |

### 5. Parity — **partial**

Landed:
- Breadcrumb utility strip under sidebar chrome (`routeBreadcrumbForRoute`)
- Machine scope stays in top utility bar (single placement)
- Settings top-bar control kept as accelerator only
- `Cmd+[` / `Cmd+B` toggle sidebar (session-only expand when auto-collapsed)
- Keyboard help lists `⌘B`
- Status bar / command palette / right inspector unchanged

Not fully matrix-tested:
- Visual matrix (8 areas × expanded/collapsed, 900/1280, scope, embed)
- Full a11y pass
- Onboarding / returnTo specific regressions (untouched; assumed OK behind flag)

### 6. Flip/soak/delete — **not landed**

Still present under flag-off (default):
- Top tabs, System menu, GlobalJumpDock (incl. jump buttons)
- Legacy `resolveLeftPane` / `ScoutLeftPanel`
- `nav.sidebar` remains **default off**

### 7. Base UI Dialog/Menu — **not landed**

- Tooltip on icon rail: **landed with step 2**
- Settings Dialog conversion: deferred
- Machine-scope Menu redesign: deferred

## Bundle delta (production client main chunk)

| | raw | gzip |
| --- | ---: | ---: |
| Pre-change baseline (step 1 build) | 2,613.49 kB | 748.38 kB |
| Post steps 2–4 | 2,712.22 kB | 781.47 kB |
| **Incremental** | **+98.7 kB** | **+33.1 kB** |

Base UI was already transitive via HudsonKit; the delta includes the direct import surface + new sidebar chrome.

## Verification

```text
bun run --cwd packages/web test   # pass (exit 0)
bun run --cwd packages/web build  # pass (exit 0)

Focused:
bun test packages/web/client/lib/router*.test.ts \
  packages/web/client/scout/{nav-destinations,topNavConfig,secondaryNavConfig,primary-areas,route-breadcrumb}.test.ts \
  packages/web/client/scout/sidebar/*.test.ts \
  packages/web/client/screens/resolve-sidebar-context.test.ts \
  packages/web/client/lib/scout-flags-sidebar.test.ts
# 145 pass, 0 fail
```

URLs / router suites: unmodified green.

## Deviations

1. **Agents secondary strip kept** for Settings agents section until Dialog conversion (step 7). Spec allows strip death when agent config fully moves to Settings UI.
2. **Jump dock not deleted** — still hosts Mesh minimap under legacy chrome; Mesh minimap also hosted in new sidebar context so deletion is safe later.
3. **Step 6/7 deferred** intentionally: partial landing after last green step.
4. **HomeLeft used intentionally** for Home-area views only (not as default).

## What remains

1. Soak with `?ff.nav.sidebar=on`; visual/a11y matrix (step 5).
2. Flip default / delete top tabs, System menu, jump buttons, obsolete CSS/tests, legacy left resolver (step 6).
3. Settings Dialog + optional machine-scope Menu (step 7).
4. Optional: richer context for Sessions / Dispatch / Repos null panes.

**No git commit** (per ask).
