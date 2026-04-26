import "./ops-tail.css";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SlidePanel } from "../components/SlidePanel/SlidePanel.tsx";
import { api } from "../lib/api.ts";
import { useTailEvents } from "../lib/tail-events.ts";
import type {
  TailDiscoverySnapshot,
  TailEvent,
  TailEventKind,
  TailHarness,
} from "../lib/types.ts";

const BUFFER_LIMIT = 5_000;
const DEFAULT_RECENT_LIMIT = 500;
const RATE_WINDOW_MS = 5_000;

const KIND_GLYPH: Record<TailEventKind, string> = {
  user: ">",
  assistant: "<",
  tool: "*",
  "tool-result": "=",
  system: "~",
  other: "·",
};

const HARNESS_LABEL: Record<TailHarness, string> = {
  "scout-managed": "scout",
  "hudson-managed": "hudson",
  unattributed: "ghost",
};

const HARNESS_CLASS: Record<TailHarness, string> = {
  "scout-managed": "s-tail-chip--scout",
  "hudson-managed": "s-tail-chip--hudson",
  unattributed: "s-tail-chip--ghost",
};

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
  const haystack = `${event.summary} ${event.project} ${event.sessionId} ${event.harness}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function TailView() {
  const [events, setEvents] = useState<TailEvent[]>([]);
  const [discovery, setDiscovery] = useState<TailDiscoverySnapshot | null>(null);
  const [filter, setFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
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
    const id = setInterval(() => void loadDiscovery(), 5_000);
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
  const ghostCount = totals?.unattributed ?? 0;

  return (
    <div className="s-tail">
      <div className="s-tail-status">
        <span className="s-tail-status-cell">
          <span className="s-tail-rate-pulse" />
          <strong>{totals?.total ?? 0}</strong> agent{(totals?.total ?? 0) === 1 ? "" : "s"}
        </span>
        <span className="s-tail-status-cell">
          <strong>{rate.toFixed(1)}</strong> lines/s
        </span>
        <span className={`s-tail-status-cell${ghostCount > 0 ? " s-tail-status-cell--ghost" : ""}`}>
          <strong>{ghostCount}</strong> ghost{ghostCount === 1 ? "" : "s"}
        </span>
        <span className="s-tail-status-cell">
          <strong>{totals?.scoutManaged ?? 0}</strong> scout · <strong>{totals?.hudsonManaged ?? 0}</strong> hudson
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
              {totals?.total ? (
                <>watching {totals.total} claude session{totals.total === 1 ? "" : "s"}</>
              ) : (
                <>no claude processes detected · start a session to see traffic</>
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
        <TailDetailSheet event={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function TailRow({
  event,
  selected,
  onSelect,
}: {
  event: TailEvent;
  selected: boolean;
  onSelect: (event: TailEvent) => void;
}) {
  const harnessClass = HARNESS_CLASS[event.harness];
  const harnessLabel = HARNESS_LABEL[event.harness];
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
      <span className={`s-tail-chip s-tail-chip--source`}>{event.source}</span>
      <span className={`s-tail-chip ${harnessClass}`}>{harnessLabel}</span>
      <span className="s-tail-cell-context">
        <strong>{event.project}</strong>
        {" · "}
        {shortSession(event.sessionId)}
        {" · "}
        {event.pid}
      </span>
      <span className={`s-tail-glyph s-tail-glyph--${event.kind}`}>{KIND_GLYPH[event.kind]}</span>
      <span className="s-tail-summary">{event.summary}</span>
    </div>
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

function TailDetailSheet({ event, onClose }: { event: TailEvent; onClose: () => void }) {
  const [showRaw, setShowRaw] = useState(true);
  const harnessClass = HARNESS_CLASS[event.harness];
  const harnessLabel = HARNESS_LABEL[event.harness];
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
          <span className={`s-tail-chip ${harnessClass}`}>{harnessLabel}</span>
          <span className="s-tail-chip s-tail-chip--source">{event.source}</span>
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
              <span className="s-tail-sheet-val">{event.project}</span>
              <span className="s-tail-sheet-key">cwd</span>
              <span className="s-tail-sheet-val s-tail-sheet-val--mono">{event.cwd || "—"}</span>
              <span className="s-tail-sheet-key">session</span>
              <span className="s-tail-sheet-val s-tail-sheet-val--mono">{event.sessionId || "—"}</span>
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
