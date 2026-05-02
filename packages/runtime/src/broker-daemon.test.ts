import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { DEFAULT_BROKER_HOST, buildDefaultBrokerUrl } from "./broker-process-manager";

const runtimeDir = join(import.meta.dir, "..");

type BrokerHarness = {
  baseUrl: string;
  controlHome: string;
  nodeId: string;
  child: ReturnType<typeof Bun.spawn>;
  outputDrain: Promise<void>[];
};

const harnesses = new Set<BrokerHarness>();
const hangingServers = new Set<ReturnType<typeof Bun.serve>>();
const pairingHomes = new Set<string>();

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
  }, 15_000);

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
      conversation?: { id: string; kind: string };
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
      id: "channel.ops",
      kind: "channel",
      title: "ops",
      visibility: "workspace",
      shareMode: "local",
      authorityNodeId: harness.nodeId,
      participantIds: ["operator", "fabric", "offline"],
      metadata: { surface: "test" },
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
    expect(response.conversation?.id).toBe("channel.ops");
    expect(response.message?.conversationId).toBe("channel.ops");
    expect(response.message?.createdAt).toBeGreaterThan(0);
    expect(response.message?.audience?.reason).toBe("conversation_visibility");
    expect(response.message?.audience?.notify).toEqual(["fabric"]);
    expect(response.receipt?.requestId.startsWith("deliver-")).toBe(true);
    expect(response.receipt?.requesterId).toBe("operator");
    expect(response.receipt?.requesterNodeId).toBe(harness.nodeId);
    expect(response.receipt?.targetLabel).toBe("ops");
    expect(response.receipt?.conversationId).toBe("channel.ops");
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

  test("returns a broker question for stale direct targets", async () => {
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
    expect(body.question?.askedLabel).toBe("ranger.main.mini");
    expect(body.question?.target?.agentId).toBe("ranger.main.mini");
    expect(body.question?.target?.reason).toBe("stale_registration");
    expect(body.question?.target?.detail).toContain("stale registration");
  }, 15_000);

  test("routes stale direct targets to their current replacement", async () => {
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

    expect(response.status).toBe(202);
    const body = response.body as {
      kind: string;
      accepted: boolean;
      targetAgentId?: string;
      conversation?: { id: string };
      flight?: { targetAgentId?: string };
    };
    expect(body.kind).toBe("delivery");
    expect(body.accepted).toBe(true);
    expect(body.targetAgentId).toBe("ranger.codex-vox-getting-started.mini");
    expect(body.conversation?.id).toBe("dm.operator.ranger.codex-vox-getting-started.mini");
    expect(body.flight?.targetAgentId).toBe("ranger.codex-vox-getting-started.mini");
  }, 15_000);

  test("returns a broker question for stale label-only targets", async () => {
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
    expect(body.question?.askedLabel).toBe("@ranger");
    expect(body.question?.target?.agentId).toBe("ranger.main.mini");
    expect(body.question?.target?.reason).toBe("stale_registration");
    expect(body.question?.target?.detail).toContain("stale registration");
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

  test("does not treat the same invocation as newer work during stale reconciliation", async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 300));
    const snapshot = await getJson<{
      flights: Record<string, { state: string; error?: string }>;
    }>(secondHarness.baseUrl, "/v1/snapshot");

    expect(snapshot.flights["flt-same-arc"]?.state).toBe("running");
    expect(snapshot.flights["flt-same-arc"]?.error).toBeUndefined();
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
