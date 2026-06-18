import "./knowledge-search.css";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  FileJson,
  Loader2,
  MessageSquareText,
  RadioTower,
  RefreshCw,
  Waypoints,
  X,
} from "lucide-react";

import { api } from "../../lib/api.ts";
import {
  facetText,
  firstFileRef,
  firstTranscriptRef,
  highlightParts,
  pathLabel,
  queryTerms,
  transcriptSessionId,
  transcriptTailQuery,
  type IndexResponse,
  type KnowledgeSourcePreview,
  type KnowledgeSourcePreviewRecord,
  type KnowledgeStatus,
  type WorktreeIndexResponse,
} from "../../lib/knowledge-search.ts";
import { useScout } from "../../scout/Provider.tsx";

type InspectorTab = "preview" | "indexer";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatTime(ms: number | undefined): string {
  if (!ms) return "unknown";
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>
      )}
    </>
  );
}

function scoreLabel(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "0.000";
}

function matchedFields(input: {
  title: string;
  snippet: string;
  preview: KnowledgeSourcePreview | null;
  query: string;
}): string[] {
  const terms = queryTerms(input.query);
  if (terms.length === 0) return [];
  const containsTerm = (text: string) => {
    const lower = text.toLowerCase();
    return terms.some((term) => lower.includes(term.toLowerCase()));
  };
  const fields: string[] = [];
  if (containsTerm(input.title)) fields.push("title");
  if (containsTerm(input.snippet)) fields.push("indexed snippet");
  if (input.preview?.records.some((record) => record.matched)) fields.push("source records");
  return fields;
}

function recordText(record: KnowledgeSourcePreviewRecord): string {
  return record.renderedText || record.summary || record.raw;
}

function recordKind(record: KnowledgeSourcePreviewRecord): string {
  return record.kind || record.role || record.type || "record";
}

function recordKindLabel(record: KnowledgeSourcePreviewRecord): string {
  const kind = recordKind(record);
  if (kind === "assistant_turn" || kind === "assistant") return "assistant";
  if (kind === "user_turn" || kind === "user") return "user";
  if (kind === "system_record" || kind === "system") return "system";
  if (kind === "command_or_tool" || kind === "tool_use") return "tool";
  if (kind === "response_item") return "tool output";
  return kind;
}

