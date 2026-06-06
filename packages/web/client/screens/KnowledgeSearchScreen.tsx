import "./knowledge-search.css";

import { useEffect, useState } from "react";
import type { FormEvent, KeyboardEvent, MouseEvent } from "react";
import {
  Database,
  ExternalLink,
  FileSearch,
  Loader2,
  MessageSquareText,
  RadioTower,
  Search,
} from "lucide-react";

import type { Route } from "../lib/types.ts";
import type { SearchMode } from "../lib/types.ts";
import { api } from "../lib/api.ts";
import { useScout } from "../scout/Provider.tsx";
import { SearchSubnav } from "./SearchSubnav.tsx";
import {
  facetText,
  firstFileRef,
  firstTranscriptRef,
  highlightParts,
  pathLabel,
  transcriptSessionId,
  transcriptTailQuery,
  queryTerms,
  type KnowledgeHit,
  type KnowledgeStatus,
  type SearchResponse,
  type WorktreeIndexResponse,
} from "../lib/knowledge-search.ts";

const SAMPLE_QUERIES = [
  "QMD",
  "embeddings",
  "search surface",
  "raw log drilldown",
  "MCP",
  "context pack",
  "API",
];

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let next = value;
  let unitIndex = 0;
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex += 1;
  }
  return `${next >= 10 || unitIndex === 0 ? next.toFixed(0) : next.toFixed(1)} ${units[unitIndex]}`;
}

