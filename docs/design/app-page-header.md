# App Page Header — reusable top-of-page band

Status: first implementation pass landed (component + 4 screens migrated).
Scope: `packages/web/client` only. Calm/dense/operational posture — no marketing hero.

## What this is

A single reusable header component for the top band **inside the Content slot** of
each screen — the page title / subtitle / status / actions row. It does **not**
replace the global shell chrome (`OpenScoutAppShell` → `NavigationBar` top tabs,
`SidePanel`s, bottom `StatusBar`) or the area-level tab pills
(`SecondaryNav` / `*Subnav` in the `.s-secondary-nav-bar`). Those are already
consistent. The per-page header band was the inconsistent layer.

## Component

- `packages/web/client/components/PageHeader.tsx`
- `packages/web/client/components/page-header.css`

Self-contained (ships its own CSS; no dependency on `system-surfaces-redesign.css`).
Values mirror the existing `.sys-page-*` treatment exactly, so screens migrating
from it stay pixel-identical.

### API

```tsx
<PageHeader
  title={ReactNode}        // required; rendered as `as` heading
  eyebrow?={ReactNode}     // uppercase mono context label above title (area/project/branch)
  subtitle?={ReactNode}    // one-line description
  meta?={ReactNode}        // inline metadata row (updated time, owner, counts, ids)
  status?={ReactNode}      // StatusPill / live dot — leads the actions cluster
  syncNote?={ReactNode}    // muted timestamp note before the buttons
  actions?={ReactNode}     // action buttons / toggles
  lead?={ReactNode}        // leading slot (back button, avatar)
  as?={"h1" | "h2"}        // default "h2"
  className?={string}
  titleId?={string}        // for aria-labelledby wiring
/>
```

Render anatomy (every region optional except `title`):

```
[lead]  [eyebrow / title / subtitle / meta]            [status · syncNote · actions]
```

CSS classes: `.s-page-header` › `.s-page-header-bar` › `.s-page-header-lead`,
`.s-page-header-titles` (`-eyebrow`/`-title`/`-subtitle`/`-meta`),
`.s-page-header-actions` (`-sync`). Collapses to a stacked column at `≤780px`
(matches the legacy `.sys-page-head` breakpoint).

## Current-state inventory (why this was needed)

Three header families existed before this pass:

1. **`.sys-page-*`** (`system-surfaces-redesign.css`) — the de-facto standard,
   used verbatim on Activity, Briefings, AgentConfiguration, Settings, and
   partially Broker. Calm title/subtitle + actions row. **This pass promotes it
   to a component.**
2. **`.s-secondary-nav-shell` / `.s-secondary-nav-bar`** — area tab band, already
   shared via `SecondaryNav`. Left as-is (it is the tabs/segmented-control layer,
   orthogonal to the page header).
3. **Bespoke per-screen headers** — one class namespace each, no reuse:
   - `.hd-*` HomeHero · `.s-thread-center-header` ConversationScreen ·
     `.ch-center-header` ChannelsScreen · `.s-conversations__hero` ConversationsScreen
   - `.s-profile-identity*` AgentsScreen · `.s-agent-profile-hero*` AgentInfoScreen ·
     `.s-work-casefile-hero` + `-topbar` WorkDetailScreen · `.s-term-bar` TerminalScreen
   - `.s-mission-bar` MissionControl · `.mesh-hud` MeshScreen · `.s-tail-status` TailView ·
     `.s-atop-summary` + `.s-atop-fbar` AtopView/SessionsScreen · `.s-plan-banner` PlanView ·
     `.s-ops-agents-toolbar`+`-hero`+`-stats` OpsAgentsView · `.briefing-detail-header`
     BriefingDetailScreen · `.ctx-panel-*-head` inspector panels · `.s-settings-header`
     SettingsDrawer · `.ks-preview-head` KnowledgeSearchInspector

### Recurring header needs (the slots the component covers)

eyebrow/kicker · title · subtitle · status signal (pill/dot/live) · metadata row ·
primary+secondary actions · sync note · leading back/avatar. The dense
**operational toolbar** variant (search + filter pills + segmented toggles +
live counters — Mission/Mesh/Tail/Atop/Sessions/OpsAgents) is a *second*
archetype that belongs **below** the PageHeader as a `controls` band; not folded
into this component yet (see follow-ups).

## First pass — migrated (zero visual change, pure consolidation)

These already used identical `.sys-page-head` markup; swapped to `<PageHeader>`:

- `screens/ActivityScreen.tsx` (title + subtitle + syncNote + Refresh)
- `screens/BriefingsScreen.tsx` (title + subtitle + Refresh)
- `screens/AgentConfigurationScreen.tsx` (title + subtitle + conditional syncNote + Refresh)
- `screens/SettingsScreen.tsx` (title + subtitle + StatusPill status + syncNote + Refresh)

Verification: `tsc --noEmit -p packages/web/tsconfig.json` → 0 errors;
`bun test --isolate ./client` → 67 pass / 0 fail.

The `.sys-page-head` / `.sys-page-title*` / `.sys-page-actions` / `.sys-sync-note`
CSS rules can be deleted once no screen references them (BrokerScreen still uses
`.sys-ledger-toolbar`, a different selector). Leave `.sys-surface-page`,
`.sys-stat-*`, `.sys-panel` — those are page-body, not header.

## Migration order for remaining screens

Tier 1 — same document/overview shape, low risk, high payoff:
1. `BriefingDetailScreen` (`.briefing-detail-header`) → PageHeader with `lead`=back,
   `title`, `meta`=kind+timestamps, `subtitle`=summary.
2. `ConversationsScreen` (`.s-conversations__hero`) → `eyebrow`="Playground",
   `title`, `subtitle`, `actions`=Refresh; keep `.s-conversations__toolbar` below.
3. `WorkDetailScreen` (`.s-work-casefile-hero`) → `lead`=back, `title`,
   `status`=StatusPill phase, `subtitle`=summary, `meta`=updated/owner/state.
   (Keep the right-side "Next Move" aside as a sibling.)
4. `AgentInfoScreen` (`.s-agent-profile-hero`) → `lead`=avatar+back, `title`=name,
   `status`=state chip, `meta`=handle/class/role, `actions`=AgentLiveActions.
5. `OpsAgentsView` (`.s-ops-agents-hero`/`-toolbar`) → header from hero; keep
   stats grid + filter toolbar as body bands.

Tier 2 — needs the `controls` band (operational toolbar archetype) first:
   MissionControl, MeshScreen, TailView, AtopView, SessionsScreen filter bar.

Tier 3 — distinct chrome, evaluate separately: HomeHero (rich briefing hero —
likely keep bespoke), ChannelsScreen `#`-title + members popover, ConversationScreen
thread header (participants), TerminalScreen dark bar, inspector `.ctx-panel-*`
panels (right-rail, narrower — may want a `PanelHeader` sibling instead),
SettingsDrawer (modal).

## Follow-ups

- Add an optional `controls` slot (or a sibling `PageToolbar`) for the
  search/filter/segmented archetype, then migrate Tier 2.
- Consider a narrower `PanelHeader` for right-rail inspectors rather than forcing
  PageHeader into 280px panels.
- Once Tier 1 lands, delete the now-orphaned `.sys-page-head*` rules.
