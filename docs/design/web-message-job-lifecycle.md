# Message → Job Settlement — End-to-End UX Design

**Status:** Design brief awaiting product confirmation  
**Date:** 2026-07-28  
**Surface:** Scout Web conversation thread (`/c/:conversationId`) and linked run details  
**Mode:** Operate  
**Evidence:** July 28 captured conversation/observer flow and the persisted lifecycle critique  
**Collaboration:** Coordinating agent + fresh Opus, Kimi, and Grok profiles in Scout channel `message-lifecycle-design`

No implementation changes are part of this document.

---

## 1. Decision summary

The experience is one continuous **turn**, not a sequence of unrelated launcher,
conversation, worker, and observer screens.

The operator's submitted message appears once and never disappears. The broker still
owns every canonical Scout record. The existing client-generated `clientMessageId` connects the
local submission to the broker-returned conversation, message, invocation, and flight
IDs without contesting that authority.

Three truth planes stay orthogonal:

1. **Persistence:** did Scout accept and durably record the request?
2. **Execution:** is a concrete flight queued, starting, working, waiting, or terminal?
3. **Settlement:** has a user-visible reply or durable terminal explanation landed in
   the originating conversation?

One server-composed turn projection derives the restrained phase, copy, evidence,
fidelity, and available actions consumed by the thread, header, inspector, and
accessibility announcements. No surface derives its own competing answer.

The visual thesis is **one anchored turn**:

- the user bubble owns persistence;
- a single worker capsule immediately below it owns execution;
- the assistant reply or durable terminal card owns settlement;
- run details disclose evidence without pretending reconstructed data is live.

---

## 2. Job, audience, and success

### Audience

A high-trust developer operator has just handed work to an agent. They are usually
confident at send time, impatient during startup, curious during longer work, and
sensitive to any blank interval because it looks like data loss.

### Primary job

At every moment, answer four questions without requiring inference:

1. Is my exact request safely recorded?
2. What is Scout doing with it now?
3. What evidence supports that claim?
4. What can I safely do next?

### Proof of success

- The submitted bubble remains visible through route and canonical-ID changes.
- The UI never labels bookkeeping, polling, or a synthetic timestamp as worker activity.
- `Working` is backed by a current flight plus fresh liveness evidence.
- Every terminal execution produces either a reply or a durable explanation in the
  originating conversation.
- Reload, reconnect, response loss, and late replies reconcile without duplicates.
- The detailed observer says exactly what fidelity is available.

---

## 3. Product invariants

1. **Visible before network.** The local message bubble is inserted only after its
   retry envelope has been persisted locally, and before the request leaves the client.
2. **Canonical after acceptance.** Only the broker assigns canonical conversation,
   message, invocation, flight, and session IDs.
3. **Idempotent continuity.** Every submission carries one stable `clientMessageId`
   and a deterministic, persisted `deliveryRequestId`. Retrying an unconfirmed transport
   attempt cannot mint a second message or execution accidentally.
4. **Mutation response is authoritative.** A successful create/send response includes
   the canonical message, flight, and turn projection needed to render the destination.
5. **No post-write stale snapshot.** Broker-context caches are invalidated or updated
   before the successful mutation returns.
6. **No empty replacement.** A degraded, stale, or incomplete read may not replace a
   known pending/canonical message list with an empty list.
7. **Execution is not settlement.** `flight.completed` means the worker stopped
   successfully; it does not mean the user-visible reply has landed.
8. **Terminal outcomes persist.** Failed, cancelled, stale-reconciled, and completed
   without reply remain visible until explicitly superseded or dismissed.
9. **Actions are capabilities.** The UI renders an action only when the server returns
   a safe command or an explicit unavailable reason.
10. **Observed material stays observed.** Harness trace and transcript detail never
    become first-party Scout conversation messages by implication.
11. **Settlement is exactly linked.** A reply or status settles one attempt only when
    its canonical record links the originating message plus the exact invocation and
    flight. Actor/time heuristics may support degraded history, but may not claim settled.
12. **Accepted work has execution identity.** An accepted invoke-mode mutation returns
    its invocation and flight atomically. If a route is intentionally asynchronous, it
    returns a server-owned dispatch deadline and an explicit routing-delayed state.

---

## 4. Three orthogonal truth planes

These are not three badges. They are the inputs to one projected user-facing phase.

### Plane A — Persistence

| State | Authority | Meaning | Required evidence |
| --- | --- | --- | --- |
| `local_pending` | Client | Retry envelope is safely stored; network request has not been accepted. | Local pending record keyed by `clientMessageId` and `deliveryRequestId`. |
| `submitting` | Client | The request is in flight. | Active request using that same idempotency key. |
| `accepted` | Broker | Scout durably recorded the canonical message and request linkage. | Canonical `MessageRecord` plus returned IDs. |
| `rejected` | Broker/client transport | Scout did not accept the request. | Structured rejection or exhausted transport error. |
| `unknown` | Client projection | The transport deadline passed and reconciliation found neither acceptance nor rejection. | Persisted retry envelope plus a completed resolve attempt. |

