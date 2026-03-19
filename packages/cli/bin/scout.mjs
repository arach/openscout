#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(binDir, "../dist/main.mjs");
const sourceEntry = resolve(binDir, "../src/main.ts");

if (existsSync(distEntry)) {
  await import(distEntry);
} else {
  const child = spawn("bun", [sourceEntry, ...process.argv.slice(2)], {
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
