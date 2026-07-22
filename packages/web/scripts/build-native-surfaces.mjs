#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const repoRoot = resolve(packageDirectory, "../..");
const outputDirectory = resolve(repoRoot, "apps/ios/Scout/Resources/WebSurfaces");

const build = spawnSync(
  "vite",
  ["build", "--config", "vite.native-surfaces.config.ts"],
  { cwd: packageDirectory, stdio: "inherit" },
);
if ((build.status ?? 1) !== 0) process.exit(build.status ?? 1);

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function walk(directory) {
  return readdirSync(directory)
    .flatMap((name) => {
      const absolute = resolve(directory, name);
      return statSync(absolute).isDirectory() ? walk(absolute) : [absolute];
    })
    .sort();
}

const files = walk(outputDirectory)
  .filter((file) => relative(outputDirectory, file) !== "manifest.json")
  .map((file) => ({
    path: relative(outputDirectory, file).replaceAll("\\", "/"),
    sha256: sha256(readFileSync(file)),
    bytes: statSync(file).size,
  }));

const packageJson = JSON.parse(readFileSync(resolve(packageDirectory, "package.json"), "utf8"));
const bunVersion = spawnSync("bun", ["--version"], { encoding: "utf8" }).stdout?.trim() || null;
const lockfile = readFileSync(resolve(repoRoot, "bun.lock"));
const assetRevision = sha256(
  files.map((file) => `${file.path}:${file.sha256}`).join("\n"),
).slice(0, 16);

const manifest = {
  schemaVersion: 1,
  assetRevision,
  protocol: { minimum: 1, maximum: 1 },
  toolchain: {
    node: process.versions.node,
    bun: bunVersion,
    vite: packageJson.devDependencies.vite,
    lockfileSha256: sha256(lockfile),
  },
  surfaces: {
    lanes: {
      entry: "lanes/index.html",
      capabilities: [
        "bootstrap",
        "native.openExternalURL",
        "native.getPreferences",
        "native.setPreferences",
        "native.cancel",
        "agents.list",
        "agents.observe",
        "tail.recent",
        "tail.subscribe",
        "native.setLaneSelection",
      ],
      preferences: [
        "lanes.layout",
        "lanes.horizon",
        "lanes.gridColumns",
        "lanes.collapseTechnicalEvents",
      ],
    },
    dispatch: {
      entry: "dispatch/index.html",
      capabilities: [
        "bootstrap",
        "native.openExternalURL",
        "native.getPreferences",
        "native.setPreferences",
        "native.cancel",
        "dispatch.diagnostics",
        "dispatch.subscribe",
        "dispatch.ask",
        "dispatch.review",
      ],
      preferences: ["dispatch.density"],
    },
  },
  files,
};

writeFileSync(
  resolve(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`native surfaces ${assetRevision} · ${files.length} files`);
