# Flat Session Dispatch And The Reply Envelope

Status: partial implementation (P0 wake + locator + never-fall-through)
Date: 2026-08-03
Author: Fable (session-msdgi9xx-p3ycwn); refined with Art/Grok; P0 implemented in runtime
Motivating incident: `/Users/art/dev/blink` @ `codex/remove-agent-guide-scrollbar`

**P0 shipped in code:**
- `packages/runtime/src/session-locator.ts` — harness store T3 lookup
- `BrokerDeliveryRouter` wake path for exact `session_id` targets (never demotes)
- `broker-daemon` registers `flatDispatch` cardless endpoints with `externalSessionId`/`threadId` for resume
- Reply verb remains `scout send --ref` (no new `scout reply`)
- VS Code product framing dropped; Codex is treated as a harness

## The incident, and what actually broke

1. Grok found the Codex VS Code session that dirtied the tree: `019fbee7-2a7f-7eb0-84bf-da22717c74d0`.
2. `scout ask --to session:019fbee7-…` → **"not currently routable"**.
3. Fallback to `--to blink.codex-remove-agent-guide-scrollbar` woke a *different* Codex worker
   (`mobile-trust-release-hardening`), which produced a competent git autopsy from zero session
   history and then had to correct its own identity.

The root cause is one function. `resolveSessionTarget`
(`packages/runtime/src/scout-dispatcher.ts:680-733`) resolves a session id by filtering
`snapshot.endpoints` — the broker's live registry — and nothing else:

```ts
const matching = Object.values(snapshot.endpoints)
  .filter((endpoint) => endpointMatchesTargetSession(endpoint, sessionId))
  .filter((endpoint) => endpointMatchesSessionRouteScope(endpoint, options));
if (matching.length === 0) {
  return { kind: "unknown", label };   // ← the Blink failure
}
```

A Codex VS Code session has a rollout file on disk and a resumable id, but it never registered a
Scout endpoint. So it is *knowable, addressable, and resumable* — and invisible to the only
resolver we have. `apps/desktop/src/cli/commands/ask.ts:248` renders that as "not currently
routable", which is true of the registry and false of the world.

The doc that encodes this is `docs/runtime-sessions.md:330`:

> The session id does not have to be broker-minted. It only has to be **broker-known** and exact.

That sentence is the constraint. It should read *harness-known*.

Everything else in this note follows from relaxing that one word without weakening the fail-closed
guarantees that sit next to it.

---

## 1. Conceptual model

Scout carries two record types on two planes. They have never been named apart, which is why
dispatches keep getting rendered as DMs.

### 1a. Conversation message — the social plane (exists today)

`MessageRecord` / `ConversationDefinition`. Real `from` and `to`, both Scout identities. DM or
channel. Produces inbox rows, flights, work items, threads. Unchanged by this proposal.

### 1b. Session dispatch — the flat plane (new)

A dispatch has an **initiator** and an **endpoint**. It has no `from`, no `to`, no peer, and no
conversation. It is a log entry with a receipt.

```ts
type SessionDispatch = {
  id: ScoutId;                     // durable handle; short render = the ref
  ref: string;                     // 8-char bearer handle, e.g. "f3k9dp2m"

  initiator: {                     // who pressed send — NOT a "from"
    kind: "operator" | "agent" | "automation";
    actorId?: ScoutId;             // present only when the initiator is a Scout identity
    label: string;                 // "art", "session-msdgi9xx-p3ycwn"
  };

  endpoint: {                      // where it landed — NOT a "to"
    harness: AgentHarness;         // codex | claude | pi | ...
    nativeSessionId: string;       // 019fbee7-2a7f-7eb0-84bf-da22717c74d0
    cwd: string;                   // resolved project root
    surface: "vscode" | "tmux" | "zellij" | "app_server" | "stream_json" | "unknown";
    surfaceChanged: boolean;       // true when we resumed into a different surface than we found
    nodeId: string;
  };

  payload: { text: string; attachments?: DeliveryAttachment[] };

  replyExpectation: "none" | "inline" | "notify";
  envelopeInjected: boolean;       // false when Scout captures the reply natively

  resolution: {                    // proof of how we found it — see §2
    tier: "registry_live" | "registry_stale" | "scout_known" | "harness_store";
    evidence: string;              // endpoint id, registry row id, or rollout file path
    resolvedAt: number;
  };

  wake: {
    required: boolean;
    method: "live" | "resume" | "intake";
    startedAt?: number;
    readyAt?: number;
  };

  state: "planned" | "waking" | "delivered" | "awaiting_reply"
       | "replied" | "timed_out" | "failed" | "cancelled";

  reply?: { text: string; receivedAt: number; via: "cli_ref" | "mcp_reply" | "native_capture" };
  failure?: { reason: SessionDispatchFailureReason; detail: string; remediation?: string };

  attempts: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;               // when `ref` stops accepting replies
};
```

