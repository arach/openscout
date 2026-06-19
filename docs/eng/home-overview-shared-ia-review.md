# Home / Overview — shared web + Mac IA review

Product/design review aligning the OpenScout **web** homepage with the proposed **native macOS** Home/Overview. Grounded in current code; no files changed. Operator direction baked in: Active Now and Recent Projects are the two primary anchors; top-level "Needs Attention" is not preferred (derive it); Quick Actions are a welcome change of pace; Recent Outcomes are optional.

## Surfaces inspected

- **Web Home** — default route → `screens/HomeScreen.tsx:474-1255`, rendered for the `fleet` and default cases in `scout/slots/Content.tsx:87,146`. Hero in `screens/HomeHero.tsx:391-552`.
- **macOS** — `Scout/ScoutRootView.swift` + `Scout/ScoutModels.swift:6-34`. There is **no Home/Overview today** — five equal sections (Comms, Agents, Tail, Repos, Settings).
- **Docs** — `docs/eng/sco-068-unified-native-settings.md` (Settings>Overview, system-health only), `docs/eng/scout-ios-home-projects-designreview.md` (iOS projects-first Home).

---

## 1) What the web homepage currently optimizes for

A top-to-bottom **dashboard / control center** for monitoring the whole fleet in real time. In render order:

1. **Hero** — operator/clock/sync, service-budget gauges, greeting + narrative counts, Quick Action buttons, 7d heart-rate graph (`HomeHero.tsx:391-552`).
2. **What's Moving** — live cards: `NowCard` (working agents, `HomeScreen.tsx:1628-1758`), `ObservedActorCard` (unmanaged actors mid-action, `1777-1851`), `MovingAskRow` (asks without an agent, `1853-1881`) — section `1048-1100`.
3. **No Recent Signal** — stalled agents (`NoRecentSignalRow`, `1883-1941`) — section `1103-1128`.
4. **Live Activity** — a **full-height raw event firehose** with 30m/6h/24h lookback pickers and "activity shape" stats — section `1131-1192`.
5. **Quiet Start** — embedded tail + always-on Quick Ask form when idle (`2076-2226`) — section `1194-1201`.
6. **Network Signals / Operator queue** — the "Needs Attention" block, conditional on `totalOperatorQueue > 0` (`OperatorAttentionCard` `1338-1504`, `AskBlocks` `1506-1568`, `AttentionRows` `1570-1626`) — section `1204-1250`.

**Data:** it reads the raw `/api/fleet` (full fleet incl. activity firehose), `/api/operator-attention`, `/api/heartrate` (`HomeScreen.tsx:549-555`). It does **not** read the broker's curated `/v1/home` — that endpoint exists (`server/core/broker/paths.ts:6`) but the web app only calls it for a remote OpenScout-Network reachability probe (`create-openscout-web-server.ts:4463`).

Net: optimizes for **live monitoring + triage of everything at once**.

## 2) Where it diverges from the desired shared Home model

