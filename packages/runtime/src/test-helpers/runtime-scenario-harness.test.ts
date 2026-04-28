import { test } from "bun:test";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type {
  ActorIdentity,
  AgentCapability,
  AgentClass,
  AgentDefinition,
  AgentEndpoint,
  AgentHarness,
  ConversationDefinition,
  DeliveryIntent,
  MessageRecord,
  NodeDefinition,
  ShareMode,
  VisibilityScope,
} from "@openscout/protocol";
import { DEFAULT_BROKER_HOST, buildDefaultBrokerUrl } from "../broker-process-manager";

const runtimeDir = join(import.meta.dir, "..", "..");

export type ScenarioBroker = {
  baseUrl: string;
  controlHome: string;
  nodeId: string;
  child: ReturnType<typeof Bun.spawn>;
};

type PairingBridgeSession = {
  id: string;
  name: string;
  adapterType: string;
  status: "connecting" | "active" | "idle" | "error" | "closed";
  cwd?: string;
  model?: string;
  providerMeta?: Record<string, unknown>;
};

export type ScenarioActorInput = {
  id: string;
  kind?: ActorIdentity["kind"];
  displayName?: string;
  handle?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
};

export type ScenarioAgentInput = {
  id: string;
  definitionId?: string;
  displayName?: string;
  handle?: string;
  selector?: string;
  defaultSelector?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
  agentClass?: AgentClass;
  capabilities?: AgentCapability[];
  wakePolicy?: AgentDefinition["wakePolicy"];
  homeNodeId?: string;
  authorityNodeId?: string;
  advertiseScope?: AgentDefinition["advertiseScope"];
  harness?: AgentHarness;
  transport?: AgentEndpoint["transport"];
  endpointId?: string;
  endpointNodeId?: string;
  endpointState?: AgentEndpoint["state"];
  sessionId?: string;
  projectRoot?: string;
  cwd?: string;
  branch?: string;
  workspaceQualifier?: string;
  endpointMetadata?: Record<string, unknown>;
};

export type ScenarioConversationInput = {
  id: string;
  kind: ConversationDefinition["kind"];
  title: string;
  visibility?: VisibilityScope;
  shareMode?: ShareMode;
  authorityNodeId?: string;
  participantIds: string[];
  metadata?: Record<string, unknown>;
};

export type ScenarioMessageInput = {
  id: string;
  conversationId: string;
  actorId: string;
  body: string;
  originNodeId?: string;
  class?: MessageRecord["class"];
  mentions?: MessageRecord["mentions"];
  audience?: MessageRecord["audience"];
  visibility?: MessageRecord["visibility"];
  policy?: MessageRecord["policy"];
  createdAt?: number;
  metadata?: MessageRecord["metadata"];
};

async function allocateFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate a free port."));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
    server.once("error", reject);
  });
}

function defaultTransportForHarness(harness: AgentHarness | undefined): AgentEndpoint["transport"] | undefined {
  switch (harness) {
    case "codex":
      return "codex_app_server";
    case "claude":
      return "claude_stream_json";
    default:
      return undefined;
  }
}

function directConversationIdForActors(sourceId: string, targetId: string): string {
  if (sourceId === targetId) {
    return `dm.${sourceId}`;
  }
  if (sourceId === "operator" || targetId === "operator") {
    const peerId = sourceId === "operator" ? targetId : sourceId;
    return `dm.operator.${peerId}`;
  }
  return `dm.${[sourceId, targetId].sort().join(".")}`;
}

export class RuntimeScenarioHarness {
  private readonly brokers = new Set<ScenarioBroker>();
  private readonly servers = new Set<ReturnType<typeof Bun.serve>>();
  private readonly tempRoots = new Set<string>();

