# Human-message lifecycle and macOS Comms correctness — review

**Date:** 2026-07-25
**Scope:** review only, no implementation edits.
**Caveat:** the worktree is dirty (`ConversationScreen.tsx` carries 42 uncommitted lines, `observe/service.ts` 168). All line references below are against the **working tree**, not `origin/main`.

---

## 1. The correct state machine and the source of truth

The product is trying to put a lifecycle on the wrong object. A message is an immutable
utterance; a lifecycle is a mutable record. Today they are collapsed, so there is nowhere
durable to write "requesting a reply" and nowhere to read it from.

**Two linked records, both broker-canonical:**

| Record | Role | Mutability |
| --- | --- | --- |
| `MessageRecord` (`packages/protocol/src/messages.ts`) | the utterance: body payload + explicit routing | immutable |
| `CollaborationRecord` (`packages/protocol/src/collaboration.ts:72-104`) | the lifecycle | mutable |

The lifecycle vocabulary already exists and is correct:

- `WorkItemRecord.state`: `open | working | waiting | review | done | cancelled` (`collaboration.ts:13-19`)
- `QuestionRecord.state`: `open | answered | closed | declined` (`collaboration.ts:21-25`)
- `acceptanceState`: `none | pending | accepted | reopened` (`collaboration.ts:7-11`), deliberately
  separate from workflow state so "replied" and "satisfied" do not collapse.

**What is missing is the projection**, not the model. The UI needs a *derived* per-message
status computed in exactly one place server-side, so web, macOS, and iOS cannot disagree:

```
status(message) = f(message, collaborationRecord?, invocation/flight?, deliveryReceipt)

comment_only  ← no requested work: send mode message/comment, no invocation, no collaboration record
requesting    ← collaboration record open, acceptanceState none|pending, no invocation started yet
working       ← live invocation/flight OR work_item.state = working OR question accepted
waiting       ← work_item.state = waiting (waitingOn present)
blocked       ← delivery rejected/unavailable/unassigned, flight queued_until_online, or unresolved targets
failed        ← delivery accepted=false, or flight terminal-failed with no reply
replied       ← a message with replyToMessageId = this.id exists, OR question.state = answered,
                OR work_item.state ∈ {review, done}
```

Two rules make this honest in both directions:

- **No false `working`.** `working` requires a *live* invocation or an explicit agent-reported
  transition, and carries a staleness deadline. Past the deadline with no update it degrades to
  `waiting` / "no recent update" — it never sits confidently on `working`. Precedent exists at
  the conversation level (`conversation-model.ts:727-741`); it is simply not per-message.
- **No silent loss.** Every terminal negative outcome must be written into the *originating*
  conversation. The system conversation may remain a global audit log, but it must never be the
  only home for a failure.

Derived status is never stored on the message; the message stays immutable and body text stays payload.

---

## 2. Root causes, by severity

### S1 — Failure notices are structurally invisible in every surface

- `packages/runtime/src/broker-operator-attention-service.ts:107-140` — `recordDeliveryIssue` posts
  every delivery failure into the **system** conversation and nowhere else.
- `packages/runtime/src/scout-broker.ts:1155-1171` — that conversation is `kind: "system"`,
  `visibility: "system"`.
- `packages/web/server/core/conversations/service.ts:796-798` — `getScoutConversations` hard-returns
  `[]` for `kind === "system"`; `DEFAULT_CONVERSATION_KINDS` (`:99-104`) excludes it, so even an
  explicit `kinds` filter cannot surface it.

Net: the failure exists durably in the broker and is unreachable from web *and* macOS Comms. The
originating conversation gets no marker at all. This is the "four failure notices went to a separate
hidden system conversation" line item, and it is by construction, not by accident.

### S1 — `@openscout` / `@scout` reports success for work nothing will execute

- `packages/runtime/src/broker-conversation-helpers.ts:126-143` — `@scout` / `@openscout` classify as
  the local **product** target.
