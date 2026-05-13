import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../lib/api.ts";
import {
  DocumentFocusViewer,
  type DocumentFocusKind,
} from "../components/DocumentFocusViewer.tsx";
import {
  createTextDocument,
  type TextDocument,
} from "../components/TextDocumentSurface.tsx";

type FilePreviewContent = {
  path: string;
  realPath: string;
  title: string;
  mediaType: string;
  content: string;
  sizeBytes: number;
  truncated: boolean;
  generatedAt: number;
};

function focusKindFor(mediaType: string): DocumentFocusKind {
  if (mediaType === "text/markdown") return "doc";
  if (mediaType === "text/plain") return "doc";
  return "code";
}

export function FilePreviewOverlay({
  path,
  onClose,
}: {
  path: string | null;
  onClose: () => void;
}) {
  const [content, setContent] = useState<FilePreviewContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    api<FilePreviewContent>(`/api/file/preview?path=${encodeURIComponent(path)}`)
      .then((next) => {
        if (cancelled) return;
        setContent(next);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "could not load file";
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [path]);

  useEffect(() => {
    if (!path) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path, onClose]);

  if (!path) {
    return null;
  }

  const document: TextDocument | null = content
    ? createTextDocument({
        id: content.realPath,
        title: content.title,
        uri: content.realPath,
        mediaType: content.mediaType,
        value: content.content,
        filename: content.title,
        readOnly: true,
      })
    : null;

  const revealInOs = () => {
    void api("/api/file/reveal", {
      method: "POST",
      body: JSON.stringify({ path }),
    }).catch((err) => {
      const message = err instanceof Error ? err.message : "reveal failed";
      setError(message);
    });
  };

  const subtitle = content?.realPath ?? path;
  const meta: string[] = [];
  if (content?.truncated) meta.push("truncated");
  if (content?.sizeBytes) meta.push(`${content.sizeBytes.toLocaleString()} B`);

  return (
    <DocumentFocusViewer
      open
      kind={content ? focusKindFor(content.mediaType) : "doc"}
      document={document}
      title={content?.title ?? path.split("/").pop() ?? "File"}
      eyebrow="File preview"
      subtitle={subtitle}
      meta={meta}
      mode="read"
      state={loading ? "Loading…" : null}
      error={error}
      actions={[
        {
          label: "Open in OS",
          icon: <ExternalLink size={12} />,
          onClick: revealInOs,
          title: "Reveal this file in your operating system",
        },
      ]}
      onClose={onClose}
    />
  );
}
