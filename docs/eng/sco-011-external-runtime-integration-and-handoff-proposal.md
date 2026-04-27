# SCO-011: External Runtime Integration and Handoff

## Status

Proposed.

## Proposal ID

`sco-011`

## Intent

Define an optional external runtime support model for OpenScout that lets Scout
talk to, observe, and eventually hand off work to external agents without
making the remote runtime the source of truth for OpenScout identity, routing,
or persistence.

The primary target is not "rewrite Scout around a remote runtime."

The primary target is:

- let Scout interoperate with external agents and runtimes
- support a practical BYOK path using custom addresses and credentials
- preserve broker-owned identity, conversation, work, and authority semantics
- create a path from simple API-server integration to deeper session parity and
  hosted handoff later

This proposal is about adding a supported external runtime target and compat
surface. It is not a proposal to replace the broker or to make any specific
hosting provider mandatory.

## Problem

OpenScout can already reason well about:

- broker-owned actor identity
- broker-owned conversation and work records
- delivery and invocation lifecycle
- live session trace through `@openscout/agent-sessions`
- external systems at the integration boundary

But it does not yet have a clean way to support an external runtime from that
model.

Three concrete gaps show up.

1. **There is no external runtime harness or transport in the protocol.**
   Today `AgentHarness` only includes local and bridge-style runtimes.
2. **Managed session support is still local-session shaped.**
   The current runtime path is centered on local session transports rather than
   an external agent runtime with its own session API.
3. **There is no explicit handoff posture for hosted agent runtimes.**
   Scout has an integration boundary, but it does not yet name the progression
   from "external runtime I can call" to "runtime I can observe" to "runtime
   I can delegate work into."

That creates practical product friction:

- the external runtime can only be treated as bespoke glue code
- there is no first-class BYOK story for a remote API-server target
- Scout cannot yet normalize remote sessions, events, artifacts, and approvals
  into its own observability model
- any future support risks leaking remote-native concepts into the broker
  without a clear boundary

## Existing Constraints

OpenScout already has architectural rules this proposal must preserve:

- the broker remains canonical for actor identity, conversation identity,
  routing, and durable local state
- external platform work belongs in the integration layer described in
  `SCO-006`
- live session capability belongs in `@openscout/agent-sessions` as described
  in `SCO-003`
- runs, recipes, and wake behavior should remain Scout-owned primitives rather
  than becoming side effects of an external framework

This proposal must not quietly turn Scout into:

- a thin shell over an external runtime
- a product whose canonical state lives in remote sessions
- a system that requires a specific cloud provider for ordinary local use

## Decision

OpenScout SHOULD support external runtimes in three progressively stronger
modes.

### 1. Runtime Integration

Scout can talk to a remote runtime as an external agent service through the
integration boundary.

This mode SHOULD support:

- custom API-server addresses
- custom credentials or tokens
- starting or attaching to remote sessions
- sending user turns
- receiving streamed responses and terminal results
- reading explicit artifact and state outputs when needed

This is the minimum viable support level and SHOULD be the first milestone.

### 2. Session Capability Adapter

Scout can expose remote-backed sessions through `@openscout/agent-sessions` as
a first-class observable session type.

This mode SHOULD support:

- normalized turn and block trace
- tool-call and tool-result rendering
- state and artifact updates as typed side effects
- typed write-backs such as `sendTurn`, `interrupt`, and later `answer` or
  `decide` when the remote path supports them cleanly

This is the mode that gives trace parity with existing Scout-observable agents.

### 3. Handoff Target

Scout can project a piece of work into a remote-hosted runtime for delegated
execution while preserving Scout provenance and authority rules.

This mode SHOULD support:

- launching or addressing a target remote agent deployment
- linking a Scout `run`, `work_item`, or invocation to the delegated work
- ingesting progress, outputs, artifacts, and terminal state back into Scout
- keeping the handoff scope explicit rather than silently transferring product
  authority

This is the largest mode and SHOULD come after the first two.

## Why External Runtimes Are Interesting

External runtimes are credible targets because they often have several
primitives Scout cares about:

- `Session`, `State`, and `Event` as explicit runtime concepts
- artifact support for non-text outputs
- agent-tool and multi-agent composition
- API-server based integration and deployment paths
- broader deployment options including self-hosted containers and managed
  hosting

