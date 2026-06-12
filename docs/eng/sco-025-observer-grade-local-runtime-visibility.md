# SCO-025: Observer-Grade Local Runtime Visibility

## Status

Proposed.

## Proposal ID

`sco-025`

## Intent

Make OpenScout as good as the local machine can mechanically allow at
read-only runtime visibility.

For local developer pilots, OpenScout should be able to answer:

1. What is this agent doing right now?
2. Which evidence says that?
3. Is the evidence broker-owned, harness-observed, or inferred?
4. How far can I drill down before I reach the raw source?
5. Which controls are actually supported by this harness and this session?
6. Can I attach to the underlying terminal for debugging without confusing
   that with the product session model?

This proposal onboards the useful Scion learnings while preserving OpenScout's
core architecture:

- Scout-owned coordination records remain broker-owned.
- External harness transcripts remain observed source material.
- Trace and activity projections are derived read models.
- Tmux is a current runtime attach transport; broker records remain the primary
  control plane.
- Harness capability detail is explicit, source-attributed, and honest about
  partial support.

## Motivation

OpenScout already has the hard parts:

- broker-owned messages, invocations, flights, deliveries, questions, and work
  items
- agent endpoints with harness and transport metadata
- live session traces through `@openscout/agent-sessions`
- tail adapters for external harness material
- run projections and activity indexing proposals
- a harness catalog and adapter specs

The gap is not that OpenScout lacks data. The gap is that several surfaces still
force operators to infer the runtime story from scattered state:

- endpoint state says whether something is reachable
- flight state says whether a dispatch is running
- run state says what an execution projected to
- pairing/session traces say what blocks and actions happened
- tails and logs show harness-owned evidence
- tmux can expose and control the actual process as a runtime surface

Scion's useful lesson is a clearer operator model:

- platform lifecycle is separate from agent activity
- attach/detach/reattach should be explicit and reliable
- harness feature support should include partial/unsupported states and reasons
- agent role should be separated from harness/runtime mechanics

OpenScout should borrow that clarity without importing Scion's product posture
or making tmux the only center of the system.

## Relationship To Existing SCOs

This SCO extends, but does not replace, prior proposals:

- SCO-003 defines live agent sessions as a mesh capability.
- SCO-005 makes trace the primary product session surface.
- SCO-023 defines durable agent operations and run registry concepts.

SCO-025 adds the read-only observability ceiling above those:

- observed facts from every open-ish local source
- normalized traces and activity evidence
- derived phase/activity/status projection
- terminal attach as an explicit endpoint surface
- feature-level harness capability support

## Decision

OpenScout SHOULD introduce an observer-grade local visibility layer with three
coordinated tracks:

| Track | Purpose |
|---|---|
| Observed status projection | A derived `phase` / `activity` / `detail` read model with provenance and confidence |
| Tmux attach transport | Broker-mediated tmux attach, detach, and reattach metadata for runtime views |
| Harness feature support | Fine-grained `yes` / `partial` / `no` / `unknown` capability truth with reasons and evidence |

The key rule is:

```plaintext
Observation can be ambitious.
Control stays conservative.
```

OpenScout MAY observe everything locally available from open protocols,
open-ish harness files, logs, process state, streams, and terminal surfaces.
OpenScout MUST keep the distinction between observed evidence and Scout-owned
coordination records visible in APIs, docs, and UI.

## Normative Language

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as normative requirements.

## Design Principles

1. **Broker ownership does not limit observation.** The broker remains
   authoritative for Scout-owned coordination records, but the runtime may
   observe any local source that is technically and ethically available.
2. **Projection is not authority.** Derived status is disposable and
   rebuildable. It MUST NOT replace endpoint, flight, run, work item, or trace
   records.
3. **Every projection needs evidence.** A status such as
   `running / executing / bun test` MUST expose source records or observed
   events that explain it.
4. **Confidence matters.** A broker flight has higher confidence than a tail
   inference. UI should be able to distinguish observed from inferred state.
5. **Trace remains the canonical read model.** Tmux and raw logs are current
   endpoint drill-downs, not separate product semantics.
6. **Feature support must be honest.** Unsupported and partially supported
   harness features should be visible with reasons, not hidden behind boolean
   readiness.
7. **Role is not runtime.** Agent role/persona/instructions should remain
   distinct from harness config, runtime placement, and permission posture.
8. **Local-first posture stays explicit.** This is for high-trust local
   developer pilots, not a claim of enterprise observability, compliance, or
   hardened multi-tenant monitoring.

## Non-Goals

