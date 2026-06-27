import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createTextDocument,
  TextDocumentSurface,
} from "../../components/TextDocumentSurface.tsx";
import { api } from "../../lib/api.ts";
import type { FilePreviewContent, TextFilePreviewContent } from "../../scout/file-renderers/types.ts";
import type { ProjectOverviewPayload } from "./project-overview-helpers.ts";

export type RepoArtifact = ProjectOverviewPayload["artifacts"][number];

type TreeDir = {
  type: "dir";
  name: string;
  path: string;
  children: TreeNode[];
};

type TreeFile = {
  type: "file";
  name: string;
  path: string;
  artifact: RepoArtifact;
};

type TreeNode = TreeDir | TreeFile;

function sortTree(node: TreeDir): void {
  node.children.sort((left, right) => {
    if (left.type !== right.type) return left.type === "dir" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const child of node.children) {
    if (child.type === "dir") sortTree(child);
  }
}

function collapseSingleChildDirs(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.type !== "dir") return node;
    let collapsed = node;
    while (
      collapsed.children.length === 1
      && collapsed.children[0]!.type === "dir"
    ) {
      const child = collapsed.children[0] as TreeDir;
      collapsed = {
        type: "dir",
        name: collapsed.name ? `${collapsed.name}/${child.name}` : child.name,
        path: child.path,
        children: child.children,
      };
    }
    return {
      ...collapsed,
      children: collapseSingleChildDirs(collapsed.children),
    };
  });
}

function buildArtifactTree(artifacts: RepoArtifact[]): TreeNode[] {
  const root: TreeDir = { type: "dir", name: "", path: "", children: [] };
  for (const artifact of artifacts) {
    const parts = artifact.relativePath.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const segment = parts[i]!;
      const segmentPath = parts.slice(0, i + 1).join("/");
      let next = cursor.children.find(
        (child) => child.type === "dir" && child.name === segment,
      ) as TreeDir | undefined;
      if (!next) {
        next = { type: "dir", name: segment, path: segmentPath, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }
    cursor.children.push({
      type: "file",
      name: parts[parts.length - 1]!,
      path: artifact.relativePath,
      artifact,
    });
  }
  sortTree(root);
  return collapseSingleChildDirs(root.children);
}

function defaultArtifact(artifacts: RepoArtifact[]): RepoArtifact | null {
  const instructions = artifacts.filter((a) => a.kind === "instructions");
  return instructions[0] ?? artifacts[0] ?? null;
}

function documentFromArtifact(
  artifact: RepoArtifact,
  content: string,
  truncated: boolean,
) {
  const isMarkdown = artifact.relativePath.endsWith(".md") || artifact.relativePath.endsWith(".mdx");
  const isJson = artifact.relativePath.endsWith(".json");
  return createTextDocument({
    id: artifact.absolutePath,
    title: artifact.relativePath,
    uri: artifact.absolutePath,
    filename: artifact.relativePath.split("/").pop(),
    kind: isMarkdown ? "markdown" : isJson ? "code" : "code",
    language: isJson ? "json" : isMarkdown ? "markdown" : "plain",
    value: truncated ? `${content}\n\n— excerpt —` : content,
    readOnly: true,
  });
}

function TreeRow({
  node,
  depth,
  selectedPath,
  collapsed,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (artifact: RepoArtifact) => void;
}) {
  if (node.type === "file") {
    const selected = selectedPath === node.path;
    return (
      <button
        type="button"
        className="av2-repoTreeRow av2-repoTreeFile"
        data-selected={selected || undefined}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => onSelect(node.artifact)}
        title={node.artifact.absolutePath}
      >
        <span className="av2-repoTreeChevron" aria-hidden />
        <span className="av2-repoTreeIcon" aria-hidden>
          <FileText size={13} strokeWidth={1.5} />
        </span>
        <span className="av2-repoTreeName">{node.name}</span>
        <span className="av2-repoTreeKind" data-kind={node.artifact.kind}>
          {node.artifact.kind}
        </span>
      </button>
    );
  }

  const isCollapsed = collapsed.has(node.path);
  return (
    <>
      <button
        type="button"
        className="av2-repoTreeRow av2-repoTreeDir"
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => onToggle(node.path)}
        title={node.path}
      >
        <span className="av2-repoTreeChevron" aria-hidden>
          {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </span>
        <span className="av2-repoTreeIcon" aria-hidden>
          {isCollapsed ? <Folder size={13} strokeWidth={1.5} /> : <FolderOpen size={13} strokeWidth={1.5} />}
        </span>
        <span className="av2-repoTreeName">{node.name}</span>
      </button>
      {!isCollapsed
        ? node.children.map((child) => (
          <TreeRow
            key={child.type === "dir" ? `d:${child.path}` : `f:${child.path}`}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            collapsed={collapsed}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))
        : null}
    </>
  );
}

