"use client";

import { useCallback, useEffect, useState } from "react";
import type { FileStat, TreeNode } from "@/lib/repo-tree";
import { TreeView } from "@/components/TreeView";
import { BreadcrumbPath } from "@/components/BreadcrumbPath";
import { CodeExcerpt } from "@/components/CodeExcerpt";
import { SymbolOutline } from "@/components/SymbolOutline";
import { DirSummary } from "@/components/DirSummary";

/**
 * FileExplorerWorkspace — interactive split-pane that owns selection
 * state for the file-explorer study. The left rail is a `TreeView`
 * rooted at a pre-walked subtree (passed in by the server page); the
 * right pane swaps between a `DirSummary` (no selection) and the
 * file-detail layout: breadcrumb · stat row · code excerpt · symbol
 * outline.
 *
 * File content is loaded on demand from `/api/repo-file?path=…` so the
 * initial server response stays small. The route enforces the same
 * containment + extension allowlist used by `/eng/file`.
 */

interface FetchResult {
  stat: FileStat;
  excerpt: string;
  language: string;
  truncated: boolean;
  totalLines: number;
}

export function FileExplorerWorkspace({
  initialTree,
  rootRel,
}: {
  initialTree: TreeNode;
  /** Repo-relative root used for the breadcrumb fallback header. */
  rootRel: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = useCallback((relPath: string) => {
    setSelected(relPath);
  }, []);

  // Fetch file content on selection change. AbortController prevents
  // a race when the user clicks a second file before the first lands.
  useEffect(() => {
    if (!selected) {
      setData(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/repo-file?path=${encodeURIComponent(selected)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<FetchResult>;
      })
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "load failed");
        setLoading(false);
      });
    return () => controller.abort();
  }, [selected]);

  return (
    <div className="flex min-h-[640px] overflow-hidden rounded-md border border-studio-edge bg-studio-canvas-alt">
      {/* ── Left rail ────────────────────────────────────────────── */}
      <aside
        className="flex w-[260px] shrink-0 flex-col border-r border-studio-edge bg-studio-surface"
      >
        <div className="flex flex-col gap-2 border-b border-studio-edge px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              Files
            </span>
            <span className="font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
              {countLeaves(initialTree)}
            </span>
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter…"
            className="w-full rounded-[3px] border border-studio-edge bg-studio-canvas px-2 py-1 font-mono text-[11px] text-studio-ink placeholder:text-studio-ink-faint focus:border-studio-edge-strong focus:outline-none"
          />
        </div>
        <div className="flex-1 overflow-auto py-1">
          <TreeView
            root={initialTree}
            density="compact"
            initialExpanded={false}
            searchTerm={search}
            currentPath={selected ?? undefined}
            onFileClick={handleSelect}
          />
        </div>
      </aside>

      {/* ── Right pane ────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <FileDetail
            relPath={selected}
            data={data}
            loading={loading}
            error={error}
            onSegmentClick={(rel) => {
              // Clicking a directory segment clears file selection so
              // the right pane goes back to the dir summary scope.
              if (rel !== selected) setSelected(null);
            }}
          />
        ) : (
          <div className="flex-1 overflow-auto p-5">
            <DirSummary tree={initialTree} />
            <p className="mt-4 font-sans text-[12px] italic text-studio-ink-faint">
              Select a file from the tree to see its excerpt + outline.{" "}
              <span className="font-mono text-[11px] text-studio-ink-faint">
                {rootRel}
              </span>
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function FileDetail({
  relPath,
  data,
  loading,
  error,
  onSegmentClick,
}: {
  relPath: string;
  data: FetchResult | null;
  loading: boolean;
  error: string | null;
  onSegmentClick: (parentRel: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-studio-edge bg-studio-canvas px-5 py-3 backdrop-blur">
        <BreadcrumbPath relPath={relPath} onSegmentClick={onSegmentClick} />
        <StatRow data={data} loading={loading} relPath={relPath} />
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Body */}
        <div className="min-w-0 flex-1 overflow-auto p-5">
          {error ? (
            <div className="rounded-md border border-status-error-fg/30 bg-status-error-bg/60 px-4 py-3 font-mono text-[11.5px] text-status-error-fg">
              Failed to load: {error}
            </div>
          ) : loading || !data ? (
            <LoadingShell />
          ) : (
            <CodeExcerpt
              content={data.excerpt}
              language={data.language}
              startLine={1}
              endLine={Math.min(80, data.totalLines)}
              maxLines={80}
            />
          )}
        </div>

        {/* Outline rail */}
        <aside className="hidden w-[240px] shrink-0 border-l border-studio-edge bg-studio-canvas-alt p-3 lg:block">
          {data ? (
            <SymbolOutline content={data.excerpt} language={data.language} />
          ) : (
            <div className="rounded-md border border-studio-edge bg-studio-surface px-3 py-2 font-mono text-[10px] italic text-studio-ink-faint">
              {loading ? "Loading outline…" : "—"}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function StatRow({
  data,
  loading,
  relPath,
}: {
  data: FetchResult | null;
  loading: boolean;
  relPath: string;
}) {
  if (loading && !data) {
    return (
      <div className="flex items-baseline gap-3 font-mono text-[10px] text-studio-ink-faint">
        <span>Loading…</span>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-baseline gap-3 font-mono text-[10px] text-studio-ink-faint">
        <span className="text-studio-ink-faint">{relPath}</span>
      </div>
    );
  }
  const { stat, language, truncated } = data;
  return (
    <div className="flex flex-wrap items-baseline gap-3 font-mono text-[10px] text-studio-ink-faint">
      <span
        className="rounded-[2px] px-1 py-px font-mono text-[8.5px] font-semibold uppercase tracking-[0.18em]"
        style={{
          color: langAccent(language),
          background: "var(--studio-canvas-alt)",
        }}
      >
        {langLabel(language)}
      </span>
      <Sep />
      {stat.lines !== null ? (
        <span>
          <span className="tabular-nums text-studio-ink">{stat.lines}</span>{" "}
          lines
        </span>
      ) : null}
      <Sep />
      <span>
        <span className="tabular-nums text-studio-ink">
          {formatBytes(stat.bytes)}
        </span>
      </span>
      <Sep />
      <span>updated {timeAgo(stat.updatedAt)}</span>
      {truncated ? (
        <>
          <Sep />
          <span
            className="rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.18em]"
            style={{
              color: "var(--status-warn-fg)",
              background: "var(--status-warn-bg)",
            }}
          >
            TRUNCATED
          </span>
        </>
      ) : null}
    </div>
  );
}

function LoadingShell() {
  return (
    <div
      className="overflow-hidden rounded-md border"
      style={{
        background: "var(--code-bg)",
        borderColor: "var(--code-border)",
      }}
    >
      <div className="flex flex-col gap-1.5 p-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="h-2 rounded-[2px] bg-studio-edge"
            style={{ width: `${40 + (i % 5) * 12}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function Sep() {
  return <span aria-hidden className="h-3 w-px shrink-0 bg-studio-edge" />;
}

const LANG_ACCENT: Record<string, string> = {
  md: "var(--scout-accent)",
  tsx: "var(--status-info-fg)",
  ts: "var(--status-info-fg)",
  js: "var(--status-warn-fg)",
  jsx: "var(--status-warn-fg)",
  swift: "var(--status-error-fg)",
  json: "var(--status-warn-fg)",
  css: "var(--status-info-fg)",
};

function langAccent(ext: string): string {
  return LANG_ACCENT[ext] ?? "var(--studio-ink-faint)";
}

function langLabel(ext: string): string {
  switch (ext) {
    case "ts":
      return "TypeScript";
    case "tsx":
      return "TSX";
    case "js":
      return "JavaScript";
    case "jsx":
      return "JSX";
    case "md":
      return "Markdown";
    case "swift":
      return "Swift";
    case "json":
      return "JSON";
    case "css":
      return "CSS";
    default:
      return ext ? ext.toUpperCase() : "text";
  }
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.round(diffDay / 30);
  return `${diffMo}mo ago`;
}

function countLeaves(node: TreeNode): number {
  if (node.kind === "file") return 1;
  if (!node.children) return 0;
  return node.children.reduce((sum, c) => sum + countLeaves(c), 0);
}
