import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import { api } from "../../lib/api.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import type { Route } from "../../lib/types.ts";
import { fetchRepoWatchSnapshot, getCachedRepoWatchSnapshot } from "../../scout/repo-watch/api.ts";
import type { RepoWatchSnapshot, RepoWatchWorktree } from "../../scout/repo-watch/types.ts";
import { defineSurface } from "../../surfaces/types.ts";
import { ShikiPane } from "./ShikiPane.tsx";
import { readLastRoot, readStoredTree, writeLastRoot, writeStoredTree } from "./code-tree-store.ts";
import "./code-screen.css";

/* Heavy machine-owned directories that only add noise to a reading tree. */
const IGNORED_DIR_NAMES = new Set(["node_modules", ".git", "dist", ".next", ".build", "DerivedData", "__pycache__", ".venv", "target"]);

type DirEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
};

type FilePreviewResponse =
  | {
      kind: "file";
      previewable: true;
      path: string;
      title: string;
      mediaType: string;
      rawUrl: string;
      content: string;
      sizeBytes: number;
      truncated: boolean;
    }
  | {
      kind: "file";
      previewable: false;
      path: string;
      title: string;
      mediaType: string;
      rawUrl: string;
      sizeBytes: number;
      previewReason: string;
    }
  | {
      kind: "directory";
      path: string;
      entries: DirEntry[];
    };

function parentDir(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "/";
}

