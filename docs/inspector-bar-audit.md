# Inspector Bar Audit

A cross-screen audit of the right "Inspector" panel in the OpenScout web client. Compiled from a three-agent parallel pass over the eight inspector variants, the dispatch shell, and the shared `ctx-panel.css` vocabulary.

**TL;DR**

- The Inspector slot has **8 variants** across **9 routes**. Five live in dedicated files, three are inlined in the dispatch (`Channel`, `Ops`, `BrokerInspectorEmpty`).
- **Two of the biggest inspectors are inline in the dispatch file** (`Inspector.tsx` is 709 lines). Channel/Ops should be extracted before they grow further.
- **The dedicated inspector files mostly ignore `ctx-panel.css`.** `WorkInspector`, `MeshInspector`, `BrokerAttemptInspector` all roll bespoke styling; only the inline Channel/Ops panels actually use the shared atoms.
- **Three near-identical `Section` + `Row` micro-components are copy-pasted** across Home/Agents/Sessions. This is the single highest-ROI extraction.
- **Data-freshness strategies vary wildly** — from "snapshot only" (Broker) to "refetch on every SSE event" (Work, Channel) to "manual polling loop" (Mesh). No consistent contract.
- **Smart-use verdicts**: 3 inspectors are smart (Agents, Work, Mesh), 3 are partial (Home, Sessions, Broker), 2 are weak (Channel, Ops). The weak ones are weak because of arbitrary caps and side-channel hacks (`scout:ops-detail` window event), not because the screen doesn't need an inspector.

---

## 1. Inventory: routes → inspector

Source of truth: `packages/web/client/scout/slots/Inspector.tsx:85-123`.

| Route view(s)             | Inspector                                | File                                              |
|---------------------------|------------------------------------------|---------------------------------------------------|
| `inbox`, `fleet`          | `HomeAgentsInspector`                    | `scout/inspector/HomeAgentsInspector.tsx` (112)   |
| `agents`, `agent-info`    | `AgentsInspector`                        | `scout/inspector/AgentsInspector.tsx` (663)       |
| `sessions`, `conversation`| `SessionsInspector`                      | `scout/inspector/SessionsInspector.tsx` (126)     |
| `channels`                | `ChannelInspectorPanel` *(inline)*       | `scout/slots/Inspector.tsx:273-456`               |
| `work`                    | `WorkInspector`                          | `scout/inspector/WorkInspector.tsx` (394)         |
| `mesh`                    | `MeshInspectorPanel`                     | `scout/inspector/MeshInspector.tsx` (548)         |
| `ops` (mission/plan/issues/tail/atop/agents) | `OpsInspectorPanel` *(inline)* | `scout/slots/Inspector.tsx:475-616` |
| `broker`                  | `BrokerAttemptInspector` / `BrokerInspectorEmpty` | `screens/BrokerScreen.tsx` + `Inspector.tsx:140-147` |
| *anything else*           | `null` (no inspector)                    | `Inspector.tsx:121-123`                           |

Below the route content sits a resizable `RangerPanel` (2,269 lines, out of scope here but it shares the inspector container and the height-clamp dance lives in `ScoutInspector`).

---

## 2. Per-inspector verdicts (matrix)

| Inspector            | Smart?  | Density          | Freshness                                  | Reuses `ctx-panel-*`? | LoC |
|----------------------|---------|------------------|--------------------------------------------|-----------------------|-----|
| HomeAgents           | Partial | Sparse           | None (prop-drilled, never refetched)       | No (bespoke)          | 112 |
| Agents               | Yes     | Dense            | `/api/fleet` + `/api/agents/:id/observe`, refetch on **any** SSE event | No (bespoke)          | 663 |
| Sessions             | Partial | Stat-heavy       | `/api/sessions`, refetch on **any** SSE event | No (bespoke)          | 126 |
| Channel (inline)     | No      | High, capped 12  | `/api/work` + `/api/runs`, SSE-driven      | **Yes** (best citizen) | ~180 |
| Work                 | Yes     | Dense            | `/api/work/:id`, refetch on **any** SSE event | No (bespoke)          | 394 |
| Mesh                 | Yes     | Stat wall, 3 paths| Snapshot + 6–12 attempt polling on reach actions | No (`sys-*` family)   | 548 |
| Ops (inline)         | No      | Very dense       | Fleet on filtered SSE + `window` event for detail | Partial (stats, pulse) | ~140 |
| Broker (attempt)     | Partial | JSON dump        | Static prop snapshot, no refresh           | No (`sys-*` family)   | ~50  |
| Broker (empty)       | -       | One sentence     | -                                          | No                    | 7   |

**Smart-use** = does the inspector show something the operator couldn't see in the main content?

---

## 3. Cross-cutting findings

