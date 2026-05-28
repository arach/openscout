/**
 * HUD Compose · Send (optimistic) — study
 *
 * Shows the four-moment chain of the HUD's bottom-bar compose dock
 * after the optimistic-clear fix:
 *
 *   t0  focused, empty
 *   t1  text in field, SEND lit
 *   t2  return — field clears, echo lands in thread, SEND dims (in-flight)
 *   t3  reply lands, SEND back to idle
 *
 * The fix moved `text = ""` to BEFORE the `await postToBroker(...)`. The
 * compose service already appended the echo synchronously; the field
 * stayed wedged with the typed text only because the dock waited for
 * the network confirmation before clearing. On a slow/wedged broker
 * that read as "didn't send."
 *
 * Source:
 *   apps/macos/Sources/HUD/HUDDockState.swift   (send())
 *   apps/macos/Sources/Services/HudComposeService.swift (send(), local echo)
 *   apps/macos/Sources/HUD/HudMessageDock.swift (CompactDock / MediumLargeDock)
 */

import type { CSSProperties, ReactNode } from "react";

// ── HUD tokens (mirrors apps/macos/Sources/HUD/HUDChrome.swift) ──────

const HUD_TOKENS: CSSProperties = {
  ["--hud-canvas" as string]: "rgb(11, 10, 9)",
  ["--hud-canvas-alt" as string]: "rgb(20, 18, 16)",
  ["--hud-canvas-lift" as string]: "rgb(40, 36, 31)",
  ["--hud-ink" as string]: "rgb(231, 228, 220)",
  ["--hud-ink-muted" as string]: "rgb(179, 174, 165)",
  ["--hud-ink-faint" as string]: "rgb(128, 124, 116)",
  ["--hud-ink-deep" as string]: "rgb(97, 93, 87)",
  ["--hud-border-rim" as string]: "rgba(101, 94, 82, 0.55)",
  ["--hud-accent" as string]: "rgb(148, 227, 107)",
  ["--hud-accent-soft" as string]: "rgba(148, 227, 107, 0.14)",
  ["--hud-accent-whisper" as string]: "rgba(148, 227, 107, 0.06)",
};

// ── Frame model ──────────────────────────────────────────────────────

type FrameKey = "idle" | "typing" | "sent" | "replied";

interface ChatMsg {
  who: "you" | "scout";
  body: ReactNode;
  at: string;
  /** When set, the message just landed (fade-in tint). */
  fresh?: boolean;
}

interface Frame {
  key: FrameKey;
  time: string;
  caption: string;
  thread: ChatMsg[];
  fieldText: string;
  /** SEND chip color. */
  sendState: "dim" | "lit" | "inflight";
  /** Show a faint caret in the field. */
  caret: boolean;
}

const OPERATOR_ECHO: ChatMsg = {
  who: "you",
  body: "hey, status on the migration?",
  at: "14:32",
  fresh: true,
};

const OPERATOR_ECHO_LONG: ChatMsg = {
  who: "you",
  body: (
    <>
      hey, status on the migration? if the broker is wedged again can you also
      poke{" "}
      <span
        style={{
          color: "var(--hud-accent)",
          fontWeight: 600,
        }}
      >
        @hudson
      </span>{" "}
      before you call it a night
    </>
  ),
  at: "14:32",
  fresh: true,
};

const SCOUTBOT_REPLY: ChatMsg = {
  who: "scout",
  body: (
    <>
      broker came back at 14:31 — last journal entry was{" "}
      <span style={{ color: "var(--hud-ink)", fontWeight: 500 }}>
        scout-web 22683
      </span>
      . pinged{" "}
      <span style={{ color: "var(--hud-accent)", fontWeight: 600 }}>
        @hudson
      </span>{" "}
      on the migration thread, they&rsquo;re waiting on a review.
    </>
  ),
  at: "14:32",
  fresh: true,
};

// Two prior turns establishing the conversation context.
const PRIOR: ChatMsg[] = [
  {
    who: "you",
    body: "drop a note when the broker is back",
    at: "14:30",
  },
  {
    who: "scout",
    body: (
      <>
        <span style={{ color: "var(--hud-accent)" }}>Heard:</span> drop a
        note when the broker is back
      </>
    ),
    at: "14:30",
  },
];

