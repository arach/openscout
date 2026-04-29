import { createConnection, type Socket } from "node:net";
import type {
  FlightRecord,
  RuntimeRegistrySnapshot,
  ScoutDeliverResponse,
} from "@openscout/protocol";
import type { BrokerSnapshot, DeliverParams, ScoutEvent } from "../types.ts";
import { resolveSocketPath, resolveBrokerHttpUrl } from "../config.ts";

// ─── HTTP-over-socket ─────────────────────────────────────────────────────────

function buildRequest(
  method: string,
  path: string,
  body?: unknown,
): string {
  const bodyStr = body ? JSON.stringify(body) : "";
  return [
    `${method} ${path} HTTP/1.1`,
    "Host: localhost",
    `Content-Length: ${Buffer.byteLength(bodyStr)}`,
    bodyStr ? "Content-Type: application/json" : "",
    "",
    bodyStr,
  ]
    .filter((line) => line.length > 0)
    .join("\r\n");
}

function parseResponse(buffer: Buffer): { status: number; body: string } {
  const str = buffer.toString("utf8");
  const headerEnd = str.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    throw new Error("Invalid HTTP response: no header/body separator");
  }
  const body = str.slice(headerEnd + 4);
  const statusLine = str.slice(0, headerEnd).split("\r\n")[0];
  const status = parseInt(statusLine.split(" ")[1], 10);
  if (isNaN(status)) throw new Error("Invalid HTTP status line");
  return { status, body };
}

