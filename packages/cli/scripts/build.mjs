#!/usr/bin/env node

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  copyFileSync,
  statSync,
  renameSync,
  existsSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildControlPlaneClientAndCopy,
  bundleScoutWebServerBun,
  bundleScoutControlPlaneWebServerBun,
  bundleScoutTerminalRelayNode,
  getOpenScoutRepoRoot,
  verifyBundleStaticChecks,
} from "../../../scripts/bundle-scout-web.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const repoRoot = getOpenScoutRepoRoot();
const entryFile = resolve(packageDirectory, "src/main.ts");
const statuslineEntryFile = resolve(packageDirectory, "src/statusline.ts");
const outputDirectory = resolve(packageDirectory, "dist");
const outputFile = resolve(outputDirectory, "main.mjs");
const statuslineOutput = resolve(outputDirectory, "statusline.mjs");
const webServerOutput = resolve(outputDirectory, "scout-web-server.mjs");
const controlPlaneWebOutput = resolve(outputDirectory, "scout-control-plane-web.mjs");
const terminalRelayOutput = resolve(outputDirectory, "openscout-terminal-relay.mjs");
const pairingRuntimeControllerOutput = resolve(outputDirectory, "pairing-runtime-controller.mjs");
const runtimeOutputDirectory = resolve(outputDirectory, "runtime");
const clientDir = resolve(outputDirectory, "client");

// The published @openscout/scout package root is what broker-process-manager's
// resolveScoutdCommand() treats as `runtimePackageDir` at runtime, and its first
// (preferred) package candidate is `<runtimePackageDir>/bin/scoutd`. Drop the
// prebuilt scoutd release artifact there so npm-installed users (no monorepo,
// no Rust toolchain) get a working broker service without falling back to
// building from source. The current package artifact is Apple Silicon macOS;
// support for other architectures should add first-class platform artifacts,
// not loosen this install path into source-build or cross-arch fallbacks.
const scoutdReleaseBinary = resolve(repoRoot, "target", "release", "scoutd");
const scoutdPackagedBinary = resolve(packageDirectory, "bin", "scoutd");
const scoutdSignScript = resolve(repoRoot, "scripts", "sign-scoutd.sh");

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

const statuslineResult = spawnSync(
  "bun",
  ["build", statuslineEntryFile, "--target=bun", "--format=esm", "--outfile", statuslineOutput],
  { cwd: packageDirectory, stdio: "inherit" },
);

if ((statuslineResult.status ?? 1) !== 0) {
  process.exit(statuslineResult.status ?? 1);
}

if (!bundleScoutTerminalRelayNode(repoRoot, terminalRelayOutput)) {
  process.exit(1);
}