`accepted` is already durable for the user-facing contract. Do not add a decorative
second “saved” phase unless the broker truly has a later durability boundary. The
projection also carries `intent: comment | invoke`: an accepted comment is complete as a
message-only turn; accepted invoke-mode work must have an invocation/flight or an
explicit routing-delayed deadline.

### Plane B — Execution

Reuse the broker flight vocabulary rather than creating a competing workflow enum:

| State/fact | Meaning in the conversation |
| --- | --- |
| no flight | Valid only for comment intent; for invoke intent this is routing-delayed or a contract failure. |
| `queued` | Scout accepted an invocation but no worker owns active execution yet. |
| `waking` | Scout is starting or attaching a compatible worker/session. |
| acknowledgement timestamp | A concrete endpoint/session accepted the request. This is evidence, not success. |
| `running` | The flight is active. `Working` additionally requires a fresh liveness signal. |
| `waiting` | The worker is explicitly waiting on a person, peer, approval, artifact, or condition. |
| `completed` | Execution ended successfully; settlement may still be pending. |
| `failed` | Execution cannot continue without a new request or recovery action. Stale reconciliation and empty broker-visible output are failed reasons, not new flight states. |
| `cancelled` | The caller, target, or operator stopped execution. |

The server provides `lastMeaningfulActivityAt` and `staleAfterMs`. The closed set of
facts allowed to refresh liveness is: flight start, dispatch acknowledgement, stable
session acknowledgement, timestamped harness event, explicit work update/checkpoint,
adapter heartbeat, or terminal transition. Poll timestamps, snapshot generation times,
and repeated synthetic events do not refresh liveness. When a target exposes no
heartbeat or observed events, the UI honestly degrades from Working to No recent update
after the server deadline even if the flight remains `running`.

### Plane C — Conversation settlement

This is a server projection over broker-owned messages, terminal flight facts, status
records, and outcome-delivery state. It does not turn a message into a mutable workflow
record.

| State | Meaning | Required evidence |
| --- | --- | --- |
| `none` | No terminal result is expected yet. | Flight is absent or non-terminal. |
| `awaiting_reply` | Execution completed and Scout has explicitly committed to producing an origin-conversation outcome. | Completed flight, `outcomeExpected: true`, no linked reply, and `replyGraceExpiresAt` in the future. |
| `settled` | The conversation contains the canonical reply or durable positive result for this exact attempt. | `MessageRecord.replyToMessageId` matches the origin and its `invocationId`/`flightId` linkage matches the attempt. |
| `unsettled` | Completion grace expired with no reply/result in the conversation. | Completed flight, no linked outcome after the server-provided deadline. |
| `failed` | A durable failure/delivery explanation exists in the origin conversation. | Failure status linked to the exact invocation/flight, including empty-output and stale-reconciled reasons. |
| `cancelled` | Cancellation is durably represented in the origin conversation. | Cancellation status linked to the request/flight. |

A late exactly-linked reply may move `unsettled` or `failed` to `settled` without
reopening or mutating the terminal flight. The reply becomes visible and the attempt
receipt reads `Reply arrived after run failure` when applicable. “Completed without a
reply” is a truthful current condition, not an irreversible verdict.

---

## 5. Derived phase precedence and exact copy

The turn projection evaluates these rules from top to bottom. The UI receives the
result; it does not repeat this logic.

| Priority | Derived phase | Primary label | Evidence/detail line | Default actions |
| ---: | --- | --- | --- | --- |
| 1 | Submission rejected | **Not delivered** | “Scout did not accept this message.” | Retry, Edit |
| 2 | Exactly-linked reply visible | **Completed in 35s** | Quiet receipt beneath the reply; append “after run failure” when applicable | Run details |
| 3 | Settlement failed, no linked reply | **Reply delivery failed** or **Run failed** | Compact broker-owned error summary | Retry delivery/run, Run details |
| 4 | Settlement cancelled, no linked reply | **Cancelled** | “Stopped at 20:15 · no reply posted” | Run again, Run details |
| 5 | Completed with committed outcome pending | **Completed · reply pending** | “The run ended; no reply is visible in this conversation yet.” | Run details |
| 6 | Completed after grace | **Completed without a reply** | “No reply has reached this conversation yet.” | Inspect run, Ask again |
| 7 | Explicit waiting | **Waiting for you** / **Waiting on …** | The broker-owned blocker or question | Answer, Run details |
| 8 | Active but stale | **No recent update** | “Last worker signal 1m ago.” | Run details, Stop when available |
| 9 | Running with fresh evidence | **Working** | Last verified phase/event and recency | Observe/Run details, Steer, Stop when available |
| 10 | Waking/acknowledged | **Starting @Agent** | “Worker connected” only after acknowledgement | Cancel when available, Run details |
| 11 | Queued/offline | **Queued for @Agent** | “Waiting for the agent to become available.” | Change target, Cancel when available |
| 12 | Invoke accepted, execution delayed | **Routing delayed** | Last verified routing fact and the server-owned dispatch deadline | Change target, Cancel/Run details when available |
| 13 | Comment accepted | **Posted** | “Recorded by Scout.” | None |
| 14 | Transport unresolved | **Delivery unknown** | “Scout could not confirm whether this message was accepted.” | Check again, Retry |
| 15 | Submitting | **Sending** | “Saving your message…” | Cancel only if transport is actually abortable |

