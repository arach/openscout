import { describe, expect, test } from "bun:test";

import {
  buildConversationGroups,
  pathBasename,
  repoNameFromKey,
  resolveRepoGroupIdentity,
} from "./conversation-groups.ts";
import type { Agent, SessionEntry } from "./types.ts";

function session(partial: Partial<SessionEntry> & Pick<SessionEntry, "id">): SessionEntry {
  return {
    kind: "direct",
    title: partial.title ?? partial.id,
    participantIds: partial.participantIds ?? [],
    agentId: partial.agentId ?? null,
    agentName: partial.agentName ?? null,
    harness: partial.harness ?? null,
    harnessSessionId: partial.harnessSessionId ?? null,
    harnessLogPath: partial.harnessLogPath ?? null,
    currentBranch: partial.currentBranch ?? null,
    preview: partial.preview ?? null,
    messageCount: partial.messageCount ?? 0,
    lastMessageAt: partial.lastMessageAt ?? null,
    workspaceRoot: partial.workspaceRoot ?? null,
    ...partial,
  };
}

function agent(partial: Partial<Agent> & Pick<Agent, "id">): Agent {
  return {
    definitionId: partial.id,
    name: partial.id,
    handle: null,
    agentClass: "local",
    harness: null,
    state: null,
    projectRoot: null,
    cwd: null,
    updatedAt: null,
    createdAt: null,
    transport: null,
    selector: null,
    defaultSelector: null,
    nodeQualifier: null,
    workspaceQualifier: null,
    wakePolicy: null,
    capabilities: [],
    project: null,
    branch: null,
    role: null,
    model: null,
    harnessSessionId: null,
    terminalSurface: null,
    harnessLogPath: null,
    conversationId: null,
    homeNodeId: null,
    homeNodeName: null,
    ownerId: null,
    ownerName: null,
    ownerHandle: null,
    staleLocalRegistration: false,
    retiredFromFleet: false,
    replacedByAgentId: null,
    ...partial,
  };
}

function agentMap(agents: Agent[]): Map<string, Agent> {
  return new Map(agents.map((entry) => [entry.id, entry]));
}

const REPO_KEY = "github.com/arach/openscout";

describe("repoNameFromKey / pathBasename", () => {
  test("takes the last segment of a canonical repo key", () => {
    expect(repoNameFromKey("github.com/arach/openscout")).toBe("openscout");
    expect(repoNameFromKey("gitlab.com/org/team/repo")).toBe("repo");
  });

  test("takes the basename of a filesystem path", () => {
    expect(pathBasename("/Users/art/dev/openscout-pr-423")).toBe("openscout-pr-423");
    expect(pathBasename("/Users/art/dev/openscout/")).toBe("openscout");
  });
});

describe("resolveRepoGroupIdentity", () => {
  test("prefers the member whose checkout basename matches the repo name", () => {
    const identity = resolveRepoGroupIdentity([
      { project: "openscout-pr-423", projectRoot: "/Users/art/dev/openscout-pr-423", lastActivityAt: 200 },
      { project: "openscout", projectRoot: "/Users/art/dev/openscout", lastActivityAt: 100 },
    ], REPO_KEY);
    expect(identity.label).toBe("openscout");
    expect(identity.canonicalRoot).toBe("/Users/art/dev/openscout");
  });

  test("falls back to the most recently active member's label", () => {
    const identity = resolveRepoGroupIdentity([
      { project: "openscout-web-perf", projectRoot: "/Users/art/dev/openscout-web-perf", lastActivityAt: 100 },
      { project: "openscout-pr-423", projectRoot: "/Users/art/dev/openscout-pr-423", lastActivityAt: 200 },
    ], REPO_KEY);
    expect(identity.label).toBe("openscout-pr-423");
    expect(identity.canonicalRoot).toBe("/Users/art/dev/openscout-pr-423");
  });

  test("breaks canonical-root ties toward the most common root", () => {
    const identity = resolveRepoGroupIdentity([
      { project: "openscout", projectRoot: "/Users/art/dev/openscout", lastActivityAt: 300 },
      { project: "openscout", projectRoot: "/Users/art/elsewhere/openscout", lastActivityAt: 200 },
      { project: "openscout", projectRoot: "/Users/art/elsewhere/openscout", lastActivityAt: 100 },
    ], REPO_KEY);
    // Both checkouts match the repo name; the more common root wins even
    // though the other has fresher activity.
    expect(identity.canonicalRoot).toBe("/Users/art/elsewhere/openscout");
    expect(identity.label).toBe("openscout");
  });

  test("breaks most-common-root ties toward the latest activity", () => {
    const identity = resolveRepoGroupIdentity([
      { project: "a", projectRoot: "/checkouts/a", lastActivityAt: 100 },
      { project: "b", projectRoot: "/checkouts/b", lastActivityAt: 200 },
    ], "github.com/org/unrelated");
    expect(identity.canonicalRoot).toBe("/checkouts/b");
    expect(identity.label).toBe("b");
  });

  test("uses the repo name when no member carries a root", () => {
    const identity = resolveRepoGroupIdentity([
      { project: null, projectRoot: null, lastActivityAt: 0 },
    ], REPO_KEY);
    expect(identity.label).toBe("openscout");
    expect(identity.canonicalRoot).toBeNull();
  });
});

