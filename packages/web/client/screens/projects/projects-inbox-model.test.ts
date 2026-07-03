import { describe, expect, test } from "bun:test";
import type { Agent, FleetAsk, FleetState, SessionEntry, TailDiscoverySnapshot } from "../../lib/types.ts";
import {
  buildProjectsInboxModel,
  filterThreadsForView,
  groupThreads,
  isDormantProject,
  isSessionSelected,
  isThreadSelected,
  sessionSelectRoute,
  threadOpenRoute,
  threadSelectRoute,
  threadsForProject,
  type BuildInboxInput,
} from "./projects-inbox-model.ts";

const NOW = 1_700_000_000_000;
const RECENT = NOW - 60_000; // 1m ago — live
const STALE = NOW - 3 * 24 * 60 * 60_000; // 3d ago — dormant

function mkAgent(partial: Partial<Agent> & { id: string; name: string }): Agent {
  return {
    definitionId: `${partial.id}-def`,
    handle: null,
    agentClass: "agent",
    harness: "claude",
    state: "callable",
    projectRoot: "/Users/test/dev/openscout",
    cwd: "/Users/test/dev/openscout",
    updatedAt: RECENT,
    createdAt: RECENT,
    transport: "local",
    selector: null,
    defaultSelector: null,
    nodeQualifier: null,
    workspaceQualifier: null,
    wakePolicy: null,
    capabilities: [],
    project: "openscout",
    branch: "main",
    role: null,
    model: "opus",
    harnessSessionId: null,
    terminalSurface: null,
    harnessLogPath: null,
    conversationId: null,
    homeNodeId: "local",
    homeNodeName: "local",
    ownerId: null,
    ownerName: null,
    ownerHandle: null,
    staleLocalRegistration: false,
    retiredFromFleet: false,
    replacedByAgentId: null,
    ...partial,
  };
}

function mkAsk(agentId: string): FleetAsk {
  return {
    invocationId: `inv-${agentId}`,
    flightId: null,
    agentId,
    agentName: agentId,
    conversationId: null,
    collaborationRecordId: null,
    task: "Review the migration diff",
    status: "needs_attention",
    statusLabel: "needs attention",
    acknowledgedAt: null,
    attention: "badge",
    agentState: "available",
    harness: "codex",
    transport: "local",
    summary: "Review the migration diff",
    startedAt: RECENT,
    completedAt: null,
    updatedAt: RECENT,
  };
}

function mkFleet(asks: FleetAsk[]): FleetState {
  return {
    generatedAt: NOW,
    totals: { active: asks.length, recentCompleted: 0, needsAttention: asks.length, activity: 0 },
    activeAsks: asks,
    recentCompleted: [],
    needsAttention: [],
    activity: [],
  };
}

function mkSession(agent: Agent, partial: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id: `c.${agent.id}`,
    kind: "dm",
    title: `${agent.name} session`,
    participantIds: [agent.id],
    agentId: agent.id,
    agentName: agent.name,
    harness: agent.harness,
    harnessSessionId: agent.harnessSessionId,
    harnessLogPath: agent.harnessLogPath,
    currentBranch: agent.branch,
    preview: "Map the project hierarchy",
    messageCount: 8,
    lastMessageAt: RECENT,
    workspaceRoot: agent.projectRoot,
    ...partial,
  };
}

function baseInput(
  agents: Agent[],
  fleet: FleetState | null,
  showEphemeral = false,
  sessions: SessionEntry[] = [],
  discovery: TailDiscoverySnapshot | null = null,
): BuildInboxInput {
  return {
    agents,
    machineId: null,
    sessions,
    fleet,
    discovery,
    nowMs: NOW,
    showEphemeral,
  };
}

