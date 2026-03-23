import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { hostname } from "node:os";
import { join } from "node:path";

import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  ControlCommand,
  ControlEvent,
  ConversationBinding,
  ConversationDefinition,
  InvocationRequest,
  MessageRecord,
  NodeDefinition,
} from "@openscout/protocol";

import { createInMemoryControlRuntime } from "./broker.js";
import { SQLiteControlPlaneStore } from "./sqlite-store.js";

function createRuntimeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveControlPlaneHome(): string {
  return process.env.OPENSCOUT_CONTROL_HOME
    ?? join(process.env.HOME ?? process.cwd(), ".openscout", "control-plane");
}

function readRequestBody<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve((raw ? JSON.parse(raw) : {}) as T);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function notFound(response: ServerResponse): void {
  json(response, 404, { error: "not_found" });
}

function badRequest(response: ServerResponse, error: unknown): void {
  json(response, 400, {
    error: "bad_request",
    detail: error instanceof Error ? error.message : String(error),
  });
}

const controlHome = resolveControlPlaneHome();
const dbPath = join(controlHome, "control-plane.sqlite");
const port = Number.parseInt(process.env.OPENSCOUT_BROKER_PORT ?? "5555", 10);
const host = process.env.OPENSCOUT_BROKER_HOST ?? "127.0.0.1";
const meshId = process.env.OPENSCOUT_MESH_ID ?? "openscout";
const nodeName = process.env.OPENSCOUT_NODE_NAME ?? hostname();
const tailnetName = process.env.TAILSCALE_TAILNET ?? undefined;
const brokerUrl = process.env.OPENSCOUT_BROKER_URL ?? `http://${host}:${port}`;
const nodeId = process.env.OPENSCOUT_NODE_ID ?? `${nodeName}-${meshId}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");

const store = new SQLiteControlPlaneStore(dbPath);
const runtime = createInMemoryControlRuntime(store.loadSnapshot(), { localNodeId: nodeId });
const eventClients = new Set<ServerResponse>();

runtime.subscribe((event) => {
  store.recordEvent(event);
  const payload = `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of eventClients) {
    client.write(payload);
  }
});

const localNode: NodeDefinition = {
  id: nodeId,
  meshId,
  name: nodeName,
  hostName: hostname(),
  advertiseScope: host === "127.0.0.1" ? "local" : "mesh",
  brokerUrl,
  tailnetName,
  capabilities: ["broker", "mesh", "local_runtime"],
  registeredAt: Date.now(),
  lastSeenAt: Date.now(),
};

await runtime.upsertNode(localNode);
store.upsertNode(localNode);

function parseLimit(url: URL): number {
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  if (!Number.isFinite(limit) || limit <= 0) return 100;
  return Math.min(limit, 500);
}