- replacing `AgentEndpoint.state`, `FlightRecord.state`, `AgentRun.state`, or
  collaboration record state
- persisting raw external harness transcripts as Scout messages
- turning tmux into the required substrate for agent sessions
- implementing enterprise audit/compliance or tenant isolation
- building a general workflow engine
- requiring every opaque proprietary harness to expose perfect details

## Terminology

| Term | Meaning |
|---|---|
| **Scout-owned record** | A first-party broker record such as message, invocation, flight, delivery, work item, question, endpoint, or run |
| **Observed evidence** | External source material such as harness JSONL, stream events, logs, process state, file signals, or tmux output |
| **Normalized trace** | OpenScout's session/turn/block/action/question/approval representation of runtime behavior |
| **Status projection** | Derived phase/activity/detail read model computed from Scout-owned records and observed evidence |
| **Tmux attach transport** | A terminal attachment path exposed for inspection and control |
| **Harness feature support** | Fine-grained support truth for runtime capabilities, with level, reason, and evidence |
| **Role** | Harness-agnostic behavior package: instructions, system prompt, skills, and defaults |
| **Harness config** | Harness-specific mechanics: binary, launch args, auth mode, model knobs, native files, MCP mapping |
| **Runtime profile** | Execution posture: local/remote placement, cwd/worktree/container, permission profile, wake policy |

## Track 1: Observed Status Projection

### Current State

OpenScout has multiple state planes:

- endpoint reachability: `offline | idle | active | waiting`
- invocation/flight dispatch lifecycle:
  `queued | waking | running | waiting | completed | failed | cancelled`
- run projection lifecycle:
  `queued | waking | running | waiting | review | completed | failed |
  cancelled | unknown`
- work item and question states
- live pairing/session turn and block state
- activity projections and tail events

This is richer than Scion's state model, but less compact for operators.

### Decision

OpenScout SHOULD add a derived status projection shaped like:

```ts
export type ObservedStatusPhase =
  | "unconfigured"
  | "registered"
  | "starting"
  | "connecting"
  | "running"
  | "stopping"
  | "stopped"
  | "closed"
  | "error"
  | "unknown";

export type ObservedActivity =
  | "idle"
  | "queued"
  | "waking"
  | "thinking"
  | "executing"
  | "working"
  | "waiting_for_input"
  | "waiting_on_actor"
  | "blocked"
  | "review"
  | "completed"
  | "failed"
  | "cancelled"
  | "stalled"
  | "offline"
  | "unknown";

export interface ObservedStatusProjection {
  subjectKind:
    | "agent"
    | "endpoint"
    | "flight"
    | "run"
    | "work_item"
    | "pairing_runtime"
    | "tail_session";
  subjectId: string;
  agentId?: string;
  phase: ObservedStatusPhase;
  activity: ObservedActivity;
  detail?: ObservedStatusDetail;
  provenance: StatusProjectionProvenance[];
  confidence: number;
  updatedAt: number;
  staleAt?: number;
}

export interface ObservedStatusDetail {
  title?: string;
  summary?: string;
  toolName?: string;
  waitingOn?: unknown;
  sourceCursor?: string;
}

export interface StatusProjectionProvenance {
  source:
    | "broker_record"
    | "endpoint"
    | "flight"
    | "agent_run"
    | "collaboration_record"
    | "session_trace"
    | "pairing_runtime"
    | "tail_event"
    | "process"
    | "tmux"
    | "staleness_inference";
  refId: string;
  observedAt: number;
  confidence: number;
}
```

### Precedence Rules

Status projection MUST be deterministic.

1. Scout-owned coordination records outrank observed evidence.
2. Human attention states outrank generic working/idle display.
3. Active flights outrank endpoint idle state for task activity.
4. Terminal flight/run states remain sticky until a newer invocation/run exists.
5. Endpoint reachability can change `phase`, but MUST NOT erase a terminal
   execution `activity`.
6. Session trace actions can enrich `detail` when correlated to the subject.
7. Tail events MAY enrich `detail` or low-confidence activity, but MUST NOT
   override broker-owned lifecycle.
8. Stale/offline are platform inferences and MUST carry provenance and expiry.

### Confidence Guidelines

| Source | Suggested Confidence |
|---|---|
| Broker-owned message, invocation, flight, work item | `0.95` to `1.0` |
| Endpoint snapshot or pairing runtime snapshot | `0.80` to `0.95` |
| Run projection from invocation/flight | `0.85` to `0.95` |
| Session trace event with stable session ID | `0.75` to `0.95` |
| Tail event correlated by session/agent/workspace | `0.50` to `0.75` |
| Process or tmux inference | `0.35` to `0.70` |
| Staleness inference | `0.35` to `0.65` |

