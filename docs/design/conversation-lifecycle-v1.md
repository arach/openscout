# Conversation lifecycle v1 — submit → settled turn

Design spec responding to the `new message → job finished` audit
(`.impeccable/critique/2026-07-29T00-29-33Z__ges-web-client-screens-chat-conversationscreen-tsx.md`, 22/40).

Status: **proposal, no source edits**. Author: `session-ms5cqlqp-sbc3rt`.

---

## 0. The one-sentence diagnosis

The UI derives a *single blended presence* from a soup of unrelated signals —
`sending`, `awaitingResponseSince`, `currentFlight.state`, agent presence, and an
activity count that is `max(activity.length, flightExists ? 1 : 0, …)`
(`conversation-model.ts:622-627`). Because one variable carries five different
kinds of truth, it can neither be honest nor durable. Every defect in the audit
falls out of that collapse.

Fix: **four orthogonal planes with disjoint authorities**, and a pure derivation
to one UI phase.

---

## 1. Canonical state planes

Each plane has exactly one authoritative writer. Nothing else may write it.

### Plane A — Turn delivery (client → broker)

`drafting → submitting → accepted | rejected`

Authority: the HTTP mutation response only. `accepted` requires a server-issued
`messageId`. Presence, SSE, and timers may not write this plane.

### Plane B — Worker lifecycle (broker flight)

`none → queued → waking → attached → running → terminal{completed | failed | cancelled | timed_out | undeliverable}`

Authority: `flight.updated` broker events and the flight record returned by the
mutation. **Agent presence heuristics are banned from this plane** — today
`describePresence` promotes `agentState` into what reads as worker state.

### Plane C — Observation evidence

`none → registered → attached_no_trace → tracing(n, lastAt) → stale(Δ)`

Authority: the observe payload's existing `fidelity` field
(`server/core/observe/service.ts:1739`) plus `timedEvents.length` and the newest
event timestamp. This is the plane that currently gets laundered into "1 update".

### Plane D — Turn settlement (what the operator actually cares about)

`open → settled_with_reply | settled_without_reply | settled_failed | settled_cancelled`

Authority: a canonical assistant message correlated to the turn, **or** a flight
terminal that survives the reconciliation window with no correlated reply.

> **Flight terminal ≠ turn settled.** That distinction is the whole 322 ms bug.
> `ConversationScreen.tsx:1116-1124` clears flight, activity, ask, and awaiting
> state the instant a terminal event arrives, then fires an async reload. The
> worker card is gone and the reply has not landed. Plane D exists so the UI
> binds to settlement, not to worker stop.

### Derived UI phase

`deriveTurnPhase(A, B, C, D) → Phase` — one pure, exhaustively table-tested
function. This is the only thing the timeline, header, and composer read. It
replaces `describePresence` + `buildTurnSnapshot` + `hasOutstandingConversationReply`
as the status source.

| Phase | Entry condition | Evidence shown |
| --- | --- | --- |
| `submitting` | A=submitting | none |
| `accepted` | A=accepted, B=none | broker receipt (messageId) |
| `starting` | B∈{queued, waking} | flight id + state |
| `attached` | B=attached/running, C=attached_no_trace | session id, "no trace events" |
| `working` | B=running, C=tracing | n events, last event age |
| `quiet` | C=stale(Δ>45s), B non-terminal | last event age |
| `settling` | B=terminal, D=open | terminal reason + "adding reply" |
| `settled_*` | D≠open | duration, trace link, outcome |

Every non-terminal phase displays elapsed **since that phase was entered**, not
since submit — the brief asks "how long has it been in *this* state," and
`buildTurnSnapshot` currently answers a different question.

---

## 2. Visuals and microcopy

Anchors stay OpenScout-native: operator turn row, worker card directly beneath
it, persistent composer. **One primary status story** — the worker card. Delete
the duplicate status surface in the header and in `ConversationStatusStrip`
(`ConversationStatus.tsx:50-75`); the strip becomes a phase-change announcement
target only (see §6), not a second visible readout.

