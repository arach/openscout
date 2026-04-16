# SCO-003: Agent Sessions As A Mesh Capability

## Status

Proposed.

## Proposal ID

`sco-003`

## Intent

Define how OpenScout should expose live agent-session observability and
interactive write-back as a shared, mesh-wide capability, and how the current
pairing bridge should shrink to a pure policy, orchestration, and encryption
layer above it.

The target outcome is:

- one session-capability surface shared by every OpenScout surface and every
  agent in the mesh
- one standalone trace-consumer surface shared by web-class OpenScout
  surfaces, instead of trace logic being reimplemented in the web app,
  desktop app, and bridge
- the pairing bridge reduced to policy, subscription routing, human
  mediation, authorization, and transport security
- every observable agent gets peer-level session visibility through one
  contract, gated by bridge authorization rules
- no duplication of adapter, state, buffer, or trace-interpretation logic
  between `packages/web` and `apps/desktop`
- no durable database-backed session logging added to the broker,
  control-plane SQLite, or fleet API

This proposal intentionally fits OpenScout's current pairing runtime, mobile
session tooling, broker session model, and sco-002 trace layering, rather than
introducing a parallel observability system.

## Problem

The current pairing runtime mixes three concerns in one layer:

1. Session capability — adapter lifecycle, event normalization, per-session
   state tracking, replay buffer, and interactive write-back verbs.
2. Pairing-specific transport — Noise handshake, relay client, QR handoff.
3. Policy and orchestration — who can attach to which session, where
   notifications go, and how pending human actions get routed back.

That mixture lives twice:

- `packages/web/server/core/pairing/runtime/`
- `apps/desktop/src/core/pairing/runtime/`

Three concrete problems follow:

- **Duplication.** The same adapter set, primitives, state tracker, and
  outbound buffer ship in both trees. Any fix or new adapter has to land in
  both.
- **Scoping misread.** Session capability reads as "pairing infrastructure"
  when it is actually a generic capability any OpenScout surface, and any
  agent in the mesh, should be able to consume. Calling it pairing narrows the
  audience incorrectly.
- **Trace drift risk.** The mobile surface already proves the turn/block trace
  model works, but OpenScout does not yet have a standalone shared trace layer
  for web-class consumers. Without one, trace interpretation ends up split
  across app-specific controllers or bridge-specific code paths.

The root issue is not missing data. The root issue is missing package
boundaries.

The system already has the right ingredients:

- a normalized adapter protocol
- a proven turn/block live trace model
- snapshot and replay machinery
- approval and question write-backs
- remote transport and authorization machinery

What it lacks is a clean separation between capability, presentation, and
policy.

## Decision

OpenScout should split the current pairing runtime into three layers:

- **Capability plane**: a new shared package, `@openscout/agent-sessions`,
  exposes the full session capability surface for local consumers —
  attach, observe, replay, `sendTurn`, `answer`, `decide`, `interrupt`,
  lifecycle — with no policy logic.
- **Trace-consumer plane**: a new shared package, `@openscout/session-trace`,
  exposes shared trace view-model logic and reusable React components for
  rendering live session traces from capability snapshots and events. It
  depends on `@openscout/agent-sessions`, never on pairing transport or broker
  projections.
- **Policy plane**: the pairing bridge shrinks to policy, subscription
  fan-out, human mediation, authorization, transport security, and remote RPC.
  The bridge depends on `@openscout/agent-sessions`; neither shared package
  depends on the bridge.

Consumers choose their level:

- local React-based Scout surfaces such as the web trace drawer, desktop
  surfaces, and future agent console consume `@openscout/session-trace`
  directly
- local services that need raw capability rather than UI consume
  `@openscout/agent-sessions` directly
- remote agents and remote Scout surfaces consume sessions through the bridge,
  which applies authorization and encryption before proxying into the local
  capability package
- native clients MAY render platform-native UI, but they SHOULD follow the
  same trace view-model and rendering rules rather than inventing a bridge-only
  interpretation layer

