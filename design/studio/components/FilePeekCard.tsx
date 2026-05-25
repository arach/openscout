import Link from "next/link";
import type { FileStat } from "@/lib/repo-tree";

/**
 * FilePeekCard — floating card meant to sit above other content as a
 * hover-card or popover. Visually heavier than `FileCardCompact`: a
 * stronger border, drop shadow, and an inline 6-line excerpt under the
 * stat row. Use it when the surface needs to feel detached from the
 * page (e.g. positioned by floating-ui / portal).
 *
 * Stat shape mirrors `FileStat` from `lib/repo-tree.ts` so the same
 * server data feeds both this and the inline cards.
 */
export function FilePeekCard({
  stat,
  excerpt,
  fromRoute,
}: {
  stat: FileStat;
  /** Pre-sliced excerpt (≤ 6 lines recommended). Optional — when
   *  missing the card still renders the stat row. */
  excerpt?: string;
  fromRoute?: string;
}) {
  const accent = LANG_ACCENT[stat.extension] ?? "var(--studio-ink-faint)";
  const dir = stat.relPath.includes("/")
    ? stat.relPath.slice(0, stat.relPath.lastIndexOf("/"))
    : "";

  const previewLines = excerpt ? excerpt.split("\n").slice(0, 6) : [];

  const href = `/eng/file/${stat.relPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}${fromRoute ? `?from=${encodeURIComponent(fromRoute)}` : ""}`;

  return (
    <Link
      href={href}
      className="group flex w-[360px] max-w-full flex-col gap-2 rounded-md border border-studio-edge-strong bg-studio-surface shadow-lg transition-colors hover:border-scout-accent/60"
      style={{
        boxShadow:
          "0 12px 32px -8px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.25)",
      }}
    >
      <div className="flex items-baseline gap-2 px-3 pt-2.5">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-[2px]"
          style={{ background: accent }}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-studio-ink">
          {stat.name}
        </span>
        <span
          className="rounded-[2px] px-1 py-px font-mono text-[8.5px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: accent, background: "var(--studio-canvas-alt)" }}
        >
          {langLabel(stat.extension)}
        </span>
      </div>

      {dir ? (
        <div className="truncate px-3 font-mono text-[10px] text-studio-ink-faint">
          {dir}/
        </div>
      ) : null}

      <div className="flex items-baseline gap-4 border-t border-studio-edge px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
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

      {previewLines.length > 0 ? (
        <pre
          className="m-0 overflow-hidden border-t border-studio-edge px-3 py-2 font-mono text-[10.5px] leading-[1.5] text-studio-ink-muted"
          style={{ background: "var(--code-bg)" }}
        >
          {previewLines.join("\n")}
        </pre>
      ) : null}
    </Link>
  );
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
  yml: "var(--studio-ink-faint)",
  yaml: "var(--studio-ink-faint)",
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
