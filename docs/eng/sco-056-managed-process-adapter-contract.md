# SCO-056: Managed Process Adapter Contract

## Status

Proposed.

## Proposal ID

`sco-056`

## Intent

Define a Scout-native contract for wrapping external agent executables as
managed runtime sessions.

The borrowed idea is process wrapping for coding agents: start an executable,
communicate over a structured stdio protocol, keep or stop the session by
policy, mediate workspace access, and surface permission prompts. The Scout
version is a harness adapter contract, not a new canonical agent runtime.

## Context

Scout integrates with concrete harnesses such as Codex and Claude Code, and it
should keep adding harnesses without forking the broker protocol for each one.
Some future integrations will be normal long-lived local processes rather than
host app sessions or transcript tails.

The runtime needs a generic way to describe:

- how to start the process
- which protocol it speaks
- how session lifecycle works
- how file and workspace access is mediated
- how approvals and permission prompts surface
- how output becomes observed session events
- how failures and restarts are diagnosed

This should fit the existing architecture: broker owns coordination records,
runtime owns session lifecycle, adapters observe harness material.

## Decision

Scout SHOULD define a managed process adapter contract.

A managed process adapter starts and supervises an external executable that can
receive tasks and emit structured updates. The adapter maps that process into
Scout's session, endpoint, invocation, flight, attention, and observed event
models.

The adapter MAY speak an existing protocol such as ACP if product pressure
exists. Scout should still define its own adapter boundary so ACP, MCP stdio,
OpenAI-compatible local processes, and Scout-native JSONL processes can be
handled consistently.

Current implementation note: `@openscout/agent-sessions` includes a concrete
ACP stdio client adapter for launching ACP agents as subprocess-backed sessions.
This proposal still defines the broader managed-process profile and runtime
contract that should make ACP, MCP stdio, and Scout-native process adapters
inspectable through one common configuration surface.

## Principles

1. The broker does not spawn arbitrary processes directly; runtime adapters do.
2. Process configuration is explicit and inspectable.
3. Workspace access should be declared, mediated, and reported.
4. Permission prompts become Scout attention only when the adapter can observe
   or receive them.
5. Process output is observed harness material unless Scout authored the
   message or invocation.
6. Long-lived process state is harness-owned; Scout records lifecycle and
   references.
7. Failures must include remediation: missing executable, bad cwd, protocol
   mismatch, timeout, permission denied, or unhealthy process.

## Managed Process Profile

```ts
export interface ScoutManagedProcessProfile {
  id: ScoutId;
  displayName: string;
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  protocol: ScoutManagedProcessProtocol;
  persistence: "per_request" | "per_session" | "daemon";
  workspace: ScoutManagedWorkspacePolicy;
  permissions: ScoutManagedProcessPermissionPolicy;
  health: ScoutManagedProcessHealthPolicy;
  provenance: ScoutManagedProcessProvenance;
  enabled: boolean;
}
```

```ts
export type ScoutManagedProcessProtocol =
  | "scout_jsonl"
  | "acp_stdio"
  | "mcp_stdio"
  | "openai_compatible_http"
  | "custom";
```

The `custom` value is allowed only when an adapter package owns the mapping and
reports its capabilities.

## Workspace Policy

```ts
export interface ScoutManagedWorkspacePolicy {
  root: string;
  mode: "read_only" | "workspace_write" | "worktree_write" | "copy_write" | "full";
  fileAccess:
    | "process_native"
    | "adapter_mediated"
    | "broker_gated"
    | "none";
  allowedPaths?: string[];
  deniedPaths?: string[];
  maxWriteBytes?: number;
}
```

The policy describes what Scout expects and what the adapter can enforce. The
UI must distinguish `process_native` from `broker_gated`; advisory filesystem
constraints are not isolation.

## Permission Policy

```ts
export interface ScoutManagedProcessPermissionPolicy {
  approvalIngress:
    | "none"
    | "protocol_native"
    | "adapter_intercepted"
    | "host_forwarded";
  defaultDecision: "deny" | "ask" | "allow";
  supportedActions: Array<"read_file" | "write_file" | "run_command" | "network" | "use_secret">;
  unblockRequestKind?: "approval" | "permission";
}
```

If a process has permission prompts that happen outside the adapter protocol,
Scout must label them as not observable unless a host integration forwards them.

## Session Lifecycle

Managed process sessions SHOULD map to existing session states:

| Process event | Scout session state |
| --- | --- |
| configured | `registered` |
| spawn requested | `waking` |
| handshake complete | `idle` |
| task accepted | `working` |
| prompt waiting | `working` plus attention item |
| process exited intentionally | `stopped` |
| process crashed | `failed` |
| health unknown after restart | `stale` |

The adapter should record the process pid when local, start time, protocol
version, and last health result. It should not treat pid as the durable session
identity.

## Task Dispatch

When the broker routes an invocation to a managed process endpoint:

1. Runtime resolves the profile and starts or reuses the process.
2. Runtime performs protocol handshake.
3. Runtime sends a structured task envelope.
4. Adapter maps process updates into observed session events and flight updates.
5. Adapter reports terminal result, failure, or waiting state.
6. Broker records Scout-owned lifecycle facts.

The process protocol may carry richer data, but the adapter boundary should
project it into Scout's common types.

## Observed Events

Managed process adapters SHOULD emit canonical observed events from SCO-042:

- assistant output
- tool calls
- command execution
- file changes
- approvals or permission prompts
- usage
- errors
- terminal state

Raw protocol frames can be retained in a bounded adapter log for debugging, but
they should not become Scout-owned messages by default.

## Security Posture

This proposal does not make arbitrary process execution safe. It makes process
execution explicit.

The first implementation should require an operator-created profile or a
project-local trusted config file. Agents should not be allowed to register new
managed process profiles that execute arbitrary commands without operator
approval.

## Non-Goals

- replacing Codex or Claude-specific adapters
- requiring all process agents to speak ACP
- providing hardened sandboxing by configuration alone
- storing secret values in process profiles
- importing process transcripts as Scout messages
- allowing agents to create arbitrary executable profiles silently

## Implementation Sequence

1. Add protocol types for managed process profiles and adapter capability
   reports.
2. Add runtime validation for command, cwd, protocol, and workspace policy.
3. Implement an echo `scout_jsonl` adapter as a deterministic fixture.
4. Map process lifecycle into existing session and endpoint state.
5. Map protocol updates into SCO-042 observed events.
6. Add permission prompt ingress into durable unblock requests where the
   protocol supports it.
7. Align the existing ACP stdio adapter with the managed-process profile once
   the generic contract is proven.

## Acceptance Criteria

- A managed process profile can be inspected before use.
- Runtime can start, health-check, and stop a managed process session.
- Missing executable, bad cwd, protocol mismatch, and crash failures produce
  actionable diagnostics.
- Process updates appear as observed events without becoming Scout-owned
  transcript messages.
- Permission prompts only appear in Scout when the adapter can actually observe
  them.
- The contract can support an ACP stdio adapter without making ACP the broker
  protocol.

## Relationship To Other Proposals

- [`docs/runtime-sessions.md`](../runtime-sessions.md) defines session and
  endpoint lifecycle.
- [`sco-042`](./sco-042-harness-event-normalization-and-replay-boundary.md)
  defines observed event mapping.
- [`sco-043`](./sco-043-execution-environment-contracts.md) defines execution
  environment placement and enforcement reporting.
- [`sco-044`](./sco-044-operator-attention-policy-and-progress-monitoring.md)
  and [`docs/operator-attention-and-unblock.md`](../operator-attention-and-unblock.md)
  define operator attention and unblock behavior.
