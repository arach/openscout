# PR #403 review — sco-084: adopt the real shadcn sidebar component

Reviewer: session-mru0ybk2-w7mqim · 2026-07-20
Branch: `sco-084/shadcn-sidebar` · flag-gated (`nav.sidebar`).

**Verdict: merge-ready.** No blocking or medium issues. All 8 verification
points pass on implementation, tsc is clean on every new file, the canonical
client shard is green (636 pass / 0 fail), and the focused collapse suite is
green (9 pass). The nits below are maintenance/faithfulness only — none block.
As a bonus this PR closes the two open nits from the sco-083/#401 review (the
brittle `@hudsonkit` test import and the "collapse test doesn't test collapse
logic" gap) by extracting pure transitions into a React-free module.

Method: read all changed sources; `tsc -p packages/web` (local binary) filtered
to the new files; `bun test --isolate ./client`; focused
`useSidebarCollapse.test.ts`; inspected bun.lock + package.json diffs.

---

## Per-point verification

### 1. `sidebar.tsx` faithful shadcn port, Base UI, no Radix, no mobile — ✅ PASS
- Header records upstream `shadcn-ui/ui apps/v4/registry/bases/base/ui/sidebar.tsx`
  @ `f31ed81983653919dd4fe77aee4b4859f610f1dc`, registry style base-nova
  (`sidebar.tsx:1-28`). Structure kept for future `shadcn` CLI diffs.
- Ports to installed `@base-ui-components/react@1.0.0-rc.0`: `merge-props`,
  `use-render` (`sidebar.tsx:31-32`), tooltip/button/separator each import
  `@base-ui-components/react/*` (`tooltip.tsx:6`, `button.tsx:6`,
  `separator.tsx:6`). Every literal `@base-ui/react` in the new files is a
  comment documenting the port — **zero live imports** of the renamed package.
- **No Radix**: `grep -c radix bun.lock` → 0; no `@radix` import anywhere.
- Mobile/offcanvas fully deleted: no `openMobile`/`isMobile`/`use-mobile`/`Sheet`/
  `SIDEBAR_WIDTH_MOBILE`/`"offcanvas"`; `collapsible` is `"icon" | "none"` only
  (`sidebar.tsx:151`); `useSidebar()` context trimmed to
  `{state, open, setOpen, toggleSidebar}` (`sidebar.tsx:53-58`). Grep matches for
  mobile/cookie/sheet are all comments.

### 2. Controlled `SidebarProvider` wiring — ✅ PASS
- `open={!effectiveCollapsed}` + `onOpenChange={(open) => setCollapsed(!open)}`
  (`OpenScoutAppShell.tsx:892-893`). Because `openProp` is always supplied,
  `open = openProp ?? _open` resolves to `openProp` unconditionally
  (`sidebar.tsx:85`) — the internal `_open` is dead, so **open/onOpenChange
  cannot diverge from `effectiveCollapsed`**.
- Idempotent `setCollapsed`: pure `applySetCollapsed` + functional setState with
  `current === next ? current : next` guards (`useSidebarCollapse.ts:82-89`) → no
  spurious re-render, idempotent semantics preserved. Verified by tests incl. the
  narrow-viewport regression guard (`useSidebarCollapse.test.ts:64-112`).
- Narrow (auto-collapse) trace confirms the Codex correction: toggling flips
  session-only `forceExpanded`, never `manualCollapsed`
  (`sidebar-collapse-state.ts:33-47`).
- Cookie deleted: `setOpen` has no `document.cookie` write (`sidebar.tsx:86-97`).

### 3. Shell keeps Cmd+B, provider listener gone — ✅ PASS
- Provider keyboard listener removed (`sidebar.tsx:103` comment; no keydown
  effect in the provider).
- Shell owns Cmd+B (`OpenScoutAppShell.tsx:606-617`) with an editable guard
  (`:610` `if (key === "b" && typing) return`) and a terminal guard
  (`:570` `isTerminalInputTarget` early return); routes to
  `sidebarCollapse.toggleCollapsed()`. No double-toggle path remains.

### 4. Geometry — ✅ PASS
- `pointer-events-auto` scoped to the sidebar container only
  (`sidebar.tsx:190`, and the `collapsible="none"` container `:161`). The
  provider wrapper uses `contents` (`:130`) — no layout box, no hit target, so
  the content pane is never intercepted.
- StatusBar inset: container `bottom-[28px]` (`:191`); content pane `bottom: 28`
  (`OpenScoutAppShell.tsx:835`).
- Top edge: `top-[var(--scout-sidebar-top,48px)]`, container `z-40` under the
  `z-50` nav → sidebar starts below nav, brand clickable
  (`sidebar.tsx:191` + shell sets `--scout-sidebar-top: navTotalHeight`
  `:898`). Replaces upstream `inset-y-0 h-svh`.

