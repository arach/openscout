# SCO-069: Broker Service Port Boundaries

## Status

Proposed — ready for review.

## Proposal ID

`sco-069`

## Date

2026-06-19

## Intent

Tighten dependency boundaries across the refactored broker runtime so
`broker-daemon.ts` stays a composition root and application services depend on
small, named ports instead of 15–30 loose function callbacks.

This spec follows the structural extraction documented in
[broker-daemon-architecture-review-2026-06-18.md](./broker-daemon-architecture-review-2026-06-18.md).
That refactor moved workflows out of the monolith; this proposal names the
**dependency contract** those services should share going forward.

## Problem

After service extraction, several application modules still take large `*Deps`
bags wired manually in `broker-daemon.ts`. The worst offender is
`BrokerDeliveryAcceptanceService`, which currently accepts roughly thirty
dependencies, many of which are:

- pure helpers that do not need injection;
- thin wrappers around methods that already exist on sibling services;
- snapshot-scoped read helpers that always travel together;
- cross-cutting orchestration callbacks duplicated across delivery and
  invocation paths.

This creates three costs:

1. **Composition noise** — `broker-daemon.ts` wiring blocks are long and hard to
   scan.
2. **Weak test seams** — unit tests stub many one-off functions instead of a few
   cohesive fakes.
3. **Boundary drift** — the same read or routing semantics get re-wired
   differently in delivery, invocation, command, and HTTP paths.

`BrokerDurableStore` already demonstrates the desired shape: three tiny writer
interfaces (`BrokerJournalWriter`, `BrokerProjectionWriter`,
`BrokerThreadEventPublisher`) instead of reaching into journal/projection
internals from every caller.

## Goals

- Reduce per-service dependency surface area without another large rewrite.
- Make tests construct services from a small number of port fakes.
- Keep `broker-daemon.ts` as wiring only; no new business logic there.
- Preserve current behavior during migration (behavior-neutral PRs).
- Prefer `Pick<ExistingService, "method">` when a service already owns the right
  API.

## Non-Goals

- Replacing the in-memory runtime or journal model.
- Changing HTTP route semantics or protocol types.
- Introducing a DI framework or runtime reflection.
- Moving pure domain helpers behind interfaces.
- Solving endpoint-classification semantics (that remains centralized in
  `broker-endpoint-selection.ts` and related behavioral work).

## Design Principles

### 1. Three dependency buckets

| Bucket | Examples | Treatment |
| --- | --- | --- |
| Scalars / config | `nodeId`, `operatorActorId`, `createId`, `now` | Stay on `*ServiceDeps` |
| Pure helpers | `titleCaseName`, `brokerRouteKind`, `isOperatorDeliveryTarget` | Import directly from helper modules |
| Cross-boundary I/O | routing, conversation ensure, invocation accept, dispatch diagnostics | Named ports |

Pure functions are **not** ports.

### 2. Ports are narrow and verb-oriented

Prefer `routing.resolveDeliveryTarget(...)` over exposing `deliveryRouter`.

### 3. Prefer delegation to existing services

When `BrokerConversationService` already exposes `ensureDeliveryConversation`,
the port is:

```ts
export type BrokerConversationPort = Pick<
  BrokerConversationService,
  "ensureActorForDelivery" | "ensureDeliveryConversation"
>;
```

### 4. One factory owns daemon binding

All real port implementations are assembled in
`packages/runtime/src/broker-ports/create-broker-ports.ts` (or later
`broker-bootstrap.ts`). Services must not import `broker-daemon.ts`.

### 5. No HTTP on ports

Ports use protocol/domain types only. HTTP adapters map domain results to status
codes and JSON bodies.

## Proposed Module Layout

```text
packages/runtime/src/broker-ports/
  read-model.ts
  routing.ts
  conversation.ts
  invocation.ts
  dispatch-diagnostics.ts
  work-items.ts
  operator-attention.ts
  messaging.ts
  local-agent-sync.ts
  invocation-persistence.ts
  invocation-execution.ts
  create-broker-ports.ts
  index.ts
```

## Port Definitions

### `BrokerReadModel`

Replaces `runtimeSnapshot()` plus snapshot-scoped helper callbacks passed into
delivery acceptance and related services.

```ts
export type BrokerReadModel = {
  snapshot(): RuntimeSnapshot;
  messageByRef(ref: string): MessageRecord | null;
  actorDisplayName(actorId: string): string;
  homeEndpoint(agentId: string): AgentEndpoint | null;
  returnAddressForActor(
    actorId: string,
    options?: {
      conversationId?: string;
      replyToMessageId?: string;
      sessionId?: string;
    },
  ): ScoutReturnAddress;
};
```

