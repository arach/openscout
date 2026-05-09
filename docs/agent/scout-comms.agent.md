# Scout Comms Agent Notes

Source: `docs/scout-comms.md`.

Status: current v0 integration guidance, not frozen public API.

## Mental Model

Scout comms are protocol-shaped but not a standalone wire protocol.

| Concept | Scout Equivalent |
|---|---|
| method | interaction intent: tell, ask, task, summary, status, wake |
| headers | explicit routing/reply/work context fields |
| body | message/task payload |
| response | broker receipt, flight state, reply message, work transition |
| authority | local broker canonical writes |

## Integration Rule

External clients submit structured intent to the broker and render broker-owned
records. They do not infer routing from body mentions or external harness
transcripts.

## Core Records

| Record | Type |
|---|---|
| conversation | `ConversationDefinition` |
| message | `MessageRecord` |
| delivery | `ScoutDeliverRequest`, `ScoutDeliveryReceipt`, `DeliveryIntent` |
| invocation | `InvocationRequest` |
| flight | `FlightRecord` |
| reply context | `ScoutReplyContext` |
| question | collaboration question record |
| work item | collaboration work item record |
| binding | `ConversationBinding` |
| dispatch | `ScoutDispatchRecord` |

## Workflows

| Workflow | Use | API/tool |
|---|---|---|
| tell/update | durable message, no owned reply lifecycle | `scout send`, `messages_send` |
| ask/requested reply | answer/work expected, creates invocation/flight | `scout ask`, `invocations_ask` |
| active reply | answer an inbound broker ask | final response or `messages_reply` depending on `replyPath` |
| durable work | progress/waiting/review/done lifecycle | `work_update` |

## Routing Invariants

- one explicit target -> DM
- group -> explicit channel
- shared broadcast -> opt-in
- body text is payload, not routing metadata
- preserve `conversationId`, `messageId`, `replyToMessageId`, `flightId`
- ambiguous target -> fail closed or ask one concise clarification
- follow-up stays in same conversation/thread/question/work item
- render `ScoutDispatchRecord` for ambiguous/unknown/unparseable/unavailable
  targets

## Composer Route Operator

Use `>>` in human composers when `@` conflicts with host autocomplete.

Examples:

| Typed | Broker target | Body |
|---|---|---|
| `/scout:ask >> hudson Review the parser.` | `targetLabel: "hudson"` | `Review the parser.` |
| `/scout:ask >> ref:8kj4pd Continue.` | `target: { kind: "binding_ref", ref: "8kj4pd" }` | `Continue.` |
| `/scout:send >> channel:ops Status is green.` | `target: { kind: "channel", channel: "ops" }` | `Status is green.` |

Supported route target forms: agent labels, `agent:<label>`, `ref:<id>`,
`id:<agentId>`, `channel:<name>`, and `broadcast`. `@agent` remains compatibility
syntax, but new Scout-aware composers should prefer `>>` and strip the route
operator from payload before calling the broker.

CLI composer routing currently uses labels and refs for asks; `channel:<name>`
and `broadcast` are send/update routes. Direct `id:<agentId>` targets are for
clients that can submit `targetAgentId`.

## Reply Context

`ScoutReplyContext` fields:

| Field | Meaning |
|---|---|
| `mode` | `broker_reply` |
| `fromAgentId` | requester/source |
| `toAgentId` | current target |
| `conversationId` | conversation to reply into |
| `messageId` | request message |
| `replyToMessageId` | message being answered |
| `replyPath` | `final_response` or `mcp_reply` |
| `action` | invocation action |

Rules:

- `final_response`: final assistant message is broker-visible reply.
- `mcp_reply`: call reply tool exactly once.
- Do not answer original ask with `messages_send` or `invocations_ask`.

## Scout Contact Line

Display grammar:

```text
⌖ <source-short> <operator> <intent>:<ref>
```

Examples:

| Action | Contact line | Meaning |
|---|---|---|
| consult | `⌖ art ≔ ask:8kj4pd` | reply expected |
| execute | `⌖ art ↦ task:8kj4pd` | assigned work |
| summarize | `⌖ art ≈ summary:8kj4pd` | synthesis |
| status | `⌖ art ⟲ status:8kj4pd` | check-in |
| wake | `⌖ art · wake:8kj4pd` | attention ping |

Contact line properties:

- generated from records
- not parser input
- not routing authority
- target omitted when target is ambient
- ref usually `messageId` suffix, fallback invocation id
- payload opener form: `⌖ art ≔ ask:8kj4pd › I am writing...`
- ASCII fallback: `scout art ask:8kj4pd`
- screen-reader label: "Scout ask from art, reference 8kj4pd"

## Delivery State

| State | Meaning |
|---|---|
| `accepted` | local broker journaled/planned |
| `peer_acked` | remote broker journaled |
| `running` | target agent claimed |
| `completed` | terminal success for layer |
| `deferred` | retryable; next attempt later |
| `failed` | terminal failure |
| `cancelled` | cancelled |

Receipt rule: broker receipt != read/completed/accepted. `peer_acked` != remote
agent done. Use reply message, flight update, work transition, or collaboration
event for semantic completion.

## Non-Guarantees

- no exactly-once delivery guarantee
- no global consensus guarantee
- no CRDT convergence guarantee
- no replicated external transcript storage
- not enterprise/compliance-ready current posture

## Source Paths

| Need | Path |
|---|---|
| human comms doc | `docs/scout-comms.md` |
| conversations | `packages/protocol/src/conversations.ts` |
| messages | `packages/protocol/src/messages.ts` |
| invocations/flights | `packages/protocol/src/invocations.ts` |
| delivery | `packages/protocol/src/scout-delivery.ts` |
| dispatch/routing | `packages/protocol/src/scout-dispatch.ts` |
| composer route parser | `packages/protocol/src/scout-composer.ts` |
| reply context | `packages/protocol/src/scout-reply-context.ts` |
| broker | `packages/runtime/src/scout-broker.ts` |
| prompt projection | `packages/runtime/src/local-agents.ts` |
