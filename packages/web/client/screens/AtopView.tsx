/**
 * Atop — agent activity inventory.
 *
 * Sibling of TailView. Where Tail is a time-ordered firehose ("what just
 * happened?"), Atop is the agent-level view ("what is each agent actually
 * doing — how much it's spending, what tools, how many requests, how often
 * it's asking for permission").
 *
 * Row identity = one currently-running agent (today: a Claude process with
 * its active session). Columns surface agent-life metrics: requests, tokens,
 * cache hits, tool calls, permission requests, last activity. Process
 * details (pid, parent chain, command) are still useful — they sit in the
 * drawer behind the agent row.
 *
 * **Data contract — backend grow points:**
 * Some columns (Model, Tok↓, Tok↑, Cache%) render `—` until TailEvent grows
 * to carry: `model`, `usage.input_tokens`, `usage.output_tokens`,
 * `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`. When
 * those land on the event, populate them in `deriveRows` and the columns
 * light up automatically.
 *
 * Permission requests are currently heuristic (string-matching
 * "permission-mode" in summaries). When backend adds a dedicated
 * `permission` event kind, swap the heuristic for an exact count.
 */

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
  TailDiscoverySnapshot,
  TailDiscoveredProcess,
  TailEvent,
  TailHarness,
} from "../lib/types.ts";

/* ── Tunables ── */

const EVENT_BUFFER_LIMIT = 4_000;
const RECENT_REPLAY_LIMIT = 500;
const DISCOVERY_INTERVAL_MS = 5_000;
const ACTIVE_WINDOW_MS = 5_000;
const REQ_RATE_WINDOW_MS = 60_000;
const SUMMARY_SAMPLE_BARS = 24;
const PEEK_LINE_LIMIT = 40;

/* ── Derived view-model ── */

type AtopStatus = "tool" | "run" | "idle";

type AtopRow = {
  /* identity — process + session combined */
  pid: number;
  ppid: number;
  sessionId: string | null;
  harness: TailHarness;
  project: string;
  cwd: string;
  command: string;
  parentLabel: string;

  /* lifetime */
  procRuntimeSec: number;       // process etime from `ps`
  procEtime: string;
  sessionStartAt: number | null; // first event seen for this pid in buffer
  sessionRuntimeSec: number;     // lastEventAt - sessionStartAt (capped at procRuntime)

  /* current state */
  status: AtopStatus;
  lastEventAt: number | null;
  lastEventKind: string | null;
  lastSummary: string | null;

  /* agent activity (real, derivable now) */
  reqCount: number;       // count of assistant events  → ≈ model invocations
  toolCount: number;      // count of tool-call events
  permCount: number;      // count of permission-mode events (heuristic)
  eventCount: number;

  /* agent activity (backend grow-points — rendered as `—` when null) */
  model: string | null;
  tokIn: number | null;
  tokOut: number | null;
  cacheReadIn: number | null;
  cacheWriteIn: number | null;
};

type AtopSummary = {
  total: number;
  running: number; // run | tool
  tooling: number; // tool only
  idle: number;
  scout: number;
  hudson: number;
  ghost: number;
  reqsPerMin: number;
};

const HARNESS_LABEL: Record<TailHarness, string> = {
  "scout-managed": "scout",
  "hudson-managed": "hudson",
  unattributed: "ghost",
};

const STATUS_LABEL: Record<AtopStatus, string> = {
  tool: "working",
  run: "active",
  idle: "idle",
};

/* ── Format helpers ── */

function commandBasename(command: string): string {
  const head = command.split(/\s+/)[0] ?? "";
  const slashIdx = head.lastIndexOf("/");
  return slashIdx >= 0 ? head.slice(slashIdx + 1) : head;
}

function shortCommand(command: string, max = 60): string {
  // Strip leading executable path; keep args trimmed.
  const tokens = command.split(/\s+/);
  if (tokens.length === 0) return command;
  tokens[0] = commandBasename(tokens[0]);
  const flat = tokens.join(" ");
  return flat.length <= max ? flat : flat.slice(0, max - 1) + "…";
}

function parentLabelFromChain(
  chain: { pid: number; command: string }[],
): string {
  for (const ancestor of chain) {
    const base = commandBasename(ancestor.command);
    if (!base) continue;
    if (base === "sh" || base === "zsh" || base === "bash" || base === "login") continue;
    return base;
  }
  return chain[0]?.command ? commandBasename(chain[0].command) : "—";
}