This preserves a single source of truth for session mechanics, a single source
of truth for trace interpretation on web-class surfaces, and a narrow bridge
that owns only the policy questions that must not be smeared across every
consumer.

## Normative Language

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as normative requirements.

## Implementation Expectation

This document describes the intended steady-state design.

The work MAY land in multiple PRs, but the carve MUST preserve one coherent
model throughout:

- carve `@openscout/agent-sessions`
- carve `@openscout/session-trace` (framework-agnostic model)
- carve `@openscout/session-trace-react` (React bindings on the model)
- migrate both pairing runtimes to depend on `@openscout/agent-sessions`
- move shared trace interpretation into `@openscout/session-trace` and
  shared React components into `@openscout/session-trace-react`
- shrink the bridge to policy, routing, human mediation, authz, and crypto
- add the mesh-facing RPC surface so remote agents can attach through the
  bridge

No step in that migration should introduce:

- a second session protocol
- a second in-memory session tracker in the bridge
- a durable database-backed session event log

## Design Principles

1. **Capability is separate from policy.**
   The package that exposes `sendTurn`, `answer`, `decide`, `interrupt`, and
   `observe` MUST NOT make authorization, fan-out, or notification decisions.
2. **Trace presentation is separate from capability.**
   The package that renders or interprets live trace for UI consumers MUST sit
   above the capability package, not inside the bridge and not inside every app
   surface independently.
3. **Preserve the current turn/block protocol.**
   OpenScout MUST keep the existing normalized session protocol shape used by
   the current pairing runtime and mobile client. This proposal is a package
   carve and naming correction, not a new event model.
4. **Capability is not read-only.**
   Sending a turn, answering a question, deciding an approval, and interrupting
   a session are normal typed write-backs. They use the same adapter write path
   as any other interaction.
5. **Capability is agent-agnostic.**
   The package MUST NOT encode that Scout owns or spawns the session.
   Externally-started sessions are first-class.
6. **Policy is mesh-aware.**
   The bridge is the single place that decides whether a given requester's
   scope permits attach, observe, replay, `sendTurn`, `answer`, `decide`, or
   `interrupt` on a given session — regardless of whether the requester is a
   local UI or a remote agent.
7. **Local consumers MAY bypass policy; remote consumers MUST NOT.**
   Local consumers on the host node can import the shared packages directly.
   Remote access MUST pass through the bridge.
8. **Replay uses existing sequence semantics.**
   The capability package keeps the current `OutboundBuffer` sequence-based
   replay behavior. Remote consumers reuse the same semantics over the wire.
9. **Trace stays raw.**
   Session events are not projected into broker tables, the fleet API, or a new
   session-log database. Consumers that need durable narrative should project
   from broker records, per sco-002.
10. **Shared semantics matter more than shared widget code.**
    React consumers SHOULD share actual components. Native consumers MAY use
    platform-native widgets. What MUST be shared is the trace contract,
    interpretation rules, and interaction semantics.

## Goals

- one authoritative implementation of adapter protocol, state tracker, and
  outbound buffer
- one standalone shared trace-consumer package for web-class surfaces
- a package name and API shape that read as "session capability," not
  "Scout-managed agents"
- a bridge whose surface is narrow enough to audit for authorization and
  encryption
- a single set of RPC verbs that work identically for local UI consumers and
  remote agent consumers
- alignment with sco-001 thread authority and sco-002 trace layering
- a path to observe any observable agent, not just sessions Scout itself
  created

## Non-Goals

- mesh-wide distributed session state
- rewriting adapters or the block/delta protocol
- changing pairing's QR, Noise, or relay transport
- introducing a new durable store for session events
- recreating session logging in broker or control-plane SQLite
- solving general-purpose cross-tenant authorization
- forcing every client onto one UI toolkit
- synthesizing work detail or coordination timeline from raw trace

## Terminology

