import "server-only";

import path from "node:path";

export interface ResolvedRepoPath {
  absolute: string;
  relative: string;
}

const REPO_ROOT = path.resolve(
  /* turbopackIgnore: true */ process.cwd(),
  "..",
  "..",
);

export function resolveRepoPath(relPath: string): ResolvedRepoPath | null {
  const absolute = path.resolve(/* turbopackIgnore: true */ REPO_ROOT, relPath);
  const relative = path.relative(REPO_ROOT, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return { absolute, relative };
}
