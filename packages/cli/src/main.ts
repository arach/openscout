#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  brokerServiceStatus,
  initializeOpenScoutSetup,
  loadHarnessCatalogSnapshot,
  loadResolvedRelayAgents,
  resolveOpenScoutSupportPaths,
  startBrokerService,
  writeOpenScoutSettings,
  type ProjectInventoryEntry,
} from "@openscout/runtime";

const VERSION = "0.1.0";
const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../..");
const supportPaths = resolveOpenScoutSupportPaths();
const scoutDevScript = join(repoRoot, "scripts", "scout-dev");
const setupCurrentDirectory = process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd();

const args = process.argv.slice(2);
const [command = "help", subcommand, ...rest] = args;
const commandArgs = [subcommand, ...rest].filter((value): value is string => Boolean(value));

switch (command) {
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(VERSION);
    break;
  case "doctor":
    await runDoctor();
    break;
  case "init":
    await runInit(commandArgs);
    break;
  case "runtimes":
    await runRuntimes(commandArgs);
    break;
  case "dev":
    await runDevCommand(subcommand, rest);
    break;
  case "app":
    await runScopedNativeCommand("app", subcommand, rest);
    break;
  case "agent":
    await runScopedNativeCommand("agent", subcommand, rest);
    break;
  default:
    fail(`unknown command: ${command}`);
}

function printHelp() {
  console.log(`scout ${VERSION}

OpenScout command line interface

Usage:
  scout help
  scout version
  scout doctor
  scout init [--source-root <path>]...
  scout runtimes
  scout dev help
  scout dev build app
  scout dev launch agent
  scout app build
  scout app launch
  scout app relaunch
  scout app relaunch --rebuild
  scout app status
  scout agent build
  scout agent launch
  scout agent status

Commands:
  help           Show this help text
  version        Print the CLI version
  doctor         Show broker health, source roots, runtimes, and project inventory
  init           Set up OpenScout for the current repo and optional source roots
  runtimes       Show the harness catalog and readiness state
  dev            Pass native developer commands through to scout-dev
  app            Run a scoped native app command through scout-dev
  agent          Run a scoped native agent command through scout-dev
`);
}

async function runDoctor() {
  const broker = await brokerServiceStatus();
  const setup = await loadResolvedRelayAgents({ currentDirectory: setupCurrentDirectory });
  const catalog = await loadHarnessCatalogSnapshot();

  console.log(`OpenScout CLI: ${VERSION}`);
  console.log(`Repo root: ${repoRoot}`);
  console.log(`Support directory: ${setup.supportDirectory}`);
  console.log(`Settings: ${setup.settingsPath}`);
  console.log(`Harness catalog: ${setup.harnessCatalogPath}`);
  console.log(`Agent registry: ${setup.relayAgentsPath}`);
  console.log(`Current project config: ${setup.currentProjectConfigPath ?? "not found"}`);
  console.log("");
  console.log("Source roots:");
  for (const root of setup.settings.discovery.workspaceRoots) {
    console.log(`  - ${root}`);
  }
  console.log("");
  console.log("Agent defaults:");
  console.log(`  Harness: ${setup.settings.agents.defaultHarness}`);
  console.log(`  Capabilities: ${setup.settings.agents.defaultCapabilities.join(", ")}`);
  console.log(`  Session prefix: ${setup.settings.agents.sessionPrefix}`);
  console.log("");
  printProjectInventory(setup.projectInventory);
  console.log("");
  console.log("Broker:");
  console.log(`  Label: ${broker.label}`);
  console.log(`  URL: ${broker.brokerUrl}`);
  console.log(`  Installed: ${broker.installed ? "yes" : "no"}`);
  console.log(`  Loaded: ${broker.loaded ? "yes" : "no"}`);
  console.log(`  Reachable: ${broker.reachable ? "yes" : "no"}`);
  console.log(`  LaunchAgent: ${broker.launchAgentPath}`);
  console.log(`  Broker stdout: ${broker.stdoutLogPath}`);
  console.log(`  Broker stderr: ${broker.stderrLogPath}`);
  console.log("");
  console.log(`Known runtimes: ${catalog.entries.length}`);
  for (const entry of catalog.entries) {
    console.log(`  - ${entry.label} (${entry.name})`);
    console.log(`    State: ${entry.readinessReport.state}`);
    console.log(`    Detail: ${entry.readinessReport.detail}`);
    if (entry.readinessReport.missing.length > 0) {
      console.log(`    Missing: ${entry.readinessReport.missing.join(" | ")}`);
    }
  }
}