| Term | Meaning |
|---|---|
| **Session** | A live adapter-backed agent run (claude-code, codex, opencode, openai-compat, pi, echo, …) |
| **Adapter** | The per-harness driver that emits normalized session events and accepts typed write-backs |
| **Capability package** | `@openscout/agent-sessions` — adapter contract, registry, state, buffer, primitives |
| **Trace-model package** | `@openscout/session-trace` — framework-agnostic trace selectors, formatters, view-model, and interaction helpers |
| **Trace-react package** | `@openscout/session-trace-react` — React bindings and presentational components built on the trace-model package |
| **Bridge** | The reduced pairing bridge — policy, fan-out, human mediation, authz, crypto |
| **Local consumer** | A caller in the same process or same node as the capability registry |
| **Remote consumer** | A caller on another node or another agent reaching the capability through the bridge |
| **Observable agent** | Any agent process whose session can be represented through the shared session capability contract |
| **Registry** | Per-process inventory of sessions currently tracked by the capability package |

## Formal Spec

### 1. Package Layout

OpenScout MUST introduce three new workspace packages:

```
packages/agent-sessions/
  src/
    protocol/
      primitives.ts
      adapter.ts
      approval-normalization.ts
      index.ts
    client.ts
    adapters/
      claude-code.ts
      codex.ts
      echo.ts
      openai-compat.ts
      opencode.ts
      pi.ts
    registry.ts
    state.ts
    buffer.ts
    index.ts

packages/session-trace/
  src/
    selectors.ts
    formatting.ts
    view-model.ts
    interactions.ts
    index.ts

packages/session-trace-react/
  src/
    TraceTimeline.tsx
    TraceTurn.tsx
    TraceBlock.tsx
    TraceActionBlock.tsx
    TraceReasoningBlock.tsx
    TraceQuestionBlock.tsx
    ApprovalCard.tsx
    index.ts
```

Rules:

1. The capability package MUST be named `@openscout/agent-sessions`.
2. The trace-model package MUST be named `@openscout/session-trace` and MUST
   contain only framework-agnostic logic: selectors, formatters, view-model,
   and interaction helpers. It MUST NOT import React or any other UI
   framework.
3. The React bindings package MUST be named `@openscout/session-trace-react`
   and MUST be the only trace package that imports React. It MUST depend on
   `@openscout/session-trace`.
4. `@openscout/agent-sessions` MUST NOT depend on any pairing, bridge, or
   transport module.
5. `@openscout/agent-sessions` MUST NOT reference broker or control-plane
   SQLite state.
6. `@openscout/agent-sessions` MUST expose a browser-safe entrypoint such as
   `@openscout/agent-sessions/client`. That entrypoint MUST export only
   browser-safe protocol types, snapshot/event types, approval helpers, and
   other pure helpers needed by trace consumers. It MUST NOT expose adapters,
   registry implementations, or any Node-only code paths.
7. `@openscout/session-trace` MUST depend on that browser-safe
   `@openscout/agent-sessions` entrypoint rather than on the package root.
8. `@openscout/session-trace` and `@openscout/session-trace-react` MUST NOT
   depend on the bridge, relay, pairing QR flows, or broker projection
   tables.
9. `@openscout/session-trace-react` MUST NOT contain routing, queue
   management, or application-level state. Components render a single
   presentational unit at a time. Any "queue," "inbox," or "list"
   composition belongs in the consuming app.
10. `packages/web/server/core/pairing/runtime/` and
   `apps/desktop/src/core/pairing/runtime/` MUST migrate to depend on
   `@openscout/agent-sessions` and delete their duplicated copies.
11. Trace interpretation logic that belongs in `@openscout/session-trace` MUST
    NOT remain duplicated inside app-specific controllers after the carve.
12. Native (non-React) consumers MUST be able to depend on
    `@openscout/session-trace` alone, without pulling React transitively.

### 2. Protocol Compatibility

The capability package MUST preserve the current normalized session protocol
already used by the pairing runtime and mobile client.

At minimum, it MUST preserve the existing event vocabulary:

```ts
type SessionEvent =
  | { event: "session:update"; session: Session }
  | { event: "session:closed"; sessionId: string }
  | { event: "turn:start"; sessionId: string; turn: Turn }
  | { event: "turn:end"; sessionId: string; turnId: string; status: TurnStatus }
  | { event: "turn:error"; sessionId: string; turnId: string; message: string }
  | { event: "block:start"; sessionId: string; turnId: string; block: Block }
  | { event: "block:delta"; sessionId: string; turnId: string; blockId: string; text: string }
  | { event: "block:action:output"; sessionId: string; turnId: string; blockId: string; output: string }
  | { event: "block:action:status"; sessionId: string; turnId: string; blockId: string; status: Action["status"]; meta?: Record<string, unknown> }
  | { event: "block:action:approval"; sessionId: string; turnId: string; blockId: string; approval: { version: number; description?: string; risk?: "low" | "medium" | "high" } }
  | { event: "block:question:answer"; sessionId: string; turnId: string; blockId: string; questionStatus: QuestionBlockStatus; answer?: string[] }
  | { event: "block:end"; sessionId: string; turnId: string; blockId: string; status: BlockStatus };

type SequencedSessionEvent = {
  seq: number;
  event: SessionEvent;
  timestamp: number;
};

type SessionSnapshot = {
  session: Session;
  turns: TurnState[];
  currentTurnId?: string;
};
```

Rules:

1. OpenScout MUST NOT invent a second higher-level event vocabulary for the
   shared capability package.
2. `SessionEvent` MAY replace the old `PairingEvent` name, but the payload
   shapes and discriminators MUST remain wire-compatible with the current
   runtime.
3. Question prompts MUST continue to appear as question blocks in
   `block:start`, with answers delivered through `block:question:answer`.
4. Approval requests MUST continue to appear through
   `block:action:approval` and the action block state itself.
5. `SessionSnapshot` MUST preserve raw block payloads, output, status,
   approval metadata, and question answers.
6. The browser-safe `@openscout/agent-sessions` entrypoint MUST expose this
   protocol and snapshot shape without pulling adapters, registries, or
   Node-only dependencies into browser consumers.
7. `@openscout/session-trace` MUST render directly from this protocol and
   snapshot shape. It MUST NOT require broker projections or durable session
   logs to render live trace.

### 3. Session Capability Surface

The capability package MUST expose a consumer-facing registry surface around
the existing normalized protocol.

```ts
interface SessionRegistry {
  list(): SessionSummary[];
  getSession(sessionId: string): Session | null;
  getSnapshot(sessionId: string): SessionSnapshot | null;

  subscribe(
    sessionId: string,
    handler: (event: SequencedSessionEvent) => void,
  ): () => void;

  replay(
    sessionId: string,
    afterSeq: number,
  ): SequencedSessionEvent[];

  currentSeq(sessionId: string): number;
  oldestBufferedSeq(sessionId: string): number;

  sendTurn(sessionId: string, prompt: Prompt): Promise<void> | void;
  answer(input: QuestionAnswer): Promise<void> | void;
  decide(input: {
    sessionId: string;
    blockId: string;
    version: number;
    decision: "approve" | "deny";
    reason?: string;
  }): Promise<void> | void;
  interrupt(sessionId: string): Promise<void> | void;

  attach(adapter: SessionAdapter): string;
  detach(sessionId: string): Promise<void>;
}
```

Rules:

1. The capability package MUST expose one `SessionRegistry` per process.
2. Each session MUST have its own monotonic sequence space. `SequencedSessionEvent.seq` is scoped to the owning session, not the registry as a whole.
3. `subscribe(sessionId, ...)` MUST target exactly one session and MUST
   deliver live events in that session's sequence order.
4. `replay(sessionId, afterSeq)` MUST return events strictly after `afterSeq` in that session's sequence space, in sequence order, before any further live events for that session.
5. `currentSeq(sessionId)` and `oldestBufferedSeq(sessionId)` MUST reflect per-session buffer state so that consumers can detect replay gaps without reasoning about other sessions.
6. `sendTurn`, `answer`, `decide`, and `interrupt` MUST route through the
   adapter write path. They MUST NOT bypass adapter normalization.
