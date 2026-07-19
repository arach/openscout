import "./knowledge-search.css";

import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  FileJson,
  Loader2,
  MessageSquareText,
  RadioTower,
  X,
} from "lucide-react";

import { api } from "../../lib/api.ts";
import {
  facetText,
  firstFileRef,
  firstTranscriptRef,
  highlightParts,
  pathLabel,
  transcriptSessionId,
  transcriptTailQuery,
  type KnowledgeSourcePreview,
  type KnowledgeSourcePreviewRecord,
} from "../../lib/knowledge-search.ts";
import { useScout } from "../../scout/Provider.tsx";

function HighlightedText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>
      )}
    </>
  );
}

function recordText(record: KnowledgeSourcePreviewRecord): string {
  return record.renderedText || record.summary || record.raw;
}

function recordKindLabel(record: KnowledgeSourcePreviewRecord): string {
  const kind = record.kind || record.role || record.type || "record";
  if (kind === "assistant_turn" || kind === "assistant") return "assistant";
  if (kind === "user_turn" || kind === "user") return "user";
  if (kind === "system_record" || kind === "system") return "system";
  if (kind === "command_or_tool" || kind === "tool_use") return "tool";
  if (kind === "response_item") return "tool output";
  return kind;
}

function recordPriority(record: KnowledgeSourcePreviewRecord): number {
  const kind = record.kind || record.role || record.type || "";
  if (
    kind === "assistant"
    || kind === "assistant_turn"
    || kind === "user"
    || kind === "user_turn"
    || kind === "last-prompt"
    || kind === "ai-title"
  ) {
    return 0;
  }
  if (kind === "system" || kind === "system_record") return 1;
  return 2;
}

