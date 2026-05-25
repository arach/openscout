import Link from "next/link";
import type { FileStat } from "@/lib/repo-tree";

/**
 * File card — at-a-glance metadata tile for a single repo file.
 *
 * Three sizes:
 *   "compact"  — single inline row (path · lang · lines · size)
 *   "standard" — multi-line tile with action footer
 *   "preview"  — standard + a code excerpt (first N lines)
 *
 * Always links to /eng/file/<relPath>. The excerpt variant is fed
 * pre-sliced content from the server so client never sees the full
 * file.
 */

const LANG_ACCENT: Record<string, string> = {
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
  toml: "var(--studio-ink-faint)",
};

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
    case "sh":
    case "bash":
    case "zsh":
      return "Shell";
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
  const now = Date.now();
  const diffSec = Math.max(1, Math.round((now - then) / 1000));
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

function fileHref(relPath: string, fromRoute?: string): string {
  const segments = relPath.split("/").map(encodeURIComponent).join("/");
  const from = fromRoute ? `?from=${encodeURIComponent(fromRoute)}` : "";
  return `/eng/file/${segments}${from}`;
}

export function FileCardCompact({
  stat,
  fromRoute,
}: {
  stat: FileStat;
  fromRoute?: string;
}) {
  const accent = LANG_ACCENT[stat.extension] ?? "var(--studio-ink-faint)";
  return (
    <Link
      href={fileHref(stat.relPath, fromRoute)}
      className="group flex items-baseline gap-3 rounded-[3px] border border-studio-edge bg-studio-surface px-3 py-2 transition-colors hover:border-studio-edge-strong"
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-[1px]"
        style={{ background: accent }}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-studio-ink">
        {stat.relPath}
      </span>
      <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        {langLabel(stat.extension)}
      </span>
      <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
        {stat.lines !== null ? `${stat.lines} L` : ""}
      </span>
      <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
        {formatBytes(stat.bytes)}
      </span>
    </Link>
  );
}

export function FileCardStandard({
  stat,
  fromRoute,
}: {
  stat: FileStat;
  fromRoute?: string;
}) {
  const accent = LANG_ACCENT[stat.extension] ?? "var(--studio-ink-faint)";
  const dir = stat.relPath.includes("/")
    ? stat.relPath.slice(0, stat.relPath.lastIndexOf("/"))
    : "";
  return (
    <Link
      href={fileHref(stat.relPath, fromRoute)}
      className="group flex flex-col gap-2 rounded-md border border-studio-edge bg-studio-surface px-4 py-3 transition-colors hover:border-studio-edge-strong"
    >
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-[2px]"
          style={{ background: accent }}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-studio-ink">
          {stat.name}
        </span>
        <span
          className="rounded-[2px] px-1 py-px font-mono text-[8.5px] font-semibold uppercase tracking-[0.18em]"
          style={{
            color: accent,
            background: "var(--studio-canvas-alt)",
          }}
        >
          {langLabel(stat.extension)}
        </span>
      </div>
      {dir ? (
        <div className="truncate font-mono text-[10px] text-studio-ink-faint">
          {dir}/
        </div>
      ) : null}
      <div className="flex items-baseline gap-4 border-t border-studio-edge pt-1.5 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        {stat.lines !== null ? (
          <span>
            <span className="tabular-nums text-studio-ink">{stat.lines}</span>{" "}
            lines
          </span>
        ) : null}
        <span>
          <span className="tabular-nums text-studio-ink">
            {formatBytes(stat.bytes)}
          </span>
        </span>
        <span className="ml-auto normal-case tracking-normal text-studio-ink-faint">
          {timeAgo(stat.updatedAt)}
        </span>
      </div>
    </Link>
  );
}

export function FileCardPreview({
  stat,
  excerpt,
  fromRoute,
}: {
  stat: FileStat;
  excerpt: string;
  fromRoute?: string;
}) {
  const accent = LANG_ACCENT[stat.extension] ?? "var(--studio-ink-faint)";
  return (
    <Link
      href={fileHref(stat.relPath, fromRoute)}
      className="group flex flex-col gap-2 rounded-md border border-studio-edge bg-studio-surface transition-colors hover:border-studio-edge-strong"
    >
      <div className="flex items-baseline gap-2 px-4 pt-3">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-[2px]"
          style={{ background: accent }}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-studio-ink">
          {stat.name}
        </span>
        <span className="font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          {langLabel(stat.extension)}
        </span>
      </div>
      <div className="truncate px-4 font-mono text-[10px] text-studio-ink-faint">
        {stat.relPath}
      </div>
      <pre className="m-0 max-h-[180px] overflow-hidden border-t border-studio-edge px-4 py-2 font-mono text-[11px] leading-[1.55] text-studio-ink-muted">
        {excerpt}
      </pre>
      <div className="flex items-baseline gap-4 border-t border-studio-edge px-4 py-2 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        {stat.lines !== null ? (
          <span>
            <span className="tabular-nums text-studio-ink">{stat.lines}</span>{" "}
            lines
          </span>
        ) : null}
        <span>
          <span className="tabular-nums text-studio-ink">
            {formatBytes(stat.bytes)}
          </span>
        </span>
        <span className="ml-auto normal-case tracking-normal text-studio-ink-faint">
          {timeAgo(stat.updatedAt)}
        </span>
      </div>
    </Link>
  );
}
