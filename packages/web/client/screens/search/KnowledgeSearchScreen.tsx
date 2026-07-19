import "./knowledge-search.css";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  Loader2,
  Search,
} from "lucide-react";

import type { Route } from "../../lib/types.ts";
import { api } from "../../lib/api.ts";
import { formatClockTimestamp } from "../../lib/time.ts";
import { useScout } from "../../scout/Provider.tsx";
import {
  displaySnippet,
  firstTranscriptRef,
  groupHitsBySession,
  highlightParts,
  KNOWLEDGE_SEARCH_DEFAULTS,
  resultMomentBits,
  resultMomentHeadline,
  resultRoutingContext,
  resultSessionGoal,
  transcriptSessionId,
  type IndexResponse,
  type KnowledgeHit,
  type KnowledgeStatus,
  type SearchResponse,
} from "../../lib/knowledge-search.ts";

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value || 0);
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

function activateHitFromKeyboard(event: KeyboardEvent<HTMLElement>, activate: () => void) {
  if (event.target !== event.currentTarget) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

async function fetchStatus(): Promise<KnowledgeStatus> {
  return api<KnowledgeStatus>("/api/knowledge/status");
}

async function searchKnowledge(q: string): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q,
    limit: String(KNOWLEDGE_SEARCH_DEFAULTS.hitLimit),
  });
  return api<SearchResponse>(`/api/knowledge/search?${params.toString()}`);
}

async function indexSessions(force = false): Promise<IndexResponse> {
  return api<IndexResponse>("/api/knowledge/sessions/index", {
    method: "POST",
    body: JSON.stringify({
      days: KNOWLEDGE_SEARCH_DEFAULTS.days,
      limit: KNOWLEDGE_SEARCH_DEFAULTS.sessionLimit,
      force,
    }),
  });
}

