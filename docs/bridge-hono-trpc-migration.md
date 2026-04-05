# Bridge Server Migration: Hono + tRPC

## Status: Design — April 2026

## Problem

The Scout bridge server is a raw `Bun.serve()` WebSocket handler with a 600+ line switch statement dispatching 30+ RPC methods. It works for a single phone and a handful of agents, but has no:

- Request validation or typed contracts
- Backpressure or connection management
- Multi-device coordination (iPad + phone)
- Message acknowledgement or delivery guarantees
- Request batching
- Reconnection recovery for subscriptions
- Middleware composition (logging, auth, encryption are ad-hoc)

When this hits a heterogeneous user base — slow transports, concurrent devices, long-running requests interleaving — the current server will break in ways that are hard to diagnose.

## Target Architecture

```
                    ┌─────────────────────────────┐
                    │      Bun.serve()             │
                    │                              │
  HTTP requests ──▶ │  Hono                        │
                    │  ├── /health                  │
                    │  ├── /trpc/* (HTTP adapter)   │
                    │  └── static / webhooks        │
                    │                              │
  WS upgrade ────▶ │  tRPC WebSocket adapter       │
                    │  ├── queries (mobile.*)       │
                    │  ├── mutations (send, create) │
                    │  └── subscriptions (events)   │
                    │                              │
                    │  Noise Protocol               │
                    │  (experimental_encoder)       │
                    └─────────────────────────────┘
```

**One server, one port.** Hono handles HTTP, tRPC handles both HTTP RPC and WebSocket RPC + subscriptions. Noise encryption lives in the encoder layer, below tRPC message parsing.

## Why This Stack

### Hono (already installed)

- Already a dependency in `apps/scout/package.json` (^4.12.10)
- Already used for the web server at `src/server/index.ts`
- Native Bun support, zero overhead
- Middleware ecosystem (CORS, logging, rate limiting, compression)
- Clean route composition vs. the manual if/switch in broker-daemon.ts

### tRPC v11

- **Wire protocol is JSON-RPC 2.0** — literally what the bridge already speaks. The iOS client sends `{ id, method, params }` and receives `{ id, result }` or `{ id, error }`. tRPC formalizes this with types.
- **Subscriptions via async generators** — replaces the raw `bridge.onEvent()` → `ws.send()` pattern with typed, tracked subscriptions that survive reconnection.
- **`experimental_encoder`** — a first-class hook for custom wire encoding. Encode = Noise encrypt, Decode = Noise decrypt. No shimming needed.
- **Batching** — multiple RPCs in one round-trip, automatic.
- **Middleware** — logging, timing, auth compose as layers instead of being sprinkled through the switch.
- **`tracked()` events** — subscriptions emit events with IDs. On reconnect, the client sends `lastEventId` and the server resumes from there. This replaces the manual `OutboundBuffer` + `seq` system.

### trpc-bun

- Community adapter: Bun-native WebSocket support for tRPC
- `configureTrpcBunServer()` combines HTTP + WS in one `Bun.serve()` call
- No Node.js shims, uses `server.upgrade()` directly

## Current → Target Mapping

### RPC Methods → tRPC Procedures

```typescript
// Current: giant switch in server.ts
case "mobile/sessions": { ... }
case "mobile/session/snapshot": { ... }
case "mobile/message/send": { ... }

// Target: typed router
export const mobileRouter = t.router({
  sessions: t.procedure
    .input(z.object({ query: z.string().optional(), limit: z.number().optional() }))
    .query(({ input }) => getScoutMobileSessions(input)),

  sessionSnapshot: t.procedure
    .input(z.object({
      conversationId: z.string(),
      beforeTurnId: z.string().nullable().optional(),
      limit: z.number().nullable().optional(),
    }))
    .query(({ input }) => getScoutMobileSessionSnapshot(input.conversationId, input)),

  sendMessage: t.procedure
    .input(z.object({
      agentId: z.string(),
      body: z.string(),
      clientMessageId: z.string().nullable().optional(),
    }))
    .mutation(({ input, ctx }) => sendScoutMobileMessage(input, ctx.cwd, ctx.deviceId)),
})
```

### Event Stream → tRPC Subscriptions

```typescript
// Current: raw event forwarding
state.unsub = bridge.onEvent((sequenced) => {
  transport.send(JSON.stringify({ seq: sequenced.seq, event: sequenced.event }));
});

// Target: typed subscription with tracked events for reconnect recovery
events: t.procedure
  .input(z.object({ sessionId: z.string().optional() }))
  .subscription(async function* ({ input, signal }) {
    const buffer = bridge.getOutboundBuffer();

    for await (const event of bridge.eventStream({ signal })) {
      if (input.sessionId && event.event.sessionId !== input.sessionId) continue;

      yield tracked(String(event.seq), {
        seq: event.seq,
        event: event.event,
        timestamp: event.timestamp,
      });
    }
  }),
```

On reconnect, the client sends `lastEventId: "142"` and the server replays from seq 143. This replaces the manual `sync/replay` RPC.

### Noise Protocol → experimental_encoder

