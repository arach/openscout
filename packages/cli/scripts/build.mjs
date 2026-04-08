#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildControlPlaneClientAndCopy,
  bundleScoutControlPlaneWebServerBun,
  bundleScoutWebServerBun,
  buildElectronClientAndCopy,
  getOpenScoutRepoRoot,
} from "../../../scripts/bundle-scout-web.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const repoRoot = getOpenScoutRepoRoot();
const entryFile = resolve(packageDirectory, "src/main.ts");
const outputDirectory = resolve(packageDirectory, "dist");
const outputFile = resolve(outputDirectory, "main.mjs");
const webServerOutput = resolve(outputDirectory, "scout-web-server.mjs");
const controlPlaneWebOutput = resolve(outputDirectory, "scout-control-plane-web.mjs");
const vendoredClientDir = resolve(outputDirectory, "client");
const controlPlaneClientDir = resolve(outputDirectory, "control-plane-client");

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

if (!bundleScoutWebServerBun(repoRoot, webServerOutput)) {
  process.exit(1);
}

if (!bundleScoutControlPlaneWebServerBun(repoRoot, controlPlaneWebOutput)) {
  process.exit(1);
}

if (!buildElectronClientAndCopy(repoRoot, vendoredClientDir)) {
  process.exit(1);
}

if (!buildControlPlaneClientAndCopy(repoRoot, controlPlaneClientDir)) {
  process.exit(1);
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