export type ViewableProjectFile = {
  relativePath: string;
  absolutePath: string;
  excerpt: string | null;
};

export function FileViewerPane({
  artifact,
  onOpen,
  onReveal,
}: {
  artifact: ViewableProjectFile;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
}) {
  const [content, setContent] = useState<string | null>(artifact.excerpt);
  const [truncated, setTruncated] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(artifact.excerpt);
    setTruncated(true);
    setError(null);
    let cancelled = false;
    setLoading(true);
    api<FilePreviewContent>(`/api/file/preview?path=${encodeURIComponent(artifact.absolutePath)}`)
      .then((preview) => {
        if (cancelled) return;
        if (preview.kind === "file" && preview.previewable) {
          const text = preview as TextFilePreviewContent;
          setContent(text.content);
          setTruncated(text.truncated);
        } else if (artifact.excerpt) {
          setContent(artifact.excerpt);
          setTruncated(true);
        } else {
          setContent(null);
          setError("Preview not available for this file type.");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (artifact.excerpt) {
          setContent(artifact.excerpt);
          setTruncated(true);
        } else {
          setError(err instanceof Error ? err.message : "Could not load file.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.absolutePath, artifact.excerpt]);

  const document = useMemo(() => {
    if (!content) return null;
    return documentFromArtifact(artifact, content, truncated);
  }, [artifact, content, truncated]);

  const isMarkdown = artifact.relativePath.endsWith(".md") || artifact.relativePath.endsWith(".mdx");

  return (
    <>
      <header className="av2-repoViewerHead">
        <div className="av2-repoViewerPath">
          <span className="av2-repoViewerPathFile">{artifact.relativePath}</span>
          <span className="av2-repoViewerPathAbs" title={artifact.absolutePath}>
            {artifact.absolutePath}
          </span>
        </div>
        <div className="av2-repoViewerActs">
          <button type="button" className="av2-repoViewerAct" data-primary onClick={() => onOpen(artifact.absolutePath)}>
            open
          </button>
          <button type="button" className="av2-repoViewerAct" onClick={() => void onReveal(artifact.absolutePath)}>
            reveal
          </button>
        </div>
      </header>
      <div className="av2-repoViewerBody">
        {loading && !content ? (
          <div className="av2-repoViewerState">Loading file…</div>
        ) : error && !content ? (
          <div className="av2-repoViewerState av2-repoViewerState--error">{error}</div>
        ) : document ? (
          <TextDocumentSurface
            document={document}
            mode={isMarkdown ? "preview" : "read"}
            className="av2-repoViewerDoc"
          />
        ) : (
          <div className="av2-repoViewerState">No content.</div>
        )}
        {truncated ? (
          <div className="av2-repoViewerNotice">Showing excerpt — use open for the full file.</div>
        ) : null}
      </div>
    </>
  );
}

export function ProjectRepoFrame({
  artifacts,
  onOpen,
  onReveal,
}: {
  artifacts: RepoArtifact[];
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
}) {
  const tree = useMemo(() => buildArtifactTree(artifacts), [artifacts]);
  const [selected, setSelected] = useState<RepoArtifact | null>(() => defaultArtifact(artifacts));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setSelected((current) => {
      if (current && artifacts.some((a) => a.absolutePath === current.absolutePath)) {
        return current;
      }
      return defaultArtifact(artifacts);
    });
  }, [artifacts]);

  const handleToggle = useCallback((path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (artifacts.length === 0) {
    return <span className="av2-facetEmpty">No project files found on disk.</span>;
  }

  return (
    <div className="av2-repoFrame">
      <aside className="av2-repoTree" aria-label="Project files">
        <div className="av2-repoTreeHead">
          <span className="av2-repoTreeHeadLabel">Files</span>
          <span className="av2-repoTreeHeadCount">{artifacts.length}</span>
        </div>
        <div className="av2-repoTreeList">
          {tree.map((node) => (
            <TreeRow
              key={node.type === "dir" ? `d:${node.path}` : `f:${node.path}`}
              node={node}
              depth={0}
              selectedPath={selected?.relativePath ?? null}
              collapsed={collapsed}
              onToggle={handleToggle}
              onSelect={setSelected}
            />
          ))}
        </div>
      </aside>
      <section className="av2-repoViewer" aria-label="File preview">
        {selected ? (
          <FileViewerPane artifact={selected} onOpen={onOpen} onReveal={onReveal} />
        ) : (
          <div className="av2-repoViewerState">Select a file to preview.</div>
        )}
      </section>
    </div>
  );
}