### 5. `ScoutSideRail` distinct slot sharing SidePanel; inset math — ✅ PASS
- Separate shell slot from both the nav sidebar and the legacy `LeftPanel`
  branch (`OpenScoutAppShell.tsx:889-919` vs the `else` at `:920+`). Uses the
  HudsonKit `SidePanel` component without wrapping/restyling it into a sidebar
  (`ScoutSideRail.tsx:78-97`); positioned `left: navRailWidth`.
- Inset = nav rail + side rail: `leftPushInset = sidebarCollapse.width +
  sideRailPushWidth`, `sideRailPushWidth = leftWidth` when active & not collapsed
  (`OpenScoutAppShell.tsx:797-805`).
- Footer pinned via SidePanel `footer` prop (Mesh footer behavior preserved)
  (`ScoutSideRail.tsx:91`).

### 6. Default = 48px rail, expanded shows labels only, no content — ✅ PASS
- `manualCollapsed` defaults `true`, provider `defaultOpen=false`
  (`useSidebarCollapse.ts:40`, `sidebar.tsx:72`) → icon rail is the default.
- `ScoutSidebar` is pure navigation: Header (brand) · Content (Navigate + System
  groups from `PRIMARY_AREAS`, or Scope group) · Footer (broker status +
  trigger). No Context group (`ScoutSidebar.tsx:147-247`). Scope items get an
  initial-letter fallback for the icon rail (`:197-204`).

### 7. `cn()` + `@theme inline` for Tailwind v4 — ✅ PASS
- `cn = twMerge(clsx(inputs))` (`lib/utils.ts:5-7`).
- `@theme inline` registers `--color-sidebar*` → `var(--sidebar*)` in
  `arc-tailwind.css:16-25` — the Tailwind entry file (`@import "tailwindcss"`),
  so `bg-sidebar` etc. resolve; tokens defined in `app.css:87-96`. Correctly
  placed in the processed CSS, not app.css alone.

### 8. No dependency bloat — ✅ PASS
- `packages/web/package.json` adds only `class-variance-authority`, `clsx`,
  `tailwind-merge` (`+3`). `@base-ui-components/react@1.0.0-rc.0` was already a
  direct dep on main. No Radix. Bundle delta reported +57.9 kB raw / +15.2 kB
  gzip — under the spec's stated baseline expectation (+99 / +33).

---

## Findings by severity

### Blocking — none.
### Medium — none.

### Low / nits
- **N1 — `sideRailHasContent` hand-mirrors `resolveSidebarContext`.** The
  view allow-list (`ScoutSideRail.tsx:27-42`) is a manual copy of the resolver's
  non-null cases. If `resolveSidebarContext` gains/loses a view, this list must
  be synced or the shell's left-inset arithmetic desyncs from what actually
  renders. `hideWhenEmpty` masks the visible failure (empty rail won't paint),
  so the only symptom is a momentary inset miscalc — latent, not a current bug.
  Consider deriving both from one map, or a parity test.
- **N2 — upstream `md:` remnants.** `md:after:hidden` / `md:opacity-0` survive
  in `SidebarGroupAction` / `SidebarMenuAction` (`sidebar.tsx:382,522-524`).
  These sit on family components Scout chrome never renders, and the spec's
  targeted deletions (the mobile `hidden md:block/flex` sheet gating) *are* gone.
  Cosmetic faithfulness only; keeping them arguably aids CLI diffs.
- **N3 — `@base-ui/react@1.4.0` sits in bun.lock**, but as a transitive of
  `@arach/arc@0.4.1` (pre-existing), **not** added by this PR (the bun.lock diff
  touches no `@base-ui` line). The PR correctly avoided the renamed package and
  imports only `@base-ui-components/react`. Flagging for a future Arc bump, not
  this PR.
- **N4 — two `tailwind-merge` copies.** web bumped to `3.6.0` (correct for
  Tailwind v4) while `@arach/dewey` keeps an isolated `2.6.1`. Expected/isolated;
  no action.

## Test evidence
- `tsc -p packages/web` (local binary): **no errors** in any new file
  (sidebar, button, input, separator, skeleton, tooltip, utils, ScoutSideRail).
- `bun test --isolate ./client`: **636 pass / 0 fail**, 73 files.
- `bun test ./client/scout/sidebar/useSidebarCollapse.test.ts`: **9 pass / 0
  fail** (now imports the React-free `sidebar-collapse-state.ts` — closes the
  sco-083 review's M1 brittleness + N1 coverage gap).
- `bun run --cwd packages/web test`: green.