- `packages/runtime/src/broker-delivery-acceptance-service.ts:512-583` — that branch posts the message
  into the dispatcher conversation, creates **no invocation and no work item**, unconditionally queues
  `queueOperatorDeliveryIssue({kind:"unassigned_scout"})` (`:557-564`), and then returns
  **`accepted: true`** (`:566`).

The sender gets a success receipt; the operator gets a hidden failure notice; the human message is
left in a state no surface can read. This is the exact shape of the four failed work-item requests.

### S1 — The live message filter uses strict id equality; the read path merges equivalent ids

- Read path merges channel-equivalent conversations:
  `packages/web/server/core/conversations/service.ts:871-874` (`equivalentNamedConversationIds`).
- Live path does not: `packages/web/client/screens/chat/ConversationScreen.tsx:874` —
  `if (message.conversationId !== conversationId) return;`

A reply posted to a sibling conversation sharing the natural key is in the broker, appears in the
initial fetch, and is **dropped from every live update**. Mounted thread → user-only transcript.

### S1 — The outstanding-turn poll cannot see new messages

- `ConversationScreen.tsx:1003-1005` polls `load({ messageMode: "none", includeMetadata: false })`.
- `load` resolves that mode to the cache, not the network:
  `ConversationScreen.tsx:277`, `:316-318`, `:320-325` → `Promise.resolve(cachedMessages)`.

Flights and fleet refresh; **messages do not**. The one moment the UI is certain a reply is
outstanding is the one moment it stops reading messages.

### S1 — No resync after an SSE gap

- `packages/web/client/lib/sse.ts:50-56` reconnects on error but there is no replay, no `since`
  cursor, and no consumer-side refetch on reconnect.
- `ConversationScreen` has no reconnect hook.

Any `message.posted` emitted during a broker restart or WS drop is lost from a mounted view
permanently. Combined with the poll defect above, there is no second chance.

### S2 — The macOS embed has no working refresh path

- `apps/macos/Sources/Scout/ScoutRootView.swift:2371-2380` mounts `/embed/thread` with
  `showsHeader: false`, which hides the only manual Reload control
  (`apps/macos/Sources/Scout/ScoutWebEmbedView.swift:202-204`).
- The embed's only auto-reload triggers are `colorScheme`, `loadingLaneSize`, and
  `embedQueryFingerprint` (`ScoutWebEmbedView.swift:169-177`). None fire on app activation.
- The web-side fallback (`ConversationScreen.tsx:1009-1029`) listens on `window` `focus` and
  `document` `visibilitychange`. In a WKWebView that stays in the view hierarchy these effectively
  do not fire on app switch.

So once a gap opens, only switching conversations (which re-keys the view via
`ScoutRootView.swift:2379` `.id(conversationId)`) repairs it. That matches the reported symptom
precisely: seven replies present in the broker, invisible in macOS.

### S2 — The cache-freshness check is structurally wrong for channels and for a lagging projection

- `ConversationScreen.tsx:305-318` decides whether to refetch by comparing the cached tail against
  `meta.lastMessageAt`.
- `packages/web/server/create-openscout-web-server.ts:6369-6374` — `/api/session/:id` prefers
  `querySessionById` (SQLite projection) over the broker summary.
- `packages/web/server/db/sessions.ts:489-494` — that projection computes `last_message_at` from
  `messages WHERE conversation_id = ?`: strictly per-id, **no sibling merge**, and behind the broker.

Result: on remount with a warm cache, `messageMode: "initial"` concludes the cache is current and
skips the refresh, re-rendering the stale tail.

### S2 — `ask` on the conversation summary has never been implemented

- Type defined: `packages/web/server/core/conversations/service.ts:32-36`, field at `:76-77`.
- Producer: `:736` `const askField = {};`, spread inertly at `:783` and `:824`.
- `git log -S askField` returns a single commit (`60e0bc94`) — it was introduced empty and has never
  carried a value.

No surface can honestly render "needs reply" at the list level today. Everything at
`:697-699` needed to compute it (invocations, flights, collaboration records) is already loaded.

