# Broker Daemon Architecture Review

Date: 2026-06-18

Scope: `packages/runtime/src/broker-daemon.ts`, with supporting reads of
`broker.ts`, `scout-dispatcher.ts`, `scout-broker.ts`, `local-agents.ts`,
`local-agent-transports.ts`, `broker-core-service.ts`, `broker-api.ts`,
`broker-journal.ts`, `mobile-push.ts`, and the runtime/session docs.

Method: local Codex sub-agent swarm plus parent synthesis. No files were edited
by sub-agents. This document is the consolidated review.

## Executive Summary

The broker daemon has become a 9,310-line composition root, HTTP router,
application service, durable repository, endpoint/session lifecycle manager,
transport dispatcher, mesh gateway, A2A server, feed hub, web supervisor, and
mobile notification caller.

That is not just a style problem. The current shape directly causes behavior
like "UI says live, dispatch queues until online" because readiness is decided
by several different heuristics:

- target resolution returns an agent, not a concrete endpoint/session;
- UI and dispatch summaries use simple endpoint state ranking;
- execution does separate transport-specific liveness checks;
- queue/fail decisions happen after the invocation has already been accepted.

The fix made today corrected one local branch of that drift, but the root
cleanup is to introduce one endpoint selection/classification contract and make
dispatch a durable schedulable operation rather than a fire-and-forget side
effect.

## File Shape

Measured locally:

- `packages/runtime/src/broker-daemon.ts`: 9,310 lines
- top-level functions: about 300
- route branches / route matches: about 84
- durable/persistence helper references: about 130
- imports: 51

The file is organized as accumulated strata rather than clear modules:

| Lines | Concern |
| --- | --- |
| 1-430 | imports, process config, singleton/probe, runtime/journal/projection setup |
| 438-640 | SSE/inbox/event stream plumbing |
| 653-845 | local-agent sync, mesh discovery, durable write queue |
| 877-1217 | web child-process supervision |
| 1226-2147 | durable record helpers for nodes, actors, agents, conversations, messages, invocations, flights, deliveries |
| 2151-3052 | pending-flight drain, endpoint/state helpers, home payload, stale-flight reconciliation |
| 3055-4115 | local agent registration, pairing/local-session agent builders, attach/detach, core-agent bootstrap |
| 4167-4332 | mesh authority checks and forwarding |
| 4376-5170 | message posting, invocation reply completion, endpoint selection, local invocation execution |
| 5188-5318 | peer forwarding and utility parsers |
| 5336-6391 | repo watch, socket/listen helpers, command handling, A2A handlers, capability matrix, broker service assembly |
| 6398-7835 | manual HTTP route chain |
| 7840-9090 | delivery target resolution, work item promotion, operator issues, `/v1/deliver` acceptance |
| 9101-9310 | server creation, WebSocket upgrade, startup loops, shutdown |

## Current Control Flow

### Process Startup

```text
process start
  -> resolve control home, port, host, node id
  -> probe existing broker
  -> load broker-journal.jsonl
  -> create in-memory runtime from journal snapshot
  -> create SQLite projection and thread event plane
  -> persist local node and system actors
  -> assemble brokerService
  -> register active in-process broker service
  -> listen TCP + Unix socket
  -> mount /trpc WebSocket firehose
  -> start peer delivery, rendezvous, discovery, local-agent sync loops
```

Key references:

- setup and singleton probe: `broker-daemon.ts:352`, `broker-daemon.ts:400`
- journal/runtime/projection: `broker-daemon.ts:407`
- broker service assembly: `broker-daemon.ts:6377`
- HTTP servers and WebSocket upgrade: `broker-daemon.ts:9101`, `broker-daemon.ts:9130`
- startup loops: `broker-daemon.ts:9154`, `broker-daemon.ts:9191`

### `/v1/invocations`

