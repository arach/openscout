import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type {
  ObserveData,
  ObserveEvent,
  ObserveFile,
  ObserveMetadata,
  ObserveSessionMeta,
  ObserveUsageMeta,
  SessionCatalogWithResume,
} from "../lib/types.ts";
import { api } from "../lib/api.ts";
import { MessageMarkup } from "../lib/message-markup.tsx";
import { queueTakeover } from "../lib/terminal-takeover.ts";
import { useScout } from "../scout/Provider.tsx";
import { ObservedTopologyPanel } from "../components/ObservedTopologyPanel.tsx";

import "./session-observe.css";

async function revealLocalPath(input: {
  path: string;
  basePath?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
}) {
  await api<{ ok: true; path: string }>("/api/local-path/reveal", {
    method: "POST",
    body: JSON.stringify({
      path: input.path,
      ...(input.basePath ? { basePath: input.basePath } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    }),
  });
}

export type SessionEvent = ObserveEvent;
export type SessionFile = ObserveFile;
export type SessionObserveData = ObserveData;

/* ── Constants ── */

const KIND_COLOR: Record<string, string> = {
  think: "var(--dim)",
  tool: "var(--accent)",
  ask: "var(--amber)",
  message: "var(--muted)",
  note: "var(--green)",
  system: "var(--dim)",
  boot: "var(--dim)",
};

const TOOL_GLYPH: Record<string, string> = {
  read: "◎",
  edit: "✎",
  bash: "$",
  grep: "⌕",
  write: "✎",
  think: "∿",
};

const LIVE_EDGE_WINDOW_SECONDS = 20;
const GROUPED_NUMBER_FORMAT = new Intl.NumberFormat("en-US");
const COMPACT_NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

type ObserveDetailTone = "default" | "accent" | "good" | "warn";
type ObserveDetailRow = {
  label: string;
  value: string;
  title?: string;
  tone?: ObserveDetailTone;
  wrap?: boolean;
  actionPath?: string;
  actionBasePath?: string | null;
};

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function isCursorAtLiveEdge(cursor: number, duration: number): boolean {
  return cursor >= Math.max(0, duration - LIVE_EDGE_WINDOW_SECONDS);
}

function fmtGroupedNumber(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return GROUPED_NUMBER_FORMAT.format(value);
}

function fmtCompactNumber(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  if (Math.abs(value) < 1_000) {
    return GROUPED_NUMBER_FORMAT.format(value);
  }

  return COMPACT_NUMBER_FORMAT.format(value).toLowerCase();
}

function fmtWindowSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0s";
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const wholeSeconds = Math.round(seconds);
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes >= 10 || remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

function hasObserveRows(value: ObserveMetadata | ObserveSessionMeta | ObserveUsageMeta | undefined): boolean {
  return !!value && Object.keys(value).length > 0;
}

function definedObserveRows(rows: Array<ObserveDetailRow | null | undefined>): ObserveDetailRow[] {
  return rows.filter((row): row is ObserveDetailRow => Boolean(row));
}

function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function revealPath(input: {
  path: string;
  basePath?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
}) {
  void revealLocalPath(input).catch((error) => {
    console.warn("Failed to reveal local path", error);
  });
}

/* ── Copy helper ── */

function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const value = text;
      const finish = () => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1100);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(value).then(finish).catch(() => {
          fallbackCopy(value);
          finish();
        });
      } else {
        fallbackCopy(value);
        finish();
      }
    },
    [text],
  );

  return (
    <button
      type="button"
      className={`s-observe-copy-btn${copied ? " s-observe-copy-btn--copied" : ""}${className ? ` ${className}` : ""}`}
      onClick={handleCopy}
      aria-label={label}
      title={copied ? "Copied" : label}
    >
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 5.5l2.4 2.4L9 3.4" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true">
          <rect x="3.4" y="3.4" width="6.1" height="6.1" rx="1.2" />
          <path d="M7.6 3.4V2.2a.8.8 0 0 0-.8-.8H2.2a.8.8 0 0 0-.8.8v4.6a.8.8 0 0 0 .8.8h1.2" />
        </svg>
      )}
    </button>
  );
}