- **Posture: log/workspace, not launchpad.** The biggest module is a raw event firehose (#4). The intended Home is an orientation/launchpad that previews one signal and pushes granular detail to ops — it should read curated feeds, not the raw firehose.
- **Curated feed bypassed.** `/v1/home` is built but unused by Home; Home aggregates the raw `/api/fleet` instead.
- **"Needs Attention" is a primary module.** The operator queue (#6) is its own top-level block. Operator direction is to derive attention, not anchor on it.
- **No Recent Projects anchor at all.** Projects appear only implicitly as `workspace` paths inside agent cards. The only real projects-first Home precedent is **iOS** (`scout-ios-home-projects-designreview.md`: folder rows, agents as children, single-agent compresses inline) — never ported to web or Mac.
- **Mac has no Home to share.** Five equal sections (`ScoutModels.swift:6-34`); SCO-068's "Overview" is a **Settings** system-health page, not a product Home. So web and Mac currently share no Home model.

## 3) Recommended shared structure (web + Mac)

Two primary anchors, supporting rails around them, same on both platforms:

- **Anchor A — Active Now** (already strong; keep as the top anchor). Reuse the existing live-card content (`NowCard` / `ObservedActorCard` / `MovingAskRow`). One unit per row; each row carries its own attention state inline.
- **Anchor B — Recent Projects** (new on web/Mac). Port the iOS Home › Projects model: project rows keyed by **repo identity** (git remote), recency-sorted, expandable to per-agent children, single-agent projects compressed inline. Each project row carries a derived attention badge.
- **Quick Actions** — a compact strip (ask · new session · refresh · open ops) as a change of pace, not a section.
- **Recent Outcomes** — optional, collapsed, below both anchors.
- **Data** — feed Home from curated `/v1/home` (or an equivalent curated aggregate), not the raw `/api/fleet` firehose. The firehose lives in Tail/Ops.
- **Mac** — add a Home/Overview as the **default landing place** mirroring the same two anchors. Keep it distinct from SCO-068's Settings>Overview (system health stays in Settings).

## 4) "Needs Attention" as a derived state, not a primary module

- **Remove** the standalone Network Signals / operator-queue block (`HomeScreen.tsx:1204-1250`) as a primary section.
- **Keep the data** (`/api/operator-attention`) but render it as **per-row state**: severity chips (blocked / needs input / review) on Active Now rows and aggregate badges on Recent Projects rows.
- **Relocate, don't rebuild, the actions.** Approve/Deny/Answer/Route already exist in `OperatorAttentionCard` (`1338-1504`) and `AskBlocks` (`1506-1568`) — move them onto the relevant agent/project rows.
- **One optional hero counter** ("3 need you") that filters/scrolls to flagged rows. The hero already computes needs-you counts (`HomeHero.tsx:486-531`) — reuse it instead of a dedicated section.

## 5) What Active Now and Recent Projects should contain

**Active Now** — only units with live/fresh signal:
- working managed agents — name, workspace, branch, runtime, model, context %, task + checkpoint, live/idle/queued/delivered pulse (`NowCard`, `1628-1758`);
- observed unmanaged actors mid-action (`ObservedActorCard`, `1777-1851`);
- asks in motion without an agent (`MovingAskRow`, `1853-1881`).
- Stalled / no-signal items (`NoRecentSignalRow`, `1883-1941`) **drop out** of Active Now — they become a stale badge on the project row or a small collapsed "stalled" sub-list, not part of the live anchor.

**Recent Projects** — project rows keyed by repo identity, most-recent-activity first:
- project name, agent count, last-activity age, derived attention badge;
- expandable to per-agent child rows; **child rows must not restate the parent name** (port the iOS discriminator: trailing id → harness/model → short sessionId → branch → "agent"; see designreview §1);
- single-agent projects compressed inline (folder → name / runtime).

## 6) Quick Actions placement

A single compact strip (≤ ~4 actions), **not a section**, living in/near the hero as a change of pace between the two anchors. The hero already hosts review-queue / open-ops / refresh (`HomeHero.tsx:504-529`) — keep it there and add **ask** / **new session**. The heavy always-on Quick Ask form (Quiet Start, `2076-2226`) becomes one such action that opens a composer, not an always-on block. On Mac, mirror as a small toolbar row at the top of Home.

## 7) What to remove / deprioritize

- **Demote the full-height Live Activity firehose** (`1131-1192`) off Home → it belongs in Tail/Ops. Home keeps at most a compact pulse preview (the heart-rate graph already does this, `HomeHero.tsx:533-548`).
- **Remove** the standalone operator-queue / Network Signals block as primary (see §4).
- **Collapse** Quiet Start's embedded tail + always-on ask form (`1194-1226`) into Quick Actions.
- **Fold** "No Recent Signal" into Recent Projects / Active Now as a state, not its own section.
- **Switch** the primary data source from `/api/fleet` firehose to curated `/v1/home`.

## 8) Acceptance criteria for a first implementation

1. Web Home (default route + `fleet`, `Content.tsx:87,146`) renders exactly two primary anchors, in order — **Active Now**, then **Recent Projects** — above any secondary content.
2. No standalone "Needs Attention" / "Network Signals" / operator-queue section renders. Attention shows only as per-row badges + inline actions on Active Now and Recent Projects rows, plus at most one optional hero counter.
3. Active Now lists only live/fresh units; stalled items are excluded from Active Now.
4. Recent Projects renders project-grouped rows (repo identity, recency-sorted), expandable to agents, single-agent compressed, with child rows that do not restate the parent name.
5. Quick Actions present as a ≤4-item strip in/near the hero (ask · new session · refresh · open ops); no full always-on ask form on Home.
6. The raw event firehose no longer renders full-height on Home; it is reachable via Tail/Ops; Home shows at most a compact pulse preview.
7. Recent Outcomes, if present, is collapsed/secondary and below both anchors.
8. Home's primary anchors read curated `/v1/home` (or equivalent curated aggregate), not `/api/fleet`'s raw activity stream.
9. Mac: a Home/Overview landing place exists mirroring the same two anchors, separate from Settings>Overview system-health (SCO-068). Parity check: same two anchors + same derived-attention rule on both platforms.

## Next owner

This is a review only. Greenlight is the operator's. Implementation splits cleanly:
- **Web** — a `packages/web/client`-scoped agent (HomeScreen restructure + `/v1/home` wiring).
- **Mac** — an `apps/macos`-scoped agent (new Home/Overview place mirroring the two anchors).
No agents woken; assign when the structure above is approved.