```text
POST /v1/invocations
  -> handleInvocationRequest
  -> sync registered local agents
  -> resolveInvocationTarget
       -> resolveBrokerDeliveryTargetWithImplicitProjectAgent
       -> maybe materialize project card
  -> if unresolved: record Scout dispatch diagnostic
  -> if resolved: acceptInvocationDurably
       -> record invocation + initial flight
  -> dispatchAcceptedInvocation in background
       -> remote authority: peerDelivery.enqueue
       -> local authority: launchLocalInvocation
       -> executeLocalInvocation
            -> resolveLocalEndpointForInvocation
            -> choose transport executor
            -> mutate endpoint active/idle/offline
            -> update flight running/completed/waiting/failed/queued
            -> maybe post reply/status message
```

Key references:

- route: `broker-daemon.ts:7790`
- request handling: `broker-daemon.ts:5670`
- durable accept: `broker-daemon.ts:5716`
- dispatch: `broker-daemon.ts:5724`
- endpoint selection: `broker-daemon.ts:4666`
- local execution: `broker-daemon.ts:4765`

### `/v1/deliver`

```text
POST /v1/deliver
  -> acceptBrokerDelivery
  -> parse target, session, channel, reply context, work intent
  -> handle special cases:
       ref reply, operator, Scout product target, channel tell
  -> resolve broker delivery target
  -> maybe record rejected/unavailable Scout dispatch
  -> ensure actors and conversation
  -> optionally create/update work item
  -> record message
  -> for consult or direct tell:
       create invocation
       acceptInvocationDurably
       dispatchAcceptedInvocation in background
  -> return receipt
```

Key references:

- route: `broker-daemon.ts:7768`
- delivery acceptance: `broker-daemon.ts:8560`
- target resolution: `broker-daemon.ts:8857`
- unavailable target gate: `broker-daemon.ts:8904`
- invocation creation from delivery: `broker-daemon.ts:9031`

## Major Findings

### 1. `broker-daemon.ts` Is A Composition Root That Never Stopped Growing

The file is not just long. It owns multiple architectural layers at once:

- process lifecycle and child-process supervision;
- HTTP and WebSocket transport;
- durable write serialization;
- runtime mutation;
- projection and stream fanout;
- target resolution;
- endpoint/session lifecycle;
- transport adapter execution;
- mesh forwarding and mesh receiver routes;
- A2A server methods;
- mobile push notification policy;
- UI-facing summaries and status copy.

This makes local changes deceptively risky. A routing tweak can affect UI home
payloads, durable flight state, delivery status, mobile notification copy, and
mesh forwarding because they all share the same module-level state and helper
set.

The existing `broker-core-service.ts` extraction is a good start, but it mostly
extracts read-side service methods. The daemon still passes write closures into
that service and keeps the write workflows itself.

### 2. Target Routing And Endpoint Routing Are Split

Target routing resolves the user's requested target to an `AgentDefinition`.
Endpoint routing later chooses whether there is a runnable endpoint/session for
that agent.

That split is currently too lossy. `resolveSessionTarget` in
`scout-dispatcher.ts` resolves `session:<id>` to an agent, not the exact
endpoint/session row. Later, `resolveLocalEndpointForInvocation` has to
rediscover a matching endpoint from runtime state.

Impact:

- exact session constraints become metadata until execution;
- acceptance can happen before the broker knows the exact endpoint is runnable;
- errors that should be `harness_mismatch`, `session_reference_not_attachable`,
  or `session_unreachable` can collapse into generic queueing;
- UI can summarize one endpoint while execution selects another.

Relevant code:

- session target resolution: `scout-dispatcher.ts:375`
- invocation target resolution: `broker-daemon.ts:8039`
- endpoint rediscovery: `broker-daemon.ts:4671`

Recommendation:

Introduce a route result that can carry endpoint constraints:

```ts
type BrokerRouteResolution =
  | { kind: "resolved_agent"; agent: AgentDefinition }
  | { kind: "resolved_endpoint"; agent: AgentDefinition; endpoint: AgentEndpoint; constraint: EndpointConstraint }
  | { kind: "ambiguous"; candidates: RouteCandidate[] }
  | { kind: "unavailable"; reason: RouteUnavailableReason; remediation: ScoutDeliveryRemediationAction }
  | { kind: "unknown"; label: string };
```

`session:<id>` should resolve to one concrete endpoint or fail before a
success-looking receipt is returned.

### 3. Endpoint Selection Is Duplicated And Order-Dependent

