/**
 * Repo directory walker for the studio's tree viewer + file cards.
 *
 * Server-only. Walks a directory under the repo root, returns a
 * compact tree node structure. Three guards:
 *
 *  1. Containment — resolved path must live inside REPO_ROOT
 *     (rejects `..` escape and absolute-path traversal).
 *  2. Depth — defaults to 6; protects against accidental walks into
 *     vendor / build trees.
 *  3. Ignore — drops node_modules, .next, .git, dist, build,
 *     .deriveddata, and dotfiles by default.
 *
 * Sibling lookup (`listSiblings`) is used by file cards to surface
 * other files in the same directory at a glance.
 */

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");

const DEFAULT_IGNORE = new Set([
  "node_modules",
  ".next",
  ".git",
  ".deriveddata",
  "dist",
  "build",
  ".turbo",
  "out",
  "SourcePackages",
]);

export interface TreeNode {
  /** Display name — filename or directory name. */
  name: string;
  /** Path relative to REPO_ROOT. Empty string for the root node. */
  relPath: string;
  /** "dir" | "file" — drives expand/collapse + icon. */
  kind: "dir" | "file";
  /** File size in bytes (files only). */
  bytes?: number;
  /** ISO mtime. */
  updatedAt?: string;
  /** Children of a directory — undefined for files, present (possibly
   *  empty) for directories. */
  children?: TreeNode[];
  /** Set when the walker hit `maxDepth` for a subtree and stopped. */
  truncatedAtDepth?: boolean;
}

export interface WalkOptions {
  /** Repo-relative directory to walk. Empty string = repo root. */
  relPath: string;
  /** Max recursion depth, default 6. */
  maxDepth?: number;
  /** Additional names to skip beyond DEFAULT_IGNORE. */
  ignore?: Iterable<string>;
}

function isHidden(name: string): boolean {
  return name.startsWith(".") && name !== "." && name !== "..";
}

function shouldIgnore(name: string, extra: Set<string>): boolean {
  if (DEFAULT_IGNORE.has(name)) return true;
  if (extra.has(name)) return true;
  if (isHidden(name)) return true;
  return false;
}

function safeResolve(relPath: string): string | null {
  const resolved = path.resolve(REPO_ROOT, relPath);
  const rel = path.relative(REPO_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

/** Read a directory tree. Returns null if the root path escapes the
 *  repo, doesn't exist, or isn't a directory. */
export function readTree(options: WalkOptions): TreeNode | null {
  const { relPath, maxDepth = 6, ignore } = options;
  const ignoreSet = new Set(ignore ?? []);

  const absolute = safeResolve(relPath);
  if (!absolute) return null;

  try {
    const stat = fs.statSync(absolute);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }

  const rootName = relPath ? path.basename(relPath) || relPath : "/";
  const root: TreeNode = {
    name: rootName,
    relPath,
    kind: "dir",
    children: [],
  };

  walk(root, absolute, 0, maxDepth, ignoreSet);
  sortInPlace(root);
  return root;
}

function walk(
  node: TreeNode,
  absolute: string,
  depth: number,
  maxDepth: number,
  ignoreSet: Set<string>,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absolute, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (shouldIgnore(entry.name, ignoreSet)) continue;
    const childAbs = path.join(absolute, entry.name);
    const childRel = node.relPath
      ? `${node.relPath}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      const childNode: TreeNode = {
        name: entry.name,
        relPath: childRel,
        kind: "dir",
        children: [],
      };
      node.children!.push(childNode);

      if (depth + 1 >= maxDepth) {
        childNode.truncatedAtDepth = true;
        continue;
      }
      walk(childNode, childAbs, depth + 1, maxDepth, ignoreSet);
    } else if (entry.isFile()) {
      let bytes: number | undefined;
      let updatedAt: string | undefined;
      try {
        const stat = fs.statSync(childAbs);
        bytes = stat.size;
        updatedAt = stat.mtime.toISOString();
      } catch {
        /* skip stat failures */
      }
      node.children!.push({
        name: entry.name,
        relPath: childRel,
        kind: "file",
        bytes,
        updatedAt,
      });
    }
  }
}

/** Stable ordering — directories first, then files; each block alpha. */
function sortInPlace(node: TreeNode): void {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) {
    if (child.kind === "dir") sortInPlace(child);
  }
}

/** Flatten count of all descendant files (recursive). */
export function countFiles(node: TreeNode): number {
  if (node.kind === "file") return 1;
  if (!node.children) return 0;
  return node.children.reduce((sum, c) => sum + countFiles(c), 0);
}

/** Files alongside a given file (same directory). Useful for file
 *  cards that want to show siblings as a "Nearby" row. */
export function listSiblings(relPath: string, limit = 6): TreeNode[] {
  const dir = path.dirname(relPath);
  const tree = readTree({ relPath: dir, maxDepth: 1 });
  if (!tree?.children) return [];
  return tree.children
    .filter((c) => c.kind === "file" && c.relPath !== relPath)
    .slice(0, limit);
}

/** Read a single file's stat for the file card. Returns null if it
 *  escapes the repo or doesn't exist. */
export interface FileStat {
  relPath: string;
  name: string;
  bytes: number;
  lines: number | null;
  updatedAt: string;
  extension: string;
}

export function readFileStat(relPath: string): FileStat | null {
  const absolute = safeResolve(relPath);
  if (!absolute) return null;
  try {
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) return null;
    let lines: number | null = null;
    try {
      // Only attempt line count for plausibly textual files (< 1 MB).
      if (stat.size < 1024 * 1024) {
        const content = fs.readFileSync(absolute, "utf8");
        lines = content.split("\n").length;
      }
    } catch {
      /* not text — skip line count */
    }
    return {
      relPath,
      name: path.basename(absolute),
      bytes: stat.size,
      lines,
      updatedAt: stat.mtime.toISOString(),
      extension: path.extname(absolute).slice(1).toLowerCase(),
    };
  } catch {
    return null;
  }
}