  async dispose(): Promise<void> {
    for (const broker of this.brokers) {
      broker.child.kill();
      await broker.child.exited.catch(() => undefined);
      rmSync(broker.controlHome, { recursive: true, force: true });
    }
    this.brokers.clear();

    for (const server of this.servers) {
      server.stop(true);
    }
    this.servers.clear();

    for (const root of this.tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    this.tempRoots.clear();
  }

  async startBroker(input: {
    controlHome?: string;
    env?: Record<string, string | undefined>;
  } = {}): Promise<ScenarioBroker> {
    const controlHome = input.controlHome ?? mkdtempSync(join(tmpdir(), "openscout-runtime-scenario-"));
    const port = await allocateFreePort();
    const baseUrl = buildDefaultBrokerUrl(DEFAULT_BROKER_HOST, port);
    const derivedNodeId = `node-${basename(controlHome).toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`;
    const child = Bun.spawn({
      cmd: ["bun", "run", "src/broker-daemon.ts"],
      cwd: runtimeDir,
      env: {
        ...process.env,
        OPENSCOUT_CONTROL_HOME: controlHome,
        OPENSCOUT_BROKER_HOST: DEFAULT_BROKER_HOST,
        OPENSCOUT_BROKER_PORT: String(port),
        OPENSCOUT_BROKER_URL: baseUrl,
        OPENSCOUT_NODE_ID: derivedNodeId,
        OPENSCOUT_MESH_DISCOVERY_INTERVAL_MS: "0",
        OPENSCOUT_PARENT_PID: "0",
        ...input.env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    await this.waitForHealth(baseUrl);
    const node = await this.get<NodeDefinition>(baseUrl, "/v1/node");
    const broker = { baseUrl, controlHome, nodeId: node.id, child };
    this.brokers.add(broker);
    return broker;
  }

  startHangingPeerServer(): string {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Promise<Response>(() => {});
      },
    });
    this.servers.add(server);
    return `http://127.0.0.1:${server.port}`;
  }

  startPairingBridgeServer(input: {
    sessions: PairingBridgeSession[];
  }): { port: number } {
    const sessions = new Map(input.sessions.map((session) => [
      session.id,
      {
        session,
        turns: [],
        currentTurnId: undefined,
      },
    ]));

    const server = Bun.serve({
      port: 0,
      fetch(request, upgradedServer) {
        if (upgradedServer.upgrade(request)) {
          return undefined;
        }
        return new Response("not found", { status: 404 });
      },
      websocket: {
        message(ws, message) {
          const payload = JSON.parse(String(message)) as {
            id?: number;
            method?: string;
            params?: { path?: string; input?: Record<string, unknown> };
          };
          const requestId = payload.id ?? null;
          const path = payload.params?.path;

          const respond = (body: unknown) => {
            ws.send(JSON.stringify({
              id: requestId,
              jsonrpc: "2.0",
              ...body,
            }));
          };

          if (!path) {
            respond({ error: { message: "unsupported" } });
            return;
          }

          if (payload.method === "query" && path === "session.list") {
            respond({
              result: {
                type: "data",
                data: [...sessions.values()].map((entry) => entry.session),
              },
            });
            return;
          }

          if (payload.method === "query" && path === "session.snapshot") {
            const sessionId = typeof payload.params?.input?.sessionId === "string"
              ? payload.params.input.sessionId
              : "";
            const snapshot = sessions.get(sessionId);
            if (!snapshot) {
              respond({ error: { message: `unknown session ${sessionId}` } });
              return;
            }
            respond({
              result: {
                type: "data",
                data: snapshot,
              },
            });
            return;
          }

          if (payload.method === "mutation" && path === "session.create") {
            const inputValue = payload.params?.input ?? {};
            const adapterType = typeof inputValue.adapterType === "string" ? inputValue.adapterType : "codex";
            const name = typeof inputValue.name === "string" ? inputValue.name : `${adapterType} attached`;
            const cwd = typeof inputValue.cwd === "string" ? inputValue.cwd : undefined;
            const options = typeof inputValue.options === "object" && inputValue.options
              ? inputValue.options as Record<string, unknown>
              : {};
            const threadId = typeof options.threadId === "string"
              ? options.threadId
              : `thread-${sessions.size + 1}`;
            const sessionId = `pairing-${threadId.slice(0, 8)}`;
            const session = {
              id: sessionId,
              name,
              adapterType,
              status: "idle" as const,
              cwd,
              providerMeta: {
                threadId,
              },
            };
            sessions.set(sessionId, {
              session,
              turns: [],
              currentTurnId: undefined,
            });
            respond({
              result: {
                type: "data",
                data: session,
              },
            });
            return;
          }

          respond({ error: { message: `unsupported path ${path}` } });
        },
      },
    });

    this.servers.add(server);
    return { port: server.port };
  }

  configurePairingHome(port: number): string {
    const home = mkdtempSync(join(tmpdir(), "openscout-pairing-home-"));
    this.tempRoots.add(home);
    const pairingRoot = join(home, ".scout", "pairing");
    mkdirSync(pairingRoot, { recursive: true });
    writeFileSync(join(pairingRoot, "config.json"), JSON.stringify({ port }), "utf8");
    writeFileSync(join(pairingRoot, "runtime.json"), JSON.stringify({ status: "paired" }), "utf8");
    return home;
  }

  async post<T>(brokerOrBaseUrl: ScenarioBroker | string, path: string, body: unknown): Promise<T> {
    const baseUrl = typeof brokerOrBaseUrl === "string" ? brokerOrBaseUrl : brokerOrBaseUrl.baseUrl;
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
    }

    return response.json() as Promise<T>;
  }

