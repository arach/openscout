# Scout Comms Agent Notes

Source: `docs/scout-comms.md`.

Status: current v0 integration guidance, not frozen public API.

## Mental Model

Scout comms are protocol-shaped but not a standalone wire protocol.

| Concept | Scout Equivalent |
|---|---|
| method | interaction intent: message, invocation, task, summary, status, wake |
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
| session | concrete harness conversation/process/thread attached through an endpoint |
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
| message/update | durable message with broker receipt ids | `scout send`, `messages_send` |
| ask/reply | answer/work expected, creates invocation/flight | `scout ask`, `ask` |
| project-routed ask | project known, concrete agent/session unknown | `scout ask --project`, `ask({ projectPath })` |
| exact session ask | continue one concrete prior harness session | `scout ask --to session:<id>`, `ask({ targetSessionId })` |
| threaded reply | continue an existing broker conversation or ask reply context | final response or `messages_reply` depending on `replyPath` |
| durable work | progress/waiting/review/done lifecycle | `work_update` |

## Runtime Sessions

- agent = stable addressable identity
- session = concrete Claude, Codex, or future harness conversation/process
- endpoint = routable attachment between an agent and a session
- card = identity and return address, not necessarily a live session
- card/label/id targets create fresh sessions for new work; only
  `targetSessionId` / `session:<id>` continues exact prior context
- card/session creation = pro integration layer, not the default path for work
- public lifecycle noun is `session`; map provider thread ids into session metadata
- harness mismatches must fail with actionable diagnostics, not silent hangs
- endpoint state belongs to attachment health; flight/work state belongs to task
  lifecycle

## Coordination Cost

- preserve prompt/completion/total tokens when harnesses expose them
- separate Scout protocol overhead from target harness execution usage
- mark estimates when exact usage is unavailable
- preserve usage provenance such as provider exact, tokenizer estimate,
  character heuristic, or manual estimate
- label usage source, e.g. `protocol_overhead` vs `harness_execution`
- track non-token counters such as dispatch attempts, wake failures, generated
  diagnostics, and estimated orientation commands avoided
- link usage to session, endpoint, conversation, message, invocation, flight, or work item ids
- account for broker coaching effort so Scout can compare smart diagnostics
  against repeated sender-side orientation loops
- track value class so low-value boilerplate trends down and high-value
  onboarding/feature guidance can increase where it helps
- store metadata and compact summaries, not full harness transcripts

## Routing Invariants

- one explicit target -> DM
- default to the base agent/project identity; harness, model, profile, node,
  and session details are instance constraints layered on only when needed
- when you know the project but not the concrete agent, use `projectPath` /
  `--project` instead of running discovery first
- group -> explicit channel
- shared broadcast -> opt-in
- body text is payload, not routing metadata
- preserve `conversationId`, `messageId`, `replyToMessageId`, `flightId`
- ambiguous target -> fail closed or ask one concise clarification
- follow-up stays in same conversation/thread/question/work item
- render `ScoutDispatchRecord` for ambiguous/unknown/unparseable/unavailable
  targets
- broker should coach senders with likely intent, candidates, and remediation
  commands instead of forcing manual topology discovery

## Composer Route Operator

Use `>>` in human composers when `@` conflicts with host autocomplete.

Examples:

| Typed | Broker target | Body |
|---|---|---|
| `/scout:ask >> hudson Review the parser.` | `targetLabel: "hudson"` | `Review the parser.` |
| `/scout:ask >> ref:8kj4pd Continue.` | `target: { kind: "binding_ref", ref: "8kj4pd" }` | `Continue.` |
| `/scout:ask >> project:../talkie Compare auth.` | `projectPath: "../talkie"` | `Compare auth.` |
| `/scout:send >> channel:ops Status is green.` | `target: { kind: "channel", channel: "ops" }` | `Status is green.` |

Supported route target forms: agent labels, `agent:<label>`, `ref:<id>`,
`project:<path>`, `id:<agentId>`, `channel:<name>`, and `broadcast`. `@agent`
remains compatibility syntax, but new Scout-aware composers should prefer `>>`
and strip the route operator from payload before calling the broker.

CLI composer routing currently uses labels, refs, and project paths for asks;
`channel:<name>` and `broadcast` are send/update routes. Direct `id:<agentId>`
targets are for clients that can submit `targetAgentId`.

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
- Use the configured reply path, either final response or `messages_reply`;
  do not answer the original ask with `messages_send`, `ask`, or another new
  broker ask.

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
| `queued` | target known, dispatch or compatible endpoint readiness pending |
| `waking` | Scout starting/resuming compatible harness session |
| `peer_acked` | remote broker journaled |
| `running` | target agent claimed |
| `waiting` | blocked on named dependency |
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
