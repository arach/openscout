# Ask-overbuild simplification — before/after + Phase 2 proposal

Status: **proposal, seeking review** · Author: security/simplify review · Date: 2026-07-01
Parent plan: [ask-overbuild-simplification-plan.md](./ask-overbuild-simplification-plan.md)

## TL;DR

One action — agent A asks agent B to do something — is currently stored and
re-projected as **six overlapping vocabularies**. The goal is to collapse the four
lockstep execution records into **one record with a status field** and delete the two
projections whose only job is to re-merge what the other four split apart.

Phase 1 (delete `question` + `unblock_request`, both producerless) shipped (PR #287).
**This proposal is Phase 2** — the last pure-deletion step before the storage merge —
but it's here for review of the *whole* before/after, not just this step.

---

## BEFORE — one ask, six vocabularies

| Concept | Kind | 1:1 with the ask? | Mutable? | Role |
|---|---|---|---|---|
| **InvocationRequest** | stored record | yes (the origin) | no | *what was asked* — who/what/how |
| **FlightRecord** | stored record | yes, never forks | yes | *how it's going* — copies `requesterId`+`targetAgentId` back from the invocation, adds `state/summary/output/error/startedAt/completedAt` |
| **dispatch job** | stored record | yes — id is literally `dispatch-${invocationId}` | yes | *dispatch attempt* — states duplicate the flight's |
| **WorkItemRecord** | stored record | yes | yes | *durable user-facing "work"* — hand-copies `flight.state` into its own state |
| **ScoutInvocationLifecycle** | projection | — | — | re-joins invocation+flight into one view for the 2 MCP tools |
| **AgentRun** | projection | — | — | re-joins invocation+flight into one view for the UI |

The tell it's accidental, not essential: the web DB **query-time `LEFT JOIN`s** invocation
to its latest flight into one row (`db/runs.ts:342-349`, self-described as "the merged
invocation+flight projection"). Storage keeps them split, but *every* caller re-merges —
evidence that callers want one view, not that the split earns its keep.

Net today: **~47 states across 6 vocabularies**, ~1,000 lines of split-then-remerge
machinery, for one action, in a single-user local-first tool.

## AFTER — one record + one view

```
BEFORE                                          AFTER
──────                                          ─────
InvocationRequest ─┐                            Invocation
FlightRecord ──────┤ (1:1, lockstep)               id, requesterId, targetAgentId, action,
dispatch job ──────┘                               task, execution, createdAt, metadata …   ← request (immutable)
                                                   state: queued|waking|running|waiting|      ← status (absorbed
ScoutInvocationLifecycle ─ (re-merge for MCP)            completed|failed|cancelled            from FlightRecord)
AgentRun ───────────────── (re-merge for UI)       summary?, output?, error?,
                                                   startedAt?, completedAt?

WorkItemRecord (copies flight.state) ──────────►  WorkItem  (kept — but state becomes a
                                                            read-time projection of its
                                                            invocation, not a copied field)

                                                  AgentRun  (kept as the UI view type —
                                                            projected from the ONE record,
                                                            drop the flight half of the input)
```

| Today | Becomes | Phase |
|---|---|---|
| `ScoutInvocationLifecycle` + `invocation-lifecycle-read-model.ts` | **deleted** — the 2 MCP tools read the records directly | **2 (this proposal)** |
| `FlightRecord` | **absorbed** into `Invocation` as status fields; keep `flightId` as a durable secondary id + a type-alias for one release so Swift/desktop/ask/CLI/MCP/A2A compile unchanged | 3 |
| dispatch job | **status labels absorbed**, but its scheduler/lease fields (`attempts`, `leaseOwner`, `leaseExpiresAt`, `lastError`) move to a dispatch subobject — **not** flattened into `state` | 3 |
| `AgentRun` projection input `{invocation, flight}` | **`{invocation}`** — projected from the one record | 3 |
| `work_item.state` (hand-copied from flight) | **stop blindly mirroring** flight state; expose invocation status as a *separate* read-time field, human `work_update`s still win | 4 |
| **kept, untouched** | `delivery` (real per-transport fan-out), `message`/`conversation` (content layer), `work_item` as the user-facing noun | — |

**Deliberately NOT in scope (load-bearing — keep):** `delivery` (genuine per-transport
fan-out with its own lifecycle), `message`/`conversation` (the content layer),
`work_item` as the user object.

## Roadmap

- **Phase 1 — DONE (PR #287):** delete `question` + `unblock_request` (zero producers).
- **Phase 2 — this proposal:** delete the two re-merge projections. Pure deletion,
  no storage change.
- **Phase 3:** merge `flight` (+ dispatch-job *status*) into `invocation` — the storage
  change, widest touch, sqlite migration, Swift mirrors via a one-release type-alias.
  **Keep `flightId` as a durable secondary id** (ask/CLI/MCP/A2A/follow-links depend on it)
  and **preserve the dispatch scheduler/lease fields** in a subobject.
- **Phase 4:** stop *blindly mirroring* flight state into `work_item.state` (it's
  independently human-writable via `work_update`); expose invocation status as a separate
  read-time field, with explicit work updates winning.
- **Phase 5:** trim vestigial transports/aliases (independent, any time).

---

## Phase 2 detail — what it removes

| Target | Lines | Why |
|---|---|---|
| `packages/protocol/src/lifecycle.ts` (+ `.test.ts`) | ~497 | `projectInvocationLifecycle` + its 9-state `ScoutInvocationState` vocabulary |
| `packages/runtime/src/invocation-lifecycle-read-model.ts` (+ `.test.ts`) | ~90 | read-model indirection that calls the projection |
| `readInvocationLifecycle` in `broker-core-service.ts` + `broker-api.ts` interface | — | service method behind the route |
| `/v1/invocations/:id/lifecycle` route in `broker-http-router.ts` + `broker-api.ts` | — | HTTP surface with one caller |
| `export * from "./lifecycle.js"` in `protocol/src/index.ts` | 1 | re-export |
| desktop: `getInvocationLifecycle` dep, `loadScoutInvocationLifecycle`, `scoutBrokerInvocationLifecyclePath`, `loadInvocationLifecycleForFlight`, `ScoutInvocationLifecycleRecord` alias | — | client side of the same route |

### The finding that makes it safe

The projection is **not** a pure re-merge — it also remaps the state vocabulary
(`running`→`working`, `waking`→`dispatching`), *invents* two read-time states
(`acknowledged`, `expired`), and builds a compacted `terminal` block, `waitingOn`,
and `deliveries[]`. So "just read the two records" is only safe if consumers don't
depend on those derivations. They don't:

**The CLI never touches the projection** — every command reads raw records and prints
raw `FlightState`:

| CLI command | reads | vocabulary printed |
|---|---|---|
| `scout ask` | `waitForScoutFlight` → `flight.state` | `queued/waking/running/waiting/completed/failed/cancelled` |
| `scout wait` | `loadScoutInvocationSnapshot` (`/v1/invocations/:id`) + `flight.state` | same |
| `scout flight` | `loadScoutFlight` → `flight.state` | same |

Zero references to `ScoutInvocationLifecycle`, `projectInvocation*`, or the `/lifecycle`
route in `apps/desktop/src/cli/`.

**The MCP tools — the projection's only production consumer — are already flight-first.**
`waitForFlightForMcp` decides terminality from `flight.state`; `buildInvocationLookupContent`
uses `lifecycle` only as a fallback (`output = flight.output ?? flight.summary ?? lifecycle?.terminal?.summary`);
and the MCP output schema types `state` as `z.string()` with `.catchall(z.unknown())`,
so a shape change degrades rather than throws.

**Corollary:** the raw 7-state `FlightState` the CLI already prints is exactly what
becomes `Invocation.state` in Phase 3. The projected 9-state vocabulary is consumed by
nothing a human looks at. **No CLI output changes across Phases 2–3.**

### Risks (ranked) + mitigation

1. **The `lifecycle` sub-object in the MCP structured result gets thinner** — anything
   reading `result.lifecycle.{deliveries,waitingOn,state}` loses it. Our renderer
   doesn't; residual bet is no out-of-repo MCP client reads those nested fields.
2. **`terminal.summary`/`errorClass` fallback disappears** for the rare terminal flight
   with empty `output`+`summary`+`error`. Minor.
3. **Two-package coordination** — projection in protocol+runtime, caller in the desktop
   copy; both move together, partial change degrades not crashes.
4. **Test churn** — `lifecycle.test.ts`, `invocation-lifecycle-read-model.test.ts`, the
   lifecycle case in `broker-api.test.ts`, and the nested-`lifecycle` assertions in
   `scout-mcp.test.ts:1885-2000` all update/retire.
5. **Shared-tree / active WIP** — `broker-local-invocation-service.ts` + `planner.ts` are
   in-flight; Phase 2 avoids those hot paths, Phase 3 will touch them.

**Mitigation:** land a characterization test on the two MCP tools' output first
(completed + failed + waiting flight), *then* delete.

---

## Review outcome (Codex `project-hegel`, verified 2026-07-01)

Codex reviewed the whole arc and endorsed the **invocation+flight collapse**, with three
corrections — all independently verified against the code:

1. **Direction confirmed.** No legitimate current fork / 1:N flight-per-invocation
   lifecycle: `recordInvocation()` writes invocation+flight+job as one bundle
   (`broker-durable-record-store.ts:274-291`) and the runtime keeps a singular
   `flightForInvocation()` map (`broker.ts:219-221`). If retry/fork history is ever
   needed, model it as a new invocation/attempt with parent metadata — not multiple live
   flights under one invocation.
2. **Phase 3 must not flatten the dispatch job.** Its state labels duplicate the flight,
   but `attempts` / `leaseOwner` / `leaseExpiresAt` / `lastError` are load-bearing
   scheduler state used by dispatch recovery (`broker-dispatch-recovery-service.ts:39-83`),
   and the job can complete while the flight keeps running. Absorb it as a dispatch
   subobject, and keep `flightId` as a durable secondary id (ask/CLI/MCP/A2A/follow-links).
3. **Phase 4 as originally written was wrong.** `work_item.state` is independently
   human-writable — `work_update` accepts `state` (`scout-mcp.ts:730-745`),
   `updateScoutWorkItem()` writes it with no flight transition (`service.ts:2712-2785`).
   Revised: stop *blindly mirroring* flight state; surface invocation status as a separate
   read-time field, explicit work updates win.

**Phase 2 decision:** proceed now (it avoids the active `broker-local-invocation-service` /
`planner.ts` hot paths). Codex leans **soft-deprecate the `/v1/invocations/:id/lifecycle`
route for one release** — but returning a *minimal compatibility object* (top-level
`invocationId`, `flightId`, `targetAgentId`, `state`, `startedAt`, `completedAt`), **not**
raw `{invocation, flight}`, which would be a shape break masquerading as compatibility.
Land characterization tests (MCP output without lifecycle + route deprecation behavior)
*before* deleting, since `scout-mcp.test.ts` currently asserts the nested lifecycle fields.

**Doc correction from review:** `db/runs.ts` does **not** store invocation+flight merged;
it query-time `LEFT JOIN`s them (fixed above).
