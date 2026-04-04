#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(binDir, "../dist/main.mjs");

if (!existsSync(distEntry)) {
  console.error("Scout CLI dist entry is missing. Reinstall @openscout/cli or rebuild the package.");
  process.exit(1);
}

await import(pathToFileURL(distEntry).href);