### Storage Rules

The first implementation SHOULD be a pure read helper over the broker snapshot,
activity items, endpoint state, pairing runtime, session traces, and tail
events.

If persisted later, status projection rows MUST be rebuildable. They MUST NOT
be treated as canonical state.

## Track 2: Tmux Attach, Detach, Reattach

### Current State

OpenScout now treats tmux as a current local runtime transport alongside the
newer structured adapters:

- Codex uses `codex_app_server`.
- Claude uses `claude_stream_json`.
- Tmux-backed agents remain first-class endpoints with attach, detach, and
  reattach semantics.

There are still useful tmux pieces:

- prompt delivery uses tmux buffer paste rather than fragile typing
- stale tmux endpoints can be marked offline
- desktop and web surfaces have some terminal/debug attach paths

The gaps are attach quality and explicit lifecycle:

- no broker-owned debug attach descriptor
- no standard readiness wait before attach
- no explicit detach/reattach metadata
- no attach-count or multi-client state
- some terminal relay command paths should be hardened before expanding usage

### Decision

OpenScout SHOULD expose tmux as a current attach transport through typed
broker-mediated metadata, without changing the broker-owned session model.

Recommended optional endpoint field:

```ts
export interface AgentEndpointDebugTransport {
  kind: "tmux";
  state: "ready" | "starting" | "missing" | "stale" | "error";
  sessionName: string;
  paneTarget?: string;
  cwd?: string;
  attachable: boolean;
  multiAttach: boolean;
  lastProbeAt: number;
  lastAttachAt?: number;
  lastDetachAt?: number;
  activeClients?: number;
  detail?: string;
}
```

Recommended attach plan:

```ts
export interface DebugTmuxAttachPlan {
  endpointId: string;
  transport: "tmux";
  sessionName: string;
  paneTarget?: string;
  command?: ["tmux", "attach-session", "-t", string];
  terminalRelay?: {
    backend: "tmux";
    tmuxSession: string;
  };
}
```

### Debug Routes

Broker routes SHOULD be debug-scoped:

- `GET /v1/debug/tmux/sessions`
- `POST /v1/agents/:agentId/debug/tmux/attach`
- `POST /v1/agents/:agentId/debug/tmux/detach`

These routes return attach/debug metadata. They MUST NOT create conversation
messages from terminal output.

### Tmux Quality Bar

OpenScout SHOULD adopt Scion's practical tmux quality lessons:

- wait/poll for session readiness before attach
- use real PTY attach with `TERM=xterm-256color`
- support resize and terminal reset behavior
- keep paste-buffer delivery for text prompts
- distinguish text delivery from raw key delivery
- optionally use OSC to report active tmux window to a web terminal
- provide an OpenScout-managed tmux profile for sessions OpenScout creates

The managed profile SHOULD cover:

- `escape-time 0`
- sufficient history
- extended keys
- clipboard relay
- RGB/passthrough
- sane mouse behavior
- optional pane/session exit hooks

## Track 3: Harness Feature Support And Role/Profile Modeling

### Current State

OpenScout has:

- coarse `AgentCapability` routing capabilities such as `chat`, `invoke`,
  `deliver`, `review`, and `execute`
- a runtime harness catalog with install/readiness/support booleans
- adapter specs with richer native protocol and normalized surface details
- identity dimensions for workspace, profile, harness, model, and node
- agent revision direction in SCO-023

The missing layer is fine-grained, source-attributed feature support.

### Decision

OpenScout SHOULD add `HarnessFeatureSupport` beside existing route-level
capabilities.

`AgentCapability[]` remains coarse routing/product capability. It SHOULD NOT
grow every low-level harness feature.

Recommended shape:

