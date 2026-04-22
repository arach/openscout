import { useCallback, useEffect, useRef, useState } from "react";
import "./session-observe.css";

/* ── Adapter types — real data plugs in here later ── */

export interface SessionEvent {
  id: string;
  t: number;
  kind: "think" | "tool" | "ask" | "message" | "note" | "system" | "boot";
  text: string;
  tool?: string;
  arg?: string;
  diff?: { add: number; del: number; preview: string };
  result?: Record<string, string | number>;
  stream?: string[];
  live?: boolean;
  to?: string;
  answer?: string;
  answerT?: number;
  detail?: string;
}

export interface SessionFile {
  path: string;
  state: "read" | "created" | "modified";
  touches: number;
  lastT: number;
}

export interface SessionObserveData {
  events: SessionEvent[];
  files: SessionFile[];
  contextUsage?: number[];
  live?: boolean;
}

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

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

/* ── Mock data ── */

const MOCK_EVENTS: SessionEvent[] = [
  {
    id: "e1",
    t: 0,
    kind: "boot",
    text: "Session started · claude-sonnet-4-6 · workspace openscout",
    detail: "context: 200k · tools: 12 · branch: main",
  },
  {
    id: "e2",
    t: 3,
    kind: "think",
    text: "The user wants me to refactor the authentication middleware. Let me start by reading the current implementation to understand the data flow.",
  },
  {
    id: "e3",
    t: 8,
    kind: "tool",
    tool: "read",
    text: "",
    arg: "packages/server/src/middleware/auth.ts",
    result: { lines: 142, exports: 3, imports: 5 },
  },
  {
    id: "e4",
    t: 14,
    kind: "tool",
    tool: "grep",
    text: "",
    arg: "validateSession",
    result: { matches: 7, files: 4 },
  },
  {
    id: "e5",
    t: 22,
    kind: "think",
    text: "The session validation is scattered across four files. I should consolidate it into the auth middleware and expose a single validateSession export.",
    live: false,
  },
  {
    id: "e6",
    t: 30,
    kind: "tool",
    tool: "edit",
    text: "",
    arg: "packages/server/src/middleware/auth.ts",
    diff: {
      add: 24,
      del: 8,
      preview:
        '+export async function validateSession(req: Request) {\n+  const token = extractBearerToken(req);\n+  if (!token) return null;\n+  return await verifyAndDecode(token);\n+}',
    },
  },
  {
    id: "e7",
    t: 45,
    kind: "tool",
    tool: "bash",
    text: "",
    arg: "bun test packages/server --filter auth",
    stream: [
      "bun test v1.2.8",
      "",
      "packages/server/tests/auth.test.ts:",
      "  ✓ validates valid session token (3ms)",
      "  ✓ rejects expired token (1ms)",
      "  ✓ handles missing bearer prefix (1ms)",
      "  ✓ returns null for invalid signature (2ms)",
      "",
      " 4 pass | 0 fail (42ms)",
    ],
  },
  {
    id: "e8",
    t: 56,
    kind: "note",
    text: "Auth middleware consolidated — 4 tests passing",
  },
  {
    id: "e9",
    t: 60,
    kind: "tool",
    tool: "edit",
    text: "",
    arg: "packages/server/src/routes/api.ts",
    diff: {
      add: 2,
      del: 11,
      preview:
        '-import { checkAuth } from "../utils/auth-check";\n-import { getSession } from "../utils/session";\n+import { validateSession } from "../middleware/auth";',
    },
  },
  {
    id: "e10",
    t: 78,
    kind: "ask",
    text: "The old auth-check.ts and session.ts files are now unused. Should I delete them or keep them around for reference?",
    to: "human",
    answer: "Delete them. We have git history if we need them.",
    answerT: 95,
  },
  {
    id: "e11",
    t: 98,
    kind: "tool",
    tool: "bash",
    text: "",
    arg: "rm packages/server/src/utils/auth-check.ts packages/server/src/utils/session.ts",
    result: { deleted: 2 },
  },
  {
    id: "e12",
    t: 105,
    kind: "tool",
    tool: "bash",
    text: "",
    arg: "bun test packages/server",
    stream: [
      "bun test v1.2.8",
      "",
      "  12 pass | 0 fail (380ms)",
    ],
  },
  {
    id: "e13",
    t: 115,
    kind: "think",
    text: "All tests pass after removing the old files. The auth flow is now centralized in one middleware module. Let me write a summary for the operator.",
    live: true,
  },
  {
    id: "e14",
    t: 120,
    kind: "message",
    text: "Refactored the auth middleware — consolidated validateSession into a single export, removed 2 unused util files, all 12 tests pass. The auth flow now goes through one module instead of four.",
    to: "human",
  },
];

const MOCK_FILES: SessionFile[] = [
  { path: "packages/server/src/middleware/auth.ts", state: "modified", touches: 3, lastT: 30 },
  { path: "packages/server/src/routes/api.ts", state: "modified", touches: 1, lastT: 60 },
  { path: "packages/server/src/utils/auth-check.ts", state: "read", touches: 1, lastT: 14 },
  { path: "packages/server/src/utils/session.ts", state: "read", touches: 1, lastT: 14 },
  { path: "packages/server/tests/auth.test.ts", state: "read", touches: 2, lastT: 105 },
];

const MOCK_CONTEXT: number[] = [
  0.02, 0.04, 0.08, 0.12, 0.18, 0.22, 0.28, 0.32, 0.38, 0.42,
  0.46, 0.50, 0.55, 0.58, 0.62, 0.65, 0.68,
];

/* ── Main component ── */

export function SessionObserve({
  data,
}: {
  data?: SessionObserveData;
}) {
  const { events, files, contextUsage } = data ?? {
    events: MOCK_EVENTS,
    files: MOCK_FILES,
    contextUsage: MOCK_CONTEXT,
    live: true,
  };
  const liveSession = data?.live ?? true;

  const duration = events.length > 0 ? events[events.length - 1].t + 30 : 60;
  const [cursor, setCursor] = useState(duration);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const previousDurationRef = useRef(duration);

  useEffect(() => {
    setCursor((current) => {
      const previousDuration = previousDurationRef.current;
      previousDurationRef.current = duration;
      const wasNearLiveEdge = current >= previousDuration - 20;
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
  const isLive = liveSession && cursor >= duration - 20;

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

        <button className="s-observe-jump-btn" onClick={() => setCursor(duration)}>
          Jump to live ↦
        </button>
      </footer>
    </div>
  );
}