That said, not every runtime concept should become a Scout primitive.

Especially important caveats:

- graph workflows and human input are promising, but parts of that surface may
  still be maturing
- hosted deployment is useful, but it should not become the only story
- peer-to-peer agent protocols are interesting, but they are not required for
  the first Scout integration milestone

## Design Principles

1. Scout remains broker-first.
2. External support is optional, but first-class when enabled.
3. BYOK should come before Scout-managed hosting assumptions.
4. API-server integration should come before deeper hosted-runtime handoff.
5. Session parity must be earned through explicit event mapping, not assumed.
6. Remote state and artifacts may enrich Scout, but must not replace Scout
   truth.
7. Alpha-only workflow features should not be mandatory for v1 support.
8. Compatibility should be layered so Scout can stop at the smallest useful
   level.

## Goals

- support external runtimes from Scout's current architecture without breaking
  the broker-first model
- define a clear progression from integration to session observability to
  delegated handoff
- support a practical BYOK path using custom addresses and credentials
- preserve one canonical Scout model for identity, routing, work, and runs
- make external support land in the right architectural seams rather than as
  bespoke glue

## Non-Goals

- replacing the broker with remote sessions or state
- requiring a specific cloud provider for Scout users
- adopting every external feature in the first implementation
- making remote workflow semantics the canonical Scout workflow model
- forcing peer-to-peer protocols or graph workflows into the first milestone
- assuming Scout and the external runtime must share one exact trace model

## Terminology

| Term | Meaning |
|---|---|
| **External runtime** | A server or deployment that can run one or more agents |
| **External session** | The conversation/runtime state container managed by the remote runtime |
| **Integration mode** | Scout talks to the remote runtime over an API without full native trace parity |
| **Session adapter** | A Scout adapter that maps remote events into `@openscout/agent-sessions` |
| **Handoff** | A bounded Scout delegation of execution into the remote runtime |
| **BYOK** | User-supplied address, domain, token, or deployment credentials |

## Proposed Architecture

### 1. Protocol Additions

Scout SHOULD add an external-runtime-aware harness and transport story.

Suggested additions:

- `AgentHarness`: add `external_runtime`
- `AgentEndpoint.transport`: add `runtime_api_server`
- optional later transport: `runtime_peer_protocol`

Suggested endpoint metadata:

- `appName`
- `deploymentKind`: `local`, `self_hosted`, `managed_hosted`
- `externalSessionId`
- `runtimeUserId`
- `artifactSupport`
- `stateSupport`
- `streamSupport`

The protocol should describe what the endpoint is capable of rather than
assuming every deployment supports the same optional features.

### 2. Runtime Integration Path

The first implementation SHOULD target the remote API-server posture.

Why:

- it is the most portable path
- it works for local development and BYOK hosting
- it does not require Scout to start with a specific managed infrastructure
- it keeps the integration boundary explicit

Recommended initial behavior:

- Scout stores an endpoint binding with base URL plus auth material
- Scout creates or resumes a remote session when needed
- Scout sends turns to the target remote agent
- Scout consumes stream events and final outputs
- Scout records the delegated activity as Scout-owned invocation and run
  projections rather than treating the remote session as canonical product truth

### 3. Session Mapping

The session adapter SHOULD translate remote runtime concepts into Scout's
existing session capability model.

Suggested mapping:

| Remote concept | Scout concept |
|---|---|
| `Session` | observable session backing a Scout agent endpoint |
| `Event` | normalized session event / trace block input |
| `invocation_id` | per-turn or per-run linkage identifier |
| `state_delta` | typed session-side state update, and possibly run/context projection |
| `artifact_delta` or artifact save | artifact event plus attachment/reference |
| tool request / tool result | tool call and tool result trace blocks |
| terminal event | turn completion / session idle transition |

The rule is:

- Scout may observe and project remote state
- Scout must not confuse projected remote state with canonical broker-owned
  state

### 4. Context And State Projection

Scout needs a deliberate policy for what crosses from Scout into the remote
runtime.

Recommended split:

- Scout-owned canonical identity stays in Scout
- Scout projects selected prompt context, runtime context, and work/run inputs
  into the remote session
- remote session state is treated as runtime-local working state unless Scout
  explicitly imports part of it back
