# SCO-026: Scout Comms Grammar And Semantic Hints

## Status

Proposed.

## Context

Scout communication has durable protocol records for conversations, messages,
deliveries, invocations, flights, questions, and work items. Those records are
structured, but the surfaces that launch or display broker-mediated work often
need a very small human-visible cue. In Codex and similar chat UIs, the first
line of an inbound broker ask may have only a narrow scannable width. A verbose
protocol preamble wastes that space; a decorative icon without semantics turns
into folklore.

SCO-017 introduces `ScoutReplyContext` and a compact inbound prompt shape for
direct broker replies. This proposal generalizes the visible prompt cue into a
small **semantic hint grammar** backed by the existing protocol records.

## Problem

1. Scout comms semantics exist across multiple record types, but there is no
   single display grammar for compactly naming "what kind of broker thing is
   this?"
2. Human-visible first lines need to be high signal: source, intent, and a
   short reference. Ambient facts such as the current target should not consume
   the first line.
3. Unicode or ASCII symbols can make repeated broker traffic easier to scan,
   but only if each symbol has a stable job.
4. `@agent` mentions collide with host composer autocomplete in some surfaces,
   so Scout needs a first-class typed route affordance that still becomes
   structured routing metadata.
5. Display hints must not become the routing authority. The broker and protocol
   records remain canonical.

## Goals

- Define a compact visible grammar for Scout-mediated turns.
- Keep the grammar readable without a legend for common cases.
- Give symbols stable semantics so they can be used consistently across Codex,
  Claude, CLI, web, and mobile surfaces.
- Define an ASCII composer route operator for Scout-aware text inputs.
- Preserve structured protocol fields for machines, debugging, accessibility,
  and copy/paste.
- Avoid implying stronger delivery guarantees than Scout currently provides.

## Non-goals

- Replacing `MessageRecord`, `InvocationRequest`, `ScoutDeliverRequest`,
  `ScoutReplyContext`, or collaboration records.
- Making Unicode symbols part of the routing parser.
- Encoding every route, participant, or delivery attempt in the visible line.
- Claiming exactly-once delivery, global consensus, or replicated transcript
  semantics.

## Decision

Scout should have a structured comms envelope model with three presentation
layers:

1. **Canonical records**: broker-owned protocol records and ids.
2. **Machine-readable context**: JSON metadata or a collapsed Markdown context
   block for the active surface.
3. **Visible semantic hint**: a short, lossy first-line projection optimized for
   scanning.

The visible hint is not authoritative. It is a product affordance generated from
canonical records.

## Protocol-Shaped, Not A Wire Protocol

This is intentionally "not an HTTP spec, but not not like one." Scout clients
benefit from a shared grammar:

| HTTP-ish Idea | Scout Comms Equivalent |
| --- | --- |
| Method | Interaction intent: tell, ask, task, summary, status, wake |
| Headers | Explicit route, actor, reply, work, and policy fields |
| Body | Message or task payload |
| Status | Broker receipt, flight state, work state, delivery state |
| Trace id | `conversationId`, `messageId`, `flightId`, `workId` |

The analogy stops at authority and guarantees. Scout's broker-owned records are
canonical. The visible hint is a generated display label, not a parser target,
wire envelope, delivery guarantee, or consensus mechanism.

## Composer Route Operator

Scout-aware composers should support `>>` as the route operator for cases where
`@` conflicts with host autocomplete or mention semantics.

Default typed grammar:

```text
/scout:ask >> <target> <body>
```

Examples:

```text
/scout:ask >> hudson Review the parser.
/scout:ask >> ref:8kj4pd Continue from that result.
/scout:send >> channel:ops Status is green.
```

The operator is a parser affordance, not payload. Surfaces must translate it
into `ScoutRouteTarget`, `targetLabel`, `channel`, or binding-ref metadata before
submitting to the broker:

| Composer Input | Protocol Target |
| --- | --- |
| `>> hudson` | `{ kind: "agent_label", label: "hudson" }` |
| `>> agent:hudson` | `{ kind: "agent_label", label: "hudson" }` |
| `>> ref:8kj4pd` | `{ kind: "binding_ref", ref: "8kj4pd" }` |
| `>> id:agent-...` | `{ kind: "agent_id", agentId: "agent-..." }` |
| `>> channel:ops` | `{ kind: "channel", channel: "ops" }` |
| `>> broadcast` | `{ kind: "broadcast" }` |

Direct agent ids are protocol targets for clients that can submit
`targetAgentId`. The initial CLI composer integration routes asks by agent label
or binding ref, and routes send/update messages by agent label, binding ref,
channel, or broadcast.

`@agent` remains a compatibility input form. `>>` is preferred for new
Scout-aware message boxes because it does not ask the host environment to
cooperate with Scout's agent picker.

## Scout Contact Line Grammar

The default first-line grammar is:

```text
⌖ <source-short> <operator> <intent>:<ref>
```

Example:

```text
⌖ art ≔ ask:8kj4pd › I am writing a Hermes...
```

Field meanings:

| Field | Meaning |
| --- | --- |
| `⌖` | Scout-mediated contact: broker-owned routing or reply context |
| `<source-short>` | Short display form of the requester/source actor |
| `<operator>` | Intent-family semantic operator |
| `<intent>` | Human-readable intent label |
| `<ref>` | Short stable-ish reference, preferably the message id suffix |

The target is omitted in target-local surfaces because the target is ambient:
the current Codex thread, Claude session, agent inbox, or conversation view is
already the recipient context. Full target and route fields remain in the
machine-readable context.

