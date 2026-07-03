# Embed path for local coding agents — independent proposal (`@openscout/agent-host`)

Author: openscout-austen session (independent review, grounded in the repo at HEAD of `codex/project-knowledge-surface`).
Scope: review/design. No code changes proposed here beyond one flagged layering defect.

## 0. What the repo actually shows

The duplication in the brief is real and I traced its exact shape. `packages/agent-sessions/src/adapters/codex.ts` and `packages/runtime/src/codex-app-server.ts` share the whole **spawn → JSON-RPC framing → handshake → thread resume/start → notification decode → disk persistence** stack, and diverge only in the *sink*:

- **Observe sink** (`agent-sessions/adapters/codex.ts`): decoded events are emitted as `PairingEvent`s (`block:delta`, `block:action:output`, `turn:end`) into a live `SessionState` via `BaseAdapter` (`protocol/adapter.ts:109`) and `SessionRegistry` (`registry.ts:44`). Consumer: Pairing/observe.
- **Turn-result sink** (`runtime/codex-app-server.ts`): the same decoded stream is aggregated to a single final `output` string returned by `invoke()` (`codex-app-server.ts:1756`, `completeTurn` at `:2340`). Consumer: broker invoke.

The two copies re-implement `parseJsonLine`, `isResponse`/`isServerRequest`/`isNotification`, the `handleStdoutChunk` line buffer, the `thread/resume`-or-`thread/start` dance, the `initialize` handshake, and `state.json`/`codex-thread-id.txt` persistence. They already share the *pure* helpers (`resolveCodexExecutable`, `buildScoutMcpCodexLaunchArgs`, `CodexObservedTopologyTracker`, primitives) — so the seam is exactly the process+decode half.

Two facts decide the whole design:

1. **pi already did the right thing.** `runtime/pi-rpc.ts` does **not** re-implement the transport — it calls `createPiAdapter(...)` and projects final text out of the adapter's `StateTracker` snapshot (`extractTurnText`). Pi is the existence proof that one decode path can feed both sinks. Codex and Claude are the ones that forked.

2. **The runtime already re-derives the observe model from the same bytes.** `codex-app-server.ts` carries `buildCodexAppServerSessionSnapshot` (`:984`) and `buildCodexRolloutSessionSnapshot` (`:1361`) — full `SessionState` reconstructions from logs/rollout files. So "observe" and "turn result" are provably two projections of one decoded stream, not two transports.

Everything below follows from treating **process+protocol+decode as one layer with two projections**, and giving embed clients that layer directly.

---

## 1. Partition

Today the process/transport code is smeared across two packages and one god-module:

- `@openscout/agent-sessions` (zero-dep, billed browser-safe) holds the **observe adapters that spawn** — `index.ts:56` re-exports `createCodexAdapter` from `adapters/codex.ts:1`, which imports `node:child_process`. The "browser-safe substrate" and the node-only spawn adapters are conflated in one package.
- `@openscout/runtime` holds the invoke transports (`codex-app-server.ts`, `claude-stream-json.ts`, `pi-rpc.ts`) **plus** `local-agents.ts` (4923 lines) which mixes host concerns (session-options assembly, model→launch-arg normalization, warm-process reuse, tmux keystroke delivery, `invokeLocalAgentEndpoint`) with broker concerns (endpoint metadata, bindings, collaboration/fork prompt assembly, reply-context).
- `@openscout/protocol` holds broker/mesh vocabulary (invocations, flights, `ScoutReplyContext`, control commands, terminal-session records).

Proposed partition:

**New package `@openscout/agent-host` (node/bun) — the transport + session + embed layer.**
Owns exactly one copy of process+protocol+decode per harness, plus the warm-session manager and the embed API. Depends on `agent-sessions` (for primitive types + `StateTracker`) and nothing else. **Must not depend on `protocol` or `runtime`.** This is the only package Preframe/Scoutbot import.

