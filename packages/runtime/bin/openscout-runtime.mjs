#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(binDir, "..");
const distDir = resolve(binDir, "../dist");
const sourceDir = resolve(binDir, "../src");
const sourceMain = {
  broker: resolve(sourceDir, "broker-daemon.ts"),
  service: resolve(sourceDir, "broker-service.ts"),
  discover: resolve(sourceDir, "mesh-discover.ts"),
};
const distMain = {
  broker: resolve(distDir, "broker-daemon.js"),
  service: resolve(distDir, "broker-service.js"),
  discover: resolve(distDir, "mesh-discover.js"),
};
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const [, , command = "service", ...args] = process.argv;

if (!(command in sourceMain)) {
  console.error(`Unknown openscout-runtime command: ${command}`);
  process.exit(1);
}

const distEntry = distMain[command];
if (existsSync(distEntry)) {
  const child = spawn(process.execPath, [distEntry, ...args], {
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
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

  const child = spawn(process.execPath, [rebuiltEntry, ...args], {
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}