async function socketRequest<T>(
  socketPath: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let data = Buffer.alloc(0);

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Socket request timeout: ${method} ${path}`));
    }, 10_000);

    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk]);
    });

    socket.on("end", () => {
      clearTimeout(timeout);
      try {
        const { status, body: bodyStr } = parseResponse(data);
        if (status >= 400) {
          reject(new Error(`HTTP ${status}: ${bodyStr.slice(0, 200)}`));
          return;
        }
        resolve(JSON.parse(bodyStr) as T);
      } catch (err) {
        reject(err);
      }
    });

    socket.write(buildRequest(method, path, body));
    socket.end();
  });
}

async function httpFallback<T>(
  url: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const base = url.replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ─── Broker client ────────────────────────────────────────────────────────────

let _snapshotCache: BrokerSnapshot | null = null;
let _snapshotCacheAt = 0;

export const brokerClient = {
  async getSnapshot(force = false): Promise<BrokerSnapshot> {
    const now = Date.now();
    if (!force && _snapshotCache && now - _snapshotCacheAt < 5_000) {
      return _snapshotCache;
    }

    let snapshot: BrokerSnapshot;
    try {
      const raw = await socketRequest<RuntimeRegistrySnapshot>(
        resolveSocketPath(),
        "GET",
        "/v1/snapshot",
      );
      snapshot = { agents: raw.agents, endpoints: raw.endpoints };
    } catch {
      const raw = await httpFallback<RuntimeRegistrySnapshot>(
        resolveBrokerHttpUrl(),
        "GET",
        "/v1/snapshot",
      );
      snapshot = { agents: raw.agents, endpoints: raw.endpoints };
    }

    _snapshotCache = snapshot;
    _snapshotCacheAt = now;
    return snapshot;
  },

  async deliver(params: DeliverParams): Promise<ScoutDeliverResponse> {
    const payload = {
      intent: params.intent,
      body: params.body,
      target: params.target,
      channel: params.channel,
      workItem: params.workItem,
    };

    try {
      return await socketRequest<ScoutDeliverResponse>(
        resolveSocketPath(),
        "POST",
        "/v1/deliver",
        payload,
      );
    } catch {
      return await httpFallback<ScoutDeliverResponse>(
        resolveBrokerHttpUrl(),
        "POST",
        "/v1/deliver",
        payload,
      );
    }
  },

  async waitForFlight(
    flightId: string,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<FlightRecord> {
    const timeoutMs = opts?.timeoutMs ?? 300_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (opts?.signal?.aborted) {
        throw new Error("waitForFlight aborted");
      }

      try {
        const raw = await socketRequest<{ deliveries: FlightRecord[] }>(
          resolveSocketPath(),
          "GET",
          `/v1/deliveries?ids=${encodeURIComponent(flightId)}`,
        );
        const flight = raw.deliveries?.find((f) => f.id === flightId);
        if (flight?.state === "completed") return flight;
        if (flight?.state === "failed") {
          throw new Error(`Flight failed: ${flight.summary ?? flightId}`);
        }
      } catch {
        const raw = await httpFallback<{ deliveries: FlightRecord[] }>(
          resolveBrokerHttpUrl(),
          "GET",
          `/v1/deliveries?ids=${encodeURIComponent(flightId)}`,
        );
        const flight = raw.deliveries?.find((f) => f.id === flightId);
        if (flight?.state === "completed") return flight;
        if (flight?.state === "failed") {
          throw new Error(`Flight failed: ${flight.summary ?? flightId}`);
        }
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error(`waitForFlight timed out after ${timeoutMs}ms: ${flightId}`);
  },

  subscribeToEvents(
    onEvent: (event: ScoutEvent) => void,
    onError?: (err: unknown) => void,
  ): { cancel: () => void } {
    let socket: Socket;
    let cancelled = false;

    const connect = () => {
      socket = createConnection(resolveSocketPath());
      socket.write(buildRequest("GET", "/v1/events/stream"));
      let buffer = "";

      socket.on("error", (err) => {
        if (!cancelled) onError?.(err);
      });

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6)) as ScoutEvent;
              onEvent(event);
            } catch {
              // skip malformed SSE lines
            }
          }
        }
      });

      socket.on("end", () => {
        if (!cancelled) setTimeout(connect, 1_000);
      });
    };

    connect();

    return {
      cancel() {
        cancelled = true;
        socket.destroy();
      },
    };
  async upsertEndpoint(req: {
    id: string;
    agentId: string;
    nodeId: string;
    harness: string;
    transport: "local_socket" | "websocket" | "http" | "stdio";
    state: "active" | "idle" | "offline";
    displayName?: string;
    projectRoot?: string;
  }): Promise<{ ok: boolean; endpoint: unknown }> {
    try {
      return await socketRequest<{ ok: boolean; endpoint: unknown }>(
        resolveSocketPath(),
        "POST",
        "/v1/endpoints",
        req,
      );
    } catch {
      return await httpFallback<{ ok: boolean; endpoint: unknown }>(
        resolveBrokerHttpUrl(),
        "POST",
        "/v1/endpoints",
        req,
      );
    }
  },

  async upsertAgentCard(card: {
    id: string;
    agentId: string;
    displayName: string;
    handle: string;
    harness: string;
    transport: "local_socket" | "websocket" | "http" | "stdio";
    projectRoot: string;
    currentDirectory?: string;
    selector?: string;
    sessionId?: string;
    nodeId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ ok: boolean; card: unknown }> {
    try {
      return await socketRequest<{ ok: boolean; card: unknown }>(
        resolveSocketPath(),
        "POST",
        "/v1/agent-cards",
        card,
      );
    } catch {
      return await httpFallback<{ ok: boolean; card: unknown }>(
        resolveBrokerHttpUrl(),
        "POST",
        "/v1/agent-cards",
        card,
      );
    }
  },

  async getAgentCards(): Promise<unknown[]> {
    try {
      const raw = await socketRequest<{ cards: unknown[] }>(
        resolveSocketPath(),
        "GET",
        "/v1/agent-cards",
      );
      return raw.cards;
    } catch {
      const raw = await httpFallback<{ cards: unknown[] }>(
        resolveBrokerHttpUrl(),
        "GET",
        "/v1/agent-cards",
      );
      return raw.cards;
    }
  },
  async deleteEndpoint(id: string): Promise<{ ok: boolean }> {
    try {
      return await socketRequest<{ ok: boolean }>(
        resolveSocketPath(),
        "DELETE",
        `/v1/endpoints/${encodeURIComponent(id)}`,
      );
    } catch {
      return await httpFallback<{ ok: boolean }>(
        resolveBrokerHttpUrl(),
        "DELETE",
        `/v1/endpoints/${encodeURIComponent(id)}`,
      );
    }
  },

};
