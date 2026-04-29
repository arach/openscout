# Pi-Scout Extension: Implementation Plan

## Overview

Build a pi extension (`pi-scout`) that bridges pi sessions to Scout's broker for cross-harness coordination. pi sessions become first-class Scout agents that can send/ask to Codex, Claude, and other Scout-aware agents.

**Transport:** Unix socket (`~/.openscout/control-plane/runtime/broker.sock`) for local comms. HTTP fallback for mesh/web.

## Directory Structure

```
~/.pi/agent/extensions/pi-scout/
├── index.ts                 # Extension entry point
├── types.ts                # Shared types
├── config.ts               # Config loading (socket path, defaults)
├── broker/
│   ├── client.ts           # Unix socket client (HTTP-over-socket)
│   └── sse.ts              # SSE subscription via socket
├── tools/
│   ├── send.ts             # scout_send tool
│   ├── ask.ts              # scout_ask tool
│   └── who.ts              # scout_who / scout_ps tools
├── ui/
│   ├── agent-picker.ts      # Agent picker overlay (fuzzy search)
│   ├── compose.ts          # Message compose overlay
│   └── inline-message.ts   # Incoming Scout message renderer
└── skills/
    └── scout-coordination.md  # Bundled skill for patterns
```

## Implementation Steps

### Step 1: Extension Scaffold + Config

**Files:** `index.ts`, `types.ts`, `config.ts`, `package.json`

- Register extension with `pi.registerTool()` for scout tools
- Load config from `~/.pi/agent/extensions/pi-scout/config.json`
- Config fields: `socketPath`, `defaultReplyMode`, `autoRegister`

### Step 2: Unix Socket Broker Client

**File:** `broker/client.ts`, `broker/sse.ts`

- Connect to Unix socket at `OPENSCOUT_BROKER_SOCKET_PATH` or `~/Library/Application Support/OpenScout/runtime/broker.sock`
- Send HTTP-style requests over socket (same headers/body format as HTTP)
- Parse HTTP responses from socket
- SSE subscription via socket to `/v1/events/stream`

```typescript
// Unix socket client (HTTP-over-socket)
import { createConnection } from "node:net";

async function request(
  socketPath: string,
  method: string,
  path: string,
  body?: unknown
): Promise<string> {
  const socket = await connect(socketPath);
  const req = buildHttpRequest(method, path, body);
  socket.write(req);
  return readHttpResponse(socket);
}
```

### Step 3: Scout Tools

**Files:** `tools/send.ts`, `tools/ask.ts`, `tools/who.ts`

**scout_send:**
```typescript
pi.registerTool({
  name: "scout_send",
  label: "Scout Send",
  description: "Send a message to a Scout agent via broker",
  parameters: Type.Object({
    target: Type.String(),
    body: Type.String(),
    channel: Type.Optional(Type.String()),
  }),
  async execute(id, params, signal, onUpdate, ctx) {
    const response = await brokerClient.deliver({
      intent: "tell",
      body: params.body,
      target: { kind: "agent_label", label: params.target },
      channel: params.channel,
    });
    return {
      content: [{ type: "text", text: response.receiptText }],
      details: response,
    };
  }
});
```

**scout_ask:**
```typescript
pi.registerTool({
  name: "scout_ask",
  label: "Scout Ask",
  description: "Ask a Scout agent to do work and wait for result",
  parameters: Type.Object({
    target: Type.String(),
    body: Type.String(),
    replyMode: Type.Optional(Type.Enum(["none", "inline", "notify"])),
    workItem: Type.Optional(Type.Object({ title: Type.String() })),
  }),
  async execute(id, params, signal, onUpdate, ctx) {
    const response = await brokerClient.deliver({
      intent: "consult",
      body: params.body,
      target: { kind: "agent_label", label: params.target },
      workItem: params.workItem,
    });

    if (params.replyMode === "inline" && response.flight) {
      const result = await brokerClient.waitForFlight(response.flight.id, { signal });
      return { content: [{ type: "text", text: result.output ?? result.summary }], details: result };
    }

    return { content: [{ type: "text", text: response.receiptText }], details: response };
  }
});
```

**scout_who:**
```typescript
pi.registerTool({
  name: "scout_who",
  label: "Scout Who",
  description: "List known Scout agents",
  async execute(id, params, signal, onUpdate, ctx) {
    const snapshot = await brokerClient.getSnapshot();
    const agents = Object.values(snapshot.agents).map(a => ({
      id: a.id,
      label: a.selector ?? a.id,
      state: snapshot.endpoints.find(e => e.agentId === a.id)?.state ?? "offline",
      harness: snapshot.endpoints.find(e => e.agentId === a.id)?.harness,
    }));
    return {
      content: [{ type: "text", text: agents.map(a => `${a.label} · ${a.state}`).join("\n") }],
      details: { agents },
    };
  }
});
```

### Step 4: TUI Components (pi-tui)

**Files:** `ui/agent-picker.ts`, `ui/compose.ts`, `ui/inline-message.ts`

Use `pi-tui` `Component` interface (same as `pi-intercom`, `pi-subagents`):

```typescript
import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export class AgentPickerOverlay implements Component {
  private selectedIndex = 0;
  private agents: AgentInfo[] = [];
  private query: string = "";

  render(width: number): string[] {
    const filtered = fuzzyFilter(this.agents, this.query);
    // render box with agents list
  }

  handleInput(data: string): void {
    // arrow keys, enter, escape
  }

  invalidate(): void { }
}
```

**Usage in tool:**
```typescript
async execute(id, params, signal, onUpdate, ctx) {
  const agent = await ctx.ui.custom((tui, theme, kb, done) => {
    const picker = new AgentPickerOverlay(agents, done);
    // render + handle input
  });
  if (!agent) return { content: [{ type: "text", text: "Cancelled" }] };
  // proceed with selected agent
}
```

