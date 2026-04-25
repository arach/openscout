import "./ops-tail.css";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
          filtered.map((event) => <TailRow key={event.id} event={event} />)
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
    </div>
  );
}

function TailRow({ event }: { event: TailEvent }) {
  const harnessClass = HARNESS_CLASS[event.harness];
  const harnessLabel = HARNESS_LABEL[event.harness];
  return (
    <div className={`s-tail-row s-tail-row--${event.kind}`}>
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
