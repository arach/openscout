# SCO-022: Sandboxing And Cross-Harness Permission Model

## Status

Proposed.

## Proposal ID

`sco-022`

## Intent

Define a broker-owned permission and sandbox model for OpenScout that can span
Codex, Claude, future harnesses, local project fabric execution, containers,
and external sandboxes without turning any one harness or container backend into
the product authority.

The target behavior is:

```text
human intent -> Scout policy -> resolved execution profile -> harness/container/sandbox enforcement -> observable lifecycle
```

OpenScout should be able to answer:

1. What permissions did this agent have?
2. Where did it run?
3. Which sandbox or container enforced those limits?
4. Which approvals were required or granted?
5. What evidence proves the policy was applied?

The first implementation target SHOULD be Codex because the current Codex paths
already expose explicit sandbox and approval knobs, while Scout-owned Codex
launches still commonly run with permissive defaults such as
`approvalPolicy: "never"`, `sandbox: "danger-full-access"`, or the legacy
`--dangerously-bypass-approvals-and-sandbox` exec path.

The long-term target is broader: permissions become a Scout policy model, and
harness-specific flags become one enforcement adapter behind that model.

## Problem

OpenScout is becoming a control plane for work that can happen across local
worktrees, always-on machines, rented instances, external sandboxes, containers,
and cross-harness agent sessions. The current permission story is still too
low-level for that role.

Specific gaps:

1. **Harness permissions are launch details.**
   Codex, Claude, and other runtimes expose different switches, config keys, or
   approval flows. Scout does not yet have one durable concept that says what
   an agent was allowed to do.
2. **Sandbox posture is not a routing input.**
   The broker can choose agents and endpoints, but it cannot yet say "this task
   must run in a workspace-write sandbox" or "this task requires an external
   isolated environment."
3. **Approvals are session events, not policy decisions.**
   SCO-005 gives OpenScout a trace surface for approvals. It does not yet tie
   those approvals to a durable permission grant or policy evaluation.
4. **External sandboxes are not first-class fabric targets.**
   Scout can route across machines and external runtimes, but it does not yet
   model a sandbox provider as a place where project work can be placed,
   observed, paused, resumed, snapshotted, and destroyed.
5. **Local execution is either too trusted or too bespoke.**
   Running locally should remain the default, but local does not have to mean
   unrestricted access to the user's whole machine.
6. **Container support needs a common boundary.**
   Docker, Podman, Lima/colima-style setups, Apple container technology, and
   future lightweight local container runners should all be possible without
   leaking their native schemas into the broker.
7. **Cross-harness compatibility can create false equivalence.**
   If one harness can enforce a native read-only sandbox and another can only
   receive a prompt instruction, Scout must not present those as the same
   security posture.

The missing piece is a policy plane that is independent of any one execution
backend, plus enforcement adapters that honestly report what was enforced.

## Existing Constraints

This proposal builds on existing OpenScout direction:

- The broker remains canonical for local state, routing, messages,
  invocations, flights, and collaboration records.
- The runtime remains the layer that starts, resumes, stops, and health-checks
  sessions across harnesses.
- Harness adapters own harness-specific startup, resume, event mapping, and
  tool behavior.
- SCO-005 makes session approvals observable through the trace surface.
- SCO-011 keeps external runtime integration optional and broker-first.
- SCO-013 names trusted environments as first-class runtime surfaces.
- SCO-014 moves routing, caller context, and delivery decisions into broker
  APIs.
- SCO-021 keeps mesh and cloud rendezvous optional, with local operation as the
  base case.

The permission model MUST preserve those boundaries. It must not make Docker,
Apple containers, Codex, Claude, a cloud sandbox provider, or a hosted control
plane the source of truth for Scout authority.

## Decision

OpenScout SHOULD introduce a first-class permission and sandbox model with three
layers:

1. **Policy intent**
   A Scout-owned record describing allowed capabilities, required approvals,
   environment constraints, expiration, and provenance.
2. **Execution placement**
   A broker/runtime decision that selects a local process, local fabric
   workspace, container, or external sandbox capable of satisfying the policy.
3. **Enforcement adapter**
   A harness, container, or sandbox adapter that applies the closest native
   controls and reports the actual enforcement level back to Scout.

The broker SHOULD own policy evaluation and durable grants. The runtime SHOULD
own process/container/sandbox lifecycle. Harness and provider adapters SHOULD
own native enforcement details.

