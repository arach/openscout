# Ask-overbuild simplification plan

Status: proposal · Author: security/simplify review · Date: 2026-07-01

## Problem

A single "ask" (agent A requests work from agent B) is currently represented by
**six overlapping execution vocabularies**. Four are stored records that move in
lockstep; two are pure projections whose only job is to re-merge what the other
four split apart.

| Vocabulary | Kind | Where | Role |
|---|---|---|---|
| `InvocationRequest` | stored, immutable | `packages/protocol/src/invocations.ts:68` | the request (who/what/how) |
| `FlightRecord` | stored, mutable | `packages/protocol/src/invocations.ts:89` | execution status of that request |
| dispatch job | stored, mutable | `packages/runtime/src/broker-dispatch-job.ts:32` | dispatch attempt status |
| `WorkItemRecord` | stored, mutable | `packages/runtime/src/broker-work-item-store.ts` | durable user-facing "work" |
| `ScoutInvocationLifecycle` | projection | `packages/protocol/src/lifecycle.ts` (496 lines) | re-joins invocation+flight for MCP |
| `AgentRun` | projection | `packages/protocol/src/agent-runs.ts:245` | re-joins invocation+flight for the UI |

The tell that this is accidental, not essential:

- **`FlightRecord` is `InvocationRequest`'s status with two fields copied back.**
  It carries `invocationId`, then duplicates `requesterId` and `targetAgentId`
  from the invocation (`invocations.ts:91-93`), and adds the mutable execution
  state (`state`, `summary`, `output`, `error`, `startedAt`, `completedAt`). It
  is created 1:1 with the invocation and never forks — the broker persists it
  through **12 `persistFlight()` transitions** in
  `broker-local-invocation-service.ts`, each rebuilding the same object with a
  new `state`.
- **The dispatch job is 1:1 too** — its id is literally
  `` `dispatch-${invocationId}` `` (`broker-dispatch-job.ts:32`), and its states
  (pending/running/completed/failed) duplicate the flight transitions.
- **We ship two functions and one DB query whose entire purpose is to undo the
  split.** `projectAgentRunFromInvocationFlight({invocation, flight})`
  (`agent-runs.ts:245`) merges the pair into an `AgentRun`; `lifecycle.ts` builds
  a second merged view for the `invocations_get`/`invocations_wait` MCP tools;
  and the web already **stores them as one row** — `db/runs.ts` `queryRuns` is
  documented as the "merged invocation+flight projection".
- **`work_item` mirrors flight state by hand.** `promoteInvocationFlightToWork`
  (`broker-work-item-store.ts:236`) copies `invocation.id`, `flight.id`, and
  `flight.state` into work-item metadata (`:283-285`) and maps flight terminal
  states onto work states. When they drift, that's a bug, not a feature.

Net: ~47 states across 6 vocabularies, plus ~1,000 lines of split-then-remerge
machinery, for one action, in a single-user local-first tool.

## Deliberately NOT in scope (these are load-bearing — keep)

- **`delivery` (`DeliveryIntent`)** — genuinely per-transport fan-out with its
  own lifecycle (`planner.ts` plans N deliveries per message; `peer_broker`
  forwarding and the dispatch ledger really are independent). Keep.
- **`message` / `conversation`** — the durable content layer. Untouched.
- **`work_item` as the user-facing object** — the Gmail-model agents directory
  needs a durable "work" noun. We keep the record but stop mirroring flight
  state into it (Phase 4).

## Target model

Collapse the four execution records into **one execution record with a status
field**, and delete the two re-merge projections.

```
Invocation {
  // request (immutable) — unchanged fields from InvocationRequest
  id, requesterId, requesterNodeId, targetAgentId, targetNodeId,
  action, task, conversationId, messageId, execution, createdAt, metadata, …

  // execution status (mutable) — absorbed from FlightRecord
  state: FlightState,          // queued|waking|running|waiting|completed|failed|cancelled
  summary?, output?, error?,
  startedAt?, completedAt?,
}
```

`AgentRun` stays as the UI view type, but it is projected **from the single
record** (drop the `flight` half of the input). `ScoutInvocationLifecycle` is
deleted; its two MCP consumers read the merged record directly.

## Phased plan (each phase independently shippable)

Ordered lowest-risk-first. Phases 1–2 are pure deletion with no storage change;
3 is the storage merge; 4–5 are cleanup.

### Phase 1 — delete the dead siblings (no storage change)
Removes records with **zero producers** (verified: no code constructs them).
- `question` (`QuestionRecord`) — no writer anywhere; "ask a question" is
  already a message + invocation, and the UI "question" surfaces come from
  session-attention derivation, not this record.
- `unblock_request` (`UnblockRequestRecord`) — ~125 lines of plumbing
  (protocol validators, sqlite table + journal replay, broker routes, web/desktop
  reads) with no producer; every "needs you" surface is synthesized at read time.
