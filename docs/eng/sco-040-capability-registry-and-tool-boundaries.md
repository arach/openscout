# SCO-040: Capability Registry And Tool Boundaries

## Status

Proposed.

## Proposal ID

`sco-040`

## Intent

Define how OpenScout should describe agent-accessible capabilities without
collapsing tool execution, credentials, permissions, and harness behavior into
one implicit surface.

The aim is a local-first capability registry that can answer:

1. What actions are available?
2. Which actor, agent, session, project, or channel may use them?
3. Which credentials or secrets may be involved?
4. Which boundary enforces the decision?
5. What evidence is recorded when the capability is used?

## Context

Scout already models routing, invocations, work items, permissions, and
harnesses. The next gap is capability clarity. Agents can invoke local tools,
MCP tools, harness tools, shell commands, broker APIs, and future project or
organization integrations. Those actions have different risk levels and
different enforcement points.

OpenScout needs a neutral registry that describes capabilities before they are
used. This registry should not assume one plugin system, one secret backend, or
one execution environment.

The near-term priority is a provider and harness capability matrix that routing,
onboarding, and debug surfaces can read before a task starts. Scout needs a
matrix that includes local readiness, harness lifecycle support, permission
boundaries, evidence freshness, and downgrade paths.

Overlap with other runtimes, frameworks, or protocols is not a reason to concede
the surface. Scout should play well with external metadata sources, but it
should still build the local-first broker/control-plane view it needs.
Redundancy is acceptable when Scout needs a clearer routing, inspection, or
permission answer than an upstream system exposes.

## Decision

OpenScout SHOULD introduce a broker-visible capability registry.

A capability is a declarative description of one action family an agent may ask
to use. The registry is not necessarily the executor. It is the broker-readable
source of metadata for permission checks, UI disclosure, routing, audit, and
operator review.

Capability execution MAY happen through:

- a broker-owned local service
- an MCP server
- a harness-native tool
- a shell command inside a bounded execution environment
- an app connector
- a project-specific extension pack
- a remote peer or trusted environment

Every capability SHOULD declare its execution boundary and enforcement level.

## Principles

1. Capabilities are declared before use.
2. Tool names alone are not permission boundaries.
3. Secret references are metadata; secret values are never stored in capability
   records.
4. Read and write actions should be distinguishable.
5. Destructive or external actions should require stronger policy than local
   read-only inspection.
6. The broker decides whether a capability is available in a given context.
7. Execution adapters report what they enforced, not what they hoped the agent
   would follow.
8. The registry must work locally without a hosted service.
9. Interop is preferred, but overlap with another framework is not a product
   veto.

## Capability Matrix

The registry should project a matrix, not just a flat list of tools. The matrix
is the operator and router view of what can be used now, what can be used with a
downgrade, and what is unavailable.

The first useful axes are:

- provider and model capabilities: provider id, model id, input modalities,
  output modalities, streaming, tool calling, structured output, embeddings,
  context window, usage telemetry, pricing or provenance source, and known
  limits
- harness and session support: start, resume, interrupt, shutdown, concurrent
  turns, trace observation, questions, approvals, server requests, command
  tools, file-change tools, subagents, MCP transports, auth modes, logs, and raw
  transcript access
- tool and action methods: input schema, output schema, effect, idempotence,
  approval requirement, execution boundary, enforcement level, secret
  references, and artifact outputs
- readiness and evidence: installed, configured, credentials resolvable,
  endpoint reachable, required resources available, last checked time, evidence
  kind, evidence ref, and downgrade reason
- routing projection: whether a request can be satisfied by this
  provider/harness/capability combination, which alternative is preferred, and
  why a route was denied

`HarnessFeatureSupportMap` in `packages/protocol` is already a small slice of
this shape for harness support. SCO-040 should widen that idea into one shared
capability/readiness projection that catalog, routing, run inspection, CLI, and
native surfaces can consume.