### 3.1 The dispatch file is now the second-largest UI file in the package

`Inspector.tsx` (709 LoC) hosts dispatch + Ranger height math + three inline inspectors (Channel ~180 LoC, Ops ~140 LoC, Broker empty stub) + multiple helpers (`buildChannelActivityItems`, `parseOpsDetailSnapshot`, `OpsStat`, `OpsAttentionButton`, `OpsAskButton`, `ChannelActivityButton`, `channelRouteLabel`). Either extract Channel/Ops into `scout/inspector/`, or commit to "dispatch + everything inline" and stop the cross-pattern drift.

### 3.2 Section + Row are reinvented three times

`HomeAgentsInspector`, `AgentsInspector`, `SessionsInspector` each define their own private `Section({ label, children })` and `Row({ label, value })` components. Identical shape, slightly different Tailwind. This is the single most obvious extraction. References:
- `HomeAgentsInspector.tsx:45-66`
- `AgentsInspector.tsx:635-663`
- `SessionsInspector.tsx:98-126`

### 3.3 Three competing button/atom families

- `WorkInspector.tsx:269-297` — local `InspectorActionButton` with hardcoded cyan hover
- `MeshInspector.tsx` — uses `s-btn` + `sys-*` namespace
- `BrokerScreen.tsx:359-406` — uses `s-btn-sm` + `sys-broker-*`
- Inline panels — use `ctx-panel-*`

Four button vocabularies in the same slot. Pick one.

### 3.4 `sys-detail-grid / sys-detail-card` is the hidden hero

Both `MeshInspector` (peer/node detail) and `BrokerAttemptInspector` use a key/value fact-sheet grid via `sys-detail-grid` + `sys-detail-card`. `WorkInspector` rebuilds the same shape with a bespoke `Row`. This is the second most obvious extraction: a `DetailGrid` / `DetailCard` pair that the `Row` from §3.2 can be implemented on top of.

### 3.5 Side-channel state via `window`

`OpsInspectorPanel` reads `window.scoutOpsDetailSnapshot` on mount and listens for a `scout:ops-detail` `CustomEvent` (`Inspector.tsx:487-506`). There is no owner, no cleanup when the source pane closes, and no schema validation beyond a coercion in `parseOpsDetailSnapshot` (line 635). This is the loudest architectural smell in the audit — it implies the Ops editor and the inspector were built separately and never unified. The right shape is putting the selection into `useScout()` (or a dedicated `useOpsSelection()` store).

### 3.6 Data-freshness has no shared contract

| Strategy                                | Used by                              | Risk                                      |
|----------------------------------------|--------------------------------------|-------------------------------------------|
| Prop-drilled, never refreshed          | HomeAgentsInspector                  | Stale on cross-tab/cross-pane changes     |
| Refetch on **every** broker SSE event  | Agents, Sessions, Work, Channel      | Noisy; full GETs for unrelated events     |
| SSE event whitelist                    | Ops (fleet only)                     | Better, but detail snapshot stays stale   |
| Snapshot + polling loop                | Mesh (reach actions, 6–12 attempts)  | Hardcoded; no timeout UX                  |
| Static one-shot                        | Broker                               | Fine for an artifact view                 |

This is the single largest source of latent perf cost. A thin `useInspectorData<T>(key, fetch, eventFilter)` hook would let each inspector declare which broker events matter.

### 3.7 `ctx-panel.css` is rich but under-used

The shared sheet (671 LoC) defines ~14 atom families. The inline Channel/Ops panels are by far the heaviest consumers. The dedicated inspector files (`AgentsInspector`, `SessionsInspector`, `WorkInspector`, `MeshInspector`) reach for `ctx-panel-*` **zero times** between them — they each rebuild section labels, list items, dot indicators with Tailwind or local `sys-*` classes. This is the inverse of where the leverage should be: the *files* are dedicated but the *styling* is bespoke; the *inline* panels are shoved into dispatch but their styling is reusable.

### 3.8 Empty / error states are inconsistent

- `BrokerInspectorEmpty` — one sentence, no affordance (`Inspector.tsx:140-147`)
- `WorkInspector` — generic "Loading work item…"
- `HomeAgentsInspector` — centered, smaller font
- `AgentsInspector` / `SessionsInspector` — show summary stats inline
- `ChannelInspectorPanel` — proper "select a channel" with `ctx-panel-empty-state`

No consistent affordance, no error boundary. `load()` functions silently `.catch(() => null)`.

### 3.9 Ranger interplay is fragile

In `ScoutInspector` (lines 30–80):
- Height clamp re-runs on every render with no memoization (lines 50–56) — risks re-render loops if `setRangerHeight` cascades.
- Drag math uses `startHeight - delta` (line 66) — counterintuitive direction; verify on real hardware.
- Resize handle is only mounted when not collapsed; uncollapsing while a drag is in flight is undefined.