### Step 5: SSE + Real-time Notifications

**File:** `broker/sse.ts`

```typescript
async function subscribeToEvents(
  socketPath: string,
  onEvent: (event: ScoutEvent) => void
): Promise<void> {
  const socket = await connect(socketPath);
  const req = buildHttpRequest("GET", "/v1/events/stream");
  socket.write(req);

  // Read SSE stream from socket
  for await (const chunk of socket) {
    const events = parseSseStream(chunk);
    for (const event of events) {
      onEvent(event);
    }
  }
}
```

**Handle events:**
- `message.posted` → render inline message in pi
- `flight.updated` → update status for pending asks
- `flight.completed` → surface result for `notify` reply mode

### Step 6: Session Registration

On `session_start`, register pi session with Scout:

```typescript
ctx.on("session_start", async (_event, ctx) => {
  const sessionFile = ctx.sessionManager.getSessionFile();
  const cwd = ctx.cwd;
  await brokerClient.upsertAgentCard({
    id: `pi-scout-${sessionFile ?? String(Date.now())}`,
    agentId: sessionFile ? `pi.${sessionFile}` : "pi",
    displayName: "pi",
    handle: sessionFile ? `pi.${sessionFile}` : "pi",
    harness: "pi",
    transport: "local_socket",
    projectRoot: cwd,
    currentDirectory: cwd,
    nodeId: "local",
    sessionId: sessionFile ?? String(Date.now()),
  });
});
```

This makes pi sessions routable by other Scout agents.

### Step 7: Slash Commands

**File:** `index.ts` (slash bridge)

```typescript
pi.registerCommand("scout", {
  description: "Scout coordination: send, ask, who, ps",
  handler: async (args, ctx) => {
    const [subcommand, ...rest] = args.split(" ");
    if (subcommand === "send") {
      // open agent picker + compose
    } else if (subcommand === "ask") {
      // open agent picker + compose
    } else if (subcommand === "who") {
      // show agent list
    }
  }
});
```

## Key Implementation Details

### Socket Path Resolution

Matches Scout broker's `broker-process-manager.ts` resolution:

```typescript
import { homedir, join } from "node:path";

function resolveSocketPath(): string {
  return process.env.OPENSCOUT_BROKER_SOCKET_PATH
    ?? join(
      homedir(),
      "Library", "Application Support", "OpenScout",
      "runtime", "broker.sock"
    );
}
```

### HTTP-over-Socket Request Format

The Unix socket server uses the same HTTP routing as the TCP server. Send raw HTTP over the socket:

```typescript
import { createConnection } from "node:net";

function buildSocketRequest(
  method: string,
  path: string,
  body?: unknown
): string {
  const bodyStr = body ? JSON.stringify(body) : "";
  return [
    `${method} ${path} HTTP/1.1`,
    "Host: localhost",
    `Content-Length: ${Buffer.byteLength(bodyStr)}`,
    "Content-Type: application/json",
    "",
    bodyStr,
  ].join("\r\n");
}

async function socketRequest<T>(
  socketPath: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      const response = parseHttpResponse(chunk);
      socket.end();
      resolve(JSON.parse(response.body) as T);
    });
    socket.write(buildSocketRequest(method, path, body));
  });
}
```

### Fallback to HTTP

If socket fails to connect, fall back to HTTP:

```typescript
async function brokerRequest(method, path, body) {
  try {
    return await socketRequest(socketPath, method, path, body);
  } catch {
    return await httpRequest(brokerUrl, method, path, body);
  }
}
```

### Broker Transport Config (matches Scout runtime)

| Env var | Purpose | Default |
|---|---|---|
| `OPENSCOUT_BROKER_SOCKET_PATH` | Unix socket path | `~/Library/Application Support/OpenScout/runtime/broker.sock` |
| `OPENSCOUT_BROKER_URL` | HTTP broker URL | `http://127.0.0.1:65535` |

## Testing Plan

1. **Unit:** Socket client, TUI components, tool parameter validation
2. **Integration:**
   - Send message from pi to Scout agent (e.g., Codex)
   - Receive reply in pi
   - List agents with `scout_who`
   - Ask with work item and verify flight tracking
3. **E2E:**
   - pi session receives Scout message from another agent
   - pi session is routable by other agents via Scout broker

## Install

```bash
pi install git:github.com:openscout/pi-scout
```

Or for local development:

```bash
ln -s ~/dev/openscout/extensions/pi-scout ~/.pi/agent/extensions/pi-scout
```

## Config File

`~/.pi/agent/extensions/pi-scout/config.json`:

```json
{
  "socketPath": null,
  "defaultReplyMode": "inline",
  "autoRegister": true,
  "fuzzySearch": true
}
```

- `socketPath: null` → use `OPENSCOUT_BROKER_SOCKET_PATH` env var or default path

## Open Questions

1. **Error handling:** How to surface broker connection failures gracefully?
2. **Timeout:** Default timeout for `inline` reply mode?
3. **Multi-agent send:** Should `scout_send` support multiple targets?

## References

- SCO-015: Pi-Scout Integration
- `pi-intercom` UI patterns (`~/.local/lib/node_modules/pi-intercom/ui/`)
- `pi-subagents` render helpers (`~/.local/lib/node_modules/pi-subagents/render-helpers.ts`)
- Scout `/v1/deliver` API (SCO-014)
- Scout broker daemon: `packages/runtime/src/broker-daemon.ts`
- Scout broker process manager: `packages/runtime/src/broker-process-manager.ts`