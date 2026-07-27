# Scout Deck — Codex-native vertical slice, architecture review

**Reviewer:** fable (consult, no code changes)
**Date:** 2026-07-27
**Worktree:** `/Users/arach/.codex/worktrees/a0a3/openscout` (branch `codex/scout-deck-control-surface-final`)
**Mandate reviewed:** map the real Codex app-server thread/turn/steer/queue/interrupt/approval capabilities through the trusted iOS native bridge into the bundled Deck surface, host-specific, no ACP, no cross-harness flattening.

> **Implementation disposition:** this review captured the essential semantic
> risks, especially the distinction between Scout messages and Codex turns,
> active-turn steering, and unsupported queue/approval UI. The checkout already
> registered a Codex adapter through `createPairingAdapterRegistry`, so the
> implementation reused the existing runtime session manager through narrow
> paired-host routes instead of adding a second adapter registration. Snapshot,
> connect, start, steer, and interrupt now cross that route. Queue and approvals
> remain explicitly unsupported.

---

## Bottom line

The mandate is achievable and the depth is justified, but it currently spans a seam that no single existing component crosses. **Two independent control planes exist, each holding half of what the Deck needs, and they do not meet.**

- The plane that already speaks real Codex `thread/*` and `turn/*` is not reachable from the iOS bridge.
- The plane that is reachable from the iOS bridge has the full block-level control vocabulary — including version-checked approvals — but has **no Codex adapter registered**.

The smallest honest slice is therefore not "add a composer to the Deck." It is **register a Codex app-server adapter in the pairing runtime so one plane owns the whole path**, then expose exactly one write verb through the surface bridge. Any slice that skips the adapter work will produce a Deck that looks Codex-native while routing through broker invocations or a Claude-shaped adapter — precisely the flattening the mandate forbids.

---

## 1. The seam

### Plane A — pairing runtime bridge (reachable from iOS, no Codex)

`packages/web/server/core/pairing/runtime/bridge/server.ts`

Already implements, host-side, over the trusted paired connection:

| Method | Line | Semantics |
| --- | --- | --- |
| `prompt/send` | 385 | Fire-and-forget into an adapter session; adapter streams |
| `turn/interrupt` | 392 | Session-scoped interrupt |
| `question/answer` | 398 | Block-scoped answer with session-registry error mapping |
| `action/decide` | 468 | Approval with **optimistic-concurrency version check** (`-32010 Stale approval version`) |
| `session/snapshot` | 450 | Full `SessionState` — turns, blocks, block states |
| `sync/replay`, `sync/status` | 409, 426 | Sequence-buffered replay from `lastSeq` |

`packages/scout-ios-core/Sources/ScoutIOSCore/BridgeBrokerClient.swift` already wraps every one of these: `send` (249), `answerQuestion` (279), `decideAction` (289), `interrupt` (302), `snapshot` (194), `conversationEvents` (200).

**But:** `packages/web/server/core/pairing/runtime/runtime.ts:42` registers exactly one adapter — `"claude-code": createClaudeCode`. `config.ts:23` names `"codex"` in a doc comment; no factory exists. Searching `packages/` and `apps/` for a Codex adapter on this plane returns nothing.

### Plane B — broker agent-endpoint runtime (real Codex, not reachable from iOS)

`packages/agent-sessions/src/local/transports/codex-app-server.ts` (1887 lines)

Real protocol work, already done and correct:

- `thread/start` (1178), `thread/resume` (1144)
- `turn/start` (944), `turn/steer` (959), `turn/interrupt` (972)
- Server-request handling with protocol-valid JSON-RPC rejection (`handleServerRequest` 1262, `-32000` envelopes at 673–687)
- Item streaming: `item/started`, `item/completed`, `turn/completed`
- Long-lived stateful connection with persisted thread id

Wrapped by `packages/runtime/src/codex-app-server.ts` as `invoke / send / steer / interrupt / snapshot / shutdown`.

**But:** this plane is driven by broker invocations against agent endpoints. Nothing in `ScoutWebSurfaceBridge` or `BridgeBrokerClient` reaches it as a session.

### What the Deck surface can do today

`apps/ios/Scout/ScoutWebSurfaceBridge.swift` is a deliberately tight allowlist. For `.lanes`, `enabledCapabilities` is:

```
bootstrap, native.openExternalURL, native.cancel, agents.list, tail.recent, native.setLaneSelection
```

Everything else falls through to `unsupported_capability`. Two details worth noting before planning on top of it:

- `native.setLaneSelection` (line ~168) is a **stub** — it replies `{"accepted": true}` and writes nothing to the model. The native side does not currently receive lane selection.
- `dispatch.ask` and `dispatch.review` appear in `parameterKeys` but not in `enabledCapabilities`, so they validate and then get rejected. The shape is reserved; the capability is not enabled.