Rules:

- Never use **Sent** as a synonym for broker acceptance or target acknowledgement.
- Never use **Working** solely because a flight, acknowledgement, poll, or timer exists.
- Do not show event counts when there are no observed events.
- Do not invent **Replying** from harness text deltas; those remain observed material.
- An exactly-linked visible reply outranks an earlier failed/cancelled attempt for
  conversation settlement; the attempt history still preserves the failure.
- Error and settlement states outrank activity. Activity outranks startup. Startup
  outranks optimism.
- Queued, Waiting, and No recent update share one restrained waiting visual family, but
  keep distinct labels because they describe materially different ownership.

### Initial timing recommendation

- **Startup soft cue:** after 8 seconds, detail changes to “Still starting @Agent.”
  This does not change canonical state.
- **Invoke acceptance:** message, invocation, and flight should be atomic. Where routing
  is intentionally asynchronous, the server returns a 15-second initial
  `dispatchDeadlineAt`; expiry writes a durable could-not-start outcome.
- **Unconfirmed transport:** after the request transport deadline (30 seconds initially),
  a completed indexed reconciliation with no broker record changes Sending to Delivery
  unknown. It never claims the broker is still pending.
- **Liveness stale threshold:** server-provided; use 60 seconds as the first fixed
  default, then move to harness-specific values only with measured heartbeat data.
- **Completion-to-reply grace:** begin only when the broker records
  `outcomeExpected: true`. Use 10 seconds as the conservative initial default, then set
  it from measured terminal-to-reply p99 plus margin. Show `Completed · reply pending`
  during the window; after the deadline show `Completed without a reply`.

All truth thresholds are server-owned projection inputs except the local transport
deadline. Client timers may update elapsed copy, but may not independently decide
broker or execution truth.

---

## 6. The conversation composition

### One anchored turn

```text
                                      ┌────────────────────────────────────┐
                                      │ @Arach                             │
                                      │ Create a better attribution model… │
                                      └────────────────────────────────────┘
                                               Accepted · 20:15:09

┌──────────────────────────────────────────────────────────────────────────┐
│ [Tesla]  Working · 38s                                                   │
│ Last verified: running a command · 4s ago                               │
│ Session connected · detailed activity unavailable                       │
│                                              Run details  Steer  Stop    │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│ [Tesla]  Yes — I think this is a correctness problem…                    │
└──────────────────────────────────────────────────────────────────────────┘
Completed in 35s · Run details
```

The worker capsule occupies one stable location below the originating user message.
It morphs between startup, work, waiting, and terminal states rather than disappearing
and spawning unrelated placeholders.

One turn may contain multiple execution attempts, but only the newest viable attempt
owns the full capsule. Superseded attempts collapse into a quiet history row—
`Attempt 1 failed · Run details`—inside the same anchored turn. Run details retains the
complete attempt chronology. A successful retry receipt may read
`Completed on attempt 2 in 1m 12s`.

### User bubble

- Appears immediately with the exact submitted body and attachments.
- Carries the persistence label below the bubble: `Sending`, `Accepted`, or
  `Not delivered`.
- An optimistic bubble is never styled as fully canonical without a persistence label.
- On acceptance, it adopts the canonical `messageId` in place; no DOM replacement,
  scroll jump, or duplicate animation.
- On failure, the bubble remains. The original composer draft and attachment handles
  are restored, with Retry and Edit actions.

### Worker capsule

- Appears only when execution is requested or a flight exists.
- Uses Signal Lime for active work, status amber for waiting/stale, status red for
  failure, and status green only for a settled positive outcome.
- Contains one primary phase, one verified detail line, elapsed time, and at most three
  immediately useful actions.
- Technical identifiers and the full event timeline stay behind Run details.
- It never shows an animated ellipsis without a corresponding execution fact.

### Assistant reply and terminal receipt

- On canonical reply arrival, the reply appears before the working capsule collapses.
- The capsule transforms into a quiet receipt attached beneath the reply:
  `Completed in 35s · Run details`.