There are multiple endpoint preference functions:

- `activeLocalEndpointForAgent` in `broker-daemon.ts:4581` filters by node,
  harness, optional session alias, and transport liveness, then returns the
  first alive candidate.
- `homeEndpointForAgent` in `broker-daemon.ts:2317` ranks by state for UI and
  dispatch summaries, with no transport liveness check.
- `preferredEndpointForAgent` in `scout-dispatcher.ts:123` ranks by state for
  label/project resolution.
- `scout-broker.ts` repeats active/idle/waiting preference for CLI-facing
  selector and project logic.

`runtime.endpointsForAgent` preserves insertion order from an internal `Set`
(`broker.ts:246`), so execution selection can become order-dependent when more
than one compatible endpoint exists.

Impact:

- ready/live display and runnable execution can diverge;
- two equivalent live endpoints are not treated as ambiguous;
- the selected endpoint can differ across UI, dispatch diagnostics, and actual
  invocation execution.

Recommendation:

Create one shared endpoint classifier and selector:

```ts
type EndpointClassification = {
  endpoint: AgentEndpoint;
  displayState: "online" | "offline" | "unknown" | "superseded";
  runnable: boolean;
  attachable: boolean;
  wakeable: boolean;
  reasons: EndpointReason[];
  rank: number;
};

type EndpointSelection =
  | { kind: "selected"; agent: AgentDefinition; endpoint: AgentEndpoint; mode: "run" | "attach" | "wake" }
  | { kind: "queued"; agent: AgentDefinition; reason: EndpointReason }
  | { kind: "unavailable"; agent: AgentDefinition; reason: EndpointReason; remediation: ScoutDeliveryRemediationAction }
  | { kind: "ambiguous"; candidates: EndpointClassification[] };
```

Use it from:

- `/v1/deliver` unavailability checks;
- `/v1/invocations`;
- UI/home/feed summaries;
- Scout dispatch candidate generation;
- queued-flight drain;
- tests.

### 4. Endpoint State Is Overloaded

`waiting` is especially problematic. Local agent binding can set `waiting` when
the underlying process is not alive, while UI-facing summaries normalize
`waiting` to online.

Impact:

- a card/session can look "ready" while dispatch sees no live process;
- stale/offline/registered/attachable states are not consistently distinct;
- exact session failures do not preserve the failed layer.

Relevant code:

- local binding state: `local-agents.ts:4366`
- home display interpretation: `broker-daemon.ts:2866`
- dispatch candidate normalization: `scout-dispatcher.ts:481`
- transport liveness check: `broker-daemon.ts:4595`

Recommendation:

Do not use endpoint `state` as both lifecycle and liveness. Keep state as the
stored lifecycle field, and derive display/routing semantics through
`classifyEndpoint(endpoint)`.

The classifier should represent at least:

- `runnable`
- `attachable`
- `wakeable`
- `reachable`
- `reachability_unknown`
- `not_attachable`
- `harness_mismatch`
- `session_unreachable`
- `superseded_registration`

### 5. Accepted Invocations Are Not Durably Scheduled

`acceptInvocationDurably` records the invocation and flight, then dispatch starts
as a fire-and-forget background task from HTTP, A2A, delivery, or command paths.
If the broker crashes after acceptance but before `dispatchAcceptedInvocation`
runs or creates a remote delivery, the accepted work can be stranded.

Restart logic only drains `queued` flights when an endpoint is upserted. It does
not durably claim all accepted `waking`, `queued`, `running`, or `waiting` work
that lacks an active local task.

Relevant code:

- durable accept: `broker-daemon.ts:5716`
- fire-and-forget dispatch: `broker-daemon.ts:5700`, `broker-daemon.ts:6055`,
  `broker-daemon.ts:9068`
- in-memory task map: `broker-daemon.ts:421`, `broker-daemon.ts:5170`
- queued-only drain: `broker-daemon.ts:2151`
- startup reconciliation: `broker-daemon.ts:9191`

Recommendation:

Create a durable dispatch/outbox record in the same transaction as invocation
acceptance:

```ts
type DispatchJob = {
  id: string;
  invocationId: string;
  targetAgentId: string;
  authorityNodeId: string;
  state: "pending" | "leased" | "running" | "waiting" | "terminal";
  leaseOwner?: string;
  leaseExpiresAt?: number;
  endpointId?: string;
  createdAt: number;
  updatedAt: number;
};
```

Then the local scheduler and peer worker claim dispatch jobs. Flights become the
user-visible lifecycle; dispatch jobs become the reliable internal scheduler.

### 6. Local Execution Is Not Serialized Per Endpoint/Session

`activeInvocationTasks` dedupes by invocation id, not endpoint/session. Two
invocations can dispatch to the same tmux/Codex/Claude session concurrently,
overwrite `lastInvocationId`, and mark the endpoint idle while another
invocation is still active.

Relevant code:

- task dedupe: `broker-daemon.ts:5174`
- active endpoint can be reused: `broker-daemon.ts:4581`
- endpoint `lastInvocationId`: `broker-daemon.ts:4855`
- stale flight checks: `broker-daemon.ts:2951`

Recommendation:

Add per-endpoint or per-session leases/queues. The default should be serialized
execution unless a transport adapter explicitly declares concurrent support.

### 7. Persistence, Projection, And Stream Fanout Are Coupled

Durable writes append journal entries, mutate the in-memory runtime, and then
apply projections. Runtime mutation emits events synchronously, and daemon event
listeners handle SSE/inbox stream fanout. Some paths use
`enqueueProjection: false` and apply projections manually.

Impact:

- transport/SSE errors can happen inside a state transition path;
- read-your-writes behavior differs by API;
- projections and runtime snapshots can briefly disagree;
- event publishing order is hard to reason about.

Relevant code:

- durable write queue: `broker-daemon.ts:811`
- commit order: `broker-daemon.ts:817`
- stream listener: `broker-daemon.ts:569`
- record flight side effects: `broker-daemon.ts:1491`
- projection bypass examples: `broker-daemon.ts:4397`, `broker-daemon.ts:5626`

Recommendation:

Make durable write application produce event envelopes without directly touching
SSE transports. Publish after commit/projection. Use a single read-your-writes
rule for read APIs, or document exactly which read model each endpoint uses.

### 8. Route Table Has A Concrete Duplicate

`POST /v1/endpoints` is handled twice:

- first via command/upsert path at `broker-daemon.ts:7491`;
- later in the "External agent endpoints" block at `broker-daemon.ts:7804`.

The second POST branch is unreachable. The adjacent `DELETE /v1/endpoints/:id`
directly mutates `runtime.deleteEndpoint` without a durable journal entry.

Recommendation:

Before any route extraction, add a route inventory test that catches duplicate
method/path registrations. Then fix endpoint delete through a durable command or
remove it if unsupported.

### 9. `acceptBrokerDelivery` Is Too Much Of The Product In One Function

`acceptBrokerDelivery` starts at `broker-daemon.ts:8560`. It:

- parses routing fields;
- handles reply refs, operator target, Scout target, channel tells;
- resolves agent/project targets;
- records rejected/unavailable dispatches;
- queues operator/mobile issues;
- ensures actors and conversations;
- records messages;
- creates work items;
- creates invocations;
- dispatches local/remote work;
- builds HTTP response bodies.

This is the densest user-facing workflow in the daemon. It should be the first
write-side application service extracted after endpoint selection is centralized.

Recommendation:

Extract `BrokerDeliveryService` with a domain return type. Let HTTP/MCP/A2A
adapters format responses.

### 10. Transport-Specific Behavior Leaks Into Routing And Persistence

Examples:

- endpoint liveness checks branch on A2A, pairing bridge, and local transport
  in `activeLocalEndpointForAgent`;
- `executeLocalInvocation` chooses pairing/A2A/local invocation adapters inline;
- Codex app-server metadata (`threadId`) is patched into endpoint metadata in
  generic broker code;
- requester timeout, dispatch stalled, and Codex process exit errors are
  classified in the daemon;
- pairing/local-session attach/detach code builds managed agents/endpoints in
  daemon helpers.

Relevant code:

