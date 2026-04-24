#!/usr/bin/env node
/**
 * Shared steps: Bun-bundle the Scout web servers for @openscout/scout, and copy the
 * relevant Vite clients into dist/ for published packages.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function getOpenScoutRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * Compatibility bundle for older packaging entry names. This now builds the
 * current @openscout/web server instead of the retired desktop web server.
 *
 * @param {string} repoRoot
 * @param {string} outfile Absolute path to scout-web-server.mjs
 * @returns {boolean}
 */
export function bundleScoutWebServerBun(repoRoot, outfile) {
  mkdirSync(dirname(outfile), { recursive: true });
  const entry = resolve(repoRoot, "packages/web/server/index.ts");
  const result = spawnSync(
    "bun",
    ["build", entry, "--target=bun", "--format=esm", "--outfile", outfile, "--external", "vite"],
    { cwd: repoRoot, stdio: "inherit" },
  );
  return (result.status ?? 1) === 0;
}

/**
 * Bundle the @openscout/web server for the published CLI.
 *
 * @param {string} repoRoot
 * @param {string} outfile Absolute path to scout-control-plane-web.mjs
 * @returns {boolean}
 */
export function bundleScoutControlPlaneWebServerBun(repoRoot, outfile) {
  mkdirSync(dirname(outfile), { recursive: true });
  const entry = resolve(repoRoot, "packages/web/server/index.ts");
  const result = spawnSync(
    "bun",
    ["build", entry, "--target=bun", "--format=esm", "--outfile", outfile, "--external", "vite"],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if ((result.status ?? 1) !== 0) {
    return false;
  }
  return verifyScoutWebBundle(outfile);
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

function verifyScoutWebBundle(outfile) {
  const bundle = readFileSync(outfile, "utf8");
  const referencesPromiseAll = /\b__promiseAll\s*\(/.test(bundle);
  const definesPromiseAll = /\b(function|var|let|const)\s+__promiseAll\b/.test(bundle);

  if (referencesPromiseAll && !definesPromiseAll) {
    console.error(
      `[bundle-scout-web] unresolved __promiseAll helper emitted in ${outfile}; refusing to ship a broken Scout web bundle`,
    );
    return false;
  }

  return true;
}
