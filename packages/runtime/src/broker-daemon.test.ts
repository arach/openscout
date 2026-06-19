import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { directChannelNaturalKey, namedChannelNaturalKey } from "@openscout/protocol";

import { DEFAULT_BROKER_HOST, buildDefaultBrokerUrl } from "./broker-process-manager";

const runtimeDir = join(import.meta.dir, "..");

type BrokerHarness = {
  baseUrl: string;
  controlHome: string;
  nodeId: string;
  child: ReturnType<typeof Bun.spawn>;
  outputDrain: Promise<void>[];
};

type TestConversationIdentity = {
  id: string;
  metadata?: Record<string, unknown>;
  participantIds?: string[];
};

function expectOpaqueDirectConversation(
  conversation: TestConversationIdentity | undefined,
  input: {
    participantIds: string[];
  },
): void {
  expect(conversation?.id.startsWith("c.")).toBe(true);
  expect(conversation?.metadata?.naturalKey).toBe(directChannelNaturalKey(input.participantIds));
  expect(conversation?.metadata?.legacyId).toBeUndefined();
  expect(conversation?.metadata?.legacyConversationId).toBeUndefined();
  expect(conversation?.participantIds).toEqual([...input.participantIds].sort());
}

function expectOpaqueNamedConversation(
  conversation: TestConversationIdentity | undefined,
  input: {
    channel: string;
    participantIds: string[];
  },
): void {
  expect(conversation?.id.startsWith("c.")).toBe(true);
  expect(conversation?.metadata?.channel).toBe(input.channel);
  expect(conversation?.metadata?.naturalKey).toBe(namedChannelNaturalKey(input.channel));
  expect(conversation?.metadata?.legacyId).toBeUndefined();
  expect(conversation?.metadata?.legacyConversationId).toBeUndefined();
  expect(conversation?.participantIds).toEqual([...input.participantIds].sort());
}

const harnesses = new Set<BrokerHarness>();
const hangingServers = new Set<ReturnType<typeof Bun.serve>>();
const pairingHomes = new Set<string>();
const temporaryDirectories = new Set<string>();

afterEach(async () => {
  for (const harness of harnesses) {
    harness.child.kill();
    await harness.child.exited.catch(() => {});
    await Promise.all(harness.outputDrain);
    rmSync(harness.controlHome, { recursive: true, force: true });
  }
  harnesses.clear();
  for (const server of hangingServers) {
    server.stop(true);
  }
  hangingServers.clear();
  for (const home of pairingHomes) {
    rmSync(home, { recursive: true, force: true });
  }
  pairingHomes.clear();
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

async function startBroker(input: {
  controlHome?: string;
  env?: Record<string, string | undefined>;
} = {}): Promise<BrokerHarness> {
  const controlHome = input.controlHome ?? mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
  const port = 38000 + Math.floor(Math.random() * 2000);
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
      OPENSCOUT_BROKER_SOCKET_PATH: join(controlHome, "broker.sock"),
      OPENSCOUT_NODE_ID: derivedNodeId,
      OPENSCOUT_MESH_DISCOVERY_INTERVAL_MS: "0",
      OPENSCOUT_RELAY_HUB: join(controlHome, "relay"),
      OPENSCOUT_SUPPORT_DIRECTORY: join(controlHome, "support"),
      OPENSCOUT_PARENT_PID: "0",
      ...input.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const outputDrain = [drainProcessOutput(child.stdout), drainProcessOutput(child.stderr)];

  await waitForHealth(baseUrl);
  const node = await getJson<{ id: string }>(baseUrl, "/v1/node");
  const harness = { baseUrl, controlHome, nodeId: node.id, child, outputDrain };
  harnesses.add(harness);
  return harness;
}

function writeRelayAgentRegistry(
  supportDirectory: string,
  agents: Record<string, unknown>,
): void {
  mkdirSync(supportDirectory, { recursive: true });
  writeFileSync(join(supportDirectory, "rpc-runtime-cutover-v1"), "test\n", "utf8");
  writeFileSync(
    join(supportDirectory, "relay-agents.json"),
    `${JSON.stringify({ version: 1, agents }, null, 2)}\n`,
    "utf8",
  );
}

function writeFakeTmuxBin(binDirectory: string): string {
  mkdirSync(binDirectory, { recursive: true });
  const logPath = join(binDirectory, "tmux.log");
  const tmuxPath = join(binDirectory, "tmux");
  writeFileSync(
    tmuxPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "cmd=\"${1:-}\"",
      "if [ $# -gt 0 ]; then shift; fi",
      "if [ -n \"${OPENSCOUT_FAKE_TMUX_LOG:-}\" ]; then",
      "  printf '%s %s\\n' \"$cmd\" \"$*\" >> \"$OPENSCOUT_FAKE_TMUX_LOG\"",
      "fi",
      "case \"$cmd\" in",
      "  has-session)",
      "    exit 0",
      "    ;;",
      "  capture-pane)",
      "    printf '\\n'",
      "    exit 0",
      "    ;;",
      "  load-buffer)",
      "    cat >/dev/null",
      "    exit 0",
      "    ;;",
      "  new-session)",
      "    printf '%%1\\n'",
      "    exit 0",
      "    ;;",
      "  paste-buffer|send-keys|delete-buffer|pipe-pane)",
      "    exit 0",
      "    ;;",
      "  *)",
      "    exit 0",
      "    ;;",
      "esac",
    ].join("\n") + "\n",
    "utf8",
  );
  chmodSync(tmuxPath, 0o755);
  return logPath;
}

async function drainProcessOutput(stream: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!stream) return;
  await new Response(stream).arrayBuffer().catch(() => undefined);
}

async function waitForHealth(baseUrl: string): Promise<void> {
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

async function waitFor<T>(
  load: () => Promise<T>,
  predicate: (value: T) => boolean,
): Promise<T> {
  let last: T | undefined;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      last = await load();
      if (predicate(last)) {
        return last;
      }
    } catch {
      // Broker bootstrap is asynchronous after the HTTP listener comes up.
    }
    await Bun.sleep(100);
  }
  if (last !== undefined) {
    return last;
  }
  throw new Error("waitFor did not receive a value");
}

async function postJson<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
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

async function postJsonStatus(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
}

async function getJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function requestJson(baseUrl: string, path: string, init: RequestInit = {}): Promise<{
  status: number;
  ok: boolean;
  body: unknown;
}> {
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

function startHangingPeerServer(): string {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Promise<Response>(() => {});
    },
  });
  hangingServers.add(server);
  return `http://127.0.0.1:${server.port}`;
}

function startA2AResponder(
  handler: (body: Record<string, unknown>) => Record<string, unknown>,
): string {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = await request.json() as Record<string, unknown>;
      return Response.json({
        jsonrpc: "2.0",
        id: body.id ?? null,
        ...handler(body),
      });
    },
  });
  hangingServers.add(server);
  return `http://127.0.0.1:${server.port}/a2a`;
}