### Vocabulary rules

Enforce these in protocol types, CLI output, docs, and UI copy:

| Say | Never say |
|---|---|
| dispatch, inject | message, DM, send-to |
| initiator | from, sender |
| endpoint, session | to, recipient, peer, agent |
| receipt | thread, conversation |
| dispatch log | inbox |

A native harness UUID is never rendered as `@handle`, never gets a sprite avatar, never appears in
`scout who`, and never appears in `scout inbox`. It is a coordinate, not a colleague.

### Precedent already in the tree

SCO-070 cardless sessions (`packages/runtime/src/broker-cardless-session.ts:16-25`) already
establish "a session that owns its identity slot with no `AgentDefinition` card", routed through
the `resolved_session` variant. Flat dispatch is that idea taken one rung further: cardless **and**
endpoint-less at request time. The plumbing to land on is not new.

---

## 2. Addressing and resolution

### Canonical address forms

```
session:<harness>:<native-id>     # canonical — unambiguous, always preferred
session:<native-id>               # legal; harness inferred; fails closed on cross-harness collision
```

Modifiers: `--project <cwd>`, `--node <id>`. `packages/protocol/src/scout-composer.ts:118` already
emits the harness-qualified form, so the parse side is done.

### Required vs optional

| Field | Status | Why |
|---|---|---|
| `nativeSessionId` | **required** | it is the identity |
| `harness` | strongly recommended; required on collision | `codex resume -C <cwd> <id>` and `claude --resume <id>` are not interchangeable |
| `cwd` / `--project` | **required for Codex**, optional for Claude | Codex resume takes `-C <cwd>`; Claude's store is already keyed by project slug |
| `node` | optional | defaults local; required for multi-node (P2) |

### The resolution ladder

New `SessionLocator` service. Tries rungs in order, stops at the first hit, and records a
`resolution` proof on the dispatch.

| Tier | Source | Action on hit |
|---|---|---|
| **T0 `registry_live`** | `snapshot.endpoints` — today's only path | deliver directly |
| **T1 `registry_stale`** | endpoint row exists, process dead | `reviveExactSessionEndpoint` (already exists, `broker-local-endpoint-resolver.ts:218`) |
| **T2 `scout_known`** | `terminal_session_registry.source_session_id` | re-materialize from stored `resume_command` |
| **T3 `harness_store`** | `~/.codex/sessions/**/rollout-*.jsonl`, `~/.claude/projects/<slug>/<id>.jsonl` | intake → materialize → deliver |
| **T4** | nothing found | fail closed |

T2 is free: `terminal_session_registry` already exists (`packages/runtime/src/schema.ts:128-143`)
and its schema comment already states the invariant this proposal needs —
*"a harness session can be known/resumable without any broker agent endpoint."* Today only
`scout session intake` writes to it. Dispatch should read it and write to it.

T3 is the actually-new capability, and the repo already reads both stores for other purposes:
`packages/web/server/service-budgets.ts:5` walks `~/.codex/sessions/**.jsonl`, and
`packages/agent-sessions/src/history.ts` (`HistoryAdapterType = "claude-code" | "codex" | "pi"`)
parses both. T3 is a small facade over existing readers, not a new integration.

### Fail-closed matrix

| Condition | Outcome |
|---|---|
| T0 hit | deliver, `wake.method = "live"` |
| T1 hit, revive succeeds | deliver, `wake.method = "resume"` |
| T1 hit, revive fails | **fail** `session_wake_failed` |
| T2/T3 hit, exactly one match | wake via intake, `wake.method = "intake"`, deliver |
| T3, id present in >1 harness store | **fail** `session_ambiguous_harness` — list candidates, require `--harness` |
| T3, on-disk cwd ≠ `--project` | **fail** `session_cwd_conflict` — resuming elsewhere is a different session in practice |
| harness catalog has no resume verb (`session.ts:166`) | **fail** `session_not_resumable` |
| session is terminal / archived / compacted away | **fail** `session_terminal` |
| found nowhere | **fail** `session_unknown` |
| **any of the above** | **never** fall through to project, label, or capability routing |