- liveness: `broker-daemon.ts:4581`
- adapter selection: `broker-daemon.ts:4891`
- result metadata normalization: `broker-daemon.ts:4901`
- error classification: `broker-daemon.ts:5038`
- managed session builders: `broker-daemon.ts:3206`, `broker-daemon.ts:3267`
- attach/detach: `broker-daemon.ts:3828`, `broker-daemon.ts:3941`

Recommendation:

Introduce a transport adapter registry:

```ts
interface BrokerTransportAdapter {
  id: string;
  matches(endpoint: AgentEndpoint): boolean;
  classify(endpoint: AgentEndpoint): Promise<EndpointClassification>;
  ensureReady(endpoint: AgentEndpoint, invocation: InvocationRequest): Promise<AgentEndpoint>;
  invoke(endpoint: AgentEndpoint, invocation: InvocationRequest): Promise<InvocationAdapterResult>;
  classifyError(error: unknown): InvocationAdapterFailure;
  nextEndpointState(result: InvocationAdapterResult | InvocationAdapterFailure): Partial<AgentEndpoint>;
}
```

The broker orchestrator should persist state transitions, but adapter-specific
knowledge should live behind adapter boundaries.

### 11. Mobile Push Policy Is Too Close To Delivery Detail

`recordOperatorDeliveryIssue` sends `detail` as an alert body. The relay path
redacts payloads, but direct APNs mode can include the alert body. That conflicts
with repo guidance that APNs alert text must stay generic and detailed content
should be fetched from the local broker after app open.

Relevant code:

- operator issue push call: `broker-daemon.ts:8527`
- relay redaction: `mobile-push.ts:264`
- direct APNs alert body: `mobile-push.ts:617`

Recommendation:

Route notifications through an adapter that accepts only opaque IDs and generic
template keys. Do not pass prompt, path, command, or failure detail into APNs.

### 12. Several Concurrency/Recovery Edges Need Tests Before Refactor

Specific risks:

- `ensureBrokerDeliveryConversation` reads the snapshot outside the durable write
  queue, so concurrent deliveries can create duplicate natural-key
  conversations.
- shutdown does not await `durableWriteQueue`, `activeInvocationTasks`, or peer
  delivery in-flight attempts.
- journal compaction rewrites the journal file directly instead of temp-file +
  fsync + atomic rename.

Relevant code:

- conversation natural key lookup: `broker-daemon.ts:2564`,
  `broker-daemon.ts:2700`
- shutdown: `broker-daemon.ts:9256`
- journal compaction: `broker-journal.ts:223`, `broker-journal.ts:383`

## Proposed Cleanup Architecture

Keep `broker-daemon.ts` as the process composition root, not the application.

Target shape:

```text
broker-daemon.ts
  -> parse env / compose dependencies / start servers / shutdown

broker-http-router.ts
  -> route table and HTTP response formatting

broker-write-store.ts
  -> durable write queue, journal append, runtime mutation, projection publish

broker-delivery-service.ts
  -> /v1/deliver workflow: message, work item, invocation creation

broker-invocation-service.ts
  -> accept invocation, create dispatch job, expose lifecycle

broker-dispatch-scheduler.ts
  -> durable dispatch job claiming, endpoint/session leases, queued drain

endpoint-selection.ts
  -> classify/select/rank endpoints for UI, dispatch, execution

transport-adapters/
  tmux.ts
  codex-app-server.ts
  claude-stream-json.ts
  pi-rpc.ts
  pairing-bridge.ts
  a2a-http.ts

managed-session-service.ts
  -> pairing/local-session attach/detach/build endpoint rows

mesh-gateway.ts
  -> peer discovery, authority checks, receiver routes

a2a-server-surface.ts
  -> agent cards, JSON-RPC, task projection

feed-hub.ts
  -> SSE/inbox/invocation streams, post-commit fanout

notification-adapter.ts
  -> operator/mobile notification policy
```

## Recommended Refactor Sequence

### Phase 0: Add Guardrails Before Moving Code

Goals:

- add route inventory tests, including duplicate route detection;
- add endpoint state/classifier characterization tests;
- add accepted-invocation restart tests for `queued`, `waking`, and `waiting`;
- add per-session concurrent invocation tests;
- add exact-session offline/attachable tests.

