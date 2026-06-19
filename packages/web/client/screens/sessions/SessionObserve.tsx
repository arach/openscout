import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ExternalLink } from "lucide-react";

import type {
  ObserveData,
  ObserveEvent,
  ObserveFile,
  ObserveMetadata,
  ObserveSessionMeta,
  ObserveUsageMeta,
  SessionCatalogWithResume,
} from "../../lib/types.ts";
import { collapseObserveDisplayRows } from "../../lib/observe-display.ts";
import {
  filterObserveEventsForHorizon,
  laneSnippetText,
  laneTextNeedsExpand,
  laneToolArgSnippet,
} from "../../lib/lane-observe.ts";
import { api } from "../../lib/api.ts";
import { timeAgo } from "../../lib/time.ts";
import { MessageMarkup } from "../../lib/message-markup.tsx";
import { queueTakeover } from "../../lib/terminal-takeover.ts";
import { useScout } from "../../scout/Provider.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import { ObservedTopologyPanel } from "../../components/ObservedTopologyPanel.tsx";
import { VantageHandoffButton } from "../../components/VantageHandoffButton.tsx";

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
  /** Optional shortened render (e.g. a path basename); copy + tooltip keep `value`. */
  display?: string;
  title?: string;
  tone?: ObserveDetailTone;
  wrap?: boolean;
  actionPath?: string;
  actionBasePath?: string | null;
};

