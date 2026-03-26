import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runtimeDir = join(import.meta.dir, "..");

type BrokerHarness = {
  baseUrl: string;
  controlHome: string;
  nodeId: string;
  child: ReturnType<typeof Bun.spawn>;
};

const harnesses = new Set<BrokerHarness>();

afterEach(async () => {
  for (const harness of harnesses) {
    harness.child.kill();
    await harness.child.exited.catch(() => {});
    rmSync(harness.controlHome, { recursive: true, force: true });
  }
  harnesses.clear();
});

async function startBroker(): Promise<BrokerHarness> {
  const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
  const port = 38000 + Math.floor(Math.random() * 2000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = Bun.spawn({
    cmd: ["bun", "run", "src/broker-daemon.ts"],
    cwd: runtimeDir,
    env: {
      ...process.env,
      OPENSCOUT_CONTROL_HOME: controlHome,
      OPENSCOUT_BROKER_HOST: "127.0.0.1",
      OPENSCOUT_BROKER_PORT: String(port),
      OPENSCOUT_BROKER_URL: baseUrl,
      OPENSCOUT_MESH_DISCOVERY_INTERVAL_MS: "0",
      OPENSCOUT_PARENT_PID: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForHealth(baseUrl);
  const node = await getJson<{ id: string }>(baseUrl, "/v1/node");
  const harness = { baseUrl, controlHome, nodeId: node.id, child };
  harnesses.add(harness);
  return harness;
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
  });

  test("creates a flight for explicit invocations even when no endpoint is runnable", async () => {
    const harness = await startBroker();
    await seedBasicConversation(harness);

    await postJson(harness.baseUrl, "/v1/agents", {
      id: "ghost",
      kind: "agent",
      displayName: "Ghost",
      handle: "ghost",
      labels: ["test"],
      metadata: { source: "test" },
      agentClass: "general",
      capabilities: ["chat", "invoke"],
      wakePolicy: "on_demand",
      homeNodeId: harness.nodeId,
      authorityNodeId: harness.nodeId,
      advertiseScope: "local",
    });

    const response = await postJson<{
      ok: boolean;
      flight: { targetAgentId: string; state: string; error?: string };
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

    expect(response.ok).toBe(true);
    expect(response.flight.targetAgentId).toBe("ghost");
    expect(response.flight.state).toBe("failed");
    expect(response.flight.error).toContain("No runnable endpoint");

    const events = await getJson<Array<{ kind: string; payload: { invocation?: { id: string }; flight?: { targetAgentId: string; state: string } } }>>(
      harness.baseUrl,
      "/v1/events?limit=20",
    );

    expect(events.some((event) => event.kind === "invocation.requested" && event.payload.invocation?.id === "inv-test-1")).toBe(true);
    expect(
      events.some((event) => event.kind === "flight.updated" && event.payload.flight?.targetAgentId === "ghost" && event.payload.flight?.state === "failed"),
    ).toBe(true);
  });
});
