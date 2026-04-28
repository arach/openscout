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
  if (!verifyBundleStaticChecks(outfile)) {
    return false;
  }
  return verifyScoutWebBundleBoots(outfile);
}

/**
 * Public: run static checks on any built bundle and fail loudly if it would
 * crash at module-load. Wire this into build pipelines (main.mjs,
 * pair-supervisor.mjs, scout-control-plane-web.mjs) so a bare reference to a
 * Node API without a matching import is caught before publish.
 *
 * @param {string} outfile
 * @returns {boolean}
 */
export function verifyBundleStaticChecks(outfile) {
  const bundle = readFileSync(outfile, "utf8");

  const referencesPromiseAll = /\b__promiseAll\s*\(/.test(bundle);
  const definesPromiseAll = /\b(function|var|let|const)\s+__promiseAll\b/.test(bundle);
  if (referencesPromiseAll && !definesPromiseAll) {
    console.error(
      `[bundle-scout-web] unresolved __promiseAll helper emitted in ${outfile}; refusing to ship a broken bundle`,
    );
    return false;
  }

  // Catch the 0.2.61 class of bug: a bare callsite like `existsSync(...)` with
  // no plain (unaliased) import of `existsSync`. Bun aliases identifiers when
  // multiple modules import the same symbol, so a bare callsite is only safe
  // if it has a matching unaliased import. If neither holds, the bundle will
  // ReferenceError at module-load.
  const fragileSymbols = [
    "existsSync",
    "readFileSync",
    "writeFileSync",
    "statSync",
    "mkdirSync",
    "rmSync",
    "readdirSync",
    "renameSync",
  ];

  for (const symbol of fragileSymbols) {
    const callsiteRegex = new RegExp(String.raw`(?:^|[^A-Za-z0-9_$])${symbol}\s*\(`, "m");
    if (!callsiteRegex.test(bundle)) {
      continue;
    }
    // A safe callsite needs an unaliased import of the same symbol somewhere
    // in the bundle: `import { ..., existsSync, ... } from "fs"` or the
    // node:fs equivalent, where existsSync is NOT followed by ` as `.
    const importRegex = new RegExp(
      String.raw`import\s*\{[^}]*\b${symbol}\b(?!\s+as\b)[^}]*\}\s*from\s*["'](?:node:)?fs(?:/promises)?["']`,
      "m",
    );
    if (importRegex.test(bundle)) {
      continue;
    }
    console.error(
      `[bundle-scout-web] bare ${symbol}() callsite in ${outfile} with no matching unaliased import; refusing to ship.`,
    );
    return false;
  }

  return true;
}

const SCOUT_WEB_BUNDLE_BOOT_PATTERNS = [
  { name: "ReferenceError", regex: /ReferenceError/ },
  { name: "undefined-binding", regex: /\bis not defined\b/ },
  { name: "SyntaxError", regex: /SyntaxError/ },
  { name: "Cannot find module", regex: /Cannot find module/ },
  { name: "TypeError-undefined", regex: /TypeError:[^\n]*undefined/ },
  { name: "bun-error", regex: /^error: /im },
];

/**
 * Boot the bundle in a sandboxed env for ~5s and fail if module-load
 * surfaces a ReferenceError or similar bundler regression. Catches the
 * 0.2.61 class of failures (bare `existsSync`, unresolved helpers) before
 * publish.
 *
 * @param {string} outfile
 * @returns {boolean}
 */
function verifyScoutWebBundleBoots(outfile) {
  const env = {
    ...process.env,
    OPENSCOUT_WEB_PORT: "0",
    OPENSCOUT_BROKER_HOST: "127.0.0.1",
    OPENSCOUT_BROKER_PORT: "1",
    OPENSCOUT_WEB_VITE_URL: "",
    OPENSCOUT_WEB_STATIC_ROOT: "",
    OPENSCOUT_WEB_IDLE_TIMEOUT_SECONDS: "5",
    NODE_ENV: "production",
  };

  const result = spawnSync("bun", ["run", outfile], {
    timeout: 5000,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error && result.error.code === "ENOENT") {
    console.error(
      `[bundle-scout-web] bun not on PATH; skipping boot smoke-test for ${outfile}. Install Bun (https://bun.sh) on the build machine.`,
    );
    return true;
  }

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  for (const { name, regex } of SCOUT_WEB_BUNDLE_BOOT_PATTERNS) {
    if (regex.test(output)) {
      console.error(
        `[bundle-scout-web] boot smoke-test failed (${name}) for ${outfile}; refusing to ship a broken Scout web bundle.\n--- captured output ---\n${output.slice(0, 4000)}\n--- end output ---`,
      );
      return false;
    }
  }

  if (result.signal !== "SIGTERM" && (result.status ?? 1) !== 0) {
    console.error(
      `[bundle-scout-web] boot smoke-test exited with status ${result.status} signal ${result.signal} for ${outfile}.\n--- captured output ---\n${output.slice(0, 4000)}\n--- end output ---`,
    );
    return false;
  }

  return true;
}