This is good hygiene, not an obstacle — the allowlist is exactly the right place to admit one new verb.

---

## 2. Strongest existing integration points

Ranked by leverage per unit of new code.

1. **`action/decide` version-checked approval (`server.ts:468–500`).** The strongest asset in the repo for this mandate. It resolves the snapshot, finds the turn, finds the action block, validates `approval.version`, and refuses stale decisions. That is the hard part of a mobile approval affordance — a tablet is exactly where a stale approval gets tapped — and it already exists. Do not rebuild it; give it a Codex adapter to talk to.

2. **`sync/replay` + `sync/status` sequence buffer (`server.ts:409–447`).** A tablet surface backgrounds constantly. `ScoutWebSurfaceBridge` already cancels all in-flight tasks on `.background` (`onActivityChange`). Replay-from-`lastSeq` is the correct resume primitive and it is already wired on both sides.

3. **The `ScoutWebSurfaceBridge` envelope contract.** Protocol version, allowlisted methods, per-method parameter key sets, host-scope authorization via `authorizedHostIds`, per-method deadlines, `native.cancel`, cursor epochs carrying `connectionRevision`. Adding a capability is a small, well-shaped change; the security posture is already established and should not be relaxed for the slice.

4. **`codex-app-server.ts` transport.** Steer and interrupt are already first-class, contradicting the "Next Steps After This Slice" list in `docs/codex-app-server-harness.md` — that doc predates the implementation and should be corrected so planning does not re-scope work that is done.

5. **`packages/agent-sessions/src/adapters/codex/references/openai-codex-app-server-protocol.md`.** A distilled, source-linked contract note. Treat it as the review gate for anything claiming Codex-native behavior.

---

## 3. Semantics we must not misrepresent

Each of these is a place where the Deck could render something true-looking and wrong.

**3.1 `send` is not `turn/start`.** `BridgeBrokerClient.send` (249) calls `mobile/comms/send` — the broker plane. It creates a message, flight, and invocation, and explicitly returns `turnId: nil`. A Deck composer wired to it is submitting to the broker, which *may* route to an app-server-backed endpoint. Different identity, different ordering, different latency, no turn id. If the Deck shows a turn, it must have a turn id from the harness-session plane, not a flight id relabelled.

**3.2 There is no Codex-native queue.** `enqueue` (`codex-app-server.ts:1583`) is a client-side promise chain that serializes calls into one session, and `createActiveTurn` throws if a turn is already active. Codex's own model is one active turn per thread. So "queue" in the Deck means *our local serialization*, not a harness queue with depth, reordering, or cancellation of pending entries. Rendering a queue with removable pending items would invent state the binary does not have — the same class of error the control-surface doc already flagged and avoided ("lever positions, rotary encoders … would invent state and commands the broker does not own").

**3.3 Steer requires an active turn and an expected turn id.** `steerTurn(prompt, expectedTurnId)` (953), and `steer()` (1534) throws when `activeTurn` is null. Steer is not "send a follow-up"; it is a mid-turn redirect against a specific turn. A Deck affordance that offers steer while idle is offering something the protocol will reject. The `expectedTurnId` argument is a concurrency guard and must survive to the UI as a real precondition, the same way `action/decide` surfaces `version`.

**3.4 Approvals are currently off in the app-server path.** `approvalPolicy` defaults to `"never"` at three call sites (1034, 1147, 1180). `packages/runtime/src/permission-policy.ts` does define `"on-request"` policies, so the capability exists — but until a Codex session runs under `on-request`, **there are no approval requests to display**. An approval affordance shipped before that is dead UI. Turning it on is a deliberate policy decision with sandboxing implications, not a UI toggle.

**3.5 Server requests can wedge a turn.** Per the protocol notes (54–66, 82–97) and implemented at `handleServerRequest` (1262): every server request must be answered with a protocol-valid resolve or reject including a numeric `code`. If approvals move to `on-request` and any part of the chain — including a Deck that went to background mid-turn — fails to answer, the turn hangs. Approval routing needs a host-side timeout-and-reject fallback that does not depend on the tablet being awake. `ScoutWebSurfaceBridge`'s `cancelAll()` on `.background` makes this concrete rather than theoretical.

**3.6 Dynamic tool calls are rejected, not supported.** `buildUnsupportedServerRequestError` (673) rejects `item/tool/call` explicitly. Desktop-origin threads may advertise tools this adapter does not implement. The Deck must not present resumed Desktop threads as fully capable.

**3.7 Channel numbers are not identity.** From `scout-deck-control-surface.md`: channel numbers describe current resolved deck order; pinning or roster change renumbers them. Any control verb must address lane/agent/session id, never a channel index.