7. The core registry API MUST NOT expose a mixed all-sessions subscription
   with per-session sequence numbers and no cross-session cursor contract.
   If OpenScout later needs an all-sessions feed, it MUST be specified as a
   separate surface with distinct cursor semantics.
8. `decide` MUST compare the supplied approval `version` against the current
   approval state in the session snapshot before invoking the adapter. If the
   approval is missing or the version is stale, `decide` MUST fail with a
   conflict-style error and MUST NOT call `adapter.decide(...)`.
9. `attach` MUST NOT consult bridge policy.
10. The registry MUST accept externally-started sessions as first-class.
11. The registry MUST NOT own broker persistence or durable projection logic.

### 4. Adapter Contract

Adapters MUST implement a capability-facing contract that preserves today's
runtime behavior while exposing typed write-backs.

```ts
interface SessionAdapter {
  readonly type: string;
  readonly session: Session;

  start(): Promise<void>;
  send(prompt: Prompt): Promise<void> | void;
  answer?(input: QuestionAnswer): Promise<void> | void;
  decide?(blockId: string, decision: "approve" | "deny", reason?: string): Promise<void> | void;
  interrupt(): Promise<void> | void;
  shutdown(): Promise<void>;

  on(event: "event", listener: (e: SessionEvent) => void): void;
  on(event: "error", listener: (e: Error) => void): void;
  off(event: "event", listener: (e: SessionEvent) => void): void;
  off(event: "error", listener: (e: Error) => void): void;
}
```

Rules:

1. Adapters MUST emit normalized `SessionEvent` shapes only. Raw harness
   protocol chunks MUST be normalized inside the adapter.
2. Adapters MUST surface question prompts as question blocks, not as generic
   text or stdout deltas.
3. Adapters MUST surface approval requests through
   `block:action:approval`, not through ad hoc text output.
4. Adapters SHOULD tolerate reconnect and MUST emit `session:update` again
   when the underlying session is re-established.
5. Adapters that do not support questions or approvals MAY omit the relevant
   write-back methods, but the registry MUST fail those calls explicitly rather
   than silently dropping them.

### 5. Shared Trace Consumer Layer

Trace consumption MUST be split across two packages:

- `@openscout/session-trace` — framework-agnostic trace model. Selectors,
  formatters, view-model, and interaction helpers. Safe for web, desktop,
  and native consumers. Zero UI-framework dependencies.
- `@openscout/session-trace-react` — React bindings built on top of
  `@openscout/session-trace`. Contains the reusable presentational
  components for timeline, turn, block, approval, and question rendering.

`@openscout/session-trace` MUST expose at minimum:

- selectors over `SessionSnapshot` and `SequencedSessionEvent`
- shared formatting and labeling logic for action kinds, statuses,
  timestamps, approvals, and question states
- default reasoning behavior aligned with sco-002 such as collapsed-by-default
  completed reasoning
- interaction helpers for answer, decide, copy, collapse, and jump behavior
  that return framework-agnostic intent descriptions

`@openscout/session-trace-react` MUST expose at minimum:

- presentational components for timeline, turn, block, action block,
  reasoning block, question block, and approval card
- hooks or adapter helpers that bind the shared model to React state

Rules:

1. React-based Scout surfaces SHOULD render live trace by consuming
   `@openscout/session-trace-react` (which transitively uses the model
   package) rather than re-deriving trace interpretation locally.
2. Non-React consumers (native mobile, future non-React surfaces) MUST be
   able to depend on `@openscout/session-trace` alone and reimplement
   rendering against its view-model without pulling React transitively.
3. The bridge MUST NOT own trace rendering or trace interpretation logic.
4. App-specific controllers MUST NOT each re-derive reasoning collapse,
   approval card semantics, question card semantics, or action labeling.
