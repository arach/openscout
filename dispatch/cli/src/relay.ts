import type { ServerWebSocket } from "bun";

interface Room {
  bridge: ServerWebSocket<SocketData> | null;
  clients: Set<ServerWebSocket<SocketData>>;
  bridgePublicKey?: string;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

interface SocketData {
  roomId: string;
  role: "bridge" | "client";
}

const BRIDGE_ABSENCE_GRACE_MS = 30_000;
const ROOM_IDLE_TIMEOUT_MS = 60_000;

export interface RelayOptions {
  tls?: {
    cert: string;
    key: string;
  };
}

export function startRelay(port: number, options: RelayOptions = {}): { stop: () => void } {
  const rooms = new Map<string, Room>();
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

      if (url.pathname === "/resolve" && req.method === "POST") {
        return handleResolve(req, roomByBridgeKey, rooms);
      }

      const roomId = url.searchParams.get("room");
      const role = url.searchParams.get("role") as "bridge" | "client" | null;
      const bridgeKey = url.searchParams.get("key");

      if (!roomId || !role || !["bridge", "client"].includes(role)) {
        return new Response("Missing ?room=ID&role=bridge|client", { status: 400 });
      }

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

        if (room.cleanupTimer) {
          clearTimeout(room.cleanupTimer);
          room.cleanupTimer = undefined;
        }

        if (role === "bridge") {
          if (room.bridge) {
            room.bridge.close(4001, "Replaced by new bridge");
          }
          room.bridge = ws;
        } else {
          room.clients.add(ws);
        }
      },

      message(ws, data) {
        const { roomId, role } = ws.data;
        const room = rooms.get(roomId);
        if (!room) {
          return;
        }

        if (role === "bridge") {
          for (const client of room.clients) {
            client.send(data);
          }
        } else {
          room.bridge?.send(data);
        }
      },

      close(ws) {
        const { roomId, role } = ws.data;
        const room = rooms.get(roomId);
        if (!room) {
          return;
        }

        if (role === "bridge") {
          if (room.bridge === ws) {
            room.bridge = null;
            room.cleanupTimer = setTimeout(() => {
              for (const client of room.clients) {
                client.close(4004, "Bridge absent");
              }
              for (const [key, rid] of roomByBridgeKey) {
                if (rid === roomId) {
                  roomByBridgeKey.delete(key);
                }
              }
              rooms.delete(roomId);
            }, BRIDGE_ABSENCE_GRACE_MS);
          }
        } else {
          room.clients.delete(ws);
          if (!room.bridge && room.clients.size === 0) {
            room.cleanupTimer = setTimeout(() => {
              for (const [key, rid] of roomByBridgeKey) {
                if (rid === roomId) {
                  roomByBridgeKey.delete(key);
                }
              }
              rooms.delete(roomId);
            }, ROOM_IDLE_TIMEOUT_MS);
          }
        }
      },
    },
  });

  return {
    stop() {
      for (const [, room] of rooms) {
        if (room.cleanupTimer) {
          clearTimeout(room.cleanupTimer);
        }
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

    const room = rooms.get(roomId);
    if (!room?.bridge) {
      return Response.json({ error: "bridge not connected" }, { status: 404 });
    }

    return Response.json({ room: roomId });
  } catch {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
}
