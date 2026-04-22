#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const viteBin = resolve(packageDirectory, "node_modules/vite/bin/vite.js");
const viteUrl = new URL(
  process.env.OPENSCOUT_WEB_VITE_URL?.trim() || "http://127.0.0.1:5180",
);
const viteHost = viteUrl.hostname || "127.0.0.1";
const vitePort =
  viteUrl.port || (viteUrl.protocol === "https:" ? "443" : "80");

if (!existsSync(viteBin)) {
  console.error(
    "@openscout/web: missing local Vite install. Run the workspace install first.",
  );
  process.exit(1);
}

const env = {
  ...process.env,
  OPENSCOUT_WEB_VITE_URL: viteUrl.origin,
};

const children = [
  spawn(
    process.execPath,
    [viteBin, "--host", viteHost, "--port", vitePort, "--strictPort"],
    {
      cwd: packageDirectory,
      env,
      stdio: "inherit",
    },
  ),
  spawn("bun", ["run", "--hot", "server/index.ts"], {
    cwd: packageDirectory,
    env,
    stdio: "inherit",
  }),
];

let exiting = false;

function shutdown(code = 0) {
  if (exiting) {
    return;
  }
  exiting = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  process.exit(code);
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(
      `@openscout/web: failed to start dev process: ${error.message}`,
    );
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (exiting) {
      return;
    }
    if (signal === "SIGINT" || signal === "SIGTERM") {
      shutdown(0);
      return;
    }
    shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
