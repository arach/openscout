#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const runtimeDistDir = resolve(binDir, "../dist/runtime");

const entrypoints = {
  base: resolve(runtimeDistDir, "base-daemon.mjs"),
  broker: resolve(runtimeDistDir, "broker-daemon.mjs"),
  service: resolve(runtimeDistDir, "broker-process-manager.mjs"),
  discover: resolve(runtimeDistDir, "mesh-discover.mjs"),
};
const processNames = {
  base: "scout-base",
  broker: "scout-broker",
  service: "scout-service",
  discover: "scout-discover",
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

const processName = processNames[command] ?? "scout-runtime";
process.title = processName;

const child = spawn(process.execPath, [entrypoint, ...args], {
  argv0: processName,
  stdio: "inherit",
});

let forwardingSignal = false;
let childExited = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    forwardingSignal = true;
    if (!child.killed) {
      child.kill(signal);
    }
    setTimeout(() => {
      if (!childExited) {
        child.kill("SIGKILL");
      }
    }, 10_000).unref();
  });
}

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  childExited = true;
  if (signal && !forwardingSignal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? (signal ? 0 : 1));
  }
});
