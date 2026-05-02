import "./ops-atop.css";
import "../components/ResizableTable/resizable-columns.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useResizableColumns } from "../components/ResizableTable/useResizableColumns.ts";
import { api } from "../lib/api.ts";
import { useTailEvents } from "../lib/tail-events.ts";
import type {
  Route,
  TailDiscoveredProcess,
  TailDiscoveredTranscript,
  TailDiscoverySnapshot,
  TailEvent,
} from "../lib/types.ts";

type SessionColumnKey = "status" | "session" | "project" | "updated" | "size" | "path";

const COLUMNS: {
  key: SessionColumnKey;
  label: string;
  cls?: string;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
}[] = [
  { key: "status", label: "status", cls: "s-atop-col-status", defaultWidth: 96, minWidth: 70 },
  { key: "session", label: "session", cls: "s-atop-col-agent", defaultWidth: 168, minWidth: 110, maxWidth: 280 },
  { key: "project", label: "project", cls: "s-atop-col-project", defaultWidth: 200, minWidth: 96, maxWidth: 360 },
  { key: "updated", label: "updated", cls: "s-atop-col-last", defaultWidth: 86, minWidth: 64 },
  { key: "size", label: "size", cls: "s-atop-col-runtime", defaultWidth: 80, minWidth: 64 },
  { key: "path", label: "path", defaultWidth: 360, minWidth: 160, maxWidth: 800 },
];

const DISCOVERY_INTERVAL_MS = 10_000;
const RECENT_REPLAY_LIMIT = 500;
const RECENT_EVENT_LIMIT = 1_000;
const ACTIVE_WINDOW_MS = 60_000;

type SessionStatus = "run" | "idle";

type RawSessionRow = {
  refId: string;
  source: string;
  project: string;
  cwd: string | null;
  transcriptPath: string;
  sessionId: string | null;
  mtimeMs: number;
  size: number;
  status: SessionStatus;
  statusLabel: string;
  lastEvent: TailEvent | null;
  process: TailDiscoveredProcess | null;
};

function normalizeSessionRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const leaf = pathLeaf(trimmed);
  return leaf.endsWith(".jsonl") ? leaf.slice(0, -".jsonl".length) : leaf;
}

function pathLeaf(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

function pathParent(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.at(-1) ?? "";
}

function classPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
}

