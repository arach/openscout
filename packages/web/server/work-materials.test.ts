import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import type { AgentObservePayload } from "./core/observe/service.ts";
import type { WebAgent, WebWorkDetail } from "./db-queries.ts";

const tempRoots = new Set<string>();
let agentObservePayload: AgentObservePayload | null = null;

const agents: WebAgent[] = [
  {
    id: "agent-1",
    name: "Agent One",
    handle: null,
    agentClass: "general",
    harness: "codex",
    state: "available",
    projectRoot: null,
    cwd: null,
    updatedAt: 1,
    transport: null,
    selector: null,
    wakePolicy: null,
    capabilities: [],
    project: null,
    branch: null,
    role: null,
    model: null,
    harnessSessionId: null,
    harnessLogPath: null,
    conversationId: "dm.operator.agent-1",
  },
];

mock.module("./db-queries.ts", () => ({
  queryAgents: () => agents,
  queryRuns: () => [],
  querySessionById: () => null,
}));

mock.module("./core/observe/service.ts", () => ({
  loadAgentObservePayload: async () => agentObservePayload,
  loadSessionRefObservePayload: async () => null,
}));

const { readWorkMaterialContent } = await import("./work-materials.ts");

beforeEach(() => {
  agentObservePayload = null;
});

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

function makeTempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempRoots.add(root);
  return root;
}

function makeWork(): WebWorkDetail {
  return {
    id: "work-1",
    title: "Preview work",
    summary: null,
    ownerId: "agent-1",
    ownerName: "Agent One",
    nextMoveOwnerId: null,
    nextMoveOwnerName: null,
    conversationId: null,
    createdAt: 1,
    updatedAt: 1,
    parentId: null,
    parentTitle: null,
    state: "working",
    acceptanceState: "none",
    priority: null,
    currentPhase: "Working",
    attention: "silent",
    activeChildWorkCount: 0,
    activeFlightCount: 0,
    lastMeaningfulAt: 1,
    lastMeaningfulSummary: null,
    childWork: [],
    activeFlights: [],
    timeline: [],
  };
}

function useObservedFile(path: string, cwd: string | null): void {
  agentObservePayload = {
    agentId: "agent-1",
    source: "history",
    fidelity: "timestamped",
    historyPath: null,
    sessionId: "session-1",
    updatedAt: 1,
    data: {
      events: [],
      files: [
        {
          path,
          state: "read",
          touches: 1,
          lastT: 1,
        },
      ],
      metadata: {
        session: {
          adapterType: "codex",
          externalSessionId: "session-1",
          ...(cwd ? { cwd } : {}),
        },
      },
    },
  };
}

describe("readWorkMaterialContent", () => {
  test("does not serve rootless absolute trace-only paths", async () => {
    const root = makeTempRoot("openscout-work-materials-secret-");
    const secretPath = join(root, "secret.txt");
    writeFileSync(secretPath, "do not leak\n", "utf8");
    useObservedFile(secretPath, null);

    const result = await readWorkMaterialContent(makeWork(), `trace::${secretPath}`);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("rootless absolute trace path was unexpectedly readable");
    }
    expect(result.status).toBe(404);
    expect(result.error).toBe("material does not have a trusted local root");
  });

  test("serves git-backed absolute trace paths through the detected worktree root", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-repo-");
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
    const filePath = join(repoRoot, "preview.txt");
    writeFileSync(filePath, "rooted preview\n", "utf8");
    useObservedFile(filePath, repoRoot);

    const result = await readWorkMaterialContent(makeWork(), `${repoRoot}::preview.txt`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`git-backed material was not readable: ${result.error}`);
    }
    expect(result.content.path).toBe("preview.txt");
    expect(result.content.uri).toBe(realpathSync(filePath));
    expect(result.content.content).toBe("rooted preview\n");
  });

  test("does not follow rooted material symlinks outside the trusted root", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-symlink-repo-");
    const outsideRoot = makeTempRoot("openscout-work-materials-symlink-outside-");
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
    const outsidePath = join(outsideRoot, "secret.txt");
    const linkPath = join(repoRoot, "linked-secret.txt");
    writeFileSync(outsidePath, "still do not leak\n", "utf8");
    symlinkSync(outsidePath, linkPath);
    useObservedFile(linkPath, repoRoot);

    const result = await readWorkMaterialContent(makeWork(), `${repoRoot}::linked-secret.txt`);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("symlink escape was unexpectedly readable");
    }
    expect(result.status).toBe(403);
    expect(result.error).toBe("material path is outside its trusted root");
  });
});