describe("buildProjectsInboxModel — collapse + truthful counts", () => {
  test("collapses ID-proliferation: two same-named agents fold into one thread", () => {
    const agents = [
      mkAgent({ id: "scout.a", name: "Scout", branch: "main" }),
      mkAgent({ id: "scout.b", name: "Scout", branch: "feat/x" }),
    ];
    const model = buildProjectsInboxModel(baseInput(agents, null));
    const scoutThreads = model.threads.filter((thread) => thread.agentName === "Scout");
    expect(scoutThreads).toHaveLength(1);
    expect(model.counts.everything).toBe(1);
  });

  test("ephemeral card/clone agents fold away unless showEphemeral", () => {
    const agents = [
      mkAgent({ id: "scout.a", name: "Scout" }),
      mkAgent({ id: "card.1", name: "Openscout Card J Sh3vxg" }),
    ];
    const hidden = buildProjectsInboxModel(baseInput(agents, null, false));
    expect(hidden.threads).toHaveLength(1);
    expect(hidden.threads[0]!.agentName).toBe("Scout");

    const shown = buildProjectsInboxModel(baseInput(agents, null, true));
    expect(shown.threads.length).toBe(2);
  });

  test("needs count reflects active asks, never the raw agent count", () => {
    const agents = [
      mkAgent({ id: "scout.a", name: "Scout" }),
      mkAgent({ id: "helper.a", name: "Helper", harness: "codex" }),
      mkAgent({ id: "runner.a", name: "Runner", state: "working" }),
    ];
    const model = buildProjectsInboxModel(baseInput(agents, mkFleet([mkAsk("helper.a")])));
    expect(model.counts.everything).toBe(3);
    expect(model.counts.needs).toBe(1);
    expect(model.counts.working).toBe(1);
    const helper = model.threads.find((thread) => thread.agentName === "Helper");
    expect(helper?.needs).toBe(true);
    expect(helper?.group).toBe("needs");
  });
});

describe("attention ordering", () => {
  test("needs sorts above working sorts above recent", () => {
    const agents = [
      mkAgent({ id: "idle.a", name: "Idler", updatedAt: NOW - 2 * 60 * 60_000 }),
      mkAgent({ id: "work.a", name: "Worker", state: "working" }),
      mkAgent({ id: "need.a", name: "Needer", harness: "codex" }),
    ];
    const model = buildProjectsInboxModel(baseInput(agents, mkFleet([mkAsk("need.a")])));
    expect(model.threads.map((thread) => thread.agentName)).toEqual(["Needer", "Worker", "Idler"]);
  });

  test("groupThreads buckets into needs / working / recent in order", () => {
    const agents = [
      mkAgent({ id: "work.a", name: "Worker", state: "working" }),
      mkAgent({ id: "need.a", name: "Needer", harness: "codex" }),
      mkAgent({ id: "idle.a", name: "Idler" }),
    ];
    const model = buildProjectsInboxModel(baseInput(agents, mkFleet([mkAsk("need.a")])));
    const groups = groupThreads(model.threads).map((section) => section.group);
    expect(groups).toEqual(["needs", "working", "recent"]);
  });
});

describe("project aggregation + dormancy", () => {
  test("project rollup reports truthful needs/working and dormancy", () => {
    const agents = [
      mkAgent({ id: "os.a", name: "Scout", state: "working" }),
      mkAgent({
        id: "old.a",
        name: "Ghost",
        project: "atelier",
        projectRoot: "/Users/test/dev/atelier",
        cwd: "/Users/test/dev/atelier",
        updatedAt: STALE,
      }),
    ];
    const model = buildProjectsInboxModel(baseInput(agents, null));
    const openscout = model.projects.find((project) => project.slug === "openscout");
    const atelier = model.projects.find((project) => project.slug === "atelier");
    expect(openscout?.working).toBe(1);
    expect(isDormantProject(openscout!, NOW)).toBe(false);
    expect(isDormantProject(atelier!, NOW)).toBe(true);
    // Attention-first: the live project sorts ahead of the dormant one.
    expect(model.projects[0]!.slug).toBe("openscout");
  });

  test("project rollup exposes sessions as siblings of agent threads", () => {
    const scout = mkAgent({ id: "scout.a", name: "Scout" });
    const model = buildProjectsInboxModel(baseInput([scout], null, false, [mkSession(scout)]));
    const openscout = model.projects.find((project) => project.slug === "openscout");

    expect(model.threads).toHaveLength(1);
    expect(model.sessions).toHaveLength(1);
    expect(model.sessions[0]?.agentId).toBe("scout.a");
    expect(model.sessions[0]?.route).toEqual({ view: "conversation", conversationId: "c.scout.a" });
    expect(openscout?.agentCount).toBe(1);
    expect(openscout?.sessionCount).toBe(1);
  });

  test("process-only native observations do not become openable sessions", () => {
    const discovery: TailDiscoverySnapshot = {
      generatedAt: NOW,
      processes: [
        {
          pid: 99168,
          ppid: 1,
          command: "claude --verbose",
          etime: "00:10",
          cwd: "/Users/test/dev/openscout",
          harness: "claude",
          parentChain: [],
          source: "claude",
        },
      ],
      transcripts: [],
      issues: [],
      totals: {
        total: 1,
        scoutManaged: 0,
        hudsonManaged: 0,
        unattributed: 1,
        transcripts: 0,
      },
    };
    const model = buildProjectsInboxModel(baseInput([], null, false, [], discovery));
    const openscout = model.projects.find((project) => project.slug === "openscout");

    expect(model.sessions).toHaveLength(0);
    expect(openscout?.sessionCount).toBe(0);
    expect(openscout?.liveSessionCount).toBe(0);
  });
});

