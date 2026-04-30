# SCO-017: Scout Broker Reply Context

## Status

Proposed.

## Context

Scout can invoke a local agent directly when another agent sends a broker-backed ask. The invoked agent currently receives a normal chat turn whose prompt includes Scout-flavored text such as:

```text
[scout] @sender asks @target: ...
meta: from=... to=... action=consult
ref: convo=... msg=...
Return only the reply that should be delivered back through the broker.
```

That prompt convention works, but the reply path is implicit: the host captures the final assistant message and delivers it back to the requester. Agents can miss that detail and may try to call `scout send`, `messages_send`, or `invocations_ask`, creating duplicate replies or replies in the wrong venue.

Scout also has MCP surfaces that expose `messages_send`, `invocations_ask`, and a separate channel-style `scout_reply` tool, but there is no single first-class concept that tells an agent: **this turn is an inbound Scout ask; answer in this reply context.**

## Problem

1. Direct Scout invocation is identified mostly by prompt text, not a structured context.
2. The Scout skill describes general send/ask behavior, but does not have a crisp broker reply mode contract.
3. MCP tools distinguish send vs ask, but the main Scout MCP surface does not expose `current_reply_context` or a context-aware `reply` tool.
4. The phrase "final assistant message is the broker reply" is a hidden transport behavior, not an obvious affordance.
5. Different surfaces risk diverging: direct local-agent prompts use final-response capture, while channel MCP flows use explicit `scout_reply`.

## Goals

- Make inbound Scout asks unmistakable to the model, the skill, and MCP clients.
- Separate **reply to this inbound ask** from **send a new message** and **ask another agent**.
- Preserve the simple final-response path for direct local-agent invocation.
- Add a structured context that can be inspected or used by MCP tools.
- Reduce duplicate replies, local-only replies, and wrong-conversation replies.

## Non-goals

- Replacing `messages_send` or `invocations_ask`.
- Forcing all hosts to use MCP for final reply delivery.
- Changing Scout routing semantics for ordinary sends/asks.
- Solving every nested/multi-turn workflow in this proposal.

## Proposal

Introduce a first-class **Scout broker reply context** shared by prompt generation, Scout skills, and MCP.

### 1. Add an explicit prompt banner

Direct local-agent invocation prompts should start with a visible marker:

```text
SCOUT BROKER REPLY MODE

You are answering a Scout ask from @sender to @target.
Your final assistant message will be delivered back through the Scout broker.
Do not call scout send, messages_send, or invocations_ask to answer this request.
Only use Scout tools if you need to ask or delegate to another agent.
```

Then include the structured references:

```text
ScoutReplyContext:
- mode: broker_reply
- fromAgentId: sender
- toAgentId: target
- conversationId: dm.sender.target
- messageId: msg-...
- replyToMessageId: msg-...
- replyPath: final_response
```

This should replace the current subtle convention with a clear mode declaration.

### 2. Define `ScoutReplyContext` in protocol/runtime terms

Add a small shared shape, either in protocol or in runtime-local types first:

```ts
export interface ScoutReplyContext {
  mode: "broker_reply";
  fromAgentId: string;
  toAgentId: string;
  conversationId: string;
  messageId: string;
  replyToMessageId: string;
  replyPath: "final_response" | "mcp_reply";
  action?: "consult" | "execute" | "review" | "status" | "wake";
}
```

For direct local-agent invocation:

- `messageId` and `replyToMessageId` should both point to the request message the agent is answering, unless a future transport separates envelope id from reply target.
- `replyPath` should be `final_response`.

For channel/MCP-driven inbound messages:

- `replyPath` may be `mcp_reply`.
- The context should still use the same field names.

### 3. Update the Scout skill

Add a dedicated section to the Scout skill:

```md
## Broker reply mode

If the turn contains `SCOUT BROKER REPLY MODE`, `ScoutReplyContext`, or an active MCP reply context, you are answering an inbound Scout ask.

Default rule:
- your final assistant response is the broker-visible reply
- do not call `scout send`, `messages_send`, or `invocations_ask` to answer the requester
- use Scout tools only to delegate or ask another agent during the work
- return only the reply intended for the requester

If the active reply context says `replyPath: mcp_reply`, use the provided reply tool instead of final-response capture.
```

This gives the model a deterministic rule instead of relying on vibes. Tiny goblin removed from the machinery.

### 4. Add MCP visibility

Expose the same concept through MCP.

#### Resource: `scout://current-reply-context`

When a host has an active inbound Scout reply context, this resource returns:

```json
{
  "mode": "broker_reply",
  "fromAgentId": "pi-scout.main.arts-mac-mini-local",
  "toAgentId": "openscout-pi-extension",
  "conversationId": "dm...",
  "messageId": "msg...",
  "replyToMessageId": "msg...",
  "replyPath": "final_response"
}
```

When there is no active context, return either `null` or a structured empty response:

```json
{
  "mode": "none"
}
```

#### Tool: `messages_reply` or `scout_reply`

Add a context-aware reply tool to the main Scout MCP server:

```ts
messages_reply({
  body: string,
  conversationId?: string,
  replyToMessageId?: string,
})
```

Behavior:

- If `conversationId`/`replyToMessageId` are omitted, use the active `ScoutReplyContext`.
- If there is no active context and no explicit ids, return a clear error.
- Preserve `replyToMessageId` on the posted `MessageRecord`.
- Preserve conversation targeting instead of creating a fresh DM.

Error example:

```text
No active Scout broker reply context. Use messages_send for a new message, or pass conversationId and replyToMessageId explicitly.
```

### 5. Extend delivery contract for explicit replies

`ScoutDeliverRequest` already has `replyToMessageId`, but direct broker delivery currently chooses or creates the conversation from route inputs. Add/confirm support for explicit `conversationId` in delivery or use `/v1/messages` for replies.

Recommended shape:

```ts
interface ScoutDeliverRequest {
  conversationId?: ScoutId;
  replyToMessageId?: ScoutId;
  // existing fields...
}
```

Rules:

- If `conversationId` is present, post into that conversation.
- If `replyToMessageId` is present, set it on the message.
- If a target is also present, use it for notification/audience validation, not for choosing a different conversation.
- Reject inconsistent requests where `replyToMessageId` belongs to another conversation.

This is especially important for `/scout reply`, group/channel replies, and non-DM replies.

## Implementation Plan

### Phase 1: Prompt and skill contract

1. Update `buildLocalAgentDirectInvocationPrompt()` in `packages/runtime/src/local-agents.ts` to add:
   - `SCOUT BROKER REPLY MODE`
   - `ScoutReplyContext` block
   - explicit final-response instruction
2. Update the Scout skill(s):
   - `.agents/skills/scout/SKILL.md`
   - `/Users/art/.agents/skills/scout/SKILL.md` if maintained separately
3. Add tests asserting direct invocation prompts include the new marker and context.

### Phase 2: MCP context

1. Add an MCP resource or tool that returns the current reply context.
2. Add a context-aware reply tool to the main Scout MCP server.
3. Align the existing channel `scout_reply` instructions with the shared `ScoutReplyContext` language.

### Phase 3: Broker reply delivery

1. Add `conversationId?: ScoutId` to the delivery contract if using `/v1/deliver` for replies.
2. Ensure reply delivery posts to the requested conversation and preserves `replyToMessageId`.
3. Add validation for mismatched `conversationId` / `replyToMessageId`.
4. Add CLI/Pi support for `/scout reply` using the active reply context.

## Acceptance Criteria

- Direct Scout asks contain `SCOUT BROKER REPLY MODE` and a structured `ScoutReplyContext` block.
- The Scout skill explicitly defines broker reply mode behavior.
- Agents can distinguish answering an inbound ask from sending a new message.
- Main Scout MCP exposes either `current_reply_context`, `messages_reply`, or both.
- `messages_reply` / `scout_reply` errors clearly when there is no reply context.
- `/scout reply` can preserve both `conversationId` and `replyToMessageId`.
- Tests cover prompt generation, skill expectations where practical, MCP reply tool behavior, and broker reply delivery.

## Open Questions

1. Should `ScoutReplyContext` live in `@openscout/protocol`, or start runtime-local until multiple hosts consume it?
2. Should the main MCP tool be named `messages_reply`, `scout_reply`, or `reply_current`?
3. Should final-response capture remain the default for all direct invocations, or should some hosts require explicit MCP reply?
4. How should nested delegation report interim status without accidentally consuming the final reply path?
5. Should a reply context have a lease/expiry so stale chat turns cannot reply to old messages?

## References

- `packages/runtime/src/local-agents.ts` — direct local-agent invocation prompt generation
- `apps/desktop/src/core/mcp/scout-mcp.ts` — main Scout MCP server
- `apps/desktop/src/core/mcp/scout-channel.ts` — channel-style `scout_reply` surface
- `packages/protocol/src/scout-delivery.ts` — `ScoutDeliverRequest`, `replyToMessageId`
- `packages/protocol/src/messages.ts` — `MessageRecord.replyToMessageId`
- SCO-014: Broker-Owned Routing and Context
- SCO-015: Pi-Scout Integration
- SCO-016: External Agent Registration API