- There is no separate Answered badge once the reply bubble is visible; the reply is the
  answer and the receipt records execution closure.
- Failure, cancellation, or completion without reply remain as full-width terminal
  cards because they carry recovery actions.
- The final receipt is durable in the projection but visually subordinate to the reply.

### Header and right inspector

- The thread is the primary status surface. Remove the duplicate status-strip story.
- The header may show one compact mirrored summary—`Tesla · Working · 38s`—that scrolls
  to the active turn. It uses the same projection and contains no separate logic.
- The right inspector shows route, session, evidence fidelity, last verified event,
  and action explanations. It does not restate the entire worker capsule.

### Initial route and loading

- Navigation carries the accepted turn projection into the destination before mount.
- The submitted bubble and capsule render while older history loads.
- Skeletons are allowed only for unknown older history or secondary panels. They never
  replace a known submitted turn.
- Metadata, messages, flights, and fleet data settle independently. Fleet latency cannot
  blank the transcript.

---

## 7. Composer behavior

### Ordinary send

1. Generate the existing wire key `clientMessageId`.
2. Derive and persist the deterministic `deliveryRequestId` with the same envelope.
3. Persist the minimal retry envelope locally before clearing the composer.
4. Insert the user bubble and keep focus in the composer.
5. Submit using that exact identity pair.
6. Merge the authoritative response into the pending turn.
7. Remove local body/attachment material after the canonical mapping is confirmed.

Persist attachment handles/references, not duplicate attachment bytes. Pending content
is removed after acceptance or explicit dismissal. The envelope has a bounded local
retention/attachment TTL and is treated as sensitive content on shared machines.

Transport retry and execution retry are different:

- Before broker acceptance is known, Retry reuses the same `clientMessageId` and
  `deliveryRequestId`; a changed ID pair is an idempotency conflict, not a fresh post.
- After an accepted attempt fails, Run again creates a new invocation attempt linked to
  the same originating message. If the command itself requires a new delivery record,
  it receives a new client message identity linked by `retryOfInvocationId`; it never
  creates a duplicate user bubble.

### Steer mode

`Steer` is a real composer mode, not a focus shortcut.

```text
[ Steering Tesla on the current run  × ]
Add a correction or new constraint…                         Send steer
```

- Enter sends a steer command tied to the active flight/session.
- Escape or the × exits steer mode without losing the draft.
- The posted instruction receives its own acknowledgement receipt.
- If steering is unavailable, the action is omitted from the primary row; the inspector
  may explain why under unavailable actions.

### Queued follow-ups

- Composer mode reads `Queue after this turn`.
- Queued drafts remain visibly stacked above the composer with Edit and Remove.
- Each row names its owner turn: `Queued after Tesla’s run` and, after a negative
  terminal outcome, `Queued after Tesla’s run · Held`.
- They send in order only after successful settlement.
- On failure, cancellation, or completion without reply they become **Held** and require
  `Send anyway`, `Retarget`, or `Discard`. They never fire automatically into a broken
  turn.

### Stop/cancel

- A safe server-returned stop action opens a compact inline confirmation:
  `Stop Tesla’s current run? Keep queued follow-ups held.`
- After confirmation, the control becomes `Stopping…` and cannot double-submit.
- The durable terminal result replaces it with `Cancelled` or a structured failure.

---

## 8. Run details and evidence fidelity

Rename the user-facing destination from a blanket **Live trace** to **Run details**.
The detail screen may promote itself to Live activity only when the source qualifies.

| Fidelity | What exists | Label | Motion/playback | Conversation action |
| --- | --- | --- | --- | --- |
| `lifecycle_only` | Broker request, routing, acknowledgement, and terminal facts | **Broker timeline** | No live pulse; no playback bar | Run details |
| `session_attached` | Concrete harness session reference, no timestamped activity | **Session connected · detailed activity unavailable** | No fake events or playback | Open session / Run details |
| `observed_recorded` | Stable timestamped harness events | **Recorded activity** | Playback only with multiple meaningful events | Open activity |
| `observed_live` | Fresh streamed events from the active worker | **Live activity** | Live pulse; elapsed/live controls | Observe live |

Requirements:

- Fidelity is returned by the server with its source references; the view never guesses.
- Synthetic/reconstructed lifecycle facts are real evidence but are labeled as broker
  timeline, never Live.
- Fixture/demo data, if ever shown, has a separate `Sample data` label and no run action.
- Registration and attachment timestamps come from stable records. They may not use
  `Date.now()` on refresh.
- Zero-event screens explain the strongest known fact: `Worker connected; Scout has no
  detailed activity from this harness.`
- Turns/tools/reads/edits counters disappear when unavailable; zero means measured zero,
  not unknown.