Default adapter:

```ts
export function createBrokerReadModel(
  runtime: { snapshot(): RuntimeSnapshot },
): BrokerReadModel {
  return {
    snapshot: () => runtime.snapshot(),
    messageByRef: (ref) => resolveBrokerMessageRef(runtime.snapshot(), ref),
    actorDisplayName: (actorId) => brokerActorDisplayName(runtime.snapshot(), actorId),
    homeEndpoint: (agentId) => homeEndpointForAgent(runtime.snapshot(), agentId),
    returnAddressForActor: (actorId, options) =>
      buildBrokerReturnAddressForActor(runtime.snapshot(), actorId, options),
  };
}
```

Callers stop threading `snapshot` through every helper invocation.

### `BrokerRoutingPort`

Wraps target resolution, local-agent sync prelude, and unavailable-target
diagnostics.

```ts
export type BrokerRoutingPort = {
  syncBeforeRoute(reason: "delivery" | "invocation"): Promise<void>;
  resolveDeliveryTarget(
    input: BrokerRouteTargetInput & {
      execution?: InvocationRequest["execution"];
      projectAgent?: ScoutDeliverRequest["projectAgent"];
    },
    options: {
      requesterId?: string;
      currentDirectory?: string;
      reason: string;
    },
  ): Promise<InvocationResolution>;
  resolveInvocationTarget(
    payload: InvocationRequest & BrokerRouteTargetInput,
  ): Promise<InvocationResolution>;
  describeUnavailable(
    agent: AgentDefinition,
    targetSessionId?: string,
  ): ScoutDispatchUnavailableTarget | null;
  buildUnavailableEnvelope(
    askedLabel: string,
    unavailable: ScoutDispatchUnavailableTarget,
  ): ScoutDispatchEnvelope;
};
```

Backed by:

- `BrokerLocalAgentSyncService.syncIfChanged`
- `BrokerDeliveryRouter.resolveWithImplicitProjectAgent` / `resolveInvocationTarget`
- `BrokerUnavailableTargetService.describe` / `buildEnvelope`

### `BrokerConversationPort`

```ts
export type BrokerConversationPort = Pick<
  BrokerConversationService,
  "ensureActorForDelivery" | "ensureDeliveryConversation"
>;
```

### `BrokerInvocationPort`

Hides accept/dispatch job details from delivery acceptance.

```ts
export type BrokerInvocationPort = {
  accept(invocation: InvocationRequest): Promise<FlightRecord>;
  dispatchAccepted(invocation: InvocationRequest): Promise<void>;
};
```

Backed by `BrokerInvocationDispatchService`.

### `BrokerDispatchDiagnosticsPort`

```ts
export type BrokerDispatchDiagnosticsPort = {
  record(
    envelope: ScoutDispatchEnvelope,
    context?: {
      invocationId?: string;
      conversationId?: string;
      requesterId?: string;
    },
  ): Promise<{ record: ScoutDispatchRecord }>;
};
```

Backed by durable scout-dispatch recording today (`recordScoutDispatchDurably`).

### `BrokerMessagingPort`

```ts
export type BrokerMessagingPort = Pick<
  BrokerMessageService,
  "postConversationMessage" | "postInvocationStatusMessage"
>;
```

Follow-up: move `onlineConversationNotifyTargets` here if it remains
message-domain behavior.

### `BrokerWorkItemPort`

```ts
export type BrokerWorkItemPort = {
  recordForDelivery(input: {
    payload: ScoutDeliverRequest;
    requestId: string;
    requesterId: string;
    targetAgentId: string;
    conversationId: string;
    createdAt: number;
  }): Promise<DeliveryWorkItemResolution>;
  resolutionForTell(payload: ScoutDeliverRequest): DeliveryWorkItemResolution;
};
```

Backed by `BrokerWorkItemStore`.

### `BrokerOperatorAttentionPort`

```ts
export type BrokerOperatorAttentionPort = Pick<
  BrokerOperatorAttentionService,
  "queueDeliveryIssue"
>;
```

### `BrokerInvocationPersistencePort`

For invocation dispatch only; mirrors durable record + dispatch job writes.