```typescript
// The Noise handshake happens during WebSocket upgrade (pre-tRPC).
// Once established, the NoiseSession encrypts/decrypts all tRPC messages.

const createNoiseEncoder = (noiseSession: NoiseSession): Encoder => ({
  encode(data: unknown): Uint8Array {
    const json = JSON.stringify(data);
    return noiseSession.encrypt(new TextEncoder().encode(json));
  },
  decode(data: string | ArrayBuffer | Uint8Array): unknown {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    const plaintext = noiseSession.decrypt(bytes);
    return JSON.parse(new TextDecoder().decode(plaintext));
  },
});
```

The Noise handshake could happen:
1. **During WebSocket upgrade** — as a pre-tRPC step (current approach, adapted)
2. **Via `connectionParams`** — tRPC supports a first-message params exchange on WS connect

Option 1 is simpler and keeps tRPC unaware of encryption.

## Router Structure

```typescript
import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.context<BridgeContext>().create();

// Middleware
const logged = t.middleware(async ({ path, type, next }) => {
  const start = Date.now();
  const result = await next();
  log.info("rpc:res", `${result.ok ? '✓' : '✗'} ${path} (${Date.now() - start}ms)`);
  return result;
});

const withDevice = t.middleware(async ({ ctx, next }) => {
  return next({ ctx: { ...ctx, deviceId: ctx.deviceId ?? 'unknown' } });
});

const procedure = t.procedure.use(logged).use(withDevice);

// Router
export const bridgeRouter = t.router({
  // -- Session Management --
  session: t.router({
    list: procedure.query(() => bridge.listSessions()),
    create: procedure
      .input(z.object({ adapterType: z.string(), name: z.string().optional() }))
      .mutation(({ input }) => bridge.createSession(input.adapterType, input)),
    close: procedure
      .input(z.object({ sessionId: z.string() }))
      .mutation(({ input }) => bridge.closeSession(input.sessionId)),
  }),

  // -- Mobile Surface --
  mobile: t.router({
    home: procedure
      .input(z.object({
        workspaceLimit: z.number().optional(),
        agentLimit: z.number().optional(),
        sessionLimit: z.number().optional(),
      }).optional())
      .query(({ input }) => getScoutMobileHome(input ?? {})),

    sessions: procedure
      .input(z.object({ query: z.string().optional(), limit: z.number().optional() }).optional())
      .query(({ input }) => getScoutMobileSessions(input)),

    agents: procedure
      .input(z.object({ query: z.string().optional(), limit: z.number().optional() }).optional())
      .query(({ input }) => getScoutMobileAgents(input)),

    workspaces: procedure
      .input(z.object({ query: z.string().optional(), limit: z.number().optional() }).optional())
      .query(({ input }) => getScoutMobileWorkspaces(input)),

    activity: procedure
      .input(z.object({
        agentId: z.string().optional(),
        limit: z.number().optional(),
      }).optional())
      .query(({ input }) => getScoutMobileActivity(input)),

    sessionSnapshot: procedure
      .input(z.object({
        conversationId: z.string(),
        beforeTurnId: z.string().nullable().optional(),
        limit: z.number().nullable().optional(),
      }))
      .query(({ input }) => getScoutMobileSessionSnapshot(input.conversationId, input)),

    createSession: procedure
      .input(z.object({
        workspaceId: z.string(),
        harness: z.string().optional(),
        agentName: z.string().optional(),
      }))
      .mutation(({ input, ctx }) => createScoutMobileSession(input, ctx.cwd, ctx.deviceId)),

    sendMessage: procedure
      .input(z.object({
        agentId: z.string(),
        body: z.string(),
        clientMessageId: z.string().nullable().optional(),
        replyToMessageId: z.string().nullable().optional(),
        harness: z.string().optional(),
      }))
      .mutation(({ input, ctx }) => sendScoutMobileMessage(input, ctx.cwd, ctx.deviceId)),
  }),

  // -- Workspace --
  workspace: t.router({
    info: procedure.query(() => getWorkspaceInfo()),
    list: procedure
      .input(z.object({ path: z.string().optional() }).optional())
      .query(({ input }) => getWorkspaceList(input?.path)),
    open: procedure
      .input(z.object({ path: z.string(), adapter: z.string().optional() }))
      .mutation(({ input }) => bridge.openWorkspace(input)),
  }),

  // -- History --
  history: t.router({
    discover: procedure
      .input(z.object({
        maxAge: z.number().optional(),
        limit: z.number().optional(),
        project: z.string().optional(),
      }).optional())
      .query(({ input }) => discoverSessionFiles(input?.maxAge ?? 14, input?.limit ?? 250)),

    search: procedure
      .input(z.object({ query: z.string(), maxAge: z.number().optional(), limit: z.number().optional() }))
      .query(({ input }) => searchSessionFiles(input)),
  }),

  // -- Subscriptions --
  events: procedure
    .input(z.object({ sessionId: z.string().optional() }).optional())
    .subscription(async function* ({ input, signal }) {
      for await (const event of bridge.eventStream({ signal })) {
        if (input?.sessionId && event.event.sessionId !== input.sessionId) continue;
        yield tracked(String(event.seq), event);
      }
    }),
});

export type BridgeRouter = typeof bridgeRouter;
```

