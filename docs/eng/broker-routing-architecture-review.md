# Broker Routing & Endpoint Execution — Architecture Review

> Read-only architecture review of the OpenScout broker dispatch path. No source files were
> modified. Line refs verified against `packages/runtime/src/*` on branch
> `codex/macos-origin-main-build-fixes`. Scope: `/v1/invocations` and MCP `ask` → resolution →
> flight planning → endpoint selection → wake/attach → transport dispatch → queue/fail → completion.

## Status (2026-06-19)

The dispatch path has been **extracted from the monolith** into focused modules. The behavioral
findings below still apply; only file placement changed.

| Stage | Current module(s) |
| --- | --- |
| HTTP routes | `broker-http-router.ts` |
| `/v1/deliver` | `broker-delivery-acceptance-service.ts` |
| `/v1/invocations` | `broker-invocation-dispatch-service.ts` (via `broker-core-service.ts` delegate) |
| target resolution | `broker-delivery-routing.ts` → `scout-dispatcher.ts` |
| unavailable diagnostics | `broker-unavailable-target-service.ts` |
| endpoint selection | `broker-local-endpoint-resolver.ts`, `broker-local-invocation-helpers.ts` |
| local execution | `broker-local-invocation-service.ts` → `local-agents.ts` |
| flight lifecycle | `broker-flight-lifecycle-service.ts` |
| home/UI endpoint summary | `broker-home-service.ts` |

Structural map: [`docs/architecture.md`](../architecture.md). Monolith refactor notes:
[`broker-daemon-architecture-review-2026-06-18.md`](./broker-daemon-architecture-review-2026-06-18.md).

Line references in sections 1–4 point at the **pre-refactor** `broker-daemon.ts` layout unless
noted otherwise.

## 0. TL;DR

The dispatch core is sound and converges well at the *resolution* and *accept* layers, but it
carries four structural problems that compound into "Frankenstein" complexity:

1. **Two front doors, asymmetric gating.** `/v1/invocations` and `/v1/deliver` (MCP `ask`) both
   funnel into the same accept/dispatch core, but only `/v1/deliver` runs a pre-accept
   availability gate. The `/v1/invocations` path can accept work that then silently parks —
   violating the doc's own "no silent parked limbo" invariant.
2. **Five endpoint selectors, no shared notion of "the" endpoint.** Five functions pick/rank an
   endpoint with five different criteria (transport rank, state string ×2, liveness probe,
   timestamp). The UI and the dispatcher routinely pick *different* endpoints for the same agent.
3. **UI-ready state can diverge from dispatch-runnable state.** The Home feed derives status from
   the persisted `endpoint.state` string only; dispatch derives runnability from a live process
   probe + transport check. An agent can read **"Available"** while dispatch would queue or fail.
4. **Transport polymorphism is hand-rolled ~16×** instead of via the registry helpers that already
   exist (`local-agent-transports.ts`), producing copy-paste predicates and alive≠runnable gaps.

Plus pervasive **doc/code drift**: `docs/runtime-sessions.md` specifies a 9-value endpoint state
machine and a "preferred endpoint" flag that **do not exist in code** (the model has a 4-value
`AgentState` and no preferred flag).

---

## 1. Current Architecture Map

### 1.1 The two front doors

| Entry | Handler | Notes |
| --- | --- | --- |
| `POST /v1/invocations` | `BrokerInvocationDispatchService.handleInvocationRequest` (`broker-invocation-dispatch-service.ts`; routed from `broker-http-router.ts`) | Caller supplies a pre-built `InvocationRequest` (ids minted client-side). **No pre-accept gate.** |
| `POST /v1/deliver` (MCP `ask`, `messages_send wake:true`) | `BrokerDeliveryAcceptanceService.accept` (`broker-delivery-acceptance-service.ts`; routed from `broker-http-router.ts`) | Broker mints `inv`/`msg` ids; **runs a pre-accept availability gate** via `broker-unavailable-target-service.ts`. |

Both converge on two shared internal stages:

- **Target resolution** → `resolveBrokerDeliveryTargetWithImplicitProjectAgent` (`:7957`) →
  `resolveBrokerDeliveryTarget` (`:7892`) → `resolveBrokerRouteTarget` (`scout-dispatcher.ts:399`).
  Resolution order: `session_id → agent_id → binding_ref → project_path → label`. This is the one
  genuinely well-centralized stage — both doors share it.
