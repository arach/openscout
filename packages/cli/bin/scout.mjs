#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(binDir, "../dist/main.mjs");
const packageJsonPath = resolve(binDir, "../package.json");

if (!process.env.SCOUT_APP_VERSION && existsSync(packageJsonPath)) {
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (typeof packageJson.version === "string" && packageJson.version.trim()) {
      process.env.SCOUT_APP_VERSION = packageJson.version.trim();
    }
  } catch {
    // Ignore package metadata read failures and fall back to the shared constant.
  }
}

if (!existsSync(distEntry)) {
  console.error("Scout CLI dist entry is missing. Reinstall @openscout/scout or rebuild the package.");
  process.exit(1);
}

await import(pathToFileURL(distEntry).href);
