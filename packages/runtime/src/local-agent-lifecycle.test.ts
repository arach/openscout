import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  inferLocalAgentBinding,
  listLocalAgents,
  resolveLocalAgentByName,
  resolveLocalAgentIdentity,
  startLocalAgent,
} from "./local-agents.js";
import {
  buildRelayAgentInstance,
  writeOpenScoutSettings,
  writeRelayAgentOverrides,
  type OpenScoutProjectConfig,
} from "./setup.js";

const originalHome = process.env.HOME;
const originalSupportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY;
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const originalRelayHub = process.env.OPENSCOUT_RELAY_HUB;
const originalNodeQualifier = process.env.OPENSCOUT_NODE_QUALIFIER;
const originalSkipUserProjectHints = process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS;
const testDirectories = new Set<string>();

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalSupportDirectory === undefined) {
    delete process.env.OPENSCOUT_SUPPORT_DIRECTORY;
  } else {
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = originalSupportDirectory;
  }
  if (originalControlHome === undefined) {
    delete process.env.OPENSCOUT_CONTROL_HOME;
  } else {
    process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
  }
  if (originalRelayHub === undefined) {
    delete process.env.OPENSCOUT_RELAY_HUB;
  } else {
    process.env.OPENSCOUT_RELAY_HUB = originalRelayHub;
  }
  if (originalNodeQualifier === undefined) {
    delete process.env.OPENSCOUT_NODE_QUALIFIER;
  } else {
    process.env.OPENSCOUT_NODE_QUALIFIER = originalNodeQualifier;
  }
  if (originalSkipUserProjectHints === undefined) {
    delete process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS;
  } else {
    process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS = originalSkipUserProjectHints;
  }

  for (const directory of testDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  testDirectories.clear();
});

function useIsolatedOpenScoutHome(): string {
  const home = mkdtempSync(join(tmpdir(), "openscout-local-agents-"));
  testDirectories.add(home);
  process.env.HOME = home;
  process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(home, "Library", "Application Support", "OpenScout");
  process.env.OPENSCOUT_CONTROL_HOME = join(home, ".openscout", "control-plane");
  process.env.OPENSCOUT_RELAY_HUB = join(home, ".openscout", "relay");
  process.env.OPENSCOUT_NODE_QUALIFIER = "test-node";
  process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS = "1";
  return home;
}

