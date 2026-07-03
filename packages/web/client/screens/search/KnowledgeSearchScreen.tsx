import "./knowledge-search.css";

import { useEffect, useState } from "react";
import type { FormEvent, KeyboardEvent, MouseEvent } from "react";
import {
  CalendarDays,
  Database,
  ExternalLink,
  FileSearch,
  Loader2,
  MessageSquareText,
  RadioTower,
  RefreshCw,
  Search,
  Sparkles,
  Target,
} from "lucide-react";

import type { Route } from "../../lib/types.ts";
import type { SearchMode } from "../../lib/types.ts";
import { api } from "../../lib/api.ts";
import { formatClockTimestamp } from "../../lib/time.ts";
import { useScout } from "../../scout/Provider.tsx";
import { SearchSubnav } from "./SearchSubnav.tsx";
import {
  aggregateGuidedKnowledgeHits,
  buildGuidedKnowledgeQueries,
  facetText,
  firstFileRef,
  firstTranscriptRef,
  GUIDED_KNOWLEDGE_HARNESSES,
  GUIDED_KNOWLEDGE_WINDOWS,
  guidedKnowledgeUpdatedAfterMs,
  guidedKnowledgeLimit,
  highlightParts,
  pathLabel,
  summarizeGuidedKnowledgeSessions,
  transcriptSessionId,
  transcriptTailQuery,
  type GuidedKnowledgeSearch,
  type GuidedKnowledgeSessionSummary,
  type GuidedKnowledgeHarness,
  type GuidedKnowledgeWindow,
  type IndexResponse,
  queryTerms,
  type KnowledgeHit,
  type KnowledgeStatus,
  type SearchResponse,
  type WorktreeIndexResponse,
} from "../../lib/knowledge-search.ts";

const SAMPLE_QUERIES = [
  "QMD",
  "embeddings",
  "search surface",
  "raw log drilldown",
  "MCP",
  "context pack",
  "API",
];

const DEFAULT_GUIDED_THEME = "navigation agent project hierarchy";
const DEFAULT_GUIDED_OBJECTIVE = "Find /projects view, project hierarchy, navigation, and agent/session discussions.";

