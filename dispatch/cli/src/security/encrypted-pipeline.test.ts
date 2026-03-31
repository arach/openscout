// Encrypted pipeline integration tests.
//
// Same as the plaintext integration tests but with secure mode enabled.
// The bridge server starts with Noise encryption, and the client performs
// an XX handshake before sending RPCs. Verifies events arrive correctly
// through the encrypted channel.

import { describe, test, expect, afterEach } from "bun:test";
import { Bridge } from "../bridge/bridge.ts";
import { startBridgeServer } from "../bridge/server.ts";
import { createAdapter as createEcho } from "../adapters/echo.ts";
import {
  generateKeyPair,
  SecureTransport,
  type SocketLike,
  type KeyPair,
} from "./index.ts";
import type { DispatchEvent } from "../protocol/primitives.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WireMessage {
  id?: string;
  result?: unknown;
  error?: { code: number; message: string };
  seq?: number;
  event?: DispatchEvent;
}

// ---------------------------------------------------------------------------
// Secure client helper
// ---------------------------------------------------------------------------

/**
 * Connect a WebSocket and perform a Noise XX handshake as the initiator.
 * Returns helpers for sending encrypted RPCs and receiving events.
 *
 * The key trick: we register the WS `message` handler BEFORE opening, and
 * store a reference to the transport so that once the handshake completes
 * we can pipe messages through it.
 */
function connectSecureClient(
  port: number,
  clientKey: KeyPair,
): Promise<{
  messages: WireMessage[];
  rpc: (method: string, params?: unknown) => Promise<WireMessage>;
  waitForEvent: (predicate: (events: DispatchEvent[]) => boolean, timeoutMs?: number) => Promise<DispatchEvent[]>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const messages: WireMessage[] = [];
    let waiters: Array<() => void> = [];
    let transport: SecureTransport | null = null;

    const ws = new WebSocket(`ws://localhost:${port}`);

    function notifyWaiters(): void {
      const copy = waiters.slice();
      waiters = [];
      for (const fn of copy) fn();
    }

    // Register the message handler FIRST — before open fires — so we never
    // miss the handshake response from the server.
    ws.addEventListener("message", (ev) => {
      if (!transport) return; // Should not happen, but guard.
      const data = typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data as ArrayBuffer);
      transport.receive(data);
    });

    ws.addEventListener("open", () => {
      const socketAdapter: SocketLike = {
        send: (data) => ws.send(data),
      };

      transport = new SecureTransport(
        socketAdapter,
        "initiator",
        clientKey,
        {
          onReady: () => {
            // Handshake complete — resolve with helpers.
            resolve({
              messages,

              async rpc(method: string, params?: unknown): Promise<WireMessage> {
                const id = crypto.randomUUID();
                transport!.send(JSON.stringify({ id, method, params }));
                const deadline = Date.now() + 5000;
                while (true) {
                  const found = messages.find((m) => m.id === id);
                  if (found) return found;
                  const remaining = deadline - Date.now();
                  if (remaining <= 0) throw new Error(`RPC timeout for ${method}`);
                  await new Promise<void>((res) => {
                    const timer = setTimeout(() => {
                      waiters = waiters.filter((w) => w !== res);
                      res();
                    }, Math.min(remaining, 50));
                    waiters.push(() => { clearTimeout(timer); res(); });
                  });
                }
              },

              async waitForEvent(
                predicate: (events: DispatchEvent[]) => boolean,
                timeoutMs = 5000,
              ): Promise<DispatchEvent[]> {
                const deadline = Date.now() + timeoutMs;
                while (true) {
                  const events = messages.filter((m) => m.event).map((m) => m.event!);
                  if (predicate(events)) return events;
                  const remaining = deadline - Date.now();
                  if (remaining <= 0) {
                    throw new Error(
                      `Timed out waiting for event predicate (${messages.length} msgs)`,
                    );
                  }
                  await new Promise<void>((res) => {
                    const timer = setTimeout(() => {
                      waiters = waiters.filter((w) => w !== res);
                      res();
                    }, Math.min(remaining, 50));
                    waiters.push(() => { clearTimeout(timer); res(); });
                  });
                }
              },

              close() {
                ws.close();
              },
            });
          },

          onMessage: (message) => {
            const msg: WireMessage = JSON.parse(message);
            messages.push(msg);
            notifyWaiters();
          },

          onError: (err) => {
            reject(err);
          },
        },
        { pattern: "XX" },
      );
    });

    ws.addEventListener("error", () => {
      reject(new Error("WebSocket connection failed"));
    });
  });
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let bridge: Bridge | null = null;
let server: { stop: () => void } | null = null;
let client: Awaited<ReturnType<typeof connectSecureClient>> | null = null;

