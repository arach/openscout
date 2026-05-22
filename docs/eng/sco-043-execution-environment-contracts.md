# SCO-043: Execution Environment Contracts

## Status

Proposed.

## Proposal ID

`sco-043`

## Intent

Define a neutral OpenScout contract for the places where agent work can run.

The goal is to let the broker reason about local sessions, project worktrees,
containers, remote peers, and external sandboxes with one vocabulary while
remaining honest about what each environment actually enforces.

## Context

OpenScout is local-first, but local-first does not mean every task should run
with the same access to the user's machine. Some work can run in a trusted local
harness session. Some work should run in a separate worktree. Some work may need
a container or external sandbox. Some work may only need a read-only observation
surface.

The broker needs to select and explain an execution environment without making
one backend the product authority.

## Decision

OpenScout SHOULD model execution environments as broker-visible resources with
declared capabilities, constraints, lifecycle, and proof.

An execution environment is any place where Scout may place or observe agent
work:

- local harness session
- local worktree
- local copied workspace
- local container
- remote mesh peer
- external sandbox
- read-only observation source

The runtime starts, attaches, or checks these environments. The broker records
the chosen environment and why it was compatible with the request.

## Principles

1. The broker selects based on declared constraints; adapters execute.
2. Local trusted sessions remain the default path.
3. Stronger isolation should be requested explicitly or by policy.
4. Advisory constraints must not be labeled as enforced isolation.
5. Every environment should report lifecycle and cleanup state.
6. Environment choice should be inspectable after the fact.
7. The model must not require a specific cluster manager, container runtime,
   hosted sandbox, or provider.

## Environment Profile

```ts
export interface ScoutExecutionEnvironmentProfile {
  id: ScoutId;
  kind:
    | "local_session"
    | "local_worktree"
    | "copied_workspace"
    | "local_container"
    | "remote_peer"
    | "external_sandbox"
    | "observed_only";
  displayName: string;
  nodeId?: ScoutId;
  projectRoot?: string;
  worktreePath?: string;
  harnesses?: AgentHarness[];
  capabilities: ScoutEnvironmentCapability[];
  constraints: ScoutEnvironmentConstraint[];
  enforcement: ScoutEnvironmentEnforcement;
  lifecycle: ScoutEnvironmentLifecycle;
  provenance: ScoutEnvironmentProvenance;
}
```

```ts
export interface ScoutEnvironmentEnforcement {
  filesystem: "host" | "worktree" | "copy" | "read_only" | "container" | "external" | "unknown";
  network: "host" | "restricted" | "denied" | "external_policy" | "unknown";
  process: "host" | "container" | "external" | "unknown";
  secrets: "host_env" | "broker_gated" | "provider_gated" | "none" | "unknown";
  approvals: "harness_native" | "broker_native" | "operator_only" | "none" | "unknown";
}
```

The enforcement shape should be reported by the adapter and shown plainly in
diagnostics.

## Request Constraints

An ask, work item, or session start MAY include environment constraints:

```ts
export interface ScoutExecutionConstraints {
  workspace?: "same" | "new_worktree" | "copy" | "observed_only";
  isolation?: "trusted_local" | "restricted_local" | "container" | "external";
  network?: "host" | "restricted" | "denied";
  filesystem?: "read_only" | "workspace_write" | "full";
  requiresApproval?: boolean;
  allowedCapabilities?: ScoutId[];
  maxRuntimeMs?: number;
}
```

The broker SHOULD resolve these into an environment profile or return an
actionable error explaining the missing capability.

## Placement Record

Each routed work item SHOULD record placement:

```ts
export interface ScoutExecutionPlacement {
  id: ScoutId;
  subjectKind: "invocation" | "work_item" | "session";
  subjectId: ScoutId;
  environmentId: ScoutId;
  selectedAt: number;
  selectedBy: "broker" | "operator" | "policy";
  constraints: ScoutExecutionConstraints;
  compatibility: {
    satisfied: boolean;
    warnings: string[];
    unsupported: string[];
  };
}
```

This record gives later surfaces a clear answer to "where did this run and why?"

## Lifecycle

Environment lifecycle should use explicit states:

| State | Meaning |
|---|---|
| `available` | Can receive work. |
| `starting` | Being created or attached. |
| `ready` | Ready for a specific task or session. |
| `busy` | Currently assigned. |
| `draining` | Finishing current work but not accepting new work. |
| `stopped` | No longer running. |
| `failed` | Could not start, attach, or continue. |
| `unknown` | Adapter cannot currently prove state. |

Cleanup and retention should be environment-specific but broker-visible.

## Relationship To Permissions

Execution environments are not permission policies. They are enforcement
surfaces that may satisfy a policy.

SCO-022 defines permission and sandbox policy. This proposal defines the
environment record that policy can target and that runtime adapters can report.

## Non-Goals

- making any container runtime mandatory
- requiring external sandboxes for ordinary local usage
- proving hardened multi-tenant isolation in v1
- replacing harness-native session lifecycle
- storing provider credentials in environment records
- turning observed harness transcripts into Scout-owned messages

## Implementation Sequence

1. Add protocol types for environment profiles, constraints, placement, and
   lifecycle.
2. Register current local sessions as `local_session` profiles.
3. Register new worktree execution as `local_worktree`.
4. Report placement from `ask` and session start paths.
5. Add diagnostics to show enforcement fields and warnings.
6. Add container and external sandbox adapters later behind the same profile
   shape.

## Acceptance Criteria

- Scout can explain which environment an invocation or session used.
- The environment profile distinguishes trusted local execution from stronger
  isolation.
- Unsupported constraints produce actionable errors.
- Enforcement claims are adapter-reported and visible.
- The model works without a hosted control plane or mandatory container
  backend.
