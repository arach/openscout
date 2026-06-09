# Conversation Surface Inventory

## Context

The web UI has several pages that are visually and behaviorally close to one
another because they all orbit the same broker conversation/session graph. The
direct conversation route is currently the most polished composition, but it is
also the easiest place to notice live-panel repaint churn because it combines
the full conversation surface with the conversation inspector, terminal peek,
tail preview, and global broker updates.

This inventory names the overlap so future cleanup can preserve the aesthetic
direction while making refresh boundaries calmer.

## Close Surfaces

| Route | Primary content | Right context | Notes |
| --- | --- | --- | --- |
| `/c/:conversationId` | `ConversationScreen` in full-page mode | `ConversationInspector` | Best visual composition today: conversation owns the room, header metadata is compact, and live activity is beside the thread. |
| `/agents/:agentId/c/:conversationId` | `AgentsScreen` message tab with embedded `ConversationScreen` | `AgentsInspector` | Same message body in a profile shell. Useful for agent context, but visually heavier and less conversation-native. |
| `/agents/:agentId?tab=message` | `AgentsScreen` message tab with implied DM conversation | `AgentsInspector` | Compatibility/convenience form of the agent message route. |
| `/messages/:conversationId` | `MessagesScreen` message index/detail shell | Slot inspector selected by route | Adjacent to conversations, but starts from inbox/filter workflow rather than the thread as the main object. |
| `/conversations` | `ConversationsScreen` list | General inspector | Discovery/list route for broker conversations. |
| `/channels/:channelId` | `ChannelsScreen` channel feed | `ChannelInspectorPanel` | Parallel thread implementation for channel-shaped conversations. |
| `/agent/:conversationId` | `AgentInfoScreen` legacy profile surface | `AgentsInspector` | Legacy agent-info route that still points back to conversation/profile affordances. |
| `/terminal/:agentId` | `TerminalScreen` observe/takeover surface | `TerminalInspector` | Runtime/session surface adjacent to the thread when terminal context is the main object. |

## Inspector Overlap

- `ConversationInspector` combines conversation metadata, latest message,
  active flight state, live terminal actions, `TmuxPeekPanel`, and matching Tail
  preview events.
- `AgentsInspector` shows profile/context details and also includes live
  terminal/observe affordances for the selected agent.
- `TerminalInspector` treats the terminal as the primary object.
- `ChannelInspectorPanel` is the channel-specific sibling for group/channel
  conversations.

## Current Refresh Risk

The direct conversation page listens to several live sources at once:

- broker control events for messages, conversations, invocations, and flights
- the global agent refresh loop in `ScoutProvider`
- terminal peek polling when the agent transport is `tmux`
- Tail preview history and live Tail events

The first cleanup should keep `/c/:conversationId` as the canonical aesthetic
target, but scope each live source to the current conversation/agent and avoid
resetting state when fetched payloads are unchanged.

## Flicker Audit Findings

On the Openscout Card conversation route, the selected tmux payload was stable
across repeated samples: the terminal body hash stayed unchanged while
`capturedAt` changed. That means sample freshness was not terminal activity.

Likely flicker multipliers:

- `ConversationInspector` previously reloaded on every `flight.updated` and
  `invocation.requested` event, even when unrelated to the current
  conversation. This has been scoped to the current conversation/known flight
  and coalesced.
- `ScoutProvider` polls `/api/agents` and also reloads agents for broad broker
  events. The API can return byte-identical data, so replacing the `agents`
  array still caused shell-wide React churn. Agent state now preserves the
  previous array when the fetched payload is unchanged.
- `TmuxPeekPanel` polls while visible, but polling is not activity. The preview
  now preserves the previous frame when pane content is unchanged and only marks
  a frame as changed when the terminal content changes while the panel is
  observing. A repeated identical sample settles the panel back to an `At rest`
  badge.
- `ConversationScreen` still has intentional low-frequency re-renders for
  relative timestamps (`15s`) and outstanding-turn polling (`5s` only while an
  outstanding turn is active), but its reload path now preserves existing
  message, flight, metadata, and attention-set references when fetched payloads
  are unchanged.
- `ConversationScreen.load()` also posted the read cursor on every reload. The
  broker emits `conversation.read_cursor.updated` with a fresh `updatedAt`, so
  the client now avoids reposting the same last-read message id from repeated
  identical reloads.
- Several adjacent panels still have broad `useBrokerEvents(() => load())`
  subscriptions. They are route-dependent, but should be narrowed before those
  surfaces are treated as canonical.

## Ambient Burst Contract

Conversation context should present activity as an ambient cue, not as the raw
stream. Tail, Terminal, Observe, and Trace remain the high-granularity surfaces.

For conversation inspectors:

- accumulate matching broker invalidations before refetching conversation
  metadata, with a bounded max wait so the panel cannot go stale indefinitely
- accumulate Tail preview events into short bursts, then release them in small
  batches with CSS-owned easing
- keep terminal previews visible when useful, but treat tmux sampling as
  background observation; visible motion/freshness should be based on terminal
  content changes, not poll timestamps
- preserve existing row and panel state while fetching or releasing bursts
- keep animation timing and easing as module/CSS constants, not per-frame React
  calculations
- link to Tail for the detailed stream instead of turning the inspector into a
  second raw event feed

## Cleanup Direction

- Treat `/c/:conversationId` as the canonical thread composition.
- Keep agent-scoped message routes as compatibility/profile entry points unless
  product navigation intentionally chooses the profile shell.
- Extract the message feed so direct, agent, and channel routes share message
  loading, optimistic reconciliation, and broker event scoping.
- Share live activity components across conversation, agent, and terminal
  inspectors with explicit refresh contracts.
- Reserve terminal-focused routes for observe/takeover work, and keep compact
  terminal peeks visually stable inside inspectors.
