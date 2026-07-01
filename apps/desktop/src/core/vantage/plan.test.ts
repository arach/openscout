import { describe, expect, test } from "bun:test";
import type { AgentEndpoint, NodeDefinition } from "@openscout/protocol";

import {
  buildScoutVantagePlan,
  HUDSON_VANTAGE_SETUP_KIND,
  HUDSON_VANTAGE_SCHEMA_VERSION,
  SCOUT_VANTAGE_PLAN_SCHEMA,
  type ScoutVantagePlanInput,
} from "./plan.ts";

function endpoint(overrides: Partial<AgentEndpoint>): AgentEndpoint {
  return {
    id: "endpoint.hudson",
    agentId: "hudson.main",
    nodeId: "node.local",
    harness: "codex",
    transport: "tmux",
    state: "active",
    sessionId: "relay-hudson",
    cwd: "/work/project",
    projectRoot: "/work/project",
    metadata: {
      agentName: "Hudson",
    },
    ...overrides,
  };
}

function node(overrides: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    id: "node.local",
    meshId: "mesh.local",
    name: "Local Mac",
    advertiseScope: "local",
    registeredAt: 1_700_000_000,
    ...overrides,
  };
}

function build(input: Partial<ScoutVantagePlanInput> = {}) {
  return buildScoutVantagePlan({
    currentDirectory: "/work/project",
    now: new Date("2026-05-17T12:00:00.000Z"),
    ...input,
  });
}