```ts
export type HarnessSupportLevel = "yes" | "partial" | "no" | "unknown";

export interface HarnessFeatureSupport {
  level: HarnessSupportLevel;
  reason?: string;
  evidence?: HarnessFeatureEvidence[];
  downgrade?:
    | "native"
    | "embedded"
    | "reference_text"
    | "prompt_only"
    | "debug_only"
    | "unsupported";
}

export interface HarnessFeatureEvidence {
  kind: "adapter_spec" | "catalog" | "runtime_check" | "manual" | "upstream";
  ref: string;
}

export interface HarnessFeatureSupportMap {
  prompts?: {
    systemPrompt?: HarnessFeatureSupport;
    agentInstructions?: HarnessFeatureSupport;
    promptFiles?: HarnessFeatureSupport;
    images?: HarnessFeatureSupport;
  };
  session?: {
    start?: HarnessFeatureSupport;
    resume?: HarnessFeatureSupport;
    interrupt?: HarnessFeatureSupport;
    shutdown?: HarnessFeatureSupport;
    concurrentTurns?: HarnessFeatureSupport;
    traceObserve?: HarnessFeatureSupport;
  };
  interaction?: {
    questions?: HarnessFeatureSupport;
    approvals?: HarnessFeatureSupport;
    serverRequests?: HarnessFeatureSupport;
  };
  tools?: {
    command?: HarnessFeatureSupport;
    fileChange?: HarnessFeatureSupport;
    subagent?: HarnessFeatureSupport;
    mcpStdio?: HarnessFeatureSupport;
    mcpSse?: HarnessFeatureSupport;
    mcpStreamableHttp?: HarnessFeatureSupport;
  };
  limits?: {
    maxTurns?: HarnessFeatureSupport;
    maxModelCalls?: HarnessFeatureSupport;
    maxDuration?: HarnessFeatureSupport;
  };
  auth?: {
    apiKey?: HarnessFeatureSupport;
    authFile?: HarnessFeatureSupport;
    oauthToken?: HarnessFeatureSupport;
    localLogin?: HarnessFeatureSupport;
  };
  debug?: {
    tmuxAttach?: HarnessFeatureSupport;
    logs?: HarnessFeatureSupport;
    rawTranscript?: HarnessFeatureSupport;
  };
}
```

### Vocabulary Split

OpenScout SHOULD standardize this vocabulary:

- **Role**: harness-agnostic behavior package: instructions, system prompt,
  skills, defaults.
- **Harness config**: harness-specific mechanics: launch args, binary, auth,
  native files, MCP translation, model knobs.
- **Runtime profile**: placement and execution posture: local process,
  worktree/container/sandbox, permission profile, wake policy.
- **Scout profile**: routeable preset label used in identity, such as
  `@arc.profile:reviewer`. It may point at role defaults, but durable records
  should preserve role, harness config, and runtime profile separately.
- **Agent revision**: immutable composition that actually ran: role, harness,
  model, harness config, runtime profile, permissions, and provenance.

This mirrors Scion's useful role/mechanics split without adopting Scion's Hub
or claim-based governance model.

## Product Surface

OpenScout surfaces SHOULD render three related but distinct layers:

1. **Status**: compact phase/activity/detail with confidence.
2. **Evidence**: source-attributed drill-down into broker records, trace
   blocks, tail events, process facts, or debug terminal attach.
3. **Capability**: what this harness/session can do natively, partially,
   through downgrade, or not at all.

Example:

```json
{
  "phase": "running",
  "activity": "executing",
  "detail": {
    "summary": "bun test packages/runtime"
  },
  "confidence": 0.92,
  "provenance": [
    {
      "source": "session_trace",
      "refId": "session:codex:abc/turn:4/block:cmd-1",
      "observedAt": 1778090000000,
      "confidence": 0.92
    }
  ]
}
```

The UI should be able to answer "why do we think that?" by navigating to the
source evidence.

## Implementation Plan

### Phase 1: Spec And Types

- Add this SCO.
- Add protocol-only projection and feature support types.
- Keep all new fields optional.
- Add tests for status precedence and feature support normalization.

### Phase 2: Pure Read Projection

- Build a pure read helper over:
  - broker snapshot
  - endpoints
  - invocations and flights
  - agent run projections
  - collaboration records
  - activity items
  - session trace snapshots
  - tail events
- Return projection results with provenance and confidence.
- Do not persist projection rows in the first slice.

### Phase 3: Debug Tmux Attach

- Add debug attach descriptors for tmux-backed endpoints.
- Centralize tmux probing/readiness.
- Use `execFile`-style command construction.
- Add readiness wait, detach, and stable reattach semantics.
- Keep the product session open path trace-first.

### Phase 4: Harness Feature Support

- Extend harness catalog entries with optional `featureSupport`.
- Derive initial feature support from adapter specs and built-in catalog facts.
- Surface feature support in `scout doctor`, runtime inventory, and desktop
  shell.
- Hide or downgrade unsupported actions based on feature support.

### Phase 5: Durable Rebuildable Indexes

- If read-time projection becomes expensive, add rebuildable projection rows
  in SQLite.
- Store only projection metadata, source refs, cursors, summaries, confidence,
  and timestamps.
