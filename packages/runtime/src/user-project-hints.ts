import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Best-effort decode of Claude Code's ~/.claude/projects slug (path slashes → hyphens).
 * Wrong when any single path segment contained `-` at session time (same limitation as Claude's encoding).
 * Always confirm with stat on the decoded path.
 */
export function decodeClaudeProjectsSlug(name: string): string | null {
  if (!name || name === "." || name === "..") {
    return null;
  }
  if (!name.startsWith("-")) {
    return null;
  }
  const tail = name.slice(1);
  if (!tail) {
    return null;
  }
  return `/${tail.replace(/-/g, "/")}`;
}

async function isExistingDirectory(absolutePath: string): Promise<boolean> {
  try {
    return (await stat(absolutePath)).isDirectory();
  } catch {
    return false;
  }
}

function cursorWorkspaceStoragePath(home: string): string {
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Cursor", "User", "workspaceStorage");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      return join(appData, "Cursor", "User", "workspaceStorage");
    }
    return join(home, "AppData", "Roaming", "Cursor", "User", "workspaceStorage");
  }
  return join(home, ".config", "Cursor", "User", "workspaceStorage");
}

function collectPathLikeStrings(value: unknown, out: Set<string>, depth: number): void {
  if (depth > 4 || value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    if (value.startsWith("/") && value.length > 1 && !value.includes("\n") && !value.includes("\0")) {
      out.add(value);
    }
    if (/^[A-Za-z]:[\\/]/.test(value)) {
      out.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPathLikeStrings(item, out, depth + 1);
    }
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectPathLikeStrings(v, out, depth + 1);
    }
  }
}

async function appendCodexHistoryPaths(home: string, roots: Set<string>): Promise<void> {
  const candidates = [join(home, ".codex", "history.jsonl"), join(home, ".openai-codex", "history.jsonl")];
  const maxLines = 2500;
  const maxBytes = 4 * 1024 * 1024;

  for (const filePath of candidates) {
    let st;
    try {
      st = await stat(filePath);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > maxBytes) {
      continue;
    }

    let body: string;
    try {
      body = await readFile(filePath, "utf8");
    } catch {
      continue;
    }

    let lineCount = 0;
    for (const line of body.split("\n")) {
      if (lineCount++ > maxLines) {
        break;
      }
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const extracted = new Set<string>();
        collectPathLikeStrings(parsed, extracted, 0);
        for (const p of extracted) {
          if (await isExistingDirectory(p)) {
            roots.add(p);
          }
        }
      } catch {
        continue;
      }
    }
  }
}

async function appendCursorWorkspacePaths(home: string, roots: Set<string>): Promise<void> {
  const base = cursorWorkspaceStoragePath(home);
  let ids: string[] = [];
  try {
    ids = await readdir(base);
  } catch {
    return;
  }

  for (const id of ids) {
    const workspaceJsonPath = join(base, id, "workspace.json");
    let raw: string;
    try {
      raw = await readFile(workspaceJsonPath, "utf8");
    } catch {
      continue;
    }

    let doc: { folder?: string; workspace?: string };
    try {
      doc = JSON.parse(raw) as { folder?: string; workspace?: string };
    } catch {
      continue;
    }

    if (typeof doc.folder === "string" && doc.folder.startsWith("file://")) {
      try {
        const folderPath = fileURLToPath(doc.folder);
        if (await isExistingDirectory(folderPath)) {
          roots.add(folderPath);
        }
      } catch {
        /* ignore */
      }
    }

    if (typeof doc.workspace === "string" && doc.workspace.startsWith("file://")) {
      try {
        const wsFile = fileURLToPath(doc.workspace);
        if (!wsFile.endsWith(".code-workspace")) {
          continue;
        }
        let wsStat;
        try {
          wsStat = await stat(wsFile);
        } catch {
          continue;
        }
        if (!wsStat.isFile()) {
          continue;
        }
        const wsRaw = await readFile(wsFile, "utf8");
        const wsDoc = JSON.parse(wsRaw) as { folders?: Array<{ path?: string }> };
        const wsDir = dirname(wsFile);
        for (const f of wsDoc.folders ?? []) {
          if (typeof f.path !== "string" || !f.path) {
            continue;
          }
          const resolvedPath = resolve(wsDir, f.path);
          if (await isExistingDirectory(resolvedPath)) {
            roots.add(resolvedPath);
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
}

async function appendClaudeProjectSlugs(home: string, roots: Set<string>): Promise<void> {
  const projectsDir = join(home, ".claude", "projects");
  let names: string[] = [];
  try {
    names = await readdir(projectsDir, { withFileTypes: false });
  } catch {
    return;
  }

  for (const name of names) {
    const decoded = decodeClaudeProjectsSlug(name);
    if (!decoded) {
      continue;
    }
    if (await isExistingDirectory(decoded)) {
      roots.add(decoded);
    }
  }
}

export type CollectUserProjectHintsOptions = {
  /** Override home (tests). Defaults to `os.homedir()`. */
  home?: string;
};

/**
 * Extra project roots inferred from user-level agent/IDE data (best effort, lossy).
 * Always filter with stat — never trust decoded paths alone.
 */
export async function collectUserLevelProjectRootHints(
  options: CollectUserProjectHintsOptions = {},
): Promise<string[]> {
  const home = options.home ?? homedir();
  const roots = new Set<string>();

  try {
    await appendClaudeProjectSlugs(home, roots);
  } catch {
    /* best-effort */
  }
  try {
    await appendCursorWorkspacePaths(home, roots);
  } catch {
    /* best-effort: Cursor storage can be unreadable or corrupt */
  }
  try {
    await appendCodexHistoryPaths(home, roots);
  } catch {
    /* best-effort */
  }

  return Array.from(roots).sort();
}