### S2 — A human question in a non-DM thread is a comment by construction, and unoverridable

- `create-openscout-web-server.ts:2696-2703` — not operator-direct and no explicit target ⇒ `"message"`.
- `create-openscout-web-server.ts:7065-7070` — `/api/chats/:chatId/messages` never forwards
  `requestedSendMode`, so the thread composer cannot ask for `invoke` even in principle.
  (`/api/send` does forward it — `:7118`.)
- `conversation-model.ts:157-163` mirrors this client-side (`!isDm → "message"`), so
  `awaitingResponseSince` is never set (`ConversationScreen.tsx:1074-1076`).

The message posts, nothing is requested, nothing is expected, and nothing says so. This is the
"two questions became passive comments with no invocation" line item.

### S2 — A reply is a message, not a transition

- `broker-delivery-acceptance-service.ts:373-431` — the `--ref` path correctly posts into the origin
  conversation with `replyToMessageId` (`:390`), but writes **no** `workId` / `collaborationRecordId`
  and advances **no** collaboration record.
- The delivery path *does* stamp `collaborationRecordId` / `workId`
  (`broker-delivery-acceptance-service.ts:828`) — and nothing in
  `packages/web/client/screens/chat/**` ever reads it. Only the separate `/work` surfaces do.

Consequence: commit `462e535b` landing with no broker completion message is **expected behavior**,
not one agent's lapse. Nothing derives "done", and nothing surfaces "still open".

### S3 — Silent fallthrough on an unresolvable `ref:`

`broker-delivery-acceptance-service.ts:377-378` — if the referenced message's conversation is missing
from the snapshot, the branch falls through to generic target resolution, where `msg-…` is not an
agent label ⇒ `unknown` ⇒ rejected ⇒ hidden system notice. A reply can disappear.

### S3 — Delivery receipts are ephemeral

`ConversationScreen.tsx:1106-1123` renders `unresolvedTargets` as a transient `sendReceipt`, cleared
on conversation change (`:446-452`). The product's only "posted but not delivered" signal dies on
navigation.

### S3 — Degraded transcripts are cached as authoritative

`create-openscout-web-server.ts:5736-5742` — when the broker is unavailable
`getScoutConversationMessages` returns `null` and the route silently falls back to the SQLite
projection with no degraded marker; the client then caches that as truth
(`packages/web/client/lib/chat-cache.ts:109-111`).

---

## 3. The solution shape

Three moves, in this order:

**a. Close the read-path holes so the client cannot be confidently stale.**
Refresh messages on the outstanding-turn poll; resync on WS reconnect; match live events against the
equivalent-id set; fix the freshness comparison at its source. Cheap, mechanical, and it alone would
have prevented the seven invisible replies.

**b. Make every negative outcome durable in the originating conversation.**
The broker stays the canonical writer — this is a broker write, not a client-side fabrication. Post a
`class: "status"` broker message anchored with `replyToMessageId` to the human message, carrying
`metadata.deliveryIssueKind`, *in addition to* the system-channel audit record. Stop returning
`accepted: true` for a target that will never execute.

**c. Project a per-message status and render it.**
One server-side derivation (§1), consumed by all three clients. The staleness deadline is what keeps
`working` honest; requiring a live invocation or an explicit agent transition is what keeps
`requesting`/`working` from being asserted on a message that was only ever a comment.

Avoiding both failure modes at once reduces to a single discipline: **the indicator is derived, never
asserted.** A message shows `working` only while something live corroborates it, and shows
`comment_only` — not a blank — when nothing was requested.

---

## 4. Must-fix versus follow-up

**Must-fix (correctness: silent loss or false indicator)**

