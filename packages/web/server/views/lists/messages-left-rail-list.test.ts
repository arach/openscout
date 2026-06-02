import { describe, expect, mock, test } from "bun:test";

let conversationsResult: unknown[] = [];
let agentsResult: unknown[] = [];

mock.module("../../core/conversations/service.ts", () => ({
  getScoutConversations: async () => conversationsResult,
}));

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

const { buildMessagesLeftRailList } = await import("./messages-left-rail-list.ts");

describe("buildMessagesLeftRailList", () => {
  test("groups active and historical direct conversations by canonical project refs", async () => {
    agentsResult = [
      agent({
        id: "openscout.active",
        name: "Openscout",
        project: "Openscout",
        projectRoot: "/Users/arach/dev/openscout",
      }),
    ];
    conversationsResult = [
      conversation({
        id: "dm.operator.openscout.active",
        agentId: "openscout.active",
        title: "Openscout",
        lastMessageAt: 200,
      }),
      conversation({
        id: "dm.operator.openscout.retired",
        agentId: "openscout.retired",
        title: "Openscout",
        lastMessageAt: 100,
      }),
    ];

    const list = await buildMessagesLeftRailList();

    expect(list.groups).toHaveLength(1);
    expect(list.groups[0]).toMatchObject({
      key: "project:openscout",
      kind: "project",
      label: "Openscout",
      meta: { totalCount: 2 },
    });
    expect(list.groups[0]?.rows.map((row) => row.conversationId)).toEqual([
      "dm.operator.openscout.active",
      "dm.operator.openscout.retired",
    ]);
  });

  test("keeps channels as channel groups", async () => {
    agentsResult = [];
    conversationsResult = [
      {
        ...conversation({
          id: "channel.font-studio",
          kind: "channel",
          title: "font-studio",
          agentId: null,
          lastMessageAt: 200,
        }),
        participantIds: ["operator"],
      },
    ];

    const list = await buildMessagesLeftRailList();

    expect(list.groups).toContainEqual(
      expect.objectContaining({
        key: "channel:channel.font-studio",
        kind: "channel",
        label: "font-studio",
      }),
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

function conversation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "dm.operator.agent-1",
    kind: "direct",
    title: "Project",
    participantIds: ["operator", "agent-1"],
    authorityNodeId: "node-1",
    authorityNodeName: "node-1",
    agentId: "agent-1",
    agentName: "Project",
    harness: "codex",
    currentBranch: null,
    preview: "hello",
    messageCount: 1,
    lastMessageAt: 100,
    workspaceRoot: "/Users/arach/dev/openscout",
    ...overrides,
  };
}
