import { describe, expect, test } from "bun:test";

import { selectInstalledAppBundle } from "./app.ts";

describe("selectInstalledAppBundle", () => {
  test("prefers the conventional installed app over Spotlight worktree matches", () => {
    const installed = "/Applications/OpenScout.app";
    const existing = new Set([
      installed,
      "/Users/art/dev/openscout/apps/macos/dist/Scout.app",
    ]);

    expect(selectInstalledAppBundle(
      [...existing].reverse(),
      "/Users/art",
      (path) => existing.has(path),
    )).toBe(installed);
  });

  test("never treats a repo-built Scout.app as an installed fallback", () => {
    const worktreeBuild = "/Users/art/dev/openscout/apps/macos/dist/Scout.app";

    expect(selectInstalledAppBundle(
      [worktreeBuild],
      "/Users/art",
      (path) => path === worktreeBuild,
    )).toBeNull();
  });

  test("accepts a relocated OpenScout.app when no conventional install exists", () => {
    const relocated = "/Volumes/Apps/OpenScout.app";

    expect(selectInstalledAppBundle(
      [relocated],
      "/Users/art",
      (path) => path === relocated,
    )).toBe(relocated);
  });
});