| Phase | Turn row | Worker card | Composer |
| --- | --- | --- | --- |
| `submitting` | body at 60% opacity, hairline left tick | absent | disabled, "Sending…" |
| `accepted` | solid | **Accepted** · `0s`<br>_Waiting for Tesla to pick this up_ | live, Send queues |
| `starting` | solid | **Waking Tesla** · `4s`<br>_Flight queued_ | live |
| `attached` | solid | **Attached** · `12s`<br>_No activity yet_ · `Terminal` `Inspect` | live |
| `working` | solid | **Working** · `7 events · last 3s ago` · `Trace` `Terminal` | live, Send = queue/steer |
| `quiet` | solid | **No activity for 45s** (amber) · `Inspect` `Cancel` | live |
| `settling` | solid | **Completed · adding reply…** (held) | live |
| `settled_with_reply` | solid | replaced atomically by the reply; duration + trace as a hover/focus footnote | live |
| `settled_without_reply` | solid | **Completed without a reply** · `Inspect trace` `Retry` (durable) | live |
| `settled_failed` | solid | **Failed · <reason>** · `Retry` `Edit` (durable) | live |
| `settled_cancelled` | solid | **Cancelled** · `Resend` (durable) | live |

### Copy rules

- **Never "Sent."** We know the broker *accepted* it. Say `Accepted`.
- **Never "1 update"** unless there is one real trace event. `buildTurnSnapshot`'s
  `Math.max(..., currentFlight ? 1 : 0, awaitingResponseSince ? 1 : 0)` is the
  literal line that turns bookkeeping into claimed observation.
- **"Live trace" only** when `fidelity==="timestamped"` **and** the newest event is
  < 10 s old **and** the flight is non-terminal. Otherwise `Trace` or `Receipt`.
- **`—` vs `0`.** A stat that was never captured renders `—`. A stat genuinely
  measured at zero renders `0`. Screenshot 2 shows six `0`s that are all `—`.
- Setup receipts ("Session registered", "Harness session attached" —
  `observe/service.ts:1840,1854`) render dim, marker-less, and are **excluded from
  every event count**. They are provenance, not activity.

### Color

Lime is reserved for **operator attention**. Ambient machine activity keeps its
distinct green. I disagree with the audit's suggestion to unify them (§ Minor
observations) — the fix is to stop spending lime on machine states, not to make
working states louder.

---

## 3. Identity and reconciliation contract

1. The client mints `clientTurnId` (ULID) **at keypress, before any network call**,
   and sends it in the request body and as `Idempotency-Key`.
2. The server echoes `clientTurnId` on the created message, on the flight, and on
   every subsequent `message.created` / `flight.updated` SSE for that turn.
3. **Reconcile by `clientTurnId` only.** Delete the body+60 s heuristic at
   `ConversationScreen.tsx:1052-1060`; it mis-merges identical bodies and is the
   duplicate-body defect the audit's stress persona finds.
4. The pending turn lives in a **route-independent store** (module-level map or a
   provider above the router), keyed by `clientTurnId` — *not* in
   `ConversationScreen`'s `useState`. A canonical-ID redirect or remount cannot
   destroy it.
5. The pending turn carries `conversationIds: Set<string>` holding both provisional
   and canonical ids. `ConversationScreen` already computes
   `equivalentConversationIds`; promote that set into the store.
6. `NewChatComposer` writes the pending turn to the store **before** `navigate(...)`
   (`NewChatComposer.tsx:683,720`), so the destination renders it on first paint.
7. Mutations return the authoritative snapshot — created message, flight, canonical
   conversation id — and the UI hydrates from that. No read-after-write round trip.
8. **Cache invalidation, not TTL tuning.** `loadScoutBrokerContext`
   (`broker/service.ts:1102-1158`) caches the *whole broker snapshot* keyed on
   `(baseUrl, socketPath, sinceBucket)` for 5 s. It is not per-conversation, so the
   fix is coarse and cheap: clear `scoutBrokerContextCache` entirely on any
   Scout-owned write, synchronously, before the mutation response returns. A window
   that can serve pre-write state is a correctness bug, not a tuning parameter.
9. Load the transcript independently of fleet/metadata so unrelated latency cannot
   blank the thread.

**Disagreement with the audit:** it says "reconcile by ID," but stops at the
server `messageId`. That id does not exist at optimistic-render time and is
useless when the response itself is what failed. The id must be client-minted.

---

## 4. Observe fidelity contract

Three levels, named in the payload and rendered as three different screens.

| Level | Condition | UI |
| --- | --- | --- |
| `trace` | `fidelity==="timestamped"`, `timedEvents>0` | Full observer. **Transport enabled.** Header `Trace · N events`. |
| `attached` | session attached, zero timed events | **Receipt view, not a timeline.** Transport removed from the DOM. Header `Attached · no trace events`. Body: _"This worker is attached but is not emitting trace events."_ Actions: `Open terminal`, `Watch for the reply`. Stats read `—`. |
| `none` | no observation | `No observation available for this flight.` |