Move this into `RangerPanel.tsx` or a `useResizableRanger()` hook.

### 3.10 Layout coupling via custom events

`OpenScoutAppShell.tsx:274-285` listens for `scout:set-inspector-width` to expand the inspector. No inspector currently fires it. Either remove the event (dead code) or have inspectors that want extra space (e.g., Mesh peer detail) emit it.

---

## 4. Reusable component proposal

Ranked by ROI. Sized by "what this would delete or consolidate today".

### Tier 1 — extract now

1. **`<InspectorSection label={…} count={…} actions={…}>`**
   Replaces the three private `Section` components in Home/Agents/Sessions + the manual `ctx-panel-section` + `ctx-panel-section-label` markup in Channel/Ops. Optional `count` chip (already styled as `ctx-panel-count`) and optional trailing action slot. **Touches: 5 files.**

2. **`<InspectorRow label value tone?>`**
   The `Row({ label, value })` micro-component duplicated in Agents and Sessions, plus the `sys-detail-card` shape in Mesh/Broker. **Touches: 4 files.**

3. **`<InspectorActionButton icon label onClick tone?>`**
   Lift `WorkInspector.tsx:269-297` into `scout/inspector/atoms/`, swap hardcoded cyan for `--accent` token, and rewire Mesh's `s-btn` + Broker's `s-btn-sm` callsites. **Touches: 3 files.**

4. **`<InspectorEmpty title? hint cta?>`**
   One empty-state shell. Replaces `BrokerInspectorEmpty`, the five other one-off empty states, and standardises copy + iconography. **Touches: 6 files.**

### Tier 2 — extract next

5. **`<InspectorStatGrid items={[{label, value, tone}]}>`**
   Already partially exists as `OpsStat` (`Inspector.tsx:618-633`) using `ctx-panel-stat`/`ctx-panel-stat-grid`. Generalize and adopt in `AgentsInspector` (trace stats grid `AgentsInspector.tsx:344-355`) and the summary-stat blocks in Home/Sessions.

6. **`<AgentPulseRow agent navigateOnClick? />`**
   Wraps `ctx-panel-pulse-row` + `ctx-panel-pulse-dot--*`. Currently only Ops uses these classes (`Inspector.tsx:599-612`), but Home, Agents, and Sessions all show some flavour of agent list. Replaces three bespoke `AgentRow` flavours.

7. **`<ActivityCard item={ChannelActivityItem|FleetAsk|FleetAttentionItem} onClick>`**
   `ChannelActivityButton` (`Inspector.tsx:410-456`), `OpsAttentionButton` (655-680), and `OpsAskButton` (683-708) are the same shape with different fields. Unify behind a discriminated-union prop.

8. **`<DetailGrid>` / `<DetailCard label value>`**
   Promote `sys-detail-grid` + `sys-detail-card` (Mesh, Broker) into the shared atom layer. Once it lives in `ctx-panel.css`, `InspectorRow` (Tier 1 #2) becomes a thin wrapper over it.

### Tier 3 — once Tier 1/2 land

9. **`<InspectorHeader kicker title actions?>`**
   Standardize the kicker/title/action pattern (Broker uses `sys-broker-inspector-head` + `sys-kicker`; Mesh has its own; Work has a sticky variant).

10. **`useInspectorData<T>(key, fetcher, eventFilter)`** *(hook, not component)*
    A single hook that owns initial fetch + `useBrokerEvents()` filtering + debouncing. Each inspector declares which events trigger a refetch. Replaces the four hand-rolled patterns in §3.6.

11. **`useOpsSelection()`** *(state)*
    Move the `window.scoutOpsDetailSnapshot` / `scout:ops-detail` channel into `useScout()` so Ops can be a normal consumer of shared state.

### Suggested file layout

```
packages/web/client/scout/inspector/
  atoms/
    InspectorSection.tsx
    InspectorRow.tsx
    InspectorActionButton.tsx
    InspectorEmpty.tsx
    InspectorStatGrid.tsx
    AgentPulseRow.tsx
    ActivityCard.tsx
    InspectorHeader.tsx
  hooks/
    useInspectorData.ts
  ChannelInspector.tsx          ← extract from Inspector.tsx
  OpsInspector.tsx              ← extract from Inspector.tsx
  (existing: Home/Agents/Sessions/Work/Mesh)
```

---

## 5. CSS / token cleanup

From the `ctx-panel.css` inventory:

**Merge / unify:**
- `.ctx-panel-sub` and `.ctx-panel-preview` are typographically identical (lines 271-279). Collapse to one class.
- `.ctx-panel-item--attention` vs `.ctx-panel-item--active` — both are state tints. Decide whether "selected" and "unread/attention" should share a base.
- `.ctx-panel-dot` and `.ctx-panel-pulse-dot--*` — same primitive with/without halo. Add a `--halo` modifier instead of two parallel families.

**Promote out of `ctx-panel.css`:**
- Font scale (9 / 9.5 / 11.5 / 13 / 15+ px) is hardcoded per rule. Move to design tokens.
- The `color-mix(in srgb, var(--…) N%, transparent)` boilerplate is repeated 30+ times. A small set of tint vars (`--tint-strong`, `--tint-soft`, `--tint-warn`) would simplify.
- Identical gradient boilerplate on lines 327-330 and 410-412 — extract to a variable.

**Scope-leak candidates (used in exactly one place):**
- `.ctx-panel-selected-*` family (Ops detail card)
- `.ctx-panel-channel-card`, `.ctx-panel-channel-summary`, `.ctx-panel-channel-item` (Channel)
- `.ctx-panel-ops-summary`, `.ctx-panel-ops-mode-card` (Ops)
- `.ctx-panel-roster-*` (HomeAgents roster button)

These shouldn't necessarily move *out* of `ctx-panel.css` (they're inspector-flavored), but once Channel/Ops are extracted into their own files, the styles should travel with them or be renamed without the `ctx-panel` prefix.

