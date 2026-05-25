import type { TreeNode } from "@/lib/repo-tree";
import { BreadcrumbPath } from "@/components/BreadcrumbPath";

/**
 * DirSummary — at-a-glance card for a directory. Shows breadcrumb,
 * a 4-up metric row (files · dirs · total size · last touched), and a
 * small horizontal bar of the top-3 languages by file count. All
 * stats are derived in-component from a `TreeNode` produced by
 * `readTree` — no extra disk reads.
 *
 * Rendered as the right-pane fallback in the file-explorer when no
 * file is selected.
 */
export function DirSummary({ tree }: { tree: TreeNode }) {
  const stats = collectStats(tree);

  return (
    <div className="flex flex-col gap-5 rounded-md border border-studio-edge bg-studio-surface p-5">
      <header className="flex flex-col gap-2">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · directory
        </div>
        <BreadcrumbPath relPath={tree.relPath || tree.name} />
      </header>

      <div className="grid grid-cols-2 gap-3 border-t border-studio-edge pt-4 sm:grid-cols-4">
        <Metric label="Files" value={stats.files.toLocaleString()} />
        <Metric label="Dirs" value={stats.dirs.toLocaleString()} />
        <Metric label="Total" value={formatBytes(stats.bytes)} />
        <Metric label="Last touched" value={lastTouched(stats.latestMtime)} />
      </div>

      {stats.topLangs.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-studio-edge pt-4">
          <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            Top languages
          </div>
          <LangBar entries={stats.topLangs} total={stats.langCountedTotal} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-studio-ink-faint">
            {stats.topLangs.map(([lang, count]) => (
              <span key={lang} className="inline-flex items-baseline gap-1.5">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-[1px]"
                  style={{ background: langColor(lang) }}
                />
                <span className="text-studio-ink-muted">{langLabel(lang)}</span>
                <span className="tabular-nums text-studio-ink-faint">
                  {count}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </div>
      <div className="font-mono text-[15px] tabular-nums text-studio-ink">
        {value}
      </div>
    </div>
  );
}

function LangBar({
  entries,
  total,
}: {
  entries: Array<[string, number]>;
  total: number;
}) {
  if (total === 0) return null;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-studio-canvas-alt">
      {entries.map(([lang, count]) => {
        const pct = (count / total) * 100;
        return (
          <div
            key={lang}
            className="h-full"
            style={{
              width: `${pct}%`,
              background: langColor(lang),
              minWidth: "2px",
            }}
            title={`${langLabel(lang)} · ${count} files`}
          />
        );
      })}
    </div>
  );
}

interface DirStats {
  files: number;
  dirs: number;
  bytes: number;
  latestMtime: number;
  /** Top 3 languages by file count. */
  topLangs: Array<[string, number]>;
  /** Sum of files across the top-3 languages only — used to scale
   *  the bar so unknowns don't shrink everything. */
  langCountedTotal: number;
}

function collectStats(tree: TreeNode): DirStats {
  let files = 0;
  let dirs = 0;
  let bytes = 0;
  let latestMtime = 0;
  const langCounts = new Map<string, number>();

  function visit(node: TreeNode) {
    if (node.kind === "dir") {
      if (node.relPath && node !== tree) dirs += 1;
      for (const child of node.children ?? []) visit(child);
      return;
    }
    files += 1;
    bytes += node.bytes ?? 0;
    if (node.updatedAt) {
      const t = new Date(node.updatedAt).getTime();
      if (!Number.isNaN(t) && t > latestMtime) latestMtime = t;
    }
    const ext = extOf(node.name);
    if (ext) {
      langCounts.set(ext, (langCounts.get(ext) ?? 0) + 1);
    }
  }

  visit(tree);

  const sorted = [...langCounts.entries()].sort((a, b) => b[1] - a[1]);
  const topLangs = sorted.slice(0, 3);
  const langCountedTotal = topLangs.reduce((sum, [, c]) => sum + c, 0);

  return { files, dirs, bytes, latestMtime, topLangs, langCountedTotal };
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

const LANG_ACCENT: Record<string, string> = {
  md: "var(--scout-accent)",
  mdx: "var(--scout-accent)",
  tsx: "var(--status-info-fg)",
  ts: "var(--status-info-fg)",
  js: "var(--status-warn-fg)",
  jsx: "var(--status-warn-fg)",
  swift: "var(--status-error-fg)",
  json: "var(--status-warn-fg)",
  css: "var(--status-info-fg)",
  yml: "var(--studio-ink-faint)",
  yaml: "var(--studio-ink-faint)",
  toml: "var(--studio-ink-faint)",
};

function langColor(ext: string): string {
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
    case "yml":
    case "yaml":
      return "YAML";
    case "toml":
      return "TOML";
    default:
      return ext ? ext.toUpperCase() : "text";
  }
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function lastTouched(ms: number): string {
  if (ms === 0) return "—";
  const diffSec = Math.max(1, Math.round((Date.now() - ms) / 1000));
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
