#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  brokerServiceStatus,
  initializeOpenScoutSetup,
  loadResolvedRelayAgents,
  resolveOpenScoutSupportPaths,
  startBrokerService,
} from "@openscout/runtime";

const VERSION = "0.1.0";
const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../..");
const supportPaths = resolveOpenScoutSupportPaths();
const scoutDevScript = join(repoRoot, "scripts", "scout-dev");

const args = process.argv.slice(2);
const [command = "help", subcommand, ...rest] = args;

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
    await runInit(rest);
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
  scout init
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
  doctor         Show local OpenScout environment status
  init           Set up OpenScout for the current repo and your workspace roots
  dev            Pass native developer commands through to scout-dev
  app            Run a scoped native app command through scout-dev
  agent          Run a scoped native agent command through scout-dev
`);
}

async function runDoctor() {
  const broker = await brokerServiceStatus();
  const setup = await loadResolvedRelayAgents({ currentDirectory: process.cwd() });

  console.log(`OpenScout CLI: ${VERSION}`);
  console.log(`Repo root: ${repoRoot}`);
  console.log(`Support directory: ${setup.supportDirectory}`);
  console.log(`Settings: ${setup.settingsPath}`);
  console.log(`Relay agents: ${setup.relayAgentsPath}`);
  console.log(`Relay hub: ${setup.relayHubPath}`);
  console.log(`Current project config: ${setup.currentProjectConfigPath ?? "not found"}`);
  console.log("");
  console.log("Workspace roots:");
  for (const root of setup.settings.discovery.workspaceRoots) {
    console.log(`  - ${root}`);
  }
  console.log("");
  console.log("Agent defaults:");
  console.log(`  Harness: ${setup.settings.agents.defaultHarness}`);
  console.log(`  Transport: ${setup.settings.agents.defaultTransport}`);
  console.log(`  Capabilities: ${setup.settings.agents.defaultCapabilities.join(", ")}`);
  console.log(`  Session prefix: ${setup.settings.agents.sessionPrefix}`);
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
  console.log(`Discovered relay agents: ${setup.agents.length}`);
  for (const agent of setup.agents) {
    const runtimeDir = join(supportPaths.relayAgentsDirectory, agent.agentId);
    const logsDir = join(runtimeDir, "logs");
    console.log(`  - ${agent.displayName} (${agent.agentId})`);
    console.log(`    Root: ${agent.projectRoot}`);
    console.log(`    Source: ${agent.source}`);
    console.log(`    Harness: ${agent.runtime.harness}`);
    console.log(`    Session: ${agent.runtime.sessionId}`);
    console.log(`    Runtime dir: ${runtimeDir}`);
    console.log(`    Logs: ${join(logsDir, "stdout.log")} | ${join(logsDir, "stderr.log")}`);
  }
}

async function runInit(extraArgs: string[]) {
  if (extraArgs.length > 0) {
    fail(`unexpected arguments for init: ${extraArgs.join(" ")}`);
  }

  const setup = await initializeOpenScoutSetup({ currentDirectory: process.cwd() });
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
  console.log(`Relay agents: ${setup.relayAgentsPath}`);
  console.log(`Relay hub: ${setup.relayHubPath}`);
  console.log(`Current project config: ${setup.currentProjectConfigPath ?? "not created"}`);
  console.log(`Created project config: ${setup.createdProjectConfig ? "yes" : "no"}`);
  console.log("");
  console.log("Workspace roots:");
  for (const root of setup.settings.discovery.workspaceRoots) {
    console.log(`  - ${root}`);
  }
  console.log("");
  console.log("Relay agents:");
  for (const agent of setup.agents) {
    console.log(`  - ${agent.displayName} (${agent.agentId})`);
    console.log(`    Root: ${agent.projectRoot}`);
    console.log(`    Source: ${agent.source}`);
    console.log(`    Harness: ${agent.runtime.harness}`);
    console.log(`    Session: ${agent.runtime.sessionId}`);
  }
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