export function KnowledgeSearchScreen({
  navigate,
}: {
  navigate: (route: Route) => void;
  /** Kept for route compatibility; search is one surface now. */
  mode?: string;
}) {
  const { selectedKnowledgeHit, inspectKnowledgeHit, clearKnowledgeHit } = useScout();
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KnowledgeHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const queryRef = useRef(query);
  queryRef.current = query;

  const hasIndex = (status?.chunks ?? 0) > 0;
  const activeJob = status?.activeJobs[0] ?? null;
  const sessionResults = useMemo(() => groupHitsBySession(hits), [hits]);
  const isBusy = indexing || Boolean(activeJob);

  const applySearchResponse = (trimmed: string, response: SearchResponse) => {
    setHits(response.hits);
    setStatus(response.status);
    if (response.hits[0]) {
      inspectKnowledgeHit(response.hits[0], trimmed);
    } else {
      clearKnowledgeHit();
    }
  };

  const runSearch = async (nextQuery = query, ready = hasIndex) => {
    const trimmed = nextQuery.trim();
    if (!trimmed || !ready) {
      setHits([]);
      if (!trimmed) clearKnowledgeHit();
      return;
    }
    setSearching(true);
    try {
      setError(null);
      applySearchResponse(trimmed, await searchKnowledge(trimmed));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const refreshIndex = async (force = false) => {
    setIndexing(true);
    try {
      setError(null);
      const response = await indexSessions(force);
      setStatus(response.status);
      setStatusLoaded(true);
      const ready = response.status.chunks > 0;
      const liveQuery = queryRef.current.trim();
      if (ready && liveQuery) {
        applySearchResponse(liveQuery, await searchKnowledge(liveQuery));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIndexing(false);
    }
  };

  // Always refresh the default session window when the page opens.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const next = await fetchStatus();
        if (cancelled) return;
        setStatus(next);
        setStatusLoaded(true);
        setError(null);
      } catch {
        // Indexing below will surface a hard failure if status is also unavailable.
      }

      if (cancelled) return;
      setIndexing(true);
      try {
        setError(null);
        const response = await indexSessions(false);
        if (cancelled) return;
        setStatus(response.status);
        setStatusLoaded(true);
        const liveQuery = queryRef.current.trim();
        if (response.status.chunks > 0 && liveQuery) {
          applySearchResponse(liveQuery, await searchKnowledge(liveQuery));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatusLoaded(true);
        }
      } finally {
        if (!cancelled) setIndexing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasIndex) return;
    const timer = window.setTimeout(() => {
      void runSearch(query);
    }, KNOWLEDGE_SEARCH_DEFAULTS.debounceMs);
    return () => window.clearTimeout(timer);
  }, [query, hasIndex]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!hasIndex && !indexing) {
      void refreshIndex(false);
      return;
    }
    void runSearch(query);
  };

  const updatedLabel = status
    ? formatClockTimestamp(status.generatedAt) || "just now"
    : "—";

  const footStatus = isBusy
    ? activeJob
      ? `Indexing ${formatCount(activeJob.progress.indexed ?? 0)} of ${formatCount(activeJob.progress.discovered ?? 0)}`
      : hasIndex
        ? `Refreshing last ${KNOWLEDGE_SEARCH_DEFAULTS.days} days in the background`
        : `Building last ${KNOWLEDGE_SEARCH_DEFAULTS.days} days of sessions`
    : hasIndex
      ? `${formatCount(status?.chunks ?? 0)} moments · last ${KNOWLEDGE_SEARCH_DEFAULTS.days} days · updated ${updatedLabel}`
      : statusLoaded
        ? "No index yet"
        : "Loading index";

  return (
    <main className="ks-page">
      <div className="ks-shell">
        <form className="ks-search-form" onSubmit={onSubmit}>
          <Search size={17} strokeWidth={1.75} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions — topics, files, decisions…"
            autoFocus
            spellCheck={false}
            aria-label="Search sessions"
          />
          {searching && <Loader2 size={15} className="ks-spin" aria-hidden="true" />}
        </form>

        {error && (
          <section className="ks-error" role="alert">
            {error}
          </section>
        )}

        {!hasIndex && !error && (
          <div className="ks-empty-state">
            <strong>{indexing ? "Preparing your session index" : "Preparing search"}</strong>
            <span>
              First load builds the last {KNOWLEDGE_SEARCH_DEFAULTS.days} days
              {" "}(up to {formatCount(KNOWLEDGE_SEARCH_DEFAULTS.sessionLimit)} sessions).
              You can keep this page open — results appear as soon as the index is ready.
            </span>
          </div>
        )}

        {hasIndex && (
          <div className="ks-hit-list">
            <div className="ks-hit-list-head">
              <span>
                {searching
                  ? "Searching"
                  : query.trim()
                    ? `${sessionResults.length} session${sessionResults.length === 1 ? "" : "s"}`
                    : "Ready"}
              </span>
              {query.trim() && hits.length > 0 ? (
                <span className="ks-hit-list-meta">
                  {hits.length} moment{hits.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>

            {query.trim() && sessionResults.length === 0 && !searching ? (
              <div className="ks-empty-hit">
                No matches — try a project name, file path, or topic from recent work.
              </div>
            ) : null}

            {!query.trim() && (
              <div className="ks-empty-hit ks-empty-hit--quiet">
                Type to search the last {KNOWLEDGE_SEARCH_DEFAULTS.days} days of sessions.
              </div>
            )}

            {sessionResults.map((session, sessionIndex) => {
              const best = session.best;
              const routing = resultRoutingContext(best);
              const goal = resultSessionGoal(best);
              const sessionId = transcriptSessionId(firstTranscriptRef(best));
              const openSession = () => {
                if (!sessionId) return;
                navigate({ view: "sessions", sessionId });
              };
              const sessionSelected = session.moments.some(
                (moment) => selectedKnowledgeHit?.id === moment.id,
              );

              return (
                <section
                  key={session.collectionId}
                  className={`ks-session${sessionSelected ? " ks-session--selected" : ""}`}
                  aria-label={`Session ${sessionIndex + 1}`}
                >
                  <header className="ks-session-head">
                    <div className="ks-session-topline">
                      <div className="ks-session-meta">
                        {routing.agent ? <span className="ks-hit-chip">{routing.agent}</span> : null}
                        {routing.project ? <span>{routing.project}</span> : null}
                        {routing.session ? (
                          <span className="ks-hit-session" title={sessionId ?? routing.session}>
                            session {routing.session}
                          </span>
                        ) : null}
                        <span className="ks-session-count">
                          {session.moments.length} match{session.moments.length === 1 ? "" : "es"}
                        </span>
                      </div>
                      {routing.when ? <time className="ks-hit-when">{routing.when}</time> : null}
                    </div>
                    <button
                      type="button"
                      className="ks-session-goal"
                      onClick={openSession}
                      title={sessionId ? "Open session" : undefined}
                    >
                      {goal}
                    </button>
                  </header>

                  <div className="ks-session-moments">
                    {session.moments.map((hit) => {
                      const momentHeadline = resultMomentHeadline(hit, query);
                      const selected = selectedKnowledgeHit?.id === hit.id;
                      const resultSnippet = displaySnippet(hit, query, 160);
                      const momentBits = resultMomentBits(hit);
                      const selectHit = () => inspectKnowledgeHit(hit, query);
                      const openMomentSession = () => {
                        const id = transcriptSessionId(firstTranscriptRef(hit)) ?? sessionId;
                        if (!id) {
                          selectHit();
                          return;
                        }
                        navigate({ view: "sessions", sessionId: id });
                      };

                      return (
                        <article
                          key={hit.id}
                          className={`ks-hit${selected ? " ks-hit--selected" : ""}`}
                          role="button"
                          tabIndex={0}
                          aria-current={selected ? "true" : undefined}
                          onClick={selectHit}
                          onDoubleClick={openMomentSession}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                              event.preventDefault();
                              openMomentSession();
                              return;
                            }
                            activateHitFromKeyboard(event, selectHit);
                          }}
                        >
                          <div className="ks-hit-body">
                            {momentBits.length > 0 ? (
                              <div className="ks-hit-details ks-hit-details--moment" aria-label="Turn">
                                {momentBits.map((bit) => (
                                  <span key={bit} className="ks-hit-details-strong">{bit}</span>
                                ))}
                              </div>
                            ) : null}

                            <h3 className="ks-hit-title">{momentHeadline}</h3>

                            {resultSnippet && resultSnippet !== momentHeadline ? (
                              <p className="ks-hit-snippet">
                                <HighlightedText text={resultSnippet} query={query} />
                              </p>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <footer className="ks-foot-status" aria-live="polite">
        <span className="ks-foot-status-facts">
          {isBusy ? <Loader2 size={12} className="ks-spin" aria-hidden="true" /> : null}
          {footStatus}
        </span>
        <button
          type="button"
          className="ks-text-action"
          onClick={() => void refreshIndex(true)}
          disabled={indexing}
        >
          {indexing ? "Updating…" : "Update index"}
        </button>
      </footer>
    </main>
  );
}
