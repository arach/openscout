# SCO-065: Delivery Semantics And Receipts

## 1. Status

- **Status:** Draft
- **Owner:** OpenScout
- **Scope:** Broker delivery semantics, receipts, idempotency, ordering, backlog
- **Intent:** Make delivery state explicit across messages, asks, webhooks, mesh routes, and operator notifications.

## 2. Summary

OpenScout should make delivery semantics precise enough that every surface can
answer a simple user question: "What happened to this message or ask?"

The key direction is to separate these phases:

1. **Broker accepted:** the broker validated intent and durably wrote the
   canonical record.
2. **Target received:** the target endpoint, peer broker, webhook endpoint, or
   notification sink accepted the delivery attempt.
3. **Target processed:** the recipient acted on the delivery or acknowledged it
   at the application level.
4. **Operator saw it:** a human-facing surface displayed, notified, dismissed,
   or answered the item.

These phases are related but not interchangeable. A message can be accepted by
the broker while the target is offline. A remote broker can accept authority
while the remote harness has not processed anything. A webhook endpoint can
return HTTP 200 while the receiving service has not completed the work. A phone
push can be sent while the operator never opens the app.

## 3. Relationship To SCO-039

SCO-039 defines the durable invocation and delivery lifecycle for asks and
result delivery. This proposal refines the shared semantics that should apply
across delivery transports:

- message delivery
- ask delivery
- webhook event sinks
- mesh forwarding
- mobile and desktop notifications
- operator attention and unblock records
- future Comms channels

This proposal does not replace SCO-039. It adds stricter meanings for receipts,
idempotency, ordering, retries, dead letters, quiet delivery, and backlog
pressure.

## 4. Principles

1. Durable write first, delivery second.
2. External delivery is at-least-once; receivers dedupe with `delivery_id`.
3. Sends should accept caller-provided idempotency keys.
4. Ordering is per conversation, channel, or scoped stream; there is no fake
   global order.
5. Retry and terminal failure are visible broker states.
6. Receipts are queryable by id.
7. Backlog pressure should be visible before it becomes failure.
8. Quiet or muted delivery stores the record and suppresses side effects.
9. Joining a channel or group should not implicitly grant old context.

## 5. Phase Vocabulary

| Phase | Meaning | Example evidence |
| --- | --- | --- |
| `accepted` | Broker validated and wrote the canonical record. | `messageId`, `flightId`, `eventId` exists. |
| `planned` | Broker created delivery intent for one or more transports. | `deliveryId` exists. |
| `attempted` | A worker attempted a transport send. | attempt row with timestamp. |
| `received` | Transport or target endpoint accepted the attempt. | HTTP 2xx, peer broker receipt, local endpoint ack. |
| `processed` | Recipient application acknowledged semantic processing. | read ack, work ack, action decision, sync ack. |
| `seen` | Operator-facing surface displayed or notified the item. | inbox read, notification opened, local dismiss. |
| `suppressed` | Side-effect delivery was skipped by quiet/mute policy. | suppression row with policy reason. |
| `dead_lettered` | Delivery cannot continue under current policy. | retry exhausted, terminal route failure. |

`received` MUST NOT be presented as `processed`. `sent push` MUST NOT be
presented as `operator saw it`. Peer broker acceptance MUST NOT be presented as
target harness execution.

## 6. Idempotency

Caller-created records should support an idempotency key:

```ts
type ScoutCreateOptions = {
  idempotencyKey?: string;
};
```

Examples:

- `messages_send`: caller provides one key per logical message.
- `ask`: caller provides one key per logical request.
- inbound webhook write path, if added later: external sender provides one key
  per logical event.

The broker should scope idempotency to the actor and operation family. Replaying
the same key should return the original receipt rather than creating a duplicate
message, ask, or work item. A fresh key means a fresh logical request.

Delivery attempts use `delivery_id` for receiver dedupe. The sender
idempotency key and receiver delivery id solve different problems and should not
be collapsed.

## 7. Delivery Ids And Receiver Dedupe

Every external delivery attempt should include:

- `delivery_id`
- `event_id` or subject record id
- `attempt`
- `created_at`
- `idempotency_key` when relevant and safe to expose

Receivers should treat delivery as at-least-once. A receiver that performs a
side effect should key that side effect on `delivery_id` or a documented stable
subject id. Scout should not require receivers to infer dedupe keys from body
text, timestamps, or target labels.