When a surface renders the contact cue beside payload text, ` › ` is the
payload lead-in. It keeps collapsed previews from merging the reference and the
first word of the ask without adding another colon-heavy token.

## Operator Table

Operators are semantic hints, not parsers. Surfaces should render the readable
intent word as well as the operator.

| Action | Hint | Meaning |
| --- | --- | --- |
| `consult` | `⌖ art ≔ ask:8kj4pd` | Inbound ask; reply expected |
| `execute` | `⌖ art ↦ task:8kj4pd` | Delegated or assigned work |
| `summarize` | `⌖ art ≈ summary:8kj4pd` | Summarize or synthesize |
| `status` | `⌖ art ⟲ status:8kj4pd` | Status check or check-in |
| `wake` | `⌖ art · wake:8kj4pd` | Wake, nudge, or attention ping |

`⌖` is the preferred Scout system sigil because it reads as sightline,
locator, contact, and field mark. `⟡` is reserved for future highlighted,
pinned, or user-emphasized items. `∫` is a useful conceptual ancestor for
"accumulated context", but it is less Scout-specific and should not be the
default product mark if `⌖` renders well across target surfaces.

## Reference Selection

The short ref should be generated from canonical ids:

1. Use `messageId` suffix when present.
2. Fall back to `invocation.id`.
3. Fall back to another broker-owned record id only when the turn is not
   message-backed.

Recommended rendering is the last six alphanumeric characters when available.
The full ids must remain available in machine-readable context.

## Structured Envelope

This proposal adds a protocol-level composer route parser in
`packages/protocol/src/scout-composer.ts`. It does not require a new persisted
record immediately, but surfaces should think in terms of this envelope:

```ts
interface ScoutCommsEnvelope {
  sourceActorId: ScoutId;
  targetActorId?: ScoutId;
  conversationId?: ScoutId;
  messageId?: ScoutId;
  replyToMessageId?: ScoutId;
  invocationId?: ScoutId;
  flightId?: ScoutId;
  collaborationRecordId?: ScoutId;
  workId?: ScoutId;
  intent: "ask" | "task" | "summary" | "status" | "wake" | "tell";
  operator: "≔" | "↦" | "≈" | "⟲" | "·" | "→";
  routeKind?: "dm" | "channel" | "broadcast";
  replyPath?: "final_response" | "mcp_reply";
  displayHint: string;
}
```

The envelope can be projected from existing records:

- `ScoutDeliverRequest` and `ScoutDeliveryReceipt` provide intent, route, and
  receipt ids.
- `MessageRecord` provides actor, body, conversation, reply, audience, and
  policy.
- `InvocationRequest` provides action, task, execution preference, and flight
  lineage.
- `ScoutReplyContext` provides active inbound reply semantics.
- Collaboration records provide question/work ownership and next-move state.

## Markdown Projection

For direct broker-invoked local-agent prompts, the visible hint should be
followed by the task summary, a hidden reply-mode marker, and a quiet structured
context:

````markdown
⌖ art ≔ ask:8kj4pd › I am writing a Hermes...

<!-- SCOUT BROKER REPLY MODE -->
> **Reply mode:** You are answering a Scout ask.
> Your final assistant message will be delivered back through the Scout broker.

<details>
<summary>Scout routing context</summary>

ScoutReplyContext:
```json
{
  "mode": "broker_reply",
  "fromAgentId": "art.arts-mac-mini-local",
  "toAgentId": "openscout-here",
  "conversationId": "dm...",
  "messageId": "msg-movmeoxz-8kj4pd",
  "replyToMessageId": "msg-movmeoxz-8kj4pd",
  "replyPath": "final_response"
}
```

</details>
````

## Accessibility And Fallbacks

Surfaces that cannot render Unicode reliably should fall back to ASCII:

```text
scout art ask:8kj4pd
scout art task:8kj4pd
scout art summary:8kj4pd
scout art status:8kj4pd
scout art wake:8kj4pd
```

Screen-reader labels should expose the plain meaning, not require pronunciation
of the glyphs. For example: "Scout ask from art, reference 8kj4pd."

Search, logs, and copyable debug views should include the readable intent and
full ids. Unicode hints are for visual scanning, not durable indexing.

## Rules

- The broker remains the canonical writer for Scout-owned coordination records.
- Message body text is payload. Routing must come from explicit fields.
- One explicit target means DM. Group coordination requires an explicit channel.
- The visible hint should omit ambient facts such as the current target.
- The visible hint should not include long conversation ids, fully qualified
  agent ids, transport names, or delivery attempts.
- `ask` is the agent-to-agent handoff primitive. When the interaction needs
  durable ownership, attach or create a work item rather than relying on chat
  text alone.

## Relationship To Other SCOs

- `docs/scout-comms.md` is the external-consumer front door produced from this
  direction.
- SCO-014 defines broker-owned routing and caller context.
- SCO-017 defines broker reply context and direct local-agent reply mode.
- SCO-019 defines lightweight mission channels.
- SCO-023 defines agent run registry concepts that can be referenced by future
  task-oriented envelopes.

## Open Questions

- Should `ScoutCommsEnvelope` become a first-class protocol type, or remain a
  generated view over existing records?
- Should tell/update get its own operator such as `→`, or should tell messages
  avoid glyph hints unless they launch work?
- Should `⌖` become the product-level Scout mark in UI chrome, or stay local to
  comms hints?
- How should `⟡` be reserved: human-pinned, priority, highlighted, or
  cross-surface "important"?
