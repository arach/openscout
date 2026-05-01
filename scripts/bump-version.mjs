#!/usr/bin/env node
// Bumper for the release version and public npm package.
//
// Usage:
//   node scripts/bump-version.mjs <new-version>   # e.g. 0.2.39
//   node scripts/bump-version.mjs patch           # 0.2.38 -> 0.2.39
//   node scripts/bump-version.mjs minor           # 0.2.38 -> 0.3.0
//   node scripts/bump-version.mjs major           # 0.2.38 -> 1.0.0
//
// Walks the root release manifest plus every package listed in PUBLIC_PACKAGES
// (lockstep — they share one product version), rewrites their `version` fields,
// and rewrites pinned public package dependency ranges when needed. Internal
// workspace packages stay private and keep their own local versions.

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");

const PUBLIC_PACKAGES = [
  "packages/cli",
];
const VERSIONED_MANIFESTS = [
  ".",
  ...PUBLIC_PACKAGES,
];

const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const BACKUP_FILENAME = ".package.json.publish-backup";

async function readPkg(dir) {
  return JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
}

async function writePkg(dir, pkg) {
  await fs.writeFile(path.join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
}

function bumpSemver(current, kind) {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(current);
  if (!match) throw new Error(`Cannot parse semver: ${current}`);
  let [, maj, min, pat] = match;
  maj = Number(maj); min = Number(min); pat = Number(pat);
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  if (kind === "patch") return `${maj}.${min}.${pat + 1}`;
  throw new Error(`Unknown bump kind: ${kind}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const arg = args.find((a) => !a.startsWith("--"));
  if (!arg) {
    console.error("Usage: bump-version.mjs <version | patch | minor | major> [--dry-run]");
    process.exit(1);
  }

  // Read current version from the public Scout package. The root manifest is
  // synced to that stream for app builds.
  const anchor = await readPkg(path.join(REPO_ROOT, PUBLIC_PACKAGES[0]));
  const currentVersion = anchor.version;

  const nextVersion = ["patch", "minor", "major"].includes(arg)
    ? bumpSemver(currentVersion, arg)
    : arg;

  if (!/^\d+\.\d+\.\d+/.test(nextVersion)) {
    console.error(`Invalid version: ${nextVersion}`);
    process.exit(1);
  }

  if (nextVersion === currentVersion) {
    console.error(`Version is already ${currentVersion} — nothing to bump.`);
    process.exit(1);
  }

  // Map of package-name -> new-version (for pinned cross-package rewrites).
  const rewriteMap = new Map();
  for (const rel of PUBLIC_PACKAGES) {
    const pkg = await readPkg(path.join(REPO_ROOT, rel));
    if (pkg.name) rewriteMap.set(pkg.name, nextVersion);
  }

  let touched = 0;
  for (const rel of VERSIONED_MANIFESTS) {
    const dir = path.join(REPO_ROOT, rel);
    const pkg = await readPkg(dir);
    const priorVersion = pkg.version;
    let changed = false;

    if (pkg.version !== nextVersion) {
      pkg.version = nextVersion;
      changed = true;
    }

    for (const section of DEP_SECTIONS) {
      const deps = pkg[section];
      if (!deps) continue;
      for (const name of Object.keys(deps)) {
        const range = deps[name];
        if (typeof range !== "string") continue;
        if (range.startsWith("workspace:")) continue;
        if (!rewriteMap.has(name)) continue;
        const pinned = rewriteMap.get(name);
        if (range !== pinned) {
          deps[name] = pinned;
          changed = true;
        }
      }
    }

    if (changed) {
      if (!dryRun) await writePkg(dir, pkg);
      touched += 1;
      console.log(`  ${rel}: ${priorVersion} -> ${nextVersion}${dryRun ? " (dry)" : ""}`);
    }

    if (!dryRun) {
      // Clear any stale publish backup that would otherwise revert this bump.
      const backup = path.join(dir, BACKUP_FILENAME);
      if (existsSync(backup)) {
        await fs.unlink(backup);
        console.log(`  ${rel}: cleared stale ${BACKUP_FILENAME}`);
      }
    }
  }

  console.log(`\n${dryRun ? "Would bump" : "Bumped"} ${touched} package(s) to ${nextVersion}.`);
}

await main();