The matrix can start as a read model over existing catalog entries and adapter
reports. It does not need to become the executor in the first milestone.

## Scalable Ingestion

Scout MUST NOT require hand-authored knowledge for every capability, MCP tool,
runtime feature, or model. The matrix should be built from layered ingestion and
progressive enrichment.

Ingestion sources SHOULD include:

- protocol-native discovery, such as MCP tool lists, input schemas, output
  schemas, descriptions, and transport metadata
- harness adapter reports for lifecycle support, trace support, approval
  support, auth modes, debug surfaces, and observed feature coverage
- project manifests and extension-pack declarations for capabilities that are
  intentionally installed with a workspace
- runtime probes that verify whether binaries, credentials, endpoints, and
  required local resources are present right now
- observed execution facts that refine freshness, reliability, latency,
  downgrade behavior, and failure reasons
- optional human-authored annotations for display names, risk classes, routing
  hints, and documentation links

The broker should preserve raw discovered metadata with provenance, then project
it into Scout's normalized matrix. Normalization should be shallow and durable:
effect, schema shape, boundary, readiness, evidence, freshness, and policy
requirements. Scout does not need to understand every tool's domain semantics in
order to route, disclose, or gate it.

Unknown should be a first-class state. A newly discovered capability can be
listed as `unknown` or `advisory` until an adapter, probe, or operator annotation
adds stronger evidence. This lets the matrix scale without pretending the system
has more knowledge than it does.

Manual curation should be reserved for high-value product polish and safety:
better labels, grouped categories, risk overrides, recommended defaults, and
known incompatibilities. It should not be required for basic discovery,
readiness, or routing diagnostics.

## Rollout Tracks

The implementation should land as a spine with plug-in lanes, not as one giant
registry project.

1. Protocol spine: shared types for sources, evidence, methods, effects,
   readiness, enforcement, provenance, and matrix snapshots.
2. Protocol discovery: ingest MCP and other structured protocol metadata into
   raw snapshots, then normalize shallowly into capability definitions.
3. Harness reports: project `HarnessFeatureSupportMap` and adapter coverage
   reports into the same matrix so lifecycle and observation support sit beside
   tool support.
4. Provider and model reports: add provider/model capability records for
   modalities, streaming, tool calling, structured output, embeddings, context
   limits, usage telemetry, and freshness.
5. Readiness probes: verify local binaries, credentials, endpoints, workspace
   resources, trace sources, and MCP server reachability as separate evidence
   from declared capability.
6. Routing diagnostics: use the matrix first to explain allow, deny, downgrade,
   or unknown decisions before making routing increasingly automatic.
7. Inspector projection: let run inspection and later typed result cards read
   the same capability, artifact, and source-reference facts instead of inventing
   a UI-only tool-result model.

Each track should be useful on its own. MCP ingestion should not wait for model
catalogs, and model catalogs should not wait for polished inspector cards.

## Capability Record

```ts
export interface ScoutCapabilityDefinition {
  id: ScoutId;
  name: string;
  displayName: string;
  description?: string;
  provider:
    | "broker"
    | "mcp"
    | "harness"
    | "shell"
    | "app_connector"
    | "extension_pack"
    | "remote_peer";
  methods: ScoutCapabilityMethod[];
  scope: ScoutCapabilityScope;
  secrets?: ScoutSecretReference[];
  enforcement: ScoutCapabilityEnforcement;
  provenance: ScoutCapabilityProvenance;
  version?: string;
  enabled: boolean;
}
```

```ts
export interface ScoutCapabilityMethod {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  effects: Array<
    "read" | "write" | "execute" | "network" | "notify" | "admin" | "unknown"
  >;
  idempotent?: boolean;
  requiresApproval?: boolean;
}
```

```ts
export interface ScoutSecretReference {
  name: string;
  purpose: string;
  locations?: Array<"header" | "query" | "path" | "body" | "env" | "file">;
  hosts?: string[];
  optional?: boolean;
}
```