const FRAMES: Frame[] = [
  {
    key: "idle",
    time: "t₀",
    caption: "focused, empty",
    thread: PRIOR,
    fieldText: "",
    sendState: "dim",
    caret: true,
  },
  {
    key: "typing",
    time: "t₁",
    caption: "typed, SEND lit — input grew to fit",
    thread: PRIOR,
    fieldText:
      "hey, status on the migration? if the broker is wedged again can you also poke @hudson before you call it a night",
    sendState: "lit",
    caret: true,
  },
  {
    key: "sent",
    time: "t₂",
    caption: "↵ — input snaps back, echo lands, SEND dims",
    thread: [...PRIOR.slice(-1), OPERATOR_ECHO_LONG],
    fieldText: "",
    sendState: "inflight",
    caret: false,
  },
  {
    key: "replied",
    time: "t₃",
    caption: "reply arrives, SEND idle again",
    thread: [{ ...OPERATOR_ECHO, fresh: false }, SCOUTBOT_REPLY],
    fieldText: "",
    sendState: "dim",
    caret: true,
  },
];

// ── Page ─────────────────────────────────────────────────────────────

export default function HUDComposeSendStudy() {
  return (
    <main className="mx-auto max-w-page px-7 py-8" style={HUD_TOKENS}>
      <Header />
      <TimelineRow />
      <TurnsHistory />
      <Anatomy />
    </main>
  );
}

// ── Header ───────────────────────────────────────────────────────────

function Header() {
  return (
    <div className="mb-8 border-b border-studio-edge pb-5">
      <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · openscout · macos · hud
      </div>
      <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
        Compose · Send
      </h1>
      <p className="mt-3 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
        The HUD bottom bar treats <em className="not-italic text-studio-ink">send</em>{" "}
        as a local act, not a network confirmation. On return, the field
        clears, the echo lands in the thread, and the SEND chip dims while
        the round-trip resolves in the background. A slow or wedged broker
        no longer reads as &ldquo;didn&rsquo;t send.&rdquo;
      </p>
    </div>
  );
}

// ── Timeline row ─────────────────────────────────────────────────────

function TimelineRow() {
  return (
    <section className="mb-12">
      <SectionHead title="Four moments" meta="t₀ → t₃" />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        {FRAMES.map((frame, i) => (
          <FrameCard key={frame.key} frame={frame} index={i + 1} />
        ))}
      </div>
    </section>
  );
}

function FrameCard({ frame, index }: { frame: Frame; index: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span
          className="inline-grid h-4 w-4 place-items-center rounded-sm border font-mono text-[9px] font-semibold"
          style={{
            color: "var(--studio-ink-faint)",
            borderColor: "var(--studio-edge)",
          }}
        >
          {index}
        </span>
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.20em] text-studio-ink">
          {frame.time}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          {frame.caption}
        </span>
      </div>

      <HudPanel frame={frame} />
    </div>
  );
}

// ── HUD panel — body + dock ──────────────────────────────────────────

function HudPanel({ frame }: { frame: Frame }) {
  return (
    <div
      className="overflow-hidden rounded-md"
      style={{
        background:
          "linear-gradient(180deg, var(--hud-canvas) 0%, color-mix(in oklab, var(--hud-canvas) 92%, black) 100%)",
        border: "0.5px solid var(--hud-border-rim)",
        boxShadow:
          "0 8px 24px rgba(0,0,0,0.45), inset 0 0 0 0.5px rgba(255,255,255,0.04)",
      }}
    >
      <ThreadColumn messages={frame.thread} />
      <ComposeDock frame={frame} />
    </div>
  );
}

function ThreadColumn({ messages }: { messages: ChatMsg[] }) {
  return (
    <div
      className="flex flex-col gap-3 px-3.5 py-3"
      style={{ minHeight: 142 }}
    >
      {messages.map((msg, i) => (
        <Msg key={i} msg={msg} />
      ))}
    </div>
  );
}

