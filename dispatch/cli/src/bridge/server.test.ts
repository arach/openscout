import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveWorkspacePath } from "./server.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("resolveWorkspacePath", () => {
  test("resolves relative paths inside the configured workspace root", () => {
    const root = makeTempDir("dispatch-workspace-");
    const project = join(root, "project-a");
    mkdirSync(project);

    expect(resolveWorkspacePath(root, "project-a")).toBe(realpathSync(project));
  });

  test("rejects parent traversal outside the configured workspace root", () => {
    const base = makeTempDir("dispatch-workspace-parent-");
    const root = join(base, "root");
    const outside = join(base, "outside");
    mkdirSync(root);
    mkdirSync(outside);

    expect(() => resolveWorkspacePath(root, "../outside")).toThrow(
      "Path escapes workspace root",
    );
  });

  test("rejects symlink targets that escape the configured workspace root", () => {
    const base = makeTempDir("dispatch-workspace-symlink-");
    const root = join(base, "root");
    const outside = join(base, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    symlinkSync(outside, join(root, "linked-outside"));

    expect(() => resolveWorkspacePath(root, "linked-outside")).toThrow(
      "Path escapes workspace root",
    );
  });
});