Codex SHOULD be the first concrete adapter because it exposes sandbox and
approval configuration through the current app-server and CLI surfaces. Claude
and other harnesses SHOULD participate through the same policy contract even
when their first enforcement level is weaker or container-backed.

## Design Principles

1. Policy is a Scout primitive; harness flags are compiled output.
2. Local-first still means safe-by-default.
3. Strong enforcement must be distinguished from advisory enforcement.
4. Compatibility is useful only when the enforcement level is honest.
5. The broker authorizes; the runtime executes.
6. External sandboxes are execution fabric, not canonical Scout state.
7. Containers are one enforcement backend, not the only sandbox story.
8. Approvals should create durable grants with scope and expiration.
9. Every permission-sensitive action should leave auditable evidence.
10. Migration must be incremental because existing managed agents are
    permissive today.

## Goals

- define one cross-harness permission policy model
- make sandbox posture a broker-visible execution constraint
- use Codex sandbox and approval knobs as the first implementation slice
- support Claude and other harnesses through declared adapter capability
- model local project fabric execution separately from unrestricted host access
- support containers, including Apple container technology on macOS, through a
  backend-neutral runner interface
- connect external sandboxes as OpenScout fabric targets without making them
  the source of truth
- make lifecycle, approvals, denials, grants, and cleanup observable
- give the broker enough information to route work to an environment that can
  satisfy the requested policy

## Non-Goals

- replacing harness-native permission systems
- requiring containers for ordinary local Scout use
- requiring a cloud sandbox provider
- making any one container runtime mandatory
- proving hard multi-tenant security for arbitrary untrusted code in the first
  milestone
- preventing a local human from deliberately bypassing policy on their own
  machine
- storing long-lived sandbox provider credentials in ordinary broker metadata
- solving production deploy authorization in this proposal

## Terminology

| Term | Meaning |
|---|---|
| **Permission policy** | Scout-owned rule set describing allowed actions, approval gates, environment constraints, and expiry |
| **Grant** | A durable authorization decision created by policy, approval, or operator action |
| **Capability** | A named permission unit such as file write, command run, network egress, secret read, or broker write |
| **Execution profile** | The resolved launch configuration produced by compiling policy for a target harness or sandbox |
| **Sandbox** | Any bounded execution environment that restricts filesystem, network, process, credential, or broker access |
| **Project fabric** | The set of local and remote execution surfaces available to a project |
| **Local fabric** | Project execution surfaces on the user's machine, including worktrees, copied workspaces, local harnesses, and local containers |
| **External sandbox** | A remote or provider-backed execution environment attached to Scout through a fabric connector |
| **Container runner** | Backend-neutral runtime wrapper for Docker, Podman, Apple containers, or future local container systems |
| **Enforcement level** | The declared strength of policy application: native, container, external, broker-gated, advisory, or unsupported |

## Permission Model

Scout SHOULD model permissions as durable policy records, not as scattered
launch args.

A possible protocol shape:

```ts
export type ScoutPermissionDecision =
  | "allow"
  | "deny"
  | "require_approval"
  | "require_sandbox"
  | "require_stronger_enforcement";

export type ScoutEnforcementLevel =
  | "native"
  | "container"
  | "external_sandbox"
  | "broker_gated"
  | "advisory"
  | "unsupported";

export interface ScoutPermissionPolicy {
  id: ScoutId;
  version: number;
  displayName: string;
  appliesTo: {
    agentIds?: ScoutId[];
    harnesses?: AgentHarness[];
    projectRoots?: string[];
    channels?: string[];
    requesterIds?: ScoutId[];
  };
  capabilities: ScoutPermissionCapabilityRule[];
  environment: ScoutEnvironmentConstraint;
  approvals: ScoutApprovalRule[];
  expiresAt?: number;
  provenance: "default" | "project_config" | "operator" | "broker_generated";
  metadata?: MetadataMap;
}
```

Capabilities SHOULD be named at the Scout layer before they are compiled into
backend-specific controls:

| Capability | Examples |
|---|---|
| `fs.read` | Read project files, docs, generated artifacts |
| `fs.write` | Modify files in a scoped workspace |
| `command.run` | Run shell commands or package scripts |
| `process.spawn` | Start long-lived subprocesses |
| `network.egress` | Call external HTTP services |
| `network.listen` | Open a local port |
| `secrets.read` | Access tokens, environment secrets, keychain-backed material |
| `git.write` | Create commits, tags, or branches |
| `git.remote_write` | Push or mutate remotes |
| `broker.read` | Read broker records beyond the current conversation |
| `broker.write` | Create messages, work items, grants, or routing changes |
| `fabric.create` | Create a local fabric workspace, container, or external sandbox |
| `fabric.destroy` | Destroy or garbage-collect execution environments |