## Server Setup

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { createTrpcBunWebSocketAdapter } from 'trpc-bun';
import { bridgeRouter } from './router';

const app = new Hono();

// HTTP middleware
app.use('*', cors());
app.get('/health', (c) => c.json({ ok: true }));

// tRPC HTTP adapter (queries/mutations over HTTP)
app.use('/trpc/*', trpcServer({
  router: bridgeRouter,
  createContext: (opts, c) => ({
    deviceId: c.req.header('x-device-id'),
    cwd: resolveMobileCurrentDirectory(),
  }),
}));

// Combined Bun server
const server = Bun.serve({
  port: config.port,
  fetch: (req, server) => {
    // WebSocket upgrade for tRPC subscriptions
    if (req.headers.get('upgrade') === 'websocket') {
      const success = server.upgrade(req, {
        data: { deviceId: null }, // populated during Noise handshake
      });
      return success ? undefined : new Response('Upgrade failed', { status: 500 });
    }
    return app.fetch(req, { server });
  },
  websocket: createTrpcBunWebSocketAdapter({
    router: bridgeRouter,
    createContext: ({ req }) => ({
      deviceId: req?.headers.get('x-device-id'),
      cwd: resolveMobileCurrentDirectory(),
    }),
  }),
});
```

## iOS Client Impact

The iOS `ConnectionManager` currently sends raw JSON-RPC messages. The migration path:

### Wire Format Change (Minimal)

Current:
```json
{"id": "abc", "method": "mobile/sessions", "params": {"limit": 100}}
```

tRPC:
```json
{"id": 1, "jsonrpc": "2.0", "method": "query", "params": {"path": "mobile.sessions", "input": {"limit": 100}}}
```

The shape is similar — `method` becomes `"query"/"mutation"`, the RPC method name moves to `params.path`, and `params` becomes `params.input`. The response shape is identical.

### Subscriptions Replace Event Stream

Current: events arrive as raw `{ seq, event }` JSON on the WebSocket.

tRPC: client subscribes to `events` procedure. Events arrive as `{ id, result: { type: "data", data: { seq, event }, id: "142" } }`. On reconnect, client sends `lastEventId: "142"` to resume.

### Migration Strategy for iOS

1. **Phase 1**: Update `sendRPC` in ConnectionManager to emit tRPC wire format. Map current method names to tRPC paths. This is a ~30 line change in the encoding/decoding layer.

2. **Phase 2**: Replace raw event stream parsing with tRPC subscription parsing. Add `lastEventId` tracking for reconnection recovery.

3. **Phase 3**: Remove the manual `sync/replay` RPC — tRPC tracked subscriptions handle this automatically.

## Migration Plan

### Phase 1: Install Dependencies & Scaffold Router (Today)

1. `bun add @trpc/server zod trpc-bun` in `apps/scout`
2. Create `src/core/pairing/runtime/bridge/router.ts` with the tRPC router
3. Extract procedure handlers from the switch statement — each case becomes a procedure
4. Keep the existing `server.ts` running in parallel

### Phase 2: Server Swap (Today)

1. Create `src/core/pairing/runtime/bridge/server-trpc.ts` with Hono + tRPC setup
2. Wire Noise encryption through `experimental_encoder`
3. Convert `bridge.onEvent()` to an async iterable for subscriptions
4. Switch `runtime.ts` to use the new server
5. Test with existing iOS client (needs wire format adapter or iOS update)

### Phase 3: iOS Client Update (Today/Tomorrow)

1. Update `ConnectionManager.sendRPC` to emit tRPC wire format
2. Update response parsing for tRPC envelope
3. Add subscription support with `lastEventId` tracking
4. Remove `sync/replay` and manual reconnection logic

### Phase 4: Broker Daemon (Future)

The broker HTTP server (`packages/runtime/src/broker-daemon.ts`) is also a candidate for Hono migration — same manual routing pattern, ~1600 lines. Lower priority since it's internal, but the pattern is identical.

## Dependencies

```json
{
  "@trpc/server": "^11.x",
  "zod": "^3.x",
  "trpc-bun": "latest",
  "@hono/trpc-server": "latest"
}
```

Hono is already installed. Total new dependencies: 4 packages.

## Risks

1. **`experimental_encoder`** — The name says "experimental." It could change in a minor tRPC release. Mitigation: pin tRPC version, the API surface is tiny (encode/decode).

2. **`trpc-bun` maturity** — Community package, not first-party. Mitigation: it's ~200 lines, we can vendor it if needed.

3. **iOS wire format change** — Both client and server need to move together. Mitigation: we can add a compatibility layer that accepts both old and new formats during transition.

4. **Subscription backpressure** — tRPC subscriptions via async generators don't have built-in backpressure. If the client is slow, yields will buffer in memory. Mitigation: same as current behavior, can add manual buffering later.
