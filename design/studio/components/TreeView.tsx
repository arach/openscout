"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TreeNode } from "@/lib/repo-tree";

/**
 * Collapsible tree view. Client component so users can expand/collapse
 * branches without round-trips. Files link to /eng/file/<relPath>.
 * Directories open inline.
 *
 * Density:
 *   "comfortable" — 24px row, 10px gutter; good for sidebars + studies
 *   "compact"     — 18px row, 6px gutter; for dense file listings
 *
 * Filtering + selection (new):
 *   `searchTerm`  — case-insensitive filename match; ancestors of any
 *                   match are force-expanded.
 *   `currentPath` — repo-relative path of the selected file; ancestors
 *                   are force-expanded and the matching leaf gets a
 *                   subtle highlight.
 *
 * Indent guides: each child container draws a faint 1px rule on its
 * left edge so nesting reads at a glance without alignment math.
 *
 * Keyboard nav: when the tree has focus, arrow keys move between
 * visible rows (↑/↓), expand/collapse the focused dir (→/←), and Enter
 * activates the focused entry (opens the file or fires onFileClick).
 *
 * The first level always renders expanded; deeper levels start
 * collapsed unless `initialExpanded` is true.
 */
export function TreeView({
  root,
  density = "comfortable",
  initialExpanded = false,
  fromRoute,
  searchTerm,
  currentPath,
  onFileClick,
}: {
  root: TreeNode;
  density?: "comfortable" | "compact";
  /** Expand every directory by default — handy for small trees. */
  initialExpanded?: boolean;
  /** Used by file links to pass a back-ref to the viewer page. */
  fromRoute?: string;
  /** Case-insensitive filename filter. Empty / undefined = no filter. */
  searchTerm?: string;
  /** Repo-relative path of the currently-selected file (highlighted). */
  currentPath?: string;
  /** When set, file rows call this *instead of* navigating. Pass the
   *  file's relPath. Used by interactive in-page selection (the
   *  file-explorer study). */
  onFileClick?: (relPath: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Ancestors of the current selection / search match — must be open.
  const forceOpen = useMemo(() => {
    const set = new Set<string>();
    if (currentPath) {
      collectAncestors(currentPath, set);
    }
    const term = (searchTerm ?? "").trim().toLowerCase();
    if (term) {
      collectSearchAncestors(root, term, set);
    }
    return set;
  }, [root, searchTerm, currentPath]);

  // Pre-filter the tree when there's a search term. Without one we
  // render the unfiltered tree — cheap and preserves expand state.
  const filteredRoot = useMemo(() => {
    const term = (searchTerm ?? "").trim().toLowerCase();
    if (!term) return root;
    return filterTree(root, term) ?? { ...root, children: [] };
  }, [root, searchTerm]);

  // Visible-row registry used by keyboard nav. Each render rebuilds it
  // from the actual DOM after mount via a layout effect; rather than
  // mirror the open/close state in JS, we walk the rendered tabbables.
  const focusableSelector = '[data-tree-row="1"]';
  const [focusedIndex, setFocusedIndex] = useState<number>(0);

  function focusRowAt(index: number) {
    const root = rootRef.current;
    if (!root) return;
    const rows = root.querySelectorAll<HTMLElement>(focusableSelector);
    if (rows.length === 0) return;
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    rows[clamped].focus();
    setFocusedIndex(clamped);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const root = rootRef.current;
    if (!root) return;
    const rows = Array.from(
      root.querySelectorAll<HTMLElement>(focusableSelector),
    );
    if (rows.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    const currentIdx = active ? rows.indexOf(active) : -1;
    const idx = currentIdx >= 0 ? currentIdx : focusedIndex;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusRowAt(idx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRowAt(Math.max(0, idx - 1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const row = rows[idx];
      if (row?.dataset.kind === "dir" && row.dataset.open === "false") {
        row.click();
      } else {
        focusRowAt(idx + 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const row = rows[idx];
      if (row?.dataset.kind === "dir" && row.dataset.open === "true") {
        row.click();
      } else {
        focusRowAt(Math.max(0, idx - 1));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      rows[idx]?.click();
    }
  }

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="font-mono outline-none focus-visible:ring-1 focus-visible:ring-scout-accent/40"
      role="tree"
    >
      {filteredRoot.children?.map((child) => (
        <TreeNodeView
          key={child.relPath}
          node={child}
          depth={0}
          density={density}
          startExpanded
          initialExpanded={initialExpanded}
          fromRoute={fromRoute}
          forceOpen={forceOpen}
          currentPath={currentPath}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
}

function TreeNodeView({
  node,
  depth,
  density,
  startExpanded,
  initialExpanded,
  fromRoute,
  forceOpen,
  currentPath,
  onFileClick,
}: {
  node: TreeNode;
  depth: number;
  density: "comfortable" | "compact";
  startExpanded?: boolean;
  initialExpanded: boolean;
  fromRoute?: string;
  forceOpen: Set<string>;
  currentPath?: string;
  onFileClick?: (relPath: string) => void;
}) {
  const shouldForceOpen = forceOpen.has(node.relPath);
  const [open, setOpen] = useState(
    startExpanded || initialExpanded || shouldForceOpen,
  );

  // Keep open in sync when forceOpen flips (search term changes, etc.).
  useEffect(() => {
    if (shouldForceOpen && !open) setOpen(true);
  }, [shouldForceOpen, open]);

  const padY = density === "compact" ? "py-[3px]" : "py-1";
  const indent = depth * (density === "compact" ? 12 : 14);

  if (node.kind === "dir") {
    const fileCount = countLeaves(node);
    return (
      <div>
        <button
          type="button"
          data-tree-row="1"
          data-kind="dir"
          data-open={open ? "true" : "false"}
          onClick={() => setOpen((v) => !v)}
          className={`group flex w-full items-baseline gap-1.5 ${padY} pr-2 transition-colors hover:bg-studio-canvas-alt focus:bg-studio-canvas-alt focus:outline-none`}
          style={{ paddingLeft: 8 + indent }}
        >
          <span
            aria-hidden
            className={`w-3 shrink-0 text-[10px] text-studio-ink-faint transition-transform ${
              open ? "translate-y-px" : ""
            }`}
          >
            {open ? "▾" : "▸"}
          </span>
          <FolderGlyph open={open} />
          <span className="min-w-0 flex-1 truncate text-left text-[12px] text-studio-ink">
            {node.name}
          </span>
          <span className="font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
            {fileCount}
          </span>
        </button>
        {open ? (
          <div
            style={{
              // Indent guide — faint vertical rule at the child column.
              boxShadow: "inset 1px 0 0 var(--studio-edge)",
              marginLeft: 8 + indent + 6,
            }}
          >
            {node.children?.map((child) => (
              <TreeNodeView
                key={child.relPath}
                node={child}
                depth={depth + 1}
                density={density}
                initialExpanded={initialExpanded}
                fromRoute={fromRoute}
                forceOpen={forceOpen}
                currentPath={currentPath}
                onFileClick={onFileClick}
              />
            ))}
            {node.truncatedAtDepth ? (
              <div
                className="font-mono text-[9.5px] italic text-studio-ink-faint"
                style={{ paddingLeft: 8 }}
              >
                …truncated at depth
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const isCurrent = currentPath === node.relPath;
  const href = `/eng/file/${node.relPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}${fromRoute ? `?from=${encodeURIComponent(fromRoute)}` : ""}`;

  const rowCls = `group flex items-baseline gap-1.5 ${padY} pr-2 transition-colors focus:outline-none ${
    isCurrent
      ? "bg-scout-accent-soft"
      : "hover:bg-studio-canvas-alt focus:bg-studio-canvas-alt"
  }`;

  const inner = (
    <>
      <span aria-hidden className="w-3 shrink-0" />
      <FileGlyph extension={extOf(node.name)} />
      <span
        className={`min-w-0 flex-1 truncate text-[12px] ${
          isCurrent
            ? "text-studio-ink"
            : "text-studio-ink-muted group-hover:text-studio-ink"
        }`}
      >
        {node.name}
      </span>
      {typeof node.bytes === "number" ? (
        <span className="font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
          {formatBytes(node.bytes)}
        </span>
      ) : null}
    </>
  );

  // When onFileClick is supplied we suppress navigation entirely —
  // the host owns the selection state.
  if (onFileClick) {
    return (
      <button
        type="button"
        data-tree-row="1"
        data-kind="file"
        onClick={() => onFileClick(node.relPath)}
        className={`${rowCls} w-full text-left`}
        style={{ paddingLeft: 8 + indent }}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      href={href}
      data-tree-row="1"
      data-kind="file"
      className={rowCls}
      style={{ paddingLeft: 8 + indent }}
    >
      {inner}
    </Link>
  );
}

function FolderGlyph({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className="h-3 w-3 shrink-0 text-studio-ink-faint"
      fill="none"
    >
      {open ? (
        <path
          d="M1 3.5h3.5l1 1H11v6.5H1V3.5z"
          stroke="currentColor"
          strokeWidth="0.75"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M1 3.5h3.5l1 1H11V11H1V3.5z"
          stroke="currentColor"
          strokeWidth="0.75"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

const EXT_COLOR: Record<string, string> = {
  md: "var(--scout-accent)",
  tsx: "var(--status-info-fg)",
  ts: "var(--status-info-fg)",
  js: "var(--status-warn-fg)",
  jsx: "var(--status-warn-fg)",
  swift: "var(--status-error-fg)",
  json: "var(--status-warn-fg)",
  css: "var(--status-info-fg)",
  yml: "var(--studio-ink-faint)",
  yaml: "var(--studio-ink-faint)",
};

function FileGlyph({ extension }: { extension: string }) {
  const color = EXT_COLOR[extension] ?? "var(--studio-ink-faint)";
  return (
    <span
      aria-hidden
      className="h-1.5 w-1.5 shrink-0 rounded-[1px]"
      style={{ background: color }}
    />
  );
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function countLeaves(node: TreeNode): number {
  if (node.kind === "file") return 1;
  if (!node.children) return 0;
  return node.children.reduce((sum, c) => sum + countLeaves(c), 0);
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}K`;
  return `${(b / 1024 / 1024).toFixed(1)}M`;
}

/** Walk a relPath's parents and add every directory chunk to `set`. */
function collectAncestors(relPath: string, set: Set<string>) {
  const parts = relPath.split("/");
  for (let i = 0; i < parts.length - 1; i++) {
    set.add(parts.slice(0, i + 1).join("/"));
  }
}

/** Find every dir that contains a matching descendant; add to set. */
function collectSearchAncestors(
  node: TreeNode,
  term: string,
  set: Set<string>,
): boolean {
  if (node.kind === "file") {
    return node.name.toLowerCase().includes(term);
  }
  let hit = false;
  for (const child of node.children ?? []) {
    if (collectSearchAncestors(child, term, set)) {
      hit = true;
    }
  }
  if (hit && node.relPath) set.add(node.relPath);
  return hit;
}

/** Prune the tree to entries matching `term` (kept dirs always have
 *  at least one matching descendant). */
function filterTree(node: TreeNode, term: string): TreeNode | null {
  if (node.kind === "file") {
    return node.name.toLowerCase().includes(term) ? node : null;
  }
  const kids: TreeNode[] = [];
  for (const child of node.children ?? []) {
    const kept = filterTree(child, term);
    if (kept) kids.push(kept);
  }
  if (kids.length === 0 && node.relPath !== "") return null;
  return { ...node, children: kids };
}