A `live` qualifier is **orthogonal** to fidelity: live iff flight non-terminal AND
newest event < 10 s old. Otherwise the badge reads `last event 4m ago` or `archived`.

**Hard rule: never render playback transport over a synthetic timeline.**
`SessionObserve.tsx:2209-2270,2916-2966` renders play + 0.5×/1×/2×/4× and a scrub
bar unconditionally — it never reads `fidelity`, which already exists in the
payload and already reaches `lib/types.ts:850`. Screenshot 2 is a one-second
synthetic bar with a full transport over it. That is the single most misleading
element in the flow, and it is a ~10-line gate.

---

## 5. Terminal and failure controls

**Send failure** — never remove the optimistic row. `ConversationScreen.tsx:1311-1316`
filters it out *after* `takeDraft` already cleared the composer, so the operator's
text is gone from both places. Instead: convert the row in place to
`Not sent · <reason>` with `Retry` (primary) and `Edit` (restores body +
attachments to the composer and removes the row). Write body+attachments to a
recovery buffer the moment the failure is caught, so a reload does not lose it.

**Startup timeout** — no flight within 10 s of `accepted` → phase copy becomes
`No worker has picked this up yet`, actions `Retry` · `Route to another agent` ·
`Cancel`. At 60 s the copy escalates; the turn never disappears.

**Cancel** — real broker cancel or the control does not exist. Per the project's
no-unbacked-affordances rule, a disabled Cancel is worse than no Cancel. Emits a
durable `Cancelled · Resend` receipt.

**Steer** — needs an *armed mode*, not a focus call. Composer shows a mode chip
`Steering Tesla` (Esc disarms), the send button reads `Steer`, and the result is a
receipt: `Steer delivered` or `Steer queued — agent is not accepting input`.
Likewise, `PinnedAskCard`'s `Defer` and `Route` buttons
(`ConversationStatus.tsx:38-43`) have no `onClick` at all — remove them until wired.

**Completion without reply** — hold the `settling` receipt until the next transcript
refresh *completes* (not a fixed timer). If no correlated assistant message,
settle to `settled_without_reply`. This must survive reload, which means it cannot
be client-derived — see the open question in §8.

**Durability** — every terminal receipt is reconstructible on load from the flight's
terminal state plus reply correlation, never from ephemeral client state.

---

## 6. Accessibility and motion

