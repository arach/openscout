# SCO-OPS-PROJECTIONS: Extract Ops Projections from Web Client

**Status:** Proposal — seeking quick engineering review  
**Author:** grok.codex-preserve-in-flight-work (via Scout ask)  
**Date:** 2026-06-19  
**Reviewers requested:** Codex (high effort)

## Summary

Extract portable **Ops projection logic** from the web client into `packages/ops`, starting with the **agent-lanes** projection. Ops is the operator situational-awareness domain; lanes, mission control, tail, plan, etc. are **modes** and **projection styles** within it — not top-level package or API nouns.

Tail remains the upstream firehose. Observe remains per-session trace. Ops owns multi-session interpretations built from those inputs plus broker roster state.

## Problem

1. **Agent Lanes intelligence is trapped in web client** (`agent-lanes-model.ts`, ~670 lines of pure logic) while macOS `ScoutTailStore` applies parallel low-signal filters — fork risk for Codex/Grok harness rules.
2. **Naming drift:** `packages/lanes` vs `/api/tail/projections/...` vs UI "Lanes" conflates product mode, derived view, and data source.
3. **Coupling:** `AgentLanesView` embeds full `SessionObserve` per column; the portable asset is the projection, not the React/CSS/replay stack.

## Decision: Ops everywhere (one spine)

| Layer | Name | Example |
| --- | --- | --- |
| Domain | **Ops** | Operator situational awareness |
| Package | `@openscout/ops` | `packages/ops` |
| Projection modules | under `projections/` | `projections/agent-lanes.ts` |
| Optional HTTP | `/api/ops/projections/*` | `GET /api/ops/projections/agent-lanes` |
| UI mode | unchanged | `OpsScreen`, `mode: "lanes"` |
| macOS | `ScoutOpsStore` | `.agentLanes` projection slice |

**Not:** `packages/lanes`, `/api/lanes`, or mixed `packages/lanes` + `/api/tail/projections/...`.

**Tail** keeps `/api/tail/discover`, `/api/tail/recent`, broker `tail.events`.  
**Observe** keeps `/api/observe/agents`, session-ref payloads.  
**Ops projections** are pure functions over those inputs — no broker writes, no durable lane records.

## Architecture

```
Tail (source)          Observe (per-session)     Broker roster
     │                        │                      │
     └────────────┬───────────┴──────────────────────┘
                  ▼
         packages/ops/projections/
              agent-lanes.ts  ──► AgentLane[]
              (future: mission-control, …)
                  │
      ┌───────────┴───────────┐
      ▼                       ▼
  Web shells              macOS store
  AgentLanesView          ScoutOpsStore.agentLanes
  MissionControlView      (embed / native later)
```

### Shared harness policy (cross-cutting)

`tail-display.ts` (noise rules, tail→observe field mapping, Grok phase filter, Codex chunk filter) is used by:

- Ops agent-lanes (`observeDataFromTail`)
- Session observe UI
- Server `tail-observe.ts`

**Keep in `@openscout/runtime`** (or dedicated `runtime/tail-display` export). Ops imports it; do not duplicate in `packages/ops`.

## Package layout (PR 1 — mechanical extraction)

```
packages/ops/
  package.json
  src/
    index.ts
    projections/
      agent-lanes.ts          # from agent-lanes-model.ts
      agent-lanes-preview.ts  # from agent-lane-preview.ts
      agent-lanes.test.ts     # move existing tests
  README.md                   # semantics: projections are derived, never persisted
```

### Public API (sketch)

```ts
export type AgentLaneHorizonKey = "5m" | "30m" | "4h" | "24h";

export type AgentLane = {
  id: string;
  agent: Agent;
  source: "scout" | "native";
  observe: ObserveData | null;
  lastActiveAt: number;
  current: boolean;
};

export type AgentLanesBuildInput = {
  transcripts: TailDiscoveredTranscript[];
  tailEvents: TailEvent[];
  processes?: TailDiscoveredProcess[];
  scoutAgents?: Agent[];
  observeCache?: Record<string, ObserveCacheEntry | undefined>;
  now: number;
  horizon?: AgentLaneHorizonKey;
  workingOnly?: boolean;
};

export function buildAgentLanes(input: AgentLanesBuildInput): AgentLane[];
export function observeDataFromTail(...): ObserveData;
export function sortLanesWithStableOrder(...): { lanes; newLaneIds };
// + label/preview/liveness helpers (lanePrimaryLabel, isAgentLaneLive, …)
```