5. Native clients MAY render platform-native widgets, but they SHOULD follow
   the same trace interpretation rules exported by the trace-model package.
6. Neither trace package MAY depend on broker tables, work-item projections,
   or fleet projections.
7. `@openscout/session-trace-react` MUST expose rendering primitives only.
   List composition, queues, inboxes, routing, and selection state belong
   to the consuming application, not to the trace package.
8. The trace packages are the shared live-trace presentation layer. They
   are not the durable work-detail or coordination-timeline layer from
   sco-002.

### 6. Bridge Responsibilities (Reduced)

The pairing bridge MUST be limited to the following responsibilities.

1. **Authorization and scope**
   - decide whether a given requester MAY `list`, `get`, `subscribe`,
     `replay`, `sendTurn`, `answer`, `decide`, or `interrupt` on a given
     session
   - apply `shareMode`-style rules before exposing events or descriptors
2. **Subscription fan-out**
   - multiplex many remote subscribers onto local registry subscriptions
   - manage per-watcher lease, renew, and close semantics
3. **Human mediation**
   - route question prompts and approval requests to human-facing surfaces
   - accept the human response and call `registry.answer(...)` or
     `registry.decide(...)` on behalf of the watcher
4. **Transport security**
   - Noise handshake
   - relay client
   - pairing QR handoff
5. **Notification projection**
   - emit notification metadata on user-visible events, aligned with sco-001
     tiers (`interrupt`, `badge`, `silent`)

The bridge MUST NOT:

- duplicate `OutboundBuffer`
- maintain its own in-memory session state tracker
- decode or re-normalize adapter events
- host app-specific trace rendering logic
- expose raw stdin passthrough to any consumer
- persist raw trace into broker or fleet storage

### 7. Mesh RPC Surface

The bridge MUST expose one set of RPC methods that cover both local UI and
remote agent consumers.

```
session.list
session.get
session.subscribe
session.replay
session.sendTurn
session.answer
session.decide
session.interrupt
```

Request shape guidance:

```ts
type SessionSubscribeRequest = {
  sessionId: string;
  watcherNodeId: string;
  watcherId: string;
  afterSeq?: number;
  leaseMs?: number;
};

type SessionSubscribeResponse = {
  watchId: string;
  sessionId: string;
  acceptedAfterSeq: number;
  latestSeq: number;
  oldestBufferedSeq: number;
  leaseExpiresAt: number;
  mode: "full" | "summary";
};
```

Rules:

1. Local consumers MAY bypass RPC and import the shared packages directly.
2. Remote agents and remote Scout surfaces MUST call through the bridge RPC
   methods.
3. `session.subscribe` MUST target exactly one session. Subscribing to many
   sessions is accomplished by opening multiple watches; this keeps sequence
   semantics per-session end-to-end and avoids cross-session backpressure
   coupling.
4. `session.subscribe` MUST use the same per-session sequence semantics as
   `registry.replay(sessionId, afterSeq)` followed by live delivery of that
   session.
5. `session.list` SHOULD be used by consumers to discover sessions; watches
   are opened per session from that list.
6. `session.get` SHOULD return snapshot plus per-session sequence metadata
   (`latestSeq`, `oldestBufferedSeq`) needed for replay and reset handling.
7. `session.sendTurn`, `session.answer`, `session.decide`, and
   `session.interrupt` MUST be authorized before the bridge calls the
   underlying registry method.
8. Before the bridge forwards `session.decide`, it MUST validate the decision
   against its current view of the approval state, including version matching,
   and MUST fail stale or missing approvals with a conflict-style error rather
   than forwarding to the adapter. This bridge-side check is a fast-fail
   optimization for remote callers; the registry check in §3.8 remains the
   authoritative source of truth, and any disagreement between the two MUST
   resolve in favor of the registry.

### 8. Authorization Model

Authorization is intentionally minimal for this iteration, matching
OpenScout's current trusted mesh and paired-node model.

The bridge MUST decide each RPC call against at least:

1. **Caller identity** — which node or agent issued the call, verified via
   the existing Noise session.