function parseEtimeSeconds(etime: string): number {
  // ps etime forms: SS, MM:SS, HH:MM:SS, DD-HH:MM:SS
  const m = etime.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) {
    const justSec = etime.match(/^(\d+)$/);
    if (justSec) return Number.parseInt(justSec[1], 10);
    return 0;
  }
  const [, dd, hh, mm, ss] = m;
  let total = Number.parseInt(ss, 10) + Number.parseInt(mm, 10) * 60;
  if (hh) total += Number.parseInt(hh, 10) * 3600;
  if (dd) total += Number.parseInt(dd, 10) * 86400;
  return total;
}

function formatRuntime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}`;
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}h${String(m).padStart(2, "0")}`;
  }
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return `${d}d${String(h).padStart(2, "0")}h`;
}

function formatRelative(ms: number | null, now: number): string {
  if (ms == null) return "—";
  const delta = Math.max(0, Math.round((now - ms) / 1000));
  if (delta < 2) return "just now";
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3600)}h ago`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function shortSession(sessionId: string | null): string {
  if (!sessionId) return "—";
  return sessionId.slice(0, 8);
}

/* ── Derive ──
 *
 * One row per currently-running agent (process). Per-pid stats are folded out
 * of the event buffer in a single pass so cost is O(events) per render.
 *
 * To unlock the placeholder columns (Model, Tok↓, Tok↑, Cache%) once the
 * backend extends `TailEvent`:
 *   - `model`: take from the latest event that carries it (assistant events).
 *   - `tokIn` / `tokOut`: sum `usage.input_tokens` and `usage.output_tokens`
 *     across all assistant events for the pid.
 *   - `cacheReadIn` / `cacheWriteIn`: sum `usage.cache_read_input_tokens` and
 *     `usage.cache_creation_input_tokens` similarly. Cache hit rate is a
 *     render-time derivation: cacheReadIn / (cacheReadIn + tokIn).
 */

const PERMISSION_HINT = /permission-mode/i;

type EventStats = {
  firstEventAt: number;
  lastEventAt: number;
  lastKind: string;
  lastSummary: string;
  reqCount: number;
  toolCount: number;
  permCount: number;
  eventCount: number;
  sessionId: string | null;
  model: string | null;
  tokIn: number | null;
  tokOut: number | null;
  cacheReadIn: number | null;
  cacheWriteIn: number | null;
};

function isPermissionEvent(event: TailEvent): boolean {
  if (event.kind !== "system") return false;
  return PERMISSION_HINT.test(event.summary);
}

function isRequestEvent(event: TailEvent): boolean {
  // One assistant turn ≈ one model invocation ≈ one billable request.
  return event.kind === "assistant";
}

function deriveRows(
  discovery: TailDiscoverySnapshot | null,
  events: TailEvent[],
  now: number,
): AtopRow[] {
  if (!discovery) return [];

  const byPid = new Map<number, EventStats>();
  for (const event of events) {
    let stats = byPid.get(event.pid);
    if (!stats) {
      stats = {
        firstEventAt: event.ts,
        lastEventAt: event.ts,
        lastKind: event.kind,
        lastSummary: event.summary,
        reqCount: 0,
        toolCount: 0,
        permCount: 0,
        eventCount: 0,
        sessionId: event.sessionId || null,
        model: null,
        tokIn: null,
        tokOut: null,
        cacheReadIn: null,
        cacheWriteIn: null,
      };
      byPid.set(event.pid, stats);
    }
    if (event.ts < stats.firstEventAt) stats.firstEventAt = event.ts;
    if (event.ts >= stats.lastEventAt) {
      stats.lastEventAt = event.ts;
      stats.lastKind = event.kind;
      stats.lastSummary = event.summary;
    }
    stats.eventCount++;
    if (event.kind === "tool") stats.toolCount++;
    if (isRequestEvent(event)) stats.reqCount++;
    if (isPermissionEvent(event)) stats.permCount++;
    if (event.sessionId && !stats.sessionId) stats.sessionId = event.sessionId;
  }

  return discovery.processes.map((proc): AtopRow => {
    const stats = byPid.get(proc.pid);
    let status: AtopStatus = "idle";
    if (stats) {
      const fresh = now - stats.lastEventAt < ACTIVE_WINDOW_MS;
      if (fresh) status = stats.lastKind === "tool" ? "tool" : "run";
    }
    const procRuntimeSec = parseEtimeSeconds(proc.etime);
    const sessionStartAt = stats?.firstEventAt ?? null;
    const sessionRuntimeSec = stats && stats.firstEventAt < stats.lastEventAt
      ? Math.min(
          Math.max(0, Math.round((stats.lastEventAt - stats.firstEventAt) / 1000)),
          procRuntimeSec || Number.POSITIVE_INFINITY,
        )
      : 0;
    return {
      pid: proc.pid,
      ppid: proc.ppid,
      sessionId: stats?.sessionId ?? null,
      harness: proc.harness,
      project: proc.cwd ? basename(proc.cwd) : "(unknown)",
      cwd: proc.cwd ?? "",
      command: proc.command,
      parentLabel: parentLabelFromChain(proc.parentChain ?? []),
      procRuntimeSec,
      procEtime: proc.etime,
      sessionStartAt,
      sessionRuntimeSec,
      status,
      lastEventAt: stats?.lastEventAt ?? null,
      lastEventKind: stats?.lastKind ?? null,
      lastSummary: stats?.lastSummary ?? null,
      reqCount: stats?.reqCount ?? 0,
      toolCount: stats?.toolCount ?? 0,
      permCount: stats?.permCount ?? 0,
      eventCount: stats?.eventCount ?? 0,
      model: stats?.model ?? null,
      tokIn: stats?.tokIn ?? null,
      tokOut: stats?.tokOut ?? null,
      cacheReadIn: stats?.cacheReadIn ?? null,
      cacheWriteIn: stats?.cacheWriteIn ?? null,
    };
  });
}

function cacheHitRate(row: AtopRow): number | null {
  // cache_read / (cache_read + input). Returns null until backend feeds
  // both numerators in.
  if (row.cacheReadIn == null || row.tokIn == null) return null;
  const denom = row.cacheReadIn + row.tokIn;
  if (denom === 0) return null;
  return row.cacheReadIn / denom;
}

function fmtCount(n: number | null): string {
  if (n == null) return "—";
  if (n === 0) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  return String(n);
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

function basename(p: string): string {
  if (!p) return "";
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function summarize(rows: AtopRow[], events: TailEvent[], now: number): AtopSummary {
  const cutoff = now - REQ_RATE_WINDOW_MS;
  let reqEvents = 0;
  for (const event of events) {
    if (!isRequestEvent(event)) continue;
    if (event.ts >= cutoff) reqEvents++;
  }
  const summary: AtopSummary = {
    total: rows.length,
    running: 0,
    tooling: 0,
    idle: 0,
    scout: 0,
    hudson: 0,
    ghost: 0,
    reqsPerMin: reqEvents,
  };
  for (const row of rows) {
    if (row.status === "tool") {
      summary.tooling++;
      summary.running++;
    } else if (row.status === "run") {
      summary.running++;
    } else {
      summary.idle++;
    }
    if (row.harness === "scout-managed") summary.scout++;
    else if (row.harness === "hudson-managed") summary.hudson++;
    else summary.ghost++;
  }
  return summary;
}

/* ── Sorting ── */

type SortKey =
  | "status"
  | "agent"
  | "project"
  | "reqs"
  | "tokIn"
  | "tokOut"
  | "cache"
  | "tools"
  | "perms"
  | "last"
  | "runtime";

const STATUS_RANK: Record<AtopStatus, number> = { tool: 0, run: 1, idle: 2 };

function nullishNum(n: number | null | undefined): number {
  return n == null ? -1 : n;
}

function compare(a: AtopRow, b: AtopRow, key: SortKey, dir: 1 | -1): number {
  switch (key) {
    case "status":
      return (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * dir;
    case "agent": {
      // Use harness then short session for stable ordering.
      const ha = a.harness.localeCompare(b.harness);
      if (ha !== 0) return ha * dir;
      return (a.sessionId ?? "").localeCompare(b.sessionId ?? "") * dir;
    }
    case "project":
      return a.project.localeCompare(b.project) * dir;
    case "reqs":
      return (a.reqCount - b.reqCount) * dir;
    case "tokIn":
      return (nullishNum(a.tokIn) - nullishNum(b.tokIn)) * dir;
    case "tokOut":
      return (nullishNum(a.tokOut) - nullishNum(b.tokOut)) * dir;
    case "cache":
      return (nullishNum(cacheHitRate(a)) - nullishNum(cacheHitRate(b))) * dir;
    case "tools":
      return (a.toolCount - b.toolCount) * dir;
    case "perms":
      return (a.permCount - b.permCount) * dir;
    case "last": {
      const av = a.lastEventAt ?? 0;
      const bv = b.lastEventAt ?? 0;
      return (av - bv) * dir;
    }
    case "runtime":
      return (a.sessionRuntimeSec - b.sessionRuntimeSec) * dir;
  }
}

/* ── Sparkline ── */

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 88;
  const h = 18;
  if (values.length < 2) {
    return <svg className="s-atop-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} />;
  }
  const max = Math.max(1, ...values);
  const dx = w / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * dx).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="s-atop-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline fill="none" stroke={color} strokeWidth="1.25" points={pts} />
    </svg>
  );
}

/* ── Main view ── */

export function AtopView() {
  const [events, setEvents] = useState<TailEvent[]>([]);
  const [discovery, setDiscovery] = useState<TailDiscoverySnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [search, setSearch] = useState("");
  const [harnessFilter, setHarnessFilter] = useState<Set<TailHarness>>(() => new Set());
  const [statusFilter, setStatusFilter] = useState<Set<AtopStatus>>(() => new Set());
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);

  const runHistoryRef = useRef<number[]>([]);
  const toolHistoryRef = useRef<number[]>([]);
  const [runHistory, setRunHistory] = useState<number[]>([]);
  const [toolHistory, setToolHistory] = useState<number[]>([]);

  /* event ingestion */
  const handleEvent = useCallback((event: TailEvent) => {
    setEvents((prev) => {
      const next = prev.length >= EVENT_BUFFER_LIMIT
        ? [...prev.slice(prev.length - EVENT_BUFFER_LIMIT + 1), event]
        : [...prev, event];
      return next;
    });
  }, []);
  useTailEvents(handleEvent);

  /* initial replay */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api<{ events: TailEvent[] }>(
          `/api/tail/recent?limit=${RECENT_REPLAY_LIMIT}`,
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

  /* polled discovery */
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
    const id = setInterval(() => void loadDiscovery(), DISCOVERY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadDiscovery]);

  /* clock ticker so "12s ago" stays fresh */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  /* derive */
  const rows = useMemo(
    () => deriveRows(discovery, events, now),
    [discovery, events, now],
  );
  const summary = useMemo(() => summarize(rows, events, now), [rows, events, now]);

  /* sample summary into sparklines */
  useEffect(() => {
    runHistoryRef.current = [...runHistoryRef.current, summary.running].slice(-SUMMARY_SAMPLE_BARS);
    toolHistoryRef.current = [...toolHistoryRef.current, summary.tooling].slice(-SUMMARY_SAMPLE_BARS);
    setRunHistory(runHistoryRef.current);
    setToolHistory(toolHistoryRef.current);
  }, [summary.running, summary.tooling]);

  /* available filter options (only show pills for axes that have variety) */
  const harnessOptions = useMemo(() => {
    const set = new Set<TailHarness>();
    rows.forEach((row) => set.add(row.harness));
    return [...set];
  }, [rows]);

  const statusOptions = useMemo(() => {
    const set = new Set<AtopStatus>();
    rows.forEach((row) => set.add(row.status));
    return [...set];
  }, [rows]);

  /* filter + sort */
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (harnessFilter.size > 0 && !harnessFilter.has(row.harness)) return false;
      if (statusFilter.size > 0 && !statusFilter.has(row.status)) return false;
      if (!q) return true;
      const hay = `${row.pid} ${row.project} ${row.command} ${row.harness} ${row.sessionId ?? ""} ${row.lastSummary ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
    return filtered.slice().sort((a, b) => {
      // Always promote tool/run above idle even when sort key isn't status,
      // so the busy agents stay visible during e.g. project sort.
      const sr = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (sr !== 0 && sortKey !== "status") return sr;
      return compare(a, b, sortKey, sortDir);
    });
  }, [rows, search, harnessFilter, statusFilter, sortKey, sortDir]);

  /* keep selected pid valid */
  useEffect(() => {
    if (selectedPid == null) return;
    if (!rows.some((row) => row.pid === selectedPid)) {
      setSelectedPid(null);
    }
  }, [rows, selectedPid]);

  /* keyboard nav */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inEditable = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target?.isContentEditable ?? false);
      if (event.key === "Escape" && selectedPid != null) {
        event.preventDefault();
        setSelectedPid(null);
        return;
      }
      if (inEditable) return;
      if (event.key === "j" || event.key === "k") {
        if (filteredRows.length === 0) return;
        event.preventDefault();
        const idx = filteredRows.findIndex((row) => row.pid === selectedPid);
        const next = event.key === "j"
          ? filteredRows[Math.min(filteredRows.length - 1, idx < 0 ? 0 : idx + 1)]
          : filteredRows[Math.max(0, idx < 0 ? 0 : idx - 1)];
        if (next) setSelectedPid(next.pid);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filteredRows, selectedPid]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      // string-ordered axes ascend by default; numeric axes descend (most-of-X first)
      setSortDir(key === "project" || key === "agent" ? 1 : -1);
    }
  };

  const toggleHarness = (harness: TailHarness) => {
    setHarnessFilter((prev) => {
      const next = new Set(prev);
      if (next.has(harness)) next.delete(harness);
      else next.add(harness);
      return next;
    });
  };
  const toggleStatus = (status: AtopStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const selectedRow = useMemo(
    () => (selectedPid != null ? rows.find((row) => row.pid === selectedPid) ?? null : null),
    [rows, selectedPid],
  );
  const selectedProcess = useMemo(
    () => (selectedPid != null
      ? discovery?.processes.find((p) => p.pid === selectedPid) ?? null
      : null),
    [discovery, selectedPid],
  );
  const selectedEvents = useMemo(() => {
    if (selectedPid == null) return [];
    return events.filter((event) => event.pid === selectedPid).slice(-PEEK_LINE_LIMIT);
  }, [events, selectedPid]);

  return (
    <div className="s-atop">
      <SummaryStrip summary={summary} runHistory={runHistory} toolHistory={toolHistory} />

      <FilterBar
        search={search}
        onSearch={setSearch}
        harnessOptions={harnessOptions}
        harnessFilter={harnessFilter}
        onToggleHarness={toggleHarness}
        statusOptions={statusOptions}
        statusFilter={statusFilter}
        onToggleStatus={toggleStatus}
        summary={summary}
      />

      <AgentTable
        rows={filteredRows}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={toggleSort}
        selectedPid={selectedPid}
        onSelect={setSelectedPid}
        now={now}
      />

      <KeyHints
        shown={filteredRows.length}
        total={rows.length}
        hasSelection={selectedPid != null}
      />

      {selectedRow && (
        <DetailDrawer
          row={selectedRow}
          process={selectedProcess}
          events={selectedEvents}
          now={now}
          onClose={() => setSelectedPid(null)}
        />
      )}
    </div>
  );
}

