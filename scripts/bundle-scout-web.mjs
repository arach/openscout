#!/usr/bin/env node
/**
 * Shared steps: Bun-bundle the Scout Hono server for @openscout/scout, and copy the
 * relevant Vite clients into dist/ for published packages.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function getOpenScoutRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * @param {string} repoRoot
 * @param {string} outfile Absolute path to scout-web-server.mjs
 * @returns {boolean}
 */
export function bundleScoutWebServerBun(repoRoot, outfile) {
  mkdirSync(dirname(outfile), { recursive: true });
  const entry = resolve(repoRoot, "apps/scout/src/server/index.ts");
  const result = spawnSync(
    "bun",
    ["build", entry, "--target=bun", "--format=esm", "--outfile", outfile],
    { cwd: repoRoot, stdio: "inherit" },
  );
  return (result.status ?? 1) === 0;
}

/**
 * Pairing + relay activity HTTP surface for `@openscout/web` (no full desktop web API).
 *
 * @param {string} repoRoot
 * @param {string} outfile Absolute path to scout-control-plane-web.mjs
 * @returns {boolean}
 */
export function bundleScoutControlPlaneWebServerBun(repoRoot, outfile) {
  mkdirSync(dirname(outfile), { recursive: true });
  const entry = resolve(repoRoot, "apps/scout/src/server/control-plane-index.ts");
  const result = spawnSync(
    "bun",
    ["build", entry, "--target=bun", "--format=esm", "--outfile", outfile],
    { cwd: repoRoot, stdio: "inherit" },
  );
  return (result.status ?? 1) === 0;
}

/**
 * Run Vite client build in packages/web and copy dist/client → targetClientDir.
 * @param {string} repoRoot
 * @param {string} targetClientDir e.g. packages/cli/dist/control-plane-client
 * @returns {boolean}
 */
export function buildControlPlaneClientAndCopy(repoRoot, targetClientDir) {
  const controlPlaneApp = resolve(repoRoot, "packages/web");
  const build = spawnSync("npm", ["run", "build"], {
    cwd: controlPlaneApp,
    stdio: "inherit",
  });
  if ((build.status ?? 1) !== 0) {
    return false;
  }
  const source = resolve(controlPlaneApp, "dist/client");
  const indexHtml = resolve(source, "index.html");
  if (!existsSync(indexHtml)) {
    console.error("[bundle-scout-web] expected control-plane index.html after build at", indexHtml);
    return false;
  }
  rmSync(targetClientDir, { recursive: true, force: true });
  mkdirSync(dirname(targetClientDir), { recursive: true });
  cpSync(source, targetClientDir, { recursive: true });
  return true;
}

/**
 * Run Vite client build in electron-app and copy dist/client → targetClientDir.
 * @param {string} repoRoot
 * @param {string} targetClientDir e.g. packages/cli/dist/client
 * @returns {boolean}
 */
export function buildElectronClientAndCopy(repoRoot, targetClientDir) {
  const electronApp = resolve(repoRoot, "packages/electron-app");
  const build = spawnSync("npm", ["run", "build:client"], {
    cwd: electronApp,
    stdio: "inherit",
  });
  if ((build.status ?? 1) !== 0) {
    return false;
  }
  const source = resolve(electronApp, "dist/client");
  const indexHtml = resolve(source, "index.html");
  if (!existsSync(indexHtml)) {
    console.error("[bundle-scout-web] expected index.html after build:client at", indexHtml);
    return false;
  }
  rmSync(targetClientDir, { recursive: true, force: true });
  mkdirSync(dirname(targetClientDir), { recursive: true });
  cpSync(source, targetClientDir, { recursive: true });
  return true;
}
