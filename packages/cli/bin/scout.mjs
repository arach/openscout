#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(binDir, "..");
const distEntry = resolve(binDir, "../dist/main.mjs");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

if (!existsSync(distEntry)) {
  const result = spawnSync(npmCommand, ["run", "build"], {
    cwd: packageDir,
    stdio: "inherit",
  });

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(distEntry)) {
  console.error("Scout CLI dist entry is missing after build.");
  process.exit(1);
}

await import(pathToFileURL(distEntry).href);
