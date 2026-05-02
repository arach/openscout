import "./ops-tail.css";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SlidePanel } from "../components/SlidePanel/SlidePanel.tsx";
import { api } from "../lib/api.ts";
import { useTailEvents } from "../lib/tail-events.ts";
import type {
  Route,
  TailDiscoverySnapshot,
  TailEvent,
  TailEventKind,
} from "../lib/types.ts";

const BUFFER_LIMIT = 5_000;
const DEFAULT_RECENT_LIMIT = 500;
const RATE_WINDOW_MS = 5_000;
const DISCOVERY_REFRESH_MS = 30_000;

const KIND_GLYPH: Record<TailEventKind, string> = {
  user: ">",
  assistant: "<",
  tool: "*",
  "tool-result": "=",
  system: "~",
  other: "·",
};

type TailAttribution = TailEvent["harness"];

const ATTRIBUTION_LABEL: Record<TailAttribution, string> = {
  "scout-managed": "scout",
  "hudson-managed": "hudson",
  unattributed: "native",
};

const ATTRIBUTION_CLASS: Record<TailAttribution, string> = {
  "scout-managed": "s-tail-chip--origin-scout",
  "hudson-managed": "s-tail-chip--origin-hudson",
  unattributed: "s-tail-chip--origin-native",
};

type SourceCount = {
  source: string;
  count: number;
};

function displayHarness(source: string | null | undefined): string {
  return source?.trim().toLowerCase() || "unknown";
}