Policy decisions SHOULD be made before launch when possible and during trace
execution when native approvals or broker-gated actions require it.

## Policy Profiles

OpenScout SHOULD ship a small number of understandable default profiles before
it exposes a fully custom policy editor.

| Profile | Intended use |
|---|---|
| `observe` | Read-only repo inspection, broker reads scoped to the task, no command mutation |
| `review` | Read files and run low-risk commands, write nothing without approval |
| `workspace_write` | Read/write only inside the project workspace, approval for risky commands |
| `sandboxed_write` | Work inside an isolated local fabric workspace or container |
| `trusted_local` | Current permissive local behavior, explicit and auditable |
| `external_sandbox` | Place work into a remote sandbox that satisfies declared constraints |

The important migration rule is that permissive behavior must be named. If a
managed agent is allowed to run with broad host access, the UI and metadata
should say so.

## Sandbox Classes

Scout SHOULD distinguish sandbox classes by their boundary and enforcement
strength.

### 1. Harness-Native Sandbox

The harness itself enforces filesystem, network, command, or approval policy.
Codex is the first target for this class.

Examples of compiled Codex posture:

| Scout profile | Codex posture |
|---|---|
| `observe` | read-oriented sandbox, no write grants, no broad approval bypass |
| `workspace_write` | workspace-scoped sandbox plus approval policy for escalations |
| `trusted_local` | explicit `danger-full-access` only when policy allows it |

The adapter MUST record the native sandbox and approval settings it requested,
then reconcile them with observed runtime metadata such as Codex turn context
when available.

### 2. Local Fabric Workspace

Scout creates a bounded workspace for a task without necessarily using a
container.

Possible implementations:

- temporary worktree from the current branch
- copied workspace with selected files
- overlay directory with generated patches
- mounted artifact directory for outputs

This is useful when the main risk is accidental project mutation rather than
arbitrary code execution. It is also the simplest local bridge to external
sandbox workflows because diffs and artifacts can be reconciled back into the
source workspace.

### 3. Container Sandbox

Scout runs the harness or task executor inside a local container.

The container runner SHOULD be backend-neutral. Supported backends MAY include:

- Docker-compatible engines
- Podman-compatible engines
- lightweight macOS VM/container stacks
- Apple container technology where available
- future OpenScout-managed runners

The broker should not store Dockerfiles, Apple container descriptors, or vendor
native schemas as canonical protocol. It should store normalized constraints:

- image or base environment reference
- mounted project paths
- read/write mount policy
- network mode
- environment and secret policy
- CPU, memory, and time limits
- artifact export paths

Backend-native details belong in runtime/provider metadata.

### 4. External Sandbox

An external sandbox is a provider-backed execution surface attached to
OpenScout through the project fabric.

The broker MAY know:

- environment id
- provider kind
- reachability status
- declared capabilities
- policy compatibility
- artifact and diff references
- active sessions and flights linked to the sandbox

The broker MUST NOT treat the external sandbox as canonical for conversations,
agent identity, work items, or policy. The external sandbox is a place where
work runs, not the place where Scout truth lives.

## OpenScout Project Fabric

The project fabric is the project-scoped inventory of execution surfaces.

For one project, the fabric might include:

- the user's active local worktree
- a clean local worktree for review
- an ephemeral local workspace for risky edits
- a local container with dependencies preinstalled
- a remote sandbox with larger compute
- a provider-hosted environment for long-running test work
- a peer machine reached through the mesh

Fabric records SHOULD let the broker ask:

1. Which environments exist for this project?
2. Which policies can each environment satisfy?
3. Which harnesses can run there?
4. Which environment is already warm for this agent or branch?
5. What cleanup or reconciliation is pending?

Suggested fabric target shape:

```ts
export interface ScoutFabricEnvironment {
  id: ScoutId;
  projectRoot?: string;
  projectId?: ScoutId;
  kind: "local_host" | "local_workspace" | "container" | "external_sandbox" | "peer_node";
  nodeId: ScoutId;
  provider?: string;
  state: "registered" | "starting" | "ready" | "busy" | "paused" | "failed" | "stopping" | "destroyed";
  supportedHarnesses: AgentHarness[];
  enforcementLevels: ScoutEnforcementLevel[];
  capabilities: string[];
  policyProfileIds: ScoutId[];
  metadata?: MetadataMap;
}
```