function Msg({ msg }: { msg: ChatMsg }) {
  const isOp = msg.who === "operator";
  return (
    <div
      className="flex flex-col gap-0.5"
      style={{
        opacity: msg.fresh ? 1 : 0.85,
      }}
    >
      <div className="flex items-baseline gap-1.5">
        <span
          className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em]"
          style={{
            color: isOp ? "var(--hud-ink)" : "var(--hud-accent)",
          }}
        >
          {isOp ? "operator" : "@scoutbot"}
        </span>
        <span
          className="font-mono text-[9px] uppercase tracking-eyebrow"
          style={{ color: "var(--hud-ink-deep)" }}
        >
          {msg.at}
        </span>
        {msg.fresh ? (
          <span
            className="ml-1 inline-block h-1 w-1 rounded-full"
            style={{ background: "var(--hud-accent)" }}
            aria-hidden
          />
        ) : null}
      </div>
      <div
        className="font-mono text-[11px] leading-snug"
        style={{
          color: isOp ? "var(--hud-ink)" : "var(--hud-ink-muted)",
        }}
      >
        {msg.body}
      </div>
    </div>
  );
}

function ComposeDock({ frame }: { frame: Frame }) {
  const sendColor =
    frame.sendState === "lit"
      ? "var(--hud-accent)"
      : frame.sendState === "inflight"
        ? "var(--hud-ink-deep)"
        : "var(--hud-ink-faint)";

  // Top-aligned so the chrome (mic / target chip / SEND / ESC) sits with
  // the first line of typed text. The text column grows downward as the
  // user types; the chrome stays put.
  return (
    <div
      className="relative flex items-start gap-2.5 px-3 py-2"
      style={{
        background: "var(--hud-canvas-alt)",
        borderTop: "0.5px solid var(--hud-border-rim)",
        minHeight: 40,
      }}
    >
      <div className="flex shrink-0 items-center gap-2.5" style={{ height: 22 }}>
        <MicGlyph active={false} />
        <TargetChip label="@scout" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5" style={{ paddingTop: 3 }}>
        {frame.fieldText ? (
          <span
            className="whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.55]"
            style={{ color: "var(--hud-ink)" }}
          >
            {frame.fieldText}
            {frame.caret ? <Caret /> : null}
          </span>
        ) : (
          <span className="flex min-w-0 items-baseline gap-1">
            {frame.caret ? <Caret /> : null}
            <span
              className="truncate font-mono text-[10.5px]"
              style={{ color: "var(--hud-ink-deep)", fontStyle: "italic" }}
            >
              talk to the assistant — / for commands
            </span>
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2" style={{ height: 22 }}>
        {frame.sendState === "inflight" ? <InflightSpinner /> : null}
        <SendChip color={sendColor} dim={frame.sendState !== "lit"} />
        <KeyChip label="ESC" />
      </div>
    </div>
  );
}

function MicGlyph({ active }: { active: boolean }) {
  return (
    <div
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full"
      style={{ color: active ? "var(--hud-accent)" : "var(--hud-ink-faint)" }}
      aria-hidden
    >
      <svg width={11} height={11} viewBox="0 0 12 12">
        <rect
          x={4.5}
          y={1.5}
          width={3}
          height={6}
          rx={1.5}
          fill="currentColor"
        />
        <path
          d="M2.5 6c0 2 1.6 3.5 3.5 3.5S9.5 8 9.5 6"
          stroke="currentColor"
          strokeWidth={0.8}
          fill="none"
          strokeLinecap="round"
        />
        <line
          x1={6}
          y1={9.5}
          x2={6}
          y2={11}
          stroke="currentColor"
          strokeWidth={0.8}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function TargetChip({ label }: { label: string }) {
  return (
    <span
      className="shrink-0 rounded-sm px-1.5 py-[1.5px] font-mono text-[9.5px] font-semibold"
      style={{
        color: "var(--hud-accent)",
        border: "0.5px solid color-mix(in oklab, var(--hud-accent) 45%, transparent)",
      }}
    >
      {label}
    </span>
  );
}

function SendChip({ color, dim }: { color: string; dim: boolean }) {
  return (
    <span
      className="flex shrink-0 items-center gap-1 px-1 py-[1.5px] font-mono text-[9.5px] font-semibold"
      style={{ color, opacity: dim ? 0.85 : 1, letterSpacing: "0.16em" }}
    >
      <span>↵</span>
      <span>SEND</span>
    </span>
  );
}

function KeyChip({ label }: { label: string }) {
  return (
    <span
      className="shrink-0 rounded-sm px-1.5 py-[1.5px] font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
      style={{
        color: "var(--hud-ink-faint)",
        border: "0.5px solid color-mix(in oklab, var(--hud-ink-faint) 30%, transparent)",
      }}
    >
      {label}
    </span>
  );
}

function Caret() {
  return (
    <span
      aria-hidden
      className="inline-block align-middle"
      style={{
        width: 1.5,
        height: 11,
        background: "var(--hud-ink)",
        opacity: 0.85,
        marginLeft: 1,
      }}
    />
  );
}

function InflightSpinner() {
  return (
    <span
      className="inline-grid h-3 w-3 shrink-0 place-items-center"
      style={{ color: "var(--hud-ink-faint)" }}
      aria-hidden
    >
      <svg width={10} height={10} viewBox="0 0 10 10">
        <circle
          cx={5}
          cy={5}
          r={3.2}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.9}
          opacity={0.35}
        />
        <path
          d="M5 1.8 A3.2 3.2 0 0 1 8.2 5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeLinecap="round"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 5 5"
            to="360 5 5"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </path>
      </svg>
    </span>
  );
}

// ── Turns / History ──────────────────────────────────────────────────

type Span =
  | { kind: "text"; body: string }
  | { kind: "mention"; body: string }
  | { kind: "cmd"; body: string }
  | { kind: "path"; body: string }
  | { kind: "code"; body: string };

interface Turn {
  who: "you" | "scout";
  at: string;
  spans: Span[];
}

// Conversation deliberately spans real span kinds so the rendering
// vocabulary (mention/cmd/path/code/text) is documented in situ.
const TURNS: Turn[] = [
  {
    who: "you",
    at: "14:18",
    spans: [{ kind: "text", body: "anything from hudson this morning?" }],
  },
  {
    who: "scout",
    at: "14:18",
    spans: [
      { kind: "text", body: "two pings. " },
      { kind: "mention", body: "@hudson" },
      { kind: "text", body: " hit a compile error 7m ago and is waiting on a review of " },
      { kind: "path", body: "apps/macos/Sources/HUD/HudMessageDock.swift" },
      { kind: "text", body: "." },
    ],
  },
  {
    who: "you",
    at: "14:19",
    spans: [
      { kind: "cmd", body: "/find" },
      { kind: "text", body: " send dock clearing" },
    ],
  },
  {
    who: "scout",
    at: "14:19",
    spans: [
      { kind: "text", body: "the clear runs inside " },
      { kind: "code", body: "HUDDockState.send()" },
      { kind: "text", body: " — currently sequenced after the await, which is why slow rounds-trips read as wedged." },
    ],
  },
  {
    who: "you",
    at: "14:31",
    spans: [
      { kind: "text", body: "the migration finished. drop a note when the broker is back." },
    ],
  },
  {
    who: "scout",
    at: "14:32",
    spans: [
      { kind: "text", body: "broker came back at 14:31 — last journal entry was " },
      { kind: "code", body: "scout-web 22683" },
      { kind: "text", body: ". pinged " },
      { kind: "mention", body: "@hudson" },
      { kind: "text", body: " on the migration thread, they're waiting on a review." },
    ],
  },
];

function TurnsHistory() {
  return (
    <section className="mb-12">
      <SectionHead title="Turns" meta="thread · span vocabulary" />

      <div
        className="overflow-hidden rounded-md"
        style={{
          background:
            "linear-gradient(180deg, var(--hud-canvas) 0%, color-mix(in oklab, var(--hud-canvas) 92%, black) 100%)",
          border: "0.5px solid var(--hud-border-rim)",
          boxShadow:
            "0 8px 24px rgba(0,0,0,0.45), inset 0 0 0 0.5px rgba(255,255,255,0.04)",
        }}
      >
        <ThreadHeaderBar />

        <div className="flex flex-col gap-4 px-5 py-5">
          {TURNS.map((turn, i) => (
            <TurnBlock key={i} turn={turn} />
          ))}
        </div>

        <ComposeDock
          frame={{
            key: "idle",
            time: "",
            caption: "",
            thread: [],
            fieldText: "",
            sendState: "dim",
            caret: true,
          }}
        />
      </div>

      <SpanLegend />
    </section>
  );
}

function ThreadHeaderBar() {
  return (
    <div
      className="flex items-center gap-3 px-4"
      style={{
        height: 28,
        background: "var(--hud-canvas-alt)",
        borderBottom: "0.5px solid var(--hud-border-rim)",
      }}
    >
      <span
        className="font-mono text-[9px] font-semibold uppercase tracking-[0.20em]"
        style={{ color: "var(--hud-accent)" }}
      >
        @scout
      </span>
      <span
        className="font-mono text-[9px] uppercase tracking-eyebrow"
        style={{ color: "var(--hud-ink-deep)" }}
      >
        assistant · session 18m
      </span>
      <span className="flex-1" />
      <span
        className="font-mono text-[9px] uppercase tracking-eyebrow"
        style={{ color: "var(--hud-ink-deep)" }}
      >
        6 turns · 14:18 → 14:32
      </span>
    </div>
  );
}

function TurnBlock({ turn }: { turn: Turn }) {
  const isScout = turn.who === "scout";
  const sourceColor = isScout ? "var(--hud-accent)" : "var(--hud-ink)";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="flex h-[14px] w-3 items-center justify-center">
          <SourceGlyph who={turn.who} color={sourceColor} />
        </span>
        <span
          className="font-mono text-[10.5px] font-semibold leading-none"
          style={{ color: sourceColor }}
        >
          @{turn.who}
        </span>
        <span className="flex-1" />
        <span
          className="font-mono text-[9.5px] leading-none"
          style={{ color: "var(--hud-ink-deep)" }}
        >
          {turn.at}
        </span>
      </div>
      <div
        className="font-mono text-[12px] leading-[1.6]"
        style={{ paddingLeft: 18, color: "var(--hud-ink)" }}
      >
        {turn.spans.map((span, i) => (
          <SpanText key={i} span={span} />
        ))}
      </div>
    </div>
  );
}

function SpanText({ span }: { span: Span }) {
  switch (span.kind) {
    case "text":
      return <span style={{ color: "var(--hud-ink)" }}>{span.body}</span>;
    case "mention":
      return (
        <span
          className="font-semibold"
          style={{ color: "var(--hud-accent)" }}
        >
          {span.body}
        </span>
      );
    case "cmd":
      return (
        <span
          className="font-semibold"
          style={{ color: "var(--hud-accent)" }}
        >
          {span.body}
        </span>
      );
    case "path":
      // Mirrors HUDAssistantView.swift's pathColor — rgb(0.420, 0.720, 0.700)
      return (
        <span style={{ color: "rgb(107, 184, 178)" }}>{span.body}</span>
      );
    case "code":
      return (
        <span
          className="font-medium"
          style={{ color: "var(--hud-ink)" }}
        >
          {span.body}
        </span>
      );
  }
}

function SourceGlyph({
  who,
  color,
}: {
  who: "you" | "scout";
  color: string;
}) {
  // Mirrors HUDAssistantView's hand-drawn glyphs: a small robot for
  // @scout, a "you" tick for @you. Stroked, not filled — matches the
  // SwiftUI `.stroke` rendering.
  if (who === "scout") {
    return (
      <svg width={11} height={11} viewBox="0 0 12 12" aria-hidden>
        <rect
          x={2}
          y={4}
          width={8}
          height={6}
          rx={1.5}
          fill="none"
          stroke={color}
          strokeWidth={0.9}
        />
        <line
          x1={6}
          y1={4}
          x2={6}
          y2={2}
          stroke={color}
          strokeWidth={0.9}
          strokeLinecap="round"
        />
        <circle cx={6} cy={1.6} r={0.6} fill={color} />
        <circle cx={4.4} cy={6.6} r={0.7} fill={color} />
        <circle cx={7.6} cy={6.6} r={0.7} fill={color} />
      </svg>
    );
  }
  return (
    <svg width={11} height={11} viewBox="0 0 12 12" aria-hidden>
      <path
        d="M2.5 9.5 C3.5 6.5, 8.5 6.5, 9.5 9.5"
        fill="none"
        stroke={color}
        strokeWidth={1.1}
        strokeLinecap="round"
      />
      <circle
        cx={6}
        cy={4}
        r={1.7}
        fill="none"
        stroke={color}
        strokeWidth={1.1}
      />
    </svg>
  );
}

function SpanLegend() {
  const items: { label: string; sample: ReactNode; note: string }[] = [
    {
      label: "text",
      sample: <span style={{ color: "var(--hud-ink)" }}>plain prose</span>,
      note: "ink, body weight",
    },
    {
      label: "mention",
      sample: (
        <span
          style={{ color: "var(--hud-accent)", fontWeight: 600 }}
          className="font-mono"
        >
          @handle
        </span>
      ),
      note: "accent · mono · semibold",
    },
    {
      label: "cmd",
      sample: (
        <span
          style={{ color: "var(--hud-accent)", fontWeight: 600 }}
          className="font-mono"
        >
          /find
        </span>
      ),
      note: "accent · mono · semibold",
    },
    {
      label: "path",
      sample: (
        <span
          style={{ color: "rgb(107, 184, 178)" }}
          className="font-mono"
        >
          Sources/HUD/…
        </span>
      ),
      note: "teal · mono",
    },
    {
      label: "code",
      sample: (
        <span
          style={{ color: "var(--hud-ink)", fontWeight: 500 }}
          className="font-mono"
        >
          send()
        </span>
      ),
      note: "ink · mono · medium",
    },
  ];

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px]">
      {items.map((item) => (
        <span key={item.label} className="flex items-baseline gap-2">
          <span
            className="font-semibold uppercase tracking-eyebrow"
            style={{ color: "var(--studio-ink-faint)" }}
          >
            {item.label}
          </span>
          <span className="text-[11px]">{item.sample}</span>
          <span style={{ color: "var(--studio-ink-faint)" }}>· {item.note}</span>
        </span>
      ))}
    </div>
  );
}