Web `AgentLanesView` becomes a thin shell: `useTailFeed` + `buildAgentLanes` + React/CSS + optional `SessionObserve` lane embed.

## Optional HTTP (PR 2 — thin-client convenience, not required for web)

```
GET /api/ops/projections/agent-lanes?horizon=5m&workingOnly=true
```

Implementation:

```ts
const discovery = await tailDiscover();
const events = await tailRecent({ limit: 500, transcripts: true });
const agents = await listScoutAgents(); // + observe cache batch
return buildAgentLanes({ transcripts, tailEvents: events, scoutAgents, now, horizon, workingOnly });
```

- No caching layer initially (or short TTL in-memory only).
- Response is derived snapshot; `Cache-Control: no-store` or very short max-age.
- macOS phase 1 can consume this before Swift port.

## macOS rollout

| Phase | Approach |
| --- | --- |
| **1** | Deep-link or WKWebView embed: `/ops?mode=lanes` |
| **2** | `ScoutOpsStore` calling `/api/ops/projections/agent-lanes` or bundled `@openscout/ops` via sidecar |
| **3** | Native `ScoutAgentLaneColumn` — read-only trace strip, **not** full `ScoutObserveView` |
| **Retire** | `ScoutTailStore.isLowSignalMetadata` once ops/tail-display policy is shared |

## Out of scope (this proposal)

- Splitting `SessionObserve` into `LaneTracePreview` (follow-up UI PR).
- Mission-control projection extraction (`mission-control-model.ts` is mostly layout constants today).
- Broker protocol changes.
- Persisting ops projections.

## Test plan

- Move `agent-lanes-model.test.ts` → `packages/ops` unchanged behavior.
- Golden fixtures per harness (Codex shell enrichment, Grok phase noise) referenced from ops tests via `tail-display`.
- Web smoke: `AgentLanesView` still renders with import path change only (PR 1).
- If HTTP added: `create-openscout-web-server.test.ts` route test.

## Review questions for Codex

1. **Package home:** `packages/ops` vs nesting under `packages/runtime/src/ops/` — preference for publish boundaries and macOS consumption?
2. **HTTP timing:** Ship extraction PR 1 client-only first, or pair with `/api/ops/projections/agent-lanes` for macOS?
3. **`tail-display` location:** Stay in runtime vs co-locate with ops — given observe server and web client both import it?
4. **Types:** Import `Agent`, `ObserveData`, `TailEvent` from `@openscout/protocol` / shared types package, or duplicate slim DTOs in ops?
5. **Mission control:** Should topology grouping move under `packages/ops/projections/mission-control` in same PR series, or strictly agent-lanes first?
6. **Risks:** Any coupling in `buildAgentLanes` we should break before extraction (e.g. `ObserveCacheEntry` from web `observe.ts`)?

## Suggested PR stack

1. **PR1:** Create `packages/ops`, move agent-lanes + tests, rewire web imports — zero behavior change.
2. **PR2 (optional):** `GET /api/ops/projections/agent-lanes`.
3. **PR3:** macOS embed `/ops?mode=lanes`.
4. **PR4:** `LaneTracePreview` split from `SessionObserve` lane variant.

---

Please review for naming consistency, package boundaries, and PR ordering. Flag anything that would fork harness intelligence or create a false durable "lanes" resource in the broker.

---

## Review request (effort:high)

Quick engineering review — **not implementation**.

Reply to **grok.codex-preserve-in-flight-work** with:

1. **Verdict:** approve / revise / block (one line + rationale)
2. **Answers** to the six review questions above
3. **Gaps:** naming or boundary issues we missed
4. **PR1 scope:** exact files to move/create in the first diff

Keep the review concise (bullet-friendly). This proposal lives at `docs/eng/proposals/sco-ops-projections-extraction.md` in `/Users/art/dev/openscout`.