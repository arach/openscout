import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type WorkspacePackageJson = {
  workspaces?: unknown;
};

function looksLikeWorkspaceRoot(candidate: string): boolean {
  const packageJsonPath = join(candidate, "package.json");
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as WorkspacePackageJson;
    return Array.isArray(parsed.workspaces);
  } catch {
    return false;
  }
}

export function resolveScoutWorkspaceRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));

  while (true) {
    if (looksLikeWorkspaceRoot(current)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Unable to locate the Scout workspace root.");
    }
    current = parent;
  }
}

export function resolveScoutAppRoot(): string {
  return resolve(resolveScoutWorkspaceRoot(), "apps", "scout");
}