Fabric routing SHOULD be explicit enough that a user can say:

```text
run this in a clean local sandbox
run this in the Apple container profile
send the test matrix to the remote sandbox
keep this one on my laptop, read-only
```

The broker then resolves the phrase into an execution profile instead of
putting that policy burden on the agent prompt.

## Local Fabric Execution

Local fabric execution is the default path for early value because it keeps the
system local-first and avoids provider dependencies.

The first local fabric mode SHOULD create a task workspace with:

- source provenance from the project root and branch
- a stable `environmentId`
- an artifact directory
- a cleanup deadline
- optional diff export back to the source project
- a policy profile attached before launch

The runtime can then launch Codex, Claude, or another harness with the task
workspace as `cwd`. That gives Scout a concrete place to limit write scope even
before every harness has native policy parity.

Local fabric execution SHOULD NOT silently mutate the user's primary worktree
unless the policy permits it.

## Codex Integration First

Codex should be the first implementation target for three reasons:

1. OpenScout already has a `codex_app_server` transport.
2. Codex app-server launch and thread requests already accept sandbox and
   approval fields in the current adapter path.
3. Current OpenScout-managed Codex defaults are intentionally permissive and
   therefore give the migration a clear safety win.

Phase-one Codex work SHOULD:

- add Scout policy inputs to the Codex app-server session options
- stop hardcoding `approvalPolicy: "never"` and `sandbox: "danger-full-access"`
  for every managed Codex app-server thread
- preserve explicit `trusted_local` behavior as an auditable opt-in profile
- remove or fence the legacy Codex exec bypass path behind an explicit policy
  profile
- record requested Codex sandbox and approval posture in endpoint metadata
- reconcile requested posture with observed Codex runtime metadata when
  `turn_context` reports sandbox and approval state
- expose denials and approval waits through existing trace approval surfaces

The first Scout-to-Codex compiler can be intentionally small:

| Scout policy input | Codex output |
|---|---|
| sandbox profile | Codex `sandbox` value or config |
| approval profile | Codex `approvalPolicy` value |
| workspace root | `cwd` plus workspace-write configuration |
| trusted local opt-in | explicit full-access mode |
| escalation required | approval mode or broker-visible denial |

Codex launch args SHOULD remain available for advanced users, but policy should
own precedence. If a launch arg weakens the selected policy, the runtime should
reject it or mark the endpoint as policy-incompatible instead of silently
lowering enforcement.

## Claude And Other Harnesses

Claude and future harnesses SHOULD use the same Scout permission records even
when their native controls differ.

Each adapter SHOULD declare:

- supported sandbox classes
- supported approval modes
- whether filesystem limits are native, container-backed, or advisory
- whether network policy can be enforced
- whether command execution can be broker-gated
- whether native approval events can be normalized into the trace surface

For a harness with weaker native enforcement, Scout has two acceptable options:

1. Route the task into a stronger environment such as a local fabric workspace
   or container.
2. Run with an `advisory` enforcement level that is visibly weaker and requires
   an explicit policy decision.

Scout MUST NOT display "workspace-write sandbox" for a harness that is only
receiving a prompt instruction to stay within the workspace.

## Approvals And Grants

Approvals should become policy grants, not only trace UI events.

When an agent requests an action that policy marks as `require_approval`, the
system SHOULD create a grant request with:

- requesting agent
- requester and conversation context
- target environment
- capability being requested
- concrete action details
- risk level
- proposed expiration
- whether the grant is one-shot or reusable

An approval decision SHOULD produce a durable grant record. Native harness
approval events SHOULD be linked to the grant when possible.

Suggested grant shape:

```ts
export interface ScoutPermissionGrant {
  id: ScoutId;
  policyId: ScoutId;
  capability: string;
  subjectAgentId: ScoutId;
  environmentId?: ScoutId;
  invocationId?: ScoutId;
  flightId?: ScoutId;
  decision: "approved" | "denied" | "expired" | "revoked";
  scope: "action" | "turn" | "flight" | "session" | "environment";
  approvedById?: ScoutId;
  createdAt: number;
  expiresAt?: number;
  metadata?: MetadataMap;
}
```

The default grant scope SHOULD be narrow. Broad grants should be possible, but
they should be deliberate and visible.

## Lifecycle And Observability

Sandbox lifecycle should be observable as part of normal Scout state.

OpenScout SHOULD record events for:

