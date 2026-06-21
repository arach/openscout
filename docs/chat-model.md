# Chat Model

This note defines Chat as the user-facing communication place in OpenScout.
It complements `docs/scout-comms.md`, which describes the broker records and
integration workflows.

## Summary

A Chat is the durable place where Scout-owned messages live. Internally the
protocol and broker still call that record a `ConversationDefinition`, but
product APIs and UI should call its identifier a Chat ID. Chat IDs are opaque
broker row ids; they do not encode participants, channel names, paths, or
session ids.

The core separation is:

- Chat is communication continuity.
- Workspace or folder path is agent context continuity.
- Session is harness runtime continuity.
- Task or Ask is requested work.
- Run or Flight is work lifecycle.

Those axes often point at one another, but they must not collapse into one
object.

## Current Ontology Gaps

The current implementation has the right raw records, but several concepts are
still too close together:

1. A selected conversation has sometimes been treated as a route hint. If the
   user sends inside a selected Chat, the write path must append to that Chat
   instead of resolving the agent again and possibly creating another direct
   conversation.
2. `sessionId` is useful context, but it is not Chat identity. A Chat may
   reference one or more harness sessions over time.
3. `ScoutChannel` is an overloaded native model name. It currently represents
   direct messages, group direct conversations, named channels, and threads.
   Channel should mean a named shared room, not every Chat row.
4. Passive comment, steering, and requested work are not the same intent. A
   comment only appends a message. Steering appends a message and wakes the
   scoped participants. Ask or Task creates owned invocation and run lifecycle.
5. Thread is already overloaded by provider `threadId` values and broker
   `kind: "thread"`. Use Thread only for nested reply threads or provider
   metadata unless the repo does a deliberate rename.
6. Agent cards have sometimes been treated as the stable thing. The stable user
   intent is usually "open a working companion in this folder/path"; the card
   and agent id are selectors for that context, not the communication record.

## Invariants

The Chat concept is healthy when these rules hold:

- A message belongs to exactly one Chat.
- A selected Chat id is authoritative for message sends.
- Sending a passive comment does not create a task, invocation, flight, or new
  harness session.
- When the operator speaks inside a live agent-to-agent DM, group direct, or
  channel, the default product intent is steering the current non-human
  participants in that Chat.
- A Chat can contain messages from humans, agents, and system actors.
- A Chat can reference active or historical tasks, runs, endpoints, and sessions
  without becoming any of those objects.
- Agent identity changes, endpoint changes, and session changes must not mutate
  Chat identity.
- Folder or workspace paths may be deterministic locators for agent context.
  They must not be copied into Chat IDs.
- Direct Chat lookup uses metadata/natural keys and broker state, not structural
  ids such as participant names joined into the id string.
- Channel-style Chats are still Chats, but the named channel is the routing and
  grouping affordance for that Chat.
- Delivery and wake are side effects of routing and notification policy. They
  must not decide which Chat a message belongs to.

## Relationships

```text
Agent workspace / folder path
  -> owns agent instructions, local config, and bootstrap context
  -> can resolve or create an agent identity

Agent identity
  -> has zero or more cards and aliases
  -> has zero or more endpoints over time
  -> endpoints attach to harness sessions

Chat / Conversation
  -> has participants
  -> has messages
  -> may have active and historical tasks/runs
  -> may reference endpoint/session context

Message
  -> belongs to one Chat
  -> has an actor
  -> may reply to another message
  -> may mention/notify participants
  -> may carry intent metadata such as steering

Task / Ask / Invocation
  -> is created intentionally from a command or composer action
  -> belongs to a Chat
  -> targets an agent, project, capability, or exact session
  -> has one or more Runs / Flights

Run / Flight
  -> tracks queued, running, waiting, completed, failed, or cancelled lifecycle
  -> references the invocation and any endpoint/session used
```

## Write Intents

The write intent should be explicit before routing starts.

| Intent | Product action | Internal records |
| --- | --- | --- |
| Comment | Passive note in an open Chat | Message in that Chat |
| Ask / task | Explicit ask/task action | Message + invocation + flight |
| Steering | Operator speaks in an agent space, or explicitly selects steer | Message in the same Chat + wake invocations for scoped participants |
| Reply | Reply to a message | Message in same Chat with `replyToMessageId` |
| Channel post | Send in a named channel Chat | Message in that channel Chat |
| Open companion | Open agent from a path/card | Resolve path-backed agent context, then find or create opaque direct Chat |

The overloaded endpoint `POST /api/send` should remain a transition layer,
but new product APIs should prefer intent-specific shapes such as:

```text
POST /chats/:chatId/messages
POST /tasks
POST /flights/:flightId/steering
POST /messages/:messageId/replies
```

## UI Model

Comms should be Chat-first:

- The list row represents a Chat, not a session.
- The primary label should explain the Chat context or purpose, not only repeat
  the agent name.
- Secondary metadata may show status, harness, branch, short session id, and
  short Chat id, especially when multiple Chats involve the same agent.
- Full ids, participants, natural key, session links, and run history belong in
  inspector or copy/detail affordances.
- Active work should appear as a run/status chip or band, not as hidden meaning
  inside the row title.

Agent views should be Agent-first:

- Agent identity and current endpoint/session live at the top.
- Recent Chats are grouped under the agent as separate contexts.
- Runtime sessions and active runs have their own rows and actions.

## Naming

Use publicly:

- Chat: main Comms object.
- Chat ID: opaque id for the broker Conversation row.
- Path or Workspace: deterministic local context for an agent companion.
- Session: concrete harness runtime context.
- Task or Ask: explicit requested work.
- Run: user-facing lifecycle of a task.
- Needs attention: human or system unblock state.

Keep internally:

- Conversation: broker/protocol storage object behind Chat.
- Invocation: task request record.
- Flight: internal run lifecycle record.
- Delivery: transport fan-out.
- Endpoint: route attachment to a session.

Avoid using Thread for the primary Chat object until provider `threadId`, broker
thread conversations, and any nested reply model have a clearer migration.

## Migration Plan

Immediate:

- Keep selected Chat ID authoritative for message sends.
- Reject structural Chat IDs in product routes.
- Route "open companion" through path-backed agent context plus selector hints.
- Show Chat language in user-facing surfaces.
- Keep Send and Ask behavior separate in tests.

Near term:

- Rename native UI models from `ScoutChannel` toward `ScoutChat`.
- Add duplicate-aware Chat titles for same-agent contexts.
- Split composer actions visibly: Send message vs Ask/Task.
- Add message intent metadata for steering and active-run steering.

Later:

- Normalize provider `threadId` into provider/session metadata.
- Reserve broker `kind: "thread"` for nested or derived conversation threads.
- Rename user-facing Flight surfaces to Run.
- Keep deterministic path/folder locators for agents, but never for Chat IDs.

## Regression Checks

At minimum, the suite should prove:

- Sending in a selected direct Chat preserves that exact Chat.
- Operator sends in selected agent/group/channel Chats steer current scoped
  participants by default.
- Passive comments in selected Chats append without creating invocations.
- Target-only direct send can still open or create a direct Chat.
- Ask or Task creates invocation/run lifecycle; passive comments do not.
- Active-run steering remains in the same Chat and links to the active run.
- Same-agent multiple Chats render distinguishable labels.
- Session changes do not change Chat identity.
- Offline or missing endpoints surface delivery/wake state without forking the
  Chat.