// The control-plane web bundle boot smoke test initializes enough server
// wiring to resolve the broker service helper. Package scoutd before that
// smoke test so dev and release builds exercise the same packaged binary path.
if (!buildAndPackageScoutd()) {
  process.exit(1);
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

// Whether the broker service binary MUST be present when this build finishes.
// Publishing without it silently recreates the "Unable to locate scoutd"
// regression for npm-installed users, so any publish path must fail loudly.
// Ordinary dev builds (`npm run build` without Rust installed) only warn.
function scoutdIsRequired() {
  if (process.env.OPENSCOUT_REQUIRE_SCOUTD === "1") return true;
  if (process.env.OPENSCOUT_SKIP_SCOUTD === "1") return false;
  // npm sets these during `npm publish` / the prepack lifecycle.
  if (process.env.npm_command === "publish") return true;
  if (process.env.npm_lifecycle_event === "prepack") return true;
  return false;
}

function describeBinary(file) {
  const result = spawnSync("file", [file], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return (result.stdout || result.stderr || "").trim();
}

function scoutdIsExpectedPackageBinary(file) {
  return describeBinary(file).includes("Mach-O 64-bit executable arm64");
}

function buildAndPackageScoutd() {
  const required = scoutdIsRequired();
  const cargoScript = resolve(repoRoot, "scripts", "cargo.sh");

  console.log("  building scoutd (release)…");
  const build = spawnSync(
    "bash",
    [
      cargoScript,
      "build",
      "--release",
      "--manifest-path",
      resolve(repoRoot, "crates", "scoutd", "Cargo.toml"),
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );

  if ((build.status ?? 1) !== 0) {
    // cargo.sh exits 127 when no cargo toolchain is found.
    const message =
      build.status === 127
        ? "cargo not found; cannot build the scoutd broker service binary"
        : `scoutd build failed (exit ${build.status ?? "unknown"})`;
    if (required) {
      console.error(`  ERROR: ${message}.`);
      console.error("  Publishing without scoutd would ship a broken broker service.");
      console.error("  Install Rust (https://rustup.rs) or set CARGO=/path/to/cargo, then retry.");
      return false;
    }
    console.warn(`  WARN: ${message}; skipping scoutd packaging (dev build).`);
    console.warn("  The broker service will not work from an npm install built this way.");
    return true;
  }

  if (!existsSync(scoutdReleaseBinary)) {
    console.error(`  ERROR: scoutd build reported success but ${scoutdReleaseBinary} is missing.`);
    return !required;
  }

  if (!scoutdIsExpectedPackageBinary(scoutdReleaseBinary)) {
    const description = describeBinary(scoutdReleaseBinary) || "unknown binary format";
    const message = `scoutd package binary must be a macOS arm64 Mach-O (the current Apple Silicon release artifact), got: ${description}`;
    if (required) {
      console.error(`  ERROR: ${message}.`);
      console.error("  Publishing this binary would ship the wrong native executable for the current package.");
      return false;
    }
    console.warn(`  WARN: ${message}; skipping scoutd packaging (dev build).`);
    rmSync(scoutdPackagedBinary, { force: true });
    return true;
  }

  // NOTE/STOPGAP: we copy the host-built darwin-arm64 binary straight into the
  // package. Apple Silicon macOS is the first-class release path today. If
  // platform support expands, select first-class prebuilts per {os, cpu}
  // instead of accepting mismatched binaries or source-build fallbacks.
  mkdirSync(dirname(scoutdPackagedBinary), { recursive: true });
  copyFileSync(scoutdReleaseBinary, scoutdPackagedBinary);
  chmodSync(scoutdPackagedBinary, 0o755);
  const sign = spawnSync(
    "bash",
    [scoutdSignScript, scoutdReleaseBinary, scoutdPackagedBinary],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if ((sign.status ?? 1) !== 0) {
    if (required || process.env.OPENSCOUT_REQUIRE_SCOUTD_SIGN === "1") {
      console.error("  ERROR: scoutd signing failed.");
      return false;
    }
    console.warn("  WARN: scoutd signing failed; continuing because this is a dev build.");
  }
  const sizeMb = (statSync(scoutdPackagedBinary).size / (1024 * 1024)).toFixed(1);
  console.log(`  packaged scoutd -> ${scoutdPackagedBinary} (${sizeMb} MB, darwin-arm64)`);
  return true;
}

const pairingRuntimeControllerEntry = resolve(repoRoot, "packages", "web", "server", "pairing-runtime-controller.ts");
const pairingRuntimeControllerResult = spawnSync(
  "bun",
  ["build", pairingRuntimeControllerEntry, "--target=bun", "--format=esm", "--outfile", pairingRuntimeControllerOutput],
  { cwd: packageDirectory, stdio: "inherit" },
);

if ((pairingRuntimeControllerResult.status ?? 1) !== 0) {
  process.exit(pairingRuntimeControllerResult.status ?? 1);
}

if (!buildControlPlaneClientAndCopy(repoRoot, clientDir)) {
  process.exit(1);
}

// bun names the entry output after the source file (main.js); rename to main.mjs
const bunOutput = resolve(outputDirectory, "main.js");
if (existsSync(bunOutput) && bunOutput !== outputFile) {
  renameSync(bunOutput, outputFile);
}

function normalizeBunExecutable(path) {
  const built = readFileSync(path, "utf8");
  const normalized = built
    .replace(/^#![^\n]*\n/, "")
    .replace(/^\/\/ @bun\n/, "");

  writeFileSync(path, `#!/usr/bin/env bun\n${normalized}`);
  chmodSync(path, 0o755);
}

normalizeBunExecutable(outputFile);
normalizeBunExecutable(statuslineOutput);

for (const built of [outputFile, statuslineOutput, pairingRuntimeControllerOutput, terminalRelayOutput]) {
  if (!verifyBundleStaticChecks(built)) {
    process.exit(1);
  }
}