- Playback speed controls appear only for recorded timelines with enough duration to
  make playback meaningful.

---

## 9. Identity, reconciliation, and API contract

### Stable client key

Use the existing wire name `clientMessageId`; do not introduce a parallel
`clientRequestId`. It is generated before submission and copied into the canonical
message plus related delivery/invocation metadata. It is an idempotency and
reconciliation key, not a public conversation identifier.

The local envelope also persists the exact `deliveryRequestId`. The first implementation
may continue deriving it deterministically from `clientMessageId`, but every client must
use the same derivation and retry the same pair. The broker enforces one indexed scope—
requester plus `clientMessageId`—with these outcomes:

- same client/delivery pair: return the original canonical message, invocation, flight,
  and turn projection;
- same client key with a different delivery ID or materially different payload: return
  an idempotency conflict; never create a second message silently;
- new execution after a terminal accepted attempt: create a new invocation attempt,
  not a transport retry.

Add an indexed resolve/read path for `clientMessageId`; startup recovery must not scan
all message metadata.

### Canonical response

The send/create response must return, atomically from the UI's perspective:

| Field | Purpose |
| --- | --- |
| `clientMessageId` and `deliveryRequestId` | Confirm which pending envelope this response resolves and which broker transaction it addresses. |
| `canonicalConversationId` | Destination route and cache key. |
| `equivalentConversationIds` | Server-authoritative conversation IDs that map to the same broker thread projection; distinct from UI route aliases. |
| canonical message projection | Replaces optimism in place. |
| `invocationId` and `flightId` for invoke intent | Connect the request to the first execution attempt; absence is an explicit routing-delayed/error contract, not ordinary Accepted. |
| composed turn projection | Seeds the entire visible status story. |
| conversation revision/event cursor | Orders subsequent reads and events. This is a required new feed contract, not an existing protocol guarantee. |

The response is merged before navigation. Canonicalization migrates pending state, queued
drafts, scroll target, attachments, and receipts as one transaction.

### Lost-response recovery

The load-bearing edge case from the Opus review is: the broker accepts the request, but
the client crashes or loses the response before saving the canonical mapping.

On startup or reconnect, the client resolves every outstanding `clientMessageId` plus
its persisted `deliveryRequestId` through the indexed broker read:

- if the broker finds it, adopt the canonical conversation/message/flight;
- if it was rejected, preserve the draft and show `Not delivered`;
- if the broker has no record after the transport deadline, show `Delivery unknown`;
  Retry uses the same identity pair only after policy permits it.

The broker does not claim “still pending” merely because it has no record. Correct
idempotency without this indexed reconciliation path still allows an accepted request
to appear lost after client termination.

### Read and event consistency

- Successful broker writes invalidate/update the five-second context cache before
  returning.
- Add a monotonic conversation-feed revision/event cursor; the current protocol's route
  alias revisions are not a substitute.
- Reconnect performs a catch-up read or an authoritative refresh; SSE is acceleration,
  not the sole source of truth.
- Equivalent conversation IDs are supplied by the broker projection and used for both initial
  reads and live-event matching.
- Stale or degraded projections are explicitly marked and cannot erase newer client
  state.

### Turn projection

The shared projection contains:

- originating and exactly-linked reply/status message IDs;
- canonical conversation ID plus broker-equivalent IDs;
- `clientMessageId`, delivery request ID, and `intent: comment | invoke`;
- attempt lineage keyed by invocation and flight, including the one active/latest attempt;
- exact `outcomeInvocationId` and `outcomeFlightId` for settled messages/status;
- persistence, execution, and settlement facts;
- derived phase key, label, detail, tone, start time, and last verified time;
- evidence fidelity and source references;
- available and unavailable actions with command IDs and denial reasons;
- stale and reply-grace deadlines;
- dispatch and local-transport deadlines where applicable;
- one accessibility announcement string;
- projection revision/cursor and degraded-state warnings.

The conversation feed, header, inspector, notification summary, and native embeds consume
that same shape.

---

## 10. Action contract and recovery matrix

