# Scout Comms

This is the front door for building a Scout-aware client, plugin, or adapter.
Read this when you want to understand how Scout interactions work: what gets
routed, what gets stored, how replies find their way home, and which pieces are
display affordances rather than protocol authority.

Scout comms are **not an HTTP spec**, but they are not not like one:

- an interaction has an intent, like a method
- it has routing context, like headers
- it has a body, which remains payload
- it returns durable ids and state, like a receipt/status surface
- it may create follow-on records such as flights, questions, or work items

The important difference is that the local broker, not a wire format, is the
canonical writer for Scout-owned coordination state.

## Current Posture

OpenScout is for high-trust local developer pilots. Treat these docs as current
integration guidance, not a frozen public API guarantee. Do not build claims
around enterprise readiness, compliance readiness, hardened multi-tenancy, or
exactly-once distributed delivery.

## Mental Model

Scout has three layers:

| Layer | What It Does |
| --- | --- |
| Protocol | Shared TypeScript shapes for messages, invocations, conversations, delivery, reply context, and collaboration records |
| Broker | Local source of truth that resolves targets, writes records, plans delivery, and tracks asks |
| Surface | CLI, desktop, web, mobile, harness plugin, or external client that reads/writes through the broker |

A client should submit structured intent to the broker and render broker-owned
records back to the user. It should not infer routing from message body text.

## Core Records

| Record | Meaning | Primary Type |
| --- | --- | --- |
| Conversation | A durable place messages belong: DM, channel, group DM, thread, or system lane | `ConversationDefinition` |
| Message | A durable body posted by one actor into one conversation | `MessageRecord` |
| Delivery | A planned transport-specific fan-out for a message or ask | `DeliveryIntent` / `ScoutDeliverRequest` |
| Invocation | An explicit request for an agent to do something | `InvocationRequest` |
| Flight | The lifecycle of an invocation: queued, running, waiting, completed, failed, or cancelled | `FlightRecord` |
| Reply context | The active return path when a harness is answering an inbound broker ask | `ScoutReplyContext` |
| Question | Lightweight information-seeking collaboration record | `QuestionRecord` |
| Work item | Durable owned execution record with progress, waiting, review, and done states | `WorkItemRecord` |
| Binding | Link between a Scout conversation and an external channel/thread | `ConversationBinding` |
| Dispatch record | Routing diagnostic for ambiguous, unknown, unparseable, or unavailable targets | `ScoutDispatchRecord` |

Protocol source files live in `packages/protocol/src`.

## Interaction Workflows

### Tell / Update

Use tell when no owned reply lifecycle is required.

Examples:

```bash
scout send --to hudson "The branch is ready for review."
```

MCP equivalent:

```ts
messages_send({
  targetLabel: "@hudson",
  body: "The branch is ready for review."
})
```

Expected client behavior:

- send an explicit target field, not only `@hudson` in the body
- render the returned `conversationId` and `messageId` when useful
- treat one explicit target as a DM
- require an explicit channel for group coordination

### Ask / Requested Reply

Use ask when the requester expects work, investigation, review, or an answer.

Examples:

```bash
scout ask --to hudson "Review the auth module and report risks."
```

MCP equivalent:

```ts
invocations_ask({
  targetLabel: "@hudson",
  body: "Review the auth module and report risks.",
  replyMode: "notify"
})
```

Expected client behavior:

- create or display a durable message for the request
- surface returned ids such as `conversationId`, `messageId`, and `flightId`
- show flight state rather than assuming immediate completion
- use `replyMode: "inline"` only for short bounded waits
- use `replyMode: "notify"` for longer work that should return later

### Broker Reply Mode

When a harness is invoked by Scout, it may receive an active reply context. In
that mode, the final answer should go back through the original broker
conversation instead of creating a new send.

The reply context looks like:

```ts
interface ScoutReplyContext {
  mode: "broker_reply";
  fromAgentId: string;
  toAgentId: string;
  conversationId: string;
  messageId: string;
  replyToMessageId: string;
  replyPath: "final_response" | "mcp_reply";
  action?: "consult" | "execute" | "summarize" | "status" | "wake";
}
```

Rules:

- if `replyPath` is `final_response`, the harness final assistant message is
  the broker-visible reply
- if `replyPath` is `mcp_reply`, call the provided reply tool exactly once
- do not use `messages_send` or `invocations_ask` to answer the original ask
- use Scout tools only to ask or delegate while solving the request

### Durable Work

If the interaction needs ownership, progress, waiting, review, or done states,
represent that as a work item rather than stretching a simple ask.

Use work updates for material transitions:

```ts
work_update({
  work: {
    workId: "work-...",
    state: "working",
    progress: {
      percent: 40,
      summary: "Runtime path mapped; tests pending."
    }
  }
})
```

Questions answer information. Work items carry ownership.