**3.8 Observed-transcript boundary.** `AGENTS.md:26` — external harness transcripts including Codex JSONL are observed source material and must not be bulk-imported as first-party conversation messages. A Codex-native Deck will be tempting to feed from `buildCodexRolloutSessionSnapshot` (770) reading rollout files. That path is legitimate for *display*; it must not become a write-back into Scout conversations. `crates/scoutd/src/native_read_service.rs` is named `read` for this reason — keep it read-only.

**3.9 Broker ownership.** Per `docs/codex-app-server-harness.md`, the broker stays canonical for conversations, messages, invocations, flights, deliveries, bindings, and collaboration records. The harness-session plane is an execution substrate. A Deck turn is not a Scout message unless the broker made it one.

---

## 4. Smallest honest end-to-end slice

**Goal:** one real Codex turn, started from the Deck, on a thread the host owns, with a live turn id and a working interrupt. Nothing else.

**Why this and not less:** anything smaller (a composer posting via `mobile/comms/send`) demonstrates the broker path, not Codex-native control, and would bake in violation 3.1.

**Why this and not more:** steer, approvals, and queue each require a precondition the slice does not yet establish (an active turn with a known id; `on-request` policy plus a wedge-proof reject path; a queue concept Codex does not have).

### Steps

1. **Register a Codex app-server adapter in the pairing runtime.** `runtime.ts:42`, alongside `"claude-code": createClaudeCode`. Back it with the existing `@openscout/agent-sessions/local` transport. This is the load-bearing step and the only one that makes the rest honest. Keep `approvalPolicy: "never"` for this slice.

2. **Project Codex items into the existing `SessionState` block model** — the one `session/snapshot` and `action/decide` already read. Do not invent a parallel projection; `CodexObservedTopologyTracker` and `buildCodexAppServerSessionSnapshot` (393) already produce session/turn/block shapes.

3. **Admit exactly two verbs to the `.lanes` surface allowlist** in `ScoutWebSurfaceBridge`: `session.snapshot` (read) and `turn.start` (write). Both host-scoped, both through `authorizedHostIds`. Give `turn.start` a short deadline and a real `native.cancel` path. Leave `dispatch.ask`/`dispatch.review` disabled.

4. **Make `native.setLaneSelection` real.** It is currently a stub. The slice needs one authoritative selected lane to address, and the footer in `scout-deck-native-surface.md` already promises "one explicit route to the future native composer."

5. **Wire interrupt through the existing `turn/interrupt`.** Already implemented on both planes; it becomes reachable once step 1 lands. Interrupt is the honest companion to start — a control surface that can begin a turn and not stop it is worse than read-only.

6. **Render turn state from real events only.** `turn/started` → `item/*` → `turn/completed`, with `status: "interrupted" | "failed" | "completed"` (line 82) shown distinctly. No optimistic turn rendering before a turn id arrives.

### Exit bar

- A turn started from the Deck appears in Codex with a real `turnId` that the Deck displays.
- Interrupt from the Deck produces `status: "interrupted"`, not a UI-local cancel.
- Backgrounding the tablet mid-turn and returning replays via `sync/replay` without duplicate or lost items.
- No Scout conversation message is created by the turn unless the broker created it.
- `bun run --cwd packages/web check:native-surfaces` passes with the regenerated bundle.

---

## 5. Explicitly deferred, with the precondition each is waiting on

| Capability | Precondition |
| --- | --- |
| Steer | A displayed active turn id, and a UI state that only offers steer while a turn is live (3.3) |
| Approvals | A Codex session running `approvalPolicy: "on-request"` **plus** a host-side timeout-reject that does not depend on the tablet (3.4, 3.5) |
| Queue | A decision about what "queue" means when the harness has none. Recommend renaming to *pending submissions* and scoping it to our serialization, or dropping it (3.2) |
| Thread fork | `thread/fork` is in the protocol lifecycle but not in the transport; no current caller |
| Handoff edges, attention ack | Already flagged as follow-up in `scout-deck-native-surface.md`; bridge exposes neither projection nor mutation |

---

## 6. Two corrections to existing docs

1. `docs/codex-app-server-harness.md` — "Next Steps After This Slice" lists "expose interrupt and steer as first-class runtime operations." Both are implemented (`steerCodexAppServerAgent`, `interruptCodexAppServerAgent`, `codex-app-server.ts:1120–1126`). Leaving this stale will cause re-scoping.

2. `packages/web/server/core/pairing/runtime/bridge/config.ts:23` names `"codex"` as an available adapter type in a doc comment. No factory is registered. Either implement it (step 1) or drop it from the comment — right now it reads as a supported option.