| Condition | Durable visual | Recovery behavior |
| --- | --- | --- |
| Client/network rejection | User bubble remains: `Not delivered` | Restore draft and attachments; transport Retry uses the same `clientMessageId`/`deliveryRequestId`; Edit starts a new logical message only after confirmation. |
| Transport result unknown | User bubble remains: `Delivery unknown` | Indexed reconciliation first; Retry reuses the exact identity pair and cannot double-post. |
| Invoke accepted without flight | `Routing delayed` until the broker deadline, then durable `Could not start` | Change target, cancel, or inspect routing. Atomic invoke acceptance should make this exceptional. |
| Queued until offline agent returns | `Queued for @Agent` | Change target or cancel when broker supports it. No working animation. |
| Startup takes longer than expected | `Still starting @Agent` | Run details exposes last routing fact. Do not offer Retry while the same flight remains viable. |
| Worker goes stale | `No recent update · last signal …` | Inspect or stop. If broker reconciliation terminates it, show failed with the recorded stale/reconciled reason; do not invent a lost FlightState. |
| Worker asks a question | `Waiting for you` plus question | Answer is the primary action and resumes the same work linkage. |
| Flight completes with explicit outcome commitment before reply | `Completed · reply pending` | Hold capsule through grace; atomically reveal the exactly-linked reply and collapse receipt. |
| Flight completes without reply | Persistent terminal card | Inspect run or ask again. A late linked reply may settle it later. |
| Empty broker-visible output | Persistent `Run failed` card | Use the broker's empty-output failure reason; never call this successful completion without reply. |
| Flight fails | Persistent failure card with bounded summary | Run again creates a new invocation/flight attempt linked to the same origin; the previous attempt collapses into Run details history. |
| Failed attempt later receives an exactly-linked reply | Reply renders with `Reply arrived after run failure · Run details` | Conversation is settled; terminal flight history remains failed and is not reopened. |
| Cancellation | Persistent cancelled card | Run again creates an explicit new attempt; queued drafts stay held. |
| Reply/outcome delivery fails | `Reply delivery failed` | Retry delivery, not execution, when the run itself succeeded. |
| Broker/SSE disconnect | Existing content remains; `Updates paused` in inspector/header | Reconcile on reconnect. Do not convert running to failed solely from client disconnection. |

The server returns actions with availability. The primary row shows only usable actions.
Unavailable actions may appear in Run details with their denial reason; they are never
prominent dead buttons.

Notification `replyMode` does not determine conversation settlement. For an invoke-mode
turn with an originating conversation/message, settlement is based on the canonical
reply/status record even when notification delivery is `inline` or `none`. Invocations
without an originating conversation or expected reply are outside this inline-turn
contract.

---

## 11. Visual system and motion

- Preserve the Lit Control Room canvas, flat hairline surfaces, compact Inter/JetBrains
  hierarchy, and the existing agent identity treatment.
- **Signal Lime** means actively working, not completed/good.
- **Status OK green** is earned by a settled positive outcome.
- **Status Warn amber** covers queued, waiting, and stale attention states.
- **Status Error red** covers rejection and terminal failure.
- Neutral accepted/submitting states use ink/muted ink rather than premature color.
- The worker capsule is one flat lifted surface, not another dashboard card stack.
- IDs, timestamps, and fidelity labels use the mono voice; human copy remains Inter.

Motion is structural:

- Insert the optimistic bubble without moving older messages.
- Morph the capsule in place over the standard 150–220ms duration.
- Cross-fade `Completed · reply pending` into the assistant reply/receipt without an
  empty frame.
- Do not use bounce to imply thinking or progress.
- Under `prefers-reduced-motion`, all transitions become immediate opacity changes and
  live pulses stop.

---

## 12. Accessibility and responsive behavior

### Announcements

- Use one conversation lifecycle live region (`aria-live="polite"`, atomic) fed by the
  turn projection.
- Announce phase transitions only: `Message accepted. Starting Tesla.` Do not announce
  elapsed timer ticks or every trace event.
- Rejection, failure, and lost draft errors use an assertive alert once.
- Waiting questions move focus only when the operator invokes Answer; background arrival
  must not steal focus.

### Keyboard and focus

- Sending preserves composer focus.
- Send failure restores the draft and keeps focus in the composer; the error is linked
  with `aria-describedby`.
- Steer mode has an explicit label, Escape exit, and `Send steer` button text.
- Every action has a unique accessible name including the agent/run where needed.
- Run details returns focus to the action that opened it.

### Responsive

- On narrow widths, capsule actions collapse into one primary action plus an overflow
  menu; phase and evidence never disappear.
- The right inspector becomes a sheet, but the inline turn remains complete.
- Long technical detail truncates in the capsule and expands in Run details.
- User/assistant messages may widen beyond the current narrow island on ultrawide
  displays while preserving readable line length.

---

## 13. Instrumentation

Capture timing and reconciliation without logging message bodies:

- submit → local pending persisted;
- submit → broker accepted;
- accepted → accepted bubble visible after navigation;
- accepted → dispatch/wake/acknowledgement;
- acknowledgement → first meaningful observed activity;
- age of last meaningful activity when phase changes;
- flight terminal → canonical reply committed;
- completion grace expirations and late settlements;
- pending reconciliation result: adopted, retried, rejected, or unresolved;
- idempotency replay/conflict by stable client/delivery identity pair;
- invoke acceptance missing invocation/flight and dispatch-deadline expiry;
- optimistic duplicate and disappearance guards;
- outcome commitment → terminal → exactly-linked reply, including late settlement;
- active-attempt changes and superseded-attempt collapse;
- observer opens by fidelity rung;
- action offered, invoked, accepted, failed, and denied;
- held follow-up outcomes after non-successful settlement.