// ── Anatomy — what each surface owns ─────────────────────────────────

function Anatomy() {
  const items = [
    {
      label: "field",
      owner: "HUDDockState.text",
      role: "clears on intent (return)",
    },
    {
      label: "echo",
      owner: "HudComposeService.assistantThread",
      role: "appended synchronously, before the await",
    },
    {
      label: "SEND chip",
      owner: "HUDDockState.isSending",
      role: "dims while the round-trip resolves",
    },
    {
      label: "error",
      owner: "HUDDockState.lastError",
      role: "surfaced via inline banner; echo stays put",
    },
    {
      label: "reply",
      owner: "HudComposeService.runReplyStream()",
      role: "SSE listener appends scoutbot messages on arrival",
    },
  ];

  return (
    <section>
      <SectionHead title="Anatomy" meta="who owns what after the fix" />

      <div
        className="overflow-hidden rounded-md border"
        style={{ borderColor: "var(--studio-edge)" }}
      >
        <table className="w-full font-mono text-[11px]">
          <thead>
            <tr
              className="text-left"
              style={{
                color: "var(--studio-ink-faint)",
                background: "var(--studio-canvas-alt)",
              }}
            >
              <Th>surface</Th>
              <Th>owner</Th>
              <Th>role</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((row, i) => (
              <tr
                key={row.label}
                style={{
                  borderTop:
                    i === 0 ? "none" : "0.5px solid var(--studio-edge)",
                }}
              >
                <Td bold>{row.label}</Td>
                <Td>{row.owner}</Td>
                <Td muted>{row.role}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="px-3 py-2 font-semibold uppercase tracking-eyebrow text-[9px]">
      {children}
    </th>
  );
}

function Td({
  children,
  bold,
  muted,
}: {
  children: ReactNode;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className="px-3 py-2.5"
      style={{
        color: muted
          ? "var(--studio-ink-faint)"
          : bold
            ? "var(--studio-ink)"
            : "var(--studio-ink-muted)",
        fontWeight: bold ? 600 : 400,
      }}
    >
      {children}
    </td>
  );
}

// ── Section head ─────────────────────────────────────────────────────

function SectionHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {title}
      </div>
      {meta ? (
        <div className="font-mono text-[9px] uppercase tracking-[0.20em] text-studio-ink-faint">
          {meta}
        </div>
      ) : null}
      <div className="ml-3 h-px flex-1 bg-studio-edge" />
    </div>
  );
}