/* ── Sub-components ── */

function SummaryStrip({
  summary,
  runHistory,
  toolHistory,
}: {
  summary: AtopSummary;
  runHistory: number[];
  toolHistory: number[];
}) {
  return (
    <div className="s-atop-summary">
      <div className="s-atop-summary-cell s-atop-summary-cell--primary">
        <div className="s-atop-summary-num">
          <strong>{summary.running}</strong>
          <span className="s-atop-summary-of">/ {summary.total}</span>
        </div>
        <span className="s-atop-summary-lbl">active</span>
        <Sparkline values={runHistory} color="var(--green)" />
      </div>
      <div className="s-atop-summary-cell">
        <div className="s-atop-summary-num">
          <strong>{summary.tooling}</strong>
        </div>
        <span className="s-atop-summary-lbl">working</span>
        <Sparkline values={toolHistory} color="var(--accent)" />
      </div>
      <div className="s-atop-summary-cell">
        <div className="s-atop-summary-num">
          <strong>{summary.idle}</strong>
        </div>
        <span className="s-atop-summary-lbl">idle</span>
      </div>
      <div className="s-atop-summary-cell s-atop-summary-cell--breakdown">
        <span className="s-atop-summary-lbl">harness</span>
        <div className="s-atop-summary-row">
          <span className="s-atop-chip s-atop-chip--scout">scout {summary.scout}</span>
          <span className="s-atop-chip s-atop-chip--hudson">hudson {summary.hudson}</span>
          <span className={`s-atop-chip s-atop-chip--ghost${summary.ghost > 0 ? "" : " s-atop-chip--mute"}`}>
            ghost {summary.ghost}
          </span>
        </div>
      </div>
      <div className="s-atop-summary-spacer" />
      <div className="s-atop-summary-cell s-atop-summary-cell--rate">
        <div className="s-atop-summary-num">
          <strong>{summary.reqsPerMin}</strong>
          <span className="s-atop-summary-of">/ min</span>
        </div>
        <span className="s-atop-summary-lbl">requests</span>
      </div>
    </div>
  );
}