type GuidedIndexerSummary = {
  days: GuidedKnowledgeWindow;
  indexed: number;
  discovered: number;
  failed: number;
  queries: string[];
  sessions: GuidedKnowledgeSessionSummary[];
};

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
    ? formatClockTimestamp(status.generatedAt) || "unknown"
    : "Not loaded";
  return (
    <section className="ks-panel ks-conversation-panel">
      <div className="ks-panel-head">
        <div>
          <p className="ks-panel-eyebrow">Indexer</p>
          <h2>Session knowledge indexer</h2>
        </div>
        <Database size={18} strokeWidth={1.7} aria-hidden="true" />
      </div>
      <div className="ks-indexer-panel">
        <div className="ks-indexer-actions">
          <button type="button" className="ks-icon-button" onClick={() => void buildIndex(false)} disabled={indexing}>
            {indexing ? <Loader2 size={14} className="ks-spin" aria-hidden="true" /> : <Database size={14} aria-hidden="true" />}
            Refresh 3d
          </button>
          <button type="button" className="ks-icon-button" onClick={() => void buildIndex(true)} disabled={indexing}>
            {indexing ? <Loader2 size={14} className="ks-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
            Rebuild 3d
          </button>
          <button type="button" className="ks-icon-button" onClick={() => void buildWorktreeIndex(true)} disabled={indexing}>
            {indexing ? <Loader2 size={14} className="ks-spin" aria-hidden="true" /> : <FileSearch size={14} aria-hidden="true" />}
            Worktree diffs
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
            <span>Default window</span>
            <strong>Last 3 days, up to 260 sessions</strong>
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

function AgentInvestigationPanel({
  runGuidedPass,
  indexing,
  guidedTheme,
  setGuidedTheme,
  guidedObjective,
  setGuidedObjective,
  guidedHarness,
  setGuidedHarness,
  guidedDays,
  setGuidedDays,
  guidedSummary,
}: {
  runGuidedPass: () => Promise<void>;
  indexing: boolean;
  guidedTheme: string;
  setGuidedTheme: (value: string) => void;
  guidedObjective: string;
  setGuidedObjective: (value: string) => void;
  guidedHarness: GuidedKnowledgeHarness;
  setGuidedHarness: (value: GuidedKnowledgeHarness) => void;
  guidedDays: GuidedKnowledgeWindow;
  setGuidedDays: (value: GuidedKnowledgeWindow) => void;
  guidedSummary: GuidedIndexerSummary | null;
}) {
  return (
    <>
      <form
        className="ks-guided-indexer"
        onSubmit={(event) => {
          event.preventDefault();
          void runGuidedPass();
        }}
      >
        <div className="ks-guided-head">
          <Sparkles size={16} aria-hidden="true" />
          <div>
            <span>Agent investigation</span>
            <strong>Search plus judgment</strong>
          </div>
        </div>
        <label className="ks-guided-field">
          <span>Theme</span>
          <input
            value={guidedTheme}
            onChange={(event) => setGuidedTheme(event.target.value)}
            placeholder="navigation agent project hierarchy"
          />
        </label>
        <label className="ks-guided-field">
          <span>Objective</span>
          <textarea
            value={guidedObjective}
            onChange={(event) => setGuidedObjective(event.target.value)}
            rows={3}
            placeholder="Find /projects view, routing, and project hierarchy decisions."
          />
        </label>
        <div className="ks-guided-filter-grid">
          <div className="ks-guided-filter">
            <span>Harness</span>
            <div className="ks-window-picker" role="group" aria-label="Harness filter">
              {GUIDED_KNOWLEDGE_HARNESSES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={guidedHarness === item.value ? "active" : ""}
                  onClick={() => setGuidedHarness(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ks-guided-filter">
            <span>When</span>
            <div className="ks-window-picker" role="group" aria-label="Lookback window">
              {GUIDED_KNOWLEDGE_WINDOWS.map((window) => (
                <button
                  key={window.days}
                  type="button"
                  className={guidedDays === window.days ? "active" : ""}
                  onClick={() => setGuidedDays(window.days)}
                >
                  <CalendarDays size={13} aria-hidden="true" />
                  {window.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="ks-guided-controls">
          <button type="submit" className="ks-primary-button ks-guided-submit" disabled={indexing}>
            {indexing ? <Loader2 size={14} className="ks-spin" aria-hidden="true" /> : <Target size={14} aria-hidden="true" />}
            Investigate
          </button>
        </div>
      </form>

      {guidedSummary && (
        <section className="ks-guided-summary" aria-label="Investigation summary">
          <div className="ks-guided-summary-head">
            <strong>{formatCount(guidedSummary.sessions.length)} candidate sessions</strong>
            <span>
              {guidedHarness === "all" ? "all" : guidedHarness} · {guidedSummary.days}d · {formatCount(guidedSummary.indexed)} indexed · {formatCount(guidedSummary.failed)} failed
            </span>
          </div>
          <div className="ks-query-chip-row">
            {guidedSummary.queries.slice(0, 6).map((item) => <span key={item}>{item}</span>)}
          </div>
          <div className="ks-guided-session-list">
            {guidedSummary.sessions.slice(0, 4).map((session) => (
              <article key={session.collectionId}>
                <div className="ks-guided-session-title">
                  <strong>{session.title}</strong>
                  <em data-confidence={session.confidence}>{session.confidence}</em>
                </div>
                <span>
                  {[session.project, session.harness, `${formatCount(session.hitCount)} hits`].filter(Boolean).join(" · ")}
                </span>
                <p>{session.judgment}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
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
  const [guidedTheme, setGuidedTheme] = useState(DEFAULT_GUIDED_THEME);
  const [guidedObjective, setGuidedObjective] = useState(DEFAULT_GUIDED_OBJECTIVE);
  const [guidedHarness, setGuidedHarness] = useState<GuidedKnowledgeHarness>("all");
  const [guidedDays, setGuidedDays] = useState<GuidedKnowledgeWindow>(21);
  const [guidedSummary, setGuidedSummary] = useState<GuidedIndexerSummary | null>(null);

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

  const runGuidedPass = async () => {
    const guidedQueries = buildGuidedKnowledgeQueries(guidedTheme, guidedObjective);
    if (guidedQueries.length === 0) {
      setHits([]);
      setGuidedSummary(null);
      return;
    }

    setIndexing(true);
    setSearching(true);
    try {
      setError(null);
      const indexResponse = await api<IndexResponse>("/api/knowledge/sessions/index", {
        method: "POST",
        body: JSON.stringify({
          days: guidedDays,
          limit: guidedKnowledgeLimit(guidedDays),
          force: false,
        }),
      });
      const searches = await Promise.all(
        guidedQueries.map(async (guidedQuery): Promise<GuidedKnowledgeSearch> => {
          const params = new URLSearchParams({
            q: guidedQuery,
            limit: "16",
            updatedAfterMs: String(guidedKnowledgeUpdatedAfterMs(guidedDays)),
          });
          if (guidedHarness !== "all") params.set("harness", guidedHarness);
          const response = await api<SearchResponse>(`/api/knowledge/search?${params.toString()}`);
          return { q: guidedQuery, hits: response.hits };
        }),
      );
      const nextHits = aggregateGuidedKnowledgeHits(searches, 30);
      setQuery(guidedQueries[0] ?? guidedTheme);
      setHits(nextHits);
      setStatus(indexResponse.status);
      setGuidedSummary({
        days: guidedDays,
        indexed: indexResponse.result.indexed,
        discovered: indexResponse.result.discovered,
        failed: indexResponse.result.failed,
        queries: guidedQueries,
        sessions: summarizeGuidedKnowledgeSessions(searches),
      });
      if (nextHits[0]) {
        inspectKnowledgeHit(nextHits[0], guidedQueries[0] ?? guidedTheme);
      } else {
        clearKnowledgeHit();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIndexing(false);
      setSearching(false);
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
          <SearchIndexerPanel
            buildIndex={buildIndex}
            buildWorktreeIndex={buildWorktreeIndex}
            indexing={indexing}
            status={status}
          />
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

          <AgentInvestigationPanel
            runGuidedPass={runGuidedPass}
            indexing={indexing}
            guidedTheme={guidedTheme}
            setGuidedTheme={setGuidedTheme}
            guidedObjective={guidedObjective}
            setGuidedObjective={setGuidedObjective}
            guidedHarness={guidedHarness}
            setGuidedHarness={setGuidedHarness}
            guidedDays={guidedDays}
            setGuidedDays={setGuidedDays}
            guidedSummary={guidedSummary}
          />

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
