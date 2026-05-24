---
title: Inspector atom rollout
status: draft
blurb: Two-PR plan to extract shared inspector atoms identified in the audit.
source:
  - docs/inspector-bar-audit.md
  - packages/web/client/scout/slots/Inspector.tsx
order: 10
---

# Inspector atom rollout

A planned consolidation of the right "Inspector" panel based on the
findings in [docs/inspector-bar-audit.md](../docs/inspector-bar-audit.md).
The audit catalogued 8 inspector variants across 9 routes and surfaced
three load-bearing problems: a 709-line dispatch file with two
unextracted inspectors inlined, three copy-pasted `Section`/`Row`
microcomponents, and a `window.scoutOpsDetailSnapshot` side-channel
that should be normal application state.

This plan turns that audit into two reviewable PRs plus a small
backlog.

## PR 1 — extract & adopt atoms

Scope: zero behavior change, shrink the surface area.

- Add `packages/web/client/scout/inspector/atoms/`:
  - `InspectorSection` — replaces the three private `Section({ label, children })`
    components in `HomeAgentsInspector`, `AgentsInspector`, `SessionsInspector`.
    Supports optional `count` chip + trailing `action` slot. Live preview at
    `/atoms/inspector-section` in this studio.
  - `InspectorRow` — replaces the duplicated `Row({ label, value })`.
  - `InspectorActionButton` — lifted from `WorkInspector.tsx:269-297`. Hardcoded
    cyan swapped for `--accent` token.
  - `InspectorEmpty` — single empty-state shell, replaces
    `BrokerInspectorEmpty` and five other one-off variants.
- Migrate the three dedicated inspector files to consume them.
- Replace `BrokerInspectorEmpty` callsites.

**Acceptance:** screenshots before/after for Home/Agents/Sessions/Work/Broker;
no visual regression; net negative LoC.

## PR 2 — extract Channel + Ops, kill the side-channel

Scope: move two inline inspectors out of dispatch; remove the window
event hack.

- `ChannelInspectorPanel` (`Inspector.tsx:273-456`) → new
  `scout/inspector/ChannelInspector.tsx`.
- `OpsInspectorPanel` (`Inspector.tsx:475-616`) → new
  `scout/inspector/OpsInspector.tsx`.
- Replace `window.scoutOpsDetailSnapshot` + `scout:ops-detail` `CustomEvent`
  with a `useOpsSelection()` store on `useScout()`. The producing pane
  (ops editor / canvas / wherever) sets selection through the context;
  the inspector reads it. No more `window` channel.
- Result: `Inspector.tsx` shrinks to dispatch + Ranger management
  (~150 LoC, down from 709).

**Acceptance:** Ops detail snapshot still works end-to-end (cross-pane
selection populates the inspector); grep for `scout:ops-detail` returns
nothing; `Inspector.tsx` under 200 LoC.

## Backlog (later PRs)

- **`useInspectorData<T>(key, fetcher, eventFilter)`** — the four
  inspectors that currently refetch on *every* broker SSE event
  (`Agents`, `Sessions`, `Work`, `Channel`) declare which event kinds
  they care about. Eliminates the bulk of redundant `/api/*` GETs.
- **Tier 2 atoms** — `InspectorStatGrid`, `AgentPulseRow`,
  `ActivityCard`, `DetailGrid` (merging `sys-detail-grid` and
  `InspectorRow` once Tier 1 has settled).
- **Ranger extraction** — move height clamping out of
  `ScoutInspector` into `useResizableRanger()` hook. Fix the
  counterintuitive `startHeight - delta` direction on drag.
- **CSS housekeeping** — collapse `.ctx-panel-sub` and
  `.ctx-panel-preview` (currently typographically identical); promote
  the repeated `color-mix` boilerplate to a small tint variable set.

## Open questions

- Should `InspectorRow` and `DetailCard` ship as one atom or two?
  Audit suggests one, but the Mesh peer-detail use case has different
  density requirements than the Agents identity block.
- Where do the new atoms live for the future `apps/desktop` consumer?
  Today they're scoped to `packages/web/client/scout`; if the desktop
  ever wants the same primitives, they need to move up to `@openscout/web`
  or a new `@openscout/inspector` package.

## Why now

The inspector is the most-touched surface in the web client. Every
new feature reaches for it. Today, adding a new inspector means
inventing a new `Section` and a new `Row` and a new button color.
Landing the four Tier-1 atoms before the next feature wave keeps the
file count flat instead of compounding.