async function handleCommand(command: ControlCommand): Promise<unknown> {
  switch (command.kind) {
    case "node.upsert":
      await runtime.upsertNode(command.node);
      store.upsertNode(command.node);
      return { ok: true };
    case "actor.upsert":
      await runtime.upsertActor(command.actor);
      store.upsertActor(command.actor);
      return { ok: true };
    case "agent.upsert":
      await runtime.upsertActor(command.agent);
      await runtime.upsertAgent(command.agent);
      store.upsertActor(command.agent);
      store.upsertAgent(command.agent);
      return { ok: true };
    case "agent.endpoint.upsert":
      await runtime.upsertEndpoint(command.endpoint);
      store.upsertEndpoint(command.endpoint);
      return { ok: true };
    case "conversation.upsert":
      await runtime.upsertConversation(command.conversation);
      store.upsertConversation(command.conversation);
      return { ok: true };
    case "binding.upsert":
      await runtime.upsertBinding(command.binding);
      store.upsertBinding(command.binding);
      return { ok: true };
    case "conversation.post": {
      const deliveries = await runtime.postMessage(command.message);
      store.recordMessage(command.message);
      store.recordDeliveries(deliveries);
      return { ok: true, deliveries };
    }
    case "agent.invoke": {
      const flight = await runtime.invokeAgent(command.invocation);
      store.recordInvocation(command.invocation);
      store.recordFlight(flight);
      return { ok: true, flight };
    }
    case "agent.ensure_awake":
      await runtime.dispatch(command);
      return { ok: true };
    case "stream.subscribe":
      return { ok: true };
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

  if (method === "GET" && url.pathname === "/health") {
    const snapshot = runtime.snapshot();
    json(response, 200, {
      ok: true,
      nodeId,
      meshId,
      counts: {
        nodes: Object.keys(snapshot.nodes).length,
        actors: Object.keys(snapshot.actors).length,
        agents: Object.keys(snapshot.agents).length,
        conversations: Object.keys(snapshot.conversations).length,
        messages: Object.keys(snapshot.messages).length,
        flights: Object.keys(snapshot.flights).length,
      },
    });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/node") {
    json(response, 200, localNode);
    return;
  }

  if (method === "GET" && url.pathname === "/v1/snapshot") {
    json(response, 200, runtime.snapshot());
    return;
  }

  if (method === "GET" && url.pathname === "/v1/events") {
    json(response, 200, store.recentEvents(parseLimit(url)));
    return;
  }

  if (method === "GET" && url.pathname === "/v1/events/stream") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    response.write(`event: hello\ndata: ${JSON.stringify({ nodeId, meshId })}\n\n`);
    eventClients.add(response);
    request.on("close", () => {
      eventClients.delete(response);
      response.end();
    });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/commands") {
    try {
      const command = await readRequestBody<ControlCommand>(request);
      const result = await handleCommand(command);
      json(response, 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/nodes") {
    try {
      const node = await readRequestBody<NodeDefinition>(request);
      await handleCommand({ kind: "node.upsert", node });
      json(response, 200, { ok: true, nodeId: node.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/actors") {
    try {
      const actor = await readRequestBody<ActorIdentity>(request);
      await handleCommand({ kind: "actor.upsert", actor });
      json(response, 200, { ok: true, actorId: actor.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/agents") {
    try {
      const agent = await readRequestBody<AgentDefinition>(request);
      await handleCommand({ kind: "agent.upsert", agent });
      json(response, 200, { ok: true, agentId: agent.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/endpoints") {
    try {
      const endpoint = await readRequestBody<AgentEndpoint>(request);
      await handleCommand({ kind: "agent.endpoint.upsert", endpoint });
      json(response, 200, { ok: true, endpointId: endpoint.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/conversations") {
    try {
      const conversation = await readRequestBody<ConversationDefinition>(request);
      await handleCommand({ kind: "conversation.upsert", conversation });
      json(response, 200, { ok: true, conversationId: conversation.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/bindings") {
    try {
      const binding = await readRequestBody<ConversationBinding>(request);
      await handleCommand({ kind: "binding.upsert", binding });
      json(response, 200, { ok: true, bindingId: binding.id });
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/messages") {
    try {
      const message = await readRequestBody<MessageRecord>(request);
      const result = await handleCommand({ kind: "conversation.post", message });
      json(response, 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/v1/invocations") {
    try {
      const invocation = await readRequestBody<InvocationRequest>(request);
      const result = await handleCommand({ kind: "agent.invoke", invocation });
      json(response, 200, result);
    } catch (error) {
      badRequest(response, error);
    }
    return;
  }

  notFound(response);
}

const server = createServer((request, response) => {
  routeRequest(request, response).catch((error) => {
    json(response, 500, {
      error: "internal_error",
      detail: error instanceof Error ? error.message : String(error),
    });
  });
});

server.listen(port, host, () => {
  console.log(`[openscout-runtime] broker listening on ${brokerUrl}`);
  console.log(`[openscout-runtime] node ${nodeId} in mesh ${meshId}`);
  console.log(`[openscout-runtime] sqlite ${dbPath}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const client of eventClients) {
      client.end();
    }
    store.close();
    server.close(() => process.exit(0));
  });
}