function summarizeSources(
  discovery: TailDiscoverySnapshot | null,
  events: TailEvent[],
): SourceCount[] {
  const counts = new Map<string, number>();
  const sourceRows = discovery?.transcripts?.length
    ? discovery.transcripts
    : discovery?.processes.length
      ? discovery.processes
      : events;

  for (const row of sourceRows) {
    const source = displayHarness(row.source);
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function shortSession(sessionId: string): string {
  if (!sessionId) return "—";
  const head = sessionId.split(":")[0] ?? sessionId;
  return head.slice(0, 8);
}

function matchesFilter(event: TailEvent, query: string): boolean {
  if (!query) return true;
  const attribution = ATTRIBUTION_LABEL[event.harness];
  const haystack = `${event.summary} ${event.project} ${event.sessionId} ${event.source} ${event.harness} ${attribution}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function TailView({
  navigate,
  initialFilter,
}: {
  navigate?: (r: Route) => void;
  initialFilter?: string;
} = {}) {
  const [events, setEvents] = useState<TailEvent[]>([]);
  const [discovery, setDiscovery] = useState<TailDiscoverySnapshot | null>(null);
  const [filter, setFilter] = useState(initialFilter ?? "");
  const [filterOpen, setFilterOpen] = useState(Boolean(initialFilter));
  const [paused, setPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [rate, setRate] = useState(0);
  const [selected, setSelected] = useState<TailEvent | null>(null);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const wasAtBottomRef = useRef(true);
  const timestampsRef = useRef<number[]>([]);

  const handleEvent = useCallback((event: TailEvent) => {
    timestampsRef.current.push(Date.now());
    setEvents((prev) => {
      const next = prev.length >= BUFFER_LIMIT
        ? [...prev.slice(prev.length - BUFFER_LIMIT + 1), event]
        : [...prev, event];
      return next;
    });
  }, []);

  useTailEvents(handleEvent);

  useEffect(() => {
    setFilter(initialFilter ?? "");
    setFilterOpen(Boolean(initialFilter));
  }, [initialFilter]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api<{ events: TailEvent[] }>(
          `/api/tail/recent?limit=${DEFAULT_RECENT_LIMIT}`,
        );
        if (!cancelled) setEvents(result.events ?? []);
      } catch {
        /* swallow */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadDiscovery = useCallback(async () => {
    try {
      const snap = await api<TailDiscoverySnapshot>("/api/tail/discover");
      setDiscovery(snap);
    } catch {
      /* swallow */
    }
  }, []);

  useEffect(() => {
    void loadDiscovery();
    const id = setInterval(() => void loadDiscovery(), DISCOVERY_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadDiscovery]);

  // Compute rate (lines per second over RATE_WINDOW_MS).
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const cutoff = now - RATE_WINDOW_MS;
      const fresh = timestampsRef.current.filter((t) => t >= cutoff);
      timestampsRef.current = fresh;
      setRate(fresh.length / (RATE_WINDOW_MS / 1000));
    }, 1_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    if (!filter) return events;
    return events.filter((event) => matchesFilter(event, filter));
  }, [events, filter]);

  // Auto-scroll-to-bottom unless paused.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (paused) {
      setPendingCount((prev) => prev + 1);
      return;
    }
    body.scrollTop = body.scrollHeight;
  }, [filtered, paused]);

  // Detect manual scroll-up to engage pause.
  const handleScroll = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const distance = body.scrollHeight - body.scrollTop - body.clientHeight;
    const atBottom = distance < 24;
    wasAtBottomRef.current = atBottom;
    if (atBottom) {
      setPaused(false);
      setPendingCount(0);
    } else if (!paused) {
      setPaused(true);
    }
  }, [paused]);

  const focusFilter = useCallback((seed: string) => {
    setFilter(seed);
    setFilterOpen(true);
    requestAnimationFrame(() => filterInputRef.current?.focus());
  }, []);

  const navigateToSession = useCallback(
    (sessionId: string) => {
      if (!sessionId || !navigate) return;
      navigate({ view: "sessions", sessionId });
    },
    [navigate],
  );

  const jumpToLive = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
    setPaused(false);
    setPendingCount(0);
  }, []);

  // Keyboard shortcuts: /, Esc, G
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inEditable = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target?.isContentEditable ?? false);

      if (event.key === "/" && !inEditable) {
        event.preventDefault();
        setFilterOpen(true);
        requestAnimationFrame(() => filterInputRef.current?.focus());
        return;
      }
      if (event.key === "Escape") {
        // Sheet escape is handled inside <SlidePanel>; here we only handle filter close.
        if (filterOpen && document.activeElement === filterInputRef.current) {
          event.preventDefault();
          setFilterOpen(false);
          filterInputRef.current?.blur();
          setFilter("");
          return;
        }
      }
      if ((event.key === "g" || event.key === "G") && !inEditable) {
        event.preventDefault();
        jumpToLive();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filterOpen, jumpToLive]);

  const totals = discovery?.totals;
  const transcriptCount = totals?.transcripts ?? discovery?.transcripts?.length ?? 0;
  const harnessCounts = useMemo(() => summarizeSources(discovery, events), [discovery, events]);

  return (
    <div className="s-tail">
      <div className="s-tail-status">
        <span className="s-tail-status-cell">
          <span className="s-tail-rate-pulse" />
          <strong>{transcriptCount}</strong> log{transcriptCount === 1 ? "" : "s"}
        </span>
        <span className="s-tail-status-cell">
          <strong>{totals?.total ?? 0}</strong> proc{(totals?.total ?? 0) === 1 ? "" : "s"}
        </span>
        <span className="s-tail-status-cell">
          <strong>{rate.toFixed(1)}</strong> lines/s
        </span>
        <span className="s-tail-status-cell s-tail-status-cell--harnesses">
          <span>harness</span>
          <span className="s-tail-status-inline">
            {harnessCounts.length > 0 ? (
              harnessCounts.slice(0, 4).map((entry) => (
                <span key={entry.source}>
                  <strong>{entry.count}</strong> {entry.source}
                </span>
              ))
            ) : (
              <strong>none</strong>
            )}
          </span>
        </span>
        <span className="s-tail-status-spacer" />
        {paused && <span className="s-tail-status-paused">paused</span>}
      </div>

      {filterOpen && (
        <div className="s-tail-filter">
          <span className="s-tail-filter-prompt">/</span>
          <input
            ref={filterInputRef}
            className="s-tail-filter-input"
            value={filter}
            placeholder="substring across summary · project · session"
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                filterInputRef.current?.blur();
              }
            }}
            autoFocus
            spellCheck={false}
          />
          <span className="s-tail-filter-hint">esc to clear</span>
        </div>
      )}

      <div className="s-tail-body" ref={bodyRef} onScroll={handleScroll}>
        {filtered.length === 0 ? (
          <div className="s-tail-empty">
            <span className="s-tail-empty-title">tail · waiting for transcripts</span>
            <span>
              {transcriptCount ? (
                <>watching {transcriptCount} transcript{transcriptCount === 1 ? "" : "s"}</>
              ) : (
                <>no moving transcript logs detected · start a session to see traffic</>
              )}
            </span>
          </div>
        ) : (
          filtered.map((event) => (
            <TailRow
              key={event.id}
              event={event}
              selected={selected?.id === event.id}
              onSelect={setSelected}
              onProjectClick={focusFilter}
              onSessionClick={navigateToSession}
            />
          ))
        )}
        {paused && pendingCount > 0 && (
          <div className="s-tail-divider" onClick={jumpToLive} role="button">
            ── paused · {pendingCount} new · click or press G to jump back to live ──
          </div>
        )}
      </div>

      <div className="s-tail-keys">
        <span><kbd>j</kbd>/<kbd>k</kbd> scroll</span>
        <span><kbd>/</kbd> filter</span>
        <span><kbd>G</kbd> jump live</span>
        <span><kbd>esc</kbd> close filter</span>
        <span className="s-tail-keys-spacer" />
        <span>{filtered.length} / {events.length} lines buffered</span>
      </div>

      {selected && (
        <TailDetailSheet
          event={selected}
          onClose={() => setSelected(null)}
          onProjectClick={focusFilter}
          onSessionClick={navigateToSession}
        />
      )}
    </div>
  );
}

function TailRow({
  event,
  selected,
  onSelect,
  onProjectClick,
  onSessionClick,
}: {
  event: TailEvent;
  selected: boolean;
  onSelect: (event: TailEvent) => void;
  onProjectClick?: (project: string) => void;
  onSessionClick?: (sessionId: string) => void;
}) {
  const attributionClass = ATTRIBUTION_CLASS[event.harness];
  const attributionLabel = ATTRIBUTION_LABEL[event.harness];
  const harnessLabel = displayHarness(event.source);
  return (
    <div
      className={`s-tail-row s-tail-row--${event.kind}${selected ? " s-tail-row--selected" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(event)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(event);
        }
      }}
    >
      <span className="s-tail-cell-time">{formatTime(event.ts)}</span>
      <span className="s-tail-gutter">│</span>
      <span className="s-tail-chip s-tail-chip--harness">{harnessLabel}</span>
      <span className={`s-tail-chip ${attributionClass}`} title={`origin: ${attributionLabel}`}>
        {attributionLabel}
      </span>
      <span className="s-tail-cell-context">
        <TailLink
          className="s-tail-link s-tail-link--project"
          onClick={onProjectClick ? () => onProjectClick(event.project) : undefined}
          title={`Filter to ${event.project}`}
        >
          <strong>{event.project}</strong>
        </TailLink>
        {" · "}
        <TailLink
          className="s-tail-link s-tail-link--session"
          onClick={
            onSessionClick && event.sessionId
              ? () => onSessionClick(event.sessionId)
              : undefined
          }
          title={event.sessionId ? `Open session ${event.sessionId}` : undefined}
        >
          {shortSession(event.sessionId)}
        </TailLink>
        {" · "}
        <span className="s-tail-cell-pid" title={event.pid > 0 ? `pid ${event.pid}` : "file-backed log"}>
          {event.pid > 0 ? event.pid : "log"}
        </span>
      </span>
      <span className={`s-tail-glyph s-tail-glyph--${event.kind}`}>{KIND_GLYPH[event.kind]}</span>
      <span className="s-tail-summary">{event.summary}</span>
    </div>
  );
}