export function KnowledgeSearchInspector() {
  const {
    selectedKnowledgeHit,
    selectedKnowledgeQuery,
    clearKnowledgeHit,
    openFilePreview,
    navigate,
  } = useScout();
  const [preview, setPreview] = useState<KnowledgeSourcePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcript = selectedKnowledgeHit ? firstTranscriptRef(selectedKnowledgeHit) : null;
  const fileRef = selectedKnowledgeHit ? firstFileRef(selectedKnowledgeHit) : null;
  const project = selectedKnowledgeHit ? facetText(selectedKnowledgeHit, "project") : "";
  const harness = selectedKnowledgeHit ? facetText(selectedKnowledgeHit, "harness") : "";
  const activeQuery = selectedKnowledgeQuery.trim();
  const sessionId = transcriptSessionId(transcript);
  const tailQuery = transcriptTailQuery(transcript);

  const matchedRecords = useMemo(() =>
    preview?.records
      .filter((record) => record.matched)
      .sort((left, right) => {
        const priority = recordPriority(left) - recordPriority(right);
        if (priority !== 0) return priority;
        return (right.matchCount ?? 0) - (left.matchCount ?? 0);
      })
      .slice(0, 4) ?? [],
    [preview],
  );

  const firstOpenRecord = preview?.records.find((record) => record.matched)?.index
    ?? transcript?.recordRange?.[0];

  useEffect(() => {
    let cancelled = false;
    const loadPreview = async () => {
      if (!selectedKnowledgeHit || !transcript) {
        setPreview(null);
        return;
      }
      setLoadingPreview(true);
      try {
        setError(null);
        const response = await api<KnowledgeSourcePreview>("/api/knowledge/source-preview", {
          method: "POST",
          body: JSON.stringify({
            sourceRef: transcript,
            contextRecords: 4,
            maxRecords: 80,
            q: activeQuery,
          }),
        });
        if (!cancelled) setPreview(response);
      } catch (err) {
        if (!cancelled) {
          setPreview(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    };
    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [selectedKnowledgeHit?.id, transcript?.recordRange?.[0], transcript?.recordRange?.[1], activeQuery]);

  const openSourceFile = () => {
    const source = transcript ?? fileRef;
    if (!source) return;
    openFilePreview(pathLabel(source.path));
  };

  return (
    <div className="ks-inspector">
      {error && <div className="ks-inspector-error" role="alert">{error}</div>}

      <section className="ks-preview-panel" aria-label="Selected search result preview">
        {!selectedKnowledgeHit ? (
          <div className="ks-inspector-empty">
            <FileJson size={18} aria-hidden="true" />
            <strong>Select a result</strong>
            <span>Pick a match to see the conversation moment and open the session.</span>
          </div>
        ) : (
          <>
            <div className="ks-preview-head">
              <div>
                <span className="ks-panel-eyebrow">Result</span>
                <h2>{selectedKnowledgeHit.title}</h2>
              </div>
              <button type="button" aria-label="Clear selected result" onClick={clearKnowledgeHit}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>

            <div className="ks-preview-meta">
              {project && <span>{project}</span>}
              {harness && <span>{harness}</span>}
              {selectedKnowledgeHit.freshness
                && selectedKnowledgeHit.freshness !== "unknown"
                && <span>{selectedKnowledgeHit.freshness}</span>}
              {transcript?.recordRange && (
                <span>records {transcript.recordRange[0]}..{transcript.recordRange[1]}</span>
              )}
            </div>

            {(sessionId || tailQuery || transcript || fileRef) && (
              <div className="ks-preview-actions" aria-label="Selected result actions">
                {sessionId && (
                  <button type="button" onClick={() => navigate({ view: "sessions", sessionId })}>
                    <MessageSquareText size={13} aria-hidden="true" />
                    Open session
                  </button>
                )}
                {tailQuery && (
                  <button
                    type="button"
                    onClick={() => navigate({ view: "ops", mode: "tail", tailQuery })}
                  >
                    <RadioTower size={13} aria-hidden="true" />
                    Observe window
                  </button>
                )}
                {(transcript || fileRef) && (
                  <button type="button" onClick={openSourceFile}>
                    <ExternalLink size={13} aria-hidden="true" />
                    Open file
                  </button>
                )}
              </div>
            )}

            {matchedRecords.length > 0 && (
              <section className="ks-rendered-matches" aria-label="Matching turns">
                <div className="ks-rendered-head">
                  <MessageSquareText size={14} aria-hidden="true" />
                  <strong>Matching turns</strong>
                  <span>{matchedRecords.length}</span>
                </div>
                {matchedRecords.map((record) => (
                  <article key={`rendered:${record.index}`} className="ks-rendered-record">
                    <header>
                      <span>{String(record.index).padStart(4, "0")}</span>
                      <strong>{recordKindLabel(record)}</strong>
                    </header>
                    <p><HighlightedText text={recordText(record)} query={activeQuery} /></p>
                  </article>
                ))}
              </section>
            )}

            <section className="ks-indexed-snippet" aria-label="Match snippet">
              <span>Snippet</span>
              <p><HighlightedText text={selectedKnowledgeHit.snippet} query={activeQuery} /></p>
            </section>

            {transcript && (
              <div className="ks-preview-source">
                <span>Source</span>
                <code>{pathLabel(transcript.path)}</code>
              </div>
            )}

            {!transcript && fileRef && (
              <div className="ks-preview-source">
                <span>Source</span>
                <code>{pathLabel(fileRef.path)}</code>
              </div>
            )}

            {loadingPreview ? (
              <div className="ks-preview-loading">
                <Loader2 size={15} className="ks-spin" aria-hidden="true" />
                Loading conversation…
              </div>
            ) : preview ? (
              <details className="ks-jsonl-window">
                <summary className="ks-jsonl-window-head">
                  <strong>Raw evidence</strong>
                  <span>
                    records {preview.previewRange[0]}..{preview.previewRange[1]}
                  </span>
                </summary>
                {preview.records.map((record) => (
                  <details
                    key={`${preview.path}:${record.index}`}
                    className={`ks-jsonl-record${record.matched ? " ks-jsonl-record--matched" : ""}`}
                    open={record.index === firstOpenRecord}
                  >
                    <summary>
                      <span>{String(record.index).padStart(4, "0")}</span>
                      <strong>{record.kind || record.role || record.type || "record"}</strong>
                      <em><HighlightedText text={record.summary || "no summary"} query={activeQuery} /></em>
                    </summary>
                    <pre>{record.raw}</pre>
                  </details>
                ))}
              </details>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