describe("buildConversationGroups", () => {
  test("merges side checkouts of one repo into a single group", () => {
    const agents = agentMap([
      agent({
        id: "agent.main",
        project: "openscout",
        projectRoot: "/Users/art/dev/openscout",
        repoKey: REPO_KEY,
      }),
      agent({
        id: "agent.pr423",
        project: "openscout-pr-423",
        projectRoot: "/Users/art/dev/openscout-pr-423",
        repoKey: REPO_KEY,
      }),
    ]);
    const groups = buildConversationGroups([
      session({ id: "dm-main", agentId: "agent.main", agentName: "Main", lastMessageAt: 100 }),
      session({ id: "dm-pr", agentId: "agent.pr423", agentName: "Pr 423", lastMessageAt: 200 }),
    ], agents, {}, "recent");

    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group!.key).toBe(`repo:${REPO_KEY}`);
    expect(group!.label).toBe("openscout");
    expect(group!.canonicalRoot).toBe("/Users/art/dev/openscout");
    expect(group!.conversations.map((s) => s.id)).toEqual(["dm-pr", "dm-main"]);
  });

  test("keeps agents in different repos in separate groups", () => {
    const agents = agentMap([
      agent({
        id: "agent.a",
        project: "openscout",
        projectRoot: "/Users/art/dev/openscout",
        repoKey: REPO_KEY,
      }),
      agent({
        id: "agent.b",
        project: "other",
        projectRoot: "/Users/art/dev/other",
        repoKey: "github.com/arach/other",
      }),
    ]);
    const groups = buildConversationGroups([
      session({ id: "dm-a", agentId: "agent.a", lastMessageAt: 100 }),
      session({ id: "dm-b", agentId: "agent.b", lastMessageAt: 200 }),
    ], agents, {}, "recent");
    expect(groups).toHaveLength(2);
  });

  test("falls back to project grouping when no repoKey resolved", () => {
    const agents = agentMap([
      agent({ id: "agent.a", project: "openscout", projectRoot: "/Users/art/dev/openscout" }),
      agent({ id: "agent.b", project: "openscout", projectRoot: "/tmp/openscout-clone" }),
    ]);
    const groups = buildConversationGroups([
      session({ id: "dm-a", agentId: "agent.a", lastMessageAt: 100 }),
      session({ id: "dm-b", agentId: "agent.b", lastMessageAt: 200 }),
    ], agents, {}, "recent");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("project:openscout");
    expect(groups[0]!.canonicalRoot).toBeNull();
  });

  test("falls back to agent-name grouping without project or repoKey", () => {
    const agents = agentMap([agent({ id: "agent.a" })]);
    const groups = buildConversationGroups([
      session({ id: "dm-a", agentId: "agent.a", agentName: "Scout", lastMessageAt: 100 }),
    ], agents, {}, "recent");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("name:scout");
  });
});