## Routing Rules

- One explicit target means DM.
- Group coordination requires an explicit channel.
- Shared broadcast is opt-in.
- Message body text is payload, not routing metadata.
- Prefer explicit routing fields over body mentions.
- Preserve follow-ups in the same conversation, thread, question, or work item.
- If a target is ambiguous, fail closed or ask one concise clarification.
- If sender identity is missing, establish a stable sender binding before
  routing.

Do not rely on body mentions for routing:

```ts
// Avoid: target is only text payload.
messages_send({ body: "@hudson can you check this?" })

// Prefer: target is explicit, body stays payload.
messages_send({
  targetLabel: "@hudson",
  body: "Can you check this?"
})
```

If routing cannot complete safely, a client should render the broker's dispatch
or remediation result rather than guessing. `ScoutDispatchRecord` covers
`ambiguous`, `unknown`, `unparseable`, and `unavailable` targets, including
candidates or wake/register/retry guidance when available.

## Receipts And Delivery State

A delivery receipt means the broker accepted the request and wrote or planned
broker-owned records. It does not mean the target read the message, completed
the task, or accepted the result.

Delivery state is layered:

| State | Meaning |
| --- | --- |
| `accepted` | local broker journaled the envelope and may still need to forward |
| `peer_acked` | remote broker journaled the envelope |
| `running` | target agent claimed the flight or work |
| `completed` | terminal success for that delivery/flight layer |
| `deferred` | retry window is still open |
| `failed` | terminal failure with failure metadata |
| `cancelled` | cancelled before completion |

`peer_acked` is especially easy to overread. It means the remote broker has the
envelope, not that the remote agent has finished the work. For semantic
completion, look for the reply message, flight update, work item transition, or
collaboration event that matches the workflow.

## Scout Contact Line

Some surfaces need a tiny first-line cue for inbound Scout-mediated work. The
contact line is generated from structured records; it is not the protocol.

Default grammar:

```text
⌖ <source-short> <operator> <intent>:<ref>
```

Examples:

```text
⌖ art ≔ ask:8kj4pd
⌖ art ↦ task:8kj4pd
⌖ art ≈ summary:8kj4pd
⌖ art ⟲ status:8kj4pd
⌖ art · wake:8kj4pd
```

Meanings:

| Operator | Intent | Meaning |
| --- | --- | --- |
| `≔` | `ask` | inbound ask; reply expected |
| `↦` | `task` | delegated or assigned work |
| `≈` | `summary` | summarize or synthesize |
| `⟲` | `status` | status check or check-in |
| `·` | `wake` | wake, nudge, or attention ping |

`⌖` means Scout-mediated contact. The short reference should usually be the
last useful suffix of the broker `messageId`, with full ids available in a
debug or collapsed context view. Do not parse the contact line for routing; use
the structured context fields.

ASCII fallback:

```text
scout art ask:8kj4pd
```

Screen-reader labels should expose the plain meaning, such as "Scout ask from
art, reference 8kj4pd."

## Client Checklist

When building a Scout client or plugin:

- read from broker-owned records rather than external harness transcripts
- send target, channel, reply, and work ids as explicit fields
- keep message body as payload
- preserve `conversationId`, `messageId`, `replyToMessageId`, and `flightId`
  across replies and status views
- distinguish tell/update from ask/work
- show stale, waiting, failed, and cancelled states explicitly
- distinguish broker acceptance, peer acknowledgement, agent completion, and
  requester acceptance
- render dispatch/remediation results when targets are ambiguous, unknown, or
  unavailable
- keep full ids available for debugging even when the visible UI uses short refs
- do not promise exactly-once delivery, consensus, or complete transcript
  replication

## Where To Look In Code

| Need | Path |
| --- | --- |
| Conversation types | `packages/protocol/src/conversations.ts` |
| Message types | `packages/protocol/src/messages.ts` |
| Invocation and flight types | `packages/protocol/src/invocations.ts` |
| Delivery request and receipt types | `packages/protocol/src/scout-delivery.ts` |
| Dispatch and routing target types | `packages/protocol/src/scout-dispatch.ts` |
| Reply context type | `packages/protocol/src/scout-reply-context.ts` |
| Runtime broker implementation | `packages/runtime/src/scout-broker.ts` |
| Local-agent prompt projection | `packages/runtime/src/local-agents.ts` |

## Related Docs

- `docs/architecture.md`
- `docs/agent-identity.md`
- `docs/collaboration-workflows-v1.md`
- `docs/agent-integration-contract.md`
- `docs/data-ownership.md`
- `docs/eng/sco-014-broker-owned-routing-and-context.md`
- `docs/eng/sco-017-scout-broker-reply-context.md`
- `docs/eng/sco-019-lightweight-mission-channels.md`
- `docs/eng/sco-026-scout-comms-grammar-and-semantic-hints.md`