---

## 6. Suggested rollout

A two-PR plan, scoped to keep each change reviewable:

**PR 1 — extract & adopt atoms (Tier 1)**
- Add `scout/inspector/atoms/` with `InspectorSection`, `InspectorRow`, `InspectorActionButton`, `InspectorEmpty`.
- Migrate Home/Agents/Sessions to use them (deletes three `Section`/`Row` copies).
- Migrate `WorkInspector` to the shared `InspectorActionButton`; delete its local copy.
- Replace `BrokerInspectorEmpty` with `InspectorEmpty`.
- No behavior change.

**PR 2 — extract Channel + Ops, kill the side-channel**
- Move `ChannelInspectorPanel` → `scout/inspector/ChannelInspector.tsx`.
- Move `OpsInspectorPanel` → `scout/inspector/OpsInspector.tsx`.
- Replace `window.scoutOpsDetailSnapshot` + `scout:ops-detail` with a `useOpsSelection()` store on `useScout()`.
- `Inspector.tsx` shrinks to dispatch + Ranger management (~150 LoC).

**Later (separate PRs):**
- `useInspectorData` hook + adopt across the four refetch-on-everything callsites.
- Tier 2 atoms (StatGrid, AgentPulseRow, ActivityCard, DetailGrid).
- Move Ranger height management out of `ScoutInspector`.

---

## Appendix: file:line index of the most-cited code

- `Inspector.tsx:50-56` — Ranger clamp effect that risks re-render churn
- `Inspector.tsx:66` — Counterintuitive `startHeight - delta` resize math
- `Inspector.tsx:140-147` — `BrokerInspectorEmpty`: a one-line stub
- `Inspector.tsx:256-271` — `buildChannelActivityItems` aggregation w/ arbitrary 12/6 caps
- `Inspector.tsx:410-456` — `ChannelActivityButton` template
- `Inspector.tsx:487-506` — `window.scoutOpsDetailSnapshot` + `scout:ops-detail` side-channel
- `Inspector.tsx:518-520` — Client-side filter of `activeAsks` vs `needs_attention`
- `Inspector.tsx:618-633` — `OpsStat` (existing atom, generalize)
- `Inspector.tsx:655-708` — `OpsAttentionButton` / `OpsAskButton` near-duplicates
- `AgentsInspector.tsx:148-150` — `useBrokerEvents` triggers full fleet refetch
- `AgentsInspector.tsx:344-355` — Trace stats grid (StatGrid candidate)
- `AgentsInspector.tsx:635-663` — Local `Section` + `Row` (extract candidate)
- `SessionsInspector.tsx:98-126` — Identical local `Section` + `Row`
- `HomeAgentsInspector.tsx:45-66` — Third copy of `Section` + `AgentRow`
- `WorkInspector.tsx:32-37` — Refetch on every SSE event (filter candidate)
- `WorkInspector.tsx:269-297` — `InspectorActionButton` (lift candidate)
- `MeshInspector.tsx:53-81` — `pollMeshStatus` polling loop
- `MeshInspector.tsx:395-412` — Clean stat-grid usage
- `BrokerScreen.tsx:359-406` — `BrokerAttemptInspector` clean prop interface
- `OpenScoutAppShell.tsx:274-285` — `scout:set-inspector-width` listener (currently no producer)
- `ctx-panel.css:271-279` — `.ctx-panel-sub` vs `.ctx-panel-preview` (duplicate)
- `ctx-panel.css:327-330`, `410-412` — Repeated gradient boilerplate