2. **Session scope** — whether the session was started by Scout on this
   node, started externally, or explicitly marked private.
3. **Mode** — whether the caller should see full payloads or summary only.

Rules:

1. Sessions marked private MUST reject all remote calls.
2. Summary mode MUST redact block payload content while still exposing event
   metadata, approval metadata, and question prompts where policy allows.
3. The bridge MUST authorize write-back verbs independently from read verbs.
4. The bridge MUST NOT fall back to "allow" on authorization errors.

Richer policy such as RBAC, per-agent capability tokens, and consent flows is
out of scope for this iteration but MUST remain easy to graft on without
changing the shared capability surface.

### 9. Replay and Backpressure

The capability package MUST keep the current `OutboundBuffer` behavior, but
scoped per session rather than registry-global:

1. each session MUST have its own monotonic `seq` sequence space
2. each session MUST have a bounded ring with explicit capacity
3. `replay(sessionId, afterSeq)` MUST operate within that session's buffer
   window only
4. `oldestBufferedSeq(sessionId)` and `currentSeq(sessionId)` MUST expose
   per-session buffer state so replay-gap detection does not cross sessions

Rules:

1. The bridge MUST translate replay gaps where `afterSeq` is older than the
   session's `oldestBufferedSeq` into reset-required responses so remote
   consumers know to re-snapshot that session.
2. Slow remote consumers MUST be dropped from live delivery and forced back
   to snapshot-then-replay on the affected session, not buffered without
   bound.
3. The capability package MUST NOT create per-consumer unbounded buffers.
4. Backpressure on one session MUST NOT stall delivery on other sessions.
5. Rationale: a registry-global `seq` would force every per-session replay
   to scan over unrelated traffic and would couple overflow on one chatty
   session to reset-required behavior on every other session. Per-session
   seq matches sco-001's per-conversation sequencing model.

### 10. Naming And Type Hygiene

To prevent the "Scout-managed agents" misread:

1. The capability package MUST be named `@openscout/agent-sessions`.
2. The trace-model package MUST be named `@openscout/session-trace`.
3. The React bindings package MUST be named `@openscout/session-trace-react`.
4. Types SHOULD be named for capability, not transport.
5. `SessionEvent` MAY replace the old `PairingEvent` name, but event
   discriminators SHOULD remain the current normalized values.
6. Documentation MUST state that externally-started sessions are
   first-class.
7. Bridge-specific terms MUST NOT leak into the shared capability or trace
   consumer packages.

### 11. Relationship To sco-001 And sco-002

- **sco-001 (thread authority).** Session events are not thread events.
  Sessions MAY generate thread messages through normal broker write paths,
  but session capability MUST NOT bypass thread authority to write to
  conversations.
- **sco-002 (trace layering).** `@openscout/agent-sessions` and
  `@openscout/session-trace` are the substrate for the live-trace layer. They
  MUST NOT be the substrate for Work detail or Coordination timeline.
  Surfaces that need durable narrative MUST project from broker records, not
  from session events.

## Engineering Justification

### Why This Is The Right Model

- It matches what the code is already doing. Adapter, state, buffer, and
  primitives are already session-capability concerns; pairing just happens to
  be the first consumer.
- It preserves the current working turn/block trace model instead of replacing
  it with a second abstraction that UI consumers would have to reverse.
- It gives remote agents a first-class way to observe and, with permission,
  cooperate with each other's sessions without inventing a second
  observability system.
- It lets the bridge get small enough to audit. Authorization and encryption
  live in one file tree, not smeared across adapters.
- It gives OpenScout a standalone shared trace-consumer package, so web-class
  surfaces do not each re-implement reasoning collapse, action rendering,
  approval cards, and question handling.
- It keeps sco-002's "live trace is mostly raw" rule intact. Capability is the
  raw plane; durable narrative remains a broker projection.
- It explicitly avoids rebuilding session logging in a database.

### Why This Is Practical To Ship

OpenScout already has:

- a working adapter set with normalized primitives
- a state tracker and outbound buffer with sequence-based replay
- approval and question flows already proven by the pairing runtime
- a mobile surface that already renders the turn/block trace model
- a mesh session model with Noise and relay
- two duplicated copies of the runtime that will continue to drift if left
  alone

So the work is:

1. carve `packages/agent-sessions/` from the existing runtime
2. carve `packages/session-trace/` for framework-agnostic trace
   interpretation
3. carve `packages/session-trace-react/` for the React component layer on top
4. rewrite both pairing runtimes to depend on `@openscout/agent-sessions`
5. move authz, fan-out, and human mediation into the bridge's narrowed surface
6. expose `session.*` as the mobile and web trace entry points
7. migrate React-based surfaces to render trace through
   `@openscout/session-trace-react`

That is a mechanical carve and packaging correction, not new distributed
systems work.

### Why Not Keep It In Pairing

Pairing is a transport and handshake concern. Session capability and trace
presentation are separate concerns. When all three share a layer:

- adapters leak into pairing vocabulary
- new surfaces such as agent console or web trace drawers cannot consume
  sessions without taking a dependency on pairing transport
- remote agents cannot reuse the same verbs as local UIs
- trace interpretation logic drifts across surfaces
- duplication across `packages/web` and `apps/desktop` is guaranteed

Separating them resolves all five.

### Why Not Introduce A New Event Model

The existing turn/block protocol already matches the operator problem:

- it is raw enough for live trace
- it already carries approvals and question answers
- it already supports replay and snapshot recovery
- it already powers the mobile surface

Introducing a second higher-level session event model at this stage would make
the shared packages less useful, not more useful, because trace consumers would
still need the original block and turn detail.

## Operational Metrics

The bridge SHOULD expose at least:

- active session count
- active subscription count per session
- authorization denials by reason
- buffer overflow resets
- question round-trip latency
- approval round-trip latency
- `sendTurn` and `interrupt` round-trip latency

The capability package SHOULD expose at least:

- per-adapter event rate
- per-session buffer depth
- adapter reconnect count

The trace package SHOULD expose at least:

- render/update latency for active traces
- count of surfaces currently subscribed to live trace
- fallback occurrences where consumers had to re-snapshot

## Open Questions

1. Should session provenance distinguish between "scout on this node,"
   "scout on another node," and "external"? Or is a smaller provenance shape
   sufficient with richer detail living in metadata?
2. Should `session.subscribe` and `thread.watch.open` from sco-001 share one
   watch-lease mechanism, or stay parallel? They have the same shape but
   different domains.
3. Should write-back verbs such as `session.sendTurn`, `session.answer`,
   `session.decide`, and `session.interrupt` be gated by explicit per-session
   capability tokens, or is node-level authorization enough for this
   iteration?
4. Should adapter `start()` remain outside the capability package long-term, or
   should the registry eventually offer optional factory helpers for spawn and
   reconnect?
5. Does subscribing to one session per watch produce acceptable RPC volume for
   a dashboard that watches many sessions at once, or should the bridge
   eventually offer a "multi-watch" RPC that multiplexes N per-session streams
   over one transport channel while preserving per-session seq semantics?

## Summary

OpenScout has been shipping a session-capability substrate inside a package
named for a transport, and a viable trace model inside surface-specific code.

The fix is:

- name the capability for what it is
- ship it once
- ship a framework-agnostic trace-consumer layer above it, with a separate
  React bindings package on top
- keep session sequence space per-session so replay and backpressure never
  cross sessions
- keep the bridge focused on policy, routing, human mediation, and encryption
- keep raw trace out of the database

That gives OpenScout:

- one source of truth for adapter, state, and buffer mechanics
- one source of truth for trace interpretation on web-class surfaces
- a small, auditable bridge
- peer-level session visibility for every observable agent, not just Scout's
  own UI
- alignment with sco-001 authority semantics and sco-002 trace layering
- a package boundary that will not mislead the next person who reads it
