"use client";

/**
 * SourceFileViewer — in-context drawer for repo files.
 *
 * Replaces the old cursor:// jump-out as the *default* SourceLinks
 * affordance. Fetches /api/repo-file?path=<rel>&full=1 on mount and
 * renders the file inside the existing CodeMirror-based CodeViewer.
 *
 * Why a drawer instead of a new page: research-section file links are
 * a "quick glance" affordance — the operator wants to peek a file
 * without losing the study they're on. A right-side slide-in keeps
 * the panel/study visible behind a tint, Esc snaps back.
 *
 * The drawer still offers an "Open in Cursor ↗" anchor for the
 * jump-out flow when the operator wants to actually edit.
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const CodeViewer = dynamic(
  () => import("@/components/CodeViewer").then((m) => m.CodeViewer),
  { ssr: false },
);

interface FilePayload {
  filename: string;
  excerpt: string;
  truncated: boolean;
  totalLines: number;
  stat: { bytes?: number; mtimeMs?: number };
}

interface SourceFileViewerProps {
  path: string;
  onClose: () => void;
}

export function SourceFileViewer({ path, onClose }: SourceFileViewerProps) {
  const [data, setData] = useState<FilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/repo-file?path=${encodeURIComponent(path)}&full=1`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json() as Promise<FilePayload>;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  const filename = data?.filename ?? path.split("/").pop() ?? path;
  const dir = path.includes("/")
    ? path.slice(0, path.lastIndexOf("/"))
    : "";
  const cursorHref = `cursor:///Users/arach/dev/openscout/${path}`;
  const kb = data?.stat?.bytes
    ? (data.stat.bytes / 1024).toFixed(1)
    : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Source file: ${path}`}
      className="fixed inset-0 z-50 flex"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close source viewer"
        onClick={onClose}
        className="flex-1 cursor-default bg-black/55 backdrop-blur-[2px]"
      />

      {/* Drawer — right side */}
      <div
        className="flex h-full w-full max-w-[1080px] flex-col border-l border-studio-edge bg-studio-canvas shadow-[-24px_0_60px_-12px_rgba(0,0,0,0.6)]"
        style={{ minWidth: 480 }}
      >
        {/* Chrome */}
        <div className="flex items-baseline gap-3 border-b border-studio-edge px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              · file
              {dir ? (
                <>
                  <span aria-hidden className="mx-1.5">
                    ›
                  </span>
                  <span className="normal-case tracking-normal text-studio-ink-faint">
                    {dir}
                  </span>
                </>
              ) : null}
            </div>
            <div className="mt-0.5 truncate font-sans text-[14px] font-medium tracking-tight text-studio-ink">
              {filename}
            </div>
          </div>

          <div className="flex shrink-0 items-baseline gap-3 font-mono text-[10px] text-studio-ink-faint">
            {data ? (
              <>
                <span className="tabular-nums">
                  {data.totalLines.toLocaleString()} lines
                </span>
                {kb ? (
                  <>
                    <span aria-hidden className="h-3 w-px bg-studio-edge" />
                    <span className="tabular-nums">{kb} KB</span>
                  </>
                ) : null}
                {data.truncated ? (
                  <>
                    <span aria-hidden className="h-3 w-px bg-studio-edge" />
                    <span className="font-semibold uppercase tracking-eyebrow text-[var(--scout-accent)]">
                      TRUNCATED
                    </span>
                  </>
                ) : null}
              </>
            ) : null}

            <a
              href={cursorHref}
              className="ml-1 inline-flex items-baseline gap-1 rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint transition-colors hover:border-studio-edge-strong hover:text-studio-ink"
              title="Open in Cursor"
            >
              <span>cursor</span>
              <span aria-hidden>↗</span>
            </a>

            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="ml-1 inline-flex items-center justify-center rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint transition-colors hover:border-studio-edge-strong hover:text-studio-ink"
            >
              ESC
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          className="min-h-0 flex-1 overflow-auto"
          style={{ background: "var(--code-bg)" }}
        >
          {error ? (
            <div className="px-5 py-6 font-mono text-[12px] text-studio-ink-faint">
              Could not load <span className="text-studio-ink">{path}</span> —{" "}
              {error}.
            </div>
          ) : !data ? (
            <div className="px-5 py-6 font-mono text-[12px] text-studio-ink-faint">
              Loading {path}…
            </div>
          ) : (
            <CodeViewer content={data.excerpt} filename={filename} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