/**
 * Inline hyperlink-style span. If `onClick` is provided, the span renders as a
 * clickable element that swallows row-click propagation; otherwise it renders
 * as plain text. Used so identifiers in a row (project, session) are
 * navigable without conflicting with the row's open-detail click.
 */
function TailLink({
  className,
  onClick,
  title,
  children,
}: {
  className: string;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
}) {
  if (!onClick) return <span className={className} title={title}>{children}</span>;
  return (
    <span
      className={`${className} s-tail-link--active`}
      role="link"
      tabIndex={0}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }
      }}
    >
      {children}
    </span>
  );
}

function formatFullTime(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${ms}`;
}

function highlightJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2) ?? "undefined";
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(
    /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (_match, key, str, lit, num) => {
      if (key) return `<span class="s-tail-jk">${key}</span>`;
      if (str) return `<span class="s-tail-js">${str}</span>`;
      if (lit) return `<span class="s-tail-jl">${lit}</span>`;
      if (num) return `<span class="s-tail-jn">${num}</span>`;
      return _match;
    },
  );
}

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; name?: string; input?: unknown; id?: string };
type ToolResultBlock = {
  type: "tool_result";
  content?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
};
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | { type: string; [k: string]: unknown };

function getContentBlocks(raw: unknown): ContentBlock[] | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const message = obj.message as Record<string, unknown> | undefined;
  const content = (message?.content ?? obj.content) as unknown;
  if (Array.isArray(content)) return content as ContentBlock[];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return null;
}

function TailDetailSheet({
  event,
  onClose,
  onProjectClick,
  onSessionClick,
}: {
  event: TailEvent;
  onClose: () => void;
  onProjectClick?: (project: string) => void;
  onSessionClick?: (sessionId: string) => void;
}) {
  const [showRaw, setShowRaw] = useState(true);
  const attributionClass = ATTRIBUTION_CLASS[event.harness];
  const attributionLabel = ATTRIBUTION_LABEL[event.harness];
  const harnessLabel = displayHarness(event.source);
  const blocks = getContentBlocks(event.raw);

  return (
    <SlidePanel
      open
      onClose={onClose}
      side="right"
      owner="openscout.tail"
      resizable
      defaultSize={620}
      minSize={400}
      maxSize={960}
      ariaLabel="Tail event detail"
    >
        <div className="s-slide-header s-tail-sheet-header">
          <span className={`s-tail-glyph s-tail-glyph--${event.kind}`}>{KIND_GLYPH[event.kind]}</span>
          <span className="s-tail-sheet-kind">{event.kind}</span>
          <span className="s-tail-chip s-tail-chip--harness">{harnessLabel}</span>
          <span className={`s-tail-chip ${attributionClass}`} title={`origin: ${attributionLabel}`}>
            {attributionLabel}
          </span>
          <span className="s-slide-spacer" />
          <span className="s-tail-sheet-time">{formatFullTime(event.ts)}</span>
          <button type="button" className="s-slide-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="s-slide-body s-tail-sheet-body">
          <section className="s-tail-sheet-section">
            <div className="s-tail-sheet-grid">
              <span className="s-tail-sheet-key">project</span>
              <span className="s-tail-sheet-val">
                <TailLink
                  className="s-tail-link s-tail-link--project"
                  onClick={onProjectClick ? () => onProjectClick(event.project) : undefined}
                  title={`Filter to ${event.project}`}
                >
                  {event.project}
                </TailLink>
              </span>
              <span className="s-tail-sheet-key">cwd</span>
              <span className="s-tail-sheet-val s-tail-sheet-val--mono">{event.cwd || "—"}</span>
              <span className="s-tail-sheet-key">session</span>
              <span className="s-tail-sheet-val s-tail-sheet-val--mono">
                <TailLink
                  className="s-tail-link s-tail-link--session"
                  onClick={
                    onSessionClick && event.sessionId
                      ? () => onSessionClick(event.sessionId)
                      : undefined
                  }
                  title={event.sessionId ? `Open session ${event.sessionId}` : undefined}
                >
                  {event.sessionId || "—"}
                </TailLink>
              </span>
              <span className="s-tail-sheet-key">harness</span>
              <span className="s-tail-sheet-val s-tail-sheet-val--mono">{harnessLabel}</span>
              <span className="s-tail-sheet-key">origin</span>
              <span className="s-tail-sheet-val s-tail-sheet-val--mono">{attributionLabel}</span>
              <span className="s-tail-sheet-key">pid</span>
              <span className="s-tail-sheet-val s-tail-sheet-val--mono">
                {event.pid}
                {event.parentPid != null ? ` ← ${event.parentPid}` : ""}
              </span>
            </div>
          </section>

          <section className="s-tail-sheet-section">
            <h4 className="s-tail-sheet-h">summary</h4>
            <div className="s-tail-sheet-summary">{event.summary}</div>
          </section>

          {blocks && blocks.length > 0 && (
            <section className="s-tail-sheet-section">
              <h4 className="s-tail-sheet-h">content</h4>
              {blocks.map((block, i) => (
                <ContentBlockView key={i} block={block} />
              ))}
            </section>
          )}

          <section className="s-tail-sheet-section">
            <button
              type="button"
              className="s-tail-sheet-toggle"
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? "▾" : "▸"} raw event
            </button>
            {showRaw && (
              <pre
                className="s-tail-sheet-json"
                dangerouslySetInnerHTML={{ __html: highlightJson(event.raw ?? event) }}
              />
            )}
          </section>
        </div>
    </SlidePanel>
  );
}

function ContentBlockView({ block }: { block: ContentBlock }) {
  if (block.type === "text") {
    const text = (block as TextBlock).text ?? "";
    return <div className="s-tail-sheet-text">{text}</div>;
  }
  if (block.type === "tool_use") {
    const t = block as ToolUseBlock;
    return (
      <div className="s-tail-sheet-block s-tail-sheet-block--tool">
        <div className="s-tail-sheet-block-head">
          <span className="s-tail-glyph s-tail-glyph--tool">*</span>
          <span className="s-tail-sheet-block-title">{t.name ?? "tool_use"}</span>
        </div>
        <pre
          className="s-tail-sheet-json"
          dangerouslySetInnerHTML={{ __html: highlightJson(t.input ?? {}) }}
        />
      </div>
    );
  }
  if (block.type === "tool_result") {
    const r = block as ToolResultBlock;
    const isString = typeof r.content === "string";
    return (
      <div
        className={`s-tail-sheet-block s-tail-sheet-block--tool-result${
          r.is_error ? " s-tail-sheet-block--err" : ""
        }`}
      >
        <div className="s-tail-sheet-block-head">
          <span className="s-tail-glyph s-tail-glyph--tool-result">=</span>
          <span className="s-tail-sheet-block-title">
            tool_result{r.is_error ? " · error" : ""}
          </span>
        </div>
        {isString ? (
          <pre className="s-tail-sheet-pre">{r.content as string}</pre>
        ) : (
          <pre
            className="s-tail-sheet-json"
            dangerouslySetInnerHTML={{ __html: highlightJson(r.content ?? {}) }}
          />
        )}
      </div>
    );
  }
  return (
    <div className="s-tail-sheet-block">
      <div className="s-tail-sheet-block-head">
        <span className="s-tail-glyph s-tail-glyph--other">·</span>
        <span className="s-tail-sheet-block-title">{block.type}</span>
      </div>
      <pre
        className="s-tail-sheet-json"
        dangerouslySetInnerHTML={{ __html: highlightJson(block) }}
      />
    </div>
  );
}
