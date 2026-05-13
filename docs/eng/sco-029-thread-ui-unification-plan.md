# SCO-029: Thread UI Unification Plan

## Context

OpenScout's broker model already has a coherent record graph:

- conversations are durable communication containers
- channels are conversation records with `kind: "channel"`
- direct messages can include operator-agent or agent-agent participants
- sessions are concrete harness/runtime lifecycles
- invocations/flights/runs are execution attempts
- work items are durable ownership records

The web UI currently exposes several adjacent slices of that graph as separate
top-level product nouns: Conversations, Channels, Sessions, Agents message tabs,
Runs, Activity, Follow, and Ops submodes. This has created product confusion and
implementation bugs. A recent example: a contribution sent from an agent-agent
direct conversation appeared optimistically, then disappeared after canonical
reload because the web send route treated the viewed thread as an operator DM.

## Goal

Make "thread" the canonical UI concept for all broker conversations. Direct
messages, agent-agent conversations, channels, group DMs, and system threads
should share one message-feed implementation and one route reconciliation model.

## Non-Goals

- Do not change broker ownership boundaries.
- Do not bulk-import external harness transcripts as Scout messages.
- Do not claim enterprise or multi-tenant readiness.
- Do not remove legacy routes in the first pass; keep compatibility redirects
  or entry points where needed.
- Do not redesign diagnostics such as Broker, Tail, Atop, or Mesh beyond nav
  placement/copy if needed for the thread work.

## Proposed Product Model

```text
Workspace / Project
  Agents
    Runtime Sessions
      Observed Harness Events
  Threads
    Direct Messages
    Channels
    Group DMs
    System Threads
    Messages
    Invocations / Flights
    Linked Work Items
  Work
    Work Items
      Runs / Flights
      Materials
      Timeline
  Diagnostics
    Mesh
    Broker
    Tail
    Atop
```

## Implementation Phases

### Phase 1: Canonical Thread Routing

Make `/c/:conversationId` the canonical renderer for every broker conversation
kind.

Expected changes:

- Stop redirecting `channel.*` conversation IDs away from `ConversationScreen`.
- Make `/channels/:channelId` an entry/filter route that opens the canonical
  thread renderer or embeds the shared thread feed.
- Make agent message tabs route through the canonical conversation path or use
  the same shared thread feed implementation.
- Keep legacy routes such as `/agent/:conversationId` and
  `/agents/:agentId/c/:conversationId` working as compatibility entry points.

Likely files:

- `packages/web/client/lib/router.ts`
- `packages/web/client/lib/conversations.ts`
- `packages/web/client/screens/ConversationScreen.tsx`
- `packages/web/client/screens/ChannelsScreen.tsx`
- `packages/web/client/screens/AgentsScreen.tsx`
- `packages/web/client/scout/slots/Content.tsx`
- `packages/web/client/scout/slots/LeftPanel.tsx`

### Phase 2: Shared Thread Feed State

Extract shared message feed behavior from `ConversationScreen` and
`ChannelsScreen`.

The shared implementation should own:

- loading `/api/messages?conversationId=...`
- subscribing to broker/SSE message events
- adding optimistic messages
- replacing or removing optimistic rows after server acknowledgement
- handling canonical conversation IDs returned from sends
- rendering actor labels from broker participants/actors, not from route naming
- preserving mentions and audience metadata in display

Expected result:

- Direct threads and channel threads use the same reconciliation rules.
- Optimistic contributions cannot vanish just because the server canonicalized
  the route or delivery target.
- Agent-agent conversations do not assume an operator-agent DM shape.

Likely files:

- `packages/web/client/screens/ConversationScreen.tsx`
- `packages/web/client/screens/ChannelsScreen.tsx`
- new colocated hook/component under `packages/web/client/screens/` or
  `packages/web/client/components/`

### Phase 3: Type and Naming Cleanup

Separate client types that currently hide different semantics.

Expected changes:

- Replace `ConversationEntry = SessionEntry` with explicit types:
  - `ConversationSummary`
  - `HarnessSessionSummary`
  - `ThreadSummary` if useful for UI grouping
- Audit screens that use "session" when they mean "conversation summary."
- Rename user-facing `/sessions` copy to "Runtime", "Observe", or
  "Runtime Sessions" so it only means concrete harness lifecycles.
- Rename Ranger "Sessions" to "Chats" or "Ranger Chats" if touched.

Likely files:

- `packages/web/client/lib/types.ts`
- `packages/web/client/screens/ConversationsScreen.tsx`
- `packages/web/client/screens/SessionsScreen.tsx`
- `packages/web/client/screens/SessionRefScreen.tsx`
- `packages/web/client/scout/inspector/SessionsInspector.tsx`
- `packages/web/client/scout/ranger/RangerPanel.tsx`

### Phase 4: Navigation Simplification

Move toward a product nav of:

- Home
- Agents
- Threads
- Work
- Observe
- Mesh
- Settings

Broker, Activity, Tail, Atop, Runs, Follow, and Terminal should become
diagnostic/contextual surfaces rather than primary nouns.

Expected changes:

- Rename "Conversations" to "Threads" in nav/copy.
- Treat "Channels" as a filter/type under Threads.
- Keep Mesh visible because reachability is a real pilot concern.
- Keep Broker and low-level diagnostics accessible via command palette or a
  diagnostics group.

Likely files:

- `packages/web/client/scout/hooks.ts`
- `packages/web/client/scout/slots/LeftPanel.tsx`
- `packages/web/client/screens/ConversationsScreen.tsx`
- `packages/web/client/screens/ChannelsScreen.tsx`
- `packages/web/client/screens/OpsScreen.tsx`

## Acceptance Criteria

- Opening a direct, agent-agent, channel, or system conversation by ID uses the
  same canonical thread renderer.
- Sending a message from any thread keeps the contribution visible after reload.
- Sending a message with exactly one `@agent` mention from a channel/thread
  appends to the viewed thread and not an unrelated operator DM.
- The client reconciles optimistic rows using server-returned `conversationId`
  and `messageId` when available.
- Primary nav no longer presents Conversations, Sessions, and Channels as three
  peer concepts without explanation.
- Runtime/session wording is reserved for harness lifecycles.
- Compatibility routes continue to open the appropriate canonical surface.

## Verification

Run narrow tests first:

```bash
bun test packages/web/client/lib/router.test.ts
bun test packages/web/server/create-openscout-web-server.test.ts
bun test packages/web/server/core/broker/service.test.ts
```

Then run build checks:

```bash
bun run --cwd packages/web build:server
npm --prefix packages/cli run build
```

Manual smoke checks:

- `/c/dm.operator.<agent>`
- `/c/dm.<agent-a>.<agent-b>`
- `/c/channel.<name>`
- `/channels/<channel-id>`
- `/agents/<agent-id>?tab=message`
- send plain text
- send one `@agent` mention
- reload after send and confirm the message remains in the viewed thread
