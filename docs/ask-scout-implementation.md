# Ask Scout + Notifications: Implementation Plan

## Part 1: Ask Scout

### What it is

A text/voice input where you describe what you want. Scout interprets it and acts.

### How it works under the hood

One Claude Haiku call per utterance. The context window is small (~2K tokens):

```
Context = {
  workspaces       // from mobile.workspaces()
  running agents   // from mobile.agents()
  active sessions  // from mobile.sessions()
  recent activity  // from mobile.activity(limit: 10)
  current surface  // what the user is looking at
}
```

Claude gets tool definitions:
- `create_session(workspace_id, harness?, model?, branch?)`
- `resume_session(session_id)`
- `send_message(agent_id, message)`
- `show_activity(agent_id?)`
- `clarify(question)`

If the intent is clear, Scout acts immediately. If ambiguous, it asks one clarifying question.

### What to build

**Bridge (one new tRPC procedure):**

```typescript
mobile.askScout: procedure
  .input(z.object({
    text: z.string(),
    history: z.array(z.object({
      role: z.enum(["user", "scout"]),
      text: z.string(),
    })).optional(),
  }))
  .mutation(async ({ input, ctx }) => {
    // 1. Assemble context from existing endpoints
    // 2. Call Claude Haiku with tool definitions
    // 3. Execute tool call or return clarification
  })
```

Returns:
```typescript
{ action: "created_session", sessionId, title }
| { action: "resumed_session", sessionId }
| { action: "sent_message", conversationId }
| { action: "navigated", surface }
| { action: "clarify", question: string }
```

**iOS (one UI change):**

Tap the AddressBarPill → it expands into a text input. Follows the Safari address bar pattern already established. Conversation state is transient (no persistence needed for v1).

**Voice:**

- On non-session surfaces: mic tap = talk to Scout (it's the only thing to talk to)
- On session surfaces: mic tap = dictate to agent (current behavior)
- Long press from anywhere: talk to Scout (override)

The `MicButton` already has `onLongPressStart`/`onLongPressEnd` slots wired to nil.

### What NOT to build

- No special "scout agent" running in tmux
- No persistent conversation history
- No streaming response (Haiku is fast enough as single response)
- No plan review step
- No screen dimming or overlay

---

## Part 2: Notifications (Human as Agent)

### The insight

The operator is already a first-class actor in the broker (`OPERATOR_ID = "operator"`). Agents already @mention each other via the relay. The missing piece: when an agent @mentions the operator, that should become a push notification.

### Three tiers

| Tier | Delivery | When |
|------|----------|------|
| **Interrupt** | Push notification + sound | Agent asks operator a question, flight failed, tool approval needed |
| **Badge** | Badge count increment | Flight completed, agent @mentioned operator, work item needs review |
| **Silent** | Feed item only | Agent-to-agent messages, status updates |

### Triage function (bridge side)

```typescript
function triageForOperator(item: ActivityItem): "interrupt" | "badge" | "silent" {
  if (item.kind === "ask_opened" && item.counterpartId === "operator") return "interrupt";
  if (item.kind === "ask_failed") return "interrupt";
  if (item.kind === "flight_updated" && item.payload?.state === "failed") return "interrupt";
  if (item.kind === "flight_updated" && item.payload?.state === "completed") return "badge";
  if (item.kind === "message_posted" && mentionsOperator(item)) return "badge";
  if (item.kind === "collaboration_event" && item.payload?.nextMoveOwnerId === "operator") return "badge";
  return "silent";
}
```

### Delivery (no cloud required)

The bridge sends a new event type through the existing WebSocket:

```json
{ "event": "operator:notify", "item": { ... }, "tier": "interrupt" }
```

The iOS app receives this in ConnectionManager's message loop and posts a local `UNNotificationRequest`. Works when the app is in foreground or recently backgrounded (WebSocket stays alive briefly).

For v1, no notification when the app is fully terminated. The user opens the app, sees the activity feed, catches up. Background APNs delivery is a v2 concern that requires a cloud relay.

### iOS implementation

1. Request notification permission during onboarding
2. Handle `operator:notify` events in ConnectionManager → post `UNNotificationRequest`
3. Deep-link from notification tap → `router.push(.sessionDetail(sessionId:))`
4. Badge count: increment on "badge" tier, reset when activity feed opens
5. Activity feed: add "Needs Attention" filter (computed from `needsAttention` property on ActivityItem)

### What this does NOT require

- No cloud server or APNs provisioning
- No new actor types or protocol changes
- No changes to how agents @mention each other
- No new relay infrastructure

The entire notification system is a thin event type (`operator:notify`) on top of the existing activity feed, delivery planner, and WebSocket relay.

---

## Combined Architecture

```
User speaks/types "work on auth in openscout"
        │
        ▼
   AddressBarPill (expanded)
        │
        ▼
   mobile.askScout RPC
        │
        ▼
   Context assembly (workspaces + agents + sessions + activity)
        │
        ▼
   Claude Haiku (tool_use)
        │
        ├─ create_session → createScoutSession → agent starts
        ├─ resume_session → router.push(.sessionDetail)
        ├─ send_message  → relay message to agent
        └─ clarify       → "Which project?" shown inline
        
        ···later···

   Agent finishes / fails / needs decision
        │
        ▼
   triageForOperator(activityItem)
        │
        ├─ interrupt → operator:notify event → push notification
        ├─ badge     → operator:notify event → badge increment
        └─ silent    → activity feed only
```

## Estimated scope

| Component | Size | Dependencies |
|-----------|------|-------------|
| `askScout` tRPC procedure | ~100 lines | Claude API key (already on Mac for Claude Code) |
| Context assembly function | ~50 lines | Existing mobile.* endpoints |
| AddressBarPill expansion | ~80 lines iOS | Existing SwiftUI patterns |
| Voice routing (long press) | ~20 lines iOS | Existing MicButton slots |
| `triageForOperator` function | ~30 lines | Existing ActivityItem types |
| `operator:notify` event emission | ~20 lines | Existing bridge event system |
| iOS notification handling | ~60 lines | UNUserNotificationCenter |
| "Needs Attention" filter | ~30 lines iOS | Existing ActivityFeedView |

Total: ~400 lines of new code across bridge + iOS. No new infrastructure.