function formatRelative(ms: number | null, now: number): string {
  if (!ms) return "-";
  const delta = Math.max(0, Math.round((now - ms) / 1000));
  if (delta < 2) return "now";
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86400)}d`;
}

function formatAbsolute(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

function matchesQuery(row: RawSessionRow, query: string): boolean {
  if (!query) return true;
  const haystack = [
    row.refId,
    row.sessionId ?? "",
    row.source,
    row.project,
    row.cwd ?? "",
    row.transcriptPath,
    row.lastEvent?.summary ?? "",
    row.process?.command ?? "",
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function processKey(process: TailDiscoveredProcess): string {
  return `${process.source}\0${process.cwd ?? ""}`;
}

function transcriptKey(transcript: TailDiscoveredTranscript): string {
  return `${transcript.source}\0${transcript.cwd ?? ""}`;
}

function buildRows(
  discovery: TailDiscoverySnapshot | null,
  events: TailEvent[],
  now: number,
): RawSessionRow[] {
  if (!discovery?.transcripts?.length) return [];

  const latestEventBySession = new Map<string, TailEvent>();
  for (const event of events) {
    const current = latestEventBySession.get(event.sessionId);
    if (!current || event.ts > current.ts) {
      latestEventBySession.set(event.sessionId, event);
    }
  }

  const processByCwd = new Map<string, TailDiscoveredProcess>();
  for (const process of discovery.processes) {
    if (!process.cwd) continue;
    const current = processByCwd.get(processKey(process));
    if (!current || process.pid < current.pid) {
      processByCwd.set(processKey(process), process);
    }
  }

  return discovery.transcripts
    .map((transcript) => {
      const refId = normalizeSessionRef(transcript.sessionId)
        ?? normalizeSessionRef(transcript.transcriptPath);
      if (!refId) return null;

      const lastEvent = transcript.sessionId
        ? latestEventBySession.get(transcript.sessionId) ?? null
        : null;
      const process = processByCwd.get(transcriptKey(transcript)) ?? null;
      const lastActivity = Math.max(transcript.mtimeMs, lastEvent?.ts ?? 0);
      const active = Boolean(process) || now - lastActivity <= ACTIVE_WINDOW_MS;
      const project = transcript.project?.trim()
        || (transcript.cwd ? pathLeaf(transcript.cwd) : pathParent(transcript.transcriptPath))
        || "unknown";

      return {
        refId,
        source: transcript.source || "unknown",
        project,
        cwd: transcript.cwd,
        transcriptPath: transcript.transcriptPath,
        sessionId: transcript.sessionId,
        mtimeMs: transcript.mtimeMs,
        size: transcript.size,
        status: active ? "run" : "idle",
        statusLabel: active ? "active" : "idle",
        lastEvent,
        process,
      } satisfies RawSessionRow;
    })
    .filter((row): row is RawSessionRow => row !== null)
    .sort((left, right) => {
      const leftActivity = Math.max(left.mtimeMs, left.lastEvent?.ts ?? 0);
      const rightActivity = Math.max(right.mtimeMs, right.lastEvent?.ts ?? 0);
      return rightActivity - leftActivity || left.project.localeCompare(right.project);
    });
}

export function SessionsScreen({ navigate }: { navigate: (r: Route) => void }) {
  const [discovery, setDiscovery] = useState<TailDiscoverySnapshot | null>(null);
  const [events, setEvents] = useState<TailEvent[]>([]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const searchRef = useRef<HTMLInputElement | null>(null);

  const loadDiscovery = useCallback(async () => {
    setError(null);
    try {
      setDiscovery(await api<TailDiscoverySnapshot>("/api/tail/discover"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadDiscovery();
    const id = setInterval(() => void loadDiscovery(), DISCOVERY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadDiscovery]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api<{ events: TailEvent[] }>(
          `/api/tail/recent?limit=${RECENT_REPLAY_LIMIT}`,
        );
        if (!cancelled) setEvents(result.events ?? []);
      } catch {
        /* recent replay is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useTailEvents((event) => {
    setEvents((prev) => {
      const next = prev.length >= RECENT_EVENT_LIMIT
        ? [...prev.slice(prev.length - RECENT_EVENT_LIMIT + 1), event]
        : [...prev, event];
      return next;
    });
  });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(
    () => buildRows(discovery, events, now),
    [discovery, events, now],
  );

  const sources = useMemo(
    () => [...new Set(rows.map((row) => row.source))].sort(),
    [rows],
  );

  const filtered = useMemo(
    () => rows.filter((row) =>
      (sourceFilter === "all" || row.source === sourceFilter)
      && matchesQuery(row, query.trim())
    ),
    [rows, sourceFilter, query],
  );

  useEffect(() => {
    if (selectedIdx >= filtered.length) {
      setSelectedIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIdx]);

  const openSelected = useCallback((row: RawSessionRow | undefined) => {
    if (!row) return;
    navigate({ view: "sessions", sessionId: row.refId });
  }, [navigate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inEditable = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target?.isContentEditable ?? false);

      if (event.key === "/" && !inEditable) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (inEditable) {
        if (event.key === "Escape" && target === searchRef.current) {
          setQuery("");
          searchRef.current?.blur();
        }
        return;
      }
      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        setSelectedIdx((idx) => filtered.length === 0 ? 0 : Math.min(filtered.length - 1, idx + 1));
        return;
      }
      if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        setSelectedIdx((idx) => Math.max(0, idx - 1));
        return;
      }
      if (event.key === "Enter" || event.key === "o") {
        event.preventDefault();
        openSelected(filtered[selectedIdx]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selectedIdx, openSelected]);

  const activeCount = rows.filter((row) => row.status === "run").length;
  const transcriptCount = discovery?.totals.transcripts ?? discovery?.transcripts?.length ?? 0;

  const { getColumnProps, getResizeHandleProps } = useResizableColumns<SessionColumnKey>({
    storageKey: "openscout.sessions.cols",
    columns: COLUMNS,
  });

  return (
    <div className="s-atop">
      <div className="s-atop-summary">
        <div className="s-atop-summary-cell">
          <div className="s-atop-summary-num">
            <strong>{rows.length}</strong>
            <span className="s-atop-summary-of">of {transcriptCount}</span>
          </div>
          <div className="s-atop-summary-lbl">raw sessions</div>
        </div>
        <div className="s-atop-summary-cell">
          <div className="s-atop-summary-num">
            <strong>{activeCount}</strong>
          </div>
          <div className="s-atop-summary-lbl">active</div>
        </div>
        <div className="s-atop-summary-cell s-atop-summary-cell--breakdown">
          <div className="s-atop-summary-row">
            {sources.length === 0 ? (
              <span className="s-atop-chip s-atop-chip--mute">no sources</span>
            ) : sources.map((source) => (
              <span
                key={source}
                className={`s-atop-chip s-atop-chip--harness s-atop-chip--harness-${classPart(source)}`}
              >
                {source}
              </span>
            ))}
          </div>
          <div className="s-atop-summary-lbl">sources</div>
        </div>
        <div className="s-atop-summary-cell s-atop-summary-cell--rate">
          <div className="s-atop-summary-num">
            <strong>{filtered.length}</strong>
          </div>
          <div className="s-atop-summary-lbl">visible</div>
        </div>
      </div>

      <div className="s-atop-fbar">
        <label className="s-atop-search">
          <span className="s-atop-search-prompt">/</span>
          <input
            ref={searchRef}
            className="s-atop-search-input"
            placeholder="filter sessions"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd className="s-atop-search-kbd">/</kbd>
        </label>
        <span className="s-atop-fbar-label">source</span>
        <button
          type="button"
          className={`s-atop-pill${sourceFilter === "all" ? " s-atop-pill--on" : ""}`}
          onClick={() => setSourceFilter("all")}
        >
          all
          <span className="s-atop-pill-ct">{rows.length}</span>
        </button>
        {sources.map((source) => (
          <button
            key={source}
            type="button"
            className={`s-atop-pill${sourceFilter === source ? " s-atop-pill--on" : ""}`}
            onClick={() => setSourceFilter(source)}
          >
            {source}
            <span className="s-atop-pill-ct">
              {rows.filter((row) => row.source === source).length}
            </span>
          </button>
        ))}
        <div className="s-atop-fbar-spacer" />
      </div>

      <div className="s-atop-table-wrap">
        <table className="s-atop-table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={col.cls}
                  {...getColumnProps(col.key)}
                >
                  {col.label}
                  <span {...getResizeHandleProps(col.key)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr className="s-atop-empty-row">
                <td colSpan={6}>
                  <div className="s-atop-empty">
                    <div className="s-atop-empty-title">Discovery failed</div>
                    <div>{error}</div>
                  </div>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr className="s-atop-empty-row">
                <td colSpan={6}>
                  <div className="s-atop-empty">
                    <div className="s-atop-empty-title">No raw sessions</div>
                    <div>{query ? "No sessions match the current filter." : "No transcript sessions were discovered."}</div>
                  </div>
                </td>
              </tr>
            ) : filtered.map((row, index) => (
              <tr
                key={`${row.source}:${row.transcriptPath}`}
                className={`s-atop-row${index === selectedIdx ? " s-atop-row--selected" : ""}`}
                tabIndex={0}
                onClick={() => openSelected(row)}
                onMouseEnter={() => setSelectedIdx(index)}
              >
                <td className="s-atop-col-status">
                  <span className={`s-atop-status s-atop-status--${row.status}`}>
                    <span className="s-atop-status-dot" aria-hidden="true" />
                    {row.statusLabel}
                  </span>
                </td>
                <td className="s-atop-col-agent" title={row.sessionId ?? row.refId}>
                  <div className="s-atop-agent-cell">
                    <span className={`s-atop-chip s-atop-chip--harness s-atop-chip--harness-${classPart(row.source)}`}>
                      {row.source}
                    </span>
                    <span className="s-atop-agent-id">{row.refId.slice(0, 8)}</span>
                  </div>
                </td>
                <td className="s-atop-col-project" title={row.cwd ?? row.project}>
                  {row.project}
                </td>
                <td className="s-atop-col-last" title={formatAbsolute(row.mtimeMs)}>
                  {formatRelative(Math.max(row.mtimeMs, row.lastEvent?.ts ?? 0), now)}
                </td>
                <td className="s-atop-col-runtime">{formatBytes(row.size)}</td>
                <td title={row.transcriptPath}>
                  {row.cwd ?? row.transcriptPath}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="s-atop-keys">
        <span><kbd>/</kbd>filter</span>
        <span><kbd>j/k</kbd>select</span>
        <span><kbd>enter</kbd>open</span>
        <span className="s-atop-keys-spacer" />
        <span className="s-atop-keys-count">
          <strong>{filtered.length}</strong> sessions
        </span>
      </div>
    </div>
  );
}