function FilterBar({
  search,
  onSearch,
  harnessOptions,
  harnessFilter,
  onToggleHarness,
  statusOptions,
  statusFilter,
  onToggleStatus,
  summary,
}: {
  search: string;
  onSearch: (v: string) => void;
  harnessOptions: TailHarness[];
  harnessFilter: Set<TailHarness>;
  onToggleHarness: (h: TailHarness) => void;
  statusOptions: AtopStatus[];
  statusFilter: Set<AtopStatus>;
  onToggleStatus: (s: AtopStatus) => void;
  summary: AtopSummary;
}) {
  const harnessCount = (harness: TailHarness): number => {
    if (harness === "scout-managed") return summary.scout;
    if (harness === "hudson-managed") return summary.hudson;
    return summary.ghost;
  };
  const statusCount = (status: AtopStatus): number => {
    if (status === "tool") return summary.tooling;
    if (status === "run") return summary.running - summary.tooling;
    return summary.idle;
  };
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      const target = event.target as HTMLElement | null;
      const inEditable = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target?.isContentEditable ?? false);
      if (inEditable) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="s-atop-fbar">
      <div className="s-atop-search">
        <span className="s-atop-search-prompt">▸</span>
        <input
          ref={inputRef}
          className="s-atop-search-input"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="filter by pid · project · command · summary"
          spellCheck={false}
        />
        <span className="s-atop-search-kbd">/</span>
      </div>

      {harnessOptions.length > 1 && (
        <>
          <span className="s-atop-fbar-label">harness</span>
          {harnessOptions.map((harness) => {
            const on = harnessFilter.has(harness);
            return (
              <button
                key={harness}
                className={`s-atop-pill s-atop-pill--${harness}${on ? " s-atop-pill--on" : ""}`}
                onClick={() => onToggleHarness(harness)}
              >
                {HARNESS_LABEL[harness]}
                <span className="s-atop-pill-ct">{harnessCount(harness)}</span>
              </button>
            );
          })}
        </>
      )}

      {statusOptions.length > 1 && (
        <>
          <span className="s-atop-fbar-label">status</span>
          {(["tool", "run", "idle"] as AtopStatus[])
            .filter((s) => statusOptions.includes(s))
            .map((status) => {
              const on = statusFilter.has(status);
              return (
                <button
                  key={status}
                  className={`s-atop-pill s-atop-pill--status-${status}${on ? " s-atop-pill--on" : ""}`}
                  onClick={() => onToggleStatus(status)}
                >
                  {STATUS_LABEL[status]}
                  <span className="s-atop-pill-ct">{statusCount(status)}</span>
                </button>
              );
            })}
        </>
      )}

      <div className="s-atop-fbar-spacer" />
    </div>
  );
}

