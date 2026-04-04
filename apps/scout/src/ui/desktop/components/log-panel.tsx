import React, { useMemo } from "react";
import { FileJson } from "lucide-react";

const C = {
  border: "var(--os-border)",
  termBg: "var(--os-terminal-bg)",
  termFg: "var(--os-terminal-fg)",
  accent: "var(--os-accent)",
  accentBg: "var(--os-accent-bg)",
  ink: "var(--os-ink)",
  muted: "var(--os-muted)",
};

type LogPanelProps = {
  /** Source title shown in the header */
  title: string;
  /** Path label shown below the title (optional) */
  pathLabel?: string | null;
  /** Raw log body text */
  body: string | null;
  /** Whether the log was truncated (tail mode) */
  truncated?: boolean;
  /** Total line count */
  lineCount?: number;
  /** Whether the log file hasn't been created yet */
  missing?: boolean;
  /** Whether content is currently loading */
  loading?: boolean;
  /** Optional search/filter query — filters visible lines client-side */
  searchQuery?: string;
  /** Timestamp label like "Updated 2m ago" */
  updatedAtLabel?: string | null;
  /** Min height for the terminal body */
  minHeight?: number;
  /** Max height for the terminal body (scrolls beyond this) */
  maxHeight?: number;
  /** Called when the path label is clicked (e.g. reveal in Finder) */
  onRevealPath?: (path: string) => void;
};

export function LogPanel({
  title,
  pathLabel,
  body,
  truncated = false,
  lineCount,
  missing = false,
  loading = false,
  searchQuery = "",
  updatedAtLabel,
  minHeight = 240,
  maxHeight,
  onRevealPath,
}: LogPanelProps) {
  const visibleBody = useMemo(() => {
    if (!body) return "";
    const query = searchQuery.trim().toLowerCase();
    if (!query) return body;
    return body
      .split("\n")
      .filter((line) => line.toLowerCase().includes(query))
      .join("\n");
  }, [body, searchQuery]);

  return (
    <div
      className="border rounded-xl overflow-hidden"
      style={{ borderColor: C.border }}
    >
      {/* Header — app chrome, not terminal */}
      <div
        className="px-4 h-9 border-b flex items-center justify-between gap-4"
        style={{ borderBottomColor: C.border, backgroundColor: 'var(--os-surface)' }}
      >
        <div className="flex items-center gap-2 min-w-0 text-[11px] font-mono truncate" style={{ color: C.ink }}>
          <span className="font-semibold uppercase tracking-widest text-[9px] shrink-0" style={{ color: C.muted }}>{title}</span>
          {pathLabel ? (
            <>
              <span style={{ color: C.border }}>·</span>
              {onRevealPath ? (
                <button
                  type="button"
                  className="truncate underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity"
                  style={{ color: C.muted }}
                  onClick={() => onRevealPath(pathLabel)}
                >
                  {pathLabel}
                </button>
              ) : (
                <span className="truncate" style={{ color: C.muted }}>{pathLabel}</span>
              )}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-3 shrink-0 text-[10px] font-mono" style={{ color: C.muted }}>
          {updatedAtLabel ? <span>{updatedAtLabel}</span> : null}
          {lineCount != null ? (
            <span>{truncated ? `${lineCount} lines` : `${lineCount} lines`}</span>
          ) : null}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center" style={{ minHeight, backgroundColor: C.termBg }}>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <span className="os-thinking-dot" style={{ color: C.accent }} />
              <span className="os-thinking-dot" style={{ color: C.accent }} />
              <span className="os-thinking-dot" style={{ color: C.accent }} />
            </div>
            <span className="text-[12px]" style={{ color: C.muted }}>Loading…</span>
          </div>
        </div>
      ) : missing ? (
        <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight, backgroundColor: C.termBg }}>
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
            style={{ backgroundColor: C.accentBg }}
          >
            <FileJson size={20} style={{ color: C.accent }} />
          </div>
          <div className="text-[13px] font-medium mb-1" style={{ color: C.ink }}>No log file yet</div>
          <div className="text-[12px] max-w-xs" style={{ color: C.muted }}>
            {title} has not written a log yet. This will update as soon as output lands.
          </div>
        </div>
      ) : (
        <pre
          className="overflow-auto p-4 text-[11px] leading-[1.55] whitespace-pre-wrap break-words"
          style={{
            backgroundColor: C.termBg,
            color: C.termFg,
            minHeight,
            maxHeight: maxHeight ?? undefined,
          }}
        >
          {visibleBody || (searchQuery.trim() ? "No lines match the filter." : "(empty log)")}
        </pre>
      )}
    </div>
  );
}
