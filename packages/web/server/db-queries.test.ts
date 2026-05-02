import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeDb,
  queryActivity,
  queryAgents,
  queryFleet,
  queryFollowTarget,
  queryFlights,
  queryHeartrate,
  queryMobileAgents,
  queryMobileAgentDetail,
  queryRecentMessages,
  querySessions,
  querySessionById,
  queryWorkItemById,
  queryWorkItems,
} from "./db-queries.ts";
import { SQLiteControlPlaneStore } from "../../runtime/src/sqlite-store.ts";

const tempRoots = new Set<string>();
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const originalOperatorName = process.env.OPENSCOUT_OPERATOR_NAME;

afterEach(() => {
  closeDb();
  if (originalControlHome === undefined) {
    delete process.env.OPENSCOUT_CONTROL_HOME;
  } else {
    process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
  }
  if (originalOperatorName === undefined) {
    delete process.env.OPENSCOUT_OPERATOR_NAME;
  } else {
    process.env.OPENSCOUT_OPERATOR_NAME = originalOperatorName;
  }

  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

function createSeededStore(): SQLiteControlPlaneStore {
  const root = mkdtempSync(join(tmpdir(), "openscout-web-db-queries-"));
  tempRoots.add(root);
  process.env.OPENSCOUT_CONTROL_HOME = root;
  const store = new SQLiteControlPlaneStore(join(root, "control-plane.sqlite"));

  store.upsertNode({
    id: "node-1",
    meshId: "mesh-1",
    name: "Test node",
    advertiseScope: "local",
    registeredAt: Date.now(),
  });
  store.upsertActor({
    id: "operator",
    kind: "person",
    displayName: "Operator",
  });
  store.upsertActor({
    id: "agent-1",
    kind: "agent",
    displayName: "Agent One",
  });
  store.upsertAgent({
    id: "agent-1",
    kind: "agent",
    definitionId: "agent-1",
    displayName: "Agent One",
    agentClass: "general",
    capabilities: ["chat"],
    wakePolicy: "on_demand",
    homeNodeId: "node-1",
    authorityNodeId: "node-1",
    advertiseScope: "local",
  });
  store.upsertConversation({
    id: "conv-1",
    kind: "direct",
    title: "Direct",
    visibility: "private",
    shareMode: "local",
    authorityNodeId: "node-1",
    participantIds: ["agent-1", "operator"],
  });
  store.recordCollaborationRecord({
    id: "work-1",
    kind: "work_item",
    title: "Observed work",
    createdById: "operator",
    ownerId: "agent-1",
    nextMoveOwnerId: "agent-1",
    conversationId: "conv-1",
    state: "working",
    acceptanceState: "none",
    requestedById: "operator",
    createdAt: 90,
    updatedAt: 90,
  });
  store.recordCollaborationRecord({
    id: "work-1-child",
    kind: "work_item",
    title: "Child work",
    createdById: "operator",
    ownerId: "agent-1",
    nextMoveOwnerId: "agent-1",
    parentId: "work-1",
    conversationId: "conv-1",
    state: "open",
    acceptanceState: "none",
    requestedById: "agent-1",
    createdAt: 95,
    updatedAt: 95,
  });
  store.recordCollaborationEvent({
    id: "event-1",
    recordId: "work-1",
    recordKind: "work_item",
    kind: "claimed",
    actorId: "agent-1",
    summary: "Claimed for implementation",
    at: 110,
  });
  store.recordInvocation({
    id: "inv-1",
    requesterId: "operator",
    requesterNodeId: "node-1",
    targetAgentId: "agent-1",
    action: "consult",
    task: "Do the work",
    collaborationRecordId: "work-1",
    conversationId: "conv-1",
    ensureAwake: true,
    stream: false,
    createdAt: 100,
  });
  store.recordFlight({
    id: "flight-1",
    invocationId: "inv-1",
    requesterId: "operator",
    targetAgentId: "agent-1",
    state: "running",
    summary: "In progress",
    startedAt: 101,
  });

  return store;
}

describe("web db query flights", () => {
  test("surfaces durable collaboration joins from invocations", () => {
    const store = createSeededStore();

    try {
      const flights = queryFlights({ conversationId: "conv-1", collaborationRecordId: "work-1" });

      expect(flights).toEqual([
        {
          id: "flight-1",
          invocationId: "inv-1",
          agentId: "agent-1",
          agentName: "Agent One",
          conversationId: "conv-1",
          collaborationRecordId: "work-1",
          state: "running",
          summary: "In progress",
          startedAt: 101,
          completedAt: null,
        },
      ]);
    } finally {
      store.close();
    }
  });

  test("resolves follow context from a flight id", () => {
    const store = createSeededStore();

    try {
      store.upsertEndpoint({
        id: "agent-1-endpoint",
        agentId: "agent-1",
        nodeId: "node-1",
        harness: "codex",
        transport: "codex_app_server",
        state: "active",
        sessionId: "codex-thread-1",
        metadata: {
          threadId: "codex-thread-1",
        },
      });

      expect(queryFollowTarget({ flightId: "flight-1" })).toEqual({
        flightId: "flight-1",
        invocationId: "inv-1",
        conversationId: "conv-1",
        workId: "work-1",
        sessionId: "codex-thread-1",
        targetAgentId: "agent-1",
      });
    } finally {
      store.close();
    }
  });
});

describe("web db query heartrate", () => {
  test("returns a smoothed trailing 7 day series across millisecond and second timestamps", () => {
    const store = createSeededStore();
    const now = 1_700_000_000_000;

    try {
      store.recordMessage({
        id: "msg-heartrate-1",
        conversationId: "conv-1",
        actorId: "agent-1",
        originNodeId: "node-1",
        class: "agent",
        body: "Six days ago.",
        visibility: "private",
        policy: "durable",
        createdAt: now - 6 * 24 * 60 * 60_000,
      });
      store.recordMessage({
        id: "msg-heartrate-2",
        conversationId: "conv-1",
        actorId: "operator",
        originNodeId: "node-1",
        class: "operator",
        body: "Yesterday.",
        visibility: "private",
        policy: "durable",
        createdAt: now - 24 * 60 * 60_000,
      });
      store.recordFlight({
        id: "flight-heartrate-seconds",
        invocationId: "inv-1",
        requesterId: "operator",
        targetAgentId: "agent-1",
        state: "completed",
        summary: "Seconds timestamp activity.",
        startedAt: Math.floor((now - 90 * 60_000) / 1000),
        completedAt: Math.floor((now - 30 * 60_000) / 1000),
      });

      const heartrate = queryHeartrate(56, now);
      const filledIndexes = heartrate.buckets
        .map((bucket, index) => bucket.count > 0 ? index : -1)
        .filter((index) => index >= 0);

      expect(heartrate.windowLabel).toBe("trailing 7d");
      expect(heartrate.bucketLabel).toBe("3h buckets");
      expect(heartrate.buckets).toHaveLength(56);
      expect(heartrate.buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(3);
      expect(filledIndexes.length).toBe(3);

      const firstFilled = filledIndexes[0] ?? -1;
      expect(heartrate.buckets[firstFilled].value).toBeGreaterThan(0);
      expect(heartrate.buckets[firstFilled + 1].value).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });
});

describe("web db query agents", () => {
  test("returns one row per agent using the latest endpoint and normalized state", () => {
    const store = createSeededStore();

    try {
      store.upsertEndpoint({
        id: "agent-1-old",
        agentId: "agent-1",
        nodeId: "node-1",
        harness: "claude",
        transport: "claude_stream_json",
        state: "offline",
        projectRoot: "/tmp/agent-1-old",
      });
      store.upsertEndpoint({
        id: "agent-1-new",
        agentId: "agent-1",
        nodeId: "node-1",
        harness: "codex",
        transport: "codex_app_server",
        state: "idle",
        projectRoot: "/tmp/agent-1-new",
      });

      store.upsertActor({
        id: "agent-2",
        kind: "agent",
        displayName: "Agent Two",
      });
      store.upsertAgent({
        id: "agent-2",
        kind: "agent",
        definitionId: "agent-2",
        displayName: "Agent Two",
        agentClass: "general",
        capabilities: ["chat"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });
      store.upsertEndpoint({
        id: "agent-2-old",
        agentId: "agent-2",
        nodeId: "node-1",
        harness: "claude",
        transport: "claude_stream_json",
        state: "offline",
        projectRoot: "/tmp/agent-2-old",
      });
      store.upsertEndpoint({
        id: "agent-2-new",
        agentId: "agent-2",
        nodeId: "node-1",
        harness: "codex",
        transport: "codex_app_server",
        state: "idle",
        projectRoot: "/tmp/agent-2-new",
      });

      const rawDb = new Database(join(process.env.OPENSCOUT_CONTROL_HOME!, "control-plane.sqlite"));
      try {
        const setUpdatedAt = rawDb.query("UPDATE agent_endpoints SET updated_at = ?1 WHERE id = ?2");
        setUpdatedAt.run(5, "agent-1-old");
        setUpdatedAt.run(20, "agent-1-new");
        setUpdatedAt.run(10, "agent-2-old");
        setUpdatedAt.run(30, "agent-2-new");
      } finally {
        rawDb.close();
      }

      const agents = queryAgents(10);

      expect(agents).toHaveLength(2);
      expect(agents.map((agent) => agent.id)).toEqual(["agent-2", "agent-1"]);
      expect(agents.map((agent) => agent.harness)).toEqual(["codex", "codex"]);
      expect(agents.map((agent) => agent.transport)).toEqual(["codex_app_server", "codex_app_server"]);
      expect(agents.map((agent) => agent.state)).toEqual(["available", "working"]);
      expect(agents.map((agent) => agent.projectRoot)).toEqual(["/tmp/agent-2-new", "/tmp/agent-1-new"]);
      expect(agents.map((agent) => agent.updatedAt)).toEqual([30_000, 20_000]);
      expect(agents.map((agent) => agent.conversationId)).toEqual(["dm.operator.agent-2", "dm.operator.agent-1"]);
    } finally {
      store.close();
    }
  });

  test("synthesizes a direct session for an agent even before the first message", () => {
    const store = createSeededStore();

    try {
      const session = querySessionById("dm.operator.agent-1");

      expect(session).toEqual({
        id: "dm.operator.agent-1",
        kind: "direct",
        title: "Agent One",
        participantIds: ["operator", "agent-1"],
        agentId: "agent-1",
        agentName: "Agent One",
        harness: null,
        harnessSessionId: null,
        harnessLogPath: null,
        currentBranch: null,
        preview: null,
        messageCount: 0,
        lastMessageAt: null,
        workspaceRoot: null,
      });
    } finally {
      store.close();
    }
  });

  test("resolves a target agent for direct sessions with two agent participants", () => {
    const store = createSeededStore();

    try {
      store.upsertActor({
        id: "scout.main.mini",
        kind: "agent",
        displayName: "Scout",
      });
      store.upsertAgent({
        id: "scout.main.mini",
        kind: "agent",
        definitionId: "scout.main.mini",
        displayName: "Scout",
        agentClass: "relay",
        capabilities: ["chat"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });
      store.upsertActor({
        id: "local-session-agent-test",
        kind: "agent",
        displayName: "Codex 023e",
      });
      store.upsertAgent({
        id: "local-session-agent-test",
        kind: "agent",
        definitionId: "local-session-agent-test",
        displayName: "Codex 023e",
        agentClass: "relay",
        capabilities: ["chat"],
        wakePolicy: "manual",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });
      store.upsertEndpoint({
        id: "local-session-agent-test-endpoint",
        agentId: "local-session-agent-test",
        nodeId: "node-1",
        harness: "codex",
        transport: "codex_app_server",
        state: "idle",
        projectRoot: "/tmp/openscout",
      });
      store.upsertConversation({
        id: "dm.local-session-agent-test.scout.main.mini",
        kind: "direct",
        title: "Scout <> Codex 023e",
        visibility: "private",
        shareMode: "local",
        authorityNodeId: "node-1",
        participantIds: ["local-session-agent-test", "scout.main.mini"],
      });

      const session = querySessionById("dm.local-session-agent-test.scout.main.mini");

      expect(session?.agentId).toBe("local-session-agent-test");
      expect(session?.agentName).toBe("Codex 023e");
      expect(session?.harness).toBe("codex");
    } finally {
      store.close();
    }
  });

  test("collapses local-session DM forks to a single canonical thread id", () => {
    const store = createSeededStore();

    try {
      store.upsertActor({
        id: "scout.main.mini",
        kind: "agent",
        displayName: "Scout",
      });
      store.upsertAgent({
        id: "scout.main.mini",
        kind: "agent",
        definitionId: "scout.main.mini",
        displayName: "Scout",
        agentClass: "relay",
        capabilities: ["chat"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });
      store.upsertActor({
        id: "local-session-agent-test",
        kind: "agent",
        displayName: "Codex 023e",
      });
      store.upsertAgent({
        id: "local-session-agent-test",
        kind: "agent",
        definitionId: "local-session-agent-test",
        displayName: "Codex 023e",
        agentClass: "relay",
        capabilities: ["chat"],
        wakePolicy: "manual",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });
      store.upsertConversation({
        id: "dm.operator.local-session-agent-test",
        kind: "direct",
        title: "Codex 023e",
        visibility: "private",
        shareMode: "local",
        authorityNodeId: "node-1",
        participantIds: ["operator", "local-session-agent-test"],
      });
      store.upsertConversation({
        id: "dm.local-session-agent-test.scout.main.mini",
        kind: "direct",
        title: "Scout <> Codex 023e",
        visibility: "private",
        shareMode: "local",
        authorityNodeId: "node-1",
        participantIds: ["local-session-agent-test", "scout.main.mini"],
      });
      store.recordMessage({
        id: "legacy-msg",
        conversationId: "dm.local-session-agent-test.scout.main.mini",
        actorId: "scout.main.mini",
        originNodeId: "node-1",
        class: "agent",
        body: "legacy fork message",
        visibility: "private",
        policy: "durable",
        createdAt: 200,
      });
      store.recordMessage({
        id: "canonical-msg",
        conversationId: "dm.operator.local-session-agent-test",
        actorId: "local-session-agent-test",
        originNodeId: "node-1",
        class: "agent",
        body: "canonical thread message",
        visibility: "private",
        policy: "durable",
        createdAt: 100,
      });

      const sessions = querySessions(80).filter((entry) => entry.agentId === "local-session-agent-test");

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.id).toBe("dm.operator.local-session-agent-test");
    } finally {
      store.close();
    }
  });

  test("reads canonical DM history through legacy local-session fork aliases", () => {
    const store = createSeededStore();

    try {
      store.upsertActor({
        id: "scout.main.mini",
        kind: "agent",
        displayName: "Scout",
      });
      store.upsertActor({
        id: "local-session-agent-test",
        kind: "agent",
        displayName: "Codex 023e",
      });
      store.upsertAgent({
        id: "local-session-agent-test",
        kind: "agent",
        definitionId: "local-session-agent-test",
        displayName: "Codex 023e",
        agentClass: "relay",
        capabilities: ["chat"],
        wakePolicy: "manual",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });
      store.upsertConversation({
        id: "dm.local-session-agent-test.scout.main.mini",
        kind: "direct",
        title: "Scout <> Codex 023e",
        visibility: "private",
        shareMode: "local",
        authorityNodeId: "node-1",
        participantIds: ["local-session-agent-test", "scout.main.mini"],
      });
      store.recordMessage({
        id: "legacy-msg",
        conversationId: "dm.local-session-agent-test.scout.main.mini",
        actorId: "scout.main.mini",
        originNodeId: "node-1",
        class: "agent",
        body: "legacy alias message",
        visibility: "private",
        policy: "durable",
        createdAt: 200,
      });

      const messages = queryRecentMessages(20, {
        conversationId: "dm.operator.local-session-agent-test",
      });

      expect(messages.map((message) => message.body)).toContain("legacy alias message");
    } finally {
      store.close();
    }
  });

  test("surfaces harness session ids and log paths for bridge-backed local codex agents", () => {
    const store = createSeededStore();

    try {
      store.upsertEndpoint({
        id: "agent-1-bridge",
        agentId: "agent-1",
        nodeId: "node-1",
        harness: "codex",
        transport: "pairing_bridge",
        state: "idle",
        sessionId: "pairing-019d9762",
        projectRoot: "/tmp/agent-1-bridge",
        metadata: {
          attachedTransport: "codex_app_server",
          pairingAdapterType: "codex",
          pairingSessionId: "pairing-019d9762",
          threadId: "019d9762-19f7-7792-8962-90d924ce7faa",
          externalSessionId: "019d9762-19f7-7792-8962-90d924ce7faa",
        },
      });

      const agent = queryAgents(10).find((entry) => entry.id === "agent-1");

      expect(agent?.harnessSessionId).toBe("019d9762-19f7-7792-8962-90d924ce7faa");
      expect(agent?.harnessLogPath).toBe(
        join(homedir(), ".scout", "pairing", "codex", "pairing-019d9762", "logs", "stdout.log"),
      );
    } finally {
      store.close();
    }
  });

  test("surfaces harness session ids and log paths on session summaries", () => {
    const store = createSeededStore();

    try {
      store.upsertEndpoint({
        id: "agent-1-bridge",
        agentId: "agent-1",
        nodeId: "node-1",
        harness: "codex",
        transport: "pairing_bridge",
        state: "idle",
        sessionId: "pairing-019d9762",
        projectRoot: "/tmp/agent-1-bridge",
        metadata: {
          attachedTransport: "codex_app_server",
          pairingAdapterType: "codex",
          pairingSessionId: "pairing-019d9762",
          threadId: "019d9762-19f7-7792-8962-90d924ce7faa",
          externalSessionId: "019d9762-19f7-7792-8962-90d924ce7faa",
        },
      });

      const session = querySessions(10).find((entry) => entry.id === "conv-1");

      expect(session?.harnessSessionId).toBe("019d9762-19f7-7792-8962-90d924ce7faa");
      expect(session?.harnessLogPath).toBe(
        join(homedir(), ".scout", "pairing", "codex", "pairing-019d9762", "logs", "stdout.log"),
      );
    } finally {
      store.close();
    }
  });

  test("does not mark queued backlog as working when nothing is executing", () => {
    const store = createSeededStore();

    try {
      store.upsertActor({
        id: "agent-2",
        kind: "agent",
        displayName: "Agent Two",
      });
      store.upsertAgent({
        id: "agent-2",
        kind: "agent",
        definitionId: "agent-2",
        displayName: "Agent Two",
        agentClass: "general",
        capabilities: ["chat"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });
      store.upsertEndpoint({
        id: "endpoint-2",
        agentId: "agent-2",
        nodeId: "node-1",
        harness: "codex",
        transport: "codex_app_server",
        state: "idle",
        projectRoot: "/tmp/agent-2",
      });
      store.upsertConversation({
        id: "conv-2",
        kind: "direct",
        title: "Direct Two",
        visibility: "private",
        shareMode: "local",
        authorityNodeId: "node-1",
        participantIds: ["agent-2", "operator"],
      });
      store.recordInvocation({
        id: "inv-2",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "agent-2",
        action: "consult",
        task: "Check later",
        conversationId: "conv-2",
        ensureAwake: true,
        stream: false,
        createdAt: 200,
      });
      store.recordFlight({
        id: "flight-2",
        invocationId: "inv-2",
        requesterId: "operator",
        targetAgentId: "agent-2",
        state: "queued",
        summary: "Queued for later delivery",
        startedAt: 201,
      });

      const listEntry = queryAgents(10).find((entry) => entry.id === "agent-2");
      const detail = queryMobileAgentDetail("agent-2");

      expect(listEntry?.state).toBe("available");
      expect(detail?.state).toBe("available");
      expect(detail?.activeFlights.map((flight) => flight.state)).toEqual(["queued"]);
    } finally {
      store.close();
    }
  });

  test("shows wake-on-demand agents as available even after their session drops", () => {
    const store = createSeededStore();

    try {
      store.upsertActor({
        id: "ranger.main.mini",
        kind: "agent",
        displayName: "Ranger",
      });
      store.upsertAgent({
        id: "ranger.main.mini",
        kind: "agent",
        definitionId: "ranger",
        displayName: "Ranger",
        agentClass: "general",
        capabilities: ["chat", "invoke", "deliver"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });
      store.upsertEndpoint({
        id: "endpoint-ranger",
        agentId: "ranger.main.mini",
        nodeId: "node-1",
        harness: "codex",
        transport: "codex_app_server",
        state: "offline",
        projectRoot: "/tmp/openscout",
        metadata: {
          lastError: "codex_app_server session unavailable: relay-ranger-codex",
        },
      });

      const listEntry = queryAgents(20).find((entry) => entry.id === "ranger.main.mini");
      const mobileEntry = queryMobileAgents(20).find((entry) => entry.id === "ranger.main.mini");
      const detail = queryMobileAgentDetail("ranger.main.mini");

      expect(listEntry?.state).toBe("available");
      expect(mobileEntry?.state).toBe("available");
      expect(detail?.state).toBe("available");
    } finally {
      store.close();
    }
  });

  test("does not surface stale wake-on-demand local agents as available choices", () => {
    const store = createSeededStore();

    try {
      store.upsertActor({
        id: "ranger.old-branch.mini",
        kind: "agent",
        displayName: "Ranger",
      });
      store.upsertAgent({
        id: "ranger.old-branch.mini",
        kind: "agent",
        definitionId: "ranger",
        displayName: "Ranger",
        agentClass: "general",
        capabilities: ["chat", "invoke", "deliver"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
        metadata: {
          staleLocalRegistration: true,
          replacedByAgentId: "ranger.current-branch.mini",
        },
      });
      store.upsertEndpoint({
        id: "endpoint-ranger-old",
        agentId: "ranger.old-branch.mini",
        nodeId: "node-1",
        harness: "codex",
        transport: "codex_app_server",
        state: "offline",
        projectRoot: "/tmp/openscout",
        metadata: {
          staleLocalRegistration: true,
          replacedByAgentId: "ranger.current-branch.mini",
        },
      });

      expect(queryAgents(20).some((entry) => entry.id === "ranger.old-branch.mini")).toBe(false);
      expect(queryMobileAgents(20).some((entry) => entry.id === "ranger.old-branch.mini")).toBe(false);
      expect(queryMobileAgentDetail("ranger.old-branch.mini")).toBeNull();
    } finally {
      store.close();
    }
  });

  test("reads direct messages across operator identity aliases", () => {
    const store = createSeededStore();
    process.env.OPENSCOUT_OPERATOR_NAME = "arach";

    try {
      store.upsertActor({
        id: "arach",
        kind: "person",
        displayName: "Arach",
      });
      store.upsertConversation({
        id: "dm.arach.agent-1",
        kind: "direct",
        title: "Agent One",
        visibility: "private",
        shareMode: "local",
        authorityNodeId: "node-1",
        participantIds: ["agent-1", "arach"],
      });
      store.recordMessage({
        id: "msg-arach",
        conversationId: "dm.arach.agent-1",
        actorId: "arach",
        originNodeId: "node-1",
        class: "agent",
        body: "Alias-visible message",
        visibility: "private",
        policy: "durable",
        createdAt: 300,
      });

      const messages = queryRecentMessages(10, {
        conversationId: "dm.operator.agent-1",
      });

      expect(messages.map((message) => message.id)).toContain("msg-arach");
    } finally {
      store.close();
    }
  });

  test("filters duplicate replies and stale-flight reconciliation from top activity", () => {
    const store = createSeededStore();

    try {
      store.recordMessage({
        id: "msg-operator",
        conversationId: "conv-1",
        actorId: "operator",
        originNodeId: "node-1",
        class: "agent",
        body: "Please check this",
        visibility: "private",
        policy: "durable",
        createdAt: 150,
      });
      store.recordMessage({
        id: "msg-reply",
        conversationId: "conv-1",
        actorId: "agent-1",
        originNodeId: "node-1",
        class: "agent",
        body: "Done.",
        replyToMessageId: "msg-operator",
        visibility: "private",
        policy: "durable",
        createdAt: 160,
      });
      store.recordFlight({
        id: "flight-stale",
        invocationId: "inv-1",
        requesterId: "operator",
        targetAgentId: "agent-1",
        state: "failed",
        summary: "Agent One did not finish cleanly.",
        error: "Stale running flight reconciled: endpoint endpoint-1 moved to offline",
        startedAt: 155,
        completedAt: 170,
      });
      store.recordInvocation({
        id: "inv-dup-1",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "agent-1",
        action: "consult",
        task: "Reply once",
        conversationId: "conv-1",
        ensureAwake: true,
        stream: false,
        createdAt: 171,
      });
      store.recordFlight({
        id: "flight-dup-1",
        invocationId: "inv-dup-1",
        requesterId: "operator",
        targetAgentId: "agent-1",
        state: "completed",
        summary: "Agent One replied.",
        startedAt: 172,
        completedAt: 180,
      });
      store.recordInvocation({
        id: "inv-dup-2",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "agent-1",
        action: "consult",
        task: "Reply twice",
        conversationId: "conv-1",
        ensureAwake: true,
        stream: false,
        createdAt: 173,
      });
      store.recordFlight({
        id: "flight-dup-2",
        invocationId: "inv-dup-2",
        requesterId: "operator",
        targetAgentId: "agent-1",
        state: "completed",
        summary: "Agent One replied.",
        startedAt: 174,
        completedAt: 181,
      });

      const activity = queryActivity(20);

      expect(activity.some((item) => item.id === "activity:message:msg-reply")).toBe(false);
      expect(activity.some((item) => item.id === "activity:flight:flight-stale")).toBe(false);
      expect(activity.some((item) => item.id === "activity:message:msg-operator")).toBe(true);
      expect(activity.some((item) => item.id === "activity:flight:flight-1")).toBe(true);
      expect(activity.filter((item) => item.title === "Agent One replied." && item.kind === "flight_updated")).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});

describe("web db query fleet", () => {
  test("focuses on active asks, recent completions, and attention owned by the operator", () => {
    const store = createSeededStore();
    const now = Date.now();
    const old = now - (5 * 24 * 60 * 60 * 1000);

    try {
      store.upsertActor({
        id: "agent-2",
        kind: "agent",
        displayName: "Agent Two",
      });
      store.upsertAgent({
        id: "agent-2",
        kind: "agent",
        definitionId: "agent-2",
        displayName: "Agent Two",
        agentClass: "general",
        capabilities: ["chat"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });
      store.upsertConversation({
        id: "conv-2",
        kind: "direct",
        title: "Direct Two",
        visibility: "private",
        shareMode: "local",
        authorityNodeId: "node-1",
        participantIds: ["agent-2", "operator"],
      });
      store.recordInvocation({
        id: "inv-2",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "agent-2",
        action: "consult",
        task: "Old completed ask",
        conversationId: "conv-2",
        ensureAwake: true,
        stream: false,
        createdAt: old,
      });
      store.recordFlight({
        id: "flight-2",
        invocationId: "inv-2",
        requesterId: "operator",
        targetAgentId: "agent-2",
        state: "completed",
        summary: "Agent Two replied.",
        startedAt: old + 1_000,
        completedAt: old + 2_000,
      });
      store.recordMessage({
        id: "msg-2",
        conversationId: "conv-2",
        actorId: "agent-2",
        originNodeId: "node-1",
        class: "agent",
        body: "Old done.",
        visibility: "private",
        policy: "durable",
        createdAt: old + 3_000,
      });

      store.upsertActor({
        id: "agent-3",
        kind: "agent",
        displayName: "Agent Three",
      });
      store.upsertAgent({
        id: "agent-3",
        kind: "agent",
        definitionId: "agent-3",
        displayName: "Agent Three",
        agentClass: "general",
        capabilities: ["chat"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });
      store.upsertEndpoint({
        id: "endpoint-3",
        agentId: "agent-3",
        nodeId: "node-1",
        harness: "codex",
        transport: "codex_app_server",
        state: "idle",
        sessionId: "session-3",
        cwd: join(tmpdir(), "openscout-agent-3", "cwd"),
        projectRoot: join(tmpdir(), "openscout-agent-3"),
      });
      store.upsertConversation({
        id: "conv-3",
        kind: "direct",
        title: "Direct Three",
        visibility: "private",
        shareMode: "local",
        authorityNodeId: "node-1",
        participantIds: ["agent-3", "operator"],
      });
      store.recordInvocation({
        id: "inv-3",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "agent-3",
        action: "consult",
        task: "Recent completed ask",
        conversationId: "conv-3",
        ensureAwake: true,
        stream: false,
        createdAt: now - 60_000,
      });
      store.recordFlight({
        id: "flight-3",
        invocationId: "inv-3",
        requesterId: "operator",
        targetAgentId: "agent-3",
        state: "completed",
        summary: "Agent Three replied.",
        startedAt: now - 59_000,
        completedAt: now - 30_000,
      });
      store.recordMessage({
        id: "msg-3",
        conversationId: "conv-3",
        actorId: "agent-3",
        originNodeId: "node-1",
        class: "agent",
        body: "Done.",
        visibility: "private",
        policy: "durable",
        createdAt: now - 29_000,
      });
      store.recordCollaborationRecord({
        id: "question-1",
        kind: "question",
        title: "Need your decision",
        summary: "Should I ship this as-is?",
        createdById: "agent-3",
        ownerId: "agent-3",
        nextMoveOwnerId: "operator",
        conversationId: "conv-3",
        state: "open",
        acceptanceState: "none",
        askedById: "agent-3",
        askedOfId: "operator",
        createdAt: now - 20_000,
        updatedAt: now - 10_000,
      });
      store.recordCollaborationRecord({
        id: "work-pending-resolved",
        kind: "work_item",
        title: "Pending work with a later owner action",
        summary: "The owner replied after the pending handoff.",
        createdById: "operator",
        ownerId: "agent-3",
        nextMoveOwnerId: "agent-3",
        conversationId: "conv-3",
        state: "open",
        acceptanceState: "pending",
        requestedById: "operator",
        createdAt: now - 26_000,
        updatedAt: now - 25_000,
      });
      store.recordMessage({
        id: "msg-3-pending-resolution",
        conversationId: "conv-3",
        actorId: "agent-3",
        originNodeId: "node-1",
        class: "agent",
        body: "I picked this up in the thread.",
        visibility: "private",
        policy: "durable",
        createdAt: now - 24_000,
      });
      store.recordCollaborationRecord({
        id: "work-pending-unresolved",
        kind: "work_item",
        title: "Pending work without a later owner action",
        summary: "This still needs an acceptance decision.",
        createdById: "operator",
        ownerId: "agent-3",
        nextMoveOwnerId: "agent-3",
        conversationId: "conv-3",
        state: "open",
        acceptanceState: "pending",
        requestedById: "operator",
        createdAt: now - 6_000,
        updatedAt: now - 5_000,
      });
      store.upsertActor({
        id: "agent-4",
        kind: "agent",
        displayName: "Agent Four",
      });
      store.upsertAgent({
        id: "agent-4",
        kind: "agent",
        definitionId: "agent-4",
        displayName: "Agent Four",
        agentClass: "general",
        capabilities: ["chat"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
      });
      store.upsertConversation({
        id: "conv-4",
        kind: "direct",
        title: "Direct Four",
        visibility: "private",
        shareMode: "local",
        authorityNodeId: "node-1",
        participantIds: ["agent-4", "operator"],
      });
      store.recordInvocation({
        id: "inv-4",
        requesterId: "operator",
        requesterNodeId: "node-1",
        targetAgentId: "agent-4",
        action: "consult",
        task: "Synthetic stale failure",
        conversationId: "conv-4",
        ensureAwake: true,
        stream: false,
        createdAt: now - 45_000,
      });
      store.recordFlight({
        id: "flight-4",
        invocationId: "inv-4",
        requesterId: "operator",
        targetAgentId: "agent-4",
        state: "failed",
        summary: "Agent Four did not finish cleanly.",
        error: "Stale running flight reconciled: endpoint endpoint-4 started newer work at 1234567890",
        startedAt: now - 44_000,
        completedAt: now - 43_000,
      });

      const fleet = queryFleet({ limit: 10, activityLimit: 20 });

      expect(fleet.totals).toMatchObject({
        active: 1,
        recentCompleted: 1,
        needsAttention: 2,
      });

      expect(fleet.activeAsks).toHaveLength(1);
      expect(fleet.activeAsks[0]).toMatchObject({
        agentId: "agent-1",
        status: "working",
        agentState: "working",
      });

      expect(fleet.recentCompleted).toHaveLength(1);
      expect(fleet.recentCompleted[0]).toMatchObject({
        agentId: "agent-3",
        status: "completed",
        agentState: "available",
      });

      expect(fleet.needsAttention).toEqual([
        expect.objectContaining({
          kind: "work_item",
          recordId: "work-pending-unresolved",
          title: "Pending work without a later owner action",
          agentId: "agent-3",
          agentName: "Agent Three",
          conversationId: "conv-3",
          state: "open",
          acceptanceState: "pending",
        }),
        expect.objectContaining({
          kind: "question",
          recordId: "question-1",
          title: "Need your decision",
          agentId: "agent-3",
          agentName: "Agent Three",
          conversationId: "conv-3",
          state: "open",
          acceptanceState: "none",
        }),
      ]);
      expect(fleet.needsAttention.some((item) => item.recordId === "work-pending-resolved")).toBe(false);
      expect(fleet.activity.map((item) => item.ts)).toEqual([...fleet.activity.map((item) => item.ts)].sort((a, b) => b - a));
      expect(fleet.recentCompleted.some((ask) => ask.agentId === "agent-4")).toBe(false);
      expect(fleet.activity.some((item) => item.id === "activity:flight:flight-4")).toBe(false);
    } finally {
      store.close();
    }
  });
});

describe("web db query work item by id", () => {
  test("returns detail with ordered timeline, child work, and active flights", () => {
    const store = createSeededStore();

    try {
      store.recordCollaborationEvent({
        id: "event-2",
        recordId: "work-1",
        recordKind: "work_item",
        kind: "progressed",
        actorId: "agent-1",
        summary: "Implemented first pass",
        at: 150,
      });
      const detail = queryWorkItemById("work-1");
      expect(detail).not.toBeNull();
      if (!detail) throw new Error("missing detail");

      expect(detail.id).toBe("work-1");
      expect(detail.title).toBe("Observed work");
      expect(detail.createdAt).toBe(90);
      expect(detail.updatedAt).toBe(90);
      expect(detail.parentId).toBeNull();
      expect(detail.childWork.map((c) => c.id)).toEqual(["work-1-child"]);
      expect(detail.activeFlights.map((f) => f.id)).toEqual(["flight-1"]);

      const descendingTimestamps = detail.timeline.map((item) => item.at);
      const sorted = [...descendingTimestamps].sort((a, b) => b - a);
      expect(descendingTimestamps).toEqual(sorted);

      const kinds = detail.timeline.map((item) => `${item.kind}:${item.id}`);
      expect(kinds).toContain("collaboration_event:event:event-1");
      expect(kinds).toContain("collaboration_event:event:event-2");
      expect(kinds).toContain("flight_started:flight:flight-1:started");
      expect(kinds.some((k) => k.startsWith("message:"))).toBe(false);
    } finally {
      store.close();
    }
  });

  test("returns null for unknown id", () => {
    const store = createSeededStore();
    try {
      expect(queryWorkItemById("does-not-exist")).toBeNull();
    } finally {
      store.close();
    }
  });
});

describe("web db query work items", () => {
  test("projects active work rows from collaboration and execution state", () => {
    const store = createSeededStore();

    try {
      const work = queryWorkItems({ agentId: "agent-1" });

      expect(work).toEqual([
        {
          id: "work-1",
          title: "Observed work",
          summary: null,
          ownerId: "agent-1",
          ownerName: "Agent One",
          nextMoveOwnerId: "agent-1",
          nextMoveOwnerName: "Agent One",
          conversationId: "conv-1",
          createdAt: 90,
          updatedAt: 90,
          parentId: null,
          parentTitle: null,
          state: "working",
          acceptanceState: "none",
          priority: null,
          currentPhase: "Working",
          attention: "silent",
          activeChildWorkCount: 1,
          activeFlightCount: 1,
          lastMeaningfulAt: 110,
          lastMeaningfulSummary: "Claimed for implementation",
        },
        {
          id: "work-1-child",
          title: "Child work",
          summary: null,
          ownerId: "agent-1",
          ownerName: "Agent One",
          nextMoveOwnerId: "agent-1",
          nextMoveOwnerName: "Agent One",
          conversationId: "conv-1",
          createdAt: 95,
          updatedAt: 95,
          parentId: "work-1",
          parentTitle: "Observed work",
          state: "open",
          acceptanceState: "none",
          priority: null,
          currentPhase: "Open",
          attention: "silent",
          activeChildWorkCount: 0,
          activeFlightCount: 0,
          lastMeaningfulAt: 95,
          lastMeaningfulSummary: "Child work",
        },
      ]);
    } finally {
      store.close();
    }
  });
});
