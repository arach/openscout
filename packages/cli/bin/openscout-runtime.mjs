#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const runtimeDistDir = resolve(binDir, "../dist/runtime");

const entrypoints = {
  broker: resolve(runtimeDistDir, "broker-daemon.mjs"),
  service: resolve(runtimeDistDir, "broker-process-manager.mjs"),
  discover: resolve(runtimeDistDir, "mesh-discover.mjs"),
};

const [, , command = "service", ...args] = process.argv;
const entrypoint = entrypoints[command];

if (!entrypoint) {
  console.error(`Unknown openscout-runtime command: ${command}`);
  process.exit(1);
}

if (!existsSync(entrypoint)) {
  console.error(
    "Scout runtime dist entry is missing. Reinstall @openscout/scout or rebuild the package.",
  );
  process.exit(1);
}

const child = spawn(process.execPath, [entrypoint, ...args], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