  async get<T>(brokerOrBaseUrl: ScenarioBroker | string, path: string): Promise<T> {
    const baseUrl = typeof brokerOrBaseUrl === "string" ? brokerOrBaseUrl : brokerOrBaseUrl.baseUrl;
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
    }

    return response.json() as Promise<T>;
  }

  async request(
    brokerOrBaseUrl: ScenarioBroker | string,
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; ok: boolean; body: unknown }> {
    const baseUrl = typeof brokerOrBaseUrl === "string" ? brokerOrBaseUrl : brokerOrBaseUrl.baseUrl;
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });

    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    return {
      status: response.status,
      ok: response.ok,
      body,
    };
  }

  async snapshot<T extends Record<string, unknown>>(broker: ScenarioBroker): Promise<T> {
    return this.get<T>(broker, "/v1/snapshot");
  }

  async listMessages(broker: ScenarioBroker, conversationId: string): Promise<MessageRecord[]> {
    return this.get<MessageRecord[]>(
      broker,
      `/v1/messages?conversationId=${encodeURIComponent(conversationId)}`,
    );
  }

  async listDeliveries(
    broker: ScenarioBroker,
    filters: { transport?: DeliveryIntent["transport"]; status?: DeliveryIntent["status"] } = {},
  ): Promise<DeliveryIntent[]> {
    const search = new URLSearchParams();
    if (filters.transport) search.set("transport", filters.transport);
    if (filters.status) search.set("status", filters.status);
    const suffix = search.toString();
    return this.get<DeliveryIntent[]>(broker, `/v1/deliveries${suffix ? `?${suffix}` : ""}`);
  }

  async listEvents<T = Record<string, unknown>>(broker: ScenarioBroker, limit = 100): Promise<T[]> {
    return this.get<T[]>(broker, `/v1/events?limit=${limit}`);
  }

  async registerNode(broker: ScenarioBroker, input: Partial<NodeDefinition> & Pick<NodeDefinition, "id">): Promise<void> {
    await this.post(broker, "/v1/nodes", {
      meshId: "openscout",
      name: input.id,
      advertiseScope: "local",
      registeredAt: Date.now(),
      ...input,
    });
  }

  async registerActor(broker: ScenarioBroker, input: ScenarioActorInput): Promise<void> {
    await this.post(broker, "/v1/actors", {
      id: input.id,
      kind: input.kind ?? "person",
      displayName: input.displayName ?? input.id,
      handle: input.handle,
      labels: input.labels ?? ["scenario"],
      metadata: {
        source: "scenario",
        ...(input.metadata ?? {}),
      },
    } satisfies ActorIdentity);
  }

  async seedOperator(broker: ScenarioBroker, input: Omit<ScenarioActorInput, "id" | "kind"> & { id?: string } = {}): Promise<void> {
    await this.registerActor(broker, {
      id: input.id ?? "operator",
      kind: "person",
      displayName: input.displayName ?? "Operator",
      handle: input.handle ?? "operator",
      labels: input.labels,
      metadata: input.metadata,
    });
  }

  async registerAgent(broker: ScenarioBroker, input: ScenarioAgentInput): Promise<{
    actor: ActorIdentity;
    agent: AgentDefinition;
    endpoint: AgentEndpoint | null;
  }> {
    const definitionId = input.definitionId ?? input.id;
    const displayName = input.displayName ?? input.id;
    const handle = input.handle ?? definitionId;
    const selector = input.selector ?? `@${handle}`;
    const metadata = {
      source: "scenario",
      ...(input.branch ? { branch: input.branch } : {}),
      ...(input.workspaceQualifier ? { workspaceQualifier: input.workspaceQualifier } : {}),
      ...(input.metadata ?? {}),
    };

    const actor: ActorIdentity = {
      id: input.id,
      kind: "agent",
      displayName,
      handle,
      labels: input.labels ?? ["scenario"],
      metadata,
    };
    await this.post(broker, "/v1/actors", actor);

    const agent: AgentDefinition = {
      id: input.id,
      kind: "agent",
      definitionId,
      displayName,
      handle,
      selector,
      defaultSelector: input.defaultSelector ?? selector,
      labels: input.labels ?? ["scenario"],
      metadata,
      agentClass: input.agentClass ?? "general",
      capabilities: input.capabilities ?? ["chat", "invoke", "deliver"],
      wakePolicy: input.wakePolicy ?? "on_demand",
      homeNodeId: input.homeNodeId ?? input.authorityNodeId ?? broker.nodeId,
      authorityNodeId: input.authorityNodeId ?? broker.nodeId,
      advertiseScope: input.advertiseScope ?? "local",
    };
    await this.post(broker, "/v1/agents", agent);

    const harness = input.harness;
    const transport = input.transport ?? defaultTransportForHarness(harness);
    if (!harness || !transport) {
      return { actor, agent, endpoint: null };
    }

    const endpoint: AgentEndpoint = {
      id: input.endpointId ?? `endpoint.${input.id}`,
      agentId: input.id,
      nodeId: input.endpointNodeId ?? broker.nodeId,
      harness,
      transport,
      state: input.endpointState ?? "idle",
      sessionId: input.sessionId,
      projectRoot: input.projectRoot,
      cwd: input.cwd,
      metadata: {
        source: "scenario",
        ...(input.branch ? { branch: input.branch } : {}),
        ...(input.workspaceQualifier ? { workspaceQualifier: input.workspaceQualifier } : {}),
        ...(input.endpointMetadata ?? {}),
      },
    };
    await this.post(broker, "/v1/endpoints", endpoint);
    return { actor, agent, endpoint };
  }

  async registerConversation(
    broker: ScenarioBroker,
    input: ScenarioConversationInput,
  ): Promise<ConversationDefinition> {
    const conversation: ConversationDefinition = {
      id: input.id,
      kind: input.kind,
      title: input.title,
      visibility: input.visibility ?? "private",
      shareMode: input.shareMode ?? "local",
      authorityNodeId: input.authorityNodeId ?? broker.nodeId,
      participantIds: [...input.participantIds].sort(),
      metadata: {
        surface: "scenario",
        ...(input.metadata ?? {}),
      },
    };
    await this.post(broker, "/v1/conversations", conversation);
    return conversation;
  }

  async ensureDirectConversation(
    broker: ScenarioBroker,
    input: {
      sourceId: string;
      targetId: string;
      conversationId?: string;
      title?: string;
      visibility?: VisibilityScope;
      shareMode?: ShareMode;
      authorityNodeId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<ConversationDefinition> {
    const participantIds = [...new Set([input.sourceId, input.targetId])].sort();
    return this.registerConversation(broker, {
      id: input.conversationId ?? directConversationIdForActors(input.sourceId, input.targetId),
      kind: "direct",
      title: input.title ?? `${input.sourceId} <> ${input.targetId}`,
      visibility: input.visibility ?? "private",
      shareMode: input.shareMode ?? "local",
      authorityNodeId: input.authorityNodeId ?? broker.nodeId,
      participantIds,
      metadata: input.metadata,
    });
  }

  async postMessage(
    broker: ScenarioBroker,
    input: ScenarioMessageInput,
  ): Promise<{ ok: boolean; message: MessageRecord; deliveries?: DeliveryIntent[]; mesh?: Record<string, unknown> }> {
    const message: MessageRecord = {
      id: input.id,
      conversationId: input.conversationId,
      actorId: input.actorId,
      originNodeId: input.originNodeId ?? broker.nodeId,
      class: input.class ?? "agent",
      body: input.body,
      mentions: input.mentions,
      audience: input.audience,
      visibility: input.visibility ?? "private",
      policy: input.policy ?? "durable",
      createdAt: input.createdAt ?? Date.now(),
      metadata: input.metadata,
    };
    return this.post(broker, "/v1/messages", message);
  }

  async waitFor<T>(
    load: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeoutMs = 4_000,
  ): Promise<T> {
    const startedAt = Date.now();
    let last: T | undefined;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        last = await load();
        if (predicate(last)) {
          return last;
        }
      } catch {
        // Broker bootstrap can lag slightly during scenario setup.
      }
      await Bun.sleep(100);
    }

    if (last !== undefined) {
      return last;
    }
    throw new Error(`waitFor timed out after ${timeoutMs}ms.`);
  }

  private async waitForHealth(baseUrl: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl}/health`);
        if (response.ok) {
          return;
        }
        lastError = new Error(`health returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await Bun.sleep(100);
    }
    throw lastError ?? new Error("broker did not become healthy");
  }
}

export function runtimeScenario(
  name: string,
  run: (scenario: RuntimeScenarioHarness) => Promise<void>,
  timeoutMs = 20_000,
): void {
  test(name, async () => {
    const scenario = new RuntimeScenarioHarness();
    try {
      await run(scenario);
    } finally {
      await scenario.dispose();
    }
  }, timeoutMs);
}
