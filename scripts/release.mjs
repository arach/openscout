#!/usr/bin/env node
import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const electronDir = path.join(rootDir, "packages", "electron-app");
const rootPkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));

const version = process.argv[2] || rootPkg.version;
const tag = `v${version}`;
const dryRun = process.argv.includes("--dry-run");
const skipBuild = process.argv.includes("--skip-build");

function run(cmd, opts = {}) {
  console.log(`→ ${cmd}`);
  if (dryRun && !opts.allowInDryRun) {
    console.log("  (dry run, skipped)");
    return "";
  }
  return execSync(cmd, { stdio: "inherit", cwd: rootDir, ...opts });
}

function step(label) {
  console.log(`\n${"═".repeat(60)}\n  ${label}\n${"═".repeat(60)}\n`);
}

// ── 1. Build ──
if (!skipBuild) {
  step(`Building OpenScout ${tag}`);
  run("npm run electron:package");
} else {
  console.log("Skipping build (--skip-build)");
}

// ── 2. Verify DMG exists ──
const dmgPath = path.join(electronDir, "dist", "macos", "OpenScout.dmg");
if (!existsSync(dmgPath)) {
  console.error(`DMG not found at ${dmgPath}`);
  process.exit(1);
}

const { size } = await fs.stat(dmgPath);
console.log(`DMG ready: ${dmgPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);

// ── 3. Tag ──
step(`Tagging ${tag}`);
const existingTags = execSync("git tag --list", { cwd: rootDir, encoding: "utf8" });
if (existingTags.split("\n").includes(tag)) {
  console.log(`Tag ${tag} already exists, skipping`);
} else {
  run(`git tag -a ${tag} -m "Release ${tag}"`);
  run(`git push origin ${tag}`);
}

// ── 4. Create GitHub release & upload DMG ──
step("Creating GitHub release");
const releaseNotes = `## OpenScout ${tag}\n\n### Install\nDownload \`OpenScout.dmg\` below, open it, and drag OpenScout to Applications.`;

const ghArgs = [
  "gh", "release", "create", tag,
  "--title", `OpenScout ${tag}`,
  "--notes", releaseNotes,
  dmgPath,
];

if (dryRun) {
  console.log(`Would run: ${ghArgs.join(" ")}`);
} else {
  execFileSync("gh", ghArgs.slice(1), { stdio: "inherit", cwd: rootDir });
}

step("Done");
console.log(`Release ${tag} published with OpenScout.dmg attached.`);
