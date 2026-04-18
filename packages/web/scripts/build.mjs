#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const outputDirectory = resolve(packageDirectory, "dist");

const clientBuild = spawnSync("vite", ["build"], {
  cwd: packageDirectory,
  stdio: "inherit",
});

if ((clientBuild.status ?? 1) !== 0) {
  process.exit(clientBuild.status ?? 1);
}

mkdirSync(outputDirectory, { recursive: true });

const entries = [
  {
    input: resolve(packageDirectory, "server", "index.ts"),
    output: resolve(outputDirectory, "openscout-web-server.mjs"),
  },
  {
    input: resolve(packageDirectory, "server", "pair-supervisor.ts"),
    output: resolve(outputDirectory, "pair-supervisor.mjs"),
  },
];

for (const entry of entries) {
  const result = spawnSync(
    "bun",
    ["build", entry.input, "--target=bun", "--format=esm", "--outfile", entry.output, "--external", "vite"],
    {
      cwd: packageDirectory,
      stdio: "inherit",
    },
  );
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
