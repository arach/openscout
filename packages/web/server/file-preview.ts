import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

import { queryAgents } from "./db-queries.ts";

const MAX_PREVIEW_BYTES = 256 * 1024;

export type FilePreviewResult =
  | {
      ok: true;
      content: {
        path: string;
        realPath: string;
        title: string;
        mediaType: string;
        content: string;
        sizeBytes: number;
        truncated: boolean;
        generatedAt: number;
      };
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export type TrustedRoot = {
  path: string;
  source: "agent-project" | "agent-cwd" | "current-directory";
  agentId?: string;
};

function expand(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return trimmed;
}

export function collectTrustedRoots(input: { currentDirectory: string }): TrustedRoot[] {
  const seen = new Map<string, TrustedRoot>();
  const add = (raw: string | null | undefined, source: TrustedRoot["source"], agentId?: string) => {
    if (!raw) return;
    const expanded = expand(raw);
    if (!isAbsolute(expanded)) return;
    let resolved: string;
    try {
      resolved = realpathSync(expanded);
    } catch {
      resolved = resolve(expanded);
    }
    if (seen.has(resolved)) return;
    seen.set(resolved, { path: resolved, source, ...(agentId ? { agentId } : {}) });
  };

  add(input.currentDirectory, "current-directory");

  try {
    const agents = queryAgents(500);
    for (const agent of agents) {
      add(agent.projectRoot, "agent-project", agent.id);
      add(agent.cwd, "agent-cwd", agent.id);
    }
  } catch {
    // Broker DB unavailable — fall back to current-directory only.
  }

  return [...seen.values()];
}

function pathInsideRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function findContainingRoot(
  absolutePath: string,
  roots: TrustedRoot[],
): TrustedRoot | null {
  for (const root of roots) {
    if (pathInsideRoot(absolutePath, root.path)) {
      return root;
    }
  }
  return null;
}

function mediaTypeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "text/markdown";
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "application/json";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "text/typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "text/javascript";
  if (lower.endsWith(".css") || lower.endsWith(".scss")) return "text/css";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".sh")) return "text/x-shellscript";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "text/yaml";
  if (lower.endsWith(".toml")) return "text/toml";
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain";
  return "text/plain";
}

function looksTextual(path: string, buffer: Buffer): boolean {
  if (/\.(md|mdx|txt|ts|tsx|js|jsx|mjs|cjs|json|jsonc|yaml|yml|toml|py|swift|kt|java|go|rs|css|scss|html|sql|sh|xml|log|conf|env|ini|gitignore)$/iu.test(path)) {
    return true;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return !sample.includes(0);
}

export function resolveTrustedPath(input: {
  requestedPath: string;
  roots: TrustedRoot[];
}): { ok: true; realPath: string; root: TrustedRoot } | { ok: false; status: number; error: string } {
  const requested = input.requestedPath.trim();
  if (!requested) {
    return { ok: false, status: 400, error: "path is required" };
  }
  const expanded = expand(requested);
  if (!isAbsolute(expanded)) {
    return { ok: false, status: 400, error: "path must be absolute" };
  }
  let realPath: string;
  try {
    realPath = realpathSync(expanded);
  } catch {
    return { ok: false, status: 404, error: "file not found" };
  }
  const root = findContainingRoot(realPath, input.roots);
  if (!root) {
    return { ok: false, status: 403, error: "path is outside Scout's trusted workspace roots" };
  }
  return { ok: true, realPath, root };
}

export function readFilePreview(input: {
  requestedPath: string;
  currentDirectory: string;
}): FilePreviewResult {
  const roots = collectTrustedRoots({ currentDirectory: input.currentDirectory });
  const resolved = resolveTrustedPath({ requestedPath: input.requestedPath, roots });
  if (!resolved.ok) {
    return resolved;
  }
  const { realPath } = resolved;
  try {
    const stat = statSync(realPath);
    if (!stat.isFile()) {
      return { ok: false, status: 415, error: "path is not a file" };
    }
    const buffer = readFileSync(realPath);
    if (!looksTextual(realPath, buffer)) {
      return { ok: false, status: 415, error: "file is not a text document" };
    }
    const truncated = buffer.length > MAX_PREVIEW_BYTES;
    const readable = truncated ? buffer.subarray(0, MAX_PREVIEW_BYTES) : buffer;
    const title = realPath.split("/").pop() ?? realPath;
    return {
      ok: true,
      content: {
        path: input.requestedPath,
        realPath,
        title,
        mediaType: mediaTypeFor(realPath),
        content: readable.toString("utf8"),
        sizeBytes: buffer.length,
        truncated,
        generatedAt: Date.now(),
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : "could not read file",
    };
  }
}