The headline quality metric is **visible request continuity**: time during which an
accepted request has neither its user bubble nor a linked terminal/reply representation
on screen. Target: exactly zero.

---

## 14. Verification and acceptance tests

### Projection unit tests

- Table-drive every three-plane combination and phase-precedence rule.
- `Working` is impossible without a running flight and fresh liveness.
- Completion with an explicit outcome commitment projects `Completed · reply pending`;
  after grace it projects `Completed without a reply`; a late exactly-linked reply
  renders the reply plus the quiet completion receipt without reopening the flight.
- A linked reply present alongside a failed attempt settles the conversation while
  preserving `Reply arrived after run failure` in attempt history.
- Invoke intent cannot remain in actionless Accepted: it has a flight, Routing delayed
  with a deadline, or a durable could-not-start outcome.
- Action availability and denial reasons come only from the server action contract.
- Fidelity mapping never promotes lifecycle/session attachment to Live.

### Client reducer/store tests

- Pending turn migrates from provisional route to canonical conversation without DOM
  duplication or loss.
- The broker-returned `messageId` reconciles the exact optimistic row by
  `clientMessageId`, even when two messages have identical bodies.
- Superseded attempts collapse while the latest viable attempt owns the full capsule.
- A stale/empty response cannot erase a newer pending/canonical row.
- Send failure restores text and attachment handles.
- Queued follow-ups become Held after failure/cancellation.

### Broker/API integration tests

- Write followed immediately by conversation/messages read returns the new message and
  flight despite the context cache.
- Duplicate submission with one `clientMessageId`/`deliveryRequestId` returns the same
  canonical message and logical invocation; a mismatched pair returns conflict.
- Same client key with a regenerated delivery ID never falls through to a second write.
- Lost mutation response reconciles through the indexed `clientMessageId` lookup after
  reload without scanning message metadata.
- Canonical conversation mapping and equivalent IDs are identical in mutation, read,
  and SSE paths.
- A reply settles exactly one attempt through origin message + invocation + flight
  linkage; one reply cannot silently complete two concurrent invocations.
- Empty consult output records a failed flight and durable origin status.
- A terminal flight ignores later non-terminal updates; a delayed linked reply settles
  the conversation without resurrecting execution.
- Every started flight becomes terminal, including stale-worker reconciliation after
  broker restart, with failure reason metadata the projection can explain.
- Negative outcomes are mirrored durably into the originating conversation.

### End-to-end scenarios

1. **Captured normal path:** submit → accepted → start → work → complete → reply with a
   forced 322ms delay. No blank frame and no worker-card disappearance.
2. **Five-second stale-cache reproduction:** warm the pre-write snapshot before submit.
   The destination still renders the accepted turn immediately and the first read is
   authoritative.
3. **Response lost after broker acceptance:** kill the client before response handling,
   reopen, and adopt the canonical request through `clientMessageId` plus the persisted
   delivery request ID.
4. **Worker killed mid-run:** phase degrades to No recent update, then a durable lost or
   failed terminal state; never remains Working forever.
5. **SSE gap:** disconnect, post reply, reconnect, and settle from catch-up without
   navigation.
6. **Completed without reply:** pass the grace deadline, show recovery, then post a late
   linked reply and settle cleanly.
7. **Synthetic observer fallback:** show broker/session fidelity, no live dot, no fake
   timestamps, no meaningless playback controls.
8. **Accessibility:** one phase announcement per transition, assertive error once,
   stable focus, reduced motion, and keyboard-complete steer/stop flows.
9. **Multiple attempts:** fail attempt 1, start attempt 2, and deliver a late exactly-
   linked reply. Only the latest viable attempt owns the full capsule; history and
   settlement remain unambiguous.
10. **Comment vs invoke:** an accepted comment settles as Posted without a worker card;
    accepted invoke intent cannot stop at an actionless Accepted phase.

### Visual acceptance

- The user message occupies the same position and identity from send through settlement.
- At no point does the thread show an empty state while a known pending turn exists.
- There is one dominant status story, not competing header/card/composer statuses.
- Every status label is backed by visible evidence or explicitly says evidence is
  unavailable.
- Terminal outcomes remain actionable after reload.

---

## 15. Phased implementation order

Each phase should be independently truthful; avoid shipping decorative status before
the record contract supports it.

### Phase 0 — Consistency prerequisites

- Invalidate/update broker context after writes.
- Refresh messages during outstanding turns and after SSE reconnect.
- Align equivalent-conversation matching across initial and live paths.
- Prevent degraded/empty reads from overwriting newer state.

### Phase 1 — Submission continuity

