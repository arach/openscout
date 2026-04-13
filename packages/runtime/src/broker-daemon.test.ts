import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_BROKER_HOST, buildDefaultBrokerUrl } from "./broker-service";

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

async function startBroker(input: {
  controlHome?: string;
  env?: Record<string, string | undefined>;
} = {}): Promise<BrokerHarness> {
  const controlHome = input.controlHome ?? mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
  const port = 38000 + Math.floor(Math.random() * 2000);
  const baseUrl = buildDefaultBrokerUrl(DEFAULT_BROKER_HOST, port);
  const child = Bun.spawn({
    cmd: ["bun", "run", "src/broker-daemon.ts"],
    cwd: runtimeDir,
    env: {
      ...process.env,
      OPENSCOUT_CONTROL_HOME: controlHome,
      OPENSCOUT_BROKER_HOST: DEFAULT_BROKER_HOST,
      OPENSCOUT_BROKER_PORT: String(port),
      OPENSCOUT_BROKER_URL: baseUrl,
      OPENSCOUT_MESH_DISCOVERY_INTERVAL_MS: "0",
      OPENSCOUT_PARENT_PID: "0",
      ...input.env,
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
    expect(response.flight.state).toBe("waking");
    expect(response.flight.error).toBeUndefined();

    const events = await getJson<Array<{ kind: string; payload: { invocation?: { id: string }; flight?: { targetAgentId: string; state: string } } }>>(
      harness.baseUrl,
      "/v1/events?limit=20",
    );

    expect(events.some((event) => event.kind === "invocation.requested" && event.payload.invocation?.id === "inv-test-1")).toBe(true);
    expect(
      events.some((event) => event.kind === "flight.updated" && event.payload.flight?.targetAgentId === "ghost" && event.payload.flight?.state === "waking"),
    ).toBe(true);
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
});
