# SCO-015: Pi-Scout Integration

## Status

Proposed.

## Intent

Integrate pi as a first-class Scout agent by building a pi extension that makes Scout coordination native to the pi experience. The extension bridges pi sessions to the Scout broker, exposes Scout tools (send, ask, who) with guided UX, and handles real-time notifications via SSE.

## Problem

pi sessions today cannot participate in Scout's broker-backed coordination model. Other harnesses (Codex, Claude Code) integrate via Scout MCP tools, but pi has no such integration. This means:

- pi sessions cannot send/ask to other Scout agents
- pi sessions cannot be routed to by other agents
- users must switch to Scout CLI or desktop app for coordination

The goal is not to replicate Scout's CLI or desktop UI inside pi. The goal is to make Scout coordination accessible from within pi's natural interaction model.

## What This Is Not

- Not a reimplementation of Scout's monitor or desktop TUI
- Not a replacement for `pi-intercom` or `pi-subagents` — those remain for intra-pi coordination
- Not OpenTUI-based — the pi extension uses `pi-tui` (the same TUI stack as `pi-intercom` and `pi-subagents`)

## What This Is

A pi extension that:

1. **Bridges to Scout broker** — connects to `http://127.0.0.1:65535` (or `OPENSCOUT_BROKER_URL`) on startup
2. **Exposes Scout tools** — `scout_send`, `scout_ask`, `scout_who`, `scout_ps` as first-class pi tools
3. **Adds guided UX** — agent picker with fuzzy search, message compose overlay, inline incoming message rendering
4. **Handles SSE notifications** — real-time delivery of messages, flight completions, and other broker events
5. **Registers pi sessions with Scout** — pi sessions become routable Scout agents

## Design Principles

1. **External tool with native UX** — Scout operations are external (calling Scout broker HTTP API), but the interaction feels first-class in pi
2. **Broker-owned routing** — use `/v1/deliver` with `ScoutRouteTarget` intent, not preflight resolution
3. **Follow existing patterns** — use `pi-tui` Component interface exactly as `pi-intercom` and `pi-subagents` do
4. **Scout handles protocol complexity** — extension surface is simple; broker handles `replyMode`, `flightId`, etc.

## Architecture

```
pi session + pi-scout extension
├── Extension entry point (index.ts)
├── Tools (scout_send, scout_ask, scout_who, scout_ps)
├── UI (agent picker, compose, inline message)
└── Broker client (HTTP + SSE)

        ↕ Unix socket (preferred) or HTTP + SSE

Scout broker (local_socket: ~/.openscout/broker.sock)
├── Agent registry
├── Message routing
└── Flight tracking

        ↕

Other Scout agents (Codex, Claude, etc.)
```

### Directory Structure

```
pi-scout/
├── index.ts                 # Extension entry point
├── types.ts                 # Shared types
├── config.ts                # Config loading
├── broker/
│   ├── client.ts            # Broker HTTP client + SSE subscription
│   └── sse.ts               # SSE event handling
├── tools/
│   ├── send.ts              # scout_send tool
│   ├── ask.ts               # scout_ask tool
│   └── who.ts               # scout_who / scout_ps tools
├── ui/
│   ├── agent-picker.ts      # Agent selection overlay (fuzzy search)
│   ├── compose.ts           # Message compose overlay
│   └── inline-message.ts   # Incoming Scout message renderer
└── skills/
    └── scout-coordination/
        └── SKILL.md  # Bundled skill for patterns
```

## TUI Stack Decision

**Use `pi-tui` (not OpenTUI)**

Rationale: Both `pi-intercom` and `pi-subagents` use `pi-tui` directly with the `Component` interface:

```typescript
// pi-tui Component pattern (used by pi-intercom, pi-subagents)
export class SessionListOverlay implements Component {
  render(width: number): string[] {
    // Returns ANSI-colored string array
  }
  handleInput(data: string): void { }
  invalidate(): void { }
}

// Usage in pi extension
ctx.ui.custom((tui, theme, kb, done) => { ... })
```

OpenTUI (React-based) is Scout's desktop TUI stack and is not used by pi extensions. The pi extension should follow the established `pi-tui` pattern.

## Tool Surface

### scout_send

```typescript
pi.registerTool({
  name: "scout_send",
  label: "Scout Send",
  description: "Send a message to a Scout agent via the broker",
  parameters: Type.Object({
    target: Type.String({ description: "Agent label (e.g. @hudson)" }),
    body: Type.String({ description: "Message body" }),
    channel: Type.Optional(Type.String()),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) { ... }
})
```

### scout_ask