describe("filters + routing", () => {
  test("filterThreadsForView narrows to the smart view", () => {
    const agents = [
      mkAgent({ id: "work.a", name: "Worker", state: "working" }),
      mkAgent({ id: "need.a", name: "Needer", harness: "codex" }),
    ];
    const model = buildProjectsInboxModel(baseInput(agents, mkFleet([mkAsk("need.a")])));
    expect(filterThreadsForView(model.threads, "needs", NOW).map((t) => t.agentName)).toEqual(["Needer"]);
    expect(filterThreadsForView(model.threads, "working", NOW).map((t) => t.agentName)).toEqual(["Worker"]);
    expect(filterThreadsForView(model.threads, "everything", NOW)).toHaveLength(2);
  });

  test("threadsForProject scopes to one slug", () => {
    const agents = [
      mkAgent({ id: "os.a", name: "Scout" }),
      mkAgent({
        id: "at.a",
        name: "Maker",
        project: "atelier",
        projectRoot: "/Users/test/dev/atelier",
        cwd: "/Users/test/dev/atelier",
      }),
    ];
    const model = buildProjectsInboxModel(baseInput(agents, null));
    const slug = model.projects.find((project) => project.slug === "openscout")!.slug;
    const scoped = threadsForProject(model.threads, slug);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]!.agentName).toBe("Scout");
  });

  test("select vs open routes hit existing surfaces", () => {
    const agents = [mkAgent({ id: "scout.a", name: "Scout", conversationId: "conv-1" })];
    const model = buildProjectsInboxModel(baseInput(agents, null));
    const thread = model.threads[0]!;
    const route = { view: "agents-v2" as const };

    const select = threadSelectRoute(thread, route);
    expect(select.selectedAgentId).toBe("scout.a");
    expect(isThreadSelected(thread, select)).toBe(true);

    const open = threadOpenRoute(thread, route);
    expect(open).toEqual({ view: "conversation", conversationId: "conv-1" });
  });

  test("session selection uses session ids, then conversation ids, never stable row refs", () => {
    const agents = [mkAgent({ id: "scout.a", name: "Scout" })];
    const model = buildProjectsInboxModel(baseInput(agents, null, false, [mkSession(agents[0]!)]));
    const session = model.sessions[0]!;
    const select = { view: "agents-v2" as const, projectSlug: session.projectSlug, sessionId: session.sessionId ?? undefined };
    expect(isSessionSelected(session, select)).toBe(true);
    expect(sessionSelectRoute(session, { view: "agents-v2", projectSlug: session.projectSlug }).selectedAgentId).toBeUndefined();

    const conversationBacked = { ...session, sessionId: null };
    const conversationSelect = sessionSelectRoute(conversationBacked, { view: "agents-v2", projectSlug: conversationBacked.projectSlug });
    expect(conversationSelect.sessionId).toBe("c.scout.a");
    expect(conversationSelect.selectedAgentId).toBeUndefined();
    expect(isSessionSelected(conversationBacked, { view: "agents-v2", sessionId: "c.scout.a" })).toBe(true);

    const liveProcess = { ...session, sessionId: null, conversationId: null };
    const liveSelect = sessionSelectRoute(liveProcess, { view: "agents-v2", projectSlug: liveProcess.projectSlug });
    expect(liveSelect).toEqual({ view: "agents-v2", projectSlug: liveProcess.projectSlug });
    expect(isSessionSelected(liveProcess, { view: "agents-v2", sessionId: "scout:c.scout.a" })).toBe(false);
  });
});
