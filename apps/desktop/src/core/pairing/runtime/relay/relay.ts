// Pairing relay — lightweight WebSocket forwarder.
//
// The relay knows nothing about Pairing primitives, adapters, or sessions.
// It maintains "rooms" identified by a room ID.  Each room has one bridge
// and any number of phone clients.  Messages from the bridge are broadcast
// to all clients; messages from clients are forwarded to the bridge.
//
// All payloads are opaque — the relay forwards them verbatim.  When E2E
// encryption is added, the relay sees only ciphertext.

import type { ServerWebSocket } from "bun";

interface Room {
  bridge: ServerWebSocket<SocketData> | null;
  clients: Set<ServerWebSocket<SocketData>>;
  /** Bridge's public key (hex) — set when the bridge registers. */
  bridgePublicKey?: string;
  /** Grace timer — keeps the room alive briefly after the bridge disconnects. */
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

interface SocketData {
  roomId: string;
  role: "bridge" | "client";
}

const BRIDGE_ABSENCE_GRACE_MS = 30_000;
const ROOM_IDLE_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export interface RelayOptions {
  tls?: {
    cert: string;  // path to .crt file
    key: string;   // path to .key file
  };
}

export function startRelay(port: number, options: RelayOptions = {}): { stop: () => void } {
  const rooms = new Map<string, Room>();
  // Index: bridge public key → room ID (for resolve lookups).
  const roomByBridgeKey = new Map<string, string>();

  const server = Bun.serve<SocketData>({
    port,
    ...(options.tls
      ? {
          tls: {
            cert: Bun.file(options.tls.cert),
            key: Bun.file(options.tls.key),
          },
        }
      : {}),
    fetch(req, server) {
      const url = new URL(req.url);

      // -- HTTP resolve endpoint ----------------------------------------------
      // POST /resolve  { "bridgePublicKey": "hex..." }
      // Returns { "room": "uuid" } if the bridge is currently connected.
      // This lets the phone find the bridge's current room after a bridge restart.
      if (url.pathname === "/resolve" && req.method === "POST") {
        return handleResolve(req, roomByBridgeKey, rooms);
      }

      // -- HTTP health endpoint -----------------------------------------------
      // GET /healthz?bridgePublicKey=hex...
      // Returns relay reachability plus best-effort bridge presence for the key.
      if (url.pathname === "/healthz" && req.method === "GET") {
        return handleHealthz(url, roomByBridgeKey, rooms);
      }

      // -- WebSocket upgrade --------------------------------------------------
      const roomId = url.searchParams.get("room");
      const role = url.searchParams.get("role") as "bridge" | "client" | null;
      const bridgeKey = url.searchParams.get("key"); // bridge sends its public key

      if (!roomId || !role || !["bridge", "client"].includes(role)) {
        return new Response("Missing ?room=ID&role=bridge|client", { status: 400 });
      }

      // Register bridge public key → room mapping before upgrade.
      if (role === "bridge" && bridgeKey) {
        roomByBridgeKey.set(bridgeKey, roomId);
      }

      const upgraded = server.upgrade(req, { data: { roomId, role } });
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 500 });
      }
    },