const COLUMNS: {
  key: SortKey;
  label: string;
  cls?: string;
  tip?: string;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
}[] = [
  { key: "status", label: "Status", cls: "s-atop-col-status", defaultWidth: 96, minWidth: 70 },
  { key: "agent", label: "Agent", cls: "s-atop-col-agent",
    tip: "Harness · short session id", defaultWidth: 168, minWidth: 110 },
  { key: "project", label: "Project", cls: "s-atop-col-project", defaultWidth: 200, minWidth: 96, maxWidth: 480 },
  { key: "reqs", label: "Reqs", cls: "s-atop-col-num",
    tip: "Model invocations (assistant turns) for this session", defaultWidth: 64, minWidth: 56 },
  { key: "tokIn", label: "Tok ↓", cls: "s-atop-col-num",
    tip: "Input tokens — populated when backend emits usage", defaultWidth: 64, minWidth: 56 },
  { key: "tokOut", label: "Tok ↑", cls: "s-atop-col-num",
    tip: "Output tokens — populated when backend emits usage", defaultWidth: 64, minWidth: 56 },
  { key: "cache", label: "Cache", cls: "s-atop-col-num",
    tip: "Cache hit rate — populated when backend emits usage", defaultWidth: 64, minWidth: 56 },
  { key: "tools", label: "Tools", cls: "s-atop-col-num", defaultWidth: 64, minWidth: 56 },
  { key: "perms", label: "Perms", cls: "s-atop-col-num",
    tip: "Permission requests — heuristic count of permission-mode events", defaultWidth: 64, minWidth: 56 },
  { key: "last", label: "Last", cls: "s-atop-col-last", defaultWidth: 86, minWidth: 64 },
  { key: "runtime", label: "Runtime", cls: "s-atop-col-runtime",
    tip: "Session duration (active period in current buffer)", defaultWidth: 80, minWidth: 64 },
];