- **Blast radius:** protocol defs + sqlite table + a few dead routes. No behavior
  change (they're never written).
- **Risk:** low. **Win:** ~1 record type + ~125 lines each, gone.

### Phase 2 — delete the projections, read the record directly
- Delete `ScoutInvocationLifecycle` (`lifecycle.ts`, 496 lines) +
  `invocation-lifecycle-read-model.ts`. Point `invocations_get` /
  `invocations_wait` (the only consumers, via `broker-http-router.ts`) at a thin
  accessor that returns `{invocation, flight}` (still two records at this stage).
- **Blast radius:** 2 MCP tools + 1 HTTP route. **Risk:** low (narrow consumers,
  behind a stable tool contract). **Win:** ~590 lines.

### Phase 3 — merge `flight` into `invocation` (the storage change)
- Add the mutable status fields to the invocation record; write the invocation's
  status in place instead of a sibling flight. Replace the 12 `persistFlight()`
  transitions in `broker-local-invocation-service.ts` with one
  `transitionInvocation(id, patch)` helper.
- Collapse the dispatch job into the same record (its id is already derived from
  the invocation id; fold its status into the invocation's `state`).
- sqlite: one-time migration folding the `flights` table into `invocations`
  (add columns, backfill from the 1:1 flight row, drop `flights`). The store
  already re-hydrates with `JSON.parse as T`, so this is a schema + backfill, not
  a format negotiation.
- `projectAgentRunFromInvocationFlight` → `projectAgentRunFromInvocation` (drop
  the `flight` param and the `flightId` id-derivation branch in
  `deriveProjectedAgentRunId`). `db/runs.ts` `queryRuns` reads one table.
- **Blast radius:** largest — ~40 files touch flight (broker dispatch/lifecycle
  services, sqlite store, web `db/runs.ts` + `db/broker.ts`, desktop
  `ScoutFlightRecord` twin, the Swift mirrors). But mechanical: it's a
  field-relocation, not new semantics.
- **Risk:** medium (storage migration + the widest touch). Mitigate by keeping a
  `FlightRecord` **type alias** = the status subset of `Invocation` for one
  release so downstream readers compile unchanged, then remove.
- **Win:** one record instead of three; the 12-callsite transition churn becomes
  one helper; `db/runs.ts` stops joining.

### Phase 4 — stop mirroring flight state into `work_item`
- Make `work_item.state` a **read-time projection** of its latest invocation's
  state instead of a copied field (`promoteInvocationFlightToWork` currently
  copies it, `:283-285`). Keep `work_item` as the durable user object and keep
  collaboration events only for genuine human transitions (created/review/handoff).
- **Blast radius:** `broker-work-item-store.ts` + web `db/work.ts`.
- **Risk:** low-medium. **Win:** removes a whole class of state-drift bugs.

### Phase 5 — trim the vestigial transport/envelope surface (independent, any time)
- Delete transports with no sender: `telegram`, `discord`, `sms`, `email`,
  `webhook`, `tts`, `native_voice`, and the unconsumed `bridge_outbound` intent
  (produced at `planner.ts:167`, consumed nowhere).
- Delete the `@deprecated` aliases (`invocations.ts:26` `"any"`,
  `scout-dispatch.ts`, `scout-delivery.ts`) and the identity-grammar triple-alias
  re-exports.
- Collapse the duplicated `returnAddress`/`responder*` envelope blobs (copied into
  both message and invocation metadata) into one typed `origin` field.
- **Risk:** low (all unreferenced). **Win:** removes ~half the transport union +
  dead aliases.

## Sequencing / risk notes

- **Active work overlaps here.** `planner.ts` and
  `broker-local-invocation-service.ts` were both modified in the current WIP
  checkpoint. Land Phases 1–2 (which don't touch those files' hot paths) before
  Phase 3, and coordinate Phase 3 with whoever owns the in-flight
  `broker-local-invocation-service` changes.
- **Swift mirrors.** `FlightRecord`/`AgentRun` are hand-mirrored in
  `scout-ios-core`, `scout-native-core`, and macOS `ScoutCommsModels.swift`.
  Phase 3 changes them; do the type-alias trick so the wire shape is stable for
  one release and the Swift side migrates on its own cadence.
- **Migrations are fine to add.** sqlite already has a migration path; there is
  no broker wire-version negotiation to worry about (mesh protocol version is the
  only enforced version and is out of scope).
- **Recommended first PR:** Phase 1 + Phase 2 together — pure deletion (~1,300
  lines), zero storage change, narrow consumers. It proves the direction and
  clears the projection layer before the storage merge.

## What this does not change

The external contracts stay stable: `scout ask` / `send` / `messages_reply`
semantics, the MCP tool surface (`invocations_get`/`invocations_wait` keep their
shape), and the web/native read models keep their view types. This is an
internal collapse of how one ask is stored and transitioned, not a change to how
callers request or observe work.
