#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const entryFile = resolve(packageDirectory, "src/main.ts");
const outputDirectory = resolve(packageDirectory, "dist");
const outputFile = resolve(outputDirectory, "main.mjs");
const scoutAppServerEntry = resolve(packageDirectory, "../../apps/scout/src/server/index.ts");
const webServerOutput = resolve(outputDirectory, "scout-web-server.mjs");

mkdirSync(outputDirectory, { recursive: true });

// Use --outdir so bun can emit WASM/asset side-files alongside the main bundle
const result = spawnSync(
  "bun",
  ["build", entryFile, "--target=node", "--outdir", outputDirectory],
  { cwd: packageDirectory, stdio: "inherit" },
);

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

const webResult = spawnSync(
  "bun",
  [
    "build",
    scoutAppServerEntry,
    "--target=bun",
    "--format=esm",
    "--outfile",
    webServerOutput,
  ],
  { cwd: packageDirectory, stdio: "inherit" },
);

if ((webResult.status ?? 1) !== 0) {
  process.exit(webResult.status ?? 1);
}

// bun names the entry output after the source file (main.js); rename to main.mjs
const bunOutput = resolve(outputDirectory, "main.js");
if (existsSync(bunOutput) && bunOutput !== outputFile) {
  renameSync(bunOutput, outputFile);
}

const built = readFileSync(outputFile, "utf8");
const normalized = built
  .replace(/^#![^\n]*\n/, "")
  .replace(/^\/\/ @bun\n/, "");

writeFileSync(outputFile, `#!/usr/bin/env node\n${normalized}`);
chmodSync(outputFile, 0o755);