- policy selected
- policy compiled
- environment selected
- sandbox starting
- sandbox ready
- harness launched
- action allowed
- action denied
- approval requested
- grant approved or denied
- network or filesystem denial observed
- artifact produced
- diff exported
- sandbox paused
- sandbox resumed
- cleanup scheduled
- sandbox destroyed

A session trace should show policy-relevant context without forcing the user to
read raw logs:

- environment label
- enforcement level
- requested profile
- effective native posture
- pending approvals
- denied actions
- cleanup state

Raw provider logs MAY be retained for debugging, but canonical observability
should be normalized into broker events, trace blocks, flight metadata, and
environment lifecycle records.

## Broker And Control-Plane Implications

The broker needs enough policy awareness to route safely, but it should not
become a container supervisor.

Broker responsibilities SHOULD include:

- storing permission policies and grants
- evaluating policy for delivery and invocation requests
- selecting or requesting compatible fabric environments
- stamping invocations, flights, endpoints, and messages with policy context
- exposing route preview diagnostics when policy prevents a route
- recording lifecycle and policy events
- invalidating or expiring grants
- refusing routes that require stronger enforcement than any available endpoint

Runtime responsibilities SHOULD include:

- creating local fabric workspaces
- starting and stopping containers or external sandbox connectors
- compiling policy into harness launch options
- supervising sandbox lifecycle
- collecting normalized lifecycle events
- exporting artifacts and diffs
- enforcing cleanup

Protocol additions SHOULD be small and additive at first:

- `InvocationExecutionPreference.permissionProfile`
- `InvocationExecutionPreference.environmentId`
- endpoint metadata for `policyId`, `environmentId`, `sandboxId`,
  `enforcementLevel`, and `effectiveSandbox`
- fabric environment records
- permission policy records
- permission grant records
- policy/lifecycle control events

Potential broker APIs:

| Endpoint | Purpose |
|---|---|
| `GET /v1/permissions/policies` | List available policies and default profiles |
| `POST /v1/permissions/evaluate` | Preview policy decision for an invocation |
| `POST /v1/permissions/grants` | Create or answer a grant request |
| `GET /v1/fabric/environments` | List project fabric environments |
| `POST /v1/fabric/environments` | Create or attach an environment |
| `POST /v1/fabric/environments/:id/stop` | Stop or pause an environment |
| `DELETE /v1/fabric/environments/:id` | Destroy and clean up an environment |

The broker should return compact operator-facing receipts such as:

```text
queued for @ranger#codex in sandboxed_write on local-workspace:abc123
waiting for approval: git.remote_write requires operator grant
cannot route: target endpoint only supports advisory enforcement
```

## MVP Phases

### Phase 0: Inventory And Vocabulary

Goal: make current behavior visible before changing defaults.

Requirements:

- Document current Codex and Claude launch permission posture.
- Add adapter capability metadata for sandbox and approval support.
- Record effective Codex app-server sandbox and approval context when observed.
- Mark legacy permissive launches as `trusted_local` or `legacy_unrestricted`.

Exit criteria:

- `scout who` or equivalent diagnostics can show an endpoint's effective
  permission posture.
- Codex session metadata distinguishes requested and observed sandbox posture.

### Phase 1: Codex Policy Compiler

Goal: compile a small Scout policy profile into Codex app-server settings.

Requirements:

- Add policy inputs to Codex session options.
- Replace hardcoded full-access defaults with resolved policy values.
- Keep broad access as explicit `trusted_local`.
- Reject launch args that weaken policy unless the selected policy allows it.
- Link Codex approvals or denials to normalized trace events where available.

Exit criteria:

- A Codex managed agent can run read-only or workspace-write by Scout policy.
- A permissive Codex managed agent is visibly labeled as permissive.
- Tests cover policy-to-Codex option compilation.

### Phase 2: Local Fabric Workspaces

Goal: give Scout a local isolation boundary independent of harness-native
support.

Requirements:

- Create task-scoped local workspaces with provenance and cleanup metadata.
- Launch Codex or Claude with that workspace as `cwd`.
- Export diffs and artifacts back to the source project on request.
- Track cleanup state in broker-visible environment records.

Exit criteria:

- A task can run in a clean local workspace without mutating the source
  worktree.
- The resulting diff can be inspected before apply.
- Cleanup survives broker restart.

### Phase 3: Container Runner

Goal: support stronger local sandbox execution through a backend-neutral
container runner.

Requirements:

- Define a `ContainerRunner` interface in runtime.
- Support at least one local backend.
- Keep backend-native config out of core protocol.
- Mount project workspaces with read/write policy.
- Apply network and secret policy where the backend supports it.
- Model Apple container support as a backend option on macOS when available,
  not as a product dependency.

Exit criteria:

- A Scout invocation can run in a local container environment.
- The broker records environment lifecycle and effective enforcement level.
- Unsupported backend features are reported as unsupported, not silently
  accepted.

### Phase 4: External Sandbox Fabric

Goal: attach remote sandboxes as project fabric targets.

Requirements:

- Add external sandbox provider registration.
- Store provider capabilities and reachability, not canonical work state.
- Launch or attach harness sessions inside the external environment.
- Ingest lifecycle, logs, trace summaries, artifacts, and diffs.
- Keep credentials outside ordinary broker metadata.

Exit criteria:

- A project can list at least one external sandbox environment.
- The broker can route an invocation to it when policy requires external
  isolation.
- Artifacts and terminal state reconcile back into Scout records.

### Phase 5: Cross-Harness Policy UX

Goal: make policy selection understandable across Codex, Claude, and future
harnesses.

Requirements:

- Show policy posture in endpoints, flights, traces, and environment views.
- Surface policy route failures with remediation actions.
- Let operators choose or approve profiles for a task.
- Add adapter conformance checks for enforcement declarations.

Exit criteria:

- Users can tell when a task is native-sandboxed, container-sandboxed,
  external-sandboxed, advisory, or unrestricted.
- Route preview can explain why a task cannot run on a selected endpoint.

## Risks

### False Sense Of Security

The biggest risk is presenting advisory behavior as strong sandboxing. The
model must preserve enforcement level all the way to user-visible receipts.

### Harness Drift

Codex, Claude, and future tools may rename or change permission knobs. Adapter
capability tests and observed runtime reconciliation are required.

### Policy Bypass Through Launch Args

Existing launch args can weaken sandboxing. The runtime must detect conflicts
between user launch args and selected Scout policy.

### Container Backend Complexity

Container runtimes differ in filesystem mounts, networking, UID mapping,
macOS behavior, and resource controls. The first runner interface should be
small and honest about unsupported features.

### Apple Container Availability

Apple container support should improve local macOS ergonomics when available,
but OpenScout should not depend on it for core behavior or assume it exists on
every supported Mac.

### Secret Leakage

Environment variables, logs, model transcripts, artifacts, and provider metadata
can leak secrets even when filesystem writes are sandboxed. Secret access needs
its own capability and redaction path.

### External Sandbox Trust

External sandboxes can be compromised or misconfigured. They must be treated as
remote execution surfaces with scoped credentials, not as trusted extensions of
the local broker.

### Cleanup Failure

Local workspaces and containers can pile up if cleanup is best-effort only.
Lifecycle records need durable cleanup deadlines and retry state.

### Migration Surprise

Changing permissive managed agents to safer defaults can break workflows. The
first release should make posture visible, then make defaults safer with clear
override paths.

## Open Questions

1. What should the default policy be for newly created local agents:
   `workspace_write`, `sandboxed_write`, or `trusted_local` with a warning?
2. Should existing agents be grandfathered into `trusted_local`, or migrated to
   safer profiles after an operator prompt?
3. Which Codex approval policies and sandbox values should map to the initial
   Scout profiles?
4. Should Claude initially rely on local fabric workspaces, containers, or
   advisory policy for write-scoped work?
5. Which local container backend should be first for CI and development tests?
6. Should Apple container support be a first-class backend immediately or a
   follow-up once the generic runner is stable?
7. How should network egress policy be represented before every backend can
   enforce it?
8. Where should provider credentials live on macOS, Linux, and CI?
9. How should policy and grants replicate across mesh peers without granting
   authority to the wrong node?
10. Should grants be scoped to the operator, project, agent, conversation,
    flight, environment, or all of those?
11. What is the minimum UI needed to make policy understandable without turning
    every task into a permissions dialog?
12. How should Scout distinguish test-created containers from user-created
    containers during cleanup?

## Success Criteria

SCO-022 is working when OpenScout can:

- launch a Codex-managed agent with a non-permissive Scout policy
- show the requested and effective sandbox posture for that session
- route a task into a local fabric workspace when primary worktree mutation is
  not allowed
- report when a harness cannot satisfy a requested enforcement level
- create an approval-backed grant with scope and expiration
- list active sandbox environments and clean them up durably
- add a container or external sandbox backend without changing broker authority

