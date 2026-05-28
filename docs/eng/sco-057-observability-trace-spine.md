# SCO-057: Observability Trace Spine

## Status

Proposed.

## Proposal ID

`sco-057`

## Intent

Define a common observability spine for Scout coordination: traces, spans,
logs, metrics, usage, and source references linked across broker-owned records
and observed harness events.

The borrowed idea is a unified observability shape where agent runs, workflow
steps, tool calls, model calls, logs, and cost metrics can be correlated. The
Scout version starts with local-first coordination traces and remains honest
about which data Scout owns.

## Context

Scout needs better answers to operational questions:

- Where did this ask spend time?
- Which broker decision routed it?
- Which endpoint or environment ran it?
- Which tool, capability, or permission gate blocked it?
- How much protocol overhead did Scout add?
- Which harness events are relevant, and are they authoritative or observed?
- What changed between a fast successful run and a slow failed one?

There are already partial records:

- broker journal facts
- invocations, flights, deliveries, and attempts
- session events and observed harness events
- operator attention records
- token and coordination accounting direction in `docs/runtime-sessions.md`
- proposed capabilities, environments, checkpoints, and run inspector records

The missing layer is a shared correlation model.

## Decision

Scout SHOULD add an observability trace spine.

A trace is the correlation boundary for one user-visible coordination path. A
span is a timed operation inside that trace. Logs, metrics, usage, broker facts,
and observed events can link to trace and span ids.

The trace spine SHOULD be OpenTelemetry-friendly, but Scout should not require a
hosted collector or full OTel deployment for local pilots. The local broker
remains the durable source for Scout-owned trace records.

## Principles

1. Trace Scout coordination first; harness execution detail is linked when
   available.
2. Separate protocol overhead from harness execution cost.
3. Keep trace payloads bounded and redacted.
4. Make every metric traceable back to a record or observed source.
5. Do not require full transcript import to compute observability views.
6. Local-first storage and inspection must work without cloud services.
7. Export to external observability tools should be an adapter, not the
   canonical store.

## Typed Ids

Trace records should not use bare `ScoutId` for every reference. `ScoutId` is
the low-level string primitive, but the trace API should expose semantic id
types so a compiler, reviewer, and serialized payload can distinguish a
`messageId` from a `flightId`.

The exact implementation can be TypeScript branded aliases or generated schema
types. The proposal-level shape is:

```ts
export type ScoutEntityId<Kind extends string> = ScoutId & { readonly __kind: Kind };

export type ScoutTraceId = ScoutEntityId<"trace">;
export type ScoutSpanId = ScoutEntityId<"span">;
export type ScoutTraceLogEventId = ScoutEntityId<"trace_log_event">;
export type ScoutTraceMetricId = ScoutEntityId<"trace_metric">;

export type ScoutNodeId = ScoutEntityId<"node">;
export type ScoutActorId = ScoutEntityId<"actor">;
export type ScoutAgentId = ScoutEntityId<"agent">;
export type ScoutConversationId = ScoutEntityId<"conversation">;
export type ScoutMessageId = ScoutEntityId<"message">;
export type ScoutInvocationId = ScoutEntityId<"invocation">;
export type ScoutFlightId = ScoutEntityId<"flight">;
export type ScoutWorkItemId = ScoutEntityId<"work_item">;
export type ScoutDeliveryId = ScoutEntityId<"delivery">;
export type ScoutEndpointId = ScoutEntityId<"endpoint">;
export type ScoutSessionId = ScoutEntityId<"session">;
export type ScoutCheckpointId = ScoutEntityId<"checkpoint">;
export type ScoutCapabilityId = ScoutEntityId<"capability">;
export type ScoutEnvironmentId = ScoutEntityId<"environment">;
export type ScoutUnblockRequestId = ScoutEntityId<"unblock_request">;
export type ScoutArtifactId = ScoutEntityId<"artifact">;
```

Serialized JSON still carries strings. The typed layer exists to keep protocol
and application code from passing a valid string id into the wrong slot.

## Trace Record

```ts
export interface ScoutTraceRecord {
  id: ScoutTraceId;
  rootSubject:
    | { kind: "message"; messageId: ScoutMessageId }
    | { kind: "invocation"; invocationId: ScoutInvocationId }
    | { kind: "flight"; flightId: ScoutFlightId }
    | { kind: "work_item"; workItemId: ScoutWorkItemId }
    | { kind: "session"; sessionId: ScoutSessionId };
  name: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "completed" | "failed" | "cancelled" | "unknown";
  ownerNodeId?: ScoutNodeId;
  actorId?: ScoutActorId;
  agentId?: ScoutAgentId;
  conversationId?: ScoutConversationId;
  metadata?: MetadataMap;
}
```

## Span Record

```ts
export interface ScoutSpanRecord {
  id: ScoutSpanId;
  traceId: ScoutTraceId;
  parentSpanId?: ScoutSpanId;
  name: string;
  kind:
    | "broker"
    | "routing"
    | "delivery"
    | "runtime"
    | "harness"
    | "capability"
    | "environment"
    | "operator_attention"
    | "adapter"
    | "external";
  startedAt: number;
  endedAt?: number;
  status: "ok" | "error" | "cancelled" | "waiting" | "unknown";
  subjectRefs: ScoutTraceSubjectReference[];
  sourceRefs?: ScoutTraceSourceReference[];
  attributes?: Record<string, string | number | boolean>;
  error?: ScoutTraceError;
}
```