```ts
export type BrokerInvocationPersistencePort = {
  recordInvocation(
    invocation: InvocationRequest,
    options?: {
      createDispatchJob?: (flight: FlightRecord) => BrokerInvocationDispatchJob;
      enqueueProjection?: boolean;
    },
  ): Promise<{
    flight: FlightRecord;
    dispatchJob?: BrokerInvocationDispatchJob;
    entries: BrokerJournalEntry[];
  }>;
  recordInvocationDispatchJob(
    job: BrokerInvocationDispatchJob,
    options?: { enqueueProjection?: boolean },
  ): Promise<BrokerJournalEntry[]>;
  applyProjectedEntries(
    entries: BrokerJournalEntry | BrokerJournalEntry[],
  ): Promise<void>;
  recordFlight(flight: FlightRecord): Promise<void>;
};
```

### `BrokerInvocationExecutionPort`

```ts
export type BrokerInvocationExecutionPort = {
  enqueuePeerInvocation(
    invocation: InvocationRequest,
    authorityNode: NodeDefinition,
  ): Promise<void>;
  launchLocalInvocation(
    invocation: InvocationRequest,
    flight: FlightRecord,
  ): void;
};
```

## Aggregated Application Ports

```ts
export type BrokerApplicationPorts = {
  readModel: BrokerReadModel;
  routing: BrokerRoutingPort;
  conversation: BrokerConversationPort;
  messaging: BrokerMessagingPort;
  invocation: BrokerInvocationPort;
  dispatchDiagnostics: BrokerDispatchDiagnosticsPort;
  workItems: BrokerWorkItemPort;
  operatorAttention: BrokerOperatorAttentionPort;
};
```

Factory:

```ts
export function createBrokerApplicationPorts(input: {
  runtime: InMemoryControlRuntime;
  conversationService: BrokerConversationService;
  deliveryRouter: BrokerDeliveryRouter;
  unavailableTargetService: BrokerUnavailableTargetService;
  localAgentSyncService: BrokerLocalAgentSyncService;
  messageService: BrokerMessageService;
  invocationDispatchService: BrokerInvocationDispatchService;
  operatorAttentionService: BrokerOperatorAttentionService;
  workItemStore: BrokerWorkItemStore;
  recordScoutDispatch: BrokerDispatchDiagnosticsPort["record"];
}): BrokerApplicationPorts;
```

## Service Dependency Targets

### `BrokerDeliveryAcceptanceService` (primary target)

**Before:** ~30 deps  
**After:**

```ts
export type BrokerDeliveryAcceptanceServiceDeps = {
  nodeId: string;
  operatorActorId: string;
  createId: (prefix: string) => string;

  readModel: BrokerReadModel;
  routing: BrokerRoutingPort;
  conversation: BrokerConversationPort;
  messaging: BrokerMessagingPort;
  invocation: BrokerInvocationPort;
  dispatchDiagnostics: BrokerDispatchDiagnosticsPort;
  workItems: BrokerWorkItemPort;
  operatorAttention: BrokerOperatorAttentionPort;

  onlineConversationNotifyTargets?: (
    conversation: ConversationDefinition,
    requesterId: string,
  ) => string[];

  warn?: (message: string, detail?: unknown) => void;
  now?: () => number;
};
```

Pure helpers imported from `broker-conversation-helpers.ts` and
`broker-delivery-routing.ts`.

### `BrokerInvocationDispatchService` (second target)

```ts
export type BrokerInvocationDispatchServiceDeps = {
  nodeId: string;
  createId: (prefix: string) => string;
  now?: () => number;

  readModel: BrokerReadModel & {
    agent(id: string): AgentDefinition | undefined;
    node(id: string): NodeDefinition | undefined;
    flightForInvocation(id: string): FlightRecord | undefined;
  };
  routing: BrokerRoutingPort;
  persistence: BrokerInvocationPersistencePort;
  dispatchDiagnostics: BrokerDispatchDiagnosticsPort;
  execution: BrokerInvocationExecutionPort;
  messaging: Pick<BrokerMessagingPort, "postInvocationStatusMessage">;

  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string, detail: unknown) => void;
};
```

### HTTP adapters

Continue the existing pattern from `broker-http-entity-write-routes.ts`:

```ts
brokerService: Pick<ActiveScoutBrokerService, "executeCommand" | ...>
```

HTTP handlers receive `Pick<BrokerApplicationPorts, ...>` only when they need
direct service access outside `ActiveScoutBrokerService`.

## Daemon Wiring (target shape)

