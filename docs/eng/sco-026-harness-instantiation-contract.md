# SCO-026: Harness Instantiation Contract

## Status

Proposed.

## Intent

Define the shape OpenScout should use when it starts, resumes, observes, and
replaces long-running harness sessions.

The immediate trigger is the pi SDK shape: a small runtime/session boundary
with cwd-bound services, explicit auth/model/tool configuration, an event
stream, prompt queueing, and session replacement APIs. That shape is useful
because it names the right scope for a harness instance without pulling harness
transcripts into Scout's broker-owned data model.

This document adds that scope to OpenScout's harness definition.

## Decision

OpenScout should treat a harness instance as a runtime-scoped execution object,
not as a one-shot command and not as a Scout-owned transcript store.

Every first-class harness adapter should converge on the same conceptual
boundary:

1. A `HarnessRuntime` owns process-global and cwd-bound setup for one harness
   backend.
2. A `HarnessSession` owns one active harness conversation or thread.
3. The runtime can create, resume, fork, switch, or replace sessions when the
   underlying harness supports those operations.
4. The session exposes prompt, interrupt, follow-up or steering, subscription,
   abort, and shutdown semantics.
5. The adapter normalizes harness lifecycle events into OpenScout session
   events and maps broker invocations/flights onto session prompts.

Scout's broker remains the canonical writer for Scout-owned coordination
records. Harness runtime/session objects are execution substrate.

## MCP Instantiation And Routing

MCP hosts need two separate operations:

- instantiate a concrete harness session
- route a Scout send or ask to a concrete target

Those operations should not be collapsed. If a caller asks for a new
`@openscout` Claude session, the host should first call an instantiation tool
such as `agents_start` with explicit fields like `agentName: "openscout"` and
`harness: "claude"`. The returned `exactTargetAgentId` is then the preferred
input to `messages_send` or `invocations_ask`.

Routing tools should not silently substitute an adjacent candidate when a
precise requested label is unresolved. They should return a diagnostic and, when
the label looks startable, a structured `agents_start` suggestion that preserves
the requested agent name, harness, model hint, project path, and cwd. Discovery
tools such as `agents_search` and `agents_resolve` remain useful for choosing
among existing routable agents; they are not a replacement for an explicit
session creation request.

## Why This Belongs In The Harness Definition

Scout already distinguishes coordination from observed harness material:

- broker-owned messages, invocations, flights, deliveries, bindings, questions,
  and work items are Scout records
- external harness transcripts, JSONL files, and native session stores are
  harness-owned source material

The missing middle layer is harness instantiation.

Without a named runtime/session boundary, each harness integration is tempted
to invent its own launch path:

- one-shot shell execution for Codex
- tmux transport for Claude Code
- extension-mediated pi tools
- process-specific prompt files
- ad hoc reply tagging

Those differences should exist inside adapters, but the OpenScout-facing
contract should be stable.

## Reference Shape From Pi

The pi SDK is a useful reference because it exposes the exact grain size Scout
needs:

- `createAgentSession()` returns a session object for normal prompting and
  streaming.
- `createAgentSessionRuntime()` owns replacement flows such as new session,
  switch session, fork, clone, and import.
- Runtime construction receives cwd-bound services, session manager, auth,
  model registry, settings, tools, extensions, skills, context files, and
  resource loaders.
- `AgentSession` exposes prompt queueing, steering, follow-up, event
  subscription, model control, compaction, abort, and disposal.
- Prompt acceptance and completion are separate states: a prompt can be
  accepted, queued, or handled immediately before the eventual run succeeds or
  fails.
- The session file is a tree, not a flat transcript. Branching, cloning,
  labels, and path navigation are native session operations.
- Event subscriptions are session-specific and need to be reattached after a
  runtime replaces the active session.
- Tools, skills, prompts, extensions, settings, auth, model discovery, and
  context files are resource loading concerns. They belong in runtime setup,
  not in broker routing.
- Tool instances can be cwd-sensitive. When a harness exposes prebuilt tools
  and cwd-bound tool factories, Scout must instantiate tools through the
  cwd-aware path for launched sessions.
- The SDK is preferred for same-process type safety and direct state access,
  while RPC mode remains preferable when process isolation or language-neutral
  integration matters.

OpenScout should borrow the shape, not the product authority.

## Pi Details Worth Preserving

The pi SDK makes several behaviors explicit that should inform the generic
harness contract.

### Prompt Acceptance

`prompt()` may accept immediately, queue work during streaming, or reject during
preflight. That is different from final run success. Scout should preserve this
distinction:

- preflight rejected: the invocation did not enter the harness run queue
- accepted: the prompt was accepted, queued, or handled immediately
- completed: the resulting harness run reached a terminal state
- failed after acceptance: the harness accepted the prompt, but the run failed
  later through normal event flow

This maps cleanly onto flights: prompt acceptance is flight admission, while
run completion or failure is flight outcome.

