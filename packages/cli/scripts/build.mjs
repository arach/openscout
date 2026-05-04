#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildControlPlaneClientAndCopy,
  bundleScoutWebServerBun,
  bundleScoutControlPlaneWebServerBun,
  getOpenScoutRepoRoot,
  verifyBundleStaticChecks,
} from "../../../scripts/bundle-scout-web.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const repoRoot = getOpenScoutRepoRoot();
const entryFile = resolve(packageDirectory, "src/main.ts");
const outputDirectory = resolve(packageDirectory, "dist");
const outputFile = resolve(outputDirectory, "main.mjs");
const webServerOutput = resolve(outputDirectory, "scout-web-server.mjs");
const controlPlaneWebOutput = resolve(outputDirectory, "scout-control-plane-web.mjs");
const pairSupervisorOutput = resolve(outputDirectory, "pair-supervisor.mjs");
const runtimeOutputDirectory = resolve(outputDirectory, "runtime");
const clientDir = resolve(outputDirectory, "client");

mkdirSync(outputDirectory, { recursive: true });

// Use --outdir so bun can emit WASM/asset side-files alongside the main bundle
const result = spawnSync(
  "bun",
  ["build", entryFile, "--target=bun", "--outdir", outputDirectory],
  { cwd: packageDirectory, stdio: "inherit" },
);

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

if (!bundleScoutControlPlaneWebServerBun(repoRoot, controlPlaneWebOutput)) {
  process.exit(1);
}

if (!bundleScoutWebServerBun(repoRoot, webServerOutput)) {
  process.exit(1);
}

function bundleRuntimeEntrypoint(label, entryFile, outputFile) {
  const result = spawnSync(
    "bun",
    ["build", entryFile, "--target=bun", "--format=esm", "--outfile", outputFile],
    { cwd: repoRoot, stdio: "inherit" },
  );

  if ((result.status ?? 1) !== 0) {
    return false;
  }

  if (!verifyBundleStaticChecks(outputFile)) {
    return false;
  }

  console.log(`  bundled runtime ${label} -> ${outputFile}`);
  return true;
}

function bundleRuntimeEntrypoints() {
  rmSync(runtimeOutputDirectory, { recursive: true, force: true });
  mkdirSync(runtimeOutputDirectory, { recursive: true });

  const entries = [
    ["base", "base-daemon.ts", "base-daemon.mjs"],
    ["broker", "broker-daemon.ts", "broker-daemon.mjs"],
    ["service", "broker-process-manager.ts", "broker-process-manager.mjs"],
    ["discover", "mesh-discover.ts", "mesh-discover.mjs"],
  ];

  for (const [label, source, output] of entries) {
    const entryFile = resolve(repoRoot, "packages", "runtime", "src", source);
    const outputFile = resolve(runtimeOutputDirectory, output);
    if (!bundleRuntimeEntrypoint(label, entryFile, outputFile)) {
      return false;
    }
  }

  return true;
}

if (!bundleRuntimeEntrypoints()) {
  process.exit(1);
}

const pairSupervisorEntry = resolve(repoRoot, "apps", "desktop", "bin", "pair-supervisor.ts");
const pairSupervisorResult = spawnSync(
  "bun",
  ["build", pairSupervisorEntry, "--target=bun", "--format=esm", "--outfile", pairSupervisorOutput],
  { cwd: packageDirectory, stdio: "inherit" },
);

if ((pairSupervisorResult.status ?? 1) !== 0) {
  process.exit(pairSupervisorResult.status ?? 1);
}

if (!buildControlPlaneClientAndCopy(repoRoot, clientDir)) {
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

writeFileSync(outputFile, `#!/usr/bin/env bun\n${normalized}`);
chmodSync(outputFile, 0o755);

for (const built of [outputFile, pairSupervisorOutput]) {
  if (!verifyBundleStaticChecks(built)) {
    process.exit(1);
  }
}