- artifacts are imported by reference or copy according to policy

This lines up well with the context-block direction in `SCO-008`.

### 5. Handoff Model

When Scout delegates work into the remote runtime, the handoff scope should be
explicit.

Recommended handoff shapes:

- `invoke`: send one turn to a remote session and await output
- `attach`: bind Scout to an existing remote session for observation or
  continued interaction
- `delegate_run`: launch a remote-backed execution for a specific Scout run or
  work item

Required guardrails:

- Scout remains the source of truth for who requested the work
- Scout remains the source of truth for work ownership and provenance
- remote runtime identifiers are linked, not substituted for Scout IDs
- any authority transfer must be explicit, bounded, and reversible

### 6. Deployment Posture

This proposal SHOULD support multiple deployment postures using one protocol.

#### BYOK First

The user can point Scout at:

- a local API server
- a self-hosted container
- a managed hosted deployment
- a later peer protocol target if the runtime contract is suitable

What matters is that Scout accepts:

- custom base URL
- custom auth token or equivalent credentials
- deployment metadata that helps Scout describe and reason about the endpoint

#### Scout-Managed Hosting Later

If Scout later offers a more turnkey hosted path, that should come after BYOK
support proves out the runtime contract.

This keeps the first milestone honest:

- define the contract first
- productize hosting posture later

## Human In The Loop And Workflow Scope

External runtimes often have interesting workflow and human-input features, but
Scout should be careful about the maturity boundary.

Recommended policy:

- do not require graph workflows for first integration
- do not make human-input nodes a prerequisite for Scout approval support
- treat workflow and HITL features as optional enrichments until the stable
  surface is clearer

In practice:

- Scout can still support message turns, tool traces, artifacts, and delegated
  runs without adopting remote workflow semantics wholesale

## Relationship To Other Proposals

### SCO-006 Integration Boundary

External runtime support belongs at the integration boundary first.

This proposal depends on `SCO-006` for the main authority rule:

- external runtimes may classify, normalize, and execute
- they must not become the source of truth for Scout routing, identity, or
  invocation policy

### SCO-003 Agent Sessions

If Scout wants first-class observability for remote sessions, the adapter
belongs in `@openscout/agent-sessions`.

That means remote support should not invent a second trace protocol. It should
either:

- map cleanly into the existing session capability contract
- or stay at the looser integration layer until it can

### SCO-007 Runs

The cleanest long-term handoff target is a Scout `run`, not a bare chat turn.

This proposal becomes much stronger once Scout has a durable execution plane to
link delegated work against.

### SCO-008 Context Blocks And Skills

Remote sessions will need projected context. `SCO-008` is the natural place for
that context to come from.

## Recommended Implementation Order

### Phase 1: BYOK Runtime Integration

Ship the smallest useful path:

- configure an endpoint by URL plus credentials
- create or resume sessions
- send turns
- stream outputs
- record result summaries and references back into Scout

This proves the boundary and the auth/deployment posture.

### Phase 2: Session Adapter

Add first-class session observability:

- `external_runtime` harness kind
- `runtime_api_server` transport
- event-to-trace mapping in `@openscout/agent-sessions`
- artifact and state projection hooks

This proves that the remote runtime can feel native inside Scout's trace
surfaces.

### Phase 3: Delegated Run Handoff

Once Scout has stronger run and wake primitives:

- allow a Scout run or work item to delegate into the remote runtime
- persist linkage and status
- support resumable observation and completion import

This proves a real compat mode rather than just remote chat.

## Open Questions

1. Should `external_runtime` be modeled as a harness, an integration type, or
   both?
2. How much of remote `state` should remain runtime-local versus imported into
   Scout projections?
3. What is the cleanest artifact policy: copy into Scout blobs, reference by
   URL, or hybrid?
4. Which human-input or approval cases can be mapped cleanly today without
   depending on immature workflow features?
5. Should a later peer protocol be a compatibility lane, or is HTTP API-server
   integration sufficient for the first year of support?

## Working Recommendation

The best near-term move is:

- support an external runtime through a BYOK API-server integration first
- add a session adapter second
- defer hosted handoff posture until Scout has stronger run-level delegation
  primitives

That order gives Scout the most learning with the least architectural risk.