### Steering And Follow-Up

Pi distinguishes steering from follow-up while a session is streaming:

- steering means "change direction after the current tool boundary allows it"
- follow-up means "do this after the current work finishes"

OpenScout should not collapse those into plain prompt text. The generic session
contract should support a queueing intent when a harness can express one, and
adapters should fail explicitly when the target harness cannot.

### Resource Discovery

Pi's `DefaultResourceLoader` separates project resources from global resources:

- project resources come from cwd-relative locations and ancestor context files
- global resources come from the agent directory and user-level skill or
  settings locations
- custom resource loaders replace discovery without changing the fact that cwd
  still matters for session naming and tool path resolution

Scout should model resource loading as runtime setup so broker routing does not
learn harness-specific filesystem conventions.

### Diagnostics And Settings Durability

Runtime creation returns diagnostics. Settings can be in-memory or file-backed,
and writes may need an explicit flush boundary. Scout should therefore treat
diagnostics and settings durability as runtime artifacts:

- diagnostics are surfaced to operator/developer surfaces
- settings persistence failures are reported by the harness adapter or runtime
- broker record writes remain independent from harness settings writes

### Native Session Handles

Pi exposes both a stable session id and a session file. Scout should preserve a
generic slot for native handles without turning them into Scout message ids.
Those handles are useful for resume, diagnostics, and deep links into native
harness material.

## Contract Sketch

```ts
export type HarnessKind = "claude" | "codex" | "pi" | "opencode" | string;

export interface HarnessRuntimeConfig {
  harness: HarnessKind;
  cwd: string;
  agentDir?: string;
  env?: Record<string, string>;
  model?: HarnessModelSelection;
  auth?: HarnessAuthSelection;
  tools?: HarnessToolSelection;
  permissions?: HarnessPermissionProfile;
  resources?: HarnessResourceSelection;
  settings?: HarnessSettingsSelection;
  sessionStore?: HarnessSessionStore;
  options?: Record<string, unknown>;
}

export interface HarnessRuntime {
  readonly harness: HarnessKind;
  readonly cwd: string;
  readonly activeSessionId?: string;
  readonly diagnostics?: HarnessDiagnostics;

  start(input?: HarnessStartInput): Promise<HarnessSession>;
  resume(target: HarnessSessionTarget): Promise<HarnessSession>;
  switch?(target: HarnessSessionTarget): Promise<HarnessSession>;
  fork?(target: HarnessSessionTarget, options?: HarnessForkOptions): Promise<HarnessSession>;
  import?(source: HarnessImportSource): Promise<HarnessSession>;
  dispose(): Promise<void>;
}

export interface HarnessSession {
  readonly id: string;
  readonly harness: HarnessKind;
  readonly cwd: string;
  readonly nativeHandle?: HarnessNativeSessionHandle;

  prompt(input: HarnessPrompt): Promise<HarnessPromptResult>;
  steer?(input: HarnessPrompt): Promise<void>;
  followUp?(input: HarnessPrompt): Promise<void>;
  interrupt?(): Promise<void>;
  abort?(): Promise<void>;
  subscribe(listener: (event: HarnessEvent) => void): () => void;
  dispose(): Promise<void>;
}
```

The names above are illustrative. The important contract is the separation of
runtime lifecycle from session prompting and event observation.

## Required Semantics

### Runtime Semantics

The runtime owns:

- harness process lifecycle or connection lifecycle
- cwd-bound service construction
- session manager or thread manager integration
- auth and model registry wiring
- tool and permission profile selection
- resource discovery such as skills, prompts, context files, extensions, MCP
  config, and harness-native project config
- settings construction and durability reporting
- diagnostics produced during runtime setup
- session replacement operations
- persistence of the minimal native session handle needed for resume

The runtime must not own Scout broker records.

### Session Semantics

The session owns:

- one active harness thread, conversation, or terminal-backed run
- prompt delivery
- prompt preflight and queue admission
- streaming event subscription
- steering, follow-up, or queued prompt behavior when supported
- model, thinking, compaction, and native session controls when supported
- interruption, abort, and cleanup
- normalized event emission for Scout consumers

Session event subscriptions are scoped to that session. If the runtime replaces
the active session, consumers must subscribe to the new session.

Prompt completion semantics must distinguish acceptance from outcome. A prompt
that was accepted by the harness but later fails is a failed run, not a
preflight rejection.

### Adapter Semantics

The adapter owns translation:

- broker invocation or send intent into harness prompt input
- harness deltas into normalized session events
- harness completion into broker-visible flight progress or reply material
- harness questions and approvals into typed OpenScout attention events
- harness-native errors into explicit failure events

The adapter must not mutate harness-owned ecosystem state except through the
normal runtime/session APIs required to run the harness. For example, reading a
Claude Code transcript or pi session file is observation; bulk-importing it as
Scout messages is not.

## Relationship To Existing Proposals