- **Accept + dispatch** → `acceptInvocationDurably` → `dispatchAcceptedInvocation` (`:5724`) →
  `launchLocalInvocation` (`:5170`) → `executeLocalInvocation` (`:4765`).

### 1.2 Flight planning

- `runtime.planInvocation` (`broker.ts:683`) mints `flightId` (`createRuntimeId("flt")`, `:719`) and
  sets an **advisory** initial state (`waking`/`queued` based on endpoint count, `:699`–`:716`).
- `executeLocalInvocation` then re-resolves the endpoint from scratch (`:4778`) and re-derives the
  real state, so the plan-time state is throwaway.
- Receipt for `/v1/invocations`: `{ accepted, invocationId, flightId, targetAgentId, state, flight }`
  (HTTP 202). `conversationId`/`messageId` are caller-supplied on this path; they are broker-minted
  on the `/v1/deliver` path.

### 1.3 Endpoint selection — five selectors

| Function | File:line | Criterion | Used by |
| --- | --- | --- | --- |
| `preferredEndpoint` | `broker.ts:135` | **transport rank** (`claude_channel`=0 …) | message delivery routing |
| `preferredEndpointForAgent` | `scout-dispatcher.ts:123` | **state string** (active→idle/waiting→first) | dispatch-candidate summaries |
| `homeEndpointForAgent` | `broker-local-invocation-helpers.ts` (used by `broker-home-service.ts`) | **state string** (active0/idle1/waiting2/def4/offline5) | **UI / Home feed / return address** |
| `activeLocalEndpointForAgent` | `broker-local-endpoint-resolver.ts` | **live process probe** (`isLocalAgentEndpointAlive`) | **actual dispatch** |
| `latestEndpointForAgent` | `broker-local-invocation-helpers.ts` | **newest timestamp** | stale/superseded diagnostics |

The per-invocation pick happens in `BrokerLocalEndpointResolver.resolveLocalEndpointForInvocation`,
called from `broker-local-invocation-service.ts`.

### 1.4 Wake / attach

`resolveLocalEndpointForInvocation` keys entirely off `invocation.ensureAwake` +
`invocation.execution?.session` (default `"new"`, `:4669`):

- existing live endpoint / broker-runnable transport → reuse (attach/steer), `:4676`–`:4686`
- `ensureAwake && existing session` → `reviveManagedLocalSessionEndpoint` (`:4711`) →
  `ensureLocalSessionEndpointOnline` (`local-agents.ts:1826`) — resume
- `ensureAwake && fresh` → `ensureLocalAgentBindingOnline` (`local-agents.ts:4474`, called `:4749`) —
  spawn/wake
- not `ensureAwake` → falls through to queue (`:4741`)

`local-agents.ts` is an orchestration/registry layer; it delegates the actual spawn to sibling
modules — `codex-app-server.ts`, `claude-stream-json.ts`, `pi-rpc.ts` — and only **tmux** is spawned
inline (`execFileSync("tmux", ["new-session", …])`, `local-agents.ts:3482`).

### 1.5 Transport dispatch

`invokeLocalAgentEndpoint` (`local-agents.ts`, called from `broker-local-invocation-service.ts`) switches on
`endpoint.transport`: `codex_app_server`/`claude_stream_json`/`pi_rpc` delegate to their modules;
`tmux` is the inline fallthrough (`sendLocalAgentPrompt` `:2826` → `sendTmuxPrompt` `:2882`,
`load-buffer`+`paste-buffer`+`send-keys`, with a verify/retry loop that throws `DispatchStalledError`).

### 1.6 Queue / fail / completion

All in `executeLocalInvocation` (`:4765`):

- **queued** (park until online): `:4820`–`:4831`, `reason: "no_runnable_endpoint"`,
  `status: "queued_until_online"`. Drained later by `deliverPendingMessages` (`:2151`).
- **failed — no executor** (transport not runnable): `:4842`–`:4848`, `"has no supported local executor."`
- **failed** — endpoint resolution (`:4781`), empty reply (`failureStage:"empty_reply"`, `:4951`),
  dispatch stalled (`:5074`), codex app-server exit (`:5105`), generic (`:5147`).