function useKnowledgeStatus() {
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setError(null);
      setStatus(await api<KnowledgeStatus>("/api/knowledge/status"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return { status, setStatus, error, setError, refresh };
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

function compactPath(label: string): string {
  const normalized = label.replace(/\\/g, "/");
  if (!normalized.includes("/")) return normalized;
  const parts = normalized.split("/").filter(Boolean);
  const file = parts.at(-1) ?? normalized;
  if (normalized.startsWith("~/")) return `~/.../${file}`;
  if (normalized.startsWith("/")) return `/.../${file}`;
  return parts.length > 2 ? `${parts[0]}/.../${file}` : normalized;
}

function matchedTermsForHit(hit: KnowledgeHit, query: string): string[] {
  const title = hit.title.toLowerCase();
  const snippet = hit.snippet.toLowerCase();
  return queryTerms(query).filter((term) => {
    const lower = term.toLowerCase();
    return title.includes(lower) || snippet.includes(lower);
  });
}

function rankReason(hit: KnowledgeHit, query: string): string {
  const terms = matchedTermsForHit(hit, query);
  if (terms.length === 1) return `Matched "${terms[0]}" in indexed QMD`;
  if (terms.length > 1) return `Matched ${terms.length} query terms in indexed QMD`;
  return "Matched indexed QMD session knowledge";
}

function displaySnippet(hit: KnowledgeHit, query: string): string {
  const compact = hit.snippet.replace(/\s+/g, " ").trim();
  const marker = /\s-\s\[\d{3,}\]\s`[^`]+`(?:\s\([^)]*\))?\s-\s/u.exec(compact);
  if (!marker) return compact;

  const before = compact.slice(0, marker.index).trim();
  const after = compact.slice(marker.index + marker[0].length).trim();
  const terms = queryTerms(query).map((term) => term.toLowerCase());
  const beforeHasQuery = terms.some((term) => before.toLowerCase().includes(term));

  if (before && (beforeHasQuery || after.startsWith("{") || after.startsWith("["))) {
    return before;
  }
  return after || before || compact;
}

function activateHitFromKeyboard(event: KeyboardEvent<HTMLElement>, activate: () => void) {
  if (event.target !== event.currentTarget) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

function stopAndRun(event: MouseEvent<HTMLButtonElement>, action: () => void) {
  event.stopPropagation();
  action();
}

function SearchIndexerPanel({
  buildIndex,
  buildWorktreeIndex,
  indexing,
  status,
}: {
  buildIndex: (force?: boolean) => Promise<void>;
  buildWorktreeIndex: (force?: boolean) => Promise<void>;
  indexing: boolean;
  status: KnowledgeStatus | null;
}) {
  const updatedLabel = status
    ? new Date(status.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "Not loaded";
  return (
    <section className="ks-panel ks-conversation-panel">
      <div className="ks-panel-head">
        <div>
          <p className="ks-panel-eyebrow">Indexer</p>
          <h2>Session knowledge index</h2>
        </div>
        <Database size={18} strokeWidth={1.7} aria-hidden="true" />
      </div>
      <div className="ks-indexer-panel">
        <div className="ks-indexer-actions">
          <button type="button" className="ks-primary-button" onClick={() => void buildIndex(false)} disabled={indexing}>
            {indexing ? <Loader2 size={14} className="ks-spin" aria-hidden="true" /> : <Database size={14} aria-hidden="true" />}
            Build 3-day index
          </button>
          <button type="button" className="ks-primary-button" onClick={() => void buildIndex(true)} disabled={indexing}>
            {indexing ? <Loader2 size={14} className="ks-spin" aria-hidden="true" /> : <Database size={14} aria-hidden="true" />}
            Rebuild
          </button>
          <button type="button" className="ks-primary-button" onClick={() => void buildWorktreeIndex(true)} disabled={indexing}>
            {indexing ? <Loader2 size={14} className="ks-spin" aria-hidden="true" /> : <FileSearch size={14} aria-hidden="true" />}
            Index worktree diffs
          </button>
        </div>
        <div className="ks-indexer-metrics">
          <div>
            <span>Collections</span>
            <strong>{status ? `${formatCount(status.readyCollections)} / ${formatCount(status.collections)}` : "—"}</strong>
          </div>
          <div>
            <span>Chunks</span>
            <strong>{status ? formatCount(status.chunks) : "—"}</strong>
          </div>
          <div>
            <span>Jobs</span>
            <strong>{status ? formatCount(status.activeJobs.length) : "—"}</strong>
          </div>
          <div>
            <span>Store</span>
            <strong>{status ? formatBytes(status.sqliteBytes) : "—"}</strong>
          </div>
        </div>
        <div className="ks-indexer-facts">
          <div>
            <span>Updated</span>
            <strong>{updatedLabel}</strong>
          </div>
          <div>
            <span>QMD root</span>
            <strong>{status ? compactPath(status.paths.qmdRoot) : "Not loaded"}</strong>
          </div>
          <div>
            <span>SQLite</span>
            <strong>{status ? compactPath(status.paths.sqlitePath) : "Not loaded"}</strong>
          </div>
        </div>
        {status?.activeJobs.map((job) => (
          <div key={job.id} className="ks-empty-state">
            <Database size={18} strokeWidth={1.7} aria-hidden="true" />
            <strong>{job.source} · {job.state}</strong>
            <span>
              {formatCount(job.progress.indexed ?? 0)} indexed,
              {" "}{formatCount(job.progress.failed ?? 0)} failed
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function KnowledgeSearchScreen({
  navigate,
  mode,
}: {
  navigate: (route: Route) => void;
  mode?: SearchMode;
}) {
  const { selectedKnowledgeHit, inspectKnowledgeHit, clearKnowledgeHit, openFilePreview } = useScout();
  const { status, setStatus, error, setError } = useKnowledgeStatus();
  const [query, setQuery] = useState("QMD search");
  const [hits, setHits] = useState<KnowledgeHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [indexing, setIndexing] = useState(false);

  const hasIndex = (status?.chunks ?? 0) > 0;

  const runSearch = async (nextQuery = query) => {
    const trimmed = nextQuery.trim();
    if (!trimmed || !hasIndex) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      setError(null);
      const params = new URLSearchParams({ q: trimmed, limit: "30" });
      const response = await api<SearchResponse>(`/api/knowledge/search?${params.toString()}`);
      setHits(response.hits);
      setStatus(response.status);
      if (response.hits[0]) {
        inspectKnowledgeHit(response.hits[0], trimmed);
      } else {
        clearKnowledgeHit();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (!hasIndex) return;
    const timer = window.setTimeout(() => {
      void runSearch(query);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, hasIndex]);

  const buildIndex = async (force = false) => {
    setIndexing(true);
    try {
      setError(null);
      const response = await api<{ status: KnowledgeStatus }>("/api/knowledge/sessions/index", {
        method: "POST",
        body: JSON.stringify({ days: 3, limit: 260, force }),
      });
      setStatus(response.status);
      await runSearch(query);
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
      setStatus(response.status);
      await runSearch(query);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIndexing(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch(query);
  };

  const activeRoute: Route = { view: "search", ...(mode ? { mode } : {}) };

  return (
    <div className="s-secondary-nav-shell">
      <div className="s-secondary-nav-bar">
        <SearchSubnav activeRoute={activeRoute} navigate={navigate} />
      </div>
      <main className="ks-page">
      <section className="ks-live-grid">
        {mode === "indexer" ? (
          <SearchIndexerPanel buildIndex={buildIndex} buildWorktreeIndex={buildWorktreeIndex} indexing={indexing} status={status} />
        ) : (
          <section className="ks-panel ks-conversation-panel">
          <form className="ks-search-form" onSubmit={onSubmit}>
            <Search size={16} strokeWidth={1.8} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search QMD, embeddings, API work, raw log drilldown..."
            />
            <button type="submit" aria-label="Search session knowledge" disabled={!hasIndex || searching}>
              {searching ? <Loader2 size={14} className="ks-spin" aria-hidden="true" /> : <FileSearch size={14} aria-hidden="true" />}
              Search
            </button>
          </form>

          {error && (
            <section className="ks-error" role="alert">
              {error}
            </section>
          )}

          <div className="ks-query-tabs" aria-label="Sample searches">
            {SAMPLE_QUERIES.map((sample) => (
              <button
                key={sample}
                type="button"
                className={`ks-query-tab${query === sample ? " ks-query-tab--active" : ""}`}
                onClick={() => setQuery(sample)}
              >
                <Search size={13} strokeWidth={1.8} aria-hidden="true" />
                <span>{sample}</span>
              </button>
            ))}
          </div>

          {!hasIndex && (
            <div className="ks-empty-state">
              <Database size={18} strokeWidth={1.7} aria-hidden="true" />
              <strong>No session knowledge index yet</strong>
              <span>Build the last three days of sessions to replace the placeholder facts with real searchable QMD chunks.</span>
              <button type="button" className="ks-primary-button" onClick={() => void buildIndex(false)} disabled={indexing}>
                {indexing ? <Loader2 size={14} className="ks-spin" aria-hidden="true" /> : <Database size={14} aria-hidden="true" />}
                Build 3-day index
              </button>
            </div>
          )}

          {hasIndex && (
            <div className="ks-hit-list">
              <div className="ks-hit-list-head">
                <span>{searching ? "Searching derived QMD chunks..." : `${hits.length} matching chunks`}</span>
                <strong>{status ? `${formatCount(status.chunks)} indexed` : "index"}</strong>
              </div>
              {hits.length === 0 && !searching ? (
                <div className="ks-empty-hit">
                  No hits for this query. Try a project name, file path, tool name, or concept from recent work.
                </div>
              ) : hits.map((hit) => {
                const transcript = firstTranscriptRef(hit);
                const fileRef = firstFileRef(hit);
                const project = facetText(hit, "project");
                const harness = facetText(hit, "harness");
                const source = facetText(hit, "source");
                const state = facetText(hit, "state");
                const selected = selectedKnowledgeHit?.id === hit.id;
                const sourcePath = transcript ? pathLabel(transcript.path) : fileRef ? pathLabel(fileRef.path) : "";
                const resultSnippet = displaySnippet(hit, query);
                const sessionId = transcriptSessionId(transcript);
                const tailQuery = transcriptTailQuery(transcript);
                const selectHit = () => inspectKnowledgeHit(hit, query);
                return (
                  <article
                    key={hit.id}
                    className={`ks-hit${selected ? " ks-hit--selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-current={selected ? "true" : undefined}
                    onClick={selectHit}
                    onKeyDown={(event) => activateHitFromKeyboard(event, selectHit)}
                    >
                    <div className="ks-hit-title">
                      <FileSearch size={14} strokeWidth={1.8} aria-hidden="true" />
                      <strong>{hit.title}</strong>
                    </div>
                    <p><HighlightedText text={resultSnippet} query={query} /></p>
                    <div className="ks-hit-reason">
                      <span>{rankReason(hit, query)}</span>
                    </div>
                    <div className="ks-hit-meta">
                      {project && <span>{project}</span>}
                      {harness && <span>{harness}</span>}
                      {source === "git_worktree" && <span>worktree diff</span>}
                      {state && <span>{state}</span>}
                      {transcript?.recordRange && <span>records {transcript.recordRange[0]}..{transcript.recordRange[1]}</span>}
                    </div>
                    {sourcePath && (
                      <code className="ks-hit-source" title={sourcePath}>
                        {compactPath(sourcePath)}
                      </code>
                    )}
                    {(sessionId || tailQuery || fileRef) && (
                      <div className="ks-hit-actions" aria-label="Search result actions">
                        {sessionId && (
                          <button
                            type="button"
                            onClick={(event) => stopAndRun(event, () => navigate({ view: "sessions", sessionId }))}
                          >
                            <MessageSquareText size={13} aria-hidden="true" />
                            Open session
                          </button>
                        )}
                        {tailQuery && (
                          <button
                            type="button"
                            onClick={(event) => stopAndRun(event, () => navigate({ view: "ops", mode: "tail", tailQuery }))}
                          >
                            <RadioTower size={13} aria-hidden="true" />
                            Observe window
                          </button>
                        )}
                        {!transcript && fileRef && (
                          <button
                            type="button"
                            onClick={(event) => stopAndRun(event, () => {
                              inspectKnowledgeHit(hit, query);
                              openFilePreview(pathLabel(fileRef.path));
                            })}
                          >
                            <ExternalLink size={13} aria-hidden="true" />
                            Open file
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          </section>
        )}
      </section>
      </main>
    </div>
  );
}