- Standardize the existing `clientMessageId` plus deterministic `deliveryRequestId`
  idempotency pair and add its indexed broker resolve path.
- Add the privacy-bounded local pending-turn store.
- Return and hydrate the canonical message/flight projection before navigation.
- Migrate provisional/canonical route state and reconcile by ID.
- Restore failed drafts and attachments.

### Phase 2 — Shared turn projection

- Add exact outcome linkage by originating message, invocation, and flight; do not use
  actor/time heuristics to claim settlement.
- Add invocation/flight attempt lineage and the conversation-feed revision/cursor.
- Compose the three planes and derived phase server-side.
- Feed the conversation, header, inspector, and accessibility live region from one
  projection.
- Replace bookkeeping-based activity counts and surface-local heuristics.

### Phase 3 — Settlement and recovery

- Add the completion-to-reply grace contract.
- Persist negative terminal outcomes in the originating conversation.
- Add Held follow-ups, retry semantics, explicit steer mode, and capability-backed
  actions.

### Phase 4 — Honest run details

- Introduce fidelity rungs and stable source timestamps.
- Replace blanket Live trace copy with Run details/Recorded activity/Live activity.
- Gate counters, playback, terminal, and steer affordances on actual capability.

### Phase 5 — Visual consolidation and cross-surface adoption

- Collapse duplicate status strips into the anchored turn composition.
- Apply the same turn projection to channel, agent-message, macOS embed, and iOS thread
  surfaces as their shared feed work lands.
- Add production telemetry and tune thresholds from real distributions.

---

## 16. Boundaries and anti-goals

- Do not make the client a canonical writer.
- Do not invent one mutable “message status” field that conflates the three planes.
- Do not import full external harness transcripts into Scout conversation history.
- Do not promise exactly-once distributed delivery; provide idempotent local submission
  and explicit lifecycle records.
- Do not turn the conversation into a raw trace viewer or generic workflow dashboard.
- Do not render actions that have no safe broker command.
- Do not use animation as proof of activity.
- Do not add a new top-level Run product noun to solve an inline conversation problem.

---

## 17. Decisions to confirm

1. **Threshold bundle:** begin with a 15s asynchronous dispatch deadline, 30s local
   transport-unknown deadline, 60s liveness-stale threshold, and 10s committed-outcome
   grace. Keep broker/execution thresholds server-owned and tune from telemetry.
2. **Trace-silent harnesses:** after the liveness deadline, show No recent update even
   while the canonical flight remains running. This is the honest default.
3. **Settled receipt:** keep `Completed in … · Run details` beneath the canonical reply
   as the durable but quiet end state.
4. **Pending recovery and privacy:** persist the minimal retry envelope—including body
   and attachment handles—until reconciliation/dismissal, with a 24-hour maximum TTL
   and explicit clearing on shared-machine sign-out/reset.
5. **Multiple attempts:** show only the latest viable attempt as the full capsule and
   collapse prior terminals into Run details history.

Reply linkage, idempotency identity, accepted-invoke execution identity, and feed cursors
are engineering correctness contracts, not optional product choices.

---

## 18. Collaboration record

- Initial Opus direction established the three orthogonal planes, evidence-gated
  Working state, fidelity ladder, idempotent reconciliation, and terminal guarantee.
- Coordinator review rejected client-owned canonical IDs, ambiguous Sent copy,
  sample/demo treatment of reconstructed evidence, unowned partial replies, dead
  actions, terminal/reply collapse, and surface-local derivation.
- Opus accepted all seven corrections in the second room pass.
- Opus identified the lost-response edge case: broker acceptance can still appear lost
  when the client dies before persisting the canonical mapping. This brief adopts
  pre-submit local persistence plus startup reconciliation by `clientMessageId`.
- Kimi affirmed the architecture and accessibility direction, then found the
  actionless accepted-without-flight hole, redundant Answered label, multi-attempt
  capsule collision, unbounded local Sending state, and missing exact reply linkage.
- Grok confirmed those gaps in protocol terms and found the existing
  `clientMessageId`/`deliveryRequestId` identity pair, conditional idempotent replay,
  actor/time-based reply heuristic, empty-output failure behavior, lack of feed cursors,
  and one-flight-per-invocation attempt model.
- Accepted: unify on existing client identity, add indexed reconciliation, exact outcome
  linkage, attempt lineage, explicit invoke/comment intent, delivery-unknown and
  routing-delayed states, truthful empty/stale failure reasons, and a conservative
  outcome grace gated by broker commitment.
- Partially accepted: Kimi's suggestion to collapse Queued, Waiting, and No recent
  update into one label. They now share one visual family but keep distinct copy because
  ownership differs materially.
- Rejected: shipping reply-pending UI before the broker records an explicit expected
  outcome, and treating a stale worker as a new lost/expired FlightState.