- **waiting** (NOT failure) — requester sync timeout, `timeoutScope:"requester_wait"`, `:5055`.
- **completed** — `:4978`; write-back to conversation only when `conversationId && !postedReply`
  (`:4992`–`:5038`), with a full `returnAddress`.
- Background safety nets: `reconcileStaleWorkingFlights` (`:3026`), `reconcileStaleLocalDeliveries`
  (`:1628`).

---

## 2. Concrete Hotspots

### H1 — Asymmetric pre-accept gate (the two front doors disagree)
`describeUnavailableDeliveryTarget` is called at exactly **one** site: `acceptBrokerDelivery` (`:8904`,
the `/v1/deliver` path). `handleInvocationRequest` (`:5670`, the `/v1/invocations` path) has **no**
equivalent gate. So the same "can this agent receive work?" question yields:
- `/v1/deliver`: short-circuit to a `question` / HTTP 409 with remediation, **no flight created** (`:8921`).
- `/v1/invocations`: accept → flight → later **queues** (`no_runnable_endpoint`) or **fails** inside
  `executeLocalInvocation`, with **no operator-attention notice** (the `queueOperatorDeliveryIssue`
  park at `:8464` is deliver-path only).

This directly violates `docs/runtime-sessions.md` invariant #6 ("Silent parked limbo is a product bug").

### H2 — The gate itself is state-string-based, not liveness-based
Even on the gated `/v1/deliver` path, `describeUnavailableDeliveryTarget` (`:2733`) returns `null`
("available") for **every non-manual wake policy** (`:2782`), and for manual policy it accepts any
`active|idle|waiting` **state string** (`:2786`) without a process probe. So a dead `on_demand`
process passes the gate and parks downstream. `on_demand` and `keep_warm` are treated identically
here — there is no distinct handling.

### H3 — UI-ready ≠ dispatch-runnable (the headline divergence)
`summarizeHomeAgent` (`:2829`) and `brokerHomePayload` (`:2885`, the `/v1/home` feed) compute status
**purely from `endpoint.state`** via `homeEndpointForAgent` (state-string ranker). They never call
`isLocalAgentEndpointAlive` or `isBrokerRunnableLocalAgentTransport`. Concrete divergences:
- **Dead process, stale `idle` state** → UI shows "Available"; dispatch's `activeLocalEndpointForAgent`
  liveness probe returns `undefined` → flight **queued** (`no_runnable_endpoint`, `:4828`).
- **Non-runnable transport, `idle` state** → UI shows "Available"; dispatch hits the transport gate
  (`isBrokerRunnableLocalAgentTransport`, just above `:4845`) → flight **failed**
  (`"has no supported local executor."`).

There is **no shared dispatchability predicate**. `isBrokerRunnableLocalAgentTransport` exists
(`local-agent-transports.ts:15`) but the UI path doesn't use it.

### H4 — Five endpoint selectors (see §1.3)
The UI picker (`homeEndpointForAgent`, ignores liveness) and the dispatch picker
(`activeLocalEndpointForAgent`, probes liveness) can return different endpoints for the same agent.

### H5 — Cosmetic "queued" strategy
`dispatchAckStrategyForEndpoint` (`:4604`) can return the string `"queued"`, but nothing branches on
it; the flight is unconditionally set to `running` (`:4880`) and the strategy only feeds the summary
("acknowledged via …"). A running flight can read "acknowledged via queued."

### H6 — `wakePolicy` vs `ensureAwake`
`WakePolicy` (`manual|on_demand|keep_warm`) is read in exactly one place
(`describeUnavailableDeliveryTarget:2782`). The dispatch path never consults it — wake is driven only
by `ensureAwake` + `execution.session`. The model carries a policy the runtime doesn't honor.

### H7 — Hand-rolled transport switch ×16 (local-agents.ts)
The `codex_app_server / claude_stream_json / pi_rpc / else-tmux` if-chain is repeated ~16 times
(`1740, 1811, 1830, 1862, 2439, 2476, 3344, 3396, 3583, 4121, 4564, 4657, …`). Side effects:
- **Copy-pasted predicate**: `endpointInvocationPrompt` (`:2301`) and `isSessionBackedEndpoint`
  (`:2328`) inline the identical 6-term OR.
- **alive ≠ runnable gap**: `isLocalAgentEndpointAlive` (`:2463`) handles `pairing_bridge` and
  `claude_channel`, but the dispatch/shutdown chains only branch codex/claude/pi/tmux — an endpoint
  can report "alive" via a transport dispatch can't actually run.
