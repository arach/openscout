import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ObserveData,
  ObserveEvent,
  ObserveFile,
} from "../lib/types.ts";

import "./session-observe.css";

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

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function isCursorAtLiveEdge(cursor: number, duration: number): boolean {
  return cursor >= Math.max(0, duration - LIVE_EDGE_WINDOW_SECONDS);
}

/* ── Event blocks ── */

function ThinkBlock({ event }: { event: SessionEvent }) {
  return (
    <div>
      <div className="s-observe-think-label">thinking</div>
      <div className="s-observe-think-text">
        &ldquo;{event.text}&rdquo;
        {event.live && <span className="s-observe-cursor" />}
      </div>
    </div>
  );
}

function ToolBlock({ event }: { event: SessionEvent }) {
  const glyph = TOOL_GLYPH[event.tool ?? ""] ?? "▸";
  const hasBody = !!(event.result || event.diff || event.stream);

  return (
    <div className="s-observe-tool">
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
    </div>
  );
}

function AskLine({ event }: { event: SessionEvent }) {
  const toLabel = event.to === "human" ? "you" : event.to ?? "?";
  return (
    <div className="s-observe-ask">
      <div className="s-observe-ask-label">↗ ask → {toLabel}</div>
      <div className="s-observe-ask-text">
        &ldquo;{event.text}&rdquo;
      </div>
      {event.answer && (
        <div className="s-observe-ask-answer">
          <span className="s-observe-ask-answer-meta">
            ↳ @{event.to ?? "you"} · +{(event.answerT ?? event.t) - event.t}s
          </span>
          <div className="s-observe-ask-answer-text">{event.answer}</div>
        </div>
      )}
    </div>
  );
}

function MessageLine({ event }: { event: SessionEvent }) {
  const toLabel = event.to === "human" ? "you" : event.to ?? "?";
  return (
    <div>
      <div className="s-observe-message-label">→ message → {toLabel}</div>
      <div className="s-observe-message-text">{event.text}</div>
    </div>
  );
}

function NoteLine({ event }: { event: SessionEvent }) {
  return (
    <div className="s-observe-note">
      <span className="s-observe-note-icon">✓</span>
      <span className="s-observe-note-text">{event.text}</span>
    </div>
  );
}

function SystemLine({ event }: { event: SessionEvent }) {
  return (
    <div className="s-observe-system">
      <span className="s-observe-system-arrow">▸ </span>
      {event.text}
      {event.detail && (
        <div className="s-observe-system-detail">{event.detail}</div>
      )}
    </div>
  );
}

function LiveIndicator() {
  return (
    <div className="s-observe-live">
      <span className="s-observe-live-dot" />
      <span className="s-observe-live-label">LIVE · tailing session</span>
    </div>
  );
}

function TailStatus({
  liveSession,
  isLive,
}: {
  liveSession: boolean;
  isLive: boolean;
}) {
  const tone = liveSession
    ? isLive
      ? "live"
      : "paused"
    : "replay";
  const label = liveSession
    ? isLive
      ? "LIVE · tail mode on"
      : "LIVE · tail paused"
    : "REPLAY · saved trace";

  return (
    <div className={`s-observe-tail-state s-observe-tail-state--${tone}`}>
      <span className="s-observe-tail-state-dot" />
      <span className="s-observe-tail-state-label">{label}</span>
    </div>
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
  isLive,
}: {
  events: SessionEvent[];
  isLive: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLive) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length, isLive]);

  return (
    <div className="s-observe-stream">
      <div className="s-observe-spine" />
      {events.map((e, i) => (
        <StreamRow key={e.id} event={e} prevT={i > 0 ? events[i - 1].t : 0} />
      ))}
      {isLive && <LiveIndicator />}
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
}: {
  data?: SessionObserveData;
}) {
  const observeData = data ?? EMPTY_OBSERVE_DATA;
  const { events, files, contextUsage } = observeData;
  const liveSession = observeData.live === true;

  const duration = events.length > 0 ? events[events.length - 1].t + 30 : 60;
  const [cursor, setCursor] = useState(duration);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const previousDurationRef = useRef(duration);

  useEffect(() => {
    setCursor((current) => {
      const previousDuration = previousDurationRef.current;
      previousDurationRef.current = duration;
      const wasNearLiveEdge = isCursorAtLiveEdge(current, previousDuration);
      if (current > duration || wasNearLiveEdge) {
        return duration;
      }
      return current;
    });
  }, [duration]);

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
  const isLive = liveSession && isCursorAtLiveEdge(cursor, duration);
  const jumpButtonLabel = liveSession
    ? isLive
      ? "Following live"
      : "Jump to live ↦"
    : "Jump to end ↦";

  const toolCount = events.filter((e) => e.kind === "tool").length;
  const thinkCount = events.filter((e) => e.kind === "think").length;
  const askCount = events.filter((e) => e.kind === "ask").length;
  const editCount = events.filter(
    (e) => e.kind === "tool" && e.tool === "edit",
  ).length;

  return (
    <div className="s-observe">
      {/* Main timeline */}
      <main className="s-observe-main">
        <ReplayStream events={visible} isLive={isLive} />
      </main>

      {/* Right rail */}
      <aside className="s-observe-rail">
        <div>
          <div className="s-observe-rail-label">Context window</div>
          {contextUsage && contextUsage.length >= 2 ? (
            <>
              <ContextMeter data={contextUsage} cursor={cursor / duration} />
              <div className="s-observe-ctx-detail">
                {Math.round((contextUsage[contextUsage.length - 1] ?? 0) * 100)}% ·{" "}
                derived session load
              </div>
            </>
          ) : (
            <div className="s-observe-ctx-detail">
              Unavailable for this session
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
                <span className="s-observe-file-path">{f.path}</span>
                <span className="s-observe-file-touches">×{f.touches}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="s-observe-rail-label">Session stats</div>
          <div className="s-observe-stats">
            <div className="s-observe-stat">
              <div className="s-observe-stat-label">Tools</div>
              <div className="s-observe-stat-value">{toolCount}</div>
            </div>
            <div className="s-observe-stat">
              <div className="s-observe-stat-label">Thinks</div>
              <div className="s-observe-stat-value">{thinkCount}</div>
            </div>
            <div className="s-observe-stat">
              <div className="s-observe-stat-label">Asks</div>
              <div className="s-observe-stat-value">{askCount}</div>
            </div>
            <div className="s-observe-stat">
              <div className="s-observe-stat-label">Edits</div>
              <div className="s-observe-stat-value">{editCount}</div>
            </div>
          </div>
        </div>
      </aside>

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

        <TailStatus liveSession={liveSession} isLive={isLive} />

        <button
          className={`s-observe-jump-btn${isLive ? " s-observe-jump-btn--active" : ""}`}
          onClick={() => setCursor(duration)}
        >
          {jumpButtonLabel}
        </button>
      </footer>
    </div>
  );
}