function fmtClock(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) {
    return "00:00";
  }
  const totalSeconds = Math.floor(sec);
  const h = Math.floor(totalSeconds / 3_600);
  const m = Math.floor((totalSeconds % 3_600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Compact elapsed label for lane trace rows (avoids clock-like H:MM:SS). */
function fmtElapsed(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) {
    return "0s";
  }
  const totalSeconds = Math.floor(sec);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  if (totalSeconds < 3_600) {
    return `${Math.floor(totalSeconds / 60)}m`;
  }
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
}

function fmtLaneRowTime(
  eventT: number,
  sessionStartMs: number | undefined,
  nowMs: number,
): string {
  if (typeof sessionStartMs === "number" && Number.isFinite(sessionStartMs)) {
    return timeAgo(sessionStartMs + eventT * 1000, nowMs);
  }
  return fmtElapsed(eventT);
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

function LaneExpandToggle({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="s-observe-lane-expand"
      onClick={onToggle}
      aria-expanded={expanded}
    >
      {expanded ? "Less" : "More"}
    </button>
  );
}

function LaneExpandableText({
  text,
  className,
  laneMode = false,
  live = false,
  renderExpanded,
}: {
  text: string;
  className: string;
  laneMode?: boolean;
  live?: boolean;
  renderExpanded?: (value: string) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const normalized = text.trim();
  if (!laneMode) {
    return (
      <div className={className}>
        {renderExpanded ? renderExpanded(normalized) : normalized}
        {live && <span className="s-observe-cursor" />}
      </div>
    );
  }

  const needsExpand = laneTextNeedsExpand(normalized);
  const snippet = laneSnippetText(normalized);
  const body = expanded
    ? (renderExpanded ? renderExpanded(normalized) : normalized)
    : snippet;

  return (
    <div className={`s-observe-lane-expandable${expanded ? " s-observe-lane-expandable--open" : ""}`}>
      <div className={className}>
        {body}
        {live && <span className="s-observe-cursor" />}
      </div>
      {needsExpand && (
        <LaneExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
        />
      )}
    </div>
  );
}

function ThinkBlock({ event, laneMode = false }: { event: SessionEvent; laneMode?: boolean }) {
  const text = event.text ?? "";
  return (
    <div className={`s-observe-block${laneMode ? " s-observe-think--lane" : ""}`}>
      <div className="s-observe-think-label">thinking</div>
      <LaneExpandableText
        text={text}
        className="s-observe-think-text"
        laneMode={laneMode}
        live={event.live}
        renderExpanded={(value) => <span className="s-observe-quoted">{value}</span>}
      />
      {!laneMode && <CopyButton text={text} label="Copy thought" />}
    </div>
  );
}

function DiffPreview({ preview }: { preview: string }) {
  const lines = preview.split("\n");
  return (
    <pre className="s-observe-tool-diff-preview">
      {lines.map((line, i) => {
        const head = line[0];
        const tone =
          head === "+"
            ? "add"
            : head === "-" || head === "−"
              ? "del"
              : line.startsWith("@@")
                ? "hunk"
                : "ctx";
        return (
          <span
            key={i}
            className={`s-observe-diff-line s-observe-diff-line--${tone}`}
          >
            {line}
            {i < lines.length - 1 ? "\n" : null}
          </span>
        );
      })}
    </pre>
  );
}

function observeToolGlyphKey(tool: string | undefined): string {
  const key = (tool ?? "").toLowerCase();
  return key === "shell" ? "bash" : key;
}

function toolArgLabel(event: SessionEvent): string | undefined {
  const arg = event.arg?.trim();
  if (!arg || arg === "started" || arg === "completed") return undefined;
  return arg;
}

function ToolBlock({ event, laneMode = false }: { event: SessionEvent; laneMode?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const glyph = TOOL_GLYPH[observeToolGlyphKey(event.tool)] ?? "▸";
  const command = toolArgLabel(event);
  const fullCommand = command ?? event.arg?.trim() ?? "";
  const laneCommand = laneMode ? laneToolArgSnippet(fullCommand) : fullCommand;
  const outcome = typeof event.result?.outcome === "string"
    ? event.result.outcome.trim()
    : (typeof event.result?.outcome === "number" ? String(event.result.outcome) : undefined);
  const showOutcome = Boolean(outcome && outcome !== "success");
  const hasBody = !!(showOutcome || event.diff || event.stream);
  const laneExpandable = laneMode && (
    hasBody
    || laneTextNeedsExpand(fullCommand, 96, 2)
    || Boolean(event.diff?.preview && laneTextNeedsExpand(event.diff.preview, 120, 4))
  );

  return (
    <div className={`s-observe-tool s-observe-block${laneMode ? " s-observe-tool--lane" : ""}`}>
      <div
        className={`s-observe-tool-header${hasBody && !laneMode ? " s-observe-tool-header--has-body" : ""}`}
      >
        <span className="s-observe-tool-glyph">{glyph}</span>
        <span className="s-observe-tool-cmd">
          <span className="s-observe-tool-cmd-name">{event.tool}</span>
          {laneCommand ? (
            <>
              {" "}
              <span className="s-observe-tool-cmd-arg">{laneCommand}</span>
            </>
          ) : null}
          {outcome === "success" && (
            <span className="s-observe-tool-outcome s-observe-tool-outcome--success">
              ok
            </span>
          )}
          {laneMode && event.diff && (
            <span className="s-observe-tool-diff-inline" aria-label={`${event.diff.add} additions, ${event.diff.del} deletions`}>
              <span className="s-observe-tool-diff-add">+{event.diff.add}</span>
              <span className="s-observe-tool-diff-del">−{event.diff.del}</span>
            </span>
          )}
        </span>
      </div>

      {laneExpandable && (
        <LaneExpandToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
      )}

      {(!laneMode || expanded) && showOutcome && event.result && (
        <div className="s-observe-tool-result">
          {Object.entries(event.result)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")}
        </div>
      )}

      {(!laneMode || expanded) && event.diff && (
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
          {laneMode && !expanded
            ? null
            : <DiffPreview preview={event.diff.preview} />}
        </div>
      )}

      {(!laneMode || expanded) && fullCommand && laneMode && expanded && (
        <pre className="s-observe-tool-stream s-observe-tool-stream--lane">{fullCommand}</pre>
      )}

      {(!laneMode || expanded) && event.stream && (
        <pre className="s-observe-tool-stream">{event.stream.join("\n")}</pre>
      )}

      {!laneMode && <CopyButton text={buildToolCopyText(event)} label="Copy tool call" />}
    </div>
  );
}

function AskLine({ event, laneMode = false }: { event: SessionEvent; laneMode?: boolean }) {
  const toLabel = event.to === "human" ? "you" : event.to ?? "?";
  const copyText = event.answer
    ? `${event.text}\n\n↳ ${event.to ?? "you"}: ${event.answer}`
    : event.text ?? "";
  return (
    <div className={`s-observe-ask s-observe-block${laneMode ? " s-observe-ask--lane" : ""}`}>
      <div className="s-observe-ask-label">↗ ask → {toLabel}</div>
      <LaneExpandableText
        text={event.text ?? ""}
        className="s-observe-ask-text"
        laneMode={laneMode}
        live={event.live}
        renderExpanded={(value) => <span className="s-observe-quoted">{value}</span>}
      />
      {event.answer && (!laneMode || laneTextNeedsExpand(event.answer)) && (
        <div className="s-observe-ask-answer">
          <span className="s-observe-ask-answer-meta">
            ↳ @{event.to ?? "you"} · +{(event.answerT ?? event.t) - event.t}s
          </span>
          <div className="s-observe-ask-answer-text">{event.answer}</div>
        </div>
      )}
      {!laneMode && <CopyButton text={copyText} label="Copy ask" />}
    </div>
  );
}

function MessageLine({ event, laneMode = false }: { event: SessionEvent; laneMode?: boolean }) {
  const toLabel = event.to === "human" ? "you" : event.to ?? "?";
  const text = event.text ?? "";
  return (
    <div className={`s-observe-block${laneMode ? " s-observe-message--lane" : ""}`}>
      <div className="s-observe-message-label">→ message → {toLabel}</div>
      <LaneExpandableText
        text={text}
        className="s-observe-message-text"
        laneMode={laneMode}
        live={event.live}
        renderExpanded={(value) => <MessageMarkup text={value} />}
      />
      {!laneMode && <CopyButton text={text} label="Copy message" />}
    </div>
  );
}

function laneSystemDetailVisible(detail: string | undefined, laneMode: boolean): boolean {
  if (!detail?.trim()) return false;
  if (!laneMode) return true;
  return !/^[a-z0-9._-]+ · [a-z0-9._-]+$/i.test(detail.trim());
}

const LANE_NOTE_LABELS: Record<string, string> = {
  turn_ended: "Turn complete",
  turn_started: "Turn started",
};

function formatLaneNoteLabel(text: string): string {
  const trimmed = text.trim();
  const bracket = trimmed.match(/^\[(.+)\]$/);
  const raw = bracket?.[1] ?? trimmed;
  return LANE_NOTE_LABELS[raw] ?? raw.replace(/_/g, " ");
}

function NoteLine({ event, laneMode = false }: { event: SessionEvent; laneMode?: boolean }) {
  if (laneMode) {
    return (
      <div className="s-observe-note s-observe-block s-observe-block--inline s-observe-note--lane">
        <span className="s-observe-note-text">{formatLaneNoteLabel(event.text)}</span>
      </div>
    );
  }

  return (
    <div className="s-observe-note s-observe-block s-observe-block--inline">
      <span className="s-observe-note-icon" aria-hidden="true">✓</span>
      <span className="s-observe-note-text">{event.text}</span>
      <CopyButton text={event.text ?? ""} label="Copy note" />
    </div>
  );
}

function SystemLine({ event, laneMode = false }: { event: SessionEvent; laneMode?: boolean }) {
  const showDetail = laneSystemDetailVisible(event.detail, laneMode);
  const copyText = showDetail && event.detail
    ? `${event.text}\n${event.detail}`
    : event.text ?? "";
  return (
    <div className={`s-observe-system s-observe-block${laneMode ? " s-observe-system--lane" : ""}`}>
      <div className="s-observe-system-line">
        {!laneMode && <span className="s-observe-system-arrow" aria-hidden="true">▸ </span>}
        <span className="s-observe-system-text">{event.text}</span>
      </div>
      {showDetail && event.detail && (
        <div className="s-observe-system-detail">{event.detail}</div>
      )}
      <CopyButton text={copyText} label="Copy system event" />
    </div>
  );
}

function FollowToggle({
  isFollowing,
  isLive,
  liveLabel,
  onToggle,
}: {
  isFollowing: boolean;
  isLive: boolean;
  liveLabel?: string;
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
      <span>{isFollowing ? (isLive ? (liveLabel ?? "Live") : "Latest") : "Follow"}</span>
    </button>
  );
}

/* ── Stream row ── */

function StreamRow({
  event,
  prevT,
  laneMode = false,
  entering = false,
  nudging = false,
  nudgeDelayMs = 0,
  repeatCount = 1,
  sessionStartMs,
  nowMs = Date.now(),
}: {
  event: SessionEvent;
  prevT: number;
  laneMode?: boolean;
  entering?: boolean;
  nudging?: boolean;
  nudgeDelayMs?: number;
  repeatCount?: number;
  sessionStartMs?: number;
  nowMs?: number;
}) {
  const gap = event.t - prevT;
  const accent = KIND_COLOR[event.kind] ?? "var(--dim)";
  const rowTime = laneMode
    ? fmtLaneRowTime(event.t, sessionStartMs, nowMs)
    : fmtClock(event.t);

  const rowClass = [
    "s-observe-row",
    entering ? "s-observe-row--enter" : "",
    nudging ? "s-observe-row--nudge" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={rowClass}
      style={nudging && nudgeDelayMs > 0
        ? ({ "--row-nudge-delay": `${nudgeDelayMs}ms` } as CSSProperties)
        : undefined}
    >
      {gap > 15 && <div className="s-observe-row-gap">+{gap}s</div>}

      <div className="s-observe-row-time">
        {rowTime}
        {repeatCount > 1 && (
          <span className="s-observe-row-repeat" title={`${repeatCount} similar events merged`}>
            ×{repeatCount}
          </span>
        )}
      </div>

      <span className="s-observe-row-bead" style={{ background: accent }} />

      {event.kind === "think" && <ThinkBlock event={event} laneMode={laneMode} />}
      {event.kind === "tool" && <ToolBlock event={event} laneMode={laneMode} />}
      {event.kind === "ask" && <AskLine event={event} laneMode={laneMode} />}
      {event.kind === "message" && <MessageLine event={event} laneMode={laneMode} />}
      {event.kind === "note" && <NoteLine event={event} laneMode={laneMode} />}
      {(event.kind === "system" || event.kind === "boot") && (
        <SystemLine event={event} laneMode={laneMode} />
      )}
    </div>
  );
}

/* ── Replay stream ── */

function scrollTraceToEnd(endEl: HTMLElement | null, behavior: ScrollBehavior): void {
  if (!endEl) return;

  const scrollParent = endEl.closest(".s-observe-main") as HTMLElement | null;
  if (scrollParent) {
    const top = scrollParent.scrollHeight - scrollParent.clientHeight;
    scrollParent.scrollTo({ top, left: scrollParent.scrollLeft, behavior });
    return;
  }

  endEl.scrollIntoView({ behavior, block: "end", inline: "nearest" });
}

function ReplayStream({
  events,
  followEnd,
  laneMode = false,
  sessionStartMs,
  nowMs = Date.now(),
}: {
  events: SessionEvent[];
  followEnd: boolean;
  laneMode?: boolean;
  sessionStartMs?: number;
  nowMs?: number;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const prevFollowEndRef = useRef(followEnd);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const laneEventsPrimedRef = useRef(false);
  const [enteringEventIds, setEnteringEventIds] = useState<ReadonlySet<string>>(() => new Set());
  const [nudgingEventIds, setNudgingEventIds] = useState<ReadonlySet<string>>(() => new Set());
  const [streamScrollNudge, setStreamScrollNudge] = useState(false);

  const displayRows = useMemo(
    () => (laneMode
      ? collapseObserveDisplayRows(events)
      : events.map((event) => ({ event, repeatCount: 1 }))),
    [events, laneMode],
  );

  useEffect(() => {
    if (!laneMode) {
      laneEventsPrimedRef.current = true;
      return;
    }

    const seen = seenEventIdsRef.current;
    if (!laneEventsPrimedRef.current) {
      for (const row of displayRows) seen.add(row.event.id);
      laneEventsPrimedRef.current = true;
      return;
    }

    const fresh: string[] = [];
    for (const row of displayRows) {
      if (seen.has(row.event.id)) continue;
      seen.add(row.event.id);
      fresh.push(row.event.id);
    }
    if (fresh.length === 0) return;

    const freshSet = new Set(fresh);
    setEnteringEventIds(freshSet);
    if (followEnd) {
      setNudgingEventIds(new Set(
        displayRows
          .filter((row) => !freshSet.has(row.event.id))
          .map((row) => row.event.id),
      ));
      setStreamScrollNudge(true);
    }

    const timer = window.setTimeout(() => {
      setEnteringEventIds(new Set());
      setNudgingEventIds(new Set());
      setStreamScrollNudge(false);
    }, 520);
    return () => window.clearTimeout(timer);
  }, [displayRows, followEnd, laneMode]);

  useLayoutEffect(() => {
    if (!followEnd) {
      prevFollowEndRef.current = false;
      return;
    }
    const justEnabled = !prevFollowEndRef.current;
    prevFollowEndRef.current = true;
    scrollTraceToEnd(
      endRef.current,
      justEnabled ? "instant" : "smooth",
    );
  }, [displayRows.length, followEnd]);

  const laneNudgeStrideMs = 28;
  const laneNudgeCapMs = 154;

  return (
    <div className={`s-observe-stream${streamScrollNudge ? " s-observe-stream--scroll-nudge" : ""}`}>
      <div className="s-observe-spine" />
      {displayRows.map((row, index) => (
        <StreamRow
          key={`${row.event.id}:${row.repeatCount}:${index}`}
          event={row.event}
          prevT={index > 0 ? displayRows[index - 1]!.event.t : 0}
          laneMode={laneMode}
          entering={laneMode && enteringEventIds.has(row.event.id)}
          nudging={laneMode && nudgingEventIds.has(row.event.id)}
          repeatCount={row.repeatCount}
          nudgeDelayMs={
            laneMode && nudgingEventIds.has(row.event.id)
              ? Math.min((displayRows.length - 1 - index) * laneNudgeStrideMs, laneNudgeCapMs)
              : 0
          }
          sessionStartMs={sessionStartMs}
          nowMs={nowMs}
        />
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
  // Zero / unavailable stats recede so the cards with real signal lead the eye.
  const isQuiet = value === "0" || value === "—" || value === "";
  return (
    <div className={`s-observe-stat${isQuiet ? " s-observe-stat--quiet" : ""}`}>
      <div className="s-observe-stat-value">{value}</div>
      <div className="s-observe-stat-label">{label}</div>
      {detail && <div className="s-observe-stat-detail">{detail}</div>}
    </div>
  );
}

/** Unified, calm empty-state line for rail sections with no captured data. */
function RailEmpty({ children = "Not captured for this session" }: { children?: ReactNode }) {
  return <div className="s-observe-empty">{children}</div>;
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
  const { openFilePreview } = useScout();
  const resolvedPath = path.startsWith("/") || path.startsWith("~/")
    ? path
    : basePath
      ? `${basePath.replace(/\/$/, "")}/${path}`
      : path;
  return (
    <span className="s-observe-path-link-group">
      <button
        type="button"
        className={className}
        title={`Preview ${path} in Scout`}
        onClick={() => openFilePreview(resolvedPath)}
      >
        {children}
      </button>
      <button
        type="button"
        className="s-observe-path-link-external"
        title={`Reveal ${path} in OS`}
        aria-label="Reveal in OS"
        onClick={() => revealPath({ path, basePath, agentId, sessionId })}
      >
        <ExternalLink size={11} strokeWidth={1.6} />
      </button>
    </span>
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
        const shown = row.display ?? row.value;
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
                  {shown}
                </LocalPathLink>
              ) : (
                <div
                  className={valueClassName}
                  title={row.title ?? (shown !== row.value ? row.value : undefined)}
                >
                  {shown}
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
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (duration <= 0) return;
      const small = duration * 0.01;
      const large = duration * 0.05;
      let next = cursor;
      switch (e.key) {
        case "ArrowLeft":
          next = cursor - (e.shiftKey ? large : small);
          break;
        case "ArrowRight":
          next = cursor + (e.shiftKey ? large : small);
          break;
        case "PageDown":
          next = cursor - large;
          break;
        case "PageUp":
          next = cursor + large;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = duration;
          break;
        default:
          return;
      }
      e.preventDefault();
      onCursor(Math.max(0, Math.min(duration, next)));
    },
    [cursor, duration, onCursor],
  );

  return (
    <div className="s-observe-track-wrap">
      <div
        ref={trackRef}
        className="s-observe-track"
        onClick={onClick}
        onKeyDown={onKeyDown}
        role="slider"
        tabIndex={duration > 0 ? 0 : -1}
        aria-label="Session timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.max(0, Math.min(duration, cursor))}
      >
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
  const { navigate, route } = useScout();
  const [sent, setSent] = useState(false);
  const active = catalog.sessions.find((s) => s.id === catalog.activeSessionId);
  const past = catalog.sessions
    .filter((s) => s.id !== catalog.activeSessionId && s.endedAt)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, 5);

  const displayId = catalog.activeSessionId ?? sessionId;
  const shortId = displayId ? displayId.slice(0, 8) : null;
  const canTakeover = Boolean(active?.canTakeover && catalog.resumeCommand);

  const runTakeover = useCallback(() => {
    if (!canTakeover || !catalog.resumeCommand) return;
    void queueTakeover({
      command: catalog.resumeCommand,
      cwd: catalog.resumeCwd,
      agentId,
    }).then(() => {
      openContent(navigate, { view: "terminal", agentId }, { returnTo: route });
    });
    setSent(true);
  }, [canTakeover, catalog.resumeCommand, catalog.resumeCwd, navigate, route, agentId]);

  const openPair = useCallback(() => {
    navigate({
      view: "messages",
      conversationId: `dm.operator.${agentId}`,
    });
  }, [navigate, agentId]);

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
          <button
            className="s-observe-pair-btn"
            onClick={openPair}
            title="Send messages into the live session without taking the terminal"
          >
            Pair
          </button>
          {canTakeover && (
            <button
              className="s-observe-takeover-btn"
              onClick={runTakeover}
              title={catalog.resumeCommand ?? undefined}
            >
              {sent ? "Sent" : "Takeover"}
            </button>
          )}
          <VantageHandoffButton
            agentId={agentId}
            className="s-observe-vantage-btn"
            statusClassName="s-observe-vantage-status"
          />
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
  variant = "default",
  traceLimit,
  traceWindowMs,
}: {
  data?: SessionObserveData;
  agentId?: string;
  sessionId?: string | null;
  showRail?: boolean;
  variant?: "default" | "lane";
  /** @deprecated Prefer traceWindowMs — lane mode time horizon for visible events. */
  traceLimit?: number;
  /** Lane mode: only render observe events inside this wall-clock window. */
  traceWindowMs?: number;
}) {
  const laneMode = variant === "lane";
  const observeData = data ?? EMPTY_OBSERVE_DATA;
  const { events, files } = observeData;
  const liveSession = observeData.live === true;
  const sessionStartMs = observeData.metadata?.session?.sessionStart;

  const [now, setNow] = useState(Date.now);
  const [catalog, setCatalog] = useState<SessionCatalogWithResume | null>(null);
  useEffect(() => {
    if (!laneMode) return;
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, [laneMode]);

  useEffect(() => {
    if (!agentId || laneMode) return;
    let cancelled = false;
    api<SessionCatalogWithResume>(`/api/agents/${encodeURIComponent(agentId)}/session-catalog`)
      .then((result) => { if (!cancelled) setCatalog(result); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [agentId, laneMode]);

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

  const visible = (() => {
    let filtered = events.filter((event) => event.t <= cursor);
    if (laneMode && traceWindowMs && traceWindowMs > 0) {
      filtered = filterObserveEventsForHorizon(
        filtered,
        sessionStartMs,
        now,
        traceWindowMs,
      );
    } else if (laneMode && traceLimit && traceLimit > 0) {
      filtered = filtered.slice(-traceLimit);
    }
    return filtered;
  })();
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
  const derivedLoadPercent = typeof usageMeta?.contextInputTokens === "number"
    && typeof usageMeta.contextWindowTokens === "number"
    && usageMeta.contextWindowTokens > 0
    ? Math.max(0, Math.min(100, Math.round((usageMeta.contextInputTokens / usageMeta.contextWindowTokens) * 100)))
    : null;
  const usageStatCards = [
    { label: "Context input", value: usageMeta?.contextInputTokens },
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
          label: "Window load",
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
          display: basename(sessionMeta.cwd),
          title: sessionMeta.cwd,
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
        }
      : null,
    sessionMeta?.threadId
      ? {
          label: "Thread",
          value: sessionMeta.threadId,
          title: sessionMeta.threadId,
        }
      : null,
    sessionMeta?.threadPath
      ? {
          label: "Thread path",
          value: sessionMeta.threadPath,
          display: basename(sessionMeta.threadPath),
          title: sessionMeta.threadPath,
          actionPath: sessionMeta.threadPath,
          actionBasePath: sessionMeta.cwd ?? null,
        }
      : null,
    sessionMeta?.source ? { label: "Runtime source", value: sessionMeta.source } : null,
  ]);
  const hasUsageMetadata = hasObserveRows(usageMeta);
  const hasSessionMetadata = hasObserveRows(sessionMeta);

  return (
    <div
      className={[
        "s-observe",
        (!showRail || laneMode) && "s-observe--content-only",
        laneMode && "s-observe--lane",
      ].filter(Boolean).join(" ")}
    >
      {/* Main timeline */}
      <main className="s-observe-main">
        {sourcePath && !laneMode && (
          <SourceFileLink
            path={sourcePath}
            basePath={sessionMeta?.cwd ?? null}
            agentId={agentId ?? null}
            sessionId={sessionId ?? null}
          />
        )}
        <div className="s-observe-live-sticky">
          <FollowToggle
            isFollowing={isFollowing}
            isLive={isLive}
            onToggle={handleFollowToggle}
          />
        </div>
        <ReplayStream
          events={visible}
          followEnd={isFollowing}
          laneMode={laneMode}
          sessionStartMs={sessionStartMs}
          nowMs={now}
        />
      </main>

      {/* Right rail */}
      {showRail && !laneMode && (
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
            size="rail"
            maxAgents={4}
          />
        </div>

        <div>
          <div className="s-observe-rail-label">Context window</div>
          <DetailRows rows={windowRows} agentId={agentId ?? null} sessionId={sessionId ?? null} />
          {derivedLoadPercent !== null ? (
            <>
              <ContextMeter data={[derivedLoadPercent / 100, derivedLoadPercent / 100]} cursor={cursor / duration} />
              <div className="s-observe-ctx-detail">
                Derived session load across the observed trace.
              </div>
            </>
          ) : windowRows.length === 0 ? (
            <RailEmpty />
          ) : (
            <div className="s-observe-ctx-detail">
              No derived load trace captured.
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
          ) : !hasUsageMetadata && usageStatCards.length === 0 ? (
            <RailEmpty />
          ) : null}
        </div>

        <div>
          <div className="s-observe-rail-label">Metadata</div>
          {metadataRows.length > 0 ? (
            <DetailRows rows={metadataRows} agentId={agentId ?? null} sessionId={sessionId ?? null} />
          ) : !hasSessionMetadata ? (
            <RailEmpty />
          ) : null}
        </div>
        </aside>
      )}

      {/* Scrubber footer */}
      {!laneMode && (
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
      )}
    </div>
  );
}