function fallbackCopy(value: string): void {
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch (error) {
    console.warn("Clipboard copy failed", error);
  }
}

function buildToolCopyText(event: SessionEvent): string {
  const lines: string[] = [];
  const head = [event.tool, event.arg].filter(Boolean).join(" ");
  if (head) lines.push(head);
  if (event.result) {
    lines.push(
      Object.entries(event.result)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · "),
    );
  }
  if (event.diff) {
    lines.push(`+${event.diff.add}${event.diff.del > 0 ? ` -${event.diff.del}` : ""}`);
    if (event.diff.preview) lines.push(event.diff.preview);
  }
  if (event.stream && event.stream.length > 0) {
    lines.push(event.stream.join("\n"));
  }
  return lines.join("\n");
}

/* ── Event blocks ── */

function ThinkBlock({ event }: { event: SessionEvent }) {
  return (
    <div className="s-observe-block">
      <div className="s-observe-think-label">thinking</div>
      <div className="s-observe-think-text">
        <span className="s-observe-quoted">{event.text}</span>
        {event.live && <span className="s-observe-cursor" />}
      </div>
      <CopyButton text={event.text ?? ""} label="Copy thought" />
    </div>
  );
}

function ToolBlock({ event }: { event: SessionEvent }) {
  const glyph = TOOL_GLYPH[event.tool ?? ""] ?? "▸";
  const hasBody = !!(event.result || event.diff || event.stream);

  return (
    <div className="s-observe-tool s-observe-block">
      <div
        className={`s-observe-tool-header${hasBody ? " s-observe-tool-header--has-body" : ""}`}
      >
        <span className="s-observe-tool-glyph">{glyph}</span>
        <span className="s-observe-tool-cmd">
          <span className="s-observe-tool-cmd-name">{event.tool}</span>{" "}
          {event.arg}
        </span>
      </div>

      {event.result && (
        <div className="s-observe-tool-result">
          {Object.entries(event.result)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")}
        </div>
      )}

      {event.diff && (
        <div className="s-observe-tool-diff">
          <div className="s-observe-tool-diff-stats">
            <span className="s-observe-tool-diff-add">+{event.diff.add}</span>
            {event.diff.del > 0 && (
              <>
                {" "}
                <span className="s-observe-tool-diff-del">
                  −{event.diff.del}
                </span>
              </>
            )}
          </div>
          <pre className="s-observe-tool-diff-preview">
            {event.diff.preview}
          </pre>
        </div>
      )}

      {event.stream && (
        <pre className="s-observe-tool-stream">{event.stream.join("\n")}</pre>
      )}

      <CopyButton text={buildToolCopyText(event)} label="Copy tool call" />
    </div>
  );
}

function AskLine({ event }: { event: SessionEvent }) {
  const toLabel = event.to === "human" ? "you" : event.to ?? "?";
  const copyText = event.answer
    ? `${event.text}\n\n↳ ${event.to ?? "you"}: ${event.answer}`
    : event.text ?? "";
  return (
    <div className="s-observe-ask s-observe-block">
      <div className="s-observe-ask-label">↗ ask → {toLabel}</div>
      <div className="s-observe-ask-text">
        <span className="s-observe-quoted">{event.text}</span>
      </div>
      {event.answer && (
        <div className="s-observe-ask-answer">
          <span className="s-observe-ask-answer-meta">
            ↳ @{event.to ?? "you"} · +{(event.answerT ?? event.t) - event.t}s
          </span>
          <div className="s-observe-ask-answer-text">{event.answer}</div>
        </div>
      )}
      <CopyButton text={copyText} label="Copy ask" />
    </div>
  );
}

function MessageLine({ event }: { event: SessionEvent }) {
  const toLabel = event.to === "human" ? "you" : event.to ?? "?";
  return (
    <div className="s-observe-block">
      <div className="s-observe-message-label">→ message → {toLabel}</div>
      <div className="s-observe-message-text">
        <MessageMarkup text={event.text} />
      </div>
      <CopyButton text={event.text ?? ""} label="Copy message" />
    </div>
  );
}

function NoteLine({ event }: { event: SessionEvent }) {
  return (
    <div className="s-observe-note s-observe-block s-observe-block--inline">
      <span className="s-observe-note-icon">✓</span>
      <span className="s-observe-note-text">{event.text}</span>
      <CopyButton text={event.text ?? ""} label="Copy note" />
    </div>
  );
}

function SystemLine({ event }: { event: SessionEvent }) {
  const copyText = event.detail ? `${event.text}\n${event.detail}` : event.text ?? "";
  return (
    <div className="s-observe-system s-observe-block">
      <span className="s-observe-system-arrow">▸ </span>
      {event.text}
      {event.detail && (
        <div className="s-observe-system-detail">{event.detail}</div>
      )}
      <CopyButton text={copyText} label="Copy system event" />
    </div>
  );
}

function FollowToggle({
  isFollowing,
  isLive,
  onToggle,
}: {
  isFollowing: boolean;
  isLive: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={`s-observe-follow-btn${isFollowing ? " s-observe-follow-btn--on" : ""}`}
      onClick={onToggle}
      title={isFollowing ? "Pause auto-scroll" : "Jump to latest and follow"}
    >
      {isFollowing ? (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <rect x="1.5" y="1" width="3" height="8" rx="1" />
          <rect x="5.5" y="1" width="3" height="8" rx="1" />
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M2 1.5l7 3.5-7 3.5V1.5z" />
        </svg>
      )}
      <span>{isFollowing ? (isLive ? "Live" : "Following") : "Follow"}</span>
    </button>
  );
}

/* ── Stream row ── */

function StreamRow({
  event,
  prevT,
}: {
  event: SessionEvent;
  prevT: number;
}) {
  const gap = event.t - prevT;
  const accent = KIND_COLOR[event.kind] ?? "var(--dim)";

  return (
    <div className="s-observe-row">
      {gap > 15 && <div className="s-observe-row-gap">+{gap}s</div>}

      <div className="s-observe-row-time">{fmtClock(event.t)}</div>

      <span className="s-observe-row-bead" style={{ background: accent }} />

      {event.kind === "think" && <ThinkBlock event={event} />}
      {event.kind === "tool" && <ToolBlock event={event} />}
      {event.kind === "ask" && <AskLine event={event} />}
      {event.kind === "message" && <MessageLine event={event} />}
      {event.kind === "note" && <NoteLine event={event} />}
      {(event.kind === "system" || event.kind === "boot") && (
        <SystemLine event={event} />
      )}
    </div>
  );
}

/* ── Replay stream ── */

function ReplayStream({
  events,
  followEnd,
}: {
  events: SessionEvent[];
  followEnd: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const prevFollowEndRef = useRef(followEnd);

  useLayoutEffect(() => {
    if (!followEnd) {
      prevFollowEndRef.current = false;
      return;
    }
    const justEnabled = !prevFollowEndRef.current;
    prevFollowEndRef.current = true;
    endRef.current?.scrollIntoView({ behavior: justEnabled ? "instant" : "smooth" });
  }, [events.length, followEnd]);

  return (
    <div className="s-observe-stream">
      <div className="s-observe-spine" />
      {events.map((e, i) => (
        <StreamRow key={e.id} event={e} prevT={i > 0 ? events[i - 1].t : 0} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

/* ── Context meter sparkline ── */

function ContextMeter({
  data,
  cursor,
}: {
  data: number[];
  cursor: number;
}) {
  const W = 276;
  const H = 44;
  const N = data.length;
  if (N < 2) return null;
  const stepX = W / (N - 1);
  const path = data
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(1)} ${((1 - v) * H).toFixed(1)}`,
    )
    .join(" ");
  const curX = cursor * W;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: H, display: "block" }}
    >
      <defs>
        <linearGradient id="observeCtxFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${path} L ${W} ${H} L 0 ${H} Z`} fill="url(#observeCtxFill)" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.2} />
      <line
        x1={curX}
        y1={0}
        x2={curX}
        y2={H}
        stroke="var(--accent)"
        strokeWidth={1}
        opacity={0.6}
        strokeDasharray="2 3"
      />
    </svg>
  );
}

/* ── File glyph ── */

function FileGlyph({ state }: { state: string }) {
  const col =
    state === "created"
      ? "var(--green)"
      : state === "modified"
        ? "var(--accent)"
        : "var(--dim)";
  const g = state === "created" ? "+" : state === "modified" ? "~" : "◎";

  return (
    <span
      className="s-observe-file-glyph"
      style={{
        background: "color-mix(in srgb, var(--bg) 70%, black)",
        border: `1px solid color-mix(in srgb, ${col} 40%, var(--border))`,
        color: col,
      }}
    >
      {g}
    </span>
  );
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="s-observe-stat">
      <div className="s-observe-stat-label">{label}</div>
      <div className="s-observe-stat-value">{value}</div>
      {detail && <div className="s-observe-stat-detail">{detail}</div>}
    </div>
  );
}

function LocalPathLink({
  path,
  basePath,
  agentId,
  sessionId,
  className,
  children,
}: {
  path: string;
  basePath?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  className: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      title={`Reveal ${path}`}
      onClick={() => revealPath({ path, basePath, agentId, sessionId })}
    >
      {children}
    </button>
  );
}

function SourceFileLink({
  path,
  basePath,
  agentId,
  sessionId,
}: {
  path: string;
  basePath?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
}) {
  return (
    <div className="s-observe-source">
      <span className="s-observe-source-label">Source</span>
      <LocalPathLink
        path={path}
        basePath={basePath}
        agentId={agentId}
        sessionId={sessionId}
        className="s-observe-source-link"
      >
        {basename(path)}
      </LocalPathLink>
    </div>
  );
}

function DetailRows({
  rows,
  agentId,
  sessionId,
}: {
  rows: ObserveDetailRow[];
  agentId?: string | null;
  sessionId?: string | null;
}) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="s-observe-detail-list">
      {rows.map((row) => {
        const valueClassName = `s-observe-detail-value s-observe-detail-value--${row.tone ?? "default"}${row.wrap ? " s-observe-detail-value--wrap" : ""}`;
        return (
          <div key={row.label} className="s-observe-detail-row">
            <div className="s-observe-detail-label">{row.label}</div>
            <div className="s-observe-detail-value-wrap">
              {row.actionPath ? (
                <LocalPathLink
                  path={row.actionPath}
                  basePath={row.actionBasePath}
                  agentId={agentId}
                  sessionId={sessionId}
                  className={`${valueClassName} s-observe-detail-link`}
                >
                  {row.value}
                </LocalPathLink>
              ) : (
                <div
                  className={valueClassName}
                  title={row.title}
                >
                  {row.value}
                </div>
              )}
              <CopyButton
                text={row.actionPath ?? row.value}
                label={`Copy ${row.label.toLowerCase()}`}
                className="s-observe-copy-btn--inline"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Scrubber ── */

function Scrubber({
  events,
  duration,
  cursor,
  onCursor,
}: {
  events: SessionEvent[];
  duration: number;
  cursor: number;
  onCursor: (t: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = trackRef.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      onCursor(Math.max(0, Math.min(duration, (x / rect.width) * duration)));
    },
    [duration, onCursor],
  );

  return (
    <div className="s-observe-track-wrap">
      <div ref={trackRef} className="s-observe-track" onClick={onClick}>
        {events.map((e) => {
          const h = e.kind === "tool" ? 6 : e.kind === "think" ? 4 : 5;
          return (
            <span
              key={e.id}
              className="s-observe-track-tick"
              style={{
                left: `${(e.t / duration) * 100}%`,
                top: h === 6 ? -2 : -1,
                height: h,
                background: KIND_COLOR[e.kind] ?? "var(--dim)",
              }}
            />
          );
        })}
        <div
          className="s-observe-track-played"
          style={{ width: `${(cursor / duration) * 100}%` }}
        />
        <span
          className="s-observe-track-cursor"
          style={{ left: `${(cursor / duration) * 100}%` }}
        />
      </div>
    </div>
  );
}

/* ── Session header ── */

function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function fmtDuration(start: number, end: number): string {
  const diff = end - start;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  return `${Math.floor(diff / 3_600_000)}h ${Math.floor((diff % 3_600_000) / 60_000)}m`;
}

function SessionHeader({
  catalog,
  sessionId,
  agentId,
}: {
  catalog: SessionCatalogWithResume;
  sessionId: string | null;
  agentId?: string;
}) {
  const { navigate } = useScout();
  const [sent, setSent] = useState(false);
  const active = catalog.sessions.find((s) => s.id === catalog.activeSessionId);
  const past = catalog.sessions
    .filter((s) => s.id !== catalog.activeSessionId && s.endedAt)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, 5);

  const displayId = catalog.activeSessionId ?? sessionId;
  const shortId = displayId ? displayId.slice(0, 8) : null;

  const runTakeover = useCallback(() => {
    if (!catalog.resumeCommand) return;
    void queueTakeover({
      command: catalog.resumeCommand,
      cwd: catalog.resumeCwd,
      agentId,
    }).then(() => {
      navigate({ view: "terminal", agentId });
    });
    setSent(true);
  }, [catalog.resumeCommand, catalog.resumeCwd, navigate, agentId]);

  return (
    <div className="s-observe-session-header">
      <div className="s-observe-session-active">
        <div className="s-observe-session-row">
          {shortId && (
            <span className="s-observe-session-id" title={displayId ?? undefined}>
              {shortId}
            </span>
          )}
          {active && (
            <span className="s-observe-session-time">
              started {fmtRelative(active.startedAt)}
            </span>
          )}
          {catalog.resumeCommand && (
            <button
              className="s-observe-takeover-btn"
              onClick={runTakeover}
              title={catalog.resumeCommand}
            >
              {sent ? "Sent" : "Takeover"}
            </button>
          )}
        </div>
      </div>

      {past.length > 0 && (
        <div className="s-observe-session-history">
          <div className="s-observe-session-history-label">
            {catalog.sessions.length} session{catalog.sessions.length !== 1 ? "s" : ""} total
          </div>
          {past.map((s) => (
            <div key={s.id} className="s-observe-session-past">
              <span className="s-observe-session-id">{s.id.slice(0, 8)}</span>
              <span className="s-observe-session-time">
                {fmtRelative(s.startedAt)}
                {s.endedAt ? ` · ${fmtDuration(s.startedAt, s.endedAt)}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const EMPTY_OBSERVE_DATA: SessionObserveData = {
  events: [
    {
      id: "observe:empty",
      t: 0,
      kind: "system",
      text: "No session trace is available for this agent yet.",
      detail: "Waiting for a live session or readable history file.",
    },
  ],
  files: [],
  contextUsage: [],
  live: false,
};

/* ── Main component ── */

export function SessionObserve({
  data,
  agentId,
  sessionId,
  showRail = true,
}: {
  data?: SessionObserveData;
  agentId?: string;
  sessionId?: string | null;
  showRail?: boolean;
}) {
  const observeData = data ?? EMPTY_OBSERVE_DATA;
  const { events, files, contextUsage } = observeData;
  const liveSession = observeData.live === true;

  const [catalog, setCatalog] = useState<SessionCatalogWithResume | null>(null);
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    api<SessionCatalogWithResume>(`/api/agents/${encodeURIComponent(agentId)}/session-catalog`)
      .then((result) => { if (!cancelled) setCatalog(result); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [agentId]);

  const duration = events.length > 0 ? events[events.length - 1].t + 30 : 60;
  const [cursor, setCursor] = useState(duration);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [autoFollow, setAutoFollow] = useState(true);
  const previousDurationRef = useRef(duration);

  useEffect(() => {
    setCursor((current) => {
      const previousDuration = previousDurationRef.current;
      previousDurationRef.current = duration;
      const wasNearLiveEdge = isCursorAtLiveEdge(current, previousDuration);
      if (current > duration || (wasNearLiveEdge && autoFollow)) {
        return duration;
      }
      return current;
    });
  }, [duration, autoFollow]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setCursor((c) => {
        const next = c + speed;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing, duration, speed]);

  const visible = events.filter((e) => e.t <= cursor);
  const isAtTail = isCursorAtLiveEdge(cursor, duration);
  const isFollowing = isAtTail && autoFollow;
  const isLive = liveSession && isFollowing;

  const handleFollowToggle = useCallback(() => {
    if (isFollowing) {
      setAutoFollow(false);
    } else {
      setCursor(duration);
      setAutoFollow(true);
    }
  }, [isFollowing, duration]);

  const metadata = observeData.metadata;
  const sessionMeta = metadata?.session;
  const sourcePath = sessionMeta?.threadPath ?? null;
  const usageMeta = metadata?.usage;
  const toolCount = events.filter((e) => e.kind === "tool").length;
  const thinkCount = events.filter((e) => e.kind === "think").length;
  const askCount = events.filter((e) => e.kind === "ask").length;
  const readCount = events.filter(
    (e) => e.kind === "tool" && e.tool === "read",
  ).length;
  const editCount = events.filter(
    (e) => e.kind === "tool" && (e.tool === "edit" || e.tool === "write"),
  ).length;
  const observedWindowSeconds = events.length > 0 ? events[events.length - 1]!.t : 0;
  const derivedLoadPercent = contextUsage && contextUsage.length > 0
    ? Math.round((contextUsage[contextUsage.length - 1] ?? 0) * 100)
    : null;
  const usageStatCards = [
    { label: "Input", value: usageMeta?.inputTokens },
    { label: "Output", value: usageMeta?.outputTokens },
    { label: "Cache hit", value: usageMeta?.cacheReadInputTokens },
    { label: "Cache write", value: usageMeta?.cacheCreationInputTokens },
    { label: "Total", value: usageMeta?.totalTokens },
    { label: "Reasoning", value: usageMeta?.reasoningOutputTokens },
  ].filter((entry) => typeof entry.value === "number");
  const usageRows = definedObserveRows([
    typeof usageMeta?.assistantMessages === "number"
      ? {
          label: "Assistant msgs",
          value: fmtGroupedNumber(usageMeta.assistantMessages) ?? "0",
          tone: "accent",
        }
      : null,
    typeof usageMeta?.webSearchRequests === "number"
      ? {
          label: "Web search",
          value: fmtGroupedNumber(usageMeta.webSearchRequests) ?? "0",
        }
      : null,
    typeof usageMeta?.webFetchRequests === "number"
      ? {
          label: "Web fetch",
          value: fmtGroupedNumber(usageMeta.webFetchRequests) ?? "0",
        }
      : null,
    usageMeta?.serviceTier
      ? {
          label: "Service tier",
          value: usageMeta.serviceTier,
          tone: "good",
        }
      : null,
    usageMeta?.speed
      ? {
          label: "Speed",
          value: usageMeta.speed,
        }
      : null,
    usageMeta?.planType
      ? {
          label: "Plan",
          value: usageMeta.planType,
        }
      : null,
  ]);
  const windowRows = definedObserveRows([
    typeof usageMeta?.contextWindowTokens === "number"
      ? {
          label: "Model window",
          value: `${fmtGroupedNumber(usageMeta.contextWindowTokens)} tokens`,
          title: fmtGroupedNumber(usageMeta.contextWindowTokens) ?? undefined,
          tone: "accent",
        }
      : null,
    derivedLoadPercent !== null
      ? {
          label: "Derived load",
          value: `${derivedLoadPercent}%`,
          tone: derivedLoadPercent >= 80 ? "warn" : "default",
        }
      : null,
  ]);
  const metadataRows = definedObserveRows([
    sessionMeta?.model ? { label: "Model", value: sessionMeta.model, tone: "accent" } : null,
    sessionMeta?.adapterType ? { label: "Adapter", value: sessionMeta.adapterType } : null,
    sessionMeta?.gitBranch ? { label: "Branch", value: sessionMeta.gitBranch } : null,
    sessionMeta?.cwd
      ? {
          label: "Workspace",
          value: sessionMeta.cwd,
          title: sessionMeta.cwd,
          wrap: true,
          actionPath: sessionMeta.cwd,
        }
      : null,
    sessionMeta?.entrypoint ? { label: "Entrypoint", value: sessionMeta.entrypoint } : null,
    sessionMeta?.cliVersion ? { label: "CLI", value: sessionMeta.cliVersion } : null,
    sessionMeta?.permissionMode ? { label: "Permissions", value: sessionMeta.permissionMode } : null,
    sessionMeta?.approvalPolicy ? { label: "Approval", value: sessionMeta.approvalPolicy } : null,
    sessionMeta?.sandbox ? { label: "Sandbox", value: sessionMeta.sandbox } : null,
    sessionMeta?.userType ? { label: "User type", value: sessionMeta.userType } : null,
    sessionMeta?.originator ? { label: "Originator", value: sessionMeta.originator } : null,
    sessionMeta?.modelProvider ? { label: "Provider", value: sessionMeta.modelProvider } : null,
    sessionMeta?.effort ? { label: "Effort", value: sessionMeta.effort } : null,
    sessionMeta?.timezone ? { label: "Timezone", value: sessionMeta.timezone } : null,
    sessionMeta?.externalSessionId
      ? {
          label: "External session",
          value: sessionMeta.externalSessionId,
          title: sessionMeta.externalSessionId,
          wrap: true,
        }
      : null,
    sessionMeta?.threadId
      ? {
          label: "Thread",
          value: sessionMeta.threadId,
          title: sessionMeta.threadId,
          wrap: true,
        }
      : null,
    sessionMeta?.threadPath
      ? {
          label: "Thread path",
          value: sessionMeta.threadPath,
          title: sessionMeta.threadPath,
          wrap: true,
          actionPath: sessionMeta.threadPath,
          actionBasePath: sessionMeta.cwd ?? null,
        }
      : null,
    sessionMeta?.source ? { label: "Runtime source", value: sessionMeta.source } : null,
  ]);
  const hasUsageMetadata = hasObserveRows(usageMeta);
  const hasSessionMetadata = hasObserveRows(sessionMeta);

  return (
    <div className={`s-observe${showRail ? "" : " s-observe--content-only"}`}>
      {/* Main timeline */}
      <main className="s-observe-main">
        {sourcePath && (
          <SourceFileLink
            path={sourcePath}
            basePath={sessionMeta?.cwd ?? null}
            agentId={agentId ?? null}
            sessionId={sessionId ?? null}
          />
        )}
        <div className="s-observe-live-sticky">
          <FollowToggle isFollowing={isFollowing} isLive={isLive} onToggle={handleFollowToggle} />
        </div>
        <ReplayStream events={visible} followEnd={isFollowing} />
      </main>

      {/* Right rail */}
      {showRail && (
        <aside className="s-observe-rail">
          {catalog && catalog.sessions.length > 0 && (
          <div>
            <div className="s-observe-rail-label">Session</div>
            <SessionHeader catalog={catalog} sessionId={sessionId ?? null} agentId={agentId} />
          </div>
        )}

        <div>
          <div className="s-observe-rail-label">Trace stats</div>
          <div className="s-observe-stats">
            <StatCard
              label="Turns"
              value={fmtCompactNumber(sessionMeta?.turnCount ?? 0)}
            />
            <StatCard label="Tools" value={fmtCompactNumber(toolCount)} />
            <StatCard label="Thinks" value={fmtCompactNumber(thinkCount)} />
            <StatCard label="Asks" value={fmtCompactNumber(askCount)} />
            <StatCard label="Reads" value={fmtCompactNumber(readCount)} />
            <StatCard label="Edits" value={fmtCompactNumber(editCount)} />
            <StatCard label="Files" value={fmtCompactNumber(files.length)} />
            <StatCard label="Window" value={fmtWindowSpan(observedWindowSeconds)} />
          </div>
        </div>

        <div>
          <div className="s-observe-rail-label">Agent family</div>
          <ObservedTopologyPanel
            topology={metadata?.topology ?? null}
            title="Internal agents"
            size="rail"
          />
        </div>

        <div>
          <div className="s-observe-rail-label">Context window</div>
          <DetailRows rows={windowRows} agentId={agentId ?? null} sessionId={sessionId ?? null} />
          {contextUsage && contextUsage.length >= 2 ? (
            <>
              <ContextMeter data={contextUsage} cursor={cursor / duration} />
              <div className="s-observe-ctx-detail">
                Sparkline shows derived session load across the observed trace.
              </div>
            </>
          ) : windowRows.length === 0 ? (
            <div className="s-observe-ctx-detail">
              Unavailable for this session
            </div>
          ) : (
            <div className="s-observe-ctx-detail">
              Exact window metadata is available, but no derived load trace was captured.
            </div>
          )}
        </div>

        <div>
          <div className="s-observe-rail-label">
            Files touched · {files.length}
          </div>
          <div className="s-observe-files">
            {files.map((f) => (
              <div
                key={f.path}
                className={`s-observe-file${f.lastT <= cursor ? " s-observe-file--visible" : " s-observe-file--hidden"}`}
              >
                <FileGlyph state={f.state} />
                <LocalPathLink
                  path={f.path}
                  basePath={sessionMeta?.cwd ?? null}
                  agentId={agentId ?? null}
                  sessionId={sessionId ?? null}
                  className="s-observe-file-path"
                >
                  {f.path}
                </LocalPathLink>
                <span className="s-observe-file-touches">×{f.touches}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="s-observe-rail-label">Usage</div>
          {usageStatCards.length > 0 && (
            <div className="s-observe-stats s-observe-stats--usage">
              {usageStatCards.map((card) => (
                <StatCard
                  key={card.label}
                  label={card.label}
                  value={fmtCompactNumber(card.value)}
                />
              ))}
            </div>
          )}
          {usageRows.length > 0 ? (
            <DetailRows rows={usageRows} agentId={agentId ?? null} sessionId={sessionId ?? null} />
          ) : !hasUsageMetadata ? (
            <div className="s-observe-ctx-detail">Unavailable for this session</div>
          ) : null}
        </div>

        <div>
          <div className="s-observe-rail-label">Metadata</div>
          {metadataRows.length > 0 ? (
            <DetailRows rows={metadataRows} agentId={agentId ?? null} sessionId={sessionId ?? null} />
          ) : !hasSessionMetadata ? (
            <div className="s-observe-ctx-detail">Unavailable for this session</div>
          ) : null}
        </div>
        </aside>
      )}

      {/* Scrubber footer */}
      <footer className="s-observe-scrubber">
        <button
          className="s-observe-play-btn"
          onClick={() => setPlaying(!playing)}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button
          className="s-observe-rewind-btn"
          onClick={() => {
            setCursor(0);
            setPlaying(false);
          }}
        >
          ⏮
        </button>

        <Scrubber
          events={events}
          duration={duration}
          cursor={cursor}
          onCursor={setCursor}
        />

        <div className="s-observe-speed-group">
          {([0.5, 1, 2, 4] as const).map((s) => (
            <button
              key={s}
              className={`s-observe-speed-btn${speed === s ? " s-observe-speed-btn--active" : ""}`}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}
