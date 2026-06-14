export const OPENSCOUT_MOBILE_PAIRING_RELAY_PATH = "/v1/relay";
export const OPENSCOUT_MOBILE_PAIRING_RELAY_RESOLVE_PATH = `${OPENSCOUT_MOBILE_PAIRING_RELAY_PATH}/resolve`;
export const OPENSCOUT_MOBILE_PAIRING_RELAY_HEALTH_PATH = `${OPENSCOUT_MOBILE_PAIRING_RELAY_PATH}/healthz`;

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectId {}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

export interface MobilePairingRelayEnv {
  MOBILE_PAIRING_RELAY: DurableObjectNamespace;
  OPENSCOUT_MESH_DIRECTORY_OWNER?: string;
  OPENSCOUT_MOBILE_RELAY_OWNER?: string;
}

export interface MobileRelaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface Room {
  bridge: MobileRelaySocket | null;
  clients: Map<string, MobileRelaySocket>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

interface SocketData {
  roomId: string;
  role: "bridge" | "client";
  clientId?: string;
}

interface RelayEnvelope {
  phase: "relay";
  event: "message" | "close";
  clientId: string;
  payload?: string;
  code?: number;
  reason?: string;
}

interface WorkerWebSocket extends MobileRelaySocket {
  accept(): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "close", listener: (event: CloseEvent) => void): void;
  addEventListener(type: "error", listener: (event: Event) => void): void;
}

type WebSocketPairRecord = {
  0: WebSocket;
  1: WorkerWebSocket;
};

declare const WebSocketPair: {
  new(): WebSocketPairRecord;
};

const BRIDGE_ABSENCE_GRACE_MS = 30_000;
const ROOM_IDLE_TIMEOUT_MS = 60_000;

export function isMobilePairingRelayPath(pathname: string): boolean {
  return pathname === OPENSCOUT_MOBILE_PAIRING_RELAY_PATH
    || pathname.startsWith(`${OPENSCOUT_MOBILE_PAIRING_RELAY_PATH}/`);
}

export async function handleMobilePairingRelayFrontDoorRequest(
  request: Request,
  env: MobilePairingRelayEnv,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!isMobilePairingRelayPath(url.pathname)) {
    return undefined;
  }

  const ownerName = resolveMobilePairingRelayOwnerName(env);
  const objectId = env.MOBILE_PAIRING_RELAY.idFromName(ownerName);
  const object = env.MOBILE_PAIRING_RELAY.get(objectId);
  return object.fetch(request);
}

export function resolveMobilePairingRelayOwnerName(env: Pick<MobilePairingRelayEnv, "OPENSCOUT_MESH_DIRECTORY_OWNER" | "OPENSCOUT_MOBILE_RELAY_OWNER">): string {
  return env.OPENSCOUT_MOBILE_RELAY_OWNER?.trim()
    || env.OPENSCOUT_MESH_DIRECTORY_OWNER?.trim()
    || "default";
}

export class MobilePairingRelayHub {
  private readonly rooms = new Map<string, Room>();
  private readonly roomByBridgeKey = new Map<string, string>();
  private readonly socketData = new WeakMap<MobileRelaySocket, SocketData>();

  registerBridge(socket: MobileRelaySocket, roomId: string, bridgePublicKey?: string | null): void {
    const room = this.getOrCreateRoom(roomId);
    this.clearCleanupTimer(room);

    if (bridgePublicKey?.trim()) {
      this.roomByBridgeKey.set(bridgePublicKey.trim(), roomId);
    }

    if (room.bridge && room.bridge !== socket) {
      room.bridge.close(4001, "Replaced by new bridge");
    }
    room.bridge = socket;
    this.socketData.set(socket, { roomId, role: "bridge" });
  }

  registerClient(socket: MobileRelaySocket, roomId: string, clientId: string = crypto.randomUUID()): string {
    const room = this.getOrCreateRoom(roomId);
    this.clearCleanupTimer(room);

    room.clients.set(clientId, socket);
    this.socketData.set(socket, { roomId, role: "client", clientId });
    return clientId;
  }

  receive(socket: MobileRelaySocket, data: unknown): void {
    const socketData = this.socketData.get(socket);
    if (!socketData) return;

    const room = this.rooms.get(socketData.roomId);
    if (!room) return;

    if (socketData.role === "bridge") {
      const envelope = parseRelayEnvelope(data);
      if (!envelope) return;

      if (envelope.event === "close") {
        room.clients.get(envelope.clientId)?.close(
          envelope.code ?? 1000,
          envelope.reason ?? "Bridge requested close",
        );
        return;
      }

      if (!envelope.payload) return;
      room.clients.get(envelope.clientId)?.send(envelope.payload);
      return;
    }

    const clientId = socketData.clientId;
    if (!clientId || room.clients.get(clientId) !== socket) {
      return;
    }

    const payload = relayPayload(data);
    if (!payload) return;

    room.bridge?.send(JSON.stringify({
      phase: "relay",
      event: "message",
      clientId,
      payload,
    } satisfies RelayEnvelope));
  }