```typescript
pi.registerTool({
  name: "scout_ask",
  label: "Scout Ask",
  description: "Ask a Scout agent to do work and wait for the result",
  parameters: Type.Object({
    target: Type.String({ description: "Agent label" }),
    body: Type.String({ description: "Task description" }),
    replyMode: Type.Optional(Type.Enum(["none", "inline", "notify"])),
    workItem: Type.Optional(Type.Object({ ... })),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) { ... }
})
```

### scout_who

Lists known Scout agents with state, harness, project root.

### scout_ps

Lists active Scout sessions (same data as `scout who` but session-focused).

## Broker Integration

### Connection

On extension startup, connect to broker. Two transport options:

| Transport | Use case | Address |
|---|---|---|
| `local_socket` | Local extensions (pi-scout) | `~/.openscout/broker.sock` |
| `http` | Mesh comms, web app | `http://127.0.0.1:65535` |

**Same endpoints and semantics regardless of transport.** Only the connection path differs.

### Transport Priority

```
pi-scout extension
│
└─▶ ~/.openscout/broker.sock (Unix socket)  ← local comms

HTTP transport used for:
  - Mesh nodes (remote brokers)
  - Web app
  - Any non-local connection
```

### API Calls (same for both transports)

```typescript
// Send / Ask via deliver
POST /v1/deliver
{
  intent: "tell" | "consult",
  body: string,
  target: { kind: "agent_label", label: "hudson" }
}

// Agent registry
GET /v1/snapshot  // Full agent list

// SSE for real-time notifications
GET /v1/events/stream  // Broker event stream (SSE)
```

### Agent Registration

On startup, the extension registers the pi session as a Scout agent:

```typescript
pi.on("session_start", async (_event, ctx) => {
  // Register endpoint with broker
  // Include: agentId, displayName, projectRoot, harness: "pi"
})
```

This makes pi sessions routable by other Scout agents.

## Reply Mode Handling

Broker supports three reply modes (SCO-014):

- `none` — return immediately with IDs, caller inspects history
- `inline` — block until flight completes (existing `awaitReply` behavior)
- `notify` — return immediately, SSE emits `notifications/scout/reply`

The extension handles the complexity:

- For `inline`: `await waitForFlight(flightId)` in tool execute
- For `notify`: register SSE handler for flight completion, surface as inline message
- For `none`: return receipt immediately

## Slash Commands

```bash
/scout send @hudson "review the parser"
/scout ask @hudson "build the editor"
/scout who
/scout ps
```

Commands use agent picker with fuzzy search when no target specified.

## Relationship to Other Tools

| Tool | Scope | Notes |
|------|-------|-------|
| `pi-intercom` | Same-machine pi sessions | Local IPC broker, direct 1:1 |
| `pi-subagents` | Subagent orchestration | Launches child pi sessions |
| `pi-scout` | Cross-harness coordination via Scout broker | Reaches Codex, Claude, other Scout agents |

`pi-scout` complements `pi-intercom`:
- Need to coordinate across harnesses (pi ↔ Codex)? Use Scout
- Need to coordinate within pi sessions? Use intercom

## Implementation Phases

### Phase 1: Core Extension + Tools

- Extension entry point
- Broker client (HTTP + basic auth)
- `scout_send` and `scout_ask` tools
- Session registration with broker

### Phase 2: Agent Picker + Compose UI

- Fuzzy search agent picker overlay
- Message compose overlay
- Inline message rendering for incoming

### Phase 3: SSE + Real-time

- SSE subscription to broker
- Flight completion notifications
- Live message streaming

### Phase 4: Slash Commands

- `/scout` command group
- Agent picker as default
- Guided send/ask flows

## Open Questions

1. Should the extension auto-register as a Scout agent on every session_start, or require explicit opt-in?
2. How should `replyMode: "notify"` surface in pi — as a triggered turn, an inline message, or a status update?
3. Should agent picker show only current-project agents or all known Scout agents?
4. Should `@pi` or similar be reserved as a Scout address prefix for pi sessions?

## Test Plan

1. Send a message from pi session A to a Scout agent (e.g., Codex) via broker
2. Receive reply in pi session A from the target agent
3. List known Scout agents with `scout_who`
4. Ask with work item creation (`intent: "consult"` + `workItem`)
5. Verify SSE notifications surface inline in pi
6. Verify pi session is routable by other agents via Scout broker

## References

- SCO-014: Broker-Owned Routing and Caller Context
- SCO-011: External Runtime Integration and Handoff
- pi-tui Component pattern (pi-intercom, pi-subagents)
- Scout `/v1/deliver` API