function pathLeaf(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function worktreeLabel(worktree: RepoWatchWorktree): string {
  const branch = worktree.branch.detached ? "detached" : worktree.branch.name ?? "no branch";
  const dirty = worktree.status.clean ? "" : ` · ${worktree.status.changedFiles} changed`;
  return `${branch}${dirty}`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

/** Resolve a /code/<project> slug against the snapshot: project + optional worktree. */
function resolveProjectLink(
  snapshot: RepoWatchSnapshot,
  projectSlug: string,
  wt: string | null,
): { projectName: string; root: string } | null {
  const needle = slugify(projectSlug);
  const project = snapshot.projects.find(
    (candidate) => slugify(candidate.name) === needle || slugify(pathLeaf(candidate.root)) === needle,
  );
  if (!project) return null;
  const worktree = wt
    ? project.worktrees.find(
        (candidate) => candidate.name === wt || candidate.branch.name === wt || slugify(candidate.name) === slugify(wt),
      )
    : project.worktrees[0];
  return { projectName: project.name, root: worktree?.path ?? project.root };
}

/** Directory chain between a root and a file inside it (excludes the file). */
function ancestorDirs(rootPath: string, filePath: string): string[] {
  if (!filePath.startsWith(`${rootPath}/`)) return [];
  const rel = filePath.slice(rootPath.length + 1).split("/");
  const dirs: string[] = [];
  let current = rootPath;
  for (const segment of rel.slice(0, -1)) {
    current = `${current}/${segment}`;
    dirs.push(current);
  }
  return dirs;
}

/** Cursor/VS Code idiom: one letter at the row's trailing edge. */
function diffBadge(status: string): string {
  switch (status) {
    case "untracked":
      return "U";
    case "conflicted":
      return "C";
    case "staged":
    case "unstaged":
      return "M";
    default:
      return status.charAt(0).toUpperCase();
  }
}

type TreeRow = {
  path: string;
  name: string;
  kind: "file" | "directory";
  depth: number;
  loading?: boolean;
};

function collectTreeRows(
  dir: string,
  depth: number,
  childrenByPath: Map<string, DirEntry[]>,
  expanded: ReadonlySet<string>,
  out: TreeRow[],
): void {
  const entries = childrenByPath.get(dir);
  if (!entries) {
    out.push({ path: `${dir}#loading`, name: "Loading…", kind: "file", depth, loading: true });
    return;
  }
  for (const entry of entries) {
    if (entry.kind === "directory" && IGNORED_DIR_NAMES.has(entry.name)) continue;
    out.push({ path: entry.path, name: entry.name, kind: entry.kind, depth });
    if (entry.kind === "directory" && expanded.has(entry.path)) {
      collectTreeRows(entry.path, depth + 1, childrenByPath, expanded, out);
    }
  }
}

export function CodeContent({
  route,
  navigate,
  root: rootProp,
  file: fileProp,
  project: projectProp,
  path: pathProp,
  wt: wtProp,
  embedded = false,
}: {
  route?: Extract<Route, { view: "code" }>;
  navigate?: (route: Route) => void;
  root?: string;
  file?: string;
  project?: string;
  path?: string;
  wt?: string;
  embedded?: boolean;
}) {
  const initialRoot = rootProp ?? route?.root ?? null;
  const initialFile = fileProp ?? route?.file ?? null;
  const linkProject = projectProp ?? route?.project ?? null;
  const linkPath = pathProp ?? route?.path ?? null;
  const linkWt = wtProp ?? route?.wt ?? null;

  const [snapshot, setSnapshot] = useState<RepoWatchSnapshot | null>(() => getCachedRepoWatchSnapshot());
  // With no explicit target, reopen where the operator last was — the surface
  // should greet you with your repo, not a picker.
  const [root, setRoot] = useState<string | null>(() => initialRoot ?? (linkProject ? null : readLastRoot()));
  const [childrenByPath, setChildrenByPath] = useState<Map<string, DirEntry[]>>(() => new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [treeError, setTreeError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(initialFile);
  const [filePreview, setFilePreview] = useState<FilePreviewResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    if (snapshot) return;
    let cancelled = false;
    fetchRepoWatchSnapshot("quick", false, 20_000)
      .then((next) => {
        if (!cancelled) setSnapshot(next);
      })
      .catch(() => {
        // Repo picker degrades to the ?root= prop; the tree still works.
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot]);

  const loadDir = useCallback(async (dir: string) => {
    try {
      const preview = await api<FilePreviewResponse>(`/api/file/preview?path=${encodeURIComponent(dir)}`);
      if (preview.kind !== "directory") return;
      const entries = preview.entries.map((entry) => ({ name: entry.name, path: entry.path, kind: entry.kind }));
      setChildrenByPath((current) => new Map(current).set(dir, entries));
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  /** Reveal a link target: expand + load every directory above it. */
  const revealPath = useCallback((rootPath: string, filePath: string | null) => {
    if (!filePath) return;
    const dirs = ancestorDirs(rootPath, filePath);
    if (dirs.length === 0) return;
    setExpanded((current) => new Set([...current, ...dirs]));
    for (const dir of dirs) {
      void loadDir(dir);
    }
  }, [loadDir]);

  // Resolve /code/<project>/<path> links once the snapshot can answer them.
  // Setting identical values is a React no-op, so user browsing isn't disturbed.
  useEffect(() => {
    if (!linkProject || !snapshot) return;
    const resolved = resolveProjectLink(snapshot, linkProject, linkWt);
    if (!resolved) {
      setTreeError(`No project matching "${linkProject}".`);
      return;
    }
    const target = linkPath ? `${resolved.root}/${linkPath}` : null;
    setRoot(resolved.root);
    setSelectedFile(target);
    revealPath(resolved.root, target);
  }, [linkProject, linkPath, linkWt, snapshot, revealPath]);

  // Default to the first known worktree when nothing was requested explicitly.
  useEffect(() => {
    if (root || linkProject || !snapshot) return;
    const first = snapshot.projects[0];
    if (!first) return;
    setRoot(first.worktrees[0]?.path ?? first.root);
  }, [root, linkProject, snapshot]);

  // Root switched: hydrate instantly from the last visit (stale), then
  // re-fetch every visible directory in the background — loadDir replaces one
  // directory at a time, which reconciles the stale render against disk.
  // A link target inside the new root still wins over restored state.
  const selectedFileRef = useRef(selectedFile);
  selectedFileRef.current = selectedFile;
  useEffect(() => {
    if (!root) return;
    setTreeError(null);
    const stored = readStoredTree(root);
    const target = selectedFileRef.current;
    const linkDirs = target ? ancestorDirs(root, target) : [];
    if (stored) {
      setChildrenByPath(new Map(Object.entries(stored.entries)));
      setExpanded(new Set([...stored.expanded, ...linkDirs]));
      if (!target && stored.selectedFile) {
        setSelectedFile(stored.selectedFile);
      }
    } else {
      setChildrenByPath(new Map());
      setExpanded(new Set(linkDirs));
    }
    const refresh = new Set([root, ...(stored?.expanded ?? []), ...linkDirs]);
    for (const dir of refresh) {
      void loadDir(dir);
    }
    // Refresh git-status decorations alongside the tree.
    fetchRepoWatchSnapshot("quick", false, 20_000)
      .then(setSnapshot)
      .catch(() => {});
  }, [root, loadDir]);

  // Persist what's on screen so the next visit renders without a fetch.
  useEffect(() => {
    if (!root || childrenByPath.size === 0) return;
    writeStoredTree(root, { entries: childrenByPath, expanded, selectedFile });
    writeLastRoot(root);
  }, [root, childrenByPath, expanded, selectedFile]);

  // Absolute ?root=&file= links get the same tree reveal as slug links.
  useEffect(() => {
    if (!initialRoot || !initialFile) return;
    revealPath(initialRoot, initialFile);
  }, [initialRoot, initialFile, revealPath]);

  // Short-lived preview cache + hover prefetch: revisits and hovered files
  // render with zero round trips, which is what makes browsing feel local.
  // TTL stays short because agents actively rewrite these files.
  const previewCacheRef = useRef(new Map<string, { at: number; preview: FilePreviewResponse }>());
  const prefetchInFlightRef = useRef(new Set<string>());
  const PREVIEW_TTL_MS = 30_000;

  const cachedPreview = useCallback((path: string): FilePreviewResponse | null => {
    const hit = previewCacheRef.current.get(path);
    if (!hit) return null;
    if (Date.now() - hit.at > PREVIEW_TTL_MS) {
      previewCacheRef.current.delete(path);
      return null;
    }
    return hit.preview;
  }, []);

  const storePreview = useCallback((path: string, preview: FilePreviewResponse) => {
    const cache = previewCacheRef.current;
    cache.set(path, { at: Date.now(), preview });
    if (cache.size > 80) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
  }, []);

  const prefetchFile = useCallback((path: string) => {
    if (cachedPreview(path) || prefetchInFlightRef.current.has(path)) return;
    prefetchInFlightRef.current.add(path);
    api<FilePreviewResponse>(`/api/file/preview?path=${encodeURIComponent(path)}`)
      .then((preview) => storePreview(path, preview))
      .catch(() => {
        // Prefetch is best-effort; the click path reports real errors.
      })
      .finally(() => prefetchInFlightRef.current.delete(path));
  }, [cachedPreview, storePreview]);

  useEffect(() => {
    setCopyStatus("idle");
    if (!selectedFile) {
      setFilePreview(null);
      setFileError(null);
      return;
    }
    const cached = cachedPreview(selectedFile);
    if (cached) {
      setFilePreview(cached.kind === "file" ? cached : null);
      setFileError(null);
      setFileLoading(false);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    setFileError(null);
    api<FilePreviewResponse>(`/api/file/preview?path=${encodeURIComponent(selectedFile)}`)
      .then((preview) => {
        if (cancelled) return;
        storePreview(selectedFile, preview);
        setFilePreview(preview.kind === "file" ? preview : null);
      })
      .catch((error) => {
        if (cancelled) return;
        setFilePreview(null);
        setFileError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFile, cachedPreview, storePreview]);

  const treeRows = useMemo(() => {
    if (!root) return [];
    const rows: TreeRow[] = [];
    collectTreeRows(root, 0, childrenByPath, expanded, rows);
    return rows;
  }, [root, childrenByPath, expanded]);

  // Keep the address bar in sync with what's on screen so any moment in the
  // surface is a copyable link — slug form when the snapshot knows the root,
  // absolute form otherwise.
  const routeForSelection = useCallback((rootPath: string, filePath: string | null): Route => {
    if (snapshot) {
      for (const project of snapshot.projects) {
        for (const [index, worktree] of project.worktrees.entries()) {
          if (worktree.path === rootPath) {
            const rel = filePath && filePath.startsWith(`${rootPath}/`) ? filePath.slice(rootPath.length + 1) : undefined;
            return {
              view: "code",
              project: slugify(project.name),
              ...(rel ? { path: rel } : {}),
              ...(index > 0 ? { wt: worktree.name } : {}),
            };
          }
        }
      }
    }
    return { view: "code", root: rootPath, ...(filePath ? { file: filePath } : {}) };
  }, [snapshot]);

  const syncUrl = useCallback((rootPath: string, filePath: string | null) => {
    if (embedded || !navigate) return;
    navigate(routeForSelection(rootPath, filePath));
  }, [embedded, navigate, routeForSelection]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!childrenByPath.has(path)) {
      void loadDir(path);
    }
  }, [childrenByPath, loadDir]);

  const selectFile = useCallback((path: string) => {
    setSelectedFile(path);
    if (root) syncUrl(root, path);
  }, [root, syncUrl]);

  const activeWorktree = useMemo(() => {
    if (!snapshot || !root) return null;
    for (const project of snapshot.projects) {
      for (const worktree of project.worktrees) {
        if (worktree.path === root) return { project, worktree };
      }
    }
    return null;
  }, [snapshot, root]);

  // Git-status decoration: repo-watch already carries this worktree's changed
  // files — tint them in the tree and dot every folder on the way down.
  const changedByPath = useMemo(() => {
    const map = new Map<string, string>();
    if (!root || !activeWorktree) return map;
    for (const file of activeWorktree.worktree.status.files) {
      map.set(`${root}/${file.path}`, file.status);
    }
    return map;
  }, [root, activeWorktree]);

  const changedDirs = useMemo(() => {
    const dirs = new Set<string>();
    if (!root) return dirs;
    for (const path of changedByPath.keys()) {
      let current = parentDir(path);
      while (current.startsWith(root)) {
        dirs.add(current);
        if (current === root) break;
        current = parentDir(current);
      }
    }
    return dirs;
  }, [root, changedByPath]);

  const relativeTitle = filePreview && filePreview.kind === "file" && root && filePreview.path.startsWith(`${root}/`)
    ? filePreview.path.slice(root.length + 1)
    : filePreview?.kind === "file"
      ? filePreview.title
      : null;

  const copyFile = useCallback(async () => {
    if (!filePreview || filePreview.kind !== "file" || !filePreview.previewable) return;
    const copied = await copyTextToClipboard(filePreview.content);
    if (copied) {
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 1500);
    }
  }, [filePreview]);

  return (
    <div className="s-code-screen" data-embedded={embedded || undefined}>
      <div className="s-code-head">
        <select
          className="s-code-rootPicker"
          value={root ?? ""}
          aria-label="Project or worktree"
          onChange={(event) => {
            const value = event.currentTarget.value || null;
            setSelectedFile(null);
            setRoot(value);
            if (value) syncUrl(value, null);
          }}
        >
          {!root ? <option value="">Pick a repo…</option> : null}
          {root && !activeWorktree ? <option value={root}>{root}</option> : null}
          {(snapshot?.projects ?? []).map((project) => (
            <optgroup key={project.id} label={project.name}>
              {project.worktrees.map((worktree) => (
                <option key={worktree.id} value={worktree.path}>
                  {project.name} · {worktreeLabel(worktree)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {activeWorktree?.worktree.diff.branchShortstat ? (
          <span className="s-code-headStat">{activeWorktree.worktree.diff.branchShortstat}</span>
        ) : null}
        {root ? <span className="s-code-headPath">{root}</span> : null}
      </div>
      <div className="s-code-body">
        <div className="s-code-tree" role="tree" aria-label="Files">
          {treeError ? (
            <div className="s-code-treeNote">{treeError}</div>
          ) : root ? (
            treeRows.map((row) =>
              row.loading ? (
                <div key={row.path} className="s-code-node s-code-node--loading" style={{ paddingLeft: 10 + row.depth * 14 }}>
                  {row.name}
                </div>
              ) : (
                <button
                  key={row.path}
                  type="button"
                  role="treeitem"
                  className="s-code-node"
                  data-selected={row.path === selectedFile || undefined}
                  data-diff={row.kind === "file" ? changedByPath.get(row.path) : undefined}
                  aria-expanded={row.kind === "directory" ? expanded.has(row.path) : undefined}
                  style={{ paddingLeft: 10 + row.depth * 14 }}
                  onClick={() => (row.kind === "directory" ? toggleDir(row.path) : selectFile(row.path))}
                  onMouseEnter={row.kind === "file" ? () => prefetchFile(row.path) : undefined}
                >
                  {row.kind === "directory" ? (
                    <ChevronRight
                      size={11}
                      strokeWidth={2}
                      className="s-code-nodeChevron"
                      data-open={expanded.has(row.path) || undefined}
                      aria-hidden
                    />
                  ) : (
                    <span className="s-code-nodeSpacer" aria-hidden />
                  )}
                  <span className="s-code-nodeName">{row.name}</span>
                  {row.kind === "file" && changedByPath.has(row.path) ? (
                    <span className="s-code-nodeBadge" data-diff={changedByPath.get(row.path)}>
                      {diffBadge(changedByPath.get(row.path) ?? "")}
                    </span>
                  ) : null}
                  {row.kind === "directory" && changedDirs.has(row.path) ? (
                    <span className="s-code-nodeDot" aria-label="Contains changes" />
                  ) : null}
                </button>
              ),
            )
          ) : (
            <div className="s-code-treeNote">No repo selected.</div>
          )}
        </div>
        <div className="s-code-main">
          {fileLoading ? (
            <div className="s-code-empty">Loading {selectedFile ? pathLeaf(selectedFile) : "file"}…</div>
          ) : fileError ? (
            <div className="s-code-empty">{fileError}</div>
          ) : filePreview && filePreview.kind === "file" && filePreview.previewable ? (
            <>
              <div className="s-code-fileHead">
                <span className="s-code-filePath">{relativeTitle}</span>
                <span className="s-code-fileMeta">
                  {formatBytes(filePreview.sizeBytes)}
                  {filePreview.truncated ? " · truncated" : ""}
                </span>
                <button
                  type="button"
                  className="s-code-fileAction"
                  onClick={() => void copyFile()}
                  title="Copy file contents"
                >
                  {copyStatus === "copied" ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
                  {copyStatus === "copied" ? "Copied" : "Copy"}
                </button>
                <a className="s-code-fileAction" href={filePreview.rawUrl} target="_blank" rel="noreferrer">
                  Raw
                </a>
              </div>
              {filePreview.truncated ? (
                <div className="s-code-fileNote">
                  Showing the first {formatBytes(256 * 1024)} of {formatBytes(filePreview.sizeBytes)} ·{" "}
                  <a href={filePreview.rawUrl} target="_blank" rel="noreferrer">open raw</a>
                </div>
              ) : null}
              <ShikiPane code={filePreview.content} path={filePreview.path} />
            </>
          ) : filePreview && filePreview.kind === "file" ? (
            <div className="s-code-empty">
              {filePreview.previewReason} · {formatBytes(filePreview.sizeBytes)} ·{" "}
              <a href={filePreview.rawUrl} target="_blank" rel="noreferrer">open raw</a>
            </div>
          ) : (
            <div className="s-code-empty">Pick a file to read.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export const scoutSurface = defineSurface({
  id: "code",
  label: "Code",
  route: { view: "code" },
  webPath: "/code",
  screen: "CodeContent",
  embed: {
    path: "/embed/code",
    profile: "macos.code",
    rootClassName: "s-code-embed",
    chrome: { showSecondaryNav: false, showPageStatusBar: false },
    hosts: { macos: true },
    resolveEmbedProps: (params) => ({
      root: params.get("root")?.trim() || undefined,
      file: params.get("file")?.trim() || undefined,
      project: params.get("project")?.trim() || undefined,
      path: params.get("path")?.trim() || undefined,
      wt: params.get("wt")?.trim() || undefined,
    }),
  },
});