- **Split defaulting**: `normalizeLocalAgentTransport` (`:908`) and `recordForHarness` (`:1421`)
  independently derive harness→transport defaults.
- **Duplicated project-root resolution**: `resolveLocalAgentIdentity` (`:3709`) vs `startLocalAgent`
  (`:3807`).

### H8 — `targetSessionId` has three carriers
`invocationTargetSessionId` (`:4575`) reads `execution.targetSessionId` **or** `metadata.targetSessionId`;
the resolver reads `input.targetSessionId` / `target.session_id` (`scout-dispatcher.ts:411`). One
logical field, three sources.

### H9 — State-vocabulary sprawl + doc drift
- `AgentState` (endpoints): `offline|idle|active|waiting` (`protocol/src/common.ts:11`).
- `FlightState`: `queued|waking|running|waiting|completed|failed|cancelled` (`protocol/src/invocations.ts:12`).
- UI (`summarizeHomeAgent`): `offline|available|working` + labels.
- Dispatch candidate (`ScoutCandidateEndpointState`): `online|offline|unknown`.
- **Docs** (`docs/runtime-sessions.md` §"Endpoint State"): a **9-value** machine
  (`registered|attaching|waking|idle|working|unreachable|failed|superseded|stopped`) that **has no
  implementation** — `registered/attaching/working/unreachable/superseded/stopped` are not in any
  enum; `waking/failed` live on flights, not endpoints. The doc's happy path
  `registered → waking → idle → working → idle` is fictional at the endpoint layer.
- **Docs invariant #3** says an endpoint declares "whether it is the preferred endpoint" — there is
  **no `preferred` flag** in `AgentEndpoint`; preference is recomputed by five different rankers.
  Docs §"Cardinality And Selection" rule #2 ("the preferred endpoint for that agent/harness pair")
  is unimplemented.
- **Docs §"Session Reuse And Forking"** describes `fork`/`forkFromStateId` — not observed in the
  traced dispatch path (`sessionPreference` only branches `new`/`existing`). Flag for verification;
  appears doc-ahead-of-code.

---

## 3. Root Causes of Complexity

1. **No single dispatchability model.** Truth is split between a process-liveness layer
   (`local-agents.ts`) and a persisted `endpoint.state` string. The UI and the deliver-gate read the
   string; the dispatcher reads liveness. The string can lie, so every reader compensates differently.
2. **Two front doors grew separately and only half-converged.** `/v1/deliver` accreted the rich
   ask/tell/consult semantics + the availability gate; `/v1/invocations` stayed thin. They share
   resolution and accept, but not pre-flight policy.
3. **Endpoint "preference" was never modeled as data.** With no `preferred` flag and no
   agent/harness-pair key, each consumer re-derives "the" endpoint with a locally convenient ranking
   → five selectors.
4. **Transport polymorphism as inline branching.** No adapter/registry seam, so each transport
   concern is open-coded ~16× and coverage drifts (alive vs dispatch vs shutdown).
5. **Spec drifted ahead of code.** `docs/runtime-sessions.md` describes an aspirational richer state
   machine + wake-policy-driven lifecycle that was never built; code took a leaner 4-state +
   `ensureAwake` route. This is forward drift, not stale docs — which matters for the fix direction.

---

## 4. Cleanup / Refactor Plan (sequenced, with risks)

> Precondition (2026-06-19): dispatch paths now live in `broker-local-invocation-service.ts` and
> `broker-local-endpoint-resolver.ts`. Add **characterization tests** around local invocation +
> endpoint resolution before Phase 1. `broker-local-invocation-service.test.ts`,
> `broker-local-endpoint-resolver.test.ts`, and `broker-endpoint-selection.test.ts` exist — extend them.

### Phase 0 — Close the divergences (cheap, high-clarity, low blast radius)
- **P0.1 Single dispatchability predicate.** Introduce `endpointDispatchability(endpoint)` =
  `isBrokerRunnableLocalAgentTransport` + `isLocalAgentEndpointAlive` (+ A2A/pairing rules). Route
  **both** `summarizeHomeAgent` and `activeLocalEndpointForAgent` through it. Fixes H3.
  *Risk:* some agents flip "Available"→"Stale/Offline" (correct, but debounce on `lastSeenAt` to avoid
  flap during reconciliation lag).
