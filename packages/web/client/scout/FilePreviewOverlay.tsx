import { ArrowLeft, ArrowRight, ChevronUp, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/api.ts";
import {
  DocumentFocusViewer,
  type DocumentFocusKind,
  type DocumentFocusViewerAction,
} from "../components/DocumentFocusViewer.tsx";
import {
  fileRenderers,
  type FilePreviewContent,
  type FilePreviewEntry,
} from "./file-renderers/index.ts";
import type { FilePreviewRange } from "./Provider.tsx";
import "./file-preview-overlay.css";

function buildPreviewUrl(path: string, range: FilePreviewRange | null): string {
  const params = new URLSearchParams({ path });
  if (range) {
    params.set("start", String(range.start));
    params.set("end", String(range.end ?? range.start));
  }
  return `/api/file/preview?${params.toString()}`;
}

function formatRangeLabel(range: FilePreviewRange | null | undefined): string | null {
  if (!range) return null;
  return range.end !== undefined && range.end !== range.start
    ? `lines ${range.start}-${range.end}`
    : `line ${range.start}`;
}

type DirectoryNavContext = {
  dirPath: string;
  dirTitle: string;
  files: FilePreviewEntry[];
};

export function FilePreviewOverlay({
  path,
  range,
  onOpenPath,
  onClose,
}: {
  path: string | null;
  range?: FilePreviewRange | null;
  onOpenPath: (path: string, range?: FilePreviewRange) => void;
  onClose: () => void;
}) {
  const [content, setContent] = useState<FilePreviewContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dirContext, setDirContext] = useState<DirectoryNavContext | null>(null);
  const dirContextRef = useRef<DirectoryNavContext | null>(null);

  useEffect(() => {
    dirContextRef.current = dirContext;
  }, [dirContext]);

  // Stable key for the range so the effect re-runs when the range alone changes.
  const rangeKey = range ? `${range.start}-${range.end ?? range.start}` : "";
  useEffect(() => {
    if (!path) {
      setContent(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    api<FilePreviewContent>(buildPreviewUrl(path, range ?? null))
      .then((next) => {
        if (cancelled) return;
        setContent(next);
        updateDirContext(next, dirContextRef.current, setDirContext);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "could not load file");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, rangeKey]);

  const { currentIndex, prevPath, nextPath } = useMemo(() => {
    if (!content || content.kind !== "file" || !dirContext) {
      return { currentIndex: -1, prevPath: null, nextPath: null } as const;
    }
    const index = dirContext.files.findIndex((entry) => entry.realPath === content.realPath);
    if (index < 0) {
      return { currentIndex: -1, prevPath: null, nextPath: null } as const;
    }
    return {
      currentIndex: index,
      prevPath: index > 0 ? dirContext.files[index - 1].path : null,
      nextPath: index < dirContext.files.length - 1 ? dirContext.files[index + 1].path : null,
    } as const;
  }, [content, dirContext]);

  useEffect(() => {
    if (!path) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || event.target.isContentEditable) return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowLeft" && prevPath) {
        event.preventDefault();
        onOpenPath(prevPath);
      } else if (event.key === "ArrowRight" && nextPath) {
        event.preventDefault();
        onOpenPath(nextPath);
      } else if (event.key === "Backspace" && dirContext && content?.kind === "file") {
        event.preventDefault();
        onOpenPath(dirContext.dirPath);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path, onClose, onOpenPath, prevPath, nextPath, dirContext, content]);

  if (!path) return null;

  const revealInOs = () => {
    void api("/api/file/reveal", {
      method: "POST",
      body: JSON.stringify({ path: content?.realPath ?? path }),
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "reveal failed");
    });
  };

  const renderer = content ? fileRenderers.find((candidate) => candidate.canHandle(content)) ?? null : null;
  const showNav = Boolean(content && content.kind === "file" && dirContext && currentIndex >= 0 && dirContext.files.length > 1);
  const actions: DocumentFocusViewerAction[] = [];
  if (showNav && dirContext) {
    actions.push({
      label: `Folder: ${dirContext.dirTitle}`,
      icon: <ChevronUp size={12} />,
      onClick: () => onOpenPath(dirContext.dirPath),
      title: `Back to ${dirContext.dirTitle} (Backspace)`,
    });
  }
  actions.push({
    label: "Open in OS",
    icon: <ExternalLink size={12} />,
    onClick: revealInOs,
    title: "Reveal this file in your operating system",
  });

  const meta = content ? metaFor(content) : [];
  const sliceRange = content && content.kind === "file" && content.previewable ? content.range : undefined;
  const sliceTotal = content && content.kind === "file" && content.previewable ? content.totalLines : undefined;
  const rangeLabel = formatRangeLabel(sliceRange ?? range);
  if (rangeLabel) {
    const detail = sliceTotal ? `${rangeLabel} of ${sliceTotal}` : rangeLabel;
    meta.unshift(detail);
  }
  if (showNav) {
    meta.unshift(`${currentIndex + 1} / ${dirContext!.files.length}`);
  }
  const renderedBody = content && renderer
    ? renderer.render({ resource: content, openFilePreview: onOpenPath })
    : null;

  return (
    <DocumentFocusViewer
      open
      kind={focusKindFor(content)}
      document={null}
      title={(() => {
        const base = content?.title ?? path.split("/").pop() ?? "File";
        return rangeLabel ? `${base} · ${rangeLabel}` : base;
      })()}
      eyebrow={rangeLabel ? "File snippet" : "File preview"}
      subtitle={content?.realPath ?? path}
      meta={meta}
      state={loading ? "Loading…" : null}
      error={error}
      body={renderedBody ? (
        <div className={`s-file-preview-shell${showNav ? " s-file-preview-shell-nav" : ""}`}>
          {showNav && (
            <button
              type="button"
              className="s-file-preview-side-nav s-file-preview-side-nav-left"
              onClick={() => prevPath && onOpenPath(prevPath)}
              disabled={!prevPath}
              aria-label="Previous file"
              title="Previous file (←)"
            >
              <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}
          <div className="s-file-preview-shell-body">{renderedBody}</div>
          {showNav && (
            <button
              type="button"
              className="s-file-preview-side-nav s-file-preview-side-nav-right"
              onClick={() => nextPath && onOpenPath(nextPath)}
              disabled={!nextPath}
              aria-label="Next file"
              title="Next file (→)"
            >
              <ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : null}
      actions={actions}
      onClose={onClose}
    />
  );
}

function updateDirContext(
  next: FilePreviewContent,
  current: DirectoryNavContext | null,
  setCtx: (ctx: DirectoryNavContext | null) => void,
) {
  if (next.kind === "directory") {
    const files = next.entries.filter((entry) => entry.kind === "file");
    setCtx({ dirPath: next.path, dirTitle: next.title, files });
    return;
  }
  if (!current) {
    setCtx(null);
    return;
  }
  const inCurrent = current.files.some((entry) => entry.realPath === next.realPath);
  if (!inCurrent) {
    setCtx(null);
  }
}

function focusKindFor(content: FilePreviewContent | null): DocumentFocusKind {
  if (!content) return "doc";
  if (content.kind === "directory") return "doc";
  if (content.mediaType === "text/markdown" || content.mediaType === "text/plain") return "doc";
  return "code";
}

function metaFor(content: FilePreviewContent): string[] {
  if (content.kind === "directory") {
    return [`${content.entries.length} ${content.entries.length === 1 ? "entry" : "entries"}`];
  }
  return [
    ...(content.previewable && content.truncated ? ["truncated"] : []),
    formatBytes(content.sizeBytes),
    content.mediaType,
  ];
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