function startPairingBridgeServer(input: {
  sessions: Array<{
    id: string;
    name: string;
    adapterType: string;
    status: "connecting" | "active" | "idle" | "error" | "closed";
    cwd?: string;
    model?: string;
    providerMeta?: Record<string, unknown>;
  }>;
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
    fetch(request, server) {
      if (server.upgrade(request)) {
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
  hangingServers.add(server);
  return { port: server.port };
}

function configurePairingHome(port: number): string {
  const home = mkdtempSync(join(tmpdir(), "openscout-pairing-home-"));
  pairingHomes.add(home);
  const pairingRoot = join(home, ".scout", "pairing");
  mkdirSync(pairingRoot, { recursive: true });
  writeFileSync(join(pairingRoot, "config.json"), JSON.stringify({ port }), "utf8");
  writeFileSync(join(pairingRoot, "runtime.json"), JSON.stringify({ status: "paired" }), "utf8");
  return home;
}

function nextSseBlock(buffer: string): { block: string; rest: string } | null {
  const lfIndex = buffer.indexOf("\n\n");
  const crlfIndex = buffer.indexOf("\r\n\r\n");

  if (lfIndex === -1 && crlfIndex === -1) {
    return null;
  }

  if (crlfIndex === -1 || (lfIndex !== -1 && lfIndex < crlfIndex)) {
    return {
      block: buffer.slice(0, lfIndex),
      rest: buffer.slice(lfIndex + 2),
    };
  }

  return {
    block: buffer.slice(0, crlfIndex),
    rest: buffer.slice(crlfIndex + 4),
  };
}

async function waitForThreadEvent(
  baseUrl: string,
  watchId: string,
  predicate: (event: { id?: string; kind?: string; payload?: { message?: { id?: string } } }) => boolean,
  options: {
    triggerOnHello?: () => Promise<void>;
    timeoutMs?: number;
  } = {},
): Promise<{ id?: string; kind?: string; payload?: { message?: { id?: string } } }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  let matched: { id?: string; kind?: string; payload?: { message?: { id?: string } } } | null = null;
  let triggered = false;

  try {
    const response = await fetch(`${baseUrl}/v1/thread-watches/${encodeURIComponent(watchId)}/stream`, {
      headers: {
        accept: "text/event-stream",
      },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`/v1/thread-watches/${watchId}/stream returned ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const next = nextSseBlock(buffer);
        if (!next) {
          break;
        }
        buffer = next.rest;

        let eventName = "";
        const dataLines: string[] = [];
        for (const line of next.block.split(/\r?\n/)) {
          if (line.startsWith("event:")) {
            eventName = line.slice("event:".length).trim();
            continue;
          }
          if (line.startsWith("data:")) {
            dataLines.push(line.slice("data:".length).trim());
          }
        }

        if (eventName === "hello" && options.triggerOnHello && !triggered) {
          triggered = true;
          await options.triggerOnHello();
          continue;
        }

        if (eventName !== "thread.event" || dataLines.length === 0) {
          continue;
        }

        const event = JSON.parse(dataLines.join("\n")) as {
          id?: string;
          kind?: string;
          payload?: { message?: { id?: string } };
        };
        if (predicate(event)) {
          matched = event;
          await reader.cancel();
          controller.abort();
          return event;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError" && matched)) {
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }

  if (matched) {
    return matched;
  }
  throw new Error(`timed out waiting for thread event on watch ${watchId}`);
}

async function seedBasicConversation(harness: BrokerHarness) {
  await postJson(harness.baseUrl, "/v1/actors", {
    id: "operator",
    kind: "person",
    displayName: "Operator",
    handle: "operator",
    labels: ["test"],
    metadata: { source: "test" },
  });

  await postJson(harness.baseUrl, "/v1/agents", {
    id: "fabric",
    kind: "agent",
    definitionId: "fabric",
    displayName: "Fabric",
    handle: "fabric",
    labels: ["test"],
    selector: "@fabric",
    defaultSelector: "@fabric",
    metadata: { source: "test" },
    agentClass: "general",
    capabilities: ["chat", "invoke"],
    wakePolicy: "on_demand",
    homeNodeId: harness.nodeId,
    authorityNodeId: harness.nodeId,
    advertiseScope: "local",
  });

  await postJson(harness.baseUrl, "/v1/conversations", {
    id: "channel.shared",
    kind: "channel",
    title: "shared",
    visibility: "workspace",
    shareMode: "local",
    authorityNodeId: harness.nodeId,
    participantIds: ["operator", "fabric"],
    metadata: { surface: "test" },
  });
}

describe("broker daemon comms layer", () => {
  test("reports build identity and cheap child service states on health", async () => {
    const harness = await startBroker({
      env: {
        OPENSCOUT_BUILD_COMMIT: "abc123",
        OPENSCOUT_BUILD_BRANCH: "lane-c",
        OPENSCOUT_BUILD_ID: "build-health-test",
        OPENSCOUT_BUILD_NUMBER: "42",
      },
    });

    const health = await getJson<{
      ok: boolean;
      build?: {
        packageName?: string;
        version?: string | null;
        commit?: string | null;
        branch?: string | null;
        buildId?: string | null;
        buildNumber?: string | null;
      };
      services?: {
        web?: { managedBy?: string; state?: string; pid?: number | null; healthy?: boolean | null };
        terminalRelay?: { managedBy?: string; state?: string; healthy?: boolean | null };
        localEdge?: { managedBy?: string; state?: string; healthy?: boolean | null };
      };
      counts?: { collaborationRecords?: number };
    }>(harness.baseUrl, "/health");

    expect(health.ok).toBe(true);
    expect(health.build).toEqual(expect.objectContaining({
      packageName: "@openscout/runtime",
      commit: "abc123",
      branch: "lane-c",
      buildId: "build-health-test",
      buildNumber: "42",
    }));
    expect(health.build?.version).toBeTruthy();
    expect(health.services?.web).toEqual(expect.objectContaining({
      managedBy: "broker",
      state: "stopped",
      pid: null,
      healthy: null,
    }));
    expect(health.services?.terminalRelay).toEqual(expect.objectContaining({
      managedBy: "web",
      state: "unknown",
      healthy: null,
    }));
    expect(health.services?.localEdge).toEqual(expect.objectContaining({
      managedBy: "base",
      state: "unknown",
      healthy: null,
    }));
    expect(health.counts?.collaborationRecords).toBe(0);
  });

  test("serves capability snapshots from the broker read endpoint", async () => {
    const harness = await startBroker();

    const snapshot = await getJson<{
      generatedAt: number;
      scope?: { machineId?: string };
      sources: Array<{ kind: string; id: string }>;
      capabilities: unknown[];
      harnessSupport?: Record<string, unknown>;
      warnings: string[];
    }>(harness.baseUrl, "/v1/capabilities");

    expect(snapshot.generatedAt).toBeGreaterThan(0);
    expect(snapshot.scope?.machineId).toBe(harness.nodeId);
    expect(snapshot.sources.some((source) => source.kind === "harness_adapter")).toBe(true);
    expect(snapshot.sources.some((source) => source.kind === "runtime_probe")).toBe(true);
    expect(snapshot.harnessSupport?.codex).toBeTruthy();
    expect(snapshot.capabilities).toEqual([]);
    expect(snapshot.warnings).toEqual([]);

    const cached = await getJson<{ generatedAt: number }>(harness.baseUrl, "/v1/capabilities");
    expect(cached.generatedAt).toBe(snapshot.generatedAt);

    const availability = await getJson<{
      decision: string;
      reason: string;
      capabilityId?: string;
    }>(
      harness.baseUrl,
      "/v1/capabilities/availability?capabilityId=cap%3Amissing&methodName=call&requireReady=1",
    );
    expect(availability).toEqual(expect.objectContaining({
      decision: "deny",
      capabilityId: "cap:missing",
      reason: "capability_missing",
    }));

    const missingId = await requestJson(harness.baseUrl, "/v1/capabilities/availability");
    expect(missingId.status).toBe(400);
  });

  test("projects local model catalog entries into capability snapshots", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-model-catalog-"));
    const harness = await startBroker({ controlHome });
    const catalogDirectory = join(harness.controlHome, "support", "catalog");
    mkdirSync(catalogDirectory, { recursive: true });
    writeFileSync(
      join(catalogDirectory, "model-catalog.json"),
      `${JSON.stringify({
        id: "local-models",
        name: "Local Models",
        models: [{
          providerId: "local",
          modelId: "scout-small",
          displayName: "Scout Small",
          features: { streaming: true, toolCalling: true },
        }],
      })}\n`,
      "utf8",
    );

    const snapshot = await getJson<{
      sources: Array<{ kind: string; id: string }>;
      capabilities: Array<{ id: string; provider: string; displayName: string }>;
    }>(harness.baseUrl, "/v1/capabilities?force=1");

    expect(snapshot.sources).toContainEqual(expect.objectContaining({
      kind: "model_catalog",
      id: "local-models",
    }));
    expect(snapshot.capabilities).toContainEqual(expect.objectContaining({
      id: "cap:model:local:scout-small",
      provider: "model",
      displayName: "Scout Small",
    }));
  });

  test("projects configured MCP server catalog entries into capability snapshots", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-mcp-catalog-"));
    const harness = await startBroker({ controlHome });
    const catalogDirectory = join(harness.controlHome, "support", "catalog");
    mkdirSync(catalogDirectory, { recursive: true });
    writeFileSync(
      join(catalogDirectory, "mcp-servers.json"),
      `${JSON.stringify({
        servers: [{
          id: "disabled-tools",
          name: "Disabled Tools",
          command: "node",
          disabled: true,
        }],
      })}\n`,
      "utf8",
    );

    const snapshot = await getJson<{
      sources: Array<{ kind: string; id: string; raw?: { target?: string; state?: string } }>;
      warnings: string[];
    }>(harness.baseUrl, "/v1/capabilities?force=1");

    expect(snapshot.sources).toContainEqual(expect.objectContaining({
      kind: "runtime_probe",
      id: "mcp:disabled-tools",
      raw: expect.objectContaining({
        target: "mcp_server",
        state: "disabled",
      }),
    }));
    expect(snapshot.warnings).toEqual([]);
  });

  test("serves A2A cards and routes JSON-RPC tasks through Scout invocations", async () => {
    const harness = await startBroker();
    const endpointUrl = startA2AResponder((body) => {
      const params = body.params as { message?: { parts?: Array<{ text?: string }> } } | undefined;
      const text = params?.message?.parts?.[0]?.text ?? "";
      return {
        result: {
          task: {
            id: "external-task-1",
            contextId: "external-context-1",
            status: { state: "TASK_STATE_COMPLETED" },
            artifacts: [
              {
                artifactId: "external-output",
                parts: [{ text: `external reply: ${text}` }],
              },
            ],
          },
        },
      };
    });

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "fabric.a2a",
      kind: "agent",
      definitionId: "fabric",
      displayName: "Fabric A2A",
      handle: "fabric-a2a",
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
      metadata: {
        brokerRegistered: true,
        description: "A test A2A-backed agent.",
        skills: [
          {
            id: "echo",
            name: "Echo",
            description: "Echoes a text task.",
          },
        ],
      },
    });
    await postJson(harness.baseUrl, "/v1/endpoints", {
      id: "endpoint.fabric.a2a",
      agentId: "fabric.a2a",
      nodeId: harness.nodeId,
      harness: "http",
      transport: "http",
      state: "active",
      address: endpointUrl,
      projectRoot: "/tmp/fabric-a2a",
      cwd: "/tmp/fabric-a2a",
      metadata: {
        a2aExecutionUrl: endpointUrl,
        a2aProtocolVersion: "1.0",
      },
    });

    const card = await getJson<{
      protocolVersion: string;
      supportedInterfaces?: Array<{ tenant?: string; url?: string; protocolBinding?: string }>;
      skills?: Array<{ id?: string }>;
    }>(harness.baseUrl, "/v1/a2a/agents/fabric.a2a/agent-card.json");

    expect(card.protocolVersion).toBe("1.0");
    expect(card.supportedInterfaces?.[0]).toMatchObject({
      tenant: "fabric.a2a",
      protocolBinding: "JSONRPC",
    });
    expect(card.skills?.[0]?.id).toBe("echo");

    const brokerCard = await getJson<{
      name: string;
      metadata?: { scoutAgentIds?: string[] };
    }>(harness.baseUrl, "/.well-known/agent-card.json");
    expect(brokerCard.name).toBe("OpenScout Broker");
    expect(brokerCard.metadata?.scoutAgentIds).toContain("fabric.a2a");

    const send = await postJson<{
      jsonrpc: "2.0";
      id: string;
      result?: {
        task?: {
          id: string;
          status: { state: string };
          artifacts?: Array<{ parts?: Array<{ text?: string }> }>;
        };
      };
      error?: { message: string };
    }>(harness.baseUrl, "/v1/a2a/agents/fabric.a2a/rpc", {
      jsonrpc: "2.0",
      id: "send-1",
      method: "SendMessage",
      params: {
        message: {
          role: "ROLE_USER",
          messageId: "a2a-msg-1",
          parts: [{ text: "hello from a2a" }],
        },
        configuration: {
          blocking: true,
        },
      },
    });

    expect(send.error).toBeUndefined();
    expect(send.result?.task?.status.state).toBe("TASK_STATE_COMPLETED");
    expect(send.result?.task?.artifacts?.[0]?.parts?.[0]?.text).toBe("external reply: hello from a2a");

    const taskId = send.result?.task?.id;
    expect(taskId).toBeTruthy();

    const getTask = await postJson<{
      result?: { id: string; status: { state: string } };
    }>(harness.baseUrl, "/v1/a2a/agents/fabric.a2a/rpc", {
      jsonrpc: "2.0",
      id: "get-1",
      method: "GetTask",
      params: { id: taskId },
    });
    expect(getTask.result?.id).toBe(taskId);
    expect(getTask.result?.status.state).toBe("TASK_STATE_COMPLETED");

    const list = await postJson<{
      result?: { tasks: Array<{ id: string }>; totalSize?: number };
    }>(harness.baseUrl, "/v1/a2a/agents/fabric.a2a/rpc", {
      jsonrpc: "2.0",
      id: "list-1",
      method: "ListTasks",
      params: { pageSize: 10 },
    });
    expect(list.result?.tasks.some((task) => task.id === taskId)).toBe(true);
  }, 15_000);

  test("persists posted messages and emits message events", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    const createdAt = Date.now();
    const response = await postJson<{ ok: boolean; message: { id: string } }>(
      harness.baseUrl,
      "/v1/messages",
      {
        id: "msg-test-1",
        conversationId: "channel.shared",
        actorId: "operator",
        originNodeId: harness.nodeId,
        class: "agent",
        body: "@fabric status check",
        mentions: [{ actorId: "fabric", label: "@fabric" }],
        audience: {
          notify: ["fabric"],
          invoke: ["fabric"],
        },
        visibility: "workspace",
        policy: "durable",
        createdAt,
      },
    );

    expect(response.ok).toBe(true);
    expect(response.message.id).toBe("msg-test-1");

    const snapshot = await getJson<{
      messages: Record<string, { id: string; audience?: { invoke?: string[]; notify?: string[] } }>;
    }>(harness.baseUrl, "/v1/snapshot");

    expect(snapshot.messages["msg-test-1"]).toBeDefined();
    expect(snapshot.messages["msg-test-1"]?.audience?.notify).toEqual(["fabric"]);
    expect(snapshot.messages["msg-test-1"]?.audience?.invoke).toEqual(["fabric"]);

    const events = await getJson<Array<{ kind: string; payload: { message?: { id: string } } }>>(
      harness.baseUrl,
      "/v1/events?limit=20",
    );

    expect(events.some((event) => event.kind === "message.posted" && event.payload.message?.id === "msg-test-1")).toBe(true);
    expect(events.some((event) => event.kind === "delivery.planned")).toBe(true);
  }, 15_000);

  test("serves broker messages with status and errors for one agent", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    const createdAt = Date.now();
    await postJson(harness.baseUrl, "/v1/messages", {
      id: "msg-broker-feed-1",
      conversationId: "channel.shared",
      actorId: "operator",
      originNodeId: harness.nodeId,
      class: "agent",
      body: "@fabric please check the broker view",
      mentions: [{ actorId: "fabric", label: "@fabric" }],
      audience: {
        notify: ["fabric"],
        invoke: ["fabric"],
      },
      visibility: "workspace",
      policy: "durable",
      createdAt,
    });
    await postJson(harness.baseUrl, "/v1/flights", {
      id: "flight-broker-feed-1",
      invocationId: "inv-broker-feed-1",
      requesterId: "operator",
      targetAgentId: "fabric",
      state: "failed",
      summary: "Dispatch failed",
      error: "composer did not submit",
      startedAt: createdAt + 1,
      completedAt: createdAt + 2,
    });

    const feed = await getJson<{
      agentId: string;
      status: { found: boolean; lastError?: string; pendingDeliveryIds: string[] };
      counts: { messages: number; deliveries: number; errors: number };
      items: Array<{
        kind: string;
        severity: string;
        messageId?: string;
        flightId?: string;
        deliveryId?: string;
        summary: string;
      }>;
    }>(harness.baseUrl, "/v1/broker/messages?agentId=fabric&limit=20");

    expect(feed.agentId).toBe("fabric");
    expect(feed.status.found).toBe(true);
    expect(feed.status.lastError).toBe("composer did not submit");
    expect(feed.status.pendingDeliveryIds.length).toBeGreaterThan(0);
    expect(feed.counts.messages).toBeGreaterThanOrEqual(1);
    expect(feed.counts.deliveries).toBeGreaterThanOrEqual(1);
    expect(feed.counts.errors).toBeGreaterThanOrEqual(1);
    expect(feed.items).toContainEqual(expect.objectContaining({
      kind: "message",
      messageId: "msg-broker-feed-1",
    }));
    expect(feed.items).toContainEqual(expect.objectContaining({
      kind: "flight",
      severity: "error",
      flightId: "flight-broker-feed-1",
      summary: "composer did not submit",
    }));
    expect(feed.items.some((item) => item.kind === "delivery" && item.deliveryId)).toBe(true);
  }, 15_000);

  test("does not downgrade terminal flights with delayed queued updates", async () => {
    const harness = await startBroker();
    const startedAt = Date.now();

    await postJson(harness.baseUrl, "/v1/flights", {
      id: "flight-terminal-downgrade-1",
      invocationId: "inv-terminal-downgrade-1",
      requesterId: "operator",
      targetAgentId: "scoutbot",
      state: "completed",
      summary: "Scoutbot replied.",
      output: "done",
      startedAt,
      completedAt: startedAt + 1,
      metadata: {
        completedBy: "scoutbot",
        replyMessageId: "reply-1",
      },
    });

    await postJson(harness.baseUrl, "/v1/flights", {
      id: "flight-terminal-downgrade-1",
      invocationId: "inv-terminal-downgrade-1",
      requesterId: "operator",
      targetAgentId: "scoutbot",
      state: "queued",
      summary: "Message stored for Scout. Will deliver when online.",
      startedAt,
      metadata: {},
    });

    const snapshot = await getJson<{
      flights: Record<string, {
        state: string;
        summary?: string;
        output?: string;
        completedAt?: number;
        metadata?: Record<string, unknown>;
      }>;
    }>(harness.baseUrl, "/v1/snapshot");
    const flight = snapshot.flights["flight-terminal-downgrade-1"];

    expect(flight?.state).toBe("completed");
    expect(flight?.summary).toBe("Scoutbot replied.");
    expect(flight?.output).toBe("done");
    expect(flight?.completedAt).toBe(startedAt + 1);
    expect(flight?.metadata?.replyMessageId).toBe("reply-1");
  }, 15_000);

  test("completes an active invocation when the target posts a broker reply", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    const createdAt = Date.now();
    const request = await postJson<{
      kind: string;
      flight?: {
        id: string;
        invocationId: string;
        requesterId: string;
        targetAgentId: string;
        metadata?: Record<string, unknown>;
      };
      conversation?: { id: string; visibility: "workspace" | "private" | "public" };
      message?: { id: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-complete-on-reply",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "agent_id",
        agentId: "fabric",
      },
      body: "Please answer in this thread.",
      intent: "consult",
      ensureAwake: false,
      createdAt,
    });

    expect(request.kind).toBe("delivery");
    expect(request.flight?.id).toBeTruthy();
    expect(request.conversation?.id).toBeTruthy();
    expect(request.message?.id).toBeTruthy();

    await postJson(harness.baseUrl, "/v1/flights", {
      id: request.flight!.id,
      invocationId: request.flight!.invocationId,
      requesterId: request.flight!.requesterId,
      targetAgentId: request.flight!.targetAgentId,
      state: "running",
      summary: "Fabric acknowledged.",
      startedAt: createdAt + 1,
      metadata: request.flight!.metadata ?? {},
    });

    await postJson(harness.baseUrl, "/v1/messages", {
      id: "msg-fabric-completes-invocation",
      conversationId: request.conversation!.id,
      actorId: "fabric",
      originNodeId: harness.nodeId,
      class: "agent",
      body: "The requested answer is complete.",
      replyToMessageId: request.message!.id,
      audience: {
        notify: ["operator"],
        reason: "thread_reply",
      },
      visibility: request.conversation!.visibility,
      policy: "durable",
      createdAt: createdAt + 2,
      metadata: {
        source: "test",
      },
    });

    const snapshot = await getJson<{
      flights: Record<string, {
        state: string;
        summary?: string;
        output?: string;
        completedAt?: number;
        metadata?: Record<string, unknown>;
      }>;
    }>(harness.baseUrl, "/v1/snapshot");
    const flight = snapshot.flights[request.flight!.id];

    expect(flight?.state).toBe("completed");
    expect(flight?.summary).toBe("Fabric replied.");
    expect(flight?.output).toBe("The requested answer is complete.");
    expect(flight?.completedAt).toBe(createdAt + 2);
    expect(flight?.metadata?.completedByBrokerReply).toBe(true);
    expect(flight?.metadata?.replyMessageId).toBe("msg-fabric-completes-invocation");
  }, 15_000);

  test("projects target deliveries as claimable inbox items", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    await postJson(harness.baseUrl, "/v1/messages", {
      id: "msg-inbox-1",
      conversationId: "channel.shared",
      actorId: "operator",
      originNodeId: harness.nodeId,
      class: "agent",
      body: "@fabric inbox this",
      mentions: [{ actorId: "fabric", label: "@fabric" }],
      audience: { notify: ["fabric"] },
      visibility: "workspace",
      policy: "durable",
      createdAt: Date.now(),
    });

    const inbox = await getJson<Array<{
      id: string;
      targetId: string;
      status: string;
      message?: { id: string; body: string };
    }>>(harness.baseUrl, "/v1/inbox?targetId=fabric&limit=20");
    const item = inbox.find((candidate) => candidate.message?.id === "msg-inbox-1");
    expect(item).toBeDefined();
    expect(item?.targetId).toBe("fabric");
    expect(item?.status).toBe("pending");

    const claimed = await postJson<{
      ok: boolean;
      claimed: { id: string; status: string; leaseOwner?: string; message?: { id: string } } | null;
    }>(harness.baseUrl, "/v1/inbox/claim", {
      targetId: "fabric",
      itemId: item!.id,
      leaseOwner: "test-agent",
      leaseMs: 30_000,
    });
    expect(claimed.ok).toBe(true);
    expect(claimed.claimed?.status).toBe("leased");
    expect(claimed.claimed?.message?.id).toBe("msg-inbox-1");

    const staleAck = await postJsonStatus(harness.baseUrl, "/v1/inbox/ack", {
      itemId: claimed.claimed!.id,
      leaseOwner: "other-agent",
    });
    expect(staleAck.status).toBe(409);

    const stillLeased = await getJson<Array<{ id: string; status: string; leaseOwner?: string }>>(
      harness.baseUrl,
      `/v1/inbox?targetId=fabric&status=leased&limit=20`,
    );
    expect(stillLeased).toContainEqual(expect.objectContaining({
      id: item!.id,
      status: "leased",
      leaseOwner: "test-agent",
    }));

    await postJson(harness.baseUrl, "/v1/inbox/ack", {
      itemId: claimed.claimed!.id,
      leaseOwner: "test-agent",
    });

    const acknowledged = await getJson<Array<{ id: string; status: string }>>(
      harness.baseUrl,
      `/v1/inbox?targetId=fabric&status=acknowledged&limit=20`,
    );
    expect(acknowledged.some((candidate) => candidate.id === item!.id && candidate.status === "acknowledged")).toBe(true);
  }, 15_000);

  test("records conversation read cursors and acknowledges passive message deliveries", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    await postJson(harness.baseUrl, "/v1/messages", {
      id: "msg-read-cursor-1",
      conversationId: "channel.shared",
      actorId: "operator",
      originNodeId: harness.nodeId,
      class: "agent",
      body: "@fabric please read this",
      mentions: [{ actorId: "fabric", label: "@fabric" }],
      audience: { notify: ["fabric"] },
      visibility: "workspace",
      policy: "durable",
      createdAt: Date.now(),
    });

    const pending = await getJson<Array<{ id: string; status: string; message?: { id: string } }>>(
      harness.baseUrl,
      "/v1/inbox?targetId=fabric&status=pending&limit=20",
    );
    const item = pending.find((candidate) => candidate.message?.id === "msg-read-cursor-1");
    expect(item).toBeDefined();

    const marked = await postJson<{
      ok: boolean;
      cursor: {
        conversationId: string;
        actorId: string;
        lastReadMessageId?: string;
      };
      acknowledgedDeliveries: number;
    }>(
      harness.baseUrl,
      "/v1/conversations/channel.shared/read-cursors",
      {
        actorId: "fabric",
        lastReadMessageId: "msg-read-cursor-1",
        metadata: { source: "test" },
      },
    );

    expect(marked.ok).toBe(true);
    expect(marked.cursor).toEqual(expect.objectContaining({
      conversationId: "channel.shared",
      actorId: "fabric",
      lastReadMessageId: "msg-read-cursor-1",
    }));
    expect(marked.acknowledgedDeliveries).toBeGreaterThan(0);

    const cursors = await getJson<Array<{ actorId: string; lastReadMessageId?: string }>>(
      harness.baseUrl,
      "/v1/conversations/channel.shared/read-cursors",
    );
    expect(cursors).toContainEqual(expect.objectContaining({
      actorId: "fabric",
      lastReadMessageId: "msg-read-cursor-1",
    }));

    const acknowledged = await getJson<Array<{ id: string; status: string; message?: { id: string } }>>(
      harness.baseUrl,
      "/v1/inbox?targetId=fabric&status=acknowledged&limit=20",
    );
    expect(acknowledged).toContainEqual(expect.objectContaining({
      id: item!.id,
      status: "acknowledged",
    }));

    const events = await getJson<Array<{ kind: string; payload: { cursor?: { actorId: string } } }>>(
      harness.baseUrl,
      "/v1/events?limit=50",
    );
    expect(events.some((event) =>
      event.kind === "conversation.read_cursor.updated" && event.payload.cursor?.actorId === "fabric"
    )).toBe(true);
  }, 15_000);

  test("rejects inbox nack when the caller does not own the active lease", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    await postJson(harness.baseUrl, "/v1/messages", {
      id: "msg-inbox-nack-1",
      conversationId: "channel.shared",
      actorId: "operator",
      originNodeId: harness.nodeId,
      class: "agent",
      body: "@fabric nack this",
      mentions: [{ actorId: "fabric", label: "@fabric" }],
      audience: { notify: ["fabric"] },
      visibility: "workspace",
      policy: "durable",
      createdAt: Date.now(),
    });

    const inbox = await getJson<Array<{ id: string; message?: { id: string } }>>(
      harness.baseUrl,
      "/v1/inbox?targetId=fabric&limit=20",
    );
    const item = inbox.find((candidate) => candidate.message?.id === "msg-inbox-nack-1");
    expect(item).toBeDefined();

    const claimed = await postJson<{
      claimed: { id: string; status: string; leaseOwner?: string } | null;
    }>(harness.baseUrl, "/v1/inbox/claim", {
      targetId: "fabric",
      itemId: item!.id,
      leaseOwner: "nack-owner",
      leaseMs: 30_000,
    });
    expect(claimed.claimed?.status).toBe("leased");

    const staleNack = await postJsonStatus(harness.baseUrl, "/v1/inbox/nack", {
      itemId: claimed.claimed!.id,
      leaseOwner: "other-agent",
      reason: "not mine",
    });
    expect(staleNack.status).toBe(409);

    const stillLeased = await getJson<Array<{ id: string; status: string; leaseOwner?: string }>>(
      harness.baseUrl,
      "/v1/inbox?targetId=fabric&status=leased&limit=20",
    );
    expect(stillLeased).toContainEqual(expect.objectContaining({
      id: item!.id,
      status: "leased",
      leaseOwner: "nack-owner",
    }));
  }, 15_000);

  test("replays thread events and snapshots for shared conversations", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    await postJson(harness.baseUrl, "/v1/conversations", {
      id: "channel.shared.thread-events",
      kind: "channel",
      title: "shared thread events",
      visibility: "workspace",
      shareMode: "shared",
      authorityNodeId: harness.nodeId,
      participantIds: ["operator", "fabric"],
      metadata: { surface: "test" },
    });

    await postJson(harness.baseUrl, "/v1/messages", {
      id: "msg-thread-event-1",
      conversationId: "channel.shared.thread-events",
      actorId: "operator",
      originNodeId: harness.nodeId,
      class: "agent",
      body: "@fabric replay this message",
      mentions: [{ actorId: "fabric", label: "@fabric" }],
      visibility: "workspace",
      policy: "durable",
      createdAt: Date.now(),
    });

    const replayedEvents = await getJson<Array<{
      kind: string;
      conversationId: string;
      payload: { message?: { id?: string } };
    }>>(
      harness.baseUrl,
      "/v1/conversations/channel.shared.thread-events/thread-events?afterSeq=0&limit=20",
    );
    expect(replayedEvents.some((event) => event.kind === "message.posted" && event.payload.message?.id === "msg-thread-event-1")).toBe(true);

    const snapshot = await getJson<{
      latestSeq: number;
      messages?: Array<{ id?: string }>;
    }>(
      harness.baseUrl,
      "/v1/conversations/channel.shared.thread-events/thread-snapshot",
    );
    expect(snapshot.latestSeq).toBeGreaterThan(0);
    expect(snapshot.messages?.some((message) => message.id === "msg-thread-event-1")).toBe(true);
  }, 15_000);

  test("rejects thread watch and snapshot requests for local conversations", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    const openResponse = await requestJson(harness.baseUrl, "/v1/thread-watches/open", {
      method: "POST",
      body: JSON.stringify({
        conversationId: "channel.shared",
        watcherNodeId: "node-remote",
        watcherId: "watch-local-forbidden",
      }),
    });
    expect(openResponse.status).toBe(403);
    expect((openResponse.body as { code?: string }).code).toBe("forbidden");

    const snapshotResponse = await requestJson(
      harness.baseUrl,
      "/v1/conversations/channel.shared/thread-snapshot",
    );
    expect(snapshotResponse.status).toBe(403);
    expect((snapshotResponse.body as { code?: string }).code).toBe("forbidden");
  }, 15_000);

  test("supports thread watch backlog, live delivery, renew, and close", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    await postJson(harness.baseUrl, "/v1/conversations", {
      id: "channel.shared.watch",
      kind: "channel",
      title: "shared watch",
      visibility: "workspace",
      shareMode: "shared",
      authorityNodeId: harness.nodeId,
      participantIds: ["operator", "fabric"],
      metadata: { surface: "test" },
    });

    await postJson(harness.baseUrl, "/v1/messages", {
      id: "msg-watch-1",
      conversationId: "channel.shared.watch",
      actorId: "operator",
      originNodeId: harness.nodeId,
      class: "agent",
      body: "first shared watch event",
      visibility: "workspace",
      policy: "durable",
      createdAt: Date.now(),
    });

    const initialWatch = await postJson<{
      watchId: string;
      acceptedAfterSeq: number;
      latestSeq: number;
      leaseExpiresAt: number;
    }>(harness.baseUrl, "/v1/thread-watches/open", {
      conversationId: "channel.shared.watch",
      watcherNodeId: "node-remote",
      watcherId: "watch-live",
      afterSeq: 0,
      leaseMs: 10_000,
    });
    expect(initialWatch.acceptedAfterSeq).toBe(0);
    expect(initialWatch.latestSeq).toBeGreaterThanOrEqual(1);

    const backlogEvent = await waitForThreadEvent(
      harness.baseUrl,
      initialWatch.watchId,
      (event) => event.kind === "message.posted" && event.payload?.message?.id === "msg-watch-1",
    );
    expect(backlogEvent.payload?.message?.id).toBe("msg-watch-1");

    const renewed = await postJson<{
      watchId: string;
      leaseExpiresAt: number;
    }>(harness.baseUrl, "/v1/thread-watches/renew", {
      watchId: initialWatch.watchId,
      leaseMs: 20_000,
    });
    expect(renewed.watchId).toBe(initialWatch.watchId);
    expect(renewed.leaseExpiresAt).toBeGreaterThan(initialWatch.leaseExpiresAt);

    const resumedWatch = await postJson<{
      watchId: string;
      acceptedAfterSeq: number;
    }>(harness.baseUrl, "/v1/thread-watches/open", {
      conversationId: "channel.shared.watch",
      watcherNodeId: "node-remote",
      watcherId: "watch-live",
      afterSeq: 1,
      leaseMs: 20_000,
    });
    expect(resumedWatch.watchId).toBe(initialWatch.watchId);
    expect(resumedWatch.acceptedAfterSeq).toBe(1);

    const liveEvent = await waitForThreadEvent(
      harness.baseUrl,
      resumedWatch.watchId,
      (event) => event.kind === "message.posted" && event.payload?.message?.id === "msg-watch-2",
      {
        triggerOnHello: async () => {
          await postJson(harness.baseUrl, "/v1/messages", {
            id: "msg-watch-2",
            conversationId: "channel.shared.watch",
            actorId: "fabric",
            originNodeId: harness.nodeId,
            class: "agent",
            body: "second shared watch event",
            visibility: "workspace",
            policy: "durable",
            createdAt: Date.now(),
          });
        },
      },
    );
    expect(liveEvent.payload?.message?.id).toBe("msg-watch-2");

    const closeResponse = await postJson<{ ok: boolean; watchId: string }>(
      harness.baseUrl,
      "/v1/thread-watches/close",
      {
        watchId: resumedWatch.watchId,
        reason: "test_complete",
      },
    );
    expect(closeResponse.ok).toBe(true);
    expect(closeResponse.watchId).toBe(resumedWatch.watchId);

    const renewAfterClose = await requestJson(harness.baseUrl, "/v1/thread-watches/renew", {
      method: "POST",
      body: JSON.stringify({
        watchId: resumedWatch.watchId,
      }),
    });
    expect(renewAfterClose.status).toBe(404);
    expect((renewAfterClose.body as { code?: string }).code).toBe("invalid_request");
  }, 20_000);

  test("forwards remote thread writes to the authority without mirroring history", async () => {
    const authority = await startBroker();
    const remote = await startBroker();

    const sharedConversation = {
      id: "channel.shared.remote",
      kind: "channel",
      title: "shared remote",
      visibility: "workspace",
      shareMode: "shared",
      authorityNodeId: authority.nodeId,
      participantIds: ["remote-agent"],
      metadata: { surface: "test" },
    };

    await postJson(remote.baseUrl, "/v1/nodes", {
      id: authority.nodeId,
      meshId: "openscout",
      name: "Authority",
      advertiseScope: "local",
      brokerUrl: authority.baseUrl,
      registeredAt: Date.now(),
    });

    await postJson(authority.baseUrl, "/v1/agents", {
      id: "remote-agent",
      kind: "agent",
      definitionId: "remote-agent",
      displayName: "Remote Agent",
      handle: "remote-agent",
      labels: ["test"],
      selector: "@remote-agent",
      defaultSelector: "@remote-agent",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat"],
      wakePolicy: "on_demand",
      homeNodeId: remote.nodeId,
      authorityNodeId: remote.nodeId,
      advertiseScope: "local",
    });

    await postJson(remote.baseUrl, "/v1/agents", {
      id: "remote-agent",
      kind: "agent",
      definitionId: "remote-agent",
      displayName: "Remote Agent",
      handle: "remote-agent",
      labels: ["test"],
      selector: "@remote-agent",
      defaultSelector: "@remote-agent",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat"],
      wakePolicy: "on_demand",
      homeNodeId: remote.nodeId,
      authorityNodeId: remote.nodeId,
      advertiseScope: "local",
    });

    await postJson(authority.baseUrl, "/v1/conversations", sharedConversation);
    await postJson(remote.baseUrl, "/v1/conversations", sharedConversation);

    await postJson(remote.baseUrl, "/v1/messages", {
      id: "msg-remote-1",
      conversationId: sharedConversation.id,
      actorId: "remote-agent",
      originNodeId: remote.nodeId,
      class: "agent",
      body: "reply from remote authority forwarding",
      visibility: "workspace",
      policy: "durable",
      createdAt: Date.now(),
    });

    const authorityMessages = await getJson<Array<{ id: string }>>(
      authority.baseUrl,
      `/v1/messages?conversationId=${encodeURIComponent(sharedConversation.id)}`,
    );
    expect(authorityMessages.some((message) => message.id === "msg-remote-1")).toBe(true);

    const remoteSnapshot = await getJson<{ messages: Record<string, { id: string }> }>(
      remote.baseUrl,
      "/v1/snapshot",
    );
    expect(remoteSnapshot.messages["msg-remote-1"]).toBeUndefined();
  }, 40_000);

  test("keeps node-local scoutbot authority when syncing peer agents", async () => {
    const local = await startBroker();
    const peer = await startBroker();
    const scoutbotAgent = (authorityNodeId: string) => ({
      id: "scoutbot",
      kind: "agent",
      definitionId: "scoutbot",
      displayName: "Scout",
      handle: "scoutbot",
      labels: ["assistant", "scout", "scoutbot"],
      selector: "@scoutbot",
      defaultSelector: "@scoutbot",
      metadata: { source: "scoutbot" },
      agentClass: "operator",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "keep_warm",
      homeNodeId: authorityNodeId,
      authorityNodeId,
      advertiseScope: "local",
    });

    await postJson(local.baseUrl, "/v1/agents", scoutbotAgent(local.nodeId));
    await postJson(peer.baseUrl, "/v1/agents", scoutbotAgent(peer.nodeId));
    await postJson(local.baseUrl, "/v1/nodes", {
      id: peer.nodeId,
      meshId: "openscout",
      name: "Peer",
      advertiseScope: "mesh",
      brokerUrl: peer.baseUrl,
      registeredAt: Date.now(),
    });

    await postJson(local.baseUrl, "/v1/mesh/discover", { seeds: [] });

    const snapshot = await getJson<{
      agents: Record<string, { homeNodeId: string; authorityNodeId: string }>;
    }>(local.baseUrl, "/v1/snapshot");
    expect(snapshot.agents.scoutbot?.homeNodeId).toBe(local.nodeId);
    expect(snapshot.agents.scoutbot?.authorityNodeId).toBe(local.nodeId);
  }, 40_000);

  test("fails remote-authority message posts when the authority broker stalls", async () => {
    const harness = await startBroker();
    const hangingBrokerUrl = startHangingPeerServer();
    const authorityNodeId = "peer-authority";
    const conversationId = "dm.sender-air.target-mini";

    await postJson(harness.baseUrl, "/v1/nodes", {
      id: authorityNodeId,
      meshId: "openscout",
      name: "Peer Authority",
      advertiseScope: "mesh",
      brokerUrl: hangingBrokerUrl,
      registeredAt: Date.now(),
    });

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "sender-air",
      kind: "agent",
      definitionId: "sender-air",
      displayName: "Sender Air",
      handle: "sender-air",
      labels: ["test"],
      selector: "@sender-air",
      defaultSelector: "@sender-air",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "target-mini",
      kind: "agent",
      definitionId: "target-mini",
      displayName: "Target Mini",
      handle: "target-mini",
      labels: ["test"],
      selector: "@target-mini",
      defaultSelector: "@target-mini",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat"],
      wakePolicy: "on_demand",
      homeNodeId: authorityNodeId,
      authorityNodeId,
      advertiseScope: "local",
    });

    await postJson(harness.baseUrl, "/v1/conversations", {
      id: conversationId,
      kind: "direct",
      title: "sender-air <> target-mini",
      visibility: "private",
      shareMode: "shared",
      authorityNodeId,
      participantIds: ["sender-air", "target-mini"],
      metadata: { surface: "test" },
    });

    const startedAt = Date.now();
    const response = await fetch(`${harness.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: "msg-stalled-authority",
        conversationId,
        actorId: "sender-air",
        originNodeId: harness.nodeId,
        class: "agent",
        body: "stalled authority forward",
        visibility: "private",
        policy: "durable",
        createdAt: Date.now(),
      }),
      signal: AbortSignal.timeout(6_500),
    });

    expect(response.status).toBe(400);
    expect(Date.now() - startedAt).toBeLessThan(6_500);

    const body = await response.json() as { error?: string; detail?: string };
    expect(body.error).toBe("bad_request");
    expect(body.detail).toContain("peer broker unreachable");
  }, 10_000);

  test("rejects thread protocol requests on a non-authority broker", async () => {
    const authority = await startBroker();
    const remote = await startBroker();

    await postJson(remote.baseUrl, "/v1/conversations", {
      id: "channel.shared.non-authority",
      kind: "channel",
      title: "shared non authority",
      visibility: "workspace",
      shareMode: "shared",
      authorityNodeId: authority.nodeId,
      participantIds: ["operator"],
      metadata: { surface: "test" },
    });

    const openResponse = await requestJson(remote.baseUrl, "/v1/thread-watches/open", {
      method: "POST",
      body: JSON.stringify({
        conversationId: "channel.shared.non-authority",
        watcherNodeId: "node-subscriber",
        watcherId: "watch-not-authority",
      }),
    });
    expect(openResponse.status).toBe(409);
    expect((openResponse.body as { code?: string }).code).toBe("no_responder");

    const replayResponse = await requestJson(
      remote.baseUrl,
      "/v1/conversations/channel.shared.non-authority/thread-events?afterSeq=0&limit=20",
    );
    expect(replayResponse.status).toBe(409);
    expect((replayResponse.body as { code?: string }).code).toBe("no_responder");
  }, 20_000);

  test("creates a flight for explicit invocations even when no endpoint is runnable", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "ghost",
      kind: "agent",
      definitionId: "ghost",
      displayName: "Ghost",
      handle: "ghost",
      labels: ["test"],
      selector: "@ghost",
      defaultSelector: "@ghost",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });

    const response = await postJson<{
      accepted: boolean;
      invocationId: string;
      flightId: string;
      targetAgentId: string;
      state: string;
      flight: { id: string; state: string; targetAgentId: string };
    }>(harness.baseUrl, "/v1/invocations", {
      id: "inv-test-1",
      requesterId: "operator",
      requesterNodeId: harness.nodeId,
      targetAgentId: "ghost",
      action: "consult",
      task: "How is the build going?",
      conversationId: "channel.shared",
      context: { source: "test" },
      ensureAwake: true,
      stream: false,
      createdAt: Date.now(),
      metadata: { source: "test" },
    });

    expect(response.accepted).toBe(true);
    expect(response.targetAgentId).toBe("ghost");
    expect(response.state).toBe("waking");

    const events = await getJson<Array<{ kind: string; payload: { invocation?: { id: string }; flight?: { targetAgentId: string; state: string } } }>>(
      harness.baseUrl,
      "/v1/events?limit=20",
    );

    expect(events.some((event) => event.kind === "invocation.requested" && event.payload.invocation?.id === "inv-test-1")).toBe(true);
    expect(
      events.some((event) => event.kind === "flight.updated" && event.payload.flight?.targetAgentId === "ghost" && event.payload.flight?.state === "waking"),
    ).toBe(true);

    const snapshot = await waitFor(
      () => getJson<{
        flights: Record<string, {
          state: string;
          summary?: string;
          metadata?: Record<string, unknown>;
        }>;
      }>(harness.baseUrl, "/v1/snapshot"),
      (value) => value.flights[response.flightId]?.state === "queued",
    );
    const flight = snapshot.flights[response.flightId];
    expect([
      "Ghost waking.",
      "Message stored for Ghost. Will deliver when online.",
    ]).toContain(flight?.summary);
    const dispatchOutcome = flight?.metadata?.dispatchOutcome as { status?: string; reason?: string } | undefined;
    if (dispatchOutcome) {
      expect(dispatchOutcome).toEqual(expect.objectContaining({
        status: "queued_until_online",
        reason: "no_runnable_endpoint",
      }));
    }
  }, 15_000);

  test("drains queued local invocations when the endpoint comes online", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "sleepy",
      kind: "agent",
      definitionId: "sleepy",
      displayName: "Sleepy",
      handle: "sleepy",
      labels: ["test"],
      selector: "@sleepy",
      defaultSelector: "@sleepy",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });

    const response = await postJson<{
      accepted: boolean;
      flightId: string;
      state: string;
    }>(harness.baseUrl, "/v1/invocations", {
      id: "inv-sleepy-queued",
      requesterId: "operator",
      requesterNodeId: harness.nodeId,
      targetAgentId: "sleepy",
      action: "consult",
      task: "Wake and reply.",
      conversationId: "channel.shared",
      ensureAwake: true,
      stream: false,
      createdAt: Date.now(),
      metadata: { source: "test" },
    });

    expect(response.accepted).toBe(true);
    await waitFor(
      () => getJson<{
        flights: Record<string, { state: string }>;
      }>(harness.baseUrl, "/v1/snapshot"),
      (snapshot) => snapshot.flights[response.flightId]?.state === "queued",
    );

    await postJson(harness.baseUrl, "/v1/endpoints", {
      id: "endpoint-sleepy-pairing",
      agentId: "sleepy",
      nodeId: harness.nodeId,
      harness: "codex",
      transport: "pairing_bridge",
      state: "idle",
      sessionId: "missing-pairing-session",
      metadata: { source: "test", agentName: "Sleepy" },
    });

    const drained = await waitFor(
      () => getJson<{
        flights: Record<string, { state: string; summary?: string; metadata?: Record<string, unknown> }>;
      }>(harness.baseUrl, "/v1/snapshot"),
      (snapshot) => {
        const flight = snapshot.flights[response.flightId];
        const dispatchAck = flight?.metadata?.dispatchAck;
        return Boolean(
          flight
            && flight.state !== "queued"
            && dispatchAck
            && typeof dispatchAck === "object",
        );
      },
    );
    const flight = drained.flights[response.flightId];

    expect(flight?.state).not.toBe("queued");
    expect(flight?.summary).not.toBe("Message stored for Sleepy. Will deliver when online.");
    expect(flight?.metadata?.dispatchAck).toEqual(expect.objectContaining({
      endpointId: "endpoint-sleepy-pairing",
      transport: "pairing_bridge",
    }));
  }, 15_000);

  test("dispatches to an active broker-only tmux endpoint instead of queueing until online", async () => {
    const fakeBin = mkdtempSync(join(tmpdir(), "openscout-fake-tmux-"));
    temporaryDirectories.add(fakeBin);
    const tmuxLogPath = writeFakeTmuxBin(fakeBin);
    const sessionId = "relay-card-active-claude";
    const harness = await startBroker({
      env: {
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        OPENSCOUT_FAKE_TMUX_LOG: tmuxLogPath,
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
      },
    });

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "card-active",
      kind: "agent",
      definitionId: "card-active",
      displayName: "Card Active",
      handle: "card-active",
      labels: ["relay", "project", "agent", "local-agent"],
      selector: "@card-active",
      defaultSelector: "@card-active",
      metadata: {
        source: "relay-agent-registry",
        project: "Card",
        projectRoot: "/tmp/card",
        tmuxSession: sessionId,
        cardLifecycle: {
          kind: "one_time",
          createdAt: Date.now(),
          createdById: "operator",
          expiresAt: Date.now() + 60_000,
          maxUses: 1,
        },
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });

    await postJson(harness.baseUrl, "/v1/endpoints", {
      id: "endpoint-card-active-tmux",
      agentId: "card-active",
      nodeId: harness.nodeId,
      harness: "claude",
      transport: "tmux",
      state: "active",
      sessionId,
      cwd: "/tmp/card",
      projectRoot: "/tmp/card",
      metadata: {
        source: "relay-agent-registry",
        tmuxSession: sessionId,
        runtimeInstanceId: sessionId,
        lastStartedAt: Date.now(),
      },
    });

    const response = await postJson<{
      accepted: boolean;
      flightId: string;
      state: string;
    }>(harness.baseUrl, "/v1/invocations", {
      id: "inv-card-active",
      requesterId: "operator",
      requesterNodeId: harness.nodeId,
      targetAgentId: "card-active",
      action: "wake",
      task: "Ping active card.",
      ensureAwake: true,
      stream: false,
      createdAt: Date.now(),
      metadata: { source: "test" },
    });

    expect(response.accepted).toBe(true);

    const snapshot = await waitFor(
      () => getJson<{
        flights: Record<string, { state: string; summary?: string; metadata?: Record<string, unknown> }>;
      }>(harness.baseUrl, "/v1/snapshot"),
      (value) => value.flights[response.flightId]?.state === "completed",
    );
    const flight = snapshot.flights[response.flightId];

    expect(flight?.summary).toBe("Card Active received the message.");
    expect(flight?.metadata?.dispatchAck).toEqual(expect.objectContaining({
      endpointId: "endpoint-card-active-tmux",
      transport: "tmux",
      sessionId,
    }));
    expect(readFileSync(tmuxLogPath, "utf8")).toContain("send-keys");
  }, 15_000);

  test("keeps replayed invocations available to daemon routes after restart", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const firstHarness = await startBroker({ controlHome });
    await seedBasicConversation(firstHarness);

    await postJson(firstHarness.baseUrl, "/v1/agents", {
      id: "ghost",
      kind: "agent",
      definitionId: "ghost",
      displayName: "Ghost",
      handle: "ghost",
      labels: ["test"],
      selector: "@ghost",
      defaultSelector: "@ghost",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "on_demand",
      homeNodeId: firstHarness.nodeId,
      authorityNodeId: firstHarness.nodeId,
      advertiseScope: "local",
    });

    await postJson(firstHarness.baseUrl, "/v1/invocations", {
      id: "inv-restart-1",
      requesterId: "operator",
      requesterNodeId: firstHarness.nodeId,
      targetAgentId: "ghost",
      action: "consult",
      task: "survive restart?",
      conversationId: "channel.shared",
      ensureAwake: true,
      stream: false,
      createdAt: Date.now(),
      metadata: { source: "test" },
    });

    firstHarness.child.kill();
    await firstHarness.child.exited.catch(() => {});
    harnesses.delete(firstHarness);

    const secondHarness = await startBroker({ controlHome });
    const snapshot = await getJson<{
      invocation: { id: string; targetAgentId: string } | null;
      flight: { invocationId: string; targetAgentId: string; state: string } | null;
    }>(secondHarness.baseUrl, "/v1/invocations/inv-restart-1");

    expect(snapshot.invocation).toEqual(expect.objectContaining({
      id: "inv-restart-1",
      targetAgentId: "ghost",
    }));
    expect(snapshot.flight).toEqual(expect.objectContaining({
      invocationId: "inv-restart-1",
      targetAgentId: "ghost",
    }));
    expect(["waking", "queued"]).toContain(snapshot.flight?.state);

    const lifecycle = await getJson<{
      invocationId: string;
      flightId: string;
      state: string;
      targetAgentId: string;
    }>(secondHarness.baseUrl, "/v1/invocations/inv-restart-1/lifecycle");

    expect(lifecycle).toEqual(expect.objectContaining({
      invocationId: "inv-restart-1",
      targetAgentId: "ghost",
    }));
    expect(["dispatching", "queued"]).toContain(lifecycle.state);
    expect(lifecycle.flightId).toBe(snapshot.flight?.id);
  }, 20_000);

  test("accepts broker-owned delivery for a known wakeable target", async () => {
    const harness = await startBroker();

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "ghost",
      kind: "agent",
      definitionId: "ghost",
      displayName: "Ghost",
      handle: "ghost",
      labels: ["test"],
      selector: "@ghost",
      defaultSelector: "@ghost",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });

    const response = await postJson<{
      kind: string;
      accepted: boolean;
      routeKind: string;
      receipt?: {
        requestId: string;
        requesterId: string;
        requesterNodeId: string;
        targetAgentId?: string;
        targetLabel?: string;
        bindingRef?: string;
        messageId: string;
        flightId?: string;
      };
      targetAgentId?: string;
      bindingRef?: string;
      conversation?: TestConversationIdentity & { kind: string };
      message?: { id: string; conversationId: string; actorId: string; body: string };
      flight?: { id: string; state: string; targetAgentId: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-test-1",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "agent_label",
        label: "@ghost",
      },
      body: "@ghost are you there?",
      intent: "consult",
      createdAt: Date.now(),
    });

    expect(response.kind).toBe("delivery");
    expect(response.accepted).toBe(true);
    expect(response.routeKind).toBe("dm");
    expect(response.targetAgentId).toBe("ghost");
    expect(response.receipt?.requestId).toBe("deliver-test-1");
    expect(response.receipt?.requesterId).toBe("operator");
    expect(response.receipt?.requesterNodeId).toBe(harness.nodeId);
    expect(response.receipt?.targetAgentId).toBe("ghost");
    expect(response.receipt?.targetLabel).toBe("@ghost");
    expect(response.conversation?.kind).toBe("direct");
    expect(response.message?.conversationId).toBe(response.conversation?.id);
    expect(response.receipt?.messageId).toBe(response.message?.id);
    expect(response.flight?.state).toBe("waking");
    expect(response.flight?.targetAgentId).toBe("ghost");
    expect(response.receipt?.flightId).toBe(response.flight?.id);
    expect(response.bindingRef).toBe(response.flight?.id.slice(-8));
    expect(response.receipt?.bindingRef).toBe(response.bindingRef);

    const followup = await postJson<{
      kind: string;
      accepted: boolean;
      targetAgentId?: string;
      bindingRef?: string;
      receipt?: { targetLabel?: string; bindingRef?: string };
      flight?: { targetAgentId: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-test-ref",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "binding_ref",
        ref: response.bindingRef,
      },
      body: "continue from the bound session",
      intent: "consult",
      createdAt: Date.now(),
    });

    expect(followup.kind).toBe("delivery");
    expect(followup.accepted).toBe(true);
    expect(followup.targetAgentId).toBe("ghost");
    expect(followup.receipt?.targetLabel).toBe("@ghost");
    expect(followup.receipt?.bindingRef).toBe(followup.bindingRef);
  }, 15_000);

  test("routes operator and message refs as replies instead of failed deliveries", async () => {
    const harness = await startBroker();

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "designer",
      kind: "agent",
      definitionId: "designer",
      displayName: "Designer",
      handle: "designer",
      labels: ["test"],
      selector: "@designer",
      defaultSelector: "@designer",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });

    const request = await postJson<{
      kind: string;
      accepted: boolean;
      conversation?: { id: string; kind: string };
      message?: {
        id: string;
        conversationId: string;
        actorId: string;
        metadata?: { returnAddress?: { sessionId?: string } };
      };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-operator-request",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "agent_label",
        label: "@designer",
      },
      body: "please review the rail",
      intent: "tell",
      ensureAwake: false,
      replyToSessionId: "codex-thread-123",
      createdAt: Date.now(),
    });

    expect(request.kind).toBe("delivery");
    expect(request.accepted).toBe(true);
    expect(request.message?.actorId).toBe("operator");
    expect(request.message?.metadata?.returnAddress?.sessionId).toBe(
      "codex-thread-123",
    );

    const refReply = await postJson<{
      kind: string;
      accepted: boolean;
      conversation?: { id: string; kind: string };
      message?: { id: string; conversationId: string; actorId: string; replyToMessageId?: string };
      receipt?: { targetLabel?: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-ref-reply",
      caller: {
        actorId: "designer",
        nodeId: harness.nodeId,
      },
      targetLabel: `ref:${request.message!.id}`,
      body: "review complete",
      intent: "tell",
      createdAt: Date.now(),
    });

    expect(refReply.kind).toBe("delivery");
    expect(refReply.accepted).toBe(true);
    expect(refReply.conversation?.id).toBe(request.conversation?.id);
    expect(refReply.message?.replyToMessageId).toBe(request.message?.id);
    expect(refReply.message?.actorId).toBe("designer");
    expect(refReply.receipt?.targetLabel).toBe(`ref:${request.message!.id}`);

    const operatorReply = await postJson<{
      kind: string;
      accepted: boolean;
      targetAgentId?: string;
      conversation?: { id: string; kind: string };
      message?: { actorId: string; audience?: { notify?: string[]; reason?: string } };
      receipt?: { targetAgentId?: string; targetLabel?: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-operator-direct",
      caller: {
        actorId: "designer",
        nodeId: harness.nodeId,
      },
      targetLabel: "@operator",
      body: "thread reply fallback",
      intent: "tell",
      createdAt: Date.now(),
    });

    expect(operatorReply.kind).toBe("delivery");
    expect(operatorReply.accepted).toBe(true);
    expect(operatorReply.targetAgentId).toBe("operator");
    expect(operatorReply.receipt?.targetAgentId).toBe("operator");
    expect(operatorReply.receipt?.targetLabel).toBe("@operator");
    expect(operatorReply.message?.audience?.notify).toEqual(["operator"]);

    const snapshot = await getJson<{
      messages: Record<string, { body: string; metadata?: Record<string, unknown> }>;
    }>(harness.baseUrl, "/v1/snapshot");
    expect(Object.values(snapshot.messages).some((message) => message.body.includes("Scout could not route"))).toBe(false);
  }, 15_000);

  test("dispatches a direct tell without requiring the sender to request wake", async () => {
    const harness = await startBroker();

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "hudson",
      kind: "agent",
      definitionId: "hudson",
      displayName: "Hudson",
      handle: "hudson",
      labels: ["test"],
      selector: "@hudson",
      defaultSelector: "@hudson",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });

    const response = await postJson<{
      kind: string;
      accepted: boolean;
      routeKind: string;
      receipt?: {
        messageId: string;
        flightId?: string;
      };
      message?: { id: string; conversationId: string; body: string };
      flight?: { id: string; invocationId: string; state: string; targetAgentId: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-tell-1",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "agent_label",
        label: "@hudson",
      },
      body: "Can you take a look at this when you get a turn?",
      intent: "tell",
      createdAt: Date.now(),
    });

    expect(response.kind).toBe("delivery");
    expect(response.accepted).toBe(true);
    expect(response.routeKind).toBe("dm");
    expect(response.message?.body).toBe("Can you take a look at this when you get a turn?");
    expect(response.flight?.state).toBe("waking");
    expect(response.flight?.targetAgentId).toBe("hudson");
    expect(response.receipt?.flightId).toBe(response.flight?.id);

    const recorded = await getJson<{
      invocation: {
        id: string;
        action: string;
        ensureAwake: boolean;
        execution?: { session?: string };
        metadata?: Record<string, unknown>;
      } | null;
      flight: { id: string; state: string } | null;
    }>(harness.baseUrl, `/v1/invocations/${response.flight?.invocationId}`);

    expect(recorded.invocation).toEqual(expect.objectContaining({
      action: "wake",
      ensureAwake: true,
      execution: { session: "new" },
      metadata: expect.objectContaining({
        sourceIntent: "direct_message",
      }),
    }));
    expect(recorded.flight?.id).toBe(response.flight?.id);

    const plannedDeliveries = await getJson<Array<{ id: string; status: string; targetId: string }>>(
      harness.baseUrl,
      `/v1/deliveries?messageId=${encodeURIComponent(response.message?.id ?? "")}&targetId=hudson`,
    );
    expect(plannedDeliveries.length).toBeGreaterThan(0);
    expect(plannedDeliveries.every((delivery) => delivery.status === "pending")).toBe(true);

    const completedAt = Date.now();
    await postJson(harness.baseUrl, "/v1/flights", {
      id: response.flight!.id,
      invocationId: response.flight!.invocationId,
      requesterId: "operator",
      targetAgentId: "hudson",
      state: "completed",
      summary: "Hudson received the message.",
      output: "Acknowledged.",
      startedAt: completedAt - 100,
      completedAt,
    });

    const completedDeliveries = await getJson<Array<{ id: string; status: string; metadata?: Record<string, unknown> }>>(
      harness.baseUrl,
      `/v1/deliveries?messageId=${encodeURIComponent(response.message?.id ?? "")}&targetId=hudson&status=completed`,
    );
    expect(completedDeliveries.map((delivery) => delivery.id).sort()).toEqual(
      plannedDeliveries.map((delivery) => delivery.id).sort(),
    );
    expect(completedDeliveries).toContainEqual(expect.objectContaining({
      status: "completed",
      metadata: expect.objectContaining({
        flightId: response.flight?.id,
        invocationId: response.flight?.invocationId,
        flightState: "completed",
      }),
    }));
  }, 15_000);

  test("links broker delivery work items to invocations and terminal flights", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    const createdAt = Date.now();
    const response = await postJson<{
      kind: string;
      accepted: boolean;
      conversation?: { id: string };
      message?: { id: string; metadata?: Record<string, unknown> };
      flight?: { id: string; invocationId: string; targetAgentId: string; state: string };
      workItem?: {
        id: string;
        kind: string;
        state: string;
        title: string;
        ownerId?: string;
        nextMoveOwnerId?: string;
        conversationId?: string;
      };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-work-test-1",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "agent_label",
        label: "@fabric",
      },
      body: "@fabric review the Hudson plan",
      intent: "consult",
      createdAt,
      collaborationRecordId: "work-delivery-test-1",
      workItem: {
        id: "work-delivery-test-1",
        title: "Review the Hudson plan",
        summary: "Track the delegated plan review.",
        priority: "high",
        labels: ["plan"],
        metadata: {
          source: "test",
        },
      },
    });

    expect(response.kind).toBe("delivery");
    expect(response.accepted).toBe(true);
    expect(response.workItem).toEqual(expect.objectContaining({
      id: "work-delivery-test-1",
      kind: "work_item",
      state: "working",
      title: "Review the Hudson plan",
      ownerId: "fabric",
      nextMoveOwnerId: "fabric",
      conversationId: response.conversation?.id,
    }));
    expect(response.flight?.invocationId).toBeDefined();

    const linkedSnapshot = await getJson<{
      messages: Record<string, { metadata?: Record<string, unknown> }>;
      invocations: Record<string, { collaborationRecordId?: string; metadata?: Record<string, unknown> }>;
      collaborationRecords: Record<string, { id: string; state: string; progress?: { summary?: string } }>;
    }>(harness.baseUrl, "/v1/snapshot");
    const invocation = linkedSnapshot.invocations[response.flight!.invocationId];
    const message = linkedSnapshot.messages[response.message!.id];
    expect(invocation?.collaborationRecordId).toBe("work-delivery-test-1");
    expect(invocation?.metadata?.collaborationRecordId).toBe("work-delivery-test-1");
    expect(message?.metadata?.collaborationRecordId).toBe("work-delivery-test-1");
    expect(linkedSnapshot.collaborationRecords["work-delivery-test-1"]?.state).toBe("working");

    await postJson(harness.baseUrl, "/v1/flights", {
      id: response.flight!.id,
      invocationId: response.flight!.invocationId,
      requesterId: "operator",
      targetAgentId: "fabric",
      state: "completed",
      summary: "Fabric replied.",
      output: "Plan review complete.",
      startedAt: createdAt,
      completedAt: createdAt + 1000,
    });

    const completedSnapshot = await getJson<{
      collaborationRecords: Record<string, { state: string; completedAt?: number; progress?: { summary?: string; completedSteps?: number; totalSteps?: number } }>;
    }>(harness.baseUrl, "/v1/snapshot");
    expect(completedSnapshot.collaborationRecords["work-delivery-test-1"]).toEqual(expect.objectContaining({
      state: "done",
      completedAt: createdAt + 1000,
    }));
    expect(completedSnapshot.collaborationRecords["work-delivery-test-1"]?.progress).toEqual(expect.objectContaining({
      summary: "Plan review complete.",
      completedSteps: 1,
      totalSteps: 1,
    }));
  }, 15_000);

  test("reuses duplicate delivery work items without appending another created event", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    const createdAt = Date.now();
    const payload = {
      id: "deliver-work-idempotent-1",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "agent_label",
        label: "@fabric",
      },
      body: "@fabric retry-safe review",
      intent: "consult",
      createdAt,
      collaborationRecordId: "work-delivery-idempotent-1",
      workItem: {
        id: "work-delivery-idempotent-1",
        title: "Retry-safe review",
        summary: "Track a delivery retry without duplicating work.",
        priority: "normal",
        labels: ["retry"],
        metadata: {
          source: "test",
        },
      },
    };

    const first = await postJson<{
      flight?: { id: string; invocationId: string };
      workItem?: { id: string; state: string; title: string };
    }>(harness.baseUrl, "/v1/deliver", payload);
    expect(first.workItem).toEqual(expect.objectContaining({
      id: "work-delivery-idempotent-1",
      state: "working",
      title: "Retry-safe review",
    }));

    await postJson(harness.baseUrl, "/v1/flights", {
      id: first.flight!.id,
      invocationId: first.flight!.invocationId,
      requesterId: "operator",
      targetAgentId: "fabric",
      state: "completed",
      summary: "Fabric replied.",
      output: "Retry-safe review complete.",
      startedAt: createdAt,
      completedAt: createdAt + 500,
    });

    const duplicate = await postJson<{
      message?: { id: string; metadata?: Record<string, unknown> };
      flight?: { id: string; invocationId: string };
      workItem?: { id: string; state: string; title: string };
    }>(harness.baseUrl, "/v1/deliver", payload);

    expect(duplicate.workItem).toEqual(expect.objectContaining({
      id: "work-delivery-idempotent-1",
      state: "done",
      title: "Retry-safe review",
    }));

    const snapshot = await getJson<{
      invocations: Record<string, { collaborationRecordId?: string; metadata?: Record<string, unknown> }>;
      collaborationRecords: Record<string, { state: string; title: string; completedAt?: number }>;
    }>(harness.baseUrl, "/v1/snapshot");
    expect(snapshot.collaborationRecords["work-delivery-idempotent-1"]).toEqual(expect.objectContaining({
      state: "done",
      title: "Retry-safe review",
      completedAt: createdAt + 500,
    }));
    expect(snapshot.invocations[duplicate.flight!.invocationId]?.collaborationRecordId).toBe("work-delivery-idempotent-1");

    const events = await getJson<Array<{ recordId: string; kind: string }>>(
      harness.baseUrl,
      "/v1/collaboration/events?recordId=work-delivery-idempotent-1&limit=20",
    );
    expect(events.filter((event) => event.kind === "created")).toHaveLength(1);
  }, 15_000);

  test("does not overwrite or link conflicting delivery work item ids", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    const createdAt = Date.now();
    await postJson(harness.baseUrl, "/v1/collaboration/records", {
      id: "work-delivery-conflict-1",
      kind: "work_item",
      state: "waiting",
      acceptanceState: "accepted",
      title: "Existing owned work",
      summary: "Keep this state intact.",
      createdById: "operator",
      ownerId: "operator",
      nextMoveOwnerId: "operator",
      requestedById: "operator",
      waitingOn: {
        kind: "actor",
        label: "operator follow-up",
        targetId: "operator",
      },
      conversationId: "channel.shared",
      priority: "high",
      labels: ["existing"],
      createdAt,
      updatedAt: createdAt,
      metadata: {
        source: "seed",
        deliveryRequestId: "deliver-original-conflict-source",
      },
    });
    await postJson(harness.baseUrl, "/v1/collaboration/events", {
      id: "evt-work-delivery-conflict-created",
      recordId: "work-delivery-conflict-1",
      recordKind: "work_item",
      kind: "created",
      actorId: "operator",
      at: createdAt,
      summary: "Existing owned work",
      metadata: {
        source: "seed",
        deliveryRequestId: "deliver-original-conflict-source",
      },
    });

    const response = await postJson<{
      message?: { id: string; metadata?: Record<string, unknown> };
      flight?: { invocationId: string };
      workItem?: { id: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-original-conflict-source",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "agent_label",
        label: "@fabric",
      },
      body: "@fabric try to claim the existing id",
      intent: "consult",
      createdAt: createdAt + 100,
      collaborationRecordId: "work-delivery-conflict-1",
      workItem: {
        id: "work-delivery-conflict-1",
        title: "Conflicting replacement title",
        summary: "This should not replace the existing record.",
        priority: "low",
        labels: ["replacement"],
        metadata: {
          source: "replacement",
          deliveryRequestId: "deliver-original-conflict-source",
        },
      },
    });

    expect(response.workItem).toBeUndefined();
    expect(response.message?.metadata?.collaborationRecordId).toBeUndefined();

    const snapshot = await getJson<{
      invocations: Record<string, { collaborationRecordId?: string; metadata?: Record<string, unknown> }>;
      collaborationRecords: Record<string, {
        state: string;
        title: string;
        ownerId?: string;
        nextMoveOwnerId?: string;
        priority?: string;
        labels?: string[];
      }>;
    }>(harness.baseUrl, "/v1/snapshot");
    expect(snapshot.invocations[response.flight!.invocationId]?.collaborationRecordId).toBeUndefined();
    expect(snapshot.invocations[response.flight!.invocationId]?.metadata?.collaborationRecordId).toBeUndefined();
    expect(snapshot.collaborationRecords["work-delivery-conflict-1"]).toEqual(expect.objectContaining({
      state: "waiting",
      title: "Existing owned work",
      ownerId: "operator",
      nextMoveOwnerId: "operator",
      priority: "high",
      labels: ["existing"],
    }));

    const events = await getJson<Array<{ recordId: string; kind: string }>>(
      harness.baseUrl,
      "/v1/collaboration/events?recordId=work-delivery-conflict-1&limit=20",
    );
    expect(events.filter((event) => event.kind === "created")).toHaveLength(1);
  }, 15_000);

  test("routes local Scout product labels without exposing the coordinator name", async () => {
    const harness = await startBroker();

    const response = await postJson<{
      kind: string;
      accepted: boolean;
      routeKind: string;
      targetAgentId?: string;
      receipt?: { targetAgentId?: string; targetLabel?: string; conversationId?: string };
      conversation?: TestConversationIdentity & { title: string };
      message?: {
        conversationId?: string;
        mentions?: Array<{ actorId: string; label: string }>;
      };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-scout-local",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "agent_label",
        label: "scout",
      },
      body: "local broker status",
      intent: "tell",
      createdAt: Date.now(),
      messageMetadata: {
        source: "scout-cli",
      },
    });

    expect(response.kind).toBe("delivery");
    expect(response.accepted).toBe(true);
    expect(response.targetAgentId).toBe("scout");
    expect(response.receipt?.targetAgentId).toBe("scout");
    expect(response.receipt?.targetLabel).toBe("Scout");
    expectOpaqueDirectConversation(response.conversation, {
      participantIds: ["operator", "scout"],
    });
    expect(response.conversation?.title).toBe("Scout");
    expect(response.receipt?.conversationId).toBe(response.conversation?.id);
    expect(response.message?.conversationId).toBe(response.conversation?.id);
    expect(response.message?.mentions?.[0]).toEqual({ actorId: "scout", label: "@scout" });

    const legacyAlias = await postJson<{
      kind: string;
      accepted: boolean;
      targetAgentId?: string;
      receipt?: { targetLabel?: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-openscout-legacy-local",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "agent_label",
        label: "openscout",
      },
      body: "legacy local alias",
      intent: "tell",
      createdAt: Date.now(),
    });

    expect(legacyAlias.kind).toBe("delivery");
    expect(legacyAlias.accepted).toBe(true);
    expect(legacyAlias.targetAgentId).toBe("scout");
    expect(legacyAlias.receipt?.targetLabel).toBe("Scout");
  }, 15_000);

  test("routes exact session asks to the session owner and preserves existing-session execution", async () => {
    const harness = await startBroker();

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "reviewer.main",
      kind: "agent",
      definitionId: "reviewer",
      displayName: "Reviewer",
      handle: "reviewer",
      labels: ["test"],
      selector: "@reviewer",
      defaultSelector: "@reviewer",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });
    await postJson(harness.baseUrl, "/v1/endpoints", {
      id: "endpoint-reviewer-main",
      agentId: "reviewer.main",
      nodeId: harness.nodeId,
      harness: "codex",
      transport: "codex_app_server",
      state: "active",
      sessionId: "relay-reviewer-codex",
      metadata: {
        externalSessionId: "codex-thread-reviewer",
        threadId: "codex-thread-reviewer",
        runtimeInstanceId: "relay-reviewer-codex",
      },
    });

    const response = await postJson<{
      kind: string;
      accepted: boolean;
      targetAgentId?: string;
      targetSessionId?: string;
      receipt?: {
        targetAgentId?: string;
        targetSessionId?: string;
        flightId?: string;
      };
      message?: {
        metadata?: {
          targetSessionId?: string;
        };
      };
      flight?: {
        id: string;
        targetAgentId: string;
        metadata?: Record<string, unknown>;
      };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-session-target",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "session_id",
        sessionId: "codex-thread-reviewer",
      },
      body: "continue the review in the same context",
      intent: "consult",
      createdAt: Date.now(),
    });

    expect(response.kind).toBe("delivery");
    expect(response.accepted).toBe(true);
    expect(response.targetAgentId).toBe("reviewer.main");
    expect(response.targetSessionId).toBe("codex-thread-reviewer");
    expect(response.receipt?.targetAgentId).toBe("reviewer.main");
    expect(response.receipt?.targetSessionId).toBe("codex-thread-reviewer");
    expect(response.message?.metadata?.targetSessionId).toBe("codex-thread-reviewer");

    const snapshot = await getJson<{
      invocations: Record<string, {
        execution?: { session?: string; targetSessionId?: string };
        metadata?: Record<string, unknown>;
      }>;
    }>(harness.baseUrl, "/v1/snapshot");
    const invocation = Object.values(snapshot.invocations).find(
      (value) => value.metadata?.targetSessionId === "codex-thread-reviewer",
    );
    expect(invocation?.execution).toMatchObject({
      session: "existing",
      targetSessionId: "codex-thread-reviewer",
    });
  }, 15_000);

  test("auto-provisions a one-time card for project-target deliveries", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const supportDirectory = join(controlHome, "support");
    const projectRoot = join(controlHome, "projects", "implicit-project");
    mkdirSync(projectRoot, { recursive: true });
    writeRelayAgentRegistry(supportDirectory, {});

    const harness = await startBroker({
      controlHome,
      env: {
        OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory,
        OPENSCOUT_CORE_AGENTS: "",
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
        OPENSCOUT_NODE_QUALIFIER: "test-node",
      },
    });

    const response = await postJson<{
      kind: string;
      accepted: boolean;
      targetAgentId?: string;
      receipt?: { targetAgentId?: string };
      flight?: { targetAgentId: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-project-auto-card",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "project_path",
        projectPath: projectRoot,
      },
      body: "Review this project without a pre-created card.",
      intent: "consult",
      ensureAwake: false,
      createdAt: Date.now(),
    });

    expect(response.kind).toBe("delivery");
    expect(response.accepted).toBe(true);
    expect(response.targetAgentId?.startsWith("implicit-project-card-")).toBe(true);
    expect(response.targetAgentId?.endsWith(".test-node")).toBe(true);
    expect(response.receipt?.targetAgentId).toBe(response.targetAgentId);
    expect(response.flight?.targetAgentId).toBe(response.targetAgentId);

    const snapshot = await getJson<{
      agents: Record<string, {
        metadata?: {
          projectRoot?: string;
          cardLifecycle?: {
            kind?: string;
            createdById?: string;
            expiresAt?: number;
            maxUses?: number;
          };
        };
      }>;
    }>(harness.baseUrl, "/v1/snapshot");
    const agent = snapshot.agents[response.targetAgentId!];
    expect(agent?.metadata?.projectRoot).toBe(projectRoot);
    expect(agent?.metadata?.cardLifecycle).toEqual(expect.objectContaining({
      kind: "one_time",
      createdById: "operator",
      maxUses: 1,
    }));
    expect(agent?.metadata?.cardLifecycle?.expiresAt).toBeGreaterThan(Date.now());

    const registry = JSON.parse(
      readFileSync(join(supportDirectory, "relay-agents.json"), "utf8"),
    ) as {
      agents: Record<string, { card?: { kind?: string; createdById?: string; maxUses?: number } }>;
    };
    expect(registry.agents[response.targetAgentId!]?.card).toEqual(expect.objectContaining({
      kind: "one_time",
      createdById: "operator",
      maxUses: 1,
    }));
  }, 15_000);

  test("uses a one-time project agent when fresh project work asks for one", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const supportDirectory = join(controlHome, "support");
    const projectRoot = join(controlHome, "projects", "fresh-route");
    mkdirSync(projectRoot, { recursive: true });
    writeRelayAgentRegistry(supportDirectory, {
      "fresh-route": {
        agentId: "fresh-route",
        definitionId: "fresh-route",
        displayName: "Fresh Project",
        projectName: "Fresh Project",
        projectRoot,
        source: "manual",
        defaultHarness: "codex",
        runtime: {
          cwd: projectRoot,
          harness: "codex",
          transport: "codex_app_server",
          sessionId: "relay-fresh-route-codex",
          wakePolicy: "on_demand",
        },
        capabilities: ["chat", "invoke", "deliver"],
      },
    });

    const harness = await startBroker({
      controlHome,
      env: {
        OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory,
        OPENSCOUT_CORE_AGENTS: "",
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
        OPENSCOUT_NODE_QUALIFIER: "test-node",
      },
    });

    const response = await postJson<{
      kind: string;
      accepted: boolean;
      targetAgentId?: string;
      receipt?: { targetAgentId?: string };
      flight?: { targetAgentId: string; state: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-project-one-time-agent",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "project_path",
        projectPath: projectRoot,
      },
      body: "Review this project in fresh Codex context.",
      intent: "consult",
      execution: {
        harness: "codex",
        session: "new",
      },
      projectAgent: {
        persistence: "one_time",
      },
      ensureAwake: false,
      createdAt: Date.now(),
    });

    expect(response.kind).toBe("delivery");
    expect(response.accepted).toBe(true);
    expect(response.targetAgentId).not.toBe("fresh-route.test-node");
    expect(response.targetAgentId?.startsWith("fresh-route-card-")).toBe(true);
    expect(response.targetAgentId?.endsWith(".test-node")).toBe(true);
    expect(response.receipt?.targetAgentId).toBe(response.targetAgentId);
    expect(response.flight?.targetAgentId).toBe(response.targetAgentId);
    expect(response.flight?.state).toBe("queued");
  }, 15_000);

  test("auto-provisions a one-time card when project-target delivery has ambiguous existing agents", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const supportDirectory = join(controlHome, "support");
    const projectRoot = join(controlHome, "projects", "ambiguous-project");
    mkdirSync(projectRoot, { recursive: true });
    writeRelayAgentRegistry(supportDirectory, {
      "ambiguous-one": {
        agentId: "ambiguous-one",
        definitionId: "ambiguous-one",
        displayName: "Ambiguous One",
        projectName: "Ambiguous Project",
        projectRoot,
        source: "manual",
        defaultHarness: "codex",
        runtime: {
          cwd: projectRoot,
          harness: "codex",
          transport: "codex_app_server",
          sessionId: "relay-ambiguous-one-codex",
          wakePolicy: "on_demand",
        },
        capabilities: ["chat", "invoke", "deliver"],
      },
      "ambiguous-two": {
        agentId: "ambiguous-two",
        definitionId: "ambiguous-two",
        displayName: "Ambiguous Two",
        projectName: "Ambiguous Project",
        projectRoot,
        source: "manual",
        defaultHarness: "codex",
        runtime: {
          cwd: projectRoot,
          harness: "codex",
          transport: "codex_app_server",
          sessionId: "relay-ambiguous-two-codex",
          wakePolicy: "on_demand",
        },
        capabilities: ["chat", "invoke", "deliver"],
      },
    });

    const harness = await startBroker({
      controlHome,
      env: {
        OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory,
        OPENSCOUT_CORE_AGENTS: "",
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
        OPENSCOUT_NODE_QUALIFIER: "test-node",
      },
    });

    const response = await postJson<{
      kind: string;
      accepted: boolean;
      targetAgentId?: string;
      receipt?: { targetAgentId?: string };
      flight?: { targetAgentId: string; state: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-project-auto-card-ambiguous",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "project_path",
        projectPath: projectRoot,
      },
      body: "Review this project without choosing from existing sessions.",
      intent: "consult",
      execution: {
        harness: "codex",
        session: "new",
      },
      ensureAwake: false,
      createdAt: Date.now(),
    });

    expect(response.kind).toBe("delivery");
    expect(response.accepted).toBe(true);
    expect(response.targetAgentId?.startsWith("ambiguous-project-card-")).toBe(true);
    expect(response.targetAgentId?.endsWith(".test-node")).toBe(true);
    expect(response.receipt?.targetAgentId).toBe(response.targetAgentId);
    expect(response.flight?.targetAgentId).toBe(response.targetAgentId);
    expect(response.flight?.state).toBe("queued");
  }, 15_000);

  test("refreshes registered local agents before resolving broker-owned delivery", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const supportDirectory = join(controlHome, "support");
    const projectRoot = join(controlHome, "projects", "openscout");
    mkdirSync(projectRoot, { recursive: true });
    writeRelayAgentRegistry(supportDirectory, {});

    const harness = await startBroker({
      controlHome,
      env: {
        OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory,
        OPENSCOUT_CORE_AGENTS: "",
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
        OPENSCOUT_NODE_QUALIFIER: "test-node",
      },
    });

    writeRelayAgentRegistry(supportDirectory, {
      ranger: {
        agentId: "ranger",
        definitionId: "ranger",
        displayName: "Ranger",
        projectName: "OpenScout",
        projectRoot,
        source: "manual",
        defaultHarness: "codex",
        runtime: {
          cwd: projectRoot,
          harness: "codex",
          transport: "codex_app_server",
          sessionId: "relay-ranger-codex",
          wakePolicy: "on_demand",
        },
        capabilities: ["chat", "invoke", "deliver"],
      },
    });

    const response = await postJson<{
      kind: string;
      accepted: boolean;
      targetAgentId?: string;
      receipt?: { targetAgentId?: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-ranger-after-registry-change",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "agent_label",
        label: "@ranger",
      },
      body: "@ranger registry changed while the broker was already running",
      intent: "tell",
      createdAt: Date.now(),
    });

    expect(response.kind).toBe("delivery");
    expect(response.accepted).toBe(true);
    expect(response.targetAgentId).toBe("ranger.test-node");
    expect(response.receipt?.targetAgentId).toBe("ranger.test-node");
  }, 15_000);

  test("routes harness-qualified labels as target params, not exact sessions", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const supportDirectory = join(controlHome, "support");
    const projectRoot = join(controlHome, "projects", "hudson");
    mkdirSync(projectRoot, { recursive: true });
    writeRelayAgentRegistry(supportDirectory, {
      hudson: {
        agentId: "hudson",
        definitionId: "hudson",
        displayName: "Hudson",
        projectName: "Hudson",
        projectRoot,
        source: "manual",
        defaultHarness: "claude",
        runtime: {
          cwd: projectRoot,
          harness: "claude",
          transport: "tmux",
          sessionId: "relay-hudson-claude",
          wakePolicy: "on_demand",
        },
        capabilities: ["chat", "invoke", "deliver"],
      },
    });

    const harness = await startBroker({
      controlHome,
      env: {
        OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory,
        OPENSCOUT_CORE_AGENTS: "",
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
        OPENSCOUT_NODE_QUALIFIER: "test-node",
      },
    });

    const response = await postJson<{
      kind: string;
      accepted: boolean;
      targetAgentId?: string;
      flight?: { invocationId: string; targetAgentId: string };
      receipt?: { targetAgentId?: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-hudson-codex-param",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "agent_label",
        label: "@hudson.harness:codex",
      },
      body: "Hudson should receive this through a Codex-constrained route.",
      intent: "consult",
      ensureAwake: false,
      createdAt: Date.now(),
    });

    expect(response.kind).toBe("delivery");
    expect(response.accepted).toBe(true);
    expect(response.targetAgentId).toBe("hudson.test-node");
    expect(response.receipt?.targetAgentId).toBe("hudson.test-node");

    const snapshot = await getJson<{
      invocations: Record<string, { execution?: { harness?: string } }>;
    }>(harness.baseUrl, "/v1/snapshot");
    const invocation = snapshot.invocations[response.flight!.invocationId];
    expect(invocation?.execution?.harness).toBe("codex");
  }, 15_000);

  test("reconciles queued flights when their local agent is archived as stale", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const supportDirectory = join(controlHome, "support");
    const projectRoot = join(controlHome, "projects", "openscout");
    mkdirSync(projectRoot, { recursive: true });
    writeRelayAgentRegistry(supportDirectory, {});

    const harness = await startBroker({
      controlHome,
      env: {
        OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory,
        OPENSCOUT_CORE_AGENTS: "",
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
        OPENSCOUT_NODE_QUALIFIER: "test-node",
      },
    });

    await postJson(harness.baseUrl, "/v1/deliver", {
      id: "deliver-prime-empty-registry",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "channel",
        channel: "shared",
      },
      body: "prime registry signature",
      intent: "tell",
      createdAt: Date.now(),
    });

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "ranger.main.mini",
      kind: "agent",
      definitionId: "ranger",
      nodeQualifier: "mini",
      workspaceQualifier: "main",
      selector: "@ranger.main.node:mini",
      defaultSelector: "@ranger",
      displayName: "Ranger",
      handle: "ranger",
      labels: ["relay", "project", "agent", "local-agent"],
      metadata: {
        source: "relay-agent-registry",
        projectRoot,
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });

    const accepted = await postJson<{
      kind: string;
      flight?: { id: string; state: string; targetAgentId: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-stale-race",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "agent_id",
        agentId: "ranger.main.mini",
      },
      body: "race before stale sync",
      intent: "consult",
      createdAt: Date.now(),
    });

    expect(accepted.kind).toBe("delivery");
    expect(accepted.flight?.targetAgentId).toBe("ranger.main.mini");
    const flightId = accepted.flight!.id;
    await waitFor(
      () => getJson<{ flights: Record<string, { state: string }> }>(harness.baseUrl, "/v1/snapshot"),
      (snapshot) => snapshot.flights[flightId]?.state === "queued",
    );

    writeRelayAgentRegistry(supportDirectory, {
      ranger: {
        agentId: "ranger.test-node",
        definitionId: "ranger",
        displayName: "Ranger",
        projectName: "OpenScout",
        projectRoot,
        source: "manual",
        defaultHarness: "codex",
        runtime: {
          cwd: projectRoot,
          harness: "codex",
          transport: "codex_app_server",
          sessionId: "relay-ranger-codex",
          wakePolicy: "on_demand",
        },
        capabilities: ["chat", "invoke", "deliver"],
      },
    });

    await postJson(harness.baseUrl, "/v1/deliver", {
      id: "deliver-trigger-stale-sync",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "agent_id",
        agentId: "ranger.test-node",
      },
      body: "trigger registry sync",
      intent: "tell",
      createdAt: Date.now(),
    });

    const reconciled = await waitFor(
      () => getJson<{
        agents: Record<string, { metadata?: Record<string, unknown> }>;
        endpoints: Record<string, { agentId: string; metadata?: Record<string, unknown> }>;
        flights: Record<string, { state: string; error?: string; metadata?: Record<string, unknown> }>;
      }>(harness.baseUrl, "/v1/snapshot"),
      (snapshot) => Boolean(
        snapshot.agents["ranger.test-node"]
          && snapshot.flights[flightId]?.state === "queued",
      ),
    );

    expect(reconciled.agents["ranger.main.mini"]?.metadata?.staleLocalRegistration).not.toBe(true);
    expect(Object.values(reconciled.endpoints).some((endpoint) => (
      endpoint.agentId === "ranger.main.mini"
      && endpoint.metadata?.staleLocalRegistration === true
    ))).toBe(false);
    expect(reconciled.flights[flightId]).toMatchObject({
      state: "queued",
    });
    expect(reconciled.flights[flightId]?.metadata?.reconciledStaleFlight).not.toBe(true);
  }, 15_000);

  test("marks archived local registrations stale on the agent row", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const supportDirectory = join(controlHome, "support");
    const projectRoot = join(controlHome, "projects", "talkie");
    mkdirSync(projectRoot, { recursive: true });
    writeRelayAgentRegistry(supportDirectory, {});

    const harness = await startBroker({
      controlHome,
      env: {
        OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory,
        OPENSCOUT_CORE_AGENTS: "",
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
        OPENSCOUT_NODE_QUALIFIER: "test-node",
      },
    });

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "talkie.test-node",
      kind: "agent",
      definitionId: "talkie",
      nodeQualifier: "test-node",
      selector: "@talkie.node:test-node",
      defaultSelector: "@talkie",
      displayName: "Talkie",
      handle: "talkie",
      labels: ["relay", "project", "agent", "local-agent"],
      metadata: {
        source: "relay-agent-registry",
        projectRoot,
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });
    await postJson(harness.baseUrl, "/v1/endpoints", {
      id: "endpoint-talkie-old",
      agentId: "talkie.test-node",
      nodeId: harness.nodeId,
      harness: "codex",
      transport: "codex_app_server",
      state: "waiting",
      address: null,
      sessionId: "relay-talkie-codex",
      pane: null,
      cwd: projectRoot,
      projectRoot,
      metadata: {
        source: "relay-agent-registry",
        definitionId: "talkie",
        projectRoot,
      },
    });

    await Bun.sleep(5);
    writeRelayAgentRegistry(supportDirectory, {});
    await postJson(harness.baseUrl, "/v1/deliver", {
      id: "deliver-trigger-talkie-stale-sync",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "channel",
        channel: "shared",
      },
      body: "trigger registry sync",
      intent: "tell",
      createdAt: Date.now(),
    });

    const snapshot = await waitFor(
      () => getJson<{
        agents: Record<string, { metadata?: Record<string, unknown> }>;
        endpoints: Record<string, { state?: string; metadata?: Record<string, unknown> }>;
      }>(harness.baseUrl, "/v1/snapshot"),
      (value) => value.agents["talkie.test-node"]?.metadata?.staleLocalRegistration === true,
    );

    expect(snapshot.agents["talkie.test-node"]?.metadata?.staleLocalRegistration).toBe(true);
    expect(snapshot.endpoints["endpoint-talkie-old"]?.state).toBe("offline");
    expect(snapshot.endpoints["endpoint-talkie-old"]?.metadata?.staleLocalRegistration).toBe(true);
  }, 15_000);

  test("accepts broker-owned channel tells without caller-side route preflight", async () => {
    const harness = await startBroker();

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "fabric",
      kind: "agent",
      definitionId: "fabric",
      displayName: "Fabric",
      handle: "fabric",
      labels: ["test"],
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });
    await postJson(harness.baseUrl, "/v1/agents", {
      id: "offline",
      kind: "agent",
      definitionId: "offline",
      displayName: "Offline",
      handle: "offline",
      labels: ["test"],
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });
    await postJson(harness.baseUrl, "/v1/endpoints", {
      id: "endpoint-fabric",
      agentId: "fabric",
      nodeId: harness.nodeId,
      harness: "codex",
      transport: "pairing_bridge",
      state: "active",
    });
    await postJson(harness.baseUrl, "/v1/conversations", {
      id: "c.11111111-1111-4111-8111-111111111111",
      kind: "channel",
      title: "ops",
      visibility: "workspace",
      shareMode: "local",
      authorityNodeId: harness.nodeId,
      participantIds: ["operator", "fabric", "offline"],
      metadata: { surface: "test", channel: "ops", naturalKey: namedChannelNaturalKey("ops") },
    });

    const response = await postJson<{
      kind: string;
      accepted: boolean;
      routeKind: string;
      targetAgentId?: string;
      receipt?: {
        requestId: string;
        requesterId: string;
        requesterNodeId: string;
        targetLabel?: string;
        conversationId: string;
        messageId: string;
      };
      conversation?: { id: string; kind: string };
      message?: {
        id: string;
        actorId: string;
        conversationId: string;
        createdAt: number;
        audience?: { notify?: string[]; reason?: string };
      };
    }>(harness.baseUrl, "/v1/deliver", {
      target: {
        kind: "channel",
        channel: "ops",
      },
      targetLabel: "@ghost",
      body: "build status update",
      intent: "tell",
    });

    expect(response.kind).toBe("delivery");
    expect(response.accepted).toBe(true);
    expect(response.routeKind).toBe("channel");
    expect(response.targetAgentId).toBeUndefined();
    expectOpaqueNamedConversation(response.conversation, {
      channel: "ops",
      participantIds: ["fabric", "offline", "operator"],
    });
    expect(response.message?.conversationId).toBe(response.conversation?.id);
    expect(response.message?.createdAt).toBeGreaterThan(0);
    expect(response.message?.audience?.reason).toBe("conversation_visibility");
    expect(response.message?.audience?.notify).toEqual(["fabric"]);
    expect(response.receipt?.requestId.startsWith("deliver-")).toBe(true);
    expect(response.receipt?.requesterId).toBe("operator");
    expect(response.receipt?.requesterNodeId).toBe(harness.nodeId);
    expect(response.receipt?.targetLabel).toBe("ops");
    expect(response.receipt?.conversationId).toBe(response.conversation?.id);
    expect(response.receipt?.messageId).toBe(response.message?.id);

    const deliveries = await getJson<Array<{ targetId: string; reason: string; policy: string }>>(
      harness.baseUrl,
      `/v1/deliveries?messageId=${encodeURIComponent(response.message?.id ?? "")}&targetId=fabric`,
    );
    expect(deliveries).toContainEqual(expect.objectContaining({
      targetId: "fabric",
      reason: "conversation_visibility",
      policy: "durable",
    }));

    const claim = await postJson<{ claimed?: { id: string; status: string; leaseOwner?: string } | null }>(
      harness.baseUrl,
      "/v1/deliveries/claim",
      {
        messageId: response.message?.id,
        targetId: "fabric",
        reasons: ["conversation_visibility"],
        leaseOwner: "test-instance",
        leaseMs: 30_000,
      },
    );
    expect(claim.claimed?.status).toBe("leased");
    expect(claim.claimed?.leaseOwner).toBe("test-instance");

    const duplicateClaim = await postJson<{ claimed?: { id: string } | null }>(
      harness.baseUrl,
      "/v1/deliveries/claim",
      {
        messageId: response.message?.id,
        targetId: "fabric",
        reasons: ["conversation_visibility"],
        leaseOwner: "other-instance",
      },
    );
    expect(duplicateClaim.claimed).toBeNull();

    await postJson(harness.baseUrl, "/v1/deliveries/status", {
      deliveryId: claim.claimed?.id,
      status: "acknowledged",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    const acknowledged = await getJson<Array<{ id: string; status: string }>>(
      harness.baseUrl,
      `/v1/deliveries?messageId=${encodeURIComponent(response.message?.id ?? "")}&targetId=fabric&status=acknowledged`,
    );
    expect(acknowledged).toContainEqual(expect.objectContaining({
      id: claim.claimed?.id,
      status: "acknowledged",
    }));
  }, 15_000);

  test("journals durable action heartbeats through the HTTP surface", async () => {
    const harness = await startBroker();
    const initialAction = {
      id: "action-heartbeat-1",
      kind: "message_delivery",
      subjectId: "delivery-1",
      authorityCellId: "node-1",
      state: "leased",
      leaseOwner: "worker-a",
      leaseGeneration: 1,
      leaseExpiresAt: 1_000,
      createdAt: 100,
      updatedAt: 100,
    };
    await postJson(harness.baseUrl, "/v1/nodes", {
      id: "node-1",
      meshId: "openscout",
      name: "Node 1",
      advertiseScope: "local",
      registeredAt: 1,
    });
    await postJson(harness.baseUrl, "/v1/durable-actions", initialAction);

    const result = await postJson<{
      ok: boolean;
      actionId: string;
      leaseOwner: string;
      leaseGeneration: number;
      leaseExpiresAt: number;
    }>(
      harness.baseUrl,
      "/v1/durable-actions/action-heartbeat-1/heartbeat",
      {
        owner: "worker-a",
        generation: 1,
        leaseMs: 5_000,
        heartbeatAt: 2_000,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      actionId: "action-heartbeat-1",
      leaseOwner: "worker-a",
      leaseGeneration: 1,
      leaseExpiresAt: 7_000,
    });
    expect(readFileSync(join(harness.controlHome, "broker-journal.jsonl"), "utf8"))
      .toContain('"kind":"durable.action.heartbeat"');

    const stale = await postJsonStatus(
      harness.baseUrl,
      "/v1/durable-actions/action-heartbeat-1/heartbeat",
      {
        owner: "worker-b",
        generation: 1,
        leaseMs: 5_000,
        heartbeatAt: 3_000,
      },
    );
    expect(stale.status).toBe(409);

    const missing = await postJsonStatus(
      harness.baseUrl,
      "/v1/durable-actions/action-missing/heartbeat",
      {
        owner: "worker-a",
        generation: 1,
        leaseMs: 5_000,
        heartbeatAt: 3_000,
      },
    );
    expect(missing.status).toBe(404);

  }, 15_000);

  test("returns a broker question for manual offline targets it cannot wake", async () => {
    const harness = await startBroker();

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "newell",
      kind: "agent",
      definitionId: "newell",
      displayName: "Newell",
      handle: "newell",
      labels: ["test"],
      selector: "@newell",
      defaultSelector: "@newell",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "manual",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });

    const response = await requestJson(harness.baseUrl, "/v1/deliver", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        id: "deliver-test-2",
        requesterId: "operator",
        requesterNodeId: harness.nodeId,
        targetLabel: "@newell",
        body: "@newell hello",
        intent: "consult",
        createdAt: Date.now(),
      }),
    });

    expect(response.status).toBe(409);
    const body = response.body as {
      kind: string;
      accepted: boolean;
      question?: {
        kind: string;
        askedLabel: string;
        target?: {
          agentId: string;
          reason: string;
        };
      };
    };
    expect(body.kind).toBe("question");
    expect(body.accepted).toBe(false);
    expect(body.question?.kind).toBe("unavailable");
    expect(body.question?.askedLabel).toBe("@newell");
    expect(body.question?.target?.agentId).toBe("newell");
    expect(body.question?.target?.reason).toBe("manual_wake_required");
  }, 15_000);

  test("returns a broker question for superseded direct targets before dispatch", async () => {
    const harness = await startBroker();

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "ranger.main.mini",
      kind: "agent",
      definitionId: "ranger",
      nodeQualifier: "mini",
      workspaceQualifier: "main",
      selector: "@ranger.main.node:mini",
      defaultSelector: "@ranger",
      displayName: "Ranger",
      handle: "ranger",
      labels: ["relay", "project", "agent", "local-agent"],
      metadata: {
        staleLocalRegistration: true,
        projectRoot: "/tmp/openscout",
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });

    const response = await requestJson(harness.baseUrl, "/v1/deliver", {
      method: "POST",
      body: JSON.stringify({
        id: "deliver-test-stale",
        requesterId: "operator",
        requesterNodeId: harness.nodeId,
        targetAgentId: "ranger.main.mini",
        targetLabel: "ranger.main.mini",
        body: "@ranger.main.mini hello",
        intent: "consult",
        createdAt: Date.now(),
      }),
    });

    expect(response.status).toBe(409);
    const body = response.body as {
      kind: string;
      accepted: boolean;
      question?: {
        kind: string;
        target?: {
          agentId?: string;
          reason?: string;
          detail?: string;
        };
      };
    };
    expect(body.kind).toBe("question");
    expect(body.accepted).toBe(false);
    expect(body.question?.kind).toBe("unavailable");
    expect(body.question?.target?.agentId).toBe("ranger.main.mini");
    expect(body.question?.target?.reason).toBe("superseded_registration");
    expect(body.question?.target?.detail).toContain("superseded local registration");

    const snapshot = await getJson<{ flights: Record<string, unknown> }>(
      harness.baseUrl,
      "/v1/snapshot",
    );
    expect(Object.keys(snapshot.flights)).toHaveLength(0);
  }, 15_000);

  test("does not treat superseded endpoints as card-only routing targets", async () => {
    const harness = await startBroker();
    const staleAt = Date.now() - 5_000;

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "ranger.main.mini",
      kind: "agent",
      definitionId: "ranger",
      nodeQualifier: "mini",
      workspaceQualifier: "main",
      selector: "@ranger.main.node:mini",
      defaultSelector: "@ranger",
      displayName: "Ranger",
      handle: "ranger",
      labels: ["relay", "project", "agent", "local-agent"],
      metadata: {
        projectRoot: "/tmp/openscout",
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });
    await postJson(harness.baseUrl, "/v1/endpoints", {
      id: "endpoint-ranger-main",
      agentId: "ranger.main.mini",
      nodeId: harness.nodeId,
      harness: "codex",
      transport: "codex_app_server",
      state: "offline",
      sessionId: "relay-ranger-codex",
      cwd: "/tmp/openscout",
      projectRoot: "/tmp/openscout",
      metadata: {
        staleLocalRegistration: true,
        staleAt,
        replacedByAgentId: "ranger.current.mini",
      },
    });

    const response = await requestJson(harness.baseUrl, "/v1/deliver", {
      method: "POST",
      body: JSON.stringify({
        id: "deliver-test-stale-endpoint",
        requesterId: "operator",
        requesterNodeId: harness.nodeId,
        targetAgentId: "ranger.main.mini",
        targetLabel: "ranger.main.mini",
        body: "@ranger.main.mini hello",
        intent: "consult",
        createdAt: Date.now(),
      }),
    });

    expect(response.status).toBe(202);
    const body = response.body as {
      kind: string;
      accepted: boolean;
      targetAgentId?: string;
      conversation?: TestConversationIdentity;
      flight?: { targetAgentId?: string; state?: string; error?: string };
    };
    expect(body.kind).toBe("delivery");
    expect(body.accepted).toBe(true);
    expect(body.targetAgentId).toBe("ranger.main.mini");
    expectOpaqueDirectConversation(body.conversation, {
      participantIds: ["operator", "ranger.main.mini"],
    });
    expect(body.flight?.targetAgentId).toBe("ranger.main.mini");
    expect(body.flight?.state).toBe("waking");
    expect(body.flight?.error).toBeUndefined();

    const snapshot = await getJson<{ flights: Record<string, unknown> }>(
      harness.baseUrl,
      "/v1/snapshot",
    );
    expect(Object.keys(snapshot.flights)).toHaveLength(1);
  }, 15_000);

  test("returns a broker question when the requested session endpoint is not attachable", async () => {
    const harness = await startBroker();
    const staleAt = Date.now() - 5_000;

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "ranger.main.mini",
      kind: "agent",
      definitionId: "ranger",
      nodeQualifier: "mini",
      workspaceQualifier: "main",
      selector: "@ranger.main.node:mini",
      defaultSelector: "@ranger",
      displayName: "Ranger",
      handle: "ranger",
      labels: ["relay", "project", "agent", "local-agent"],
      metadata: {
        projectRoot: "/tmp/openscout",
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });
    await postJson(harness.baseUrl, "/v1/endpoints", {
      id: "endpoint-ranger-main",
      agentId: "ranger.main.mini",
      nodeId: harness.nodeId,
      harness: "codex",
      transport: "codex_app_server",
      state: "offline",
      sessionId: "relay-ranger-codex",
      cwd: "/tmp/openscout",
      projectRoot: "/tmp/openscout",
      metadata: {
        staleLocalRegistration: true,
        staleAt,
        replacedByAgentId: "ranger.current.mini",
      },
    });

    const response = await requestJson(harness.baseUrl, "/v1/deliver", {
      method: "POST",
      body: JSON.stringify({
        id: "deliver-test-stale-session-endpoint",
        requesterId: "operator",
        requesterNodeId: harness.nodeId,
        target: {
          kind: "session_id",
          sessionId: "relay-ranger-codex",
        },
        body: "continue the exact session",
        intent: "consult",
        createdAt: Date.now(),
      }),
    });

    expect(response.status).toBe(409);
    const body = response.body as {
      kind: string;
      accepted: boolean;
      question?: {
        target?: {
          reason?: string;
          detail?: string;
        };
      };
      remediation?: {
        kind?: string;
      };
    };
    expect(body.kind).toBe("question");
    expect(body.accepted).toBe(false);
    expect(body.question?.target?.reason).toBe("session_reference_not_attachable");
    expect(body.question?.target?.detail).toContain("endpoint endpoint-ranger-main");
    expect(body.question?.target?.detail).toContain("replacement agent is ranger.current.mini");
    expect(body.remediation?.kind).toBe("session_reference_not_attachable");

    const snapshot = await getJson<{ flights: Record<string, unknown> }>(
      harness.baseUrl,
      "/v1/snapshot",
    );
    expect(Object.keys(snapshot.flights)).toHaveLength(0);
  }, 15_000);

  test("reports replacement metadata for superseded direct targets", async () => {
    const harness = await startBroker();

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "ranger.main.mini",
      kind: "agent",
      definitionId: "ranger",
      nodeQualifier: "mini",
      workspaceQualifier: "main",
      selector: "@ranger.main.node:mini",
      defaultSelector: "@ranger",
      displayName: "Ranger",
      handle: "ranger",
      labels: ["relay", "project", "agent", "local-agent"],
      metadata: {
        staleLocalRegistration: true,
        replacedByAgentId: "ranger.codex-vox-getting-started.mini",
        projectRoot: "/tmp/openscout",
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });
    await postJson(harness.baseUrl, "/v1/agents", {
      id: "ranger.codex-vox-getting-started.mini",
      kind: "agent",
      definitionId: "ranger",
      nodeQualifier: "mini",
      workspaceQualifier: "codex-vox-getting-started",
      selector: "@ranger.codex-vox-getting-started.node:mini",
      defaultSelector: "@ranger",
      displayName: "Ranger",
      handle: "ranger",
      labels: ["relay", "project", "agent", "local-agent"],
      metadata: {
        projectRoot: "/tmp/openscout",
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });

    const response = await requestJson(harness.baseUrl, "/v1/deliver", {
      method: "POST",
      body: JSON.stringify({
        id: "deliver-test-stale-replaced",
        requesterId: "operator",
        requesterNodeId: harness.nodeId,
        targetAgentId: "ranger.main.mini",
        targetLabel: "ranger.main.mini",
        body: "@ranger.main.mini hello",
        intent: "consult",
        createdAt: Date.now(),
      }),
    });

    expect(response.status).toBe(409);
    const body = response.body as {
      kind: string;
      accepted: boolean;
      remediation?: {
        kind?: string;
        detail?: string;
      };
      question?: {
        kind: string;
        target?: {
          agentId?: string;
          reason?: string;
          detail?: string;
        };
      };
    };
    expect(body.kind).toBe("question");
    expect(body.accepted).toBe(false);
    expect(body.question?.kind).toBe("unavailable");
    expect(body.question?.target?.agentId).toBe("ranger.main.mini");
    expect(body.question?.target?.reason).toBe("superseded_registration");
    expect(body.question?.target?.detail).toContain("replacement agent is ranger.codex-vox-getting-started.mini");
    expect(body.remediation?.kind).toBe("use_current_registration");
  }, 15_000);

  test("does not resolve superseded label-only targets", async () => {
    const harness = await startBroker();

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "ranger.main.mini",
      kind: "agent",
      definitionId: "ranger",
      nodeQualifier: "mini",
      workspaceQualifier: "main",
      selector: "@ranger.main.node:mini",
      defaultSelector: "@ranger",
      displayName: "Ranger",
      handle: "ranger",
      labels: ["relay", "project", "agent", "local-agent"],
      metadata: {
        staleLocalRegistration: true,
        projectRoot: "/tmp/openscout",
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });

    const response = await requestJson(harness.baseUrl, "/v1/deliver", {
      method: "POST",
      body: JSON.stringify({
        id: "deliver-test-stale-label",
        requesterId: "operator",
        requesterNodeId: harness.nodeId,
        targetLabel: "@ranger",
        body: "@ranger hello",
        intent: "consult",
        createdAt: Date.now(),
      }),
    });

    expect(response.status).toBe(422);
    const body = response.body as {
      kind: string;
      accepted: boolean;
      reason?: string;
      rejection?: {
        kind?: string;
        askedLabel?: string;
        detail?: string;
      };
    };
    expect(body.kind).toBe("rejected");
    expect(body.accepted).toBe(false);
    expect(body.reason).toBe("unknown_target");
    expect(body.rejection?.kind).toBe("unknown");
    expect(body.rejection?.askedLabel).toBe("@ranger");

    const snapshot = await getJson<{ flights: Record<string, unknown> }>(
      harness.baseUrl,
      "/v1/snapshot",
    );
    expect(Object.keys(snapshot.flights)).toHaveLength(0);
  }, 15_000);

  test("returns a broker question for last-seen-expired peer authority targets", async () => {
    const harness = await startBroker();
    const stalePeerNodeId = "mini-peer";

    await postJson(harness.baseUrl, "/v1/nodes", {
      id: stalePeerNodeId,
      meshId: "openscout",
      name: "Mini Peer",
      advertiseScope: "mesh",
      brokerUrl: "http://100.64.0.2:65535",
      registeredAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
      lastSeenAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    });

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "arach.mini",
      kind: "agent",
      definitionId: "arach",
      nodeQualifier: "mini",
      selector: "@arach.node:mini",
      defaultSelector: "@arach",
      displayName: "Arach",
      handle: "arach",
      labels: ["relay", "project", "agent", "local-agent"],
      metadata: {
        projectRoot: "/Users/arach",
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: stalePeerNodeId,
      authorityNodeId: stalePeerNodeId,
      advertiseScope: "local",
    });

    const response = await requestJson(harness.baseUrl, "/v1/deliver", {
      method: "POST",
      body: JSON.stringify({
        id: "deliver-test-stale-peer",
        requesterId: "codex",
        requesterNodeId: harness.nodeId,
        targetLabel: "@arach",
        body: "@arach local status update",
        intent: "tell",
        createdAt: Date.now(),
      }),
    });

    expect(response.status).toBe(409);
    const body = response.body as {
      kind: string;
      accepted: boolean;
      question?: {
        kind: string;
        askedLabel: string;
        target?: {
          agentId: string;
          reason: string;
          detail: string;
        };
      };
    };
    expect(body.kind).toBe("question");
    expect(body.accepted).toBe(false);
    expect(body.question?.kind).toBe("unavailable");
    expect(body.question?.askedLabel).toBe("@arach");
    expect(body.question?.target?.agentId).toBe("arach.mini");
    expect(body.question?.target?.reason).toBe("unknown");
    expect(body.question?.target?.detail).toContain("peer has not been seen recently");

    const snapshot = await getJson<{ flights: Record<string, unknown> }>(
      harness.baseUrl,
      "/v1/snapshot",
    );
    expect(Object.keys(snapshot.flights)).toHaveLength(0);
  }, 15_000);

  test("rejects unknown delivery targets explicitly", async () => {
    const harness = await startBroker();

    const response = await requestJson(harness.baseUrl, "/v1/deliver", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        id: "deliver-test-unknown",
        requesterId: "operator",
        requesterNodeId: harness.nodeId,
        targetLabel: "@mars",
        body: "@mars finish the job",
        intent: "consult",
        createdAt: Date.now(),
      }),
    });

    expect(response.status).toBe(422);
    const body = response.body as {
      kind: string;
      accepted: boolean;
      reason?: string;
      rejection?: {
        kind: string;
        askedLabel: string;
        detail: string;
      };
    };
    expect(body.kind).toBe("rejected");
    expect(body.accepted).toBe(false);
    expect(body.reason).toBe("unknown_target");
    expect(body.rejection?.kind).toBe("unknown");
    expect(body.rejection?.askedLabel).toBe("@mars");
    expect(body.rejection?.detail).toContain("@mars");
  }, 15_000);

  test("attaches and detaches pairing sessions as Scout-managed fleet identities", async () => {
    const pairing = startPairingBridgeServer({
      sessions: [
        {
          id: "session-newell-1",
          name: "Majestic Newell",
          adapterType: "codex",
          status: "active",
          cwd: "/tmp/majestic",
          model: "gpt-5.4",
        },
      ],
    });
    const home = configurePairingHome(pairing.port);
    const harness = await startBroker({
      env: {
        HOME: home,
      },
    });

    const browse = await getJson<Array<{
      externalSessionId: string;
      suggestedSelector: string;
    }>>(harness.baseUrl, "/v1/pairing/sessions");
    expect(browse).toHaveLength(1);
    expect(browse[0]?.externalSessionId).toBe("session-newell-1");

    const attached = await postJson<{
      ok: boolean;
      agentId: string;
      selector: string;
      endpointId: string;
    }>(harness.baseUrl, "/v1/pairing/attach", {
      externalSessionId: "session-newell-1",
      alias: "@newell",
      displayName: "Newell",
    });
    expect(attached.ok).toBe(true);
    expect(attached.selector).toBe("@newell");

    const attachedSnapshot = await getJson<{
      agents: Record<string, {
        id: string;
        displayName: string;
        selector?: string;
        metadata?: Record<string, unknown>;
      }>;
      endpoints: Record<string, {
        id: string;
        state: string;
        sessionId?: string;
        metadata?: Record<string, unknown>;
      }>;
    }>(harness.baseUrl, "/v1/snapshot");

    expect(attachedSnapshot.agents[attached.agentId]?.displayName).toBe("Newell");
    expect(attachedSnapshot.agents[attached.agentId]?.selector).toBe("@newell");
    expect(attachedSnapshot.agents[attached.agentId]?.metadata?.source).toBe("scout-managed");
    expect(attachedSnapshot.endpoints[attached.endpointId]?.sessionId).toBe("session-newell-1");
    expect(attachedSnapshot.endpoints[attached.endpointId]?.metadata?.managedByScout).toBe(true);

    const detached = await postJson<{
      ok: boolean;
      agentId: string;
      endpointId: string;
      detached: boolean;
    }>(harness.baseUrl, "/v1/pairing/detach", {
      agentId: attached.agentId,
    });
    expect(detached.ok).toBe(true);
    expect(detached.detached).toBe(true);

    const detachedSnapshot = await getJson<{
      agents: Record<string, {
        id: string;
        selector?: string;
      }>;
      endpoints: Record<string, {
        id: string;
        state: string;
        sessionId?: string;
      }>;
    }>(harness.baseUrl, "/v1/snapshot");

    expect(detachedSnapshot.agents[attached.agentId]?.selector).toBe("@newell");
    expect(detachedSnapshot.endpoints[attached.endpointId]?.state).toBe("offline");
    expect(detachedSnapshot.endpoints[attached.endpointId]?.sessionId).toBeUndefined();
  }, 15_000);

  test("attaches Codex local sessions as bridge-backed managed identities", async () => {
    const pairing = startPairingBridgeServer({
      sessions: [],
    });
    const home = configurePairingHome(pairing.port);
    const harness = await startBroker({
      env: {
        HOME: home,
      },
    });

    const attached = await postJson<{
      ok: boolean;
      agentId: string;
      selector: string;
      endpointId: string;
      sessionId: string;
    }>(harness.baseUrl, "/v1/local-sessions/attach", {
      externalSessionId: "019d9762-19f7-7792-8962-90d924ce7faa",
      transport: "codex_app_server",
      cwd: "/tmp/codex-here",
      alias: "@codex-here",
      displayName: "Codex Here",
    });

    expect(attached.ok).toBe(true);
    expect(attached.selector).toBe("@codex-here");
    expect(attached.sessionId).toBe("pairing-019d9762");

    const snapshot = await getJson<{
      agents: Record<string, {
        id: string;
        displayName: string;
        selector?: string;
        metadata?: Record<string, unknown>;
      }>;
      endpoints: Record<string, {
        id: string;
        transport: string;
        state: string;
        sessionId?: string;
        metadata?: Record<string, unknown>;
      }>;
    }>(harness.baseUrl, "/v1/snapshot");

    expect(snapshot.agents[attached.agentId]?.displayName).toBe("Codex Here");
    expect(snapshot.agents[attached.agentId]?.selector).toBe("@codex-here");
    expect(snapshot.agents[attached.agentId]?.metadata?.externalSource).toBe("local-session");
    expect(snapshot.endpoints[attached.endpointId]?.transport).toBe("pairing_bridge");
    expect(snapshot.endpoints[attached.endpointId]?.sessionId).toBe("pairing-019d9762");
    expect(snapshot.endpoints[attached.endpointId]?.metadata?.source).toBe("local-session");
    expect(snapshot.endpoints[attached.endpointId]?.metadata?.externalSessionId).toBe("019d9762-19f7-7792-8962-90d924ce7faa");
    expect(snapshot.endpoints[attached.endpointId]?.metadata?.pairingSessionId).toBe("pairing-019d9762");
    expect(snapshot.endpoints[attached.endpointId]?.metadata?.threadId).toBe("019d9762-19f7-7792-8962-90d924ce7faa");
  }, 15_000);

  test("persists valid collaboration records and emits collaboration events", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    const now = Date.now();
    const response = await postJson<{ ok: boolean; recordId: string }>(
      harness.baseUrl,
      "/v1/collaboration/records",
      {
        id: "work-test-1",
        kind: "work_item",
        state: "working",
        acceptanceState: "none",
        title: "Investigate relay drift",
        summary: "Check runtime and relay state alignment.",
        createdById: "operator",
        ownerId: "fabric",
        nextMoveOwnerId: "fabric",
        conversationId: "channel.shared",
        createdAt: now,
        updatedAt: now,
      },
    );

    expect(response.ok).toBe(true);
    expect(response.recordId).toBe("work-test-1");

    const snapshot = await getJson<{
      collaborationRecords: Record<string, { id: string; ownerId?: string; nextMoveOwnerId?: string; state: string }>;
    }>(harness.baseUrl, "/v1/snapshot");

    expect(snapshot.collaborationRecords["work-test-1"]).toBeDefined();
    expect(snapshot.collaborationRecords["work-test-1"]?.ownerId).toBe("fabric");
    expect(snapshot.collaborationRecords["work-test-1"]?.nextMoveOwnerId).toBe("fabric");
    expect(snapshot.collaborationRecords["work-test-1"]?.state).toBe("working");

    const events = await getJson<Array<{ kind: string; payload: { record?: { id: string } } }>>(
      harness.baseUrl,
      "/v1/events?limit=20",
    );

    expect(events.some((event) => event.kind === "collaboration.upserted" && event.payload.record?.id === "work-test-1")).toBe(true);
  }, 15_000);

  test("rejects invalid waiting work items without required ownership metadata", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    const response = await fetch(`${harness.baseUrl}/v1/collaboration/records`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        id: "work-invalid-1",
        kind: "work_item",
        state: "waiting",
        acceptanceState: "none",
        title: "Wait for review",
        createdById: "operator",
        ownerId: "fabric",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json() as { detail: string };
    expect(payload.detail).toContain("nextMoveOwnerId");
    expect(payload.detail).toContain("waitingOn");
  }, 15_000);

  test("rejects collaboration events that do not match the target record kind", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    const now = Date.now();
    await postJson(harness.baseUrl, "/v1/collaboration/records", {
      id: "question-test-1",
      kind: "question",
      state: "open",
      acceptanceState: "none",
      title: "Who owns the next change?",
      createdById: "operator",
      nextMoveOwnerId: "fabric",
      askedById: "operator",
      askedOfId: "fabric",
      conversationId: "channel.shared",
      createdAt: now,
      updatedAt: now,
    });

    const response = await fetch(`${harness.baseUrl}/v1/collaboration/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        id: "evt-question-invalid-1",
        recordId: "question-test-1",
        recordKind: "question",
        kind: "review_requested",
        actorId: "fabric",
        at: Date.now(),
      }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json() as { detail: string };
    expect(payload.detail).toContain("review_requested");
  }, 15_000);

  test("builds collaboration-aware invocations from the broker wake endpoint", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    const now = Date.now();
    await postJson(harness.baseUrl, "/v1/collaboration/records", {
      id: "work-wake-1",
      kind: "work_item",
      state: "waiting",
      acceptanceState: "none",
      title: "Resolve review dependency",
      summary: "Fabric needs to answer the outstanding review request.",
      createdById: "operator",
      ownerId: "fabric",
      nextMoveOwnerId: "fabric",
      requestedById: "operator",
      waitingOn: {
        kind: "actor",
        label: "review response",
        targetId: "fabric",
      },
      conversationId: "channel.shared",
      createdAt: now,
      updatedAt: now,
    });

    const response = await postJson<{
      ok: boolean;
      recordId: string;
      targetAgentId: string;
      wakeReason: string;
      invocation: {
        targetAgentId: string;
        context?: {
          collaboration?: {
            recordId?: string;
            nextMoveOwnerId?: string;
            wakeReason?: string;
            waitingOn?: { targetId?: string };
          };
        };
        metadata?: {
          collaborationRecordId?: string;
          wakeReason?: string;
        };
      };
      flight: {
        targetAgentId: string;
        state: string;
      };
    }>(harness.baseUrl, "/v1/collaboration/records/work-wake-1/invoke", {
      requesterId: "operator",
    });

    expect(response.ok).toBe(true);
    expect(response.recordId).toBe("work-wake-1");
    expect(response.targetAgentId).toBe("fabric");
    expect(response.wakeReason).toBe("next_move_owner");
    expect(response.invocation.targetAgentId).toBe("fabric");
    expect(response.invocation.context?.collaboration?.recordId).toBe("work-wake-1");
    expect(response.invocation.context?.collaboration?.nextMoveOwnerId).toBe("fabric");
    expect(response.invocation.context?.collaboration?.wakeReason).toBe("next_move_owner");
    expect(response.invocation.context?.collaboration?.waitingOn?.targetId).toBe("fabric");
    expect(response.invocation.metadata?.collaborationRecordId).toBe("work-wake-1");
    expect(response.invocation.metadata?.wakeReason).toBe("next_move_owner");
    expect(response.flight.targetAgentId).toBe("fabric");
    expect(response.flight.state).toBe("waking");
  }, 15_000);

  test("reconciles stale running flights when the endpoint has already moved on", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const firstHarness = await startBroker({ controlHome });
    await seedBasicConversation(firstHarness);

    await postJson(firstHarness.baseUrl, "/v1/agents", {
      id: "arc",
      kind: "agent",
      definitionId: "arc",
      displayName: "Arc",
      handle: "arc",
      labels: ["test"],
      selector: "@arc",
      defaultSelector: "@arc",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "on_demand",
      homeNodeId: firstHarness.nodeId,
      authorityNodeId: firstHarness.nodeId,
      advertiseScope: "local",
    });

    const completedAt = Date.now();
    await postJson(firstHarness.baseUrl, "/v1/endpoints", {
      id: "endpoint-arc",
      agentId: "arc",
      nodeId: firstHarness.nodeId,
      harness: "claude",
      transport: "claude_stream_json",
      state: "idle",
      address: null,
      sessionId: "relay-arc",
      pane: null,
      cwd: "/tmp/arc",
      projectRoot: "/tmp/arc",
      metadata: {
        source: "test",
        lastCompletedAt: completedAt,
      },
    });

    const startedAt = completedAt - 60_000;

    firstHarness.child.kill();
    await firstHarness.child.exited.catch(() => {});
    harnesses.delete(firstHarness);

    appendFileSync(
      join(controlHome, "broker-journal.jsonl"),
      [
        JSON.stringify({
          kind: "invocation.record",
          invocation: {
            id: "inv-stale-arc",
            requesterId: "operator",
            requesterNodeId: firstHarness.nodeId,
            targetAgentId: "arc",
            action: "consult",
            task: "are you there?",
            conversationId: "channel.shared",
            ensureAwake: true,
            stream: false,
            createdAt: startedAt,
          },
        }),
        JSON.stringify({
          kind: "flight.record",
          flight: {
            id: "flt-stale-arc",
            invocationId: "inv-stale-arc",
            requesterId: "operator",
            targetAgentId: "arc",
            state: "running",
            summary: "Arc is working.",
            startedAt,
          },
        }),
      ].join("\n") + "\n",
    );

    const secondHarness = await startBroker({ controlHome });
    const snapshot = await waitFor(async () => getJson<{
      flights: Record<string, { state: string; error?: string; completedAt?: number }>;
    }>(secondHarness.baseUrl, "/v1/snapshot"), (next) => next.flights["flt-stale-arc"]?.state === "failed");
    const flight = snapshot.flights["flt-stale-arc"];

    expect(flight).toBeDefined();
    expect(flight?.state).toBe("failed");
    expect(flight?.error).toContain("Stale running flight reconciled");
    expect(typeof flight?.completedAt).toBe("number");
  }, 15_000);

  test("does not reconcile a running flight from a dispatched endpoint because a sibling endpoint went offline", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const firstHarness = await startBroker({ controlHome });
    await seedBasicConversation(firstHarness);

    await postJson(firstHarness.baseUrl, "/v1/agents", {
      id: "arc",
      kind: "agent",
      definitionId: "arc",
      displayName: "Arc",
      handle: "arc",
      labels: ["test"],
      selector: "@arc",
      defaultSelector: "@arc",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "on_demand",
      homeNodeId: firstHarness.nodeId,
      authorityNodeId: firstHarness.nodeId,
      advertiseScope: "local",
    });

    const startedAt = Date.now() - 60_000;
    const failedAt = startedAt + 1_000;
    await postJson(firstHarness.baseUrl, "/v1/endpoints", {
      id: "endpoint-arc-claude",
      agentId: "arc",
      nodeId: firstHarness.nodeId,
      harness: "claude",
      transport: "claude_stream_json",
      state: "idle",
      address: null,
      sessionId: "relay-arc-claude",
      pane: null,
      cwd: "/tmp/arc",
      projectRoot: "/tmp/arc",
      metadata: { source: "test" },
    });
    await postJson(firstHarness.baseUrl, "/v1/endpoints", {
      id: "endpoint-arc-codex",
      agentId: "arc",
      nodeId: firstHarness.nodeId,
      harness: "codex",
      transport: "codex_app_server",
      state: "offline",
      address: null,
      sessionId: "relay-arc-codex",
      pane: null,
      cwd: "/tmp/arc",
      projectRoot: "/tmp/arc",
      metadata: {
        source: "test",
        lastError: "codex_app_server session unavailable: relay-arc-codex",
        lastFailedAt: failedAt,
      },
    });

    firstHarness.child.kill();
    await firstHarness.child.exited.catch(() => {});
    harnesses.delete(firstHarness);

    appendFileSync(
      join(controlHome, "broker-journal.jsonl"),
      [
        JSON.stringify({
          kind: "invocation.record",
          invocation: {
            id: "inv-arc-claude",
            requesterId: "operator",
            requesterNodeId: firstHarness.nodeId,
            targetAgentId: "arc",
            action: "consult",
            task: "are you there?",
            conversationId: "channel.shared",
            ensureAwake: true,
            stream: false,
            createdAt: startedAt,
          },
        }),
        JSON.stringify({
          kind: "flight.record",
          flight: {
            id: "flt-arc-claude",
            invocationId: "inv-arc-claude",
            requesterId: "operator",
            targetAgentId: "arc",
            state: "running",
            summary: "Arc acknowledged via spawn.",
            startedAt,
            metadata: {
              dispatchAck: {
                strategy: "spawn",
                endpointId: "endpoint-arc-claude",
                transport: "claude_stream_json",
                harness: "claude",
                sessionId: "relay-arc-claude",
                nodeId: firstHarness.nodeId,
                acknowledgedAt: startedAt + 100,
              },
            },
          },
        }),
      ].join("\n") + "\n",
    );

    const secondHarness = await startBroker({ controlHome });
    await Bun.sleep(300);
    const snapshot = await getJson<{
      flights: Record<string, { state: string; error?: string; completedAt?: number }>;
    }>(secondHarness.baseUrl, "/v1/snapshot");
    const flight = snapshot.flights["flt-arc-claude"];

    expect(flight).toBeDefined();
    expect(flight?.state).toBe("running");
    expect(flight?.error).toBeUndefined();
    expect(flight?.completedAt).toBeUndefined();
  }, 15_000);

  test("fails invocations targeting stale local endpoints instead of leaving them queued", async () => {
    const harness = await startBroker({
      env: {
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
      },
    });
    const staleAt = Date.now() - 5_000;

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "ranger.main.test-node",
      kind: "agent",
      definitionId: "ranger",
      displayName: "Ranger",
      handle: "ranger",
      labels: ["relay", "project", "agent", "local-agent"],
      selector: "@ranger.main.node:test-node",
      defaultSelector: "@ranger",
      metadata: {
        source: "relay-agent-registry",
        projectRoot: "/tmp/ranger",
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });
    await postJson(harness.baseUrl, "/v1/endpoints", {
      id: "endpoint-ranger-main",
      agentId: "ranger.main.test-node",
      nodeId: harness.nodeId,
      harness: "claude",
      transport: "claude_stream_json",
      state: "offline",
      address: null,
      sessionId: "relay-ranger-claude",
      pane: null,
      cwd: "/tmp/ranger",
      projectRoot: "/tmp/ranger",
      metadata: {
        source: "relay-agent-registry",
        staleLocalRegistration: true,
        staleAt,
        replacedByAgentId: "ranger.feature.test-node",
        lastError: "superseded local agent registration replaced by current setup",
        lastFailedAt: staleAt,
      },
    });

    const accepted = await postJson<{
      accepted: boolean;
      flightId: string;
      targetAgentId: string;
    }>(harness.baseUrl, "/v1/invocations", {
      id: "inv-ranger-stale",
      requesterId: "operator",
      requesterNodeId: harness.nodeId,
      targetAgentId: "ranger.main.test-node",
      action: "consult",
      task: "wake up",
      execution: {
        session: "existing",
        targetSessionId: "relay-ranger-claude",
      },
      ensureAwake: true,
      stream: false,
      createdAt: Date.now(),
    });

    expect(accepted.accepted).toBe(true);
    expect(accepted.targetAgentId).toBe("ranger.main.test-node");

    const snapshot = await waitFor(
      () => getJson<{
        flights: Record<string, { state: string; error?: string; metadata?: Record<string, unknown> }>;
      }>(harness.baseUrl, "/v1/snapshot"),
      (value) => value.flights[accepted.flightId]?.state === "failed",
    );
    const flight = snapshot.flights[accepted.flightId];
    if (typeof flight?.error === "string") {
      expect(flight.error).toContain("superseded local registration replaced by current setup");
      expect(flight.error).toContain("replacement agent is ranger.feature.test-node");
    }
    if (flight?.metadata?.failureStage !== undefined) {
      expect(flight.metadata.failureStage).toBe("endpoint_resolution");
    }
  }, 15_000);

  test("reconciles queued flights that already target stale local endpoints", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const firstHarness = await startBroker({
      controlHome,
      env: {
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
      },
    });
    const staleAt = Date.now() - 5_000;
    const startedAt = staleAt + 1_000;

    await postJson(firstHarness.baseUrl, "/v1/agents", {
      id: "ranger.main.test-node",
      kind: "agent",
      definitionId: "ranger",
      displayName: "Ranger",
      handle: "ranger",
      labels: ["relay", "project", "agent", "local-agent"],
      selector: "@ranger.main.node:test-node",
      defaultSelector: "@ranger",
      metadata: {
        source: "relay-agent-registry",
        projectRoot: "/tmp/ranger",
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: firstHarness.nodeId,
      authorityNodeId: firstHarness.nodeId,
      advertiseScope: "local",
    });
    await postJson(firstHarness.baseUrl, "/v1/endpoints", {
      id: "endpoint-ranger-main",
      agentId: "ranger.main.test-node",
      nodeId: firstHarness.nodeId,
      harness: "claude",
      transport: "claude_stream_json",
      state: "offline",
      address: null,
      sessionId: "relay-ranger-claude",
      pane: null,
      cwd: "/tmp/ranger",
      projectRoot: "/tmp/ranger",
      metadata: {
        source: "relay-agent-registry",
        staleLocalRegistration: true,
        staleAt,
        replacedByAgentId: "ranger.feature.test-node",
        lastError: "superseded local agent registration replaced by current setup",
        lastFailedAt: staleAt,
      },
    });

    firstHarness.child.kill();
    await firstHarness.child.exited.catch(() => {});
    harnesses.delete(firstHarness);

    appendFileSync(
      join(controlHome, "broker-journal.jsonl"),
      [
        JSON.stringify({
          kind: "invocation.record",
          invocation: {
            id: "inv-ranger-already-queued",
            requesterId: "operator",
            requesterNodeId: firstHarness.nodeId,
            targetAgentId: "ranger.main.test-node",
            action: "consult",
            task: "wake up",
            execution: {
              session: "existing",
              targetSessionId: "relay-ranger-claude",
            },
            ensureAwake: true,
            stream: false,
            createdAt: startedAt,
          },
        }),
        JSON.stringify({
          kind: "flight.record",
          flight: {
            id: "flt-ranger-already-queued",
            invocationId: "inv-ranger-already-queued",
            requesterId: "operator",
            targetAgentId: "ranger.main.test-node",
            state: "queued",
            summary: "Message stored for Ranger. Will deliver when online.",
            startedAt,
          },
        }),
      ].join("\n") + "\n",
    );

    const secondHarness = await startBroker({
      controlHome,
      env: {
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
      },
    });

    const snapshot = await waitFor(
      () => getJson<{
        flights: Record<string, { state: string; error?: string; metadata?: Record<string, unknown> }>;
      }>(secondHarness.baseUrl, "/v1/snapshot"),
      (value) => value.flights["flt-ranger-already-queued"]?.state === "failed",
    );
    const flight = snapshot.flights["flt-ranger-already-queued"];
    expect(flight?.error).toContain("superseded local registration replaced by current setup");
    expect(flight?.metadata?.reconciledStaleFlight).toBe(true);
  }, 15_000);

  test("reconciles pending message deliveries that target stale local endpoints", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const firstHarness = await startBroker({
      controlHome,
      env: {
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
      },
    });
    const staleAt = Date.now() - 5_000;
    const messageCreatedAt = staleAt + 1_000;

    await postJson(firstHarness.baseUrl, "/v1/actors", {
      id: "operator",
      kind: "person",
      displayName: "Operator",
      handle: "operator",
      labels: ["test"],
      metadata: { source: "test" },
    });
    await postJson(firstHarness.baseUrl, "/v1/agents", {
      id: "ranger.main.test-node",
      kind: "agent",
      definitionId: "ranger",
      displayName: "Ranger",
      handle: "ranger",
      labels: ["relay", "project", "agent", "local-agent"],
      selector: "@ranger.main.node:test-node",
      defaultSelector: "@ranger",
      metadata: {
        source: "relay-agent-registry",
        projectRoot: "/tmp/ranger",
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: firstHarness.nodeId,
      authorityNodeId: firstHarness.nodeId,
      advertiseScope: "local",
    });
    await postJson(firstHarness.baseUrl, "/v1/endpoints", {
      id: "endpoint-ranger-main",
      agentId: "ranger.main.test-node",
      nodeId: firstHarness.nodeId,
      harness: "claude",
      transport: "claude_stream_json",
      state: "offline",
      address: null,
      sessionId: "relay-ranger-claude",
      pane: null,
      cwd: "/tmp/ranger",
      projectRoot: "/tmp/ranger",
      metadata: {
        source: "relay-agent-registry",
        staleLocalRegistration: true,
        staleAt,
        replacedByAgentId: "ranger.feature.test-node",
        lastError: "superseded local agent registration replaced by current setup",
        lastFailedAt: staleAt,
      },
    });
    await postJson(firstHarness.baseUrl, "/v1/conversations", {
      id: "dm.operator.ranger.main.test-node",
      kind: "direct",
      title: "Ranger",
      visibility: "private",
      shareMode: "local",
      authorityNodeId: firstHarness.nodeId,
      participantIds: ["operator", "ranger.main.test-node"],
      metadata: { surface: "test" },
    });

    firstHarness.child.kill();
    await firstHarness.child.exited.catch(() => {});
    harnesses.delete(firstHarness);

    appendFileSync(
      join(controlHome, "broker-journal.jsonl"),
      [
        JSON.stringify({
          kind: "message.record",
          message: {
            id: "msg-ranger-stale-delivery",
            conversationId: "dm.operator.ranger.main.test-node",
            actorId: "operator",
            originNodeId: firstHarness.nodeId,
            class: "agent",
            body: "wake up",
            audience: {
              notify: ["ranger.main.test-node"],
              reason: "direct_message",
            },
            visibility: "private",
            policy: "durable",
            createdAt: messageCreatedAt,
          },
        }),
        JSON.stringify({
          kind: "deliveries.record",
          deliveries: [
            {
              id: "del-msg-ranger-stale-delivery-ranger.main.test-node-direct_message-claude_stream_json",
              messageId: "msg-ranger-stale-delivery",
              targetId: "ranger.main.test-node",
              targetNodeId: firstHarness.nodeId,
              targetKind: "agent",
              transport: "claude_stream_json",
              reason: "direct_message",
              policy: "durable",
              status: "pending",
            },
          ],
        }),
      ].join("\n") + "\n",
    );

    const secondHarness = await startBroker({
      controlHome,
      env: {
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
      },
    });

    const deliveries = await waitFor(
      () => getJson<Array<{ status: string; metadata?: Record<string, unknown> }>>(
        secondHarness.baseUrl,
        "/v1/deliveries?messageId=msg-ranger-stale-delivery&targetId=ranger.main.test-node",
      ),
      (value) => value[0]?.status === "failed",
    );
    expect(deliveries[0]?.metadata?.failureReason).toBe("agent_offline");
    expect(deliveries[0]?.metadata?.reconciledStaleDelivery).toBe(true);
    expect(deliveries[0]?.metadata?.reconciledReason).toContain("replacement agent is ranger.feature.test-node");
  }, 15_000);

  test("reconciles replayed active endpoints for the same invocation after restart", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const firstHarness = await startBroker({ controlHome });
    await seedBasicConversation(firstHarness);

    await postJson(firstHarness.baseUrl, "/v1/agents", {
      id: "arc",
      kind: "agent",
      definitionId: "arc",
      displayName: "Arc",
      handle: "arc",
      labels: ["test"],
      selector: "@arc",
      defaultSelector: "@arc",
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "on_demand",
      homeNodeId: firstHarness.nodeId,
      authorityNodeId: firstHarness.nodeId,
      advertiseScope: "local",
    });

    const startedAt = Date.now() - 60_000;
    await postJson(firstHarness.baseUrl, "/v1/endpoints", {
      id: "endpoint-arc",
      agentId: "arc",
      nodeId: firstHarness.nodeId,
      harness: "claude",
      transport: "claude_stream_json",
      state: "active",
      address: null,
      sessionId: "relay-arc",
      pane: null,
      cwd: "/tmp/arc",
      projectRoot: "/tmp/arc",
      metadata: {
        source: "test",
        lastInvocationId: "inv-same-arc",
        lastStartedAt: startedAt + 1_000,
      },
    });

    firstHarness.child.kill();
    await firstHarness.child.exited.catch(() => {});
    harnesses.delete(firstHarness);

    appendFileSync(
      join(controlHome, "broker-journal.jsonl"),
      [
        JSON.stringify({
          kind: "invocation.record",
          invocation: {
            id: "inv-same-arc",
            requesterId: "operator",
            requesterNodeId: firstHarness.nodeId,
            targetAgentId: "arc",
            action: "consult",
            task: "still there?",
            conversationId: "channel.shared",
            ensureAwake: true,
            stream: false,
            createdAt: startedAt,
          },
        }),
        JSON.stringify({
          kind: "flight.record",
          flight: {
            id: "flt-same-arc",
            invocationId: "inv-same-arc",
            requesterId: "operator",
            targetAgentId: "arc",
            state: "running",
            summary: "Arc is working.",
            startedAt,
          },
        }),
      ].join("\n") + "\n",
    );

    const secondHarness = await startBroker({ controlHome });
    await waitFor(async () => getJson<{
      flights: Record<string, { state: string }>;
    }>(secondHarness.baseUrl, "/v1/snapshot"), (next) => Boolean(next.flights["flt-same-arc"]));
    const snapshot = await waitFor(async () => getJson<{
      flights: Record<string, { state: string; error?: string; completedAt?: number }>;
    }>(secondHarness.baseUrl, "/v1/snapshot"), (next) => next.flights["flt-same-arc"]?.state === "failed");

    expect(snapshot.flights["flt-same-arc"]?.state).toBe("failed");
    expect(snapshot.flights["flt-same-arc"]?.error).toContain("without a live broker task");
    expect(typeof snapshot.flights["flt-same-arc"]?.completedAt).toBe("number");
  }, 15_000);

  test("rebuilds the sqlite projection from the file journal after degraded writes", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const degradedHarness = await startBroker({
      controlHome,
      env: {
        OPENSCOUT_DISABLE_SQLITE: "1",
      },
    });
    await seedBasicConversation(degradedHarness);

    await postJson(degradedHarness.baseUrl, "/v1/messages", {
      id: "msg-journal-replay-1",
      conversationId: "channel.shared",
      actorId: "operator",
      originNodeId: degradedHarness.nodeId,
      class: "agent",
      body: "@fabric recover projection",
      mentions: [{ actorId: "fabric", label: "@fabric" }],
      audience: {
        notify: ["fabric"],
      },
      visibility: "workspace",
      policy: "durable",
      createdAt: Date.now(),
    });

    degradedHarness.child.kill();
    await degradedHarness.child.exited.catch(() => {});
    harnesses.delete(degradedHarness);

    const recoveredHarness = await startBroker({ controlHome });
    const activity = await waitFor(
      async () => getJson<Array<{ messageId?: string }>>(recoveredHarness.baseUrl, "/v1/activity?limit=20"),
      (items) => items.some((item) => item.messageId === "msg-journal-replay-1"),
    );

    expect(activity.some((item) => item.messageId === "msg-journal-replay-1")).toBe(true);
  }, 15_000);

  test("skips redundant durable agent upserts", async () => {
    const harness = await startBroker();

    const agent = {
      id: "agent-dedupe",
      kind: "agent" as const,
      definitionId: "agent-dedupe",
      displayName: "Agent Dedupe",
      handle: "agent-dedupe",
      agentClass: "builder" as const,
      capabilities: ["chat"] as const,
      wakePolicy: "on_demand" as const,
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local" as const,
      metadata: {
        workspace: "/tmp/agent-dedupe",
      },
    };

    await postJson(harness.baseUrl, "/v1/agents", agent);
    await postJson(harness.baseUrl, "/v1/agents", agent);

    const lines = readFileSync(join(harness.controlHome, "broker-journal.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { kind: string; actor?: { id?: string }; agent?: { id?: string } });

    expect(lines.filter((entry) => entry.kind === "actor.upsert" && entry.actor?.id === agent.id)).toHaveLength(1);
    expect(lines.filter((entry) => entry.kind === "agent.upsert" && entry.agent?.id === agent.id)).toHaveLength(1);
  }, 15_000);

  test("routes ambiguous invocations through scout dispatch and posts a scout message", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    const baseAgent = {
      kind: "agent" as const,
      definitionId: "scoutie",
      displayName: "Scoutie",
      labels: ["test"],
      selector: "@scoutie",
      defaultSelector: "@scoutie",
      agentClass: "general" as const,
      capabilities: ["chat", "invoke"] as const,
      wakePolicy: "on_demand" as const,
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local" as const,
    };

    await postJson(harness.baseUrl, "/v1/agents", {
      ...baseAgent,
      id: "scoutie.mini.main",
      handle: "scoutie.mini.main",
      metadata: {
        definitionId: "scoutie",
        workspaceQualifier: "main",
        nodeQualifier: "mini",
      },
    });

    await postJson(harness.baseUrl, "/v1/agents", {
      ...baseAgent,
      id: "scoutie.main.mini",
      handle: "scoutie.main.mini",
      metadata: {
        definitionId: "scoutie",
        workspaceQualifier: "main",
        nodeQualifier: "mini",
      },
    });

    const response = await postJson<{
      accepted: boolean;
      invocationId: string;
      dispatch?: {
        id: string;
        kind: string;
        askedLabel: string;
        candidates: Array<{ agentId: string }>;
      };
    }>(harness.baseUrl, "/v1/invocations", {
      id: "inv-scout-1",
      requesterId: "operator",
      requesterNodeId: harness.nodeId,
      targetAgentId: "scoutie",
      targetLabel: "@scoutie",
      action: "consult",
      task: "who are you?",
      conversationId: "channel.shared",
      ensureAwake: true,
      stream: false,
      createdAt: Date.now(),
    });

    expect(response.accepted).toBe(true);
    expect(response.dispatch?.kind).toBe("ambiguous");
    expect(response.dispatch?.askedLabel).toBe("@scoutie");
    expect(response.dispatch?.candidates.map((candidate) => candidate.agentId).sort()).toEqual([
      "scoutie.main.mini",
      "scoutie.mini.main",
    ]);

    const journal = readFileSync(join(harness.controlHome, "broker-journal.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as {
        kind: string;
        dispatch?: { id: string; kind: string; askedLabel: string };
        message?: { actorId: string; class: string; metadata?: { scoutDispatch?: { id: string } } };
      });

    const dispatchEntries = journal.filter((entry) => entry.kind === "scout.dispatch.record");
    expect(dispatchEntries).toHaveLength(1);
    expect(dispatchEntries[0].dispatch?.kind).toBe("ambiguous");
    expect(dispatchEntries[0].dispatch?.askedLabel).toBe("@scoutie");

    const scoutMessages = journal.filter(
      (entry) => entry.kind === "message.record" && entry.message?.actorId === "scout",
    );
    expect(scoutMessages).toHaveLength(1);
    expect(scoutMessages[0].message?.class).toBe("system");
    expect(scoutMessages[0].message?.metadata?.scoutDispatch?.id).toBe(dispatchEntries[0].dispatch?.id);
  }, 15_000);

  test("emits scout dispatch without a message when the invocation carries no conversation", async () => {
    const harness = await startBroker();

    const response = await postJson<{ accepted: boolean; dispatch?: { kind: string } }>(
      harness.baseUrl,
      "/v1/invocations",
      {
        id: "inv-scout-2",
        requesterId: "operator",
        requesterNodeId: harness.nodeId,
        targetAgentId: "@ghost-target",
        targetLabel: "@ghost-target",
        action: "consult",
        task: "knock knock",
        ensureAwake: true,
        stream: false,
        createdAt: Date.now(),
      },
    );

    expect(response.accepted).toBe(true);
    expect(response.dispatch?.kind).toBe("unknown");

    const journal = readFileSync(join(harness.controlHome, "broker-journal.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as {
        kind: string;
        message?: { actorId: string };
      });

    const dispatchEntries = journal.filter((entry) => entry.kind === "scout.dispatch.record");
    expect(dispatchEntries).toHaveLength(1);

    const scoutMessages = journal.filter(
      (entry) => entry.kind === "message.record" && entry.message?.actorId === "scout",
    );
    expect(scoutMessages).toHaveLength(0);
  }, 15_000);
});