function writeProjectManifest(projectRoot: string, config: OpenScoutProjectConfig): void {
  const manifestDir = join(projectRoot, ".openscout");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, "project.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

describe("local agent lifecycle", () => {
  test("loads agents from the relay-agent file and resolves bindings from disk", async () => {
    const home = useIsolatedOpenScoutHome();
    const workspaceRoot = join(home, "dev");
    const alphaRoot = join(workspaceRoot, "alpha");
    const betaRoot = join(workspaceRoot, "beta");

    mkdirSync(alphaRoot, { recursive: true });
    mkdirSync(betaRoot, { recursive: true });

    await writeOpenScoutSettings({
      discovery: {
        workspaceRoots: [workspaceRoot],
        includeCurrentRepo: false,
      },
    });

    await writeRelayAgentOverrides({
      alpha: {
        agentId: "alpha",
        definitionId: "alpha",
        displayName: "Alpha Agent",
        projectName: "Alpha",
        projectRoot: alphaRoot,
        source: "manual",
        runtime: {
          cwd: alphaRoot,
          harness: "codex",
          transport: "codex_app_server",
          sessionId: "alpha-codex",
          wakePolicy: "on_demand",
        },
      },
      beta: {
        agentId: "beta",
        definitionId: "beta",
        displayName: "Beta Agent",
        projectName: "Beta",
        projectRoot: betaRoot,
        source: "manual",
        runtime: {
          cwd: betaRoot,
          harness: "claude",
          transport: "claude_stream_json",
          sessionId: "beta-claude",
          wakePolicy: "on_demand",
        },
      },
    });

    const statuses = await listLocalAgents();
    expect(statuses.map((status) => status.definitionId)).toEqual(["alpha", "beta"]);
    expect(statuses.map((status) => status.projectRoot)).toEqual([alphaRoot, betaRoot]);
    expect(statuses.map((status) => status.source)).toEqual(["manual", "manual"]);
    expect(statuses.map((status) => status.harness)).toEqual(["codex", "claude"]);
    expect(statuses.map((status) => status.transport)).toEqual(["codex_app_server", "claude_stream_json"]);
    expect(statuses.every((status) => status.isOnline === false)).toBe(true);

    const resolvedByProject = await resolveLocalAgentByName("beta");
    expect(resolvedByProject).toMatchObject({
      definitionId: "beta",
      projectRoot: betaRoot,
    });

    const binding = await inferLocalAgentBinding(statuses[0]!.agentId, "node-1");
    expect(binding).toMatchObject({
      actor: {
        id: statuses[0]!.agentId,
        displayName: "Alpha",
      },
      agent: {
        id: statuses[0]!.agentId,
        definitionId: "alpha",
        homeNodeId: "node-1",
      },
      endpoint: {
        agentId: statuses[0]!.agentId,
        nodeId: "node-1",
        harness: "codex",
        transport: "codex_app_server",
      },
    });
  });

  test("does not treat a project name as an agent name unless explicitly requested", async () => {
    const home = useIsolatedOpenScoutHome();
    const workspaceRoot = join(home, "dev");
    const openscoutRoot = join(workspaceRoot, "openscout");

    mkdirSync(openscoutRoot, { recursive: true });

    await writeRelayAgentOverrides({
      "smoke.main.mini": {
        agentId: "smoke.main.mini",
        definitionId: "smoke",
        displayName: "Smoke",
        projectName: "Openscout",
        projectRoot: openscoutRoot,
        source: "manual",
        runtime: {
          cwd: openscoutRoot,
          harness: "codex",
          transport: "codex_app_server",
          sessionId: "relay-openscout.main.mini-codex",
          wakePolicy: "on_demand",
        },
      },
    });

    const concreteAgentId = buildRelayAgentInstance("smoke", openscoutRoot).id;

    expect(await resolveLocalAgentByName(concreteAgentId)).toMatchObject({
      agentId: concreteAgentId,
      definitionId: "smoke",
      projectRoot: openscoutRoot,
    });
    expect(await resolveLocalAgentByName("smoke")).toMatchObject({
      agentId: concreteAgentId,
      definitionId: "smoke",
      projectRoot: openscoutRoot,
    });
    expect(await resolveLocalAgentByName("openscout")).toBeNull();
    expect(await resolveLocalAgentByName("openscout", { matchProjectName: true })).toMatchObject({
      agentId: concreteAgentId,
      definitionId: "smoke",
      projectRoot: openscoutRoot,
    });
  });

  test("reuses an existing agent identity for subdirectories under the same project root", async () => {
    const home = useIsolatedOpenScoutHome();
    const workspaceRoot = join(home, "dev");
    const alphaRoot = join(workspaceRoot, "alpha");
    const nestedDirectory = join(alphaRoot, "apps", "desktop");

    mkdirSync(join(alphaRoot, ".git"), { recursive: true });
    mkdirSync(nestedDirectory, { recursive: true });

    await writeRelayAgentOverrides({
      alpha: {
        agentId: "alpha",
        definitionId: "alpha",
        displayName: "Alpha Agent",
        projectName: "Alpha",
        projectRoot: alphaRoot,
        source: "manual",
        defaultHarness: "codex",
        runtime: {
          cwd: alphaRoot,
          harness: "codex",
          transport: "codex_app_server",
          sessionId: "alpha-codex",
          wakePolicy: "on_demand",
        },
      },
    });

    const resolved = await resolveLocalAgentIdentity({
      projectPath: nestedDirectory,
    });

    expect(resolved).toMatchObject({
      definitionId: "alpha",
      displayName: "Alpha Agent",
      harness: "codex",
      projectRoot: alphaRoot,
      projectName: "Alpha",
      source: "existing",
    });
    expect(resolved.instanceId).toContain("alpha");
    expect(resolved.instanceId).toContain("test-node");
  });

  test("seeds a new agent identity from the project manifest when no relay-agent file exists", async () => {
    const home = useIsolatedOpenScoutHome();
    const workspaceRoot = join(home, "dev");
    const projectRoot = join(workspaceRoot, "gamma");

    mkdirSync(projectRoot, { recursive: true });
    writeProjectManifest(projectRoot, {
      version: 1,
      project: {
        id: "gamma",
        name: "Gamma",
      },
      agent: {
        id: "build-master",
        displayName: "Build Master",
        runtime: {
          defaultHarness: "codex",
          profiles: {
            codex: {
              cwd: ".",
              transport: "codex_app_server",
              sessionId: "gamma-codex",
              launchArgs: ["--model", "gpt-5"],
            },
          },
        },
      },
    });

    const resolved = await resolveLocalAgentIdentity({
      projectPath: projectRoot,
    });

    expect(resolved).toMatchObject({
      definitionId: "build-master",
      displayName: "Build Master",
      harness: "codex",
      projectRoot,
      projectName: "gamma",
      source: "config",
    });
    expect(resolved.instanceId).toContain("build-master");
    expect(resolved.instanceId).toContain("test-node");
  });

  test("forks a same-root probe without replacing the configured main agent", async () => {
    const home = useIsolatedOpenScoutHome();
    const workspaceRoot = join(home, "dev");
    const projectRoot = join(workspaceRoot, "openscout");

    mkdirSync(join(projectRoot, ".git"), { recursive: true });

    await writeRelayAgentOverrides({
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
      },
    });

    const probe = await startLocalAgent({
      projectPath: projectRoot,
      agentName: "ranger-probe",
      displayName: "Ranger Probe",
      harness: "codex",
      model: "gpt-5.4-mini",
      ensureOnline: false,
    });

    expect(probe.definitionId).toBe("ranger-probe");
    expect(await resolveLocalAgentByName("ranger")).toMatchObject({
      definitionId: "ranger",
      projectRoot,
    });
    expect(await resolveLocalAgentByName("ranger-probe")).toMatchObject({
      definitionId: "ranger-probe",
      projectRoot,
    });
    expect((await listLocalAgents()).map((agent) => agent.definitionId).sort()).toEqual([
      "ranger",
      "ranger-probe",
    ]);
  });
});
