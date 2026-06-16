/**
 * Repo file reader for the engineering-doc code viewer.
 *
 * The viewer is read-only and only intended for files committed to
 * this repo. Two safety properties this module enforces:
 *
 *  1. The requested path, once resolved, must live INSIDE the repo
 *     root. A `..` traversal that escapes the root is rejected.
 *  2. Only files matching a known extension allowlist are served —
 *     no `.env`, no SQLite DBs, no binary blobs.
 *
 * If either check fails, callers get `null` and the page surfaces a
 * 404. We deliberately do not bubble up "why" — security errors are
 * the same shape as missing-file errors to the caller.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { resolveRepoPath } from "@/lib/repo-path";

/** Extensions the viewer is willing to render. */
const ALLOWED_EXTENSIONS = new Set([
  "swift",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "md",
  "mdx",
  "json",
  "css",
  "scss",
  "html",
  "htm",
  "sh",
  "bash",
  "zsh",
  "yaml",
  "yml",
  "toml",
  "txt",
  "rs",
  "go",
  "py",
  "sql",
]);

/** ~512 KB upper bound — keeps the viewer responsive and avoids loading
 *  huge generated files into the browser. */
const MAX_BYTES = 512 * 1024;

export interface RepoFile {
  relativePath: string;
  filename: string;
  content: string;
  truncated: boolean;
  bytes: number;
}

export async function loadRepoFile(parts: string[]): Promise<RepoFile | null> {
  if (parts.length === 0) return null;

  const requested = parts.map((p) => decodeURIComponent(p)).join("/");
  const resolvedPath = resolveRepoPath(requested);
  if (!resolvedPath) return null;
  const { absolute: resolved, relative } = resolvedPath;

  const ext = path.extname(resolved).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;

  try {
    const stats = await stat(/* turbopackIgnore: true */ resolved);
    if (!stats.isFile()) return null;
    const truncated = stats.size > MAX_BYTES;

    const raw = await readFile(/* turbopackIgnore: true */ resolved, {
      encoding: "utf8",
    });
    const content = truncated ? raw.slice(0, MAX_BYTES) : raw;

    return {
      relativePath: relative,
      filename: path.basename(resolved),
      content,
      truncated,
      bytes: stats.size,
    };
  } catch {
    return null;
  }
}