## 8. Ordering

Ordering should be scoped:

- conversation or Comms channel messages use a per-channel sequence
- delivery attempts for one delivery use attempt numbers
- webhook/event streams can expose a per-sink delivery sequence later
- mesh routes can expose peer-local acceptance order, not global consensus

OpenScout should not promise global ordering across conversations, projects,
machines, webhooks, and operator notifications. Cross-scope ordering should be
presented as approximate time order unless a specific sequence field says
otherwise.

## 9. Retry And Dead Letter

Retryable delivery failures should use bounded exponential backoff with jitter.
Terminal failures should be visible and queryable.

```ts
type DeliveryState =
  | "pending"
  | "leased"
  | "attempted"
  | "received"
  | "processed"
  | "retrying"
  | "suppressed"
  | "dead_lettered"
  | "cancelled";
```

Dead-letter state should be available for:

- webhook deliveries after retry exhaustion
- remote machine routes that cannot reach the authority broker
- mobile push delivery when the relay or APNs path returns terminal failure
- local endpoint delivery when the target session is incompatible or gone

Dead-lettering a delivery MUST NOT delete the underlying message, ask, work
item, or event. It means that a particular transport path is terminal under the
current route and policy.

## 10. Receipts

Every user-facing send, ask, or delivery-triggering operation should return a
receipt with durable ids:

```ts
type DeliveryReceipt = {
  subjectKind: "message" | "invocation" | "event" | "work_item" | "unblock";
  subjectId: string;
  deliveryIds: string[];
  acceptedAt: string;
  idempotencyKey?: string;
};
```

Receipts should be readable later:

```bash
scout receipt <message-or-flight-id>
scout delivery inspect <delivery-id>
scout delivery attempts <delivery-id>
```

MCP and API clients should be able to fetch the same read model rather than
deriving status from logs, SSE events, or harness transcripts.

## 11. Backlog Pressure

Backlog pressure should surface before delivery failure:

- per-target undelivered count
- per-sink retry queue length
- per-peer mesh queue length
- oldest undelivered age
- next retry time
- target route health

Backlog warnings should be advisory when the record was accepted and delivery
is still possible. Hard caps should return typed errors or terminal delivery
state. This lets callers back off, batch, or switch routes before the system
silently accumulates unbounded work.

## 12. Quiet And Mute Semantics

Quiet delivery is a side-effect policy:

- durable record is written
- normal read models update
- notify, wake, webhook, and push side effects are suppressed where policy
  permits
- suppression is visible in delivery state

Mute policy should behave similarly for a target or sink: suppress live push,
keep durable state available for explicit reads and sync-like catch-up.

`ask` should remain lifecycle-creating. It should not grow a separate quiet ask
primitive. If an ask requires ownership and work, it should create the lifecycle
even if some notification side effects are muted by policy.

## 13. Channel Join Visibility

For group or channel membership, consider recording a visibility boundary:

```ts
type ChannelMembership = {
  memberId: string;
  channelId: string;
  joinedAt: string;
  visibleAfterSeq: number;
};
```

This prevents late joiners from implicitly receiving historical context. It
also gives adapters a simple rule for sync and replay: deliver only messages
with `seq > visibleAfterSeq`, unless an explicit backfill policy is granted.

This is especially relevant for multi-user and multi-agent channels where old
coordination context may include private decisions, credentials, or operator
instructions that were never intended for later members.

## 14. Non-Goals

- promising exactly-once delivery
- defining global ordering across machines
- replacing the durable invocation lifecycle in SCO-039
- storing full harness transcripts as delivery receipts
- making notification delivery equivalent to human acknowledgement
- requiring all transports to support `processed` and `seen` phases on day one

## 15. Implementation Sequence

1. Define the shared phase vocabulary in protocol docs and delivery types.
2. Add idempotency key support to message and ask creation where missing.
3. Make delivery ids and attempts queryable through broker APIs.
4. Add dead-letter state and retry diagnostics for webhook and mesh delivery.
5. Add backlog pressure projections for targets and event sinks.
6. Extend quiet delivery to suppress webhook/push/wake side effects with a
   visible suppression reason.
7. Add `visibleAfterSeq` to new Comms/channel membership design work.
