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
  effect: "read" | "write" | "execute" | "network" | "notify" | "admin";
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
