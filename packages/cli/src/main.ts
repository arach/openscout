#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";
const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../..");
const supportDir = join(homedir(), "Library", "Application Support", "OpenScout");
const statusFile = join(supportDir, "agent-status.json");
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
    runInit(rest);
    break;
  case "app":
    await runAppCommand(subcommand, rest);
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
  scout app launch
  scout app status

Commands:
  help           Show this help text
  version        Print the CLI version
  doctor         Show local OpenScout environment status
  init           Scaffold a future Scout workspace entry point
  app launch     Launch the local Scout app through scout-dev
  app status     Show local Scout app and helper status
`);
}

async function runDoctor() {
  console.log(`OpenScout CLI: ${VERSION}`);
  console.log(`Repo root: ${repoRoot}`);
  console.log(`Support directory: ${supportDir}`);
  console.log(`Status file: ${statusFile}`);
  console.log(`scout-dev: ${existsSync(scoutDevScript) ? "available" : "missing"}`);

  if (existsSync(statusFile)) {
    try {
      const raw = await readFile(statusFile, "utf8");
      console.log("");
      console.log("Heartbeat:");
      console.log(raw.trim());
    } catch (error) {
      fail(`failed to read heartbeat: ${formatError(error)}`);
    }
  } else {
    console.log("");
    console.log("Heartbeat: missing");
  }
}

function runInit(_args: string[]) {
  console.log("`scout init` is not implemented yet.");
  console.log("This package is the scaffold for the long-term user-facing Scout CLI.");
}

async function runAppCommand(sub: string | undefined, passthrough: string[]) {
  switch (sub) {
    case "launch":
      await runScoutDev(["launch", ...passthrough]);
      break;
    case "status":
      await runScoutDev(["status", ...passthrough]);
      break;
    default:
      fail(`unknown app command: ${sub ?? "(missing)"}`);
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

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
