#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(binDir, "..");
const distDir = resolve(binDir, "../dist");
const sourceDir = resolve(binDir, "../src");
const sourceMain = {
  base: resolve(sourceDir, "base-daemon.ts"),
  broker: resolve(sourceDir, "broker-daemon.ts"),
  service: resolve(sourceDir, "broker-process-manager.ts"),
  discover: resolve(sourceDir, "mesh-discover.ts"),
};
const distMain = {
  base: resolve(distDir, "base-daemon.js"),
  broker: resolve(distDir, "broker-daemon.js"),
  service: resolve(distDir, "broker-process-manager.js"),
  discover: resolve(distDir, "mesh-discover.js"),
};
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const [, , command = "service", ...args] = process.argv;

if (!(command in sourceMain)) {
  console.error(`Unknown openscout-runtime command: ${command}`);
  process.exit(1);
}

function runEntrypoint(entry, entryArgs) {
  const captureOutput = command === "service";
  const result = spawnSync(process.execPath, [entry, ...entryArgs], captureOutput
    ? {
        encoding: "utf8",
        stdio: ["inherit", "pipe", "pipe"],
      }
    : {
        stdio: "inherit",
      });

  if (captureOutput) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  }

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }

  process.exit(result.status ?? 0);
}

const distEntry = distMain[command];
if (existsSync(distEntry)) {
  runEntrypoint(distEntry, args);
} else {
  const buildResult = spawnSync(npmCommand, ["run", "build"], {
    cwd: packageDir,
    stdio: "inherit",
  });

  if ((buildResult.status ?? 1) !== 0) {
    process.exit(buildResult.status ?? 1);
  }

  const rebuiltEntry = distMain[command];
  if (!existsSync(rebuiltEntry)) {
    console.error(`Missing openscout-runtime dist entry for ${command} after build.`);
    process.exit(1);
  }

  runEntrypoint(rebuiltEntry, args);
}
