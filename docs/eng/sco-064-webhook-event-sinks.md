# SCO-064: Webhook Event Sinks

## 1. Status

- **Status:** Draft
- **Owner:** OpenScout
- **Scope:** Broker events, webhook delivery, notification side effects
- **Intent:** Add signed HTTP event sinks as a broker-owned delivery path without making webhooks the source of truth.

## 2. Summary

OpenScout should support webhook delivery as an event sink over broker-owned
records. A webhook is not a separate coordination primitive. It is an outbound
delivery mechanism for durable broker events, alongside SSE, mobile push,
desktop notifications, mesh forwarding, and future external adapters.

The core shape:

1. The broker writes the canonical Scout-owned record.
2. The broker projects one or more broker events from that record.
3. Matching `event_sink` rows create signed outbound delivery attempts.
4. Delivery attempts retry, fail, or dead-letter without changing the canonical
   record they describe.

This gives external systems a clean integration surface while preserving
Scout's data ownership boundary: Scout-owned records can be emitted by default;
raw harness transcript turns should not.

## 3. Context

OpenScout already has durable messages, invocations, flights, deliveries,
unblock requests, and session attention records. It also has several live
delivery paths: SSE, mobile bridge websocket, APNs relay, mesh forwarding, and
CLI wait/watch commands.

Webhook delivery fills a different need:

- external tools can react to Scout events without holding a websocket open
- local dev tools can inspect, replay, and debug event payloads
- multi-machine and multi-user setups can route broker events into automation
  systems without granting broad broker access
- notification side effects can be filtered and suppressed by policy while the
  underlying record remains durable

This proposal is about outbound webhooks. Inbound webhooks are intentionally a
later extension.

## 4. Principles

1. The broker event is canonical; webhook delivery is a side effect.
2. Webhook attempts are first-class delivery records, not fire-and-forget HTTP
   calls.
3. Payloads are signed, scoped, typed, and replay-resistant.
4. Webhooks emit Scout-owned records by default, not full external harness
   transcript material.
5. Quiet delivery still writes the durable record and suppresses webhook,
   push, wake, and notify side effects where policy allows.
6. A webhook receiver must be able to dedupe deliveries without relying on
   exactly-once delivery.

## 5. Records

```ts
type EventSinkScope =
  | { kind: "agent"; agentId: string }
  | { kind: "project"; projectPath: string }
  | { kind: "conversation"; conversationId: string }
  | { kind: "flight"; flightId: string }
  | { kind: "work_item"; workItemId: string }
  | { kind: "node"; nodeId: string }
  | { kind: "operator"; actorId: string };

type EventSink = {
  id: string;
  kind: "webhook";
  url: string;
  events: string[];
  scope: EventSinkScope;
  filters?: EventSinkFilter[];
  secretRef: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
```

