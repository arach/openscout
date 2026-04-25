import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initializeOpenScoutSetup, resolveOpenScoutSetupContextRoot, writeOpenScoutSettings } from "./setup.js";
import { encodeClaudeProjectsSlug } from "./user-project-hints.js";

const originalHome = process.env.HOME;
const originalSupportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY;
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const originalRelayHub = process.env.OPENSCOUT_RELAY_HUB;
const originalSetupCwd = process.env.OPENSCOUT_SETUP_CWD;
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
  if (originalSetupCwd === undefined) {
    delete process.env.OPENSCOUT_SETUP_CWD;
  } else {
    process.env.OPENSCOUT_SETUP_CWD = originalSetupCwd;
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

describe("setup inventory", () => {
  test("resolves the configured setup context root from persisted settings when no env override is present", async () => {
    const home = join(tmpdir(), `openscout-setup-context-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const sourceRoot = join(home, "dev");
    const configuredRoot = join(sourceRoot, "alpha");
    const unrelatedCwd = join(home, "scratch");

    testDirectories.add(home);
    mkdirSync(configuredRoot, { recursive: true });
    mkdirSync(unrelatedCwd, { recursive: true });

    process.env.HOME = home;
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(home, "Library", "Application Support", "OpenScout");
    process.env.OPENSCOUT_CONTROL_HOME = join(home, ".openscout", "control-plane");
    process.env.OPENSCOUT_RELAY_HUB = join(home, ".openscout", "relay");
    process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS = "1";
    delete process.env.OPENSCOUT_SETUP_CWD;

    await writeOpenScoutSettings({
      discovery: {
        contextRoot: configuredRoot,
        workspaceRoots: [sourceRoot],
        includeCurrentRepo: true,
      },
    }, {
      currentDirectory: configuredRoot,
    });

    expect(resolveOpenScoutSetupContextRoot({ fallbackDirectory: unrelatedCwd })).toBe(configuredRoot);
  });

  test("prefers OPENSCOUT_SETUP_CWD over persisted settings when explicitly provided", async () => {
    const home = join(tmpdir(), `openscout-setup-context-env-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const sourceRoot = join(home, "dev");
    const configuredRoot = join(sourceRoot, "alpha");
    const overrideRoot = join(home, "override");

    testDirectories.add(home);
    mkdirSync(configuredRoot, { recursive: true });
    mkdirSync(overrideRoot, { recursive: true });

    process.env.HOME = home;
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(home, "Library", "Application Support", "OpenScout");
    process.env.OPENSCOUT_CONTROL_HOME = join(home, ".openscout", "control-plane");
    process.env.OPENSCOUT_RELAY_HUB = join(home, ".openscout", "relay");
    process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS = "1";

    await writeOpenScoutSettings({
      discovery: {
        contextRoot: configuredRoot,
        workspaceRoots: [sourceRoot],
        includeCurrentRepo: true,
      },
    }, {
      currentDirectory: configuredRoot,
    });

    process.env.OPENSCOUT_SETUP_CWD = overrideRoot;
    expect(resolveOpenScoutSetupContextRoot()).toBe(overrideRoot);
  });

  test("walks source roots recursively and records harness evidence per project", async () => {
    const home = join(tmpdir(), `openscout-setup-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const sourceRoot = join(home, "dev");
    const repoAlpha = join(sourceRoot, "alpha");
    const repoBeta = join(sourceRoot, "group", "beta");
    const repoMono = join(sourceRoot, "mono");
    const nestedPackage = join(repoMono, "packages", "ui");

    testDirectories.add(home);
    mkdirSync(sourceRoot, { recursive: true });

    mkdirSync(join(repoAlpha, ".git"), { recursive: true });
    writeFileSync(join(repoAlpha, "AGENTS.md"), "# Alpha\n", "utf8");
    writeFileSync(join(repoAlpha, "CLAUDE.md"), "# Alpha\n", "utf8");
    mkdirSync(join(repoAlpha, ".codex", "environments"), { recursive: true });
    writeFileSync(
      join(repoAlpha, ".codex", "environments", "environment.toml"),
      [
        "version = 1",
        'name = "Alpha Workspace"',
        "",
        "[setup]",
        'script = "npm install\\nnpm run build"',
        "",
        "[[actions]]",
        'name = "Run"',
        'icon = "play"',
        'command = "npm start"',
        "",
      ].join("\n"),
      "utf8",
    );

    mkdirSync(repoBeta, { recursive: true });
    writeFileSync(join(repoBeta, "AGENTS.md"), "# Beta\n", "utf8");

    mkdirSync(join(repoMono, ".git"), { recursive: true });
    mkdirSync(nestedPackage, { recursive: true });
    writeFileSync(join(nestedPackage, "AGENTS.md"), "# Nested package\n", "utf8");

    process.env.HOME = home;
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(home, "Library", "Application Support", "OpenScout");
    process.env.OPENSCOUT_CONTROL_HOME = join(home, ".openscout", "control-plane");
    process.env.OPENSCOUT_RELAY_HUB = join(home, ".openscout", "relay");
    process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS = "1";
    mkdirSync(join(home, ".claude", "projects", encodeClaudeProjectsSlug(repoAlpha), "memory"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "projects", encodeClaudeProjectsSlug(repoAlpha), "session.jsonl"),
      `${JSON.stringify({ cwd: join(repoAlpha, "apps", "desktop"), gitBranch: "feature/alpha" })}\n`,
      "utf8",
    );
    writeFileSync(
      join(home, ".claude", "projects", encodeClaudeProjectsSlug(repoAlpha), "memory", "MEMORY.md"),
      "# Alpha memory\n",
      "utf8",
    );

    await writeOpenScoutSettings({
      discovery: {
        workspaceRoots: [sourceRoot],
        includeCurrentRepo: true,
      },
    }, {
      currentDirectory: repoAlpha,
    });

    const setup = await initializeOpenScoutSetup({ currentDirectory: repoAlpha });
    const relativePaths = setup.projectInventory.map((project) => project.relativePath).sort();

    expect(relativePaths).toEqual(["alpha", "group/beta", "mono"]);
    expect(readFileSync(join(repoAlpha, ".gitignore"), "utf8")).toContain(".openscout/project.json");

    const alpha = setup.projectInventory.find((project) => project.relativePath === "alpha");
    expect(alpha?.registrationKind).toBe("configured");
    expect(alpha?.harnesses.map((harness) => harness.harness).sort()).toEqual(["claude", "codex"]);
    const alphaManifest = JSON.parse(readFileSync(join(repoAlpha, ".openscout", "project.json"), "utf8")) as {
      project: { name: string };
      environment?: {
        setup?: { default?: string };
        actions?: Array<{ name: string; scripts?: { default?: string } }>;
      };
      imports?: {
        codex?: { sourcePath?: string; environment?: { actions?: Array<{ name: string }> } };
        claude?: { sourcePath?: string; memoryPath?: string; gitBranches?: string[] };
      };
    };
    expect(alphaManifest.project.name).toBe("Alpha Workspace");
    expect(alphaManifest.environment?.setup?.default).toBe("npm install\nnpm run build");
    expect(alphaManifest.environment?.actions?.map((action) => action.name)).toEqual(["Run"]);
    expect(alphaManifest.environment?.actions?.[0]?.scripts?.default).toBe("npm start");
    expect(alphaManifest.imports?.codex?.sourcePath).toBe(join(repoAlpha, ".codex", "environments", "environment.toml"));
    expect(alphaManifest.imports?.codex?.environment?.actions?.map((action) => action.name)).toEqual(["Run"]);
    expect(alphaManifest.imports?.claude?.sourcePath).toBe(join(home, ".claude", "projects", encodeClaudeProjectsSlug(repoAlpha)));
    expect(alphaManifest.imports?.claude?.memoryPath).toBe(
      join(home, ".claude", "projects", encodeClaudeProjectsSlug(repoAlpha), "memory", "MEMORY.md"),
    );
    expect(alphaManifest.imports?.claude?.gitBranches).toEqual(["feature/alpha"]);

    const beta = setup.projectInventory.find((project) => project.relativePath === "group/beta");
    expect(beta?.defaultHarness).toBe("codex");
    expect(beta?.harnesses.map((harness) => harness.harness)).toEqual(["codex"]);

    const mono = setup.projectInventory.find((project) => project.relativePath === "mono");
    expect(mono).toBeTruthy();
    expect(setup.projectInventory.some((project) => project.relativePath === "mono/packages/ui")).toBe(false);

    await initializeOpenScoutSetup({ currentDirectory: repoAlpha });
    const gitignoreLines = readFileSync(join(repoAlpha, ".gitignore"), "utf8")
      .split(/\r?\n/g)
      .filter((line) => line.trim() === ".openscout/project.json");
    expect(gitignoreLines).toHaveLength(1);
  });

  test("creates a project manifest directly in the explicit Relay context root", async () => {
    const home = join(tmpdir(), `openscout-context-root-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const sourceRoot = join(home, "dev");

    testDirectories.add(home);
    mkdirSync(sourceRoot, { recursive: true });

    process.env.HOME = home;
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(home, "Library", "Application Support", "OpenScout");
    process.env.OPENSCOUT_CONTROL_HOME = join(home, ".openscout", "control-plane");
    process.env.OPENSCOUT_RELAY_HUB = join(home, ".openscout", "relay");
    process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS = "1";

    await writeOpenScoutSettings({
      discovery: {
        workspaceRoots: [sourceRoot],
        includeCurrentRepo: true,
      },
    }, {
      currentDirectory: sourceRoot,
    });

    const setup = await initializeOpenScoutSetup({ currentDirectory: sourceRoot });

    expect(setup.currentProjectConfigPath).toBe(join(sourceRoot, ".openscout", "project.json"));
    expect(readFileSync(join(sourceRoot, ".gitignore"), "utf8")).toContain(".openscout/project.json");
  });
});
