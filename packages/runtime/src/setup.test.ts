import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initializeOpenScoutSetup, writeOpenScoutSettings } from "./setup.js";

const originalHome = process.env.HOME;
const originalSupportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY;
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const originalRelayHub = process.env.OPENSCOUT_RELAY_HUB;
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

  for (const directory of testDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  testDirectories.clear();
});

describe("setup inventory", () => {
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

    mkdirSync(repoBeta, { recursive: true });
    writeFileSync(join(repoBeta, "AGENTS.md"), "# Beta\n", "utf8");

    mkdirSync(join(repoMono, ".git"), { recursive: true });
    mkdirSync(nestedPackage, { recursive: true });
    writeFileSync(join(nestedPackage, "AGENTS.md"), "# Nested package\n", "utf8");

    process.env.HOME = home;
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(home, "Library", "Application Support", "OpenScout");
    process.env.OPENSCOUT_CONTROL_HOME = join(home, ".openscout", "control-plane");
    process.env.OPENSCOUT_RELAY_HUB = join(home, ".openscout", "relay");

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

    const beta = setup.projectInventory.find((project) => project.relativePath === "group/beta");
    expect(beta?.defaultHarness).toBe("codex");
    expect(beta?.harnesses.map((harness) => harness.harness)).toEqual(["codex"]);

    const mono = setup.projectInventory.find((project) => project.relativePath === "mono");
    expect(mono).toBeTruthy();
    expect(setup.projectInventory.some((project) => project.relativePath.includes("packages/ui"))).toBe(false);

    await initializeOpenScoutSetup({ currentDirectory: repoAlpha });
    const gitignoreLines = readFileSync(join(repoAlpha, ".gitignore"), "utf8")
      .split(/\r?\n/g)
      .filter((line) => line.trim() === ".openscout/project.json");
    expect(gitignoreLines).toHaveLength(1);
  });
});