```ts
type WebhookDeliveryAttempt = {
  id: string;
  sinkId: string;
  eventId: string;
  deliveryId: string;
  attempt: number;
  status: "pending" | "sent" | "retrying" | "dead_lettered" | "cancelled";
  responseStatus?: number;
  responseBodyPreview?: string;
  lastError?: string;
  nextAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

`secretRef` should point at local secure storage or an encrypted broker secret,
not store cleartext in the public record projection.

## 6. Event Scope And Filters

Sinks should support both resource scope and event filters.

Useful scopes:

- `agent`: all events involving one Scout agent identity
- `project`: events for one project/workspace path
- `conversation`: messages and delivery state for one conversation or channel
- `flight`: lifecycle events for one ask
- `work_item`: collaboration state for one owned work item
- `node`: machine-level mesh, broker, and route events
- `operator`: human attention and unblock events for one operator actor

Useful filters:

- only terminal failures
- only completed asks
- only open unblock requests
- only a specific project path
- only quiet=false side effects
- only event severity `warning` or `error`

Filters should be structural fields, not string matching over message bodies.

## 7. Payload Shape

Every webhook payload should carry ids that make it traceable and safely
deduplicated:

```json
{
  "event_id": "evt_...",
  "delivery_id": "del_...",
  "attempt": 1,
  "event": "flight.completed",
  "created_at": "2026-06-08T17:00:00.000Z",
  "subject": {
    "kind": "flight",
    "id": "flight_..."
  },
  "scope": {
    "kind": "project",
    "project_path": "/Users/arach/dev/openscout"
  },
  "data": {}
}
```

Payload `data` should be a typed, bounded projection of the Scout-owned record.
For harness-owned source material, include references, cursors, summaries, or
links rather than embedding raw transcript text by default.

## 8. Signing

Webhook requests should use a timestamped HMAC signature:

```txt
Scout-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>
```

The signed message should be:

```txt
<timestamp>.<raw-body>
```

Receivers should reject missing signatures, malformed signatures, stale
timestamps, and mismatched HMACs. A default replay tolerance of five minutes is
reasonable for local and remote integrations. Secret rotation should support an
overlap window where both old and new secrets can verify.

## 9. Candidate Events

First-class outbound events should start with broker-owned lifecycle and
attention events:

| Event | Meaning |
| --- | --- |
| `message.created` | A Scout-owned message was written. |
| `delivery.planned` | The broker planned a transport delivery. |
| `delivery.sent` | A transport accepted an attempt. |
| `delivery.failed` | A delivery attempt failed. |
| `delivery.dead_lettered` | Retries are exhausted or the route is terminal. |
| `flight.started` | Ask-style work moved into active execution. |
| `flight.completed` | Ask-style work completed. |
| `flight.failed` | Ask-style work failed. |
| `question.opened` | A Scout question is awaiting an answer. |
| `unblock.opened` | A broker-owned unblock request is open. |
| `operator_attention.created` | An item needs operator attention. |
| `session.attention_changed` | Session attention projection changed. |
| `agent.online_changed` | A routeable agent changed reachability. |
| `work_item.waiting` | Work is blocked on a named owner or condition. |
| `work_item.review_requested` | Work is awaiting review. |

Observed harness events can be added later as an explicit opt-in event family,
for example `tail.event.projected`. They should remain marked as observed
material, not Scout-owned messages.

## 10. Quiet And Mute Semantics

Quiet delivery should apply consistently:

- write the message, invocation, work item, or unblock record
- project ordinary broker read models
- suppress webhook, push, wake, and notification attempts where policy allows
- record the delivery state as `suppressed` when a side effect would otherwise
  have been planned

This is not a separate message kind. It is a delivery side-effect policy.

## 11. Local Dev Operations

Webhook support should ship with developer affordances:

```bash
scout webhook create --url http://localhost:8787/scout --event flight.completed --project .
scout webhook list
scout webhook deliveries --sink <id>
scout webhook replay --delivery <id>
scout webhook rotate-secret <id>
scout webhook test <id>
```

The broker should keep bounded recent payload previews so users can inspect
what was sent without enabling packet capture. Previews must obey the same data
ownership boundary as the payload.

## 12. Inbound Webhooks Later

Inbound webhooks may become useful for external systems to create Scout-owned
records:

- external CI creates a Scout message
- deployment system opens a work item
- monitoring system opens an unblock request
- external chat bridge posts into a bound channel

Inbound webhooks should use separate credentials and route through the same
authorization model as other write APIs. They should not be implemented by
reusing outbound webhook secrets.

## 13. Non-Goals

- replacing SSE, mesh forwarding, APNs, or desktop notifications
- making external HTTP endpoints canonical writers for Scout records
- emitting raw harness transcripts by default
- promising exactly-once webhook delivery
- adding public cloud webhook hosting in the first implementation

## 14. Implementation Sequence

1. Define protocol types for `EventSink`, event scopes, and webhook delivery
   attempts.
2. Add broker storage for sinks, encrypted secrets, and attempts.
3. Project a small initial event set: `flight.completed`, `flight.failed`,
   `unblock.opened`, and `delivery.dead_lettered`.
4. Add signed delivery with retry and dead-letter state.
5. Add CLI operations for create/list/test/replay/rotate.
6. Add quiet-delivery suppression into the event planning step.
7. Expand event families after the delivery model has enough operational
   visibility.