    websocket: {
      open(ws) {
        const { roomId, role } = ws.data;
        let room = rooms.get(roomId);

        if (!room) {
          room = { bridge: null, clients: new Set() };
          rooms.set(roomId, room);
        }

        // Clear any pending cleanup — someone joined.
        if (room.cleanupTimer) {
          clearTimeout(room.cleanupTimer);
          room.cleanupTimer = undefined;
        }

        if (role === "bridge") {
          if (room.bridge) {
            // Replace stale bridge connection.
            room.bridge.close(4001, "Replaced by new bridge");
          }
          room.bridge = ws;
          // Store the bridge key on the room for later cleanup.
          const url = new URL(`ws://x?${ws.data.roomId}`); // roomId is just for context
          // The key was already registered in fetch() via roomByBridgeKey.
          console.log(`[relay] bridge joined room ${roomId}`);
        } else {
          room.clients.add(ws);
          console.log(`[relay] client joined room ${roomId} (${room.clients.size} clients)`);
        }
      },

      message(ws, data) {
        const { roomId, role } = ws.data;
        const room = rooms.get(roomId);
        if (!room) return;

        if (role === "bridge") {
          // Bridge → all clients.
          for (const client of room.clients) {
            client.send(data);
          }
        } else {
          // Client → bridge.
          room.bridge?.send(data);
        }
      },

      close(ws) {
        const { roomId, role } = ws.data;
        const room = rooms.get(roomId);
        if (!room) return;

        if (role === "bridge") {
          if (room.bridge === ws) {
            room.bridge = null;
            console.log(`[relay] bridge left room ${roomId}`);

            // Grace period — keep room alive for reconnect.
            room.cleanupTimer = setTimeout(() => {
              // Notify clients that the bridge is gone.
              for (const client of room.clients) {
                client.close(4004, "Bridge absent");
              }
              // Clean up bridge key index.
              for (const [key, rid] of roomByBridgeKey) {
                if (rid === roomId) roomByBridgeKey.delete(key);
              }
              rooms.delete(roomId);
              console.log(`[relay] room ${roomId} cleaned up (bridge absent)`);
            }, BRIDGE_ABSENCE_GRACE_MS);
          }
        } else {
          room.clients.delete(ws);
          console.log(`[relay] client left room ${roomId} (${room.clients.size} clients)`);

          // If room is empty (no bridge, no clients), schedule cleanup.
          if (!room.bridge && room.clients.size === 0) {
            room.cleanupTimer = setTimeout(() => {
              for (const [key, rid] of roomByBridgeKey) {
                if (rid === roomId) roomByBridgeKey.delete(key);
              }
              rooms.delete(roomId);
              console.log(`[relay] room ${roomId} cleaned up (idle)`);
            }, ROOM_IDLE_TIMEOUT_MS);
          }
        }
      },
    },
  });

  const scheme = options.tls ? "wss" : "ws";
  console.log(`[relay] listening on ${scheme}://localhost:${port}`);
  console.log(`[relay] resolve endpoint: ${scheme}://localhost:${port}/resolve`);

  return {
    stop() {
      // Clean up all rooms.
      for (const [, room] of rooms) {
        if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
        room.bridge?.close(1001, "Relay shutting down");
        for (const client of room.clients) {
          client.close(1001, "Relay shutting down");
        }
      }
      rooms.clear();
      roomByBridgeKey.clear();
      server.stop();
    },
  };
}

// ---------------------------------------------------------------------------
// Resolve handler — phone looks up bridge's current room by public key
// ---------------------------------------------------------------------------

async function handleResolve(
  req: Request,
  roomByBridgeKey: Map<string, string>,
  rooms: Map<string, Room>,
): Promise<Response> {
  try {
    const body = await req.json() as { bridgePublicKey?: string };
    const key = body.bridgePublicKey;

    if (!key || typeof key !== "string") {
      return Response.json({ error: "missing bridgePublicKey" }, { status: 400 });
    }

    const roomId = roomByBridgeKey.get(key);
    if (!roomId) {
      return Response.json({ error: "bridge not found" }, { status: 404 });
    }

    // Verify the bridge is actually connected in that room.
    const room = rooms.get(roomId);
    if (!room?.bridge) {
      return Response.json({ error: "bridge not connected" }, { status: 404 });
    }

    console.log(`[relay] resolved bridge ${key.slice(0, 12)}... → room ${roomId}`);
    return Response.json({ room: roomId });
  } catch {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
}

function handleHealthz(
  url: URL,
  roomByBridgeKey: Map<string, string>,
  rooms: Map<string, Room>,
): Response {
  const bridgePublicKey = url.searchParams.get("bridgePublicKey")?.trim() || null;
  const roomId = bridgePublicKey ? roomByBridgeKey.get(bridgePublicKey) ?? null : null;
  const room = roomId ? rooms.get(roomId) ?? null : null;
  const bridgeConnected = Boolean(room?.bridge);

  return Response.json({
    ok: true,
    ts: Date.now(),
    bridgePublicKey,
    bridgeConnected,
    roomId: bridgeConnected ? roomId : null,
  });
}