- SCO-003 defines `@openscout/agent-sessions` as the shared session capability
  package. This document adds the instantiation scope that adapters should
  expose beneath that capability.
- SCO-005 defines trace-first observability. Harness events from this contract
  are the source material for that trace plane.
- SCO-014 keeps routing and context broker-owned. Harness instantiation does
  not change broker routing authority.
- SCO-015 describes pi as a Scout participant through a pi extension. This
  document describes the complementary direction: Scout launching or attaching
  to pi-like harness sessions through the same runtime/session abstraction.
- SCO-022 defines cross-harness sandbox and permission posture. Runtime config
  should carry permission profile and trusted-environment information through
  this contract.
- SCO-023 defines agent operations and run registry. Harness runtime/session
  handles provide execution evidence for runs, but do not become run authority.

## Design Rules

1. The broker owns coordination. Harness runtimes execute work.
2. Runtime setup is explicit: cwd, model, auth, tools, permissions, resources,
   settings, diagnostics, and session store should be visible in the launch
   contract.
3. Session replacement is first-class. New, resume, switch, fork, and import
   are runtime concerns, not ad hoc CLI scripts.
4. Event streams are session-scoped. Consumers must re-subscribe after active
   session replacement.
5. Same-process SDKs are allowed when they improve fidelity, but process
   isolation remains available through RPC or subprocess adapters.
6. Harness-owned transcripts remain harness-owned. Scout may observe, link,
   summarize, and index metadata, but must not bulk-import native transcripts
   as first-party Scout messages.
7. A harness adapter may expose direct state for diagnostics, but product
   features should depend on normalized session events and Scout-owned broker
   records.
8. Prompt admission and prompt outcome should be separate states in the
   adapter-to-broker mapping.
9. Cwd-sensitive tools must be created from cwd-aware factories or equivalent
   runtime services, not from process-global defaults.

## Initial Application

### Codex

Codex should continue moving from one-shot `codex exec` flows toward a
persistent app-server backed runtime:

- runtime owns the app-server process and thread handle
- session maps broker prompts to `turn/start`
- streamed items become normalized session events
- final assistant output becomes broker-visible reply material for the flight

### Pi

Pi should be treated as both:

- a Scout-capable harness through the pi extension path in SCO-015
- a candidate runtime-backed harness if Scout launches or embeds pi directly

If Scout uses the pi SDK, it should instantiate pi through a thin
`PiHarnessRuntime` that preserves pi's own session model and maps events back
into OpenScout. If Scout uses pi RPC mode, the same OpenScout-facing runtime
and session contract should still apply.

The first pi adapter should preserve these native semantics:

- `prompt()` acceptance maps to flight admission
- `steer()` and `followUp()` remain distinct queueing intents
- pi session ids and session files become native handles, not Scout messages
- resource loading stays inside the pi runtime factory
- diagnostics are attached to runtime/session status
- cwd-specific tool factories are used whenever Scout launches pi for a cwd

### Claude Code

Claude Code may continue to use its existing transport while converging on the
same runtime/session shape:

- runtime owns launch, attach, and cwd-bound setup
- session owns prompt delivery and observation
- transcript files remain harness-owned observed material

## Non-Goals

- replacing Scout's broker protocol with a harness SDK
- making pi, Codex, Claude Code, or any future harness the canonical data model
- requiring every harness to support fork, import, steering, or direct state
  access
- standardizing native transcript formats across harnesses
- persisting every harness event in broker SQLite
- choosing SDK over RPC for all integrations

## Open Questions

1. Should `HarnessRuntime` live directly in `@openscout/agent-sessions`, or in
   a lower-level runtime package consumed by `@openscout/agent-sessions`?
2. Should runtime/session replacement events be normalized as ordinary
   `session:update` events, or should there be explicit
   `runtime:session_replaced` events?
3. How much of model/auth/tool/resource selection should be normalized across
   harnesses versus stored as adapter-specific options?
4. Do broker invocations need a persistent pointer to the native harness session
   handle, or is the Scout session id enough once the adapter owns the mapping?
5. Should Scout expose steering and follow-up as broker-level invocation
   controls, or keep them inside the session capability plane until product
   need is clearer?
6. Should prompt preflight rejection be represented as a distinct flight state,
   or as a failed flight with a specific failure reason?

## Acceptance Criteria

- A new harness can be added without inventing a new launch/reply lifecycle.
- Codex app-server, Claude Code, pi, and opencode can be described with the
  same runtime/session boundary, even when their native capabilities differ.
- The broker can route asks and sends into harness sessions without knowing
  whether the underlying implementation is SDK, RPC, tmux, or subprocess.
- Prompt acceptance, queueing, completion, and failure can be represented
  without ad hoc reply tags.
- Session traces can render the same normalized lifecycle events across
  harnesses.
- Scout-owned records and harness-owned transcripts remain visibly separate in
  APIs, docs, and persistence.