async function runInit(extraArgs: string[]) {
  const parsed = parseInitArgs(extraArgs);
  if (parsed.sourceRoots.length > 0) {
    await writeOpenScoutSettings({
      discovery: {
        workspaceRoots: parsed.sourceRoots,
      },
    }, {
      currentDirectory: setupCurrentDirectory,
    });
  }

  const setup = await initializeOpenScoutSetup({ currentDirectory: setupCurrentDirectory });
  const catalog = await loadHarnessCatalogSnapshot();
  let broker = await brokerServiceStatus();
  let brokerWarning: string | null = null;
  try {
    broker = await startBrokerService();
  } catch (error) {
    brokerWarning = error instanceof Error ? error.message : String(error);
    broker = await brokerServiceStatus();
  }

  console.log("OpenScout initialized.");
  console.log(`Support directory: ${setup.supportDirectory}`);
  console.log(`Settings: ${setup.settingsPath}`);
  console.log(`Harness catalog: ${setup.harnessCatalogPath}`);
  console.log(`Agent registry: ${setup.relayAgentsPath}`);
  console.log(`Current project config: ${setup.currentProjectConfigPath ?? "not created"}`);
  console.log(`Created project config: ${setup.createdProjectConfig ? "yes" : "no"}`);
  console.log("");
  console.log("Source roots:");
  for (const root of setup.settings.discovery.workspaceRoots) {
    console.log(`  - ${root}`);
  }
  console.log("");
  printProjectInventory(setup.projectInventory);
  console.log("");
  console.log("Broker:");
  console.log(`  Label: ${broker.label}`);
  console.log(`  URL: ${broker.brokerUrl}`);
  console.log(`  Reachable: ${broker.reachable ? "yes" : "no"}`);
  console.log(`  LaunchAgent: ${broker.launchAgentPath}`);
  console.log(`  Logs: ${broker.stdoutLogPath} | ${broker.stderrLogPath}`);
  if (brokerWarning) {
    console.log(`  Warning: ${brokerWarning}`);
  }
  console.log("");
  console.log("Harnesses:");
  for (const entry of catalog.entries) {
    console.log(`  - ${entry.label} (${entry.name})`);
    console.log(`    State: ${entry.readinessReport.state}`);
    console.log(`    Detail: ${entry.readinessReport.detail}`);
  }
  console.log("");
  console.log("Vocabulary:");
  console.log("  Source root: the parent folder that contains your repos, such as ~/dev");
  console.log("  Harness: the assistant family a project prefers by default, such as claude or codex");
  console.log("  Runtime: the local installed program or session OpenScout uses to launch that harness");
  console.log("");
  console.log("Next:");
  console.log("  scout doctor");
  console.log("  scout runtimes");
}

async function runRuntimes(extraArgs: string[]) {
  if (extraArgs.length > 0) {
    fail(`unexpected arguments for runtimes: ${extraArgs.join(" ")}`);
  }

  const snapshot = await loadHarnessCatalogSnapshot();

  console.log(`Harness catalog: ${supportPaths.harnessCatalogPath}`);
  console.log(`Known runtimes: ${snapshot.entries.length}`);
  for (const entry of snapshot.entries) {
    const support = Object.entries(entry.support)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key)
      .join(", ");

    console.log(`  - ${entry.label} (${entry.name})`);
    console.log(`    State: ${entry.readinessReport.state}`);
    console.log(`    Detail: ${entry.readinessReport.detail}`);
    console.log(`    Support: ${support || "none"}`);
    if (entry.readinessReport.binaryPath) {
      console.log(`    Binary: ${entry.readinessReport.binaryPath}`);
    }
    if (entry.readinessReport.missing.length > 0) {
      console.log(`    Missing: ${entry.readinessReport.missing.join(" | ")}`);
    }
    if (entry.readinessReport.loginCommand) {
      console.log(`    Login: ${entry.readinessReport.loginCommand}`);
    }
  }
}

function parseInitArgs(args: string[]): { sourceRoots: string[] } {
  const sourceRoots: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index] ?? "";
    if (current === "--source-root") {
      const value = args[index + 1];
      if (!value) {
        fail("missing value for --source-root");
      }
      sourceRoots.push(resolve(value));
      index += 1;
      continue;
    }
    if (current.startsWith("--source-root=")) {
      sourceRoots.push(resolve(current.slice("--source-root=".length)));
      continue;
    }
    fail(`unexpected arguments for init: ${args.join(" ")}`);
  }

  return { sourceRoots };
}

function printProjectInventory(projects: ProjectInventoryEntry[]) {
  console.log(`Project inventory: ${projects.length}`);
  if (projects.length === 0) {
    console.log("  No projects discovered yet.");
    return;
  }

  for (const project of projects) {
    const harnesses = project.harnesses
      .map((entry) => `${entry.harness} (${entry.detail})`)
      .join(" | ");

    console.log(`  - ${project.displayName} (${project.agentId})`);
    console.log(`    Root: ${project.projectRoot}`);
    console.log(`    Source root: ${project.sourceRoot}`);
    console.log(`    Relative path: ${project.relativePath}`);
    console.log(`    State: ${project.registrationKind === "configured" ? "configured agent" : "discovered project"}`);
    console.log(`    Default harness: ${project.defaultHarness}`);
    console.log(`    Harnesses: ${harnesses}`);
    if (project.projectConfigPath) {
      console.log(`    Manifest: ${project.projectConfigPath}`);
    }
  }
}

async function runDevCommand(sub: string | undefined, passthrough: string[]) {
  await runScoutDev(sub ? [sub, ...passthrough] : ["help"]);
}

async function runScopedNativeCommand(
  target: "app" | "agent",
  sub: string | undefined,
  passthrough: string[],
) {
  switch (sub) {
    case "build":
    case "rebuild":
    case "launch":
    case "relaunch":
    case "quit":
    case "status":
    case "clean":
      await runScoutDev([sub, target, ...passthrough]);
      break;
    default:
      fail(`unknown ${target} command: ${sub ?? "(missing)"}`);
  }
}

async function runScoutDev(devArgs: string[]) {
  if (!existsSync(scoutDevScript)) {
    fail("scout-dev is missing from this repo");
  }

  const exitCode = await new Promise<number>((resolvePromise) => {
    const child = spawn(scoutDevScript, devArgs, {
      cwd: repoRoot,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      resolvePromise(code ?? 0);
    });
  });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}
