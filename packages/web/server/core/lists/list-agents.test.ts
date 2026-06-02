import { describe, expect, mock, test } from "bun:test";

let agentsResult: unknown[] = [];

mock.module("../../db-queries.ts", () => ({
  queryAgents: () => agentsResult,
  queryFleet: () => ({
    generatedAt: Date.now(),
    totals: { active: 0, recentCompleted: 0, needsAttention: 0, activity: 0 },
    activeAsks: [],
    recentCompleted: [],
    needsAttention: [],
    activity: [],
  }),
}));

const { listAgents } = await import("./list-agents.ts");

describe("listAgents", () => {
  test("can group agent instances by display name and sort by recency", () => {
    agentsResult = [
      agent({ id: "codex-old", name: "Openscout", updatedAt: 100, harness: "codex" }),
      agent({ id: "claude-new", name: "Openscout", updatedAt: 300, harness: "claude" }),
      agent({ id: "studio", name: "Studio", updatedAt: 200, harness: "codex" }),
    ];

    const list = listAgents({ group: "agent", sort: "recent" });

    expect(list.groups.map((group) => group.label)).toEqual(["Openscout", "Studio"]);
    expect(list.groups[0]?.rows.map((row) => row.id)).toEqual(["claude-new", "codex-old"]);
  });

  test("supports harness filtering as a scope-like facet", () => {
    agentsResult = [
      agent({ id: "codex-agent", name: "Codex Agent", harness: "codex" }),
      agent({ id: "claude-agent", name: "Claude Agent", harness: "claude" }),
    ];

    const list = listAgents({ harness: "codex", group: "none", sort: "name" });

    expect(list.summary.totalRows).toBe(1);
    expect(list.groups[0]?.rows).toContainEqual(
      expect.objectContaining({ id: "codex-agent" }),
    );
  });
});

function agent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "agent-1",
    definitionId: "agent",
    name: "Agent",
    handle: null,
    agentClass: "general",
    harness: "codex",
    state: "available",
    projectRoot: "/Users/arach/dev/project",
    cwd: "/Users/arach/dev/project",
    updatedAt: 100,
    createdAt: 1,
    transport: "codex_app_server",
    selector: null,
    defaultSelector: null,
    nodeQualifier: null,
    workspaceQualifier: null,
    wakePolicy: "on_demand",
    capabilities: [],
    project: "Project",
    branch: null,
    role: null,
    model: null,
    harnessSessionId: null,
    harnessLogPath: null,
    conversationId: "dm.operator.agent-1",
    authorityNodeId: "node-1",
    authorityNodeName: "node-1",
    homeNodeId: "node-1",
    homeNodeName: "node-1",
    ownerId: null,
    ownerName: null,
    ownerHandle: null,
    staleLocalRegistration: false,
    retiredFromFleet: false,
    replacedByAgentId: null,
    ...overrides,
  };
}