Errors carry a remediation command, not just a reason — that is Scout's existing coaching posture
(`scout-comms.agent.md`, "broker should coach senders with likely intent, candidates, and
remediation commands"). Candidate agents may be *listed as text*. They are never dispatched to.

### The VS Code caveat — state it, don't hide it

A Codex VS Code session's live process belongs to the extension host. Scout cannot inject into it.
T3 finds the rollout file and resumes it **in a Scout-owned surface**: same context, new process.

That is a continuity fork, not a takeover, and the receipt must say so —
`wake.method = "intake"`, `endpoint.surfaceChanged = true`, `surface: "vscode" → "tmux"`. The
envelope repeats it. Without that line the operator believes they reached the live VS Code pane.

This is the honest version of what the Blink incident wanted, and it is strictly better than what
happened: the right context, correctly labeled, instead of the wrong agent confidently guessing.

---

## 3. Delivery pipeline

```bash
scout ask --to session:codex:019fbee7-2a7f-7eb0-84bf-da22717c74d0 \
  --project /Users/art/dev/blink \
  --reply-mode inline \
  "What did you change on codex/remove-agent-guide-scrollbar, and why is the tree dirty?"
```

1. **Parse** → `{ kind: "session_id", harness: "codex", sessionId: "019fbee7-…" }` + `projectPath`.
   No change needed; the composer already produces this.
2. **Open the dispatch.** Write the `SessionDispatch` row at `state: "planned"` and mint `ref`
   **before** resolution. The ref is returned immediately, so a wake that takes 40s still hands the
   caller a durable handle. This is the single most important ordering decision in the pipeline.
3. **Resolve** — ladder T0→T4, record proof. On failure: `state: "failed"`, receipt carries reason
   + remediation, nothing is injected anywhere.
4. **Wake** — for T2/T3, call the intake primitive **in-process**, not by shelling the CLI:
   `buildHarnessResumeCommand(harnessEntry, sessionId, cwd)` → materialize surface → register a
   `flatDispatch`-flagged cardless endpoint. `state: "waking"`. Upsert `terminal_session_registry`
   so the next dispatch resolves at T2.
5. **Compose** — if `replyExpectation !== "none"` **and** the surface is blind (§4), wrap the
   payload in the return envelope. Otherwise inject the payload raw.
6. **Inject** — tmux `send-keys` / app-server turn / stream-json stdin. `state: "delivered"`.
7. **Wait** (inline only) — block on `ref`. Two capture channels race: explicit `scout reply --ref`
   from inside the session, or native completion where Scout owns stdout.
8. **Complete** — `state: "replied" | "timed_out"`, store the reply, emit `dispatch.completed`.

### Harness and surface differences

| Harness / surface | Wake | Inject | Reply capture |
|---|---|---|---|
| Codex, terminal/tmux | `codex resume -C <cwd> <id>` | `send-keys` | **envelope** — Scout cannot parse the TUI |
| Codex, VS Code | resume into Scout surface (§2) | `send-keys` | **envelope** |
| Codex app-server | `threadId` resume | JSON-RPC turn | native — no envelope |
| Claude, tmux | `claude --resume <id>` | `send-keys` | **envelope** |
| Claude stream-json | `--resume` | stdin JSON | native — no envelope |
| pi | `pi --session-id <id>` | `send-keys` | **envelope** |

The governing rule: **the envelope exists only where Scout cannot observe the reply itself.**
That keeps CLI boilerplate out of every Scout-managed session and confines it to genuinely blind
surfaces — which is exactly the population of Scout-unaware sessions we are trying to reach.

---

## 4. Reply envelope contract

### Template

Appended after the payload, separated by a rule:

```text
<payload text>

---
Scout dispatch · ref f3k9dp2m · reply requested · expires 2026-08-03 18:40 local

Reply by running exactly this from any shell:

  scout reply --ref f3k9dp2m "YOUR ANSWER HERE"

Notes:
- This is a one-shot dispatch into this session, not a chat thread.
- Replace YOUR ANSWER HERE with your answer. Multi-line: --message-file <path>.
- If you cannot answer, start your reply with "blocked: " and say what you need.
- Do not start a new Scout ask. Nothing else is waiting on you.
```

Design notes, each load-bearing:

- **No identity assignment.** No "you are `@some.card`". The session stays anonymous. It is being
  asked a question, not enrolled in a fleet.
- **Ref appears twice** (header and command) so a truncated or reflowed context still recovers it.
- **Explicit expiry**, so a session that wakes hours later doesn't answer into a closed ref.
- **"Do not start a new Scout ask"** — this is the real failure mode with Scout-*aware* sessions,
  which helpfully open a conversation and recreate exactly the social-plane pollution we're avoiding.
- **`blocked:` stated inline**, not assumed as tribal knowledge.
- When `surfaceChanged`, prepend one line: `Note: this session was resumed from VS Code into a
  Scout-owned tmux surface. Your context is intact; the process is new.`

### Recommended CLI: a dedicated `scout reply`

`scout send --ref <ref>` exists today (`apps/desktop/src/cli/commands/send.ts:17`) and means
"send into the bound *conversation* referenced by this ref". Overloading it either forces creating
the fake conversation this whole proposal exists to avoid, or makes `--ref` polymorphic across two
record types — reintroducing the vocabulary collapse §1 is trying to kill.

Recommend `scout reply --ref <ref> <text>`, accepting **both** dispatch refs and message refs and
branching on the ref's record type. One verb, one meaning — *answer the thing that asked me* — over
two backing records. That is the clean shape, and it is also the shape a Scout-unaware Codex session
can follow without understanding any of this.

### Semantics

- **Idempotency / double-reply.** First reply wins. A second reply on an answered ref exits
  non-zero with `dispatch_already_answered` and prints the stored reply. Never silently accepted,
  never appended, never overwritten.
- **Timeout.** `--reply-mode inline` waits up to `--timeout` (proposed default 10 min). On timeout:
  `state: "timed_out"`, the waiter gets a receipt carrying the ref.
- **Late replies are accepted.** A dispatch log is a log, not an RPC. A `scout reply` after the
  waiter gave up is recorded and delivered as a notification, and the receipt says so. This matters:
  the session that took 20 minutes did the work, and throwing it away teaches agents not to bother.
- **Expiry.** The ref stops accepting at `expiresAt` (proposed 24h), independent of the wait timeout.
- **Scout-aware fast path.** MCP `dispatch_reply({ ref, text })`. Sessions with MCP use it and never
  see the CLI text — but the ref is in the payload header either way, so both paths agree on the
  handle.

### Security

- **The ref is a bearer token.** Treat it as one: ≥64 bits of entropy rendered short, single-use,
  expiring. Do not derive it from the session id or a counter.
- **Any local process holding the ref can reply.** On a single-user Mac that matches Scout's
  existing local-broker trust model. Say that plainly in the docs rather than implying
  authentication that isn't there.
- **Bind the ref to `(harness, nativeSessionId, cwd)`.** A `scout reply` from a different cwd is
  *allowed* — agents shell out from strange places — but the mismatch is recorded on the receipt,
  so a spoof leaves a trace even when it succeeds.
- **Refs never leave the machine.** Not in channel posts, broadcasts, or remote broker sync, unless
  the dispatch itself was remote (P2).
- **HTTP surface.** `dispatch_reply` over broker HTTP requires the same auth as the rest of the
  write API. No special-casing because "it's just a ref".

---

## 5. What must not happen

1. **Never demote an exact-session target.** If `session:<id>` fails to resolve, the broker must
   not route to a project, label, or capability worker — not even a high-confidence one. This *is*
   the Blink bug. `mobile-trust-release-hardening` should never have seen that payload. Guard it
   two ways: exact-session failures return `ScoutDispatchEnvelope { kind: "unavailable" }` with
   candidates as text only, and the dispatch layer asserts `resolution.tier` is set before
   injecting anything. Add a regression test named for the incident.
2. **Never mint a card or conversation for a native session id.** No `AgentDefinition`, no
   `@019fbee7-…`, no avatar, no inbox row, no `from`/`to`. The Codex UUID is not a peer.
3. **Never let a wake failure read as a delivery.** `waking` that never reaches `delivered` is a
   failure. The receipt must distinguish *found on disk* from *resumed* from *resumed and injected*.
4. **Never silently change surface.** Resuming VS Code → tmux is legitimate and must be stated in
   both receipt and envelope.
5. **Never import session scrollback into Scout messages.** Already the rule in
   `docs/specs/terminal-session-intake-surfaces.md`; restated here because a dispatch stores
   payload + reply, never transcript.

---

## 6. Observability and UI

Bias: **log that it happened.** No from/to relationship anywhere.

- **Dispatch log — the primary home.** `scout dispatches`, plus a flat web/native panel:
  time · initiator · `codex:019fbee7` · cwd · state · ref · reply-or-reason. No avatars, no
  conversation affordance, no reply box in the list view.
- **Session detail — the most useful placement.** On the harness-session record
  (`terminal_session_registry` row / Sessions surface), show *dispatches into this session* as a
  sub-list. This is the session's audit trail, and it is where someone debugging a dirty tree
  actually looks.
- **Activity feed / `scout latest` — system events only.** `dispatch.opened`, `dispatch.waking`,
  `dispatch.delivered`, `dispatch.replied|timed_out|failed`. Rendered as system lines, never as
  messages from a peer.
- **Inbox — no.** Dispatches never appear in `scout inbox`. That plane is social.
- **Attention plane — failures only**, plus replies when `--reply-mode notify`. A completed
  fire-and-forget dispatch generates zero attention.

---

## 7. Phased delivery

### P0 — the Blink fix (smallest slice that would have worked)

- `SessionLocator` T3: resolve `(harness, nativeSessionId) → { cwd, lastActivityAt }` from
  `~/.codex/sessions/**/rollout-*.jsonl` and `~/.claude/projects/<slug>/<id>.jsonl`.
- Wire it into `resolveSessionTarget` (`scout-dispatcher.ts:689`) as the fallback *before*
  returning `{ kind: "unknown" }`.
- Broker-internal wake: call the intake primitive, register a `flatDispatch` cardless endpoint.
- `SessionDispatch` record + `ref` + `scout reply --ref`.
- Envelope injection on terminal-backed surfaces only.
- Hard assert: exact-session failure never falls through. Regression test named for the incident.
- `--reply-mode inline` with timeout.

That alone turns the failing Blink command into a real answer from the right context.

### P1 — legible and safe

- Dispatch log surface, control events, session-detail sub-list.
- MCP `dispatch_reply`; native capture for `app_server` / `stream_json` (no envelope).
- Full fail-closed matrix with actionable diagnostics.
- Ref expiry, idempotency, late-reply-as-notification.
- Doc deltas (below).
- Rollout-file lock or advisory warning for concurrent VS Code + Scout resume.

### P2 — reach and ergonomics

- Remote / multi-node session dispatch.
- `scout session touched <id>` → one-line handoff into `scout ask --to session:` — the exact flow
  Grok was hand-assembling during the incident.
- Batch dispatch (one payload → N sessions, N receipts, still no conversation).
- Cursor / opencode / grok session stores.
- Dispatch-log retention + GC, consistent with the 3-day event retention already shipped.

---

## 8. Decisions for Art

**D1 — Does flat dispatch get its own top-level verb?**
(a) Keep `scout ask --to session:<…>` **(recommend)** — one addressing surface, the target form
already exists, nobody has to learn when to switch verbs.
(b) New `scout dispatch --session …` — cleaner separation, but splits addressing and makes `ask`
wrong for the case it handles best.
→ (a), with `scout dispatch` as an alias that forces `--reply-mode none`.

**D2 — VS Code sessions: resume into a new surface, or refuse?**
(a) Resume into a Scout surface and state it loudly **(recommend)** — delivers the value, honest
about the process change.
(b) Refuse with `session_surface_not_injectable` — purer, leaves the motivating case unsolved.
→ (a). Accepted risk: two live processes over one rollout file. P0 mitigation is a receipt warning;
a real lock is P1.

**D3 — `scout reply` as a new verb, or overload `scout send --ref`?**
(a) New `scout reply --ref`, handling both dispatch and message refs **(recommend)**.
(b) Overload `send --ref` — cheaper, but drags conversation vocabulary onto the flat plane.
→ (a).

**D4 — Envelope always, or only on blind surfaces?**
(a) Only where Scout can't observe the reply **(recommend)** — keeps managed sessions clean.
(b) Always, for uniformity — predictable, but injects boilerplate where Scout already has the answer.
→ (a), with the ref present in the payload header either way, so the handle is uniform even when
the instructions aren't.

**D5 — Does a flat dispatch take a broker identity slot at wake time?**
(a) Yes — a `flatDispatch`-flagged cardless endpoint **(recommend)**. Reuses SCO-070 plumbing and
inherits liveness and reaping for free.
(b) No — fully out-of-band injection. Purest, but reimplements process supervision.
→ (a), with the hard constraint that these endpoints are excluded from agent listings, `scout who`,
fleet counts, and inbox. They are plumbing, not fleet members.

**D6 — Timeout defaults.** Proposing 10 min inline wait, 24h ref expiry. Needs Art's numbers.

---

## Doc deltas and conflicts

1. **`docs/runtime-sessions.md:330`** — *"It only has to be broker-known and exact."*
   **This is the sentence that encodes the bug.** Delta: `broker-known` → `harness-known`, plus a
   clause: *"a session known to its harness but not to the broker is resolvable through intake;
   absence of a live endpoint is not evidence of absence of a session."*
2. **`docs/runtime-sessions.md:336-338`** — the fail-closed rule ("unknown, stale, unreachable, or
   ambiguous") stays, and gets sharper: add the explicit matrix from §2 so *cold-but-resumable* is
   named as a wake case, not an unreachable one. The rule was right; it was over-applied.
3. **`docs/agent/scout-comms.agent.md:152`** — *"exact session targeting fails unless every
   requested dimension has matching observed evidence."* Conflict: this reads as requiring live
   observation. Delta: scope it explicitly to **runtime dimensions** (harness/model/effort), which
   is what `assertEndpointObservedRuntimeMatches` actually enforces, not to session existence.
4. **`docs/agent/scout-comms.agent.md:28-41`** ("Core Records") — add
   `session dispatch | SessionDispatch`.
5. **`docs/agent/scout-comms.agent.md`** ("Delivery State") — `waking` already covers this; add a
   note that a dispatch's `waking` may include disk discovery and intake, not only endpoint revival.
6. **`docs/specs/terminal-session-intake-surfaces.md`, "What Is Not Done Yet" item 2** — **stale.**
   It says there is "not yet a durable Scout registry record for known harness session plus
   surfaces". `terminal_session_registry` now exists (`packages/runtime/src/schema.ts:128`). Delta:
   mark done, and note it is now also the T2 resolution source for dispatch.

---

## Consensus proposal

Scout is a flexible dispatcher with two planes, and the flat plane has been missing its record
type. Add `SessionDispatch` — an initiator, an endpoint, a payload, and an outcome, with no `from`,
no `to`, and no conversation — and teach exact-session resolution a four-rung ladder that falls
from the live registry through stale endpoints and the Scout terminal-session registry down to the
harness's own on-disk session stores, waking via the existing intake primitive at whichever rung
hits. Keep every fail-closed guarantee that exists today, and add the sharper ones the ladder makes
possible (ambiguous harness, cwd conflict, not-resumable), so an exact-session target *never*
degrades into project routing. When a reply is wanted from a surface Scout cannot observe, inject a
small return envelope that hands the session a pre-filled `scout reply --ref` and nothing else — no
identity, no card, no thread. The result: knowing a harness-native session id, its harness, and its
cwd is sufficient to reach it, and reaching it costs the session nothing but an answer.

## Recommended first PR

**Scope: resolution + receipt. No UI, no MCP, no batch.**

In: the `SessionLocator` T3 rung over the Codex and Claude session stores (facade over the readers
in `packages/agent-sessions`); its wiring into `resolveSessionTarget` ahead of the `unknown`
return; broker-internal wake through the existing intake primitive; the `SessionDispatch` record
and `ref`; `scout reply --ref`; envelope injection on terminal-backed surfaces; the
never-fall-through assertion with a regression test named for the Blink incident; doc deltas 1–3.

Out: dispatch log UI, session-detail sub-list, MCP `dispatch_reply`, native capture, remote nodes,
batch dispatch, rollout-file locking.

Boundary test: the exact failing command from the incident returns a real answer from
`019fbee7-2a7f-7eb0-84bf-da22717c74d0`'s context, and the exact wrong outcome — waking
`mobile-trust-release-hardening` — is impossible by assertion, not by luck.

## What I want Art to confirm

1. **D2** — is resume-VS-Code-into-tmux acceptable as *the* answer for VS Code sessions, given it
   is a continuity fork rather than a live attach? This is the one place the proposal delivers
   something slightly different from what was literally asked for.
2. **D3** — new `scout reply` verb, or accept the overload on `scout send --ref`?
3. **D5** — flat dispatches taking a cardless endpoint slot at wake time, excluded from all fleet
   surfaces. Cheap and reuses SCO-070, but it does mean a dispatch briefly *is* an endpoint.
4. **D6** — the two timeout numbers.
5. **Doc delta 3** — narrowing the "observed evidence" invariant to runtime dimensions. I read the
   code as already meaning that (`assertEndpointObservedRuntimeMatches` only checks
   harness/model/effort), so this is a doc correction rather than a policy change — but it is the
   invariant most likely to have been *intended* more broadly, so it deserves an explicit yes.
