import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { namedChannelNaturalKey } from "@openscout/protocol";

import { createBrokerDaemonTestHarness } from "./test-helpers/broker-daemon-harness.test";

const broker = createBrokerDaemonTestHarness();

describe("broker daemon local agent routing", () => {
  test("starts a cardless project session when the project path has no registered participant", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const supportDirectory = join(controlHome, "support");
    const projectRoot = join(controlHome, "projects", "implicit-project");
    mkdirSync(projectRoot, { recursive: true });
    broker.writeRelayAgentRegistry(supportDirectory, {});

    const harness = await broker.startBroker({
      controlHome,
      env: {
        HOME: controlHome,
        OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory,
        OPENSCOUT_CORE_AGENTS: "",
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
        OPENSCOUT_NODE_QUALIFIER: "test-node",
      },
    });

    const response = await broker.postJson<{
      kind: string;
      accepted: boolean;
      targetAgentId?: string;
      receipt?: { targetAgentId?: string };
      flight?: { targetAgentId: string; state: string };
    }>(harness.baseUrl, "/v1/deliver", {
      id: "deliver-project-auto-card",
      caller: {
        actorId: "operator",
        nodeId: harness.nodeId,
      },
      target: {
        kind: "project_path",
        projectPath: "~/projects/implicit-project",
      },
      body: "Review this project without a pre-created card.",
      intent: "consult",
      ensureAwake: false,
      createdAt: Date.now(),
    });

    expect(response.kind).toBe("delivery");
    expect(response.accepted).toBe(true);
    expect(response.targetAgentId).toMatch(/^session-/);
    expect(response.receipt?.targetAgentId).toBe(response.targetAgentId);
    expect(response.flight?.targetAgentId).toBe(response.targetAgentId);
    expect(response.flight?.state).toBe("queued");

    const snapshot = await broker.getJson<{
      actors: Record<string, { kind: string; metadata?: Record<string, unknown> }>;
      agents: Record<string, unknown>;
      endpoints: Record<string, { agentId: string; projectRoot?: string; metadata?: Record<string, unknown> }>;
    }>(harness.baseUrl, "/v1/snapshot");
    expect(snapshot.actors[response.targetAgentId!]).toEqual(expect.objectContaining({
      kind: "session",
      metadata: expect.objectContaining({ cardless: true, projectRoot }),
    }));
    expect(snapshot.agents[response.targetAgentId!]).toBeUndefined();
    expect(Object.values(snapshot.endpoints)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: response.targetAgentId,
        projectRoot,
        metadata: expect.objectContaining({
          cardless: true,
          pendingExternalSession: true,
        }),
      }),
    ]));
  }, 15_000);

  test("starts a cardless project session instead of using a registered card when one-time was requested", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const supportDirectory = join(controlHome, "support");
    const projectRoot = join(controlHome, "projects", "fresh-route");
    mkdirSync(projectRoot, { recursive: true });
    broker.writeRelayAgentRegistry(supportDirectory, {
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

    const harness = await broker.startBroker({
      controlHome,
      env: {
        OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory,
        OPENSCOUT_CORE_AGENTS: "",
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
        OPENSCOUT_NODE_QUALIFIER: "test-node",
      },
    });

    const response = await broker.postJson<{
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
    expect(response.targetAgentId).toMatch(/^session-/);
    expect(response.receipt?.targetAgentId).toBe(response.targetAgentId);
    expect(response.flight?.targetAgentId).toBe(response.targetAgentId);
    expect(response.flight?.state).toBe("queued");

    const snapshot = await broker.getJson<{
      agents: Record<string, unknown>;
      endpoints: Record<string, { agentId: string; metadata?: Record<string, unknown> }>;
    }>(harness.baseUrl, "/v1/snapshot");
    expect(snapshot.agents[response.targetAgentId!]).toBeUndefined();
    expect(snapshot.agents["fresh-route.test-node"]).toBeDefined();
    expect(Object.values(snapshot.endpoints)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: response.targetAgentId,
        metadata: expect.objectContaining({ cardless: true }),
      }),
    ]));
  }, 15_000);

  test("starts a cardless project session when existing project cards are ambiguous", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const supportDirectory = join(controlHome, "support");
    const projectRoot = join(controlHome, "projects", "ambiguous-project");
    mkdirSync(projectRoot, { recursive: true });
    broker.writeRelayAgentRegistry(supportDirectory, {
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

    const harness = await broker.startBroker({
      controlHome,
      env: {
        OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory,
        OPENSCOUT_CORE_AGENTS: "",
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
        OPENSCOUT_NODE_QUALIFIER: "test-node",
      },
    });

    const response = await broker.postJson<{
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
    expect(response.targetAgentId).toMatch(/^session-/);
    expect(response.targetAgentId).not.toBe("ambiguous-one.test-node");
    expect(response.targetAgentId).not.toBe("ambiguous-two.test-node");
    expect(response.receipt?.targetAgentId).toBe(response.targetAgentId);
    expect(response.flight?.targetAgentId).toBe(response.targetAgentId);
    expect(response.flight?.state).toBe("queued");

    const snapshot = await broker.getJson<{
      agents: Record<string, unknown>;
      endpoints: Record<string, { agentId: string; metadata?: Record<string, unknown> }>;
    }>(harness.baseUrl, "/v1/snapshot");
    expect(snapshot.agents[response.targetAgentId!]).toBeUndefined();
    expect(snapshot.agents["ambiguous-one.test-node"]).toBeDefined();
    expect(snapshot.agents["ambiguous-two.test-node"]).toBeDefined();
    expect(Object.values(snapshot.endpoints)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: response.targetAgentId,
        metadata: expect.objectContaining({ cardless: true }),
      }),
    ]));
  }, 15_000);

  test("refreshes registered local agents before resolving broker-owned delivery", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const supportDirectory = join(controlHome, "support");
    const projectRoot = join(controlHome, "projects", "openscout");
    mkdirSync(projectRoot, { recursive: true });
    broker.writeRelayAgentRegistry(supportDirectory, {});

    const harness = await broker.startBroker({
      controlHome,
      env: {
        OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory,
        OPENSCOUT_CORE_AGENTS: "",
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
        OPENSCOUT_NODE_QUALIFIER: "test-node",
      },
    });

    broker.writeRelayAgentRegistry(supportDirectory, {
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

    const response = await broker.postJson<{
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
    broker.writeRelayAgentRegistry(supportDirectory, {
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

    const harness = await broker.startBroker({
      controlHome,
      env: {
        OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory,
        OPENSCOUT_CORE_AGENTS: "",
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
        OPENSCOUT_NODE_QUALIFIER: "test-node",
      },
    });

    const response = await broker.postJson<{
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

    const snapshot = await broker.getJson<{
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
    broker.writeRelayAgentRegistry(supportDirectory, {});

    const harness = await broker.startBroker({
      controlHome,
      env: {
        OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory,
        OPENSCOUT_CORE_AGENTS: "",
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
        OPENSCOUT_NODE_QUALIFIER: "test-node",
      },
    });

    await broker.postJson(harness.baseUrl, "/v1/deliver", {
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

    await broker.postJson(harness.baseUrl, "/v1/agents", {
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

    const accepted = await broker.postJson<{
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
    await broker.waitFor(
      () => broker.getJson<{ flights: Record<string, { state: string }> }>(harness.baseUrl, "/v1/snapshot"),
      (snapshot) => snapshot.flights[flightId]?.state === "queued",
    );

    broker.writeRelayAgentRegistry(supportDirectory, {
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

    await broker.postJson(harness.baseUrl, "/v1/deliver", {
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

    const reconciled = await broker.waitFor(
      () => broker.getJson<{
        agents: Record<string, { metadata?: Record<string, unknown> }>;
        endpoints: Record<string, { agentId: string; metadata?: Record<string, unknown> }>;
        flights: Record<string, { state: string; error?: string; metadata?: Record<string, unknown> }>;
      }>(harness.baseUrl, "/v1/snapshot"),
      (snapshot) => Boolean(
        snapshot.agents["ranger.test-node"]
        && snapshot.flights[flightId]?.state === "queued",
      ),
      { attempts: 120 },
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
    broker.writeRelayAgentRegistry(supportDirectory, {});

    const harness = await broker.startBroker({
      controlHome,
      env: {
        OPENSCOUT_SUPPORT_DIRECTORY: supportDirectory,
        OPENSCOUT_CORE_AGENTS: "",
        OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0",
        OPENSCOUT_NODE_QUALIFIER: "test-node",
      },
    });

    await broker.postJson(harness.baseUrl, "/v1/agents", {
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
    await broker.postJson(harness.baseUrl, "/v1/endpoints", {
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
    broker.writeRelayAgentRegistry(supportDirectory, {});
    await broker.postJson(harness.baseUrl, "/v1/deliver", {
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

    const snapshot = await broker.waitFor(
      () => broker.getJson<{
        agents: Record<string, { metadata?: Record<string, unknown> }>;
        endpoints: Record<string, { state?: string; metadata?: Record<string, unknown> }>;
      }>(harness.baseUrl, "/v1/snapshot"),
      (value) => value.agents["talkie.test-node"]?.metadata?.staleLocalRegistration === true,
    );

    expect(snapshot.agents["talkie.test-node"]?.metadata?.staleLocalRegistration).toBe(true);
    expect(snapshot.endpoints["endpoint-talkie-old"]?.state).toBe("offline");
    expect(snapshot.endpoints["endpoint-talkie-old"]?.metadata?.staleLocalRegistration).toBe(true);
  }, 15_000);
});