afterEach(async () => {
  client?.close();
  client = null;
  if (bridge) {
    await bridge.shutdown();
    bridge = null;
  }
  server?.stop();
  server = null;
});

function randomPort(): number {
  return 18800 + Math.floor(Math.random() * 1000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Encrypted pipeline (Noise XX)", () => {
  test("handshake completes and session/create works through encrypted channel", async () => {
    const port = randomPort();
    const bridgeKey = generateKeyPair();
    const clientKey = generateKeyPair();

    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port, { secure: true, identity: bridgeKey });

    client = await connectSecureClient(port, clientKey);

    const res = await client.rpc("session/create", { adapterType: "echo", name: "encrypted-test" });
    expect(res.error).toBeUndefined();
    const session = res.result as { id: string; status: string; adapterType: string };
    expect(session.id).toBeDefined();
    expect(session.adapterType).toBe("echo");
    expect(session.status).toBe("active");
  });

  test("full turn lifecycle arrives through encrypted channel", async () => {
    const port = randomPort();
    const bridgeKey = generateKeyPair();
    const clientKey = generateKeyPair();

    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port, { secure: true, identity: bridgeKey });

    client = await connectSecureClient(port, clientKey);

    // Create session.
    const createRes = await client.rpc("session/create", {
      adapterType: "echo",
      name: "encrypted-turn",
      options: { stepDelay: 0 },
    });
    const session = createRes.result as { id: string };

    // Send prompt.
    await client.rpc("prompt/send", { sessionId: session.id, text: "crypto hello" });

    // Wait for turn:end.
    const events = await client.waitForEvent(
      (evts) => evts.some((e) => e.event === "turn:end"),
    );

    // Verify turn lifecycle.
    expect(events.some((e) => e.event === "turn:start")).toBe(true);
    expect(events.some((e) => e.event === "turn:end")).toBe(true);

    // Verify reasoning block.
    const reasoningStart = events.find(
      (e) => e.event === "block:start" && (e as any).block.type === "reasoning",
    );
    expect(reasoningStart).toBeDefined();
    const reasoningDelta = events.find(
      (e) =>
        e.event === "block:delta" &&
        (e as any).blockId === (reasoningStart as any).block.id,
    );
    expect(reasoningDelta).toBeDefined();
    expect((reasoningDelta as any).text).toBe("Thinking about: crypto hello");

    // Verify text block.
    const textStart = events.find(
      (e) => e.event === "block:start" && (e as any).block.type === "text",
    );
    expect(textStart).toBeDefined();
    const textDelta = events.find(
      (e) =>
        e.event === "block:delta" && (e as any).blockId === (textStart as any).block.id,
    );
    expect(textDelta).toBeDefined();
    expect((textDelta as any).text).toBe("Echo: crypto hello");

    // Verify action block.
    const actionStart = events.find(
      (e) => e.event === "block:start" && (e as any).block.type === "action",
    );
    expect(actionStart).toBeDefined();
    expect((actionStart as any).block.action.kind).toBe("tool_call");
    expect((actionStart as any).block.action.toolName).toBe("echo");

    // Turn end status.
    const turnEnd = events.find((e) => e.event === "turn:end");
    expect((turnEnd as any).status).toBe("completed");
  });

  test("session/snapshot works through encrypted channel", async () => {
    const port = randomPort();
    const bridgeKey = generateKeyPair();
    const clientKey = generateKeyPair();

    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port, { secure: true, identity: bridgeKey });

    client = await connectSecureClient(port, clientKey);

    const createRes = await client.rpc("session/create", {
      adapterType: "echo",
      name: "snap-encrypted",
      options: { stepDelay: 0 },
    });
    const session = createRes.result as { id: string };

    await client.rpc("prompt/send", { sessionId: session.id, text: "encrypted snapshot" });
    await client.waitForEvent((evts) => evts.some((e) => e.event === "turn:end"));

    const snapRes = await client.rpc("session/snapshot", { sessionId: session.id });
    expect(snapRes.error).toBeUndefined();

    const snapshot = snapRes.result as {
      session: { id: string };
      turns: Array<{
        status: string;
        blocks: Array<{ block: { type: string } }>;
      }>;
    };

    expect(snapshot.session.id).toBe(session.id);
    expect(snapshot.turns.length).toBe(1);
    expect(snapshot.turns[0]!.status).toBe("completed");

    const reasoning = snapshot.turns[0]!.blocks.find((b) => b.block.type === "reasoning");
    expect((reasoning!.block as any).text).toBe("Thinking about: encrypted snapshot");

    const text = snapshot.turns[0]!.blocks.find((b) => b.block.type === "text");
    expect((text!.block as any).text).toBe("Echo: encrypted snapshot");
  });

  test("turn/interrupt works through encrypted channel", async () => {
    const port = randomPort();
    const bridgeKey = generateKeyPair();
    const clientKey = generateKeyPair();

    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port, { secure: true, identity: bridgeKey });

    client = await connectSecureClient(port, clientKey);

    const createRes = await client.rpc("session/create", {
      adapterType: "echo",
      name: "interrupt-encrypted",
      options: { stepDelay: 100 },
    });
    const session = createRes.result as { id: string };

    await client.rpc("prompt/send", { sessionId: session.id, text: "slow" });

    // Wait for turn:start before interrupting.
    await client.waitForEvent((evts) => evts.some((e) => e.event === "turn:start"));

    await client.rpc("turn/interrupt", { sessionId: session.id });

    const events = await client.waitForEvent(
      (evts) => evts.some((e) => e.event === "turn:end"),
      5000,
    );

    const turnEnd = events.find((e) => e.event === "turn:end");
    expect(turnEnd).toBeDefined();
    expect((turnEnd as any).status).toBe("stopped");
  });

  test("events carry monotonic sequence numbers through encrypted channel", async () => {
    const port = randomPort();
    const bridgeKey = generateKeyPair();
    const clientKey = generateKeyPair();

    bridge = new Bridge({ adapters: { echo: createEcho } });
    server = startBridgeServer(bridge, port, { secure: true, identity: bridgeKey });

    client = await connectSecureClient(port, clientKey);

    const createRes = await client.rpc("session/create", {
      adapterType: "echo",
      name: "seq-encrypted",
      options: { stepDelay: 0 },
    });
    const session = createRes.result as { id: string };

    await client.rpc("prompt/send", { sessionId: session.id, text: "seqtest" });

    await client.waitForEvent((evts) => evts.some((e) => e.event === "turn:end"));

    // Check sequence numbers are monotonically increasing.
    const seqMessages = client.messages.filter((m) => m.seq !== undefined && m.seq! > 0);
    expect(seqMessages.length).toBeGreaterThan(0);

    for (let i = 1; i < seqMessages.length; i++) {
      expect(seqMessages[i]!.seq!).toBeGreaterThan(seqMessages[i - 1]!.seq!);
    }
  });

  test("server rejects secure mode without identity", () => {
    const port = randomPort();
    const b = new Bridge({ adapters: { echo: createEcho } });
    bridge = b;

    expect(() => {
      startBridgeServer(b, port, { secure: true });
    }).toThrow("identity");
  });
});