```ts
export type ScoutTraceSubjectReference =
  | { kind: "message"; messageId: ScoutMessageId }
  | { kind: "invocation"; invocationId: ScoutInvocationId }
  | { kind: "flight"; flightId: ScoutFlightId }
  | { kind: "work_item"; workItemId: ScoutWorkItemId }
  | { kind: "delivery"; deliveryId: ScoutDeliveryId }
  | { kind: "endpoint"; endpointId: ScoutEndpointId }
  | { kind: "session"; sessionId: ScoutSessionId }
  | { kind: "checkpoint"; checkpointId: ScoutCheckpointId }
  | { kind: "capability"; capabilityId: ScoutCapabilityId }
  | { kind: "environment"; environmentId: ScoutEnvironmentId }
  | { kind: "unblock_request"; unblockRequestId: ScoutUnblockRequestId };
```

## Log Events

Logs should be structured and correlated:

```ts
export interface ScoutTraceLogEvent {
  id: ScoutTraceLogEventId;
  traceId?: ScoutTraceId;
  spanId?: ScoutSpanId;
  at: number;
  level: "debug" | "info" | "warn" | "error";
  source: "broker" | "runtime" | "adapter" | "surface" | "harness_observed";
  message: string;
  fields?: Record<string, string | number | boolean>;
  sourceRef?: ScoutTraceSourceReference;
}
```

Logs should not carry unbounded command output, model responses, secrets, or
large payloads. Those belong behind source references or artifacts.

## Metrics And Usage

Metrics are derived from spans, facts, and observed events:

```ts
export interface ScoutTraceMetric {
  id: ScoutTraceMetricId;
  traceId: ScoutTraceId;
  spanId?: ScoutSpanId;
  name:
    | "duration_ms"
    | "queue_ms"
    | "delivery_attempts"
    | "routing_candidates"
    | "wake_attempts"
    | "tokens_prompt"
    | "tokens_completion"
    | "tokens_total"
    | "estimated_cost_usd"
    | "bytes_in"
    | "bytes_out";
  value: number;
  unit: "ms" | "count" | "tokens" | "usd" | "bytes";
  source: "broker_exact" | "harness_exact" | "adapter_estimate" | "derived" | "manual";
}
```

Usage records MUST distinguish:

- `protocol_overhead`: Scout-authored routing, wrapping, diagnostics,
  summaries, and coaching
- `harness_execution`: target model or harness work
- `external_service`: third-party API/tool usage when reported

This keeps Scout from overstating or hiding the cost of its own coordination
layer.

## Source References

Observed source references should include:

```ts
export interface ScoutTraceSourceReference {
  ownership: "scout_owned" | "harness_observed" | "host_observed" | "external_observed";
  harness?: AgentHarness;
  scoutSessionId?: ScoutSessionId;
  harnessSessionId?: string;
  transcriptPath?: string;
  cursor?: string;
  rawEventId?: string;
  artifactId?: ScoutArtifactId;
  redacted?: boolean;
}
```

Every reference should be safe to display as metadata. Paths may still be local
and sensitive, so debug bundle export should redact or relativize them unless
the operator opts in.

## Trace Creation

Scout SHOULD create traces for:

- `scout send` that performs non-trivial delivery planning
- `scout ask` and MCP `ask`
- session start, attach, wake, and stop operations
- managed process adapter runs
- broker route failures that require diagnostics
- durable unblock request flows

The first implementation should focus on `ask`, because it naturally spans
routing, delivery, runtime execution, and completion.

## Export

The local trace spine should support future export to:

- OpenTelemetry
- local JSON debug bundles
- run inspector snapshots
- lightweight usage reports

Exporters should be optional. If an exporter fails, Scout-owned trace records
must still exist locally.

## Non-Goals

- building a hosted metrics product
- claiming compliance-grade audit logging
- recording full model transcripts in trace spans
- requiring OpenTelemetry infrastructure for local usage
- blending Scout protocol overhead with target harness execution cost
- making observed harness metrics authoritative when the adapter only estimated
  them

## Implementation Sequence

1. Add protocol types for traces, spans, logs, metrics, usage source, and source
   references.
2. Add trace id propagation through `ask` creation, delivery planning, flight
   updates, and runtime dispatch.
3. Persist local trace and span records for broker-owned operations.
4. Link observed harness events to trace ids when an adapter can infer the
   relation.
5. Derive latency and delivery attempt metrics for asks.
6. Add protocol overhead usage records where Scout-authored prompts or summaries
   are generated.
7. Feed trace data into the run inspector from SCO-054.
8. Add optional OTel export after the local path is stable.

## Acceptance Criteria

- A Scout ask has one trace id visible across invocation, flight, delivery, and
  runtime dispatch.
- Trace references use semantic id fields such as `messageId`, `flightId`, and
  `sessionId`, not a generic `{ id: ScoutId }` shape.
- Broker spans record routing and delivery timing.
- Observed harness events can link to a trace without becoming Scout-owned
  messages.
- Usage records distinguish protocol overhead from harness execution.
- Logs and metrics are bounded and redacted.
- A local run inspector can show trace timing without requiring a hosted
  collector.

## Relationship To Other Proposals

- [`docs/runtime-sessions.md`](../runtime-sessions.md) defines coordination
  accounting direction.
- [`sco-054`](./sco-054-run-inspector-and-debug-surfaces.md) consumes trace data
  in the inspector.
- [`sco-042`](./sco-042-harness-event-normalization-and-replay-boundary.md)
  defines observed event boundaries.
- [`sco-040`](./sco-040-capability-registry-and-tool-boundaries.md) and
  [`sco-043`](./sco-043-execution-environment-contracts.md) provide important
  span subject references.
