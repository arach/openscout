import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import type { FlightRecord, ScoutDeliverResponse } from "@openscout/protocol";
import type { BrokerSnapshot, DeliverParams, ScoutEvent } from "../types.ts";
import { resolveBrokerHttpUrl, resolveSocketPaths } from "../config.ts";

// ─── HTTP-over-socket ─────────────────────────────────────────────────────────

async function socketRequest<T>(
  socketPath: string,
  method: string,
  path: string,
  body?: unknown,
  opts?: { acceptedStatuses?: number[] },
): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = httpRequest(
      {
        socketPath,
        method,
        path,
        headers: {
          accept: "application/json",
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload).toString(),
              }
            : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          const bodyText = Buffer.concat(chunks).toString("utf8");
          const acceptedStatuses = new Set(opts?.acceptedStatuses ?? []);
          if (status >= 400 && !acceptedStatuses.has(status)) {
            reject(new Error(`HTTP ${status}: ${bodyText.slice(0, 200)}`));
            return;
          }

          try {
            resolve(bodyText.length > 0 ? JSON.parse(bodyText) as T : undefined as T);
          } catch (err) {
            reject(err);
          }
        });
      },
    );

    const timeout = setTimeout(() => {
      request.destroy(new Error(`Socket request timeout: ${method} ${path}`));
    }, 10_000);

    request.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    request.on("close", () => {
      clearTimeout(timeout);
    });

    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

async function socketRequestWithFallbacks<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { acceptedStatuses?: number[] },
): Promise<T> {
  let lastError: unknown;

  for (const socketPath of resolveSocketPaths()) {
    try {
      return await socketRequest<T>(socketPath, method, path, body, opts);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error(`Socket request failed: ${method} ${path}`);
}

async function requestBroker<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { acceptedStatuses?: number[] },
): Promise<T> {
  try {
    return await socketRequestWithFallbacks<T>(method, path, body, opts);
  } catch {
    return await httpFallback<T>(resolveBrokerHttpUrl(), method, path, body, opts);
  }
}

async function connectStreamSocket(paths: string[]): Promise<{
  request: ClientRequest;
  response: IncomingMessage;
}> {
  let lastError: unknown;

  for (const socketPath of paths) {
    try {
      return await new Promise<{ request: ClientRequest; response: IncomingMessage }>((resolve, reject) => {
        const request = httpRequest(
          {
            socketPath,
            method: "GET",
            path: "/v1/events/stream",
            headers: { accept: "text/event-stream" },
          },
          (response) => {
            const status = response.statusCode ?? 0;
            if (status >= 400) {
              reject(new Error(`HTTP ${status}: /v1/events/stream`));
              request.destroy();
              return;
            }
            resolve({ request, response });
          },
        );

        request.on("error", reject);
        request.end();
      });
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error("Unable to connect to Scout broker socket");
}

async function httpFallback<T>(
  url: string,
  method: string,
  path: string,
  body?: unknown,
  opts?: { acceptedStatuses?: number[] },
): Promise<T> {
  const base = url.replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const acceptedStatuses = new Set(opts?.acceptedStatuses ?? []);
  if (!res.ok && !acceptedStatuses.has(res.status)) {
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

    const raw = await requestBroker<{
      agents: Record<string, unknown>;
      endpoints: Record<string, unknown>;
    }>(
      "GET",
      "/v1/snapshot",
    );
    const snapshot = { agents: raw.agents, endpoints: raw.endpoints };

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

    return await requestBroker<ScoutDeliverResponse>(
      "POST",
      "/v1/deliver",
      payload,
      { acceptedStatuses: [409, 422] },
    );
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

      const raw = await requestBroker<{ deliveries: FlightRecord[] }>(
        "GET",
        `/v1/deliveries?ids=${encodeURIComponent(flightId)}`,
      );
      const flight = raw.deliveries.find((f) => f.id === flightId);
      if (flight?.state === "completed") return flight;
      if (flight?.state === "failed") {
        throw new Error(`Flight failed: ${flight.summary ?? flightId}`);
      }
      if (flight?.state === "cancelled") {
        throw new Error(`Flight cancelled: ${flight.summary ?? flightId}`);
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error(`waitForFlight timed out after ${timeoutMs}ms: ${flightId}`);
  },

  subscribeToEvents(
    onEvent: (event: ScoutEvent) => void,
    onError?: (err: unknown) => void,
  ): { cancel: () => void } {
    let socketRequest: ClientRequest | null = null;
    let socketResponse: IncomingMessage | null = null;
    let cancelled = false;

    const connect = () => {
      connectStreamSocket(resolveSocketPaths())
        .then(({ request, response }) => {
          if (cancelled) {
            request.destroy();
            response.destroy();
            return;
          }

          socketRequest = request;
          socketResponse = response;
          let buffer = "";

          socketRequest.on("error", (err) => {
            if (!cancelled) onError?.(err);
          });

          socketResponse.on("data", (chunk) => {
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

          socketResponse.on("end", () => {
            if (!cancelled) setTimeout(connect, 1_000);
          });
        })
        .catch((err) => {
          if (!cancelled) onError?.(err);
        });
    };

    connect();

    return {
      cancel() {
        cancelled = true;
        socketRequest?.destroy();
        socketResponse?.destroy();
      },
    };
  },

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
    return await requestBroker<{ ok: boolean; endpoint: unknown }>(
      "POST",
      "/v1/endpoints",
      req,
    );
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
    return await requestBroker<{ ok: boolean; card: unknown }>(
      "POST",
      "/v1/agent-cards",
      card,
    );
  },

  async getAgentCards(): Promise<unknown[]> {
    const raw = await requestBroker<{ cards: unknown[] }>(
      "GET",
      "/v1/agent-cards",
    );
    return raw.cards;
  },

  async deleteEndpoint(id: string): Promise<{ ok: boolean }> {
    return await requestBroker<{ ok: boolean }>(
      "DELETE",
      `/v1/endpoints/${encodeURIComponent(id)}`,
    );
  },
};