- **P0.2 Symmetric gate.** Move `describeUnavailableDeliveryTarget` into `acceptInvocationDurably`
  (or call it from `handleInvocationRequest`) so both front doors gate identically. Fixes H1 +
  invariant #6. *Risk:* some currently accepted-then-queued `/v1/invocations` calls become 409s;
  audit callers for 409 handling first.
- **P0.3 Make the gate honest.** Have `describeUnavailableDeliveryTarget` consult liveness (P0.1
  predicate), not just the state string, and distinguish `on_demand` (wakeable) from `keep_warm`.
  Fixes H2. *Risk:* low; mostly widens the set of correctly-flagged-unavailable targets.
- **P0.4 Kill the cosmetic "queued" strategy** (H5) — drop the branch or actually gate on it.

### Phase 1 — Consolidate selection + identity (medium)
- **P1.1 One ranked selector.** Collapse the five pickers into a single
  `selectEndpoint(agentId, policy)` taking `{requireLive, harness, sessionId, preferState|preferTransport}`;
  UI/dispatch/diagnostics call it with different policies. Fixes H4.
- **P1.2 Model preference as data.** Add a `preferred` flag (and harness-pair key) to `AgentEndpoint`
  to match docs invariant #3, so selection reads data instead of re-deriving. *Risk:* snapshot-shape
  + return-address/home-payload change; migrate carefully.
- **P1.3 One `targetSessionId` carrier** (H8): canonical `execution.targetSessionId` + single
  accessor; deprecate `metadata.targetSessionId`.

### Phase 2 — Transport adapter registry (medium-high)
- **P2.1** Replace the ~16 inline transport chains (H7) with a registry keyed by transport, each
  adapter implementing `{ isAlive, ensureOnline, invoke, shutdown, sessionBacked }`, homed in
  `local-agent-transports.ts`. Eliminates the copy-pasted predicate and the alive≠runnable gap.
  *Risk:* large mechanical change; gate behind the Phase-0/1 characterization tests for all four
  transports (codex/claude/pi/tmux).

### Phase 3 — State machine + docs reconciliation (semantic; coordinate per doc rule)
- **P3.1** Decide direction on H9. Recommendation: **amend `docs/runtime-sessions.md`** to the real
  two-layer model (endpoint `AgentState` = persisted coordination; `FlightState` = lifecycle;
  liveness = probe), promoting only the few endpoint states that earn their keep (`superseded`,
  `stopped` already exist as metadata flags). Don't implement the full 9-value machine unless a
  concrete need appears.
- **P3.2** Resolve H6: make the dispatch path honor `wakePolicy` (`manual` → never auto-wake;
  `on_demand` → wake on `ensureAwake`; `keep_warm` → proactively warm), and treat `ensureAwake` as an
  override rather than the sole driver.
- **P3.3** Drop or honor `planInvocation`'s advisory state (`broker.ts:699`) — either trust it in
  `executeLocalInvocation` or stop computing it.

*Note (doc discipline):* `docs/runtime-sessions.md` says "Update this page before changing
user-facing CLI/MCP/skill/broker semantics around harness lifecycle." Phases 0.2/0.3/3.2 change those
semantics, so the doc edit is part of the change, not a follow-up.

---

## Appendix — Verification anchors (current modules)
- UI-vs-runnable: `broker-home-service.ts` + `homeEndpointForAgent` in `broker-local-invocation-helpers.ts` (state-string) vs `broker-local-endpoint-resolver.ts` `activeLocalEndpointForAgent` (liveness).
- Asymmetric gate: `broker-unavailable-target-service.ts` called from `broker-delivery-acceptance-service.ts`; not mirrored in `broker-invocation-dispatch-service.ts`.
- Five selectors: `broker.ts:135`, `scout-dispatcher.ts:123`, `broker-local-invocation-helpers.ts` (`homeEndpointForAgent`, `latestEndpointForAgent`), `broker-local-endpoint-resolver.ts` (`activeLocalEndpointForAgent`).
- Queue/fail strings: `broker-local-invocation-service.ts` (`no_runnable_endpoint`, `no supported local executor`).
- Transport sprawl: `grep -n 'transport === "codex_app_server"' local-agents.ts` → ~16 sites.