1. `ConversationScreen.tsx:1004` — poll with `messageMode: "refresh"`. One line; removes the worst staleness.
2. `lib/sse.ts` — expose connection state; force `load({messageMode:"refresh"})` on every (re)connect, and mark the thread degraded while disconnected.
3. `ConversationScreen.tsx:874` — match against the conversation's equivalent-id set (surface it on `ScoutConversationSummary` / `/api/session/:id`).
4. `broker-delivery-acceptance-service.ts:557,692,749` — mirror the delivery issue into the originating conversation, anchored to the human message.
5. `broker-delivery-acceptance-service.ts:512-583` — `@openscout` must either resolve to a real dispatcher session (a genuine work item) or return `kind: "rejected"` with remediation. It must not report `accepted: true`.
6. `create-openscout-web-server.ts:6369-6374` / `db/sessions.ts:489-494` — make `lastMessageAt` broker-authoritative, or merge it across channel siblings.
7. `conversations/service.ts:736` — implement `askField` from the records already loaded at `:697-699`. Until this exists nothing can honestly say "needs reply".

**Follow-up**

8. Derived per-message status projection + transcript chip (`requesting / working / waiting / replied / comment / failed / blocked`).
9. Forward `requestedSendMode` through `/api/chats/:chatId/messages` (`:7065-7070`) and give the thread composer an explicit Ask-vs-Comment control. Mode is a routing field, not prose parsed from the body.
10. `--ref` replies advance/close the linked collaboration record and stamp `workId` (`broker-delivery-acceptance-service.ts:373-431`).
11. Reject an unresolvable `ref:` instead of falling through (`:377`).
12. Durable delivery receipt on the message, replacing the ephemeral `sendReceipt` (`ConversationScreen.tsx:1106-1123`).
13. Mark broker-unavailable transcripts as degraded and do not cache them as authoritative (`create-openscout-web-server.ts:5739`, `chat-cache.ts:109`).
14. macOS: expose a Reload affordance in Comms (`ScoutRootView.swift:2377`) and reload the thread embed on app activation.

---

## 5. Tests and failure-injection checks

**Unit**

- `packages/web/server/core/conversations/service.test.ts` — `summary.ask` is `pending` for an open work item with no reply, `answered` after a linked reply, absent for comment-only; system-kind conversations stay out of the default list *and* their issues are mirrored into the origin conversation.
- New `core/conversations/message-status.test.ts` — table-drive every transition, weighted to the negatives: no invocation ⇒ never `working`; flight past the staleness deadline ⇒ `waiting`, not `working`; comment-only ⇒ never `requesting`.
- `packages/web/client/screens/chat/conversation-model.test.ts` (currently 53 lines) — add a `messageMode` resolution table asserting that an outstanding turn selects a mode that refetches.
- `packages/web/client/lib/chat-cache.test.ts` — a refresh after a merged-channel reply returns the reply; the cache never serves a tail older than the summary's `lastMessageAt`.

**Failure injection — this is where correctness is actually proven**

- **WS gap (the July 25 failure).** Mount the thread, drop the broker WS, post a reply through the broker, restore the WS. The reply must appear within one resync, with no manual navigation.
- **Sibling-channel post.** Post a reply into a sibling conversation sharing the natural key; the mounted thread must show it live.
- **Unroutable target.** `scout send --to @nobody` — assert a durable failure marker in the *origin* conversation and that the sender receipt is not `accepted: true`.
- **`@openscout` work item.** Assert either a real invocation or an explicit rejection, and that the human message terminates in `failed`/`blocked` rather than sitting in `requesting` forever.
- **Agent dies mid-turn.** SIGKILL the worker; the message must degrade to `waiting` / "no recent update" within the deadline and must never remain `working`.
- **Broker restart during a turn.** No message lost, no message stuck `working`.
- **macOS embed.** With the thread mounted, background and foreground the app across a reply; the reply must appear. Assert against the embed readiness probe (`ScoutWebEmbedView.swift:649-668`) after resync.

**Invariant fixture.** Replay the July 25 trace (15 human-authored messages) as a fixture and assert:
every human-authored message resolves to exactly one status; none sits in `requesting`/`working` past
the deadline without a live invocation; every failure has a marker in its originating conversation.
That fixture is the regression test for this entire class of bug.