function Cell({
  value,
  accent,
}: {
  value: number | null;
  accent?: "amber" | "green";
}) {
  const cls = value == null
    ? "s-atop-col-num s-atop-col-num--dim"
    : `s-atop-col-num${accent ? ` s-atop-col-num--${accent}` : ""}`;
  return <td className={cls}>{fmtCount(value)}</td>;
}

function CellPct({ value }: { value: number | null }) {
  const cls = value == null
    ? "s-atop-col-num s-atop-col-num--dim"
    : "s-atop-col-num";
  return <td className={cls}>{fmtPct(value)}</td>;
}

function AgentTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  selectedPid,
  onSelect,
  now,
}: {
  rows: AtopRow[];
  sortKey: SortKey;
  sortDir: 1 | -1;
  onSort: (key: SortKey) => void;
  selectedPid: number | null;
  onSelect: (pid: number) => void;
  now: number;
}) {
  const { getColumnProps, getResizeHandleProps } = useResizableColumns<SortKey>({
    storageKey: "openscout.atop.cols",
    columns: COLUMNS,
  });

  return (
    <div className="s-atop-table-wrap">
      <table className="s-atop-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={`${col.cls ?? ""}${sortKey === col.key ? " s-atop-th--sorted" : ""}`}
                onClick={() => onSort(col.key)}
                title={col.tip}
                {...getColumnProps(col.key)}
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="s-atop-th-arrow">{sortDir === 1 ? "↑" : "↓"}</span>
                )}
                <span {...getResizeHandleProps(col.key)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="s-atop-empty-row">
              <td colSpan={COLUMNS.length}>
                <div className="s-atop-empty">
                  <span className="s-atop-empty-title">no agents match</span>
                  <span>adjust filters or start a session to populate</span>
                </div>
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.pid}
                className={`s-atop-row${selectedPid === row.pid ? " s-atop-row--selected" : ""}`}
                onClick={() => onSelect(row.pid)}
              >
                <td className="s-atop-col-status">
                  <span className={`s-atop-status s-atop-status--${row.status}`}>
                    <span className="s-atop-status-dot" />
                    {STATUS_LABEL[row.status]}
                  </span>
                </td>
                <td className="s-atop-col-agent">
                  <span className={`s-atop-chip s-atop-chip--${row.harness}`}>
                    {HARNESS_LABEL[row.harness]}
                  </span>
                  <span className="s-atop-agent-id" title={row.sessionId ?? `pid ${row.pid}`}>
                    {shortSession(row.sessionId)}
                  </span>
                </td>
                <td className="s-atop-col-project" title={row.cwd}>{row.project}</td>
                <Cell value={row.reqCount || null} />
                <Cell value={row.tokIn} />
                <Cell value={row.tokOut} />
                <CellPct value={cacheHitRate(row)} />
                <Cell value={row.toolCount || null} />
                <Cell value={row.permCount || null} accent={row.permCount > 0 ? "amber" : undefined} />
                <td className="s-atop-col-last">{formatRelative(row.lastEventAt, now)}</td>
                <td className="s-atop-col-runtime">{formatRuntime(row.sessionRuntimeSec)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function KeyHints({
  shown,
  total,
  hasSelection,
}: {
  shown: number;
  total: number;
  hasSelection: boolean;
}) {
  return (
    <div className="s-atop-keys">
      <span className="s-atop-keys-count">
        <strong>{shown}</strong> / {total} agents
      </span>
      <span className="s-atop-keys-spacer" />
      <span><kbd>/</kbd> filter</span>
      <span><kbd>j</kbd>/<kbd>k</kbd> select</span>
      <span><kbd>click</kbd> drill in</span>
      {hasSelection && <span><kbd>esc</kbd> close</span>}
    </div>
  );
}

function DetailDrawer({
  row,
  process,
  events,
  now,
  onClose,
}: {
  row: AtopRow;
  process: TailDiscoveredProcess | null;
  events: TailEvent[];
  now: number;
  onClose: () => void;
}) {
  const toolHistogram = useMemo(() => {
    const hist: Record<string, number> = {};
    for (const event of events) {
      if (event.kind !== "tool") continue;
      const match = event.summary.match(/^([a-z_][a-z0-9_]*)/i);
      const name = match ? match[1] : "(tool)";
      hist[name] = (hist[name] ?? 0) + 1;
    }
    const entries = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = Math.max(1, ...entries.map((e) => e[1]));
    return entries.map(([name, count]) => ({ name, count, frac: count / max }));
  }, [events]);

  const peekEvents = events.slice(-PEEK_LINE_LIMIT).reverse();

  return (
    <>
      <div className="s-atop-drawer-bg" onClick={onClose} />
      <aside className="s-atop-drawer" role="dialog" aria-label={`Agent ${row.pid}`}>
        <header className="s-atop-drawer-head">
          <div className="s-atop-drawer-head-meta">
            <span className={`s-atop-status s-atop-status--${row.status}`}>
              <span className="s-atop-status-dot" />
              {STATUS_LABEL[row.status]}
            </span>
            <span className="s-atop-drawer-pid">pid {row.pid}</span>
            <span className={`s-atop-chip s-atop-chip--${row.harness}`}>
              {HARNESS_LABEL[row.harness]}
            </span>
            <span className="s-atop-drawer-session">session {shortSession(row.sessionId)}</span>
          </div>
          <h2 className="s-atop-drawer-title">{row.project}</h2>
          <p className="s-atop-drawer-sub">
            session {shortSession(row.sessionId)} · runtime {formatRuntime(row.sessionRuntimeSec)}
            {" · last activity "}{formatRelative(row.lastEventAt, now)}
          </p>
          <button className="s-atop-drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="s-atop-drawer-body">
          <section>
            <h3 className="s-atop-drawer-h3">Activity</h3>
            <div className="s-atop-metrics">
              <Metric label="Requests" value={fmtCount(row.reqCount || null)} />
              <Metric label="Tools" value={fmtCount(row.toolCount || null)} />
              <Metric
                label="Permissions"
                value={fmtCount(row.permCount || null)}
                accent={row.permCount > 0 ? "amber" : undefined}
              />
              <Metric label="Tok in" value={fmtCount(row.tokIn)} dim={row.tokIn == null} />
              <Metric label="Tok out" value={fmtCount(row.tokOut)} dim={row.tokOut == null} />
              <Metric
                label="Cache hit"
                value={fmtPct(cacheHitRate(row))}
                dim={cacheHitRate(row) == null}
              />
              <Metric label="Model" value={row.model ?? "—"} dim={row.model == null} />
              <Metric label="Events" value={fmtCount(row.eventCount || null)} />
            </div>
          </section>

          {toolHistogram.length > 0 && (
            <section>
              <h3 className="s-atop-drawer-h3">Tool calls</h3>
              <ul className="s-atop-histo">
                {toolHistogram.map((tool) => (
                  <li key={tool.name}>
                    <span className="s-atop-histo-name">{tool.name}</span>
                    <span className="s-atop-histo-bar">
                      <span
                        className="s-atop-histo-fill"
                        style={{ width: `${(tool.frac * 100).toFixed(1)}%` }}
                      />
                    </span>
                    <span className="s-atop-histo-count">{tool.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="s-atop-drawer-h3">
              Recent activity
              <span className="s-atop-drawer-h3-aside">{events.length} buffered</span>
            </h3>
            {peekEvents.length === 0 ? (
              <div className="s-atop-peek-empty">no events buffered for this agent yet</div>
            ) : (
              <ol className="s-atop-peek">
                {peekEvents.map((event) => (
                  <li key={event.id} className={`s-atop-peek-row s-atop-peek-row--${event.kind}`}>
                    <span className="s-atop-peek-time">{formatTimestamp(event.ts)}</span>
                    <span className="s-atop-peek-kind">{event.kind}</span>
                    <span className="s-atop-peek-text">{event.summary}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="s-atop-drawer-section--secondary">
            <h3 className="s-atop-drawer-h3">Process</h3>
            <code className="s-atop-codeblock">{row.command}</code>
            <dl className="s-atop-kvs">
              <dt>PID</dt>
              <dd>{row.pid}</dd>
              <dt>Parent</dt>
              <dd>{row.parentLabel} (ppid {row.ppid})</dd>
              <dt>Process etime</dt>
              <dd>{row.procEtime}</dd>
              <dt>CWD</dt>
              <dd>{row.cwd || "(none)"}</dd>
            </dl>
            {process?.parentChain && process.parentChain.length > 0 && (
              <ol className="s-atop-chain">
                {process.parentChain.map((p) => (
                  <li key={p.pid}>
                    <span className="s-atop-chain-pid">{p.pid}</span>
                    <span className="s-atop-chain-cmd">{shortCommand(p.command, 80)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}

function Metric({
  label,
  value,
  dim,
  accent,
}: {
  label: string;
  value: string;
  dim?: boolean;
  accent?: "amber" | "green";
}) {
  const cls = `s-atop-metric${dim ? " s-atop-metric--dim" : ""}${accent ? ` s-atop-metric--${accent}` : ""}`;
  return (
    <div className={cls}>
      <span className="s-atop-metric-lbl">{label}</span>
      <span className="s-atop-metric-val">{value}</span>
    </div>
  );
}