function recordPriority(record: KnowledgeSourcePreviewRecord): number {
  const kind = recordKind(record);
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
  const [tab, setTab] = useState<InspectorTab>("preview");
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [preview, setPreview] = useState<KnowledgeSourcePreview | null>(null);
  const [lastRun, setLastRun] = useState<IndexResponse["result"] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcript = selectedKnowledgeHit ? firstTranscriptRef(selectedKnowledgeHit) : null;
  const fileRef = selectedKnowledgeHit ? firstFileRef(selectedKnowledgeHit) : null;
  const project = selectedKnowledgeHit ? facetText(selectedKnowledgeHit, "project") : "";
  const harness = selectedKnowledgeHit ? facetText(selectedKnowledgeHit, "harness") : "";
  const activeQuery = selectedKnowledgeQuery.trim();
  const activeJob = status?.activeJobs[0] ?? null;
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
  const fields = selectedKnowledgeHit
    ? matchedFields({
      title: selectedKnowledgeHit.title,
      snippet: selectedKnowledgeHit.snippet,
      preview,
      query: activeQuery,
    })
    : [];
  const queryTermLabels = queryTerms(activeQuery);
  const firstOpenRecord = preview?.records.find((record) => record.matched)?.index ?? transcript?.recordRange?.[0];
  const sessionId = transcriptSessionId(transcript);
  const tailQuery = transcriptTailQuery(transcript);

  const metrics = useMemo(() => [
    { label: "Collections", value: formatCount(status?.readyCollections ?? 0) },
    { label: "Chunks", value: formatCount(status?.chunks ?? 0) },
    { label: "Index", value: formatBytes(status?.sqliteBytes ?? 0) },
    { label: "Updated", value: status ? formatTime(status.generatedAt) : "loading" },
  ], [status]);

  const refreshStatus = async () => {
    try {
      setError(null);
      setStatus(await api<KnowledgeStatus>("/api/knowledge/status"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    if (!selectedKnowledgeHit) return;
    setTab("preview");
  }, [selectedKnowledgeHit?.id]);

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

  const buildIndex = async (force = false) => {
    setIndexing(true);
    try {
      setError(null);
      const response = await api<IndexResponse>("/api/knowledge/sessions/index", {
        method: "POST",
        body: JSON.stringify({ days: 3, limit: 260, force }),
      });
      setLastRun(response.result);
      setStatus(response.status);
      setTab("indexer");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIndexing(false);
    }
  };

  const buildWorktreeIndex = async (force = false) => {
    setIndexing(true);
    try {
      setError(null);
      const response = await api<WorktreeIndexResponse>("/api/knowledge/worktree/index", {
        method: "POST",
        body: JSON.stringify({ force, includeUntracked: true }),
      });
      setLastRun(null);
      setStatus(response.status);
      setTab("indexer");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIndexing(false);
    }
  };

  const openTranscript = () => {
    if (!transcript) return;
    openFilePreview(pathLabel(transcript.path));
  };

  const openSourceFile = () => {
    const source = transcript ?? fileRef;
    if (!source) return;
    openFilePreview(pathLabel(source.path));
  };

  const openSession = () => {
    if (!sessionId) return;
    navigate({ view: "sessions", sessionId });
  };

  const openObserveWindow = () => {
    if (!tailQuery) return;
    navigate({ view: "ops", mode: "tail", tailQuery });
  };

  return (
    <div className="ks-inspector">
      <div className="ks-inspector-tabs" role="tablist" aria-label="Search context">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "preview"}
          className={tab === "preview" ? "ks-inspector-tab active" : "ks-inspector-tab"}
          onClick={() => setTab("preview")}
        >
          <FileJson size={13} aria-hidden="true" />
          Preview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "indexer"}
          className={tab === "indexer" ? "ks-inspector-tab active" : "ks-inspector-tab"}
          onClick={() => setTab("indexer")}
        >
          <Waypoints size={13} aria-hidden="true" />
          Indexer
        </button>
      </div>

      {error && <div className="ks-inspector-error" role="alert">{error}</div>}

      {tab === "preview" ? (
        <section className="ks-preview-panel" aria-label="Selected search result preview">
          {!selectedKnowledgeHit ? (
            <div className="ks-inspector-empty">
              <FileJson size={18} aria-hidden="true" />
              <strong>Select a result</strong>
              <span>Click a search result to inspect its QMD chunk, source record window, and raw JSONL evidence here.</span>
            </div>
          ) : (
            <>
              <div className="ks-preview-head">
                <div>
                  <span className="ks-panel-eyebrow">Selected result</span>
                  <h2>{selectedKnowledgeHit.title}</h2>
                </div>
                <button type="button" aria-label="Clear selected result" onClick={clearKnowledgeHit}>
                  <X size={14} aria-hidden="true" />
                </button>
              </div>

              <div className="ks-preview-meta">
                {project && <span>{project}</span>}
                {harness && <span>{harness}</span>}
                {facetText(selectedKnowledgeHit, "source") === "git_worktree" && <span>worktree diff</span>}
                {facetText(selectedKnowledgeHit, "state") && <span>{facetText(selectedKnowledgeHit, "state")}</span>}
                {transcript?.recordRange && <span>records {transcript.recordRange[0]}..{transcript.recordRange[1]}</span>}
              </div>

              {(sessionId || tailQuery || transcript || fileRef) && (
                <div className="ks-preview-actions" aria-label="Selected result actions">
                  {sessionId && (
                    <button type="button" onClick={openSession}>
                      <MessageSquareText size={13} aria-hidden="true" />
                      Open session
                    </button>
                  )}
                  {tailQuery && (
                    <button type="button" onClick={openObserveWindow}>
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
                <section className="ks-rendered-matches" aria-label="Rendered message matches">
                  <div className="ks-rendered-head">
                    <MessageSquareText size={14} aria-hidden="true" />
                    <strong>Rendered message hits</strong>
                    <span>{matchedRecords.length} source record{matchedRecords.length === 1 ? "" : "s"}</span>
                  </div>
                  {matchedRecords.map((record) => (
                    <article key={`rendered:${record.index}`} className="ks-rendered-record">
                      <header>
                        <span>{String(record.index).padStart(4, "0")}</span>
                        <strong>{recordKindLabel(record)}</strong>
                        <em>{record.matchCount ?? 0} match{record.matchCount === 1 ? "" : "es"}</em>
                      </header>
                      <p><HighlightedText text={recordText(record)} query={activeQuery} /></p>
                    </article>
                  ))}
                </section>
              )}

              <section className="ks-indexed-snippet" aria-label="Indexed snippet">
                <span>Indexed snippet</span>
                <p><HighlightedText text={selectedKnowledgeHit.snippet} query={activeQuery} /></p>
              </section>

              <section className="ks-rank-explainer" aria-label="Why this result ranked here">
                <div className="ks-rendered-head">
                  <Waypoints size={14} aria-hidden="true" />
                  <strong>Why ranked here</strong>
                </div>
                <div className="ks-score-panel">
                  <div>
                    <span>Index rank</span>
                    <strong>{scoreLabel(selectedKnowledgeHit.score)}</strong>
                    <em>lower values sort earlier in lexical search</em>
                  </div>
                  <div>
                    <span>Matched terms</span>
                    <strong>{queryTermLabels.length > 0 ? queryTermLabels.join(", ") : "none"}</strong>
                    <em>{activeQuery ? `query "${activeQuery}"` : "no active query captured"}</em>
                  </div>
                  <div>
                    <span>Matched in</span>
                    <strong>{fields.length > 0 ? fields.join(", ") : "indexed chunk"}</strong>
                    <em>{selectedKnowledgeHit.scoreSource === "fts" ? "lexical index over QMD title/body" : `${selectedKnowledgeHit.scoreSource} over QMD title/body`}</em>
                  </div>
                </div>
              </section>

              {transcript && (
                <div className="ks-preview-source">
                  <span>Transcript</span>
                  <code>{pathLabel(transcript.path)}</code>
                  <button type="button" onClick={openTranscript}>
                    <ExternalLink size={13} aria-hidden="true" />
                    Open file
                  </button>
                </div>
              )}

              {!transcript && fileRef && (
                <div className="ks-preview-source">
                  <span>Source file</span>
                  <code>{pathLabel(fileRef.path)}</code>
                  <button type="button" onClick={openSourceFile}>
                    <ExternalLink size={13} aria-hidden="true" />
                    Open file
                  </button>
                </div>
              )}

              {loadingPreview ? (
                <div className="ks-preview-loading">
                  <Loader2 size={15} className="ks-spin" aria-hidden="true" />
                  Loading source records...
                </div>
              ) : preview ? (
                <div className="ks-jsonl-window">
                  <div className="ks-jsonl-window-head">
                    <strong>Raw JSONL evidence</strong>
                    <span>
                      records {preview.previewRange[0]}..{preview.previewRange[1]}
                      {preview.truncatedBefore ? " · earlier records hidden" : ""}
                      {preview.truncatedAfter ? " · later records hidden" : ""}
                    </span>
                  </div>
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
                </div>
              ) : (
                <div className="ks-inspector-empty">
                  <span>No JSONL preview is available for this result.</span>
                </div>
              )}
            </>
          )}
        </section>
      ) : (
        <section className="ks-indexer-panel" aria-label="Session indexer">
          <div className="ks-preview-head">
            <div>
              <span className="ks-panel-eyebrow">Indexer</span>
              <h2>Three-day session pipeline</h2>
            </div>
            <button type="button" aria-label="Refresh index status" onClick={() => void refreshStatus()}>
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </div>

          <div className="ks-indexer-actions">
            <button type="button" className="ks-primary-button" onClick={() => void buildIndex(false)} disabled={indexing}>
              {indexing ? <Loader2 size={14} className="ks-spin" aria-hidden="true" /> : <Database size={14} aria-hidden="true" />}
              Build 3-day index
            </button>
            <button type="button" className="ks-primary-button" onClick={() => void buildWorktreeIndex(true)} disabled={indexing}>
              {indexing ? <Loader2 size={14} className="ks-spin" aria-hidden="true" /> : <FileJson size={14} aria-hidden="true" />}
              Index worktree diffs
            </button>
            <button type="button" className="ks-icon-button" onClick={() => void buildIndex(true)} disabled={indexing}>
              <RefreshCw size={14} aria-hidden="true" />
              Rebuild
            </button>
          </div>

          <div className="ks-indexer-metrics">
            {metrics.map((metric) => (
              <div key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>

          <div className="ks-indexer-facts">
            <div>
              <span>Frequency</span>
              <strong>Manual refresh</strong>
            </div>
            <div>
              <span>Window</span>
              <strong>Last 3 days, up to 260 sessions</strong>
            </div>
            <div>
              <span>Embedding stage</span>
              <strong>Optional next phase</strong>
            </div>
          </div>

          <div className="ks-pipeline-compact">
            <div>
              <CheckCircle2 size={14} aria-hidden="true" />
              <span>JSONL discovery</span>
            </div>
            <div>
              <CheckCircle2 size={14} aria-hidden="true" />
              <span>Mechanical QMD</span>
            </div>
            <div>
              <CheckCircle2 size={14} aria-hidden="true" />
              <span>SQLite FTS</span>
            </div>
            <div>
              <Clock3 size={14} aria-hidden="true" />
              <span>Embeddings optional</span>
            </div>
          </div>

          {activeJob && (
            <div className="ks-job">
              <strong>{activeJob.source} {activeJob.state}</strong>
              <span>
                {formatCount(activeJob.progress.indexed ?? 0)} indexed of {formatCount(activeJob.progress.discovered ?? 0)} discovered
              </span>
            </div>
          )}

          {lastRun && (
            <div className="ks-job">
              <strong>Last run</strong>
              <span>
                {formatCount(lastRun.indexed)} indexed, {formatCount(lastRun.failed)} failed, {formatCount(lastRun.discovered)} discovered
              </span>
            </div>
          )}

          <div className="ks-paths">
            <div>
              <span>QMD root</span>
              <code>{status?.paths.qmdRoot ?? "not initialized"}</code>
            </div>
            <div>
              <span>SQLite</span>
              <code>{status?.paths.sqlitePath ?? "not initialized"}</code>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