Low-risk immediate fixes:

- remove or consolidate the duplicate `POST /v1/endpoints`;
- make endpoint delete durable or remove the route;
- stop direct APNs detail leakage.

### Phase 1: Centralize Endpoint Classification And Selection

Create `endpoint-selection.ts` and make it the only place that answers:

- which endpoint is display-preferred;
- which endpoint is runnable now;
- which endpoint is attachable or wakeable;
- whether candidates are ambiguous;
- why a target is unavailable.

Port these callers first:

- `activeLocalEndpointForAgent`
- `homeEndpointForAgent`
- `describeUnavailableDeliveryTarget`
- `scout-dispatcher` candidate summaries
- `scout-broker` preferred endpoint helpers

This phase directly addresses the screenshot-class bug.

### Phase 2: Make Dispatch Durable

Add a dispatch job/outbox record alongside invocation acceptance. On startup,
scan and claim pending dispatch jobs instead of relying on queued-flight drain
from endpoint upserts.

Add endpoint/session leases. Default transport concurrency should be one
in-flight invocation per endpoint/session.

This phase addresses stranded accepted work and concurrent same-session writes.

### Phase 3: Extract Transport Adapters

Move liveness, wake/attach, invoke, result normalization, and error
classification out of `executeLocalInvocation`.

Start with adapters already represented by `local-agent-transports.ts`:

- tmux
- `codex_app_server`
- `claude_stream_json`
- `pi_rpc`

Then fold in pairing bridge and A2A HTTP outbound.

### Phase 4: Extract Delivery And Invocation Application Services

Move `acceptBrokerDelivery`, `handleInvocationRequest`,
`acceptInvocationDurably`, and `dispatchAcceptedInvocation` into service modules
that return domain results. Keep HTTP response details in the HTTP adapter.

This should happen after endpoint selection and dispatch scheduling are
centralized so the service boundary is not built around today's drift.

### Phase 5: Extract Surfaces And Peripheral Gateways

Move the lower-risk route groups after the core dispatch semantics are stable:

- A2A inbound server;
- mesh gateway receiver/discovery;
- pairing/local-session attach/detach;
- feed/SSE hub;
- web child-process supervisor;
- notification adapter.

## Acceptance Criteria For Cleanup

1. `broker-daemon.ts` becomes a composition root under roughly 1,500-2,000
   lines, not the owner of business workflows.
2. There is exactly one endpoint classifier/selector used by UI summaries,
   dispatch diagnostics, and execution.
3. Exact-session targeting either binds to one concrete endpoint or returns a
   specific unavailable/ambiguous diagnostic before success.
4. Accepted invocations create durable dispatch jobs in the same transaction.
5. Restart can reconcile/claim pending dispatch jobs without endpoint-upsert
   side effects.
6. Endpoint/session execution is serialized unless the adapter explicitly opts
   into concurrency.
7. Route registration has tests preventing duplicate method/path branches.
8. Mobile/APNs payloads carry only opaque IDs and generic alert text.
9. Read models have an explicit freshness contract.

## Open Questions

- Should endpoint `state` be narrowed to lifecycle only, with liveness always
  derived, or should the protocol add explicit liveness fields?
- Should `session:<id>` resolution return endpoint id in all public receipts?
- Are one-time cards expected to create fresh sessions even when a live endpoint
  exists, or should "card" and "session continuation" be separated more sharply?
- Which transports can safely accept concurrent invocations?
- Should `/v1/deliver` and `/v1/invocations` share one acceptance service, or
  should `/v1/deliver` remain a higher-level wrapper that creates messages and
  work items before invoking the lower-level invocation service?

## Bottom Line

The broker should keep its canonical-writer role. The problem is that canonical
ownership has been implemented as co-location of every concern in one daemon
file. The cleanup should preserve one authority for Scout-owned records while
splitting the concerns into explicit services:

- target resolution;
- endpoint classification/selection;
- durable dispatch scheduling;
- transport adapters;
- durable write/projection;
- HTTP/A2A/MCP/mesh/mobile surfaces.

Do endpoint classification and durable dispatch first. Route extraction before
those two would reduce file size but keep the behavioral drift.