Contents moved here:
- Per-harness **drivers** — the spawn/handshake/resume/frame/decode extracted from both `runtime/codex-app-server.ts` and `agent-sessions/adapters/codex.ts` (and the claude/pi equivalents). One copy.
- The warm-session manager currently living as the module-level `sessions` map + `CodexAppServerSession` (`codex-app-server.ts:2506`).
- Model→launch-arg normalization that is *harness knowledge* (`normalizeCodexAppServerLaunchArgs`, `codex-app-server.ts:122`) and executable/env building (`buildManagedAgentEnvironment`).
- The terminal **relay** delivery (tmux `load-buffer`/`paste-buffer`/`send-keys`, currently `local-agents.ts:sendTmuxPrompt`) — as a *separate* interface (see §3).

**`@openscout/agent-sessions` — becomes the pure vocabulary + read-model layer.**
Keeps primitives (`Turn`/`Block`/`Session`/`Prompt`), `StateTracker`, `OutboundBuffer`, `SessionRegistry`, history-snapshot builders, `model-context-window`, budget/cost normalization, topology trackers, and the *pure string* helpers (executable candidates, launch-arg building). The spawn adapters **move out** to `agent-host`; what remains of each adapter is the pure `ObserveProjection` (decoded event → `SessionState`), which `agent-host` composes. Net effect: `agent-sessions` finally *is* browser-safe, and the `index.ts:56` node leak disappears.

**`@openscout/runtime` — keeps broker/mesh; its transports collapse to thin wrappers.**
`codex-app-server.ts`/`claude-stream-json.ts`/`pi-rpc.ts` become adapters-of-an-adapter: call `agent-host`, then add *only* broker concerns (write reply-context, post the conversation message, update the flight, mutate endpoint state). `broker-local-invocation-service.ts` is unchanged in spirit — it stays the broker→host bridge. `local-agents.ts` splits: the host half (spawn options, model resolution, reuse, tmux delivery) delegates to `agent-host`; the broker half (endpoints, bindings, collaboration prompt, reply-context) stays.

**`@openscout/protocol` — unchanged in scope**, but stops leaking into the transport (see §6). If `agent-host` needs a neutral harness/transport enum, it defines its own (`HarnessId`, `TransportFamily`) rather than importing broker types.

Why a new package rather than "just make runtime transports consume the agent-sessions adapters (like pi did)": embed clients cannot import `runtime` (it drags in `@trpc/server`, `drizzle-orm`, `ws`, the broker), and `agent-sessions` is the browser-safe substrate — putting a spawn-based embed API in either is wrong. `agent-host` is the honest home for "call a local agent from a node process," and it's where the single decode copy has to live anyway.

---

## 2. Public API (what embed clients import)

Nouns and verbs chosen fresh; no obligation to the existing draft. The whole surface is **local**: a spec, a handle, a turn result. No invocation, no flight, no conversation.

```ts
import { AgentHost, runAgentTurn } from "@openscout/agent-host";

// One isolated call — spawn, one turn, tear down. The brief's "one isolated call".
const result = await runAgentTurn(
  { harness: "codex", cwd, systemPrompt, model: "gpt-5.5", sandbox: "read-only" },
  "Summarize the diff on this branch.",
  { timeoutMs: 120_000 },
);
result.text;         // final assistant text
result.usage;        // tokens/cost if the harness reported them (optional)
result.reuse;        // "cold" here
result.ref;          // opaque SessionRef, usable to resume later
```

```ts
// Several exchanges on the same machine, same context — the brief's "multi-exchange".
const host = new AgentHost();                       // process-local registry of warm handles
const handle = await host.open({ harness: "claude", cwd, systemPrompt });

const a = await handle.ask("Find the flaky test.");         // first ask pays boot
const b = await handle.ask("Now propose a fix.");           // warm, same context
for await (const ev of handle.stream("Apply it and explain")) { /* tokens/blocks */ }
handle.steer("actually, keep it minimal");                  // mid-turn, if supported
const snap = handle.snapshot();                             // observe read-model on demand
await handle.close();                                       // or { reset: true } to drop native thread
```

Core types:

- `LocalAgentSpec` — `{ harness, cwd, systemPrompt?, model?, reasoningEffort?, launchArgs?, env?, permission?, sandbox?, resumeFrom?: SessionRef }`. Pure local launch config. **No** `conversationId`/`messageId`/`requesterId`/`replyContext`/`action`.
- `AgentHandle` — a warm logical session. Verbs: `ask(prompt, opts) → Promise<TurnResult>`, `stream(prompt, opts) → AsyncIterable<TurnEvent>`, `steer(prompt)`, `interrupt()`, `snapshot() → SessionState`, `close(opts)`. Fields: `ref: SessionRef`, `warm: boolean`, `capabilities`.
- `AgentHost` — process-local warm-handle registry. `open(spec) → Promise<AgentHandle>`, `resume(ref, spec?) → Promise<AgentHandle>`, `list()`, `shutdown()`.
- `SessionRef` — opaque, serializable; carries native thread/session id for cross-process resume. Never a broker id.
- `TurnResult` — `{ text, usage?, ref, reuse: "cold"|"warm"|"resumed", stoppedBy?: "complete"|"interrupt"|"timeout" }`.
- `TurnEvent` — the canonical decoded event (the union the adapters already emit internally); `ask` is just `stream` folded to final text.
- `capabilities` — `{ requestResponse, streaming, steerable, resumable }` (see §3).

Deliberately **absent** verbs (they are broker, not host): `invoke`, `dispatch`, `deliver`, `reply`, `flight`, `wake`, `consult`/`execute`.

`ask` = `stream` collapsed, so there is one code path; a caller who wants tokens uses `stream`, a caller who wants a string uses `ask`. This mirrors what already exists (`invoke` aggregates the same events `snapshot` would show) without exposing broker naming.

---

## 3. Transport diversity (no vendor at the center)

Request/response is a **capability, not an assumption**. Three families implement two interfaces:

**A. `TurnDriver` (structured wire, request/response).** codex app-server (framed JSON-RPC), claude stream-json (long-lived stdio), pi rpc, grok/acp. `capabilities = { requestResponse: true, streaming: true, steerable: true|false, resumable: true }`. `ask` resolves on the native turn-complete event (`turn/completed`, stream-json `result`, pi `turn_end`). These are `runtime/local-agent-transports.ts:DirectLocalAgentTransport` today.

**B. `TurnDriver` (exec / stateless).** openai-compat and opencode (HTTP/SSE), and genuine one-shot `cmd -p --resume` CLIs. `capabilities = { requestResponse: true, streaming: true, steerable: false, resumable: "replay" }`. Same `ask`/`stream` surface; `steer` throws `Unsupported`; resume is by session id/replay, not a warm process. The driver interface must not assume a persistent stdin channel — model "no mid-turn steering" as a capability, not a special case.

**C. `TerminalRelay` (delivery-only) — a *different* interface.** tmux/zellij. This is where the brief's "may not fit the same API shape" gets an honest answer: it does not fit, and the API says so. A terminal harness exposes `deliver(prompt) → Promise<Delivered>` (keystroke paste + composer-cleared verification, exactly today's `sendTmuxPrompt`) and `capabilities.requestResponse === false`. It has **no `ask`**. The protocol already states the reason: a terminal surface is "a relay target, not a message source" (`protocol/terminal-sessions.ts:16`) — scrollback is never the result. Capturing a reply requires an out-of-band inbox the host does not own. So the embed layer does not fake a turn result for terminals; the *broker* may (it polls its own message store for `[ask:<flightId>]`, `local-agents.ts`), but that polling is a broker capability and stays in runtime.

The dispatcher picks family by the harness's declared `TransportFamily`, never by sniffing codex. `host.open` on a terminal harness returns a handle whose type statically lacks `ask` (or whose `capabilities.requestResponse` is `false`), so a vendor-neutral caller checks the capability before awaiting a turn. This is the guard against re-centering the whole design on codex's turn model.

---

## 4. Cost / reuse — guarantee vs report

Starting cost is real (exe resolution, spawn, handshake, `thread/start`, harness boot, queue, model time) and the reusable slice differs by harness/transport. Split the promise:

**Guarantee (correctness of identity):**
- **Context continuity or loud failure.** If a spec carries `resumeFrom`/`targetSessionId`, the turn runs against that exact native thread/session, or the call *fails* — never silently a fresh context. (Today `resumeOrStartThread` already throws when `requireExistingThread` and resume fails, `codex-app-server.ts:2068`; keep that as the contract.)
- **Config-compatibility.** A warm handle is reused only if launch config matches; incompatible config tears the process down rather than reusing a wrong one (today's `configSignature`/`matches`, `codex-app-server.ts:1925`). The caller is told (via `reuse`) what happened.
- **At-most-one in-flight turn per handle**, serialized (today's `enqueue`/`serialized`), and clean teardown on `close` (no orphan process, thread-id persisted for resume).

**Report (performance, best-effort):**
- **Warmth.** `handle.warm` and `TurnResult.reuse ∈ {cold, warm, resumed}` tell the caller *after the fact* what actually happened — because resume is best-effort (codex "no rollout found for thread id" downgrades to a new thread, `codex-app-server.ts:1679`). OpenScout reports the reuse it achieved; it does not promise warmth.
- **Cost estimate.** `host.probe(spec) → { expectedReuse, needsSpawn, needsHandshake }` reports the expected boot path without running a turn (today's `ensureCodexAppServerAgentOnline` warms; expose it as a *reported* readiness, not a guaranteed latency).

One-shot vs multi-exchange fall straight out:
- **One-shot** (`runAgentTurn`): guarantee = isolation + no residue; report = full cold cost. Good for the isolated-call and batch-worker cases.
- **Multi-exchange** (`open` + N×`ask`): guarantee = same context across asks + serialization; report = only the first ask pays boot, subsequent asks are `warm`. The handle is *logical* — the host may transparently resume a dropped process — so callers never assume the OS process survived, only that the context did.

---

## 5. Build order (strangler; broker + observe stay green throughout)

**Slice 1 — extract the Codex driver into `agent-host`; keep runtime signatures as wrappers.**
Move `CodexAppServerSession` + framing/decode/persistence/warm-map out of `runtime/codex-app-server.ts` into `agent-host` as `CodexDriver` + a `TurnResult` projection. Re-implement the exported functions (`invokeCodexAppServerAgent`, `sendCodexAppServerAgent`, `steerCodexAppServerAgent`, `ensureCodexAppServerAgentOnline`, `getCodexAppServerAgentSnapshot`, `shutdownCodexAppServerAgent`) as thin runtime wrappers with identical signatures. **In the same slice, cut the reply-context leak (§6):** `writeReplyContext` moves out of the driver into the runtime wrapper. Why codex first: it is the named duplication, the largest file, already has the warm-session manager, already has snapshot tests (`codex-app-server.test.ts`), and already has a live embed consumer to validate against (Scoutbot, below). Observe path untouched (agent-sessions adapter unchanged), broker path untouched (signatures preserved) → both stay green.

**Slice 2 — collapse the Codex observe adapter onto the same driver.**
Re-express `agent-sessions/adapters/codex.ts` as `ObserveProjection` over `CodexDriver`, and physically move the spawn adapter into `agent-host` (it spawns anyway). `agent-sessions` keeps only the pure read-model; `runtime`'s `SessionRegistry` wiring imports the observe adapter from `agent-host`. This deletes the second decode copy and removes the `index.ts:56` browser-safe smell. Gate on the existing `agent-sessions` adapter tests + observe snapshot parity.

**Slice 3 — publish the embed API and migrate the de-facto embed client.**
Ship `AgentHost`/`runAgentTurn` from `agent-host`. Migrate `packages/web/server/create-openscout-web-server.ts` (Scoutbot) off its direct `invokeCodexAppServerAgent` reach-through onto `runAgentTurn`. Scoutbot is today's proof that embed already happens by reaching past the boundary — it becomes the first real client and the migration's canary.

**Slice 4+ — repeat for claude, then pi, then acp/grok.**
pi is nearly free (its runtime side already wraps the adapter). Then land `TerminalRelay` as its own interface. Each harness is one independent slice; nothing is big-bang. The runtime wrappers stay until every caller is off them, then delete.

Invariant that keeps both paths working: **the runtime keeps exporting the same function names as wrappers** until callers migrate, so the broker never notices; and **observe keeps consuming the same `SessionState`** because the projection is byte-for-byte the adapter's old emit logic. Migration risk is per-harness and reversible.

---

## 6. Leak guards (never in the embed / `agent-host` surface)

The one concrete defect to fix, then the standing guards.

**Defect (layering, not a crash):** `ScoutReplyContext` — a pure broker concept (`mode: "broker_reply"`, `conversationId`, `messageId`, `fromAgentId`) — is imported and persisted by the **lowest-layer** codex transport: `codex-app-server.ts:18` imports it, `:295` puts it on `InvocationOptions`, `:1771`/`:2237` write `scout-reply-context.json`, `:1976` sets `OPENSCOUT_REPLY_CONTEXT_FILE`. The transport should never know how a reply is routed. Move all reply-context writing into the runtime wrapper (Slice 1). This is the seam that, left in place, would drag broker vocabulary into the embed API.

**Must never appear in `agent-host`:**
- Broker delivery routing: `ScoutReplyContext`, `mode: "broker_reply"`, `conversationId`, `messageId`, `replyToMessageId`, `requesterId`, `from/toAgentId`, `audience`, `visibility`, `returnAddress`.
- Broker lifecycle: `Invocation`/`InvocationRequest`/`FlightRecord`/`FlightState`, `invocationId`, `flightId`, `InvocationAction` (`consult`/`execute`/`wake`). The embed API takes a `LocalAgentSpec` + prompt, not an `InvocationRequest`.
- Mesh + registry: `AgentDefinition`/`AgentEndpoint`/`ActorIdentity`, capability matrix, `NodeDefinition`, `ControlCommand`.
- Broker persistence + delivery: drizzle/sqlite stores, `postConversationMessage`, `[ask:<flightId>]` message-store polling. In particular, the terminal result-capture-via-broker-inbox stays in runtime; the embed layer's `TerminalRelay` returns *delivered*, not *replied*.

**Enforcement (mechanical, not vibes):**
- Dependency boundary: `agent-host/package.json` depends on `@openscout/agent-sessions` only — **not** `protocol`, **not** `runtime`. If a neutral enum is needed, define it in `agent-host`.
- CI import-boundary lint + a grep gate: `grep -rE "broker|conversationId|flightId|ScoutReplyContext|InvocationRequest" packages/agent-host/src` must return nothing.
- The embed types are authored in `agent-host` and reference only local types + `agent-sessions` primitives, so a broker concept cannot enter the surface by type inference.

---

### Appendix — key references

- Duplicated decode/transport: `agent-sessions/src/adapters/codex.ts` ↔ `runtime/src/codex-app-server.ts`; claude: `adapters/claude-code.ts` ↔ `claude-stream-json.ts`; pi (already unified): `adapters/pi.ts` ↔ `pi-rpc.ts` (wraps the adapter).
- Observe substrate: `protocol/adapter.ts:109` (`BaseAdapter`), `registry.ts:44` (`SessionRegistry`), `state.ts` (`StateTracker`).
- Turn-result path: `codex-app-server.ts:1756` (`invoke`), `:2340` (`completeTurn`), `:2534` (module fns), warm map `:2506`, config match `:1925`.
- Read-model re-derivation from bytes: `codex-app-server.ts:984`, `:1361`.
- Broker bridge / coupling: `broker-local-invocation-service.ts` (dispatch `:397`), `local-agents.ts:invokeLocalAgentEndpoint`, `buildScoutReplyContext`.
- Transport families: `local-agent-transports.ts:1` (`DirectLocalAgentTransport`), `:19` (tmux is broker-runnable but not direct).
- Terminal reality: `protocol/terminal-sessions.ts` (surface = relay target, not message source), tmux delivery in `local-agents.ts:sendTmuxPrompt`, result captured by broker message-store polling.
- Reply-context leak: `codex-app-server.ts:18,295,1771,1976,2237`.
- Embed already happening past the boundary: `packages/web/server/create-openscout-web-server.ts` → `invokeCodexAppServerAgent` (no broker context).
