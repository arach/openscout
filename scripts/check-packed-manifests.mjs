#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function npmTarballName(name, version) {
  return `${name.replace(/^@/, "").replace(/\//g, "-")}-${version}.tgz`;
}

function findWorkspaceDirs() {
  return ["packages/protocol", "packages/runtime", "packages/cli", "packages/web"]
    .map((relativePath) => path.join(repoRoot, relativePath))
    .filter((dir) => existsSync(path.join(dir, "package.json")));
}

function findWorkspaceLeaks(pkg) {
  const leaks = [];

  for (const section of DEPENDENCY_SECTIONS) {
    const deps = pkg[section];
    if (!deps) {
      continue;
    }

    for (const [name, range] of Object.entries(deps)) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        leaks.push(`${section}.${name}=${range}`);
      }
    }
  }

  return leaks;
}

async function inspectPackedManifest(packageDir, tempDir) {
  const pkg = JSON.parse(await fs.readFile(path.join(packageDir, "package.json"), "utf8"));
  const tarballPath = path.join(tempDir, npmTarballName(pkg.name, pkg.version));

  execFileSync("npm", ["pack", "--pack-destination", tempDir], {
    cwd: packageDir,
    stdio: "inherit",
  });

  const packedManifestText = execFileSync(
    "tar",
    ["-xOf", tarballPath, "package/package.json"],
    {
      cwd: packageDir,
      encoding: "utf8",
    },
  );

  return {
    name: pkg.name,
    leaks: findWorkspaceLeaks(JSON.parse(packedManifestText)),
    tarballPath,
  };
}

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openscout-pack-check-"));

  try {
    const failures = [];

    for (const packageDir of findWorkspaceDirs()) {
      const result = await inspectPackedManifest(packageDir, tempDir);
      if (result.leaks.length > 0) {
        failures.push(result);
      }
    }

    if (failures.length > 0) {
      for (const failure of failures) {
        console.error(`${failure.name} packed with workspace dependencies:`);
        for (const leak of failure.leaks) {
          console.error(`  - ${leak}`);
        }
      }
      process.exitCode = 1;
      return;
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

await main();