  disconnect(socket: MobileRelaySocket): void {
    const socketData = this.socketData.get(socket);
    if (!socketData) return;

    this.socketData.delete(socket);
    const room = this.rooms.get(socketData.roomId);
    if (!room) return;

    if (socketData.role === "bridge") {
      if (room.bridge !== socket) return;
      room.bridge = null;

      room.cleanupTimer = setTimeout(() => {
        for (const client of room.clients.values()) {
          client.close(4004, "Bridge absent");
        }
        this.deleteBridgeKeyMappingsForRoom(socketData.roomId);
        this.rooms.delete(socketData.roomId);
      }, BRIDGE_ABSENCE_GRACE_MS);
      return;
    }

    const clientId = socketData.clientId;
    if (clientId && room.clients.get(clientId) === socket) {
      room.clients.delete(clientId);
      room.bridge?.send(JSON.stringify({
        phase: "relay",
        event: "close",
        clientId,
      } satisfies RelayEnvelope));
    }

    if (!room.bridge && room.clients.size === 0) {
      room.cleanupTimer = setTimeout(() => {
        this.deleteBridgeKeyMappingsForRoom(socketData.roomId);
        this.rooms.delete(socketData.roomId);
      }, ROOM_IDLE_TIMEOUT_MS);
    }
  }

  resolveRoom(bridgePublicKey: string): string | null {
    const roomId = this.roomByBridgeKey.get(bridgePublicKey);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    return room?.bridge ? roomId : null;
  }

  health(bridgePublicKey?: string | null): {
    ok: true;
    ts: number;
    bridgePublicKey: string | null;
    bridgeConnected: boolean;
    roomId: string | null;
  } {
    const key = bridgePublicKey?.trim() || null;
    const roomId = key ? this.roomByBridgeKey.get(key) ?? null : null;
    const room = roomId ? this.rooms.get(roomId) ?? null : null;
    const bridgeConnected = Boolean(room?.bridge);
    return {
      ok: true,
      ts: Date.now(),
      bridgePublicKey: key,
      bridgeConnected,
      roomId: bridgeConnected ? roomId : null,
    };
  }

  closeAll(): void {
    for (const [roomId, room] of this.rooms) {
      this.clearCleanupTimer(room);
      room.bridge?.close(1001, "Relay shutting down");
      for (const client of room.clients.values()) {
        client.close(1001, "Relay shutting down");
      }
      this.deleteBridgeKeyMappingsForRoom(roomId);
    }
    this.rooms.clear();
  }

  private getOrCreateRoom(roomId: string): Room {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { bridge: null, clients: new Map() };
      this.rooms.set(roomId, room);
    }
    return room;
  }

  private clearCleanupTimer(room: Room): void {
    if (!room.cleanupTimer) return;
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = undefined;
  }

  private deleteBridgeKeyMappingsForRoom(roomId: string): void {
    for (const [key, mappedRoomId] of this.roomByBridgeKey) {
      if (mappedRoomId === roomId) {
        this.roomByBridgeKey.delete(key);
      }
    }
  }
}

export class MobilePairingRelayDurableObject {
  private readonly hub = new MobilePairingRelayHub();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (url.pathname === OPENSCOUT_MOBILE_PAIRING_RELAY_RESOLVE_PATH && method === "POST") {
      return handleResolve(request, this.hub);
    }

    if (url.pathname === OPENSCOUT_MOBILE_PAIRING_RELAY_HEALTH_PATH && method === "GET") {
      return Response.json(this.hub.health(url.searchParams.get("bridgePublicKey")));
    }

    if (url.pathname !== OPENSCOUT_MOBILE_PAIRING_RELAY_PATH) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    if (method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const roomId = url.searchParams.get("room")?.trim();
    const role = url.searchParams.get("role")?.trim();
    const bridgePublicKey = url.searchParams.get("key")?.trim() || null;

    if (!roomId || (role !== "bridge" && role !== "client")) {
      return new Response("Missing ?room=ID&role=bridge|client", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    if (role === "bridge") {
      this.hub.registerBridge(server, roomId, bridgePublicKey);
    } else {
      this.hub.registerClient(server, roomId);
    }

    server.addEventListener("message", (event) => {
      this.hub.receive(server, event.data);
    });
    server.addEventListener("close", () => {
      this.hub.disconnect(server);
    });
    server.addEventListener("error", () => {
      this.hub.disconnect(server);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit & { webSocket: WebSocket });
  }
}

async function handleResolve(request: Request, hub: MobilePairingRelayHub): Promise<Response> {
  try {
    const body = await request.json() as { bridgePublicKey?: unknown };
    const bridgePublicKey = typeof body.bridgePublicKey === "string" ? body.bridgePublicKey.trim() : "";
    if (!bridgePublicKey) {
      return Response.json({ error: "missing bridgePublicKey" }, { status: 400 });
    }

    const room = hub.resolveRoom(bridgePublicKey);
    if (!room) {
      return Response.json({ error: "bridge not found" }, { status: 404 });
    }

    return Response.json({ room });
  } catch {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
}

function relayPayload(data: unknown): string | null {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  return null;
}

function parseRelayEnvelope(data: unknown): RelayEnvelope | null {
  if (typeof data !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(data) as Partial<RelayEnvelope>;
    if (parsed.phase !== "relay" || typeof parsed.clientId !== "string") {
      return null;
    }
    if (parsed.event !== "message" && parsed.event !== "close") {
      return null;
    }
    return {
      phase: "relay",
      event: parsed.event,
      clientId: parsed.clientId,
      payload: typeof parsed.payload === "string" ? parsed.payload : undefined,
      code: typeof parsed.code === "number" ? parsed.code : undefined,
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    };
  } catch {
    return null;
  }
}