describe("buildScoutVantagePlan", () => {
  test("builds a Hudson Vantage plan envelope with deterministic tmux endpoint nodes", () => {
    const plan = build({
      broker: {
        baseUrl: "http://127.0.0.1:53173",
        node: node(),
        snapshot: {
          nodes: { "node.local": node() },
          actors: {},
          agents: {},
          endpoints: {
            "endpoint.hudson": endpoint({}),
          },
          conversations: {},
          bindings: {},
          messages: {},
          readCursors: {},
          invocations: {},
          flights: {},
          collaborationRecords: {},
        },
      },
      tmuxSessions: [
        { name: "relay-hudson", createdAt: 1_700_000_100 },
      ],
    });

    expect(plan.schema).toBe(SCOUT_VANTAGE_PLAN_SCHEMA);
    expect(plan.createdAt).toBe("2026-05-17T12:00:00.000Z");
    expect(plan.manifest.kind).toBe(HUDSON_VANTAGE_SETUP_KIND);
    expect(plan.manifest.schemaVersion).toBe(HUDSON_VANTAGE_SCHEMA_VERSION);
    expect(plan.manifest.workspaceID).toBe("openscout-project");
    expect(plan.manifest.selectedAgentIds).toEqual([]);
    expect(plan.manifest.selectedNativeSessionIds).toEqual([]);
    expect(plan.manifest.broker).toEqual({
      baseUrl: "http://127.0.0.1:53173",
      nodeId: "node.local",
      nodeName: "Local Mac",
      counts: {
        nodes: 1,
        agents: 0,
        endpoints: 1,
      },
    });
    expect(plan.manifest.nodes).toHaveLength(1);
    expect(plan.manifest.nodes[0]).toMatchObject({
      id: "vantage.endpoint.endpoint-hudson.1585lc1",
      runtimeKind: "tmux",
      source: "broker-endpoint",
      title: "Hudson (relay-hudson)",
      target: "relay-hudson",
      layout: { x: 0, y: 0, width: 560, height: 360 },
      tmux: {
        sessionName: "relay-hudson",
        paneTarget: undefined,
        createdAt: 1_700_000_100,
        command: ["tmux", "attach-session", "-t", "relay-hudson"],
        terminalRelay: {
          backend: "tmux",
          tmuxSession: "relay-hudson",
        },
      },
      endpoint: {
        id: "endpoint.hudson",
        agentId: "hudson.main",
        nodeId: "node.local",
        harness: "codex",
        transport: "tmux",
        state: "active",
      },
      cwd: "/work/project",
      projectRoot: "/work/project",
    });
    expect(plan.diagnostics).toEqual([]);
  });

  test("uses attachable endpoint debug transport metadata when available", () => {
    const plan = build({
      brokerSnapshot: {
        nodes: {},
        actors: {},
        agents: {},
        endpoints: {
          "endpoint.debug": endpoint({
            id: "endpoint.debug",
            transport: "codex_app_server",
            sessionId: undefined,
            pane: "%2",
            metadata: {
              debugTransport: {
                kind: "tmux",
                state: "ready",
                sessionName: "codex-debug",
                paneTarget: "codex-debug:%2",
                cwd: "/work/debug",
                attachable: true,
                multiAttach: true,
                lastProbeAt: 1_700_000_200,
              },
            },
          }),
        },
        conversations: {},
        bindings: {},
        messages: {},
        readCursors: {},
        invocations: {},
        flights: {},
        collaborationRecords: {},
      },
      tmuxSessions: [
        { name: "codex-debug", createdAt: null },
      ],
    });

    expect(plan.manifest.nodes).toHaveLength(1);
    expect(plan.manifest.nodes[0]).toMatchObject({
      source: "broker-endpoint",
      target: "codex-debug:%2",
      tmux: {
        sessionName: "codex-debug",
        paneTarget: "codex-debug:%2",
      },
      cwd: "/work/debug",
    });
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["broker_context_missing"]);
  });

  test("adds tmux sessions not represented by broker endpoints", () => {
    const plan = build({
      brokerSnapshot: {
        nodes: {},
        actors: {},
        agents: {},
        endpoints: {
          "endpoint.hudson": endpoint({}),
        },
        conversations: {},
        bindings: {},
        messages: {},
        readCursors: {},
        invocations: {},
        flights: {},
        collaborationRecords: {},
      },
      tmuxSessions: [
        { name: "relay-hudson", createdAt: 1 },
        { name: "scratch", createdAt: 2 },
      ],
    });

    expect(plan.manifest.nodes.map((candidate) => `${candidate.source}:${candidate.tmux.sessionName}`)).toEqual([
      "broker-endpoint:relay-hudson",
      "tmux-session:scratch",
    ]);
    expect(plan.manifest.nodes.map((candidate) => candidate.layout)).toEqual([
      { x: 0, y: 0, width: 560, height: 360 },
      { x: 600, y: 0, width: 560, height: 360 },
    ]);
  });

  test("deduplicates broker endpoints that point at the same tmux target", () => {
    const plan = build({
      brokerSnapshot: {
        nodes: {},
        actors: {},
        agents: {},
        endpoints: {
          "endpoint.alpha": endpoint({
            id: "endpoint.alpha",
            sessionId: "shared-session",
            metadata: { agentName: "Alpha" },
          }),
          "endpoint.beta": endpoint({
            id: "endpoint.beta",
            sessionId: "shared-session",
            metadata: { agentName: "Beta" },
          }),
        },
        conversations: {},
        bindings: {},
        messages: {},
        readCursors: {},
        invocations: {},
        flights: {},
        collaborationRecords: {},
      },
      tmuxSessions: [
        { name: "shared-session", createdAt: 1 },
      ],
    });

    expect(plan.manifest.nodes.map((candidate) => candidate.target)).toEqual(["shared-session"]);
    expect(plan.manifest.nodes[0]?.title).toBe("Alpha (shared-session)");
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "broker_context_missing",
      "endpoint_tmux_target_duplicate",
    ]);
  });

  test("marks the focused agent node for native handoffs", () => {
    const plan = build({
      focusAgentId: "hudson.main",
      brokerSnapshot: {
        nodes: {},
        actors: {},
        agents: {},
        endpoints: {
          "endpoint.hudson": endpoint({}),
        },
        conversations: {},
        bindings: {},
        messages: {},
        readCursors: {},
        invocations: {},
        flights: {},
        collaborationRecords: {},
      },
      tmuxSessions: [
        { name: "relay-hudson", createdAt: 1 },
      ],
    });

    expect(plan.manifest.focus).toEqual({ agentId: "hudson.main" });
    expect(plan.manifest.focusedNodeId).toBe(plan.manifest.nodes[0]?.id);
    expect(plan.manifest.focused).toBe(plan.manifest.nodes[0]?.id);
    expect(plan.manifest.selection).toEqual([plan.manifest.nodes[0]?.id]);
  });

  test("scopes nodes and selection to selected agents", () => {
    const plan = build({
      focusAgentId: "beta.main",
      selectedAgentIds: ["beta.main", "missing.main", "beta.main"],
      brokerSnapshot: {
        nodes: {},
        actors: {},
        agents: {},
        endpoints: {
          "endpoint.alpha": endpoint({
            id: "endpoint.alpha",
            agentId: "alpha.main",
            sessionId: "relay-alpha",
            metadata: { agentName: "Alpha" },
          }),
          "endpoint.beta": endpoint({
            id: "endpoint.beta",
            agentId: "beta.main",
            sessionId: "relay-beta",
            metadata: { agentName: "Beta" },
          }),
        },
        conversations: {},
        bindings: {},
        messages: {},
        readCursors: {},
        invocations: {},
        flights: {},
        collaborationRecords: {},
      },
      tmuxSessions: [
        { name: "relay-alpha", createdAt: 1 },
        { name: "relay-beta", createdAt: 2 },
        { name: "scratch", createdAt: 3 },
      ],
    });

    expect(plan.manifest.selectedAgentIds).toEqual(["beta.main", "missing.main"]);
    expect(plan.manifest.nodes.map((candidate) => candidate.endpoint?.agentId)).toEqual(["beta.main"]);
    expect(plan.manifest.nodes.map((candidate) => candidate.target)).toEqual(["relay-beta"]);
    expect(plan.manifest.focusedNodeId).toBe(plan.manifest.nodes[0]?.id);
    expect(plan.manifest.focused).toBe(plan.manifest.nodes[0]?.id);
    expect(plan.manifest.selection).toEqual([plan.manifest.nodes[0]?.id]);
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "broker_context_missing",
      "selected_agent_missing",
    ]);
  });

  test("builds selected native transcript sessions as tmux tail nodes", () => {
    const nativeSession = {
      id: "native:codex:session-123:abc",
      source: "codex",
      sessionId: "session-123",
      transcriptPath: "/work/project/.codex/session.jsonl",
      project: "openscout",
      harness: "unattributed",
      cwd: "/work/project",
      mtimeMs: 1_700_000_300,
      tmuxSessionName: "scout-vantage-codex-abc",
    };
    const plan = build({
      selectedNativeSessionIds: [nativeSession.id],
      nativeSessions: [nativeSession],
      tmuxSessions: [
        { name: "scout-vantage-codex-abc", createdAt: 1_700_000_400 },
        { name: "scratch", createdAt: 1_700_000_500 },
      ],
    });

    expect(plan.manifest.focus).toEqual({ nativeSessionId: nativeSession.id });
    expect(plan.manifest.selectedNativeSessionIds).toEqual([nativeSession.id]);
    expect(plan.manifest.nodes.map((candidate) => candidate.source)).toEqual(["tail-transcript"]);
    expect(plan.manifest.nodes[0]).toMatchObject({
      id: "vantage.native.native-codex-session-123-abc.4nh3dy",
      runtimeKind: "tmux",
      source: "tail-transcript",
      title: "Codex session-",
      subtitle: "codex tail · openscout",
      target: "scout-vantage-codex-abc",
      tmux: {
        sessionName: "scout-vantage-codex-abc",
        createdAt: 1_700_000_400,
        command: ["tmux", "attach-session", "-t", "scout-vantage-codex-abc"],
      },
      nativeSession: {
        id: nativeSession.id,
        source: "codex",
        sessionId: "session-123",
        transcriptPath: "/work/project/.codex/session.jsonl",
      },
      cwd: "/work/project",
      projectRoot: "/work/project",
    });
    expect(plan.manifest.focusedNodeId).toBe(plan.manifest.nodes[0]?.id);
    expect(plan.manifest.focused).toBe(plan.manifest.nodes[0]?.id);
    expect(plan.manifest.selection).toEqual([plan.manifest.nodes[0]?.id]);
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "broker_context_missing",
      "broker_snapshot_missing",
    ]);
  });

  test("diagnoses missing broker and tmux input when no nodes can be built", () => {
    const plan = build();

    expect(plan.manifest.broker).toBeNull();
    expect(plan.manifest.nodes).toEqual([]);
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "broker_context_missing",
      "broker_snapshot_missing",
      "tmux_sessions_missing",
      "vantage_nodes_missing",
    ]);
  });

  test("diagnoses non-attachable and missing tmux endpoint targets", () => {
    const plan = build({
      brokerSnapshot: {
        nodes: {},
        actors: {},
        agents: {},
        endpoints: {
          "endpoint.missing": endpoint({
            id: "endpoint.missing",
            sessionId: "missing-session",
          }),
          "endpoint.stale": endpoint({
            id: "endpoint.stale",
            metadata: {
              debugTransport: {
                kind: "tmux",
                state: "stale",
                sessionName: "stale-session",
                attachable: true,
                multiAttach: true,
                lastProbeAt: 1,
                detail: "last probe failed",
              },
            },
          }),
        },
        conversations: {},
        bindings: {},
        messages: {},
        readCursors: {},
        invocations: {},
        flights: {},
        collaborationRecords: {},
      },
      tmuxSessions: [
        { name: "stale-session", createdAt: 2 },
      ],
    });

    expect(plan.manifest.nodes).toEqual([
      expect.objectContaining({
        source: "tmux-session",
        target: "stale-session",
      }),
    ]);
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "broker_context_missing",
      "endpoint_tmux_session_missing",
      "endpoint_not_attachable",
    ]);
  });
});
