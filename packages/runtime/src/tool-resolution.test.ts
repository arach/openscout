import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
  resolveBunExecutable,
  resolveNodeModulesPackageEntrypoint,
  resolveOpenScoutRepoRoot,
} from "./tool-resolution.js";

describe("tool resolution", () => {
  test("resolves bun from explicit environment overrides", () => {
    const directory = mkdtempSync(join(tmpdir(), "openscout-tool-resolution-bun-"));
    const bunPath = join(directory, "bun");

    try {
      writeFileSync(bunPath, "#!/bin/sh\nexit 0\n");
      chmodSync(bunPath, 0o755);

      const resolved = resolveBunExecutable({
        OPENSCOUT_BUN_BIN: bunPath,
      });

      expect(resolved?.path).toBe(bunPath);
      expect(resolved?.source).toBe("env");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("finds an OpenScout repo root only when both required entrypoints exist", () => {
    const directory = mkdtempSync(join(tmpdir(), "openscout-tool-resolution-repo-"));
    const repoRoot = join(directory, "repo");
    const nestedDirectory = join(repoRoot, "apps", "macos", "Sources");

    try {
      mkdirSync(join(repoRoot, "apps", "desktop", "bin"), { recursive: true });
      mkdirSync(join(repoRoot, "packages", "runtime", "bin"), { recursive: true });
      mkdirSync(nestedDirectory, { recursive: true });

      writeFileSync(join(repoRoot, "apps", "desktop", "bin", "scout.ts"), "export {};\n");
      writeFileSync(join(repoRoot, "packages", "runtime", "bin", "openscout-runtime.mjs"), "export {};\n");

      expect(
        resolveOpenScoutRepoRoot({
          startDirectories: [nestedDirectory],
        }),
      ).toBe(repoRoot);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("finds node_modules package entrypoints above the current module directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "openscout-tool-resolution-node-modules-"));
    const moduleDirectory = join(directory, "package", "dist");
    const packageEntry = join(
      directory,
      "node_modules",
      "@openscout",
      "runtime",
      "bin",
      "openscout-runtime.mjs",
    );

    try {
      mkdirSync(moduleDirectory, { recursive: true });
      mkdirSync(join(directory, "node_modules", "@openscout", "runtime", "bin"), { recursive: true });
      writeFileSync(packageEntry, "export {};\n");

      const moduleUrl = new URL(`file://${join(moduleDirectory, "main.mjs")}`);
      expect(
        resolveNodeModulesPackageEntrypoint(
          moduleUrl,
          ["@openscout", "runtime"],
          "bin/openscout-runtime.mjs",
        ),
      ).toBe(packageEntry);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