- **Two live regions, not one.** One `polite` region narrates phase changes only,
  throttled to ≥ 2 s and only on actual phase transition. One `assertive` region
  is reserved for send failure and terminal failure. Collapsing to a single region
  (as the audit's persona note implies) either spams the polite channel or swallows
  errors.
- Announcement text = phase label + evidence, e.g. `Working, 7 events, last 3 seconds ago`.
- **Focus**: launcher → conversation moves focus to the composer, and the pending
  turn row is the accessible-description target. A canonical-ID redirect must not
  move focus. Failure moves focus to `Retry` only if the operator has not typed since.
- Turn rows are `role="article"` with `aria-busy` while the phase is non-terminal.
- **Motion**: the worker card's activity pulse and the `settling → settled` crossfade
  are the only animations; both drop to opacity-only under
  `prefers-reduced-motion`. The card never animates its height on phase change —
  reserve the space at `accepted`.

---

## 7. API, events, model, ownership

| Change | Where |
| --- | --- |
| `clientTurnId` accepted on send + session-create; echoed on message, flight, and SSE | `server/core/conversations/service.ts`, `server/routes/*` |
| Mutations return `{ message, flight, canonicalConversationId }` | same |
| `scoutBrokerContextCache` cleared on Scout-owned writes | `server/core/broker/service.ts:1102` |
| Flight exposes terminal `reason` and `settledAt` | broker protocol + `lib/types.ts` |
| `fidelity` + `newestEventAt` surfaced per flight-observe response | `server/core/observe/service.ts` |
| `PendingTurnStore` (new) — route-independent, keyed by `clientTurnId` | `client/screens/chat/pending-turn-store.ts` |
| `deriveTurnPhase` (new) — pure, replaces `describePresence`/`buildTurnSnapshot` | `client/screens/chat/turn-phase.ts` |
| `WorkerTurnCard` (new) — owns all phase visuals + controls | `client/screens/chat/WorkerTurnCard.tsx` |
| `ConversationScreen` sheds status derivation; consumes phase + store | `ConversationScreen.tsx` |
| Observe transport gated on fidelity | `SessionObserve.tsx` |

---

## 8. Instrumentation and acceptance tests

**Instrumentation.** Emit one client event per phase transition:
`{ clientTurnId, from, to, dtMs, evidenceSource }`. Track p95 `accepted → first
evidence`, p95 `terminal → settled`, and — most importantly — a **phase-regression
counter**: any transition that moves backwards, or any frame where a pending turn
has no visible row. That counter is the automated detector for the whole class of
bugs in this audit.

**Unit**
- `deriveTurnPhase` table test, ≥ 24 cases, exhaustive over plane combinations.
- Reconcile-by-`clientTurnId`, including two turns with identical bodies < 60 s apart.
- Send-failure transition preserves the row and populates the recovery buffer.
- Fidelity → observe-level mapping.

**Integration**
- `POST /api/chats/:id/messages` returns message + flight + canonical id.
- Immediate `GET` after `POST` never returns a pre-write snapshot (cache invalidation).
- Flight terminal without a correlated reply produces a reconstructible
  `settled_without_reply` on a cold load.

**E2E (Playwright)**
1. Launcher → conversation: poll every 100 ms; the operator's text is present in
   **every** frame, including across the canonical-ID redirect.
2. Injected 500 ms terminal→reply gap: a worker card or receipt is present
   continuously; the card never blanks.
3. Send failure: row remains, `Edit` restores body + attachments.
4. Synthetic-fidelity flight: no transport controls in the DOM.
5. Reload during `settling`: same receipt reappears.

---

## 9. Phased implementation

Ordered so no phase leaves a worse intermediate state than it found.

- **P0 — server truth, zero UI change.** `clientTurnId` end-to-end; mutations return
  canonical snapshots; broker-context cache invalidated on write; flight terminal
  reason/`settledAt` exposed. Ship-ready alone; strictly reduces staleness.
- **P1 — pending-turn store.** Route-independent store, launcher seeds before
  navigate, reconcile by id, delete the body heuristic. Kills the
  disappearing-message class before any pixel moves.
- **P2 — phase machine.** `deriveTurnPhase` + `WorkerTurnCard`; collapse the three
  duplicate status surfaces to one. Pure refactor behind a table test.
- **P3 — settlement and receipts.** `settling` hold, durable abnormal terminals,
  failure/cancel recovery.
- **P4 — observe fidelity.** Gate the transport, relabel setup receipts, `—` vs `0`.
  Independent of P0–P3; can be lifted forward if someone wants an early win — it is
  the cheapest honesty gain in the list.
- **P5 — controls and a11y.** Armed steer, real cancel, remove unwired buttons,
  live regions, motion.

Rationale: P0 and P1 remove the data-truth bugs first, so the visual work in P2–P3
is design, not debugging.

---

## 10. Disagreements with the audit, and open questions

**Disagreements**

1. *Reconcile by ID* — right instinct, wrong id. Must be client-minted pre-network,
   not the server `messageId` (§3).
2. *"No durable completion receipt" as a defect* — partially wrong. A successful turn
   **is** its own receipt: the reply. Stamping every success with a `Completed ✓` row
   is precisely the generic-job-tracker feel the brief forbids. Durable receipts for
   the three abnormal terminals only; success gets a quiet duration + trace footnote.
3. *Green vs lime* — filed as minor; it is a rule. Lime = operator attention. Don't
   unify (§2).
4. *"Should completion mean worker stopped or turn settled?"* — not a question to
   resolve. Both are real, modeled separately as planes B and D; the UI binds to D.
5. *Multiple live regions* — the fix is two well-typed regions, not one (§6).
6. *Message width / ultrawide dead space* — a real observation, but a layout decision
   that should not ride along with a lifecycle correctness fix. Separate lane.

**Questions for the coordinator**

1. Does the broker expose a real cancel for an in-flight invocation today? If not,
   Cancel ships absent rather than disabled, and §5 changes.
2. Is there a server-side field for "flight terminal, no correlated reply," or do we
   add one? Durable `settled_without_reply` needs it and it is the only new
   persisted field in this spec.
3. Should the pending-turn store survive a full page reload via `sessionStorage`?
   I lean **yes for send-failure recovery, no for accepted turns** — once the broker
   has accepted, the server is authoritative and a stale local copy is a liability.
4. `scoutBrokerContextCache` is a whole-snapshot cache, not per-conversation. Is a
   full clear on every Scout-owned write acceptable for read amplification, or do we
   need a targeted invalidation path in the broker snapshot protocol first?
5. Is `WorkerTurnCard` in scope for the macOS/iOS ports in this pass, or web-only v1?
   The phase table should be shared; the visuals should not be ported blind.