- Do not store raw harness transcripts as Scout messages.

### Phase 6: Agent Operations Link

- When agent revisions and run registry mature, snapshot relevant role,
  harness config, runtime profile, feature support, and observed trace refs
  into run/revision records.
- Keep raw evidence linked by ref/cursor where possible.

## File Anchors

Likely implementation anchors:

- `packages/protocol/src/actors.ts`
- `packages/protocol/src/invocations.ts`
- `packages/protocol/src/agent-runs.ts`
- `packages/runtime/src/agent-run-registry.ts`
- `packages/runtime/src/harness-catalog.ts`
- `packages/runtime/src/broker-daemon.ts`
- `packages/runtime/src/local-agents.ts`
- `packages/runtime/src/tail/types.ts`
- `packages/agent-sessions/src/state.ts`
- `packages/agent-sessions/src/adapters/spec/adapter-spec.v1.schema.json`
- `apps/desktop/src/core/pairing/runtime/runtime-state.ts`
- `apps/desktop/src/app/desktop/shell-probes.ts`
- `apps/desktop/src/app/host/agent-session.ts`
- `packages/web/server/terminal-relay-session.ts`
- `packages/web/client/screens/TerminalScreen.tsx`

Related docs:

- `docs/data-ownership.md`
- `docs/activity-indexing.md`
- `docs/working-status-proposal.md`
- `docs/operator-attention-and-unblock.md`
- `docs/eng/sco-003-agent-sessions-capability-proposal.md`
- `docs/eng/sco-005-trace-first-session-observability-proposal.md`
- `docs/eng/sco-023-agent-operations-and-run-registry.md`

Scion reference anchors in the external checkout:

- `~/dev/scion/pkg/agent/state/state.go`
- `~/dev/scion/pkg/runtimebroker/pty_handlers.go`
- `~/dev/scion/pkg/wsclient/pty.go`
- `~/dev/scion/pkg/api/harness_capabilities.go`
- `~/dev/scion/docs-site/src/content/docs/advanced-local/templates.md`
- `~/dev/scion/pkg/config/embeds/templates/default/home/.tmux.conf`

## Acceptance Criteria

The first useful implementation is complete when:

1. Agent/detail views can render a derived phase/activity/detail with
   provenance.
2. The status projection explains whether each source is broker-owned,
   observed, or inferred.
3. Existing endpoint/flight/run/work item records remain canonical.
4. Tmux attach is labeled and routed as an endpoint attach surface, not a
   separate session model.
5. Debug attach waits for readiness and supports reattach without stale UI
   state.
6. Harness inventory can say `yes`, `partial`, `no`, or `unknown` for at least
   resume, trace observation, questions, approvals, MCP, auth, and debug attach.
7. Unsupported actions are hidden or visibly downgraded.
8. No raw external harness transcript turns are persisted as Scout messages.

## Risks

| Risk | Mitigation |
|---|---|
| Projection becomes a second source of truth | Keep it rebuildable and source-attributed |
| UI treats inferred state as certain | Carry confidence and provenance into the model |
| Sticky terminal states go stale | Clear them only on explicit newer work and test precedence |
| Tmux attach leaks into a separate product model | Keep attach routes and labels explicit |
| Capability map becomes badge clutter | Use it to drive affordances, not decoration |
| Cross-harness support is uneven | Represent `partial`, `unknown`, and downgrade modes honestly |
| Observability oversteps data ownership | Preserve Scout-owned vs observed boundary in every API |

## Open Questions

1. Should the first status projection live in `@openscout/protocol` or as a
   runtime-local read model until the UI contract settles?
2. Should `debugTransports` live directly on `AgentEndpoint`, or should debug
   attach descriptors be a separate read endpoint to avoid endpoint schema
   churn?
3. How much of tail-derived observed status should be persisted as
   `activity_items` versus kept in bounded live buffers?
4. Should feature support be hand-authored in the harness catalog first, or
   generated from adapter specs with catalog overrides?
5. Which UI surfaces should expose raw/debug evidence by default, and which
   should require an explicit "debug" affordance?

## Summary

OpenScout should be conservative about authority and aggressive about
visibility.

The broker remains the canonical writer for Scout-owned coordination records.
The runtime should still observe as much local harness behavior as is
mechanically possible, normalize it into trace and activity evidence, and
project an honest, source-attributed view of what the system is doing.

That gives operators the compact Scion-style clarity of phase/activity, the
OpenScout-native richness of broker records and traces, and a practical tmux
attach surface without making tmux the whole product model.