The record intentionally describes secret references rather than values. Secret
resolution belongs to the selected execution boundary and policy adapter.

## Scope Model

Capabilities SHOULD be filterable by:

- project root
- workspace or worktree
- agent id
- harness
- local machine or mesh node
- requester actor
- channel or conversation
- permission profile
- execution environment

The first implementation can support only project root, agent id, harness, and
permission profile. The type should leave room for channel and requester policy.

## Enforcement Levels

```ts
export type ScoutCapabilityEnforcementLevel =
  | "broker_native"
  | "mcp_server"
  | "harness_native"
  | "sandbox_native"
  | "container"
  | "remote_authority"
  | "advisory"
  | "unknown";
```

The UI and broker diagnostics MUST distinguish `advisory` and `unknown` from
enforced boundaries.

## Permission Evaluation

Before executing a capability, Scout SHOULD evaluate:

1. Is the capability enabled in this context?
2. Is the method allowed for the requester, target agent, and conversation?
3. Does the selected execution environment satisfy the capability's enforcement
   requirement?
4. Are required secrets resolvable through an approved boundary?
5. Does the method require human approval?
6. What audit fact should be written before and after execution?

The result should be a typed decision:

```ts
type ScoutCapabilityDecision =
  | { decision: "allow"; grantId?: ScoutId }
  | { decision: "deny"; reason: string }
  | { decision: "require_approval"; approvalRequestId: ScoutId }
  | { decision: "require_environment"; profileId: ScoutId; reason: string };
```

## Audit Facts

Capability use SHOULD append compact broker facts:

- `capability.discovered`
- `capability.enabled`
- `capability.disabled`
- `capability.decision`
- `capability.invoked`
- `capability.completed`
- `capability.failed`

Facts should record method name, actor, agent, context, decision, duration, and
error class. They should not record secret values or unbounded response bodies.

## Relationship To MCP

MCP servers can be capability providers, but the registry should not be MCP-only.
OpenScout needs one policy and display model for MCP tools, harness-native
tools, local shell affordances, and broker APIs.

For MCP-backed capabilities, Scout SHOULD cache tool metadata with provenance
and freshness. It SHOULD re-check availability before execution.

## External Metadata Boundary

Frameworks, harnesses, and protocols may expose useful metadata such as tool
schemas, agent-to-tool bindings, provider/model identifiers, workflow
definitions, runtime traces, logs, and evaluation results. Scout can ingest or
reference that material when an adapter has a stable read surface.

Those sources do not replace Scout's matrix. Scout's matrix describes what this
local broker, machine, project, harness, session, provider, and permission
profile can safely route to right now. External metadata should be projected
into Scout's topology and capability models with clear provenance rather than
treated as the authority for all Scout routing.

## Non-Goals

- inventing a new universal tool execution protocol
- replacing MCP
- storing credentials in broker records
- guaranteeing hard isolation for all capability providers
- making every local shell command a registered capability in the first
  milestone
- solving enterprise RBAC in this proposal

## Implementation Sequence

1. Add protocol types for capability definitions, methods, decisions, and audit
   facts.
2. Register broker-native capabilities first: message send, ask, work update,
   session inspect, and session start.
3. Project installed MCP tools into the registry as `mcp_server` capabilities.
4. Add permission policy checks for method `effect` and enforcement level.
5. Surface capability availability in CLI and desktop inspector views.
6. Add extension-pack capability declarations after SCO-041.

## Acceptance Criteria

- Scout can list available capabilities for a given agent/session/project.
- A capability declaration includes provider, methods, effects, secret
  references, enforcement level, and provenance.
- Permission decisions are typed and explainable.
- Capability execution writes compact audit facts.
- Secret values never appear in capability records or audit facts.
- MCP tools fit into the model without becoming the whole model.