```ts
const stores = createBrokerStores({ journal, projection, threadEvents, runtime });
const services = createBrokerServices({ stores, runtime, env });
const ports = createBrokerApplicationPorts({ ...services, runtime });

const deliveryAcceptanceService = new BrokerDeliveryAcceptanceService({
  nodeId,
  operatorActorId,
  createId: createRuntimeId,
  ...ports,
});

const invocationDispatchService = new BrokerInvocationDispatchService({
  nodeId,
  createId: createRuntimeId,
  readModel: { ...ports.readModel, ...runtimeReadExtensions },
  routing: ports.routing,
  persistence: stores.invocationPersistence,
  dispatchDiagnostics: ports.dispatchDiagnostics,
  execution: services.invocationExecution,
  messaging: ports.messaging,
});
```

`broker-daemon.ts` should not define `ensureBrokerActorForDelivery`-style
wrappers once ports delegate directly to services.

## Migration Plan

Behavior-neutral, PR-sized slices:

| PR | Scope | Risk |
| --- | --- | --- |
| 1 | Add `broker-ports/*` types + `createBrokerReadModel` + unit tests | None |
| 2 | Delivery acceptance: adopt `readModel`; import pure helpers directly | Low |
| 3 | Add `createBrokerApplicationPorts`; wire delivery acceptance ports | Low |
| 4 | Collapse `BrokerInvocationDispatchService` deps | Medium |
| 5 | HTTP/command services consume narrowed `Pick<>` ports | Low |
| 6 | Move factory to `broker-bootstrap.ts`; delete daemon wrappers | Low |

Each PR must keep existing tests green.

## Testing Strategy

### Per-port fakes

```ts
function fakeRouting(overrides: Partial<BrokerRoutingPort> = {}): BrokerRoutingPort {
  return {
    syncBeforeRoute: async () => {},
    resolveDeliveryTarget: async () => ({ kind: "resolved", agent: testAgent() }),
    resolveInvocationTarget: async () => ({ kind: "resolved", agent: testAgent() }),
    describeUnavailable: () => null,
    buildUnavailableEnvelope: (askedLabel) => minimalEnvelope(askedLabel),
    ...overrides,
  };
}
```

### Composition smoke test

`create-broker-ports.test.ts` builds ports against an in-memory runtime and
asserts delegate methods call the underlying service stubs.

### No regression guardrails

- existing `broker-delivery-acceptance-service.test.ts` scenarios stay intact
- existing `broker-invocation-dispatch-service.test.ts` scenarios stay intact
- `broker-daemon-route-inventory.test.ts` unchanged

## Acceptance Criteria

1. `BrokerDeliveryAcceptanceServiceDeps` has at most **12** fields (including
   optional `warn` / `now`).
2. `broker-daemon.ts` delivery + invocation wiring blocks shrink to spread of
   `ports` plus scalars.
3. Pure helpers are not passed through daemon wiring.
4. All port types live under `broker-ports/` and are imported by services; daemon
   imports only the factory.
5. Unit tests for delivery acceptance construct ≤ 10 port fakes.
6. No behavior change in broker integration tests.

## Open Questions

1. Should `BrokerReadModel` later absorb projection-backed reads (activity,
   collaboration), or stay runtime-snapshot-only?
2. Should `onlineConversationNotifyTargets` move onto `BrokerMessagingPort` now
   or in a follow-up?
3. Is `BrokerRoutingPort` the long-term home for endpoint classification, or
   should routing port call `broker-endpoint-selection.ts` indirectly via
   unavailable-target service only?
4. Should `createBrokerApplicationPorts` live beside `broker-bootstrap.ts` from
   the start, or land in daemon first and move later?
5. Do we want a generated dep-count test that fails if
   `BrokerDeliveryAcceptanceServiceDeps` regresses above the acceptance
   threshold?

## Relationship To Other Docs

- Structural context:
  [broker-daemon-architecture-review-2026-06-18.md](./broker-daemon-architecture-review-2026-06-18.md)
- Product/broker nouns: [docs/agent/broker.agent.md](../agent/broker.agent.md)
- Integration-boundary pattern: [sco-006-integration-layer-and-boundary-proposal.md](./sco-006-integration-layer-and-boundary-proposal.md)
- Broker routing contract: [sco-014-broker-owned-routing-and-context.md](./sco-014-broker-owned-routing-and-context.md)

## Review Request

Reviewers should evaluate:

1. Are the proposed ports the right seams, or too coarse/fine?
2. Is the migration order safe and incremental enough?
3. Are any deps incorrectly classified as ports vs pure imports?
4. What acceptance criteria or tests are missing?
5. Does this conflict with in-flight dispatch-job / endpoint-selection work on
   `codex/broker-review-fixes`?
