# PR #404 review — sco-085 full-height sidebar, top-bar removal, AREA_SUB_NAV, lanes polish

Reviewer: session-mru2el5g-cq0x5b · Branch `sco-085/full-height-sidebar` @ `ba6c72ca` (single impl commit) · Base `main`
Spec: `docs/eng/sco-085-full-height-sidebar-and-polish.md` (Codex-reviewed)

## Verdict: MERGE-READY

All 7 verification points hold. 2 low-severity nits + 1 visual-QA follow-up, none blocking.

Tests: focused suites **27 pass / 0 fail** (344 expects); broader `client/scout` + `client/components` **68 pass / 0 fail** (15 files); `tsc -p packages/web` clean on every touched file. Note: `bun run --cwd packages/web test` runs only a `--help` smoke test (1 pass) — real unit coverage is `bun test <files>`, which I ran. Full `vite build` not re-run by me; PR claims green.

## Point-by-point

**(1) ScoutNavigationBar conditionally unmounted, legacy path intact — PASS.**
- `OpenScoutAppShell.tsx:914` `{!sidebarChrome ? <ScoutNavigationBar…/> : null}` — true unmount, not CSS-hide.
- `scout/hooks.ts:225` `useScoutNavCenter` and `:246` `useScoutNavActions` both early-`return null` in sidebar mode (previously a hidden breadcrumb-only div / nav-variant machine scope).
- `scope/shell-hooks.tsx:34,42` `useIntegratedNavCenter/Actions` return null under the flag → no duplicate scope nav-center.
- Legacy `?ff.nav.sidebar=off`: bar renders with `center=appNavCenter`, `actions=appNavActions`; `hooks.ts` renders the full tab bar + machine scope + Settings + System menu; `panelTopStyle` empty so panels keep `navTotalHeight`; sidebar + CenterPaneHeader not rendered. Old chrome fully intact.

**(2) Top offsets, no ghost gap — PASS.**
- `chromeTopOffset = sidebarChrome ? titleBarInset : navTotalHeight` (`OpenScoutAppShell.tsx:311`; web `titleBarInset` added to the platform stub `vendor/hudsonkit/index.tsx:142` = 0).
- Center pane `contentStyle.top = chromeTopOffset` (~:865). `panelTopStyle = {top: chromeTopOffset}` applied to **ScoutSideRail** (`:958`) and the **right inspector SidePanel** (`:1023`).
- Sidebar `--scout-sidebar-top: "0px"` (:936); `components/ui/sidebar.tsx:192` default `48px→0px`.
- Web `SidePanel` (`vendor/hudsonkit/chrome.tsx:45`) applies `style` directly with no competing top default → passed `top` wins; no 48px ghost gap.

**(3) Drag region — PASS.**
- Brand strip (`ScoutSidebar.tsx` SidebarHeader ~:256) spreads `dragRegionProps` (minus `style`) + `data-sidebar-drag-region`, `paddingTop = max(8, titleBarInset)`.
- Interactive exemptions via `onInteractiveMouseDown`: Home button, brand-row collapse `SidebarTrigger`, command-palette wrapper, footer row.
- Onboarding takeover (fixed z-80, outside the inert tree) gets its **own** equivalent top drag strip `data-scout-takeover-drag-region` (`OpenScoutAppShell.tsx:1134`), height `max(28, titleBarInset||28)`.
- `titleBarInset` respected throughout. On web `dragRegionProps={}` → no-op (correct); real props arrive on the native embed.

**(4) Exactly one MachineScopeControl — PASS.**
- Sidebar mode: only `ScoutSidebar` footer `SidebarMachineScope` (`:218`), variant `rail|sidebar` chosen by collapse state (mutually exclusive renders).
- `hooks.ts:254` `variant:"nav"` sits **after** the sidebar-mode `return null`, so it only mounts in legacy mode.
- `machine-scope-select` id mounts exactly once in either mode — no duplicate-id. Rail presentation = `Server` icon + popover with mousedown-outside / Escape close; sane.

**(5) AREA_SUB_NAV — PASS.**
- `nav-destinations.ts:175` `repos.active` = `repos || repo-diff` (+ tests).
- `projectAreaSubNav` / `areaSubNavForRoute` projections added; `allProjectedDestinationIds` includes them (integrity test).
- Center strip rendered **once** via `CenterPaneHeader` (`OpenScoutAppShell.tsx:1120`, sidebar-gated) around content; also as `SidebarMenuSub` in the sidebar when expanded+active (`ScoutSidebar.tsx` AreaMenuItems).
- **Not** in `ScoutSideRail` (file untouched). Correct.

**(6) Empty CONTEXT auto-collapse — PASS (no unmount deadlock).**
- `ScoutbotStateContext` exposes `conversation {messageCount, loading}`; `ScoutbotPanel.tsx:662` publishes it. Critical: the publisher (`useScoutbotStatePublisher`) has **no unmount cleanup** and `ScoutbotStateProvider` holds state in its own `useState`, so the last-published `{0, loading:false}` **survives** ScoutbotPanel unmounting when the panel collapses → empty stays true → panel stays collapsed. No oscillation.
- `empty-context-collapse.ts`: `loading` is treated as **not** empty (cold `/ops/lanes` load mounts, publishes, collapses once — stable). `resolveLanesContextCollapsed` uses a temporary route-scoped `forceOpen`; effects reset it on route/emptiness change. Collapse-while-empty (`nextLanesContextToggle` Case B) leaves stored `rightCollapsed` untouched — emptiness is never persisted as `collapsed=true`.

**(7) No CenterPaneHeader duplication — PASS.**
- Single shared seam, sidebar-gated, returns null when neither breadcrumb nor sub-nav applies. Top-level landings that own big headers (inbox/home, agents-v2, sessions, messages, search) get a **null** breadcrumb (tests confirm); agents-v2 shows only the sub-nav strip. No duplicate big header.

## Findings (all non-blocking)

- **[low] `nextLanesContextToggle` Case C flips stored `rightCollapsed` true→false.** `empty-context-collapse.ts:60`: expanding an empty panel while stored-collapsed sets `forceOpen` **and** clears stored collapse. Intentional + tested (so the panel stays open once messages arrive), but it can erase a user's earlier manual collapse of a populated CONTEXT — a minor deviation from the literal "stored rightCollapsed never flipped." The hard invariant (never persist emptiness as `collapsed=true`) is honored. Consider leaving stored alone and relying on `forceOpen` only.
- **[low] `areaSubNavForRoute` duplicates the area map.** `nav-destinations.ts:~630` inlines the projects/sessions view→area membership "to avoid a circular import," with a comment to keep it in sync with `ROUTE_AREA_BY_VIEW`. Drift risk: a new projects/sessions view added there won't get a sub-nav unless this list is updated too. Consider a shared const or a test asserting parity.
- **[visual-QA] Breadcrumb seam on detail routes.** On `code` / `repos` / `repo-diff` / `terminal` the new thin breadcrumb+sub-nav strip sits above screens that may render their own header. Structurally fine (thin seam, not a big header); worth a quick visual pass to confirm it doesn't read as a double header.

## Verification not performed
- Full `vite build` / bundle-delta vs sco-084 (PR claims green).
- Live macOS embed drag (web `dragRegionProps={}`; native path is forward-looking).
