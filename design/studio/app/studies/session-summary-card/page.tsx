"use client";

import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { HarnessMark } from "@/components/HarnessMark";
import styles from "./page.module.css";

/* ────────────────────────────────────────────────────────────────────────
   Session summary card — one primitive, three sizes.

   About a SESSION (a unit of work), not an agent: the work is the headline,
   the agent demotes to a small attribution line. The body is a compact LOG of
   recent activity — a few timestamped lines, almost a changelog — not a trace
   replay or a lane stream.

     SM — a session row: state · title · agent · ago
     MD — a tile: title, attribution, a few log lines, meta
     LG — the focus pane: + the decision and a longer log

   State drives one accent dot on a precedence ladder: waiting ▸ working ▸ idle.
   ──────────────────────────────────────────────────────────────────────── */

const HARNESS_HUE: Record<string, number> = {
  claude: 28,
  codex: 210,
  grok: 280,
  gemini: 150,
  general: 220,
};

type LogLine = { t: string; text: string; kind?: "tool" | "msg" | "ask" };
type CardSession = {
  /** what the session is doing — the headline */
  title: string;
  /** attribution — demoted, not the headline */
  agent: string;
  harness: string;
  model: string;
  branch: string;
  state: "working" | "waiting" | "idle";
  ago: string;
  /** recent activity, newest last — a compact log, not a trace */
  log: LogLine[];
  ctx: number;
  tokens: string;
  turns: number;
};

const SESSIONS: CardSession[] = [
  {
    title: "Refactor the lane-card resize handlers",
    agent: "Lattices",
    harness: "claude",
    model: "opus-4-8",
    branch: "main",
    state: "waiting",
    ago: "20h",
    log: [
      { t: "−6m", text: "read relayoutGroup(), batchMoveAndRaiseWindows" },
      { t: "−4m", text: "edited RealWindowAnimator — reserve the tail lane" },
      { t: "−3m", text: "ran tsc --noEmit — clean" },
      { t: "now", text: "stalled — stopped waiting for a sync result after 5m", kind: "ask" },
    ],
    ctx: 6,
    tokens: "3.3k",
    turns: 14,
  },
  {
    title: "Split the broker port range across dev and mesh scopes",
    agent: "Grok",
    harness: "grok",
    model: "grok-4.3",
    branch: "port-range-revamp",
    state: "working",
    ago: "now",
    log: [
      { t: "−2m", text: "read broker-daemon.ts, mesh/service.ts" },
      { t: "−1m", text: "moved the port pick behind resolveAdvertiseScope()" },
      { t: "now", text: "adding a fallback sweep when 43110 is taken", kind: "msg" },
    ],
    ctx: 41,
    tokens: "88k",
    turns: 31,
  },
  {
    title: "Migrate the index and roll the old shard table",
    agent: "Dewey",
    harness: "codex",
    model: "gpt-5",
    branch: "main",
    state: "idle",
    ago: "3d",
    log: [
      { t: "−3d", text: "applied the migration, dropped the old shard table" },
      { t: "−3d", text: "ran the suite — 214/214 green" },
      { t: "−3d", text: "wrapped — clean tree, ready for review" },
    ],
    ctx: 18,
    tokens: "52k",
    turns: 22,
  },
];

const dotTone = (s: CardSession["state"]) => (s === "working" ? "live" : s === "waiting" ? "needs" : "idle");
const stateLine = (s: CardSession) =>
  s.state === "waiting" ? `waiting · ${s.ago}` : s.state === "working" ? "working" : `idle · ${s.ago}`;

function Dot({ tone }: { tone: "needs" | "live" | "idle" }) {
  if (tone === "idle") return null;
  return <span className={styles.dot} data-tone={tone} aria-hidden />;
}

function Attribution({ s, avatar }: { s: CardSession; avatar: number }) {
  return (
    <span className={styles.attr}>
      <SpriteAvatar name={s.agent} size={avatar} hue={HARNESS_HUE[s.harness]} tile />
      <span className={styles.attrText}>
        {s.agent} · {s.branch} · {s.model}
      </span>
      <HarnessMark harness={s.harness} size={11} />
    </span>
  );
}

function Log({ s, lines }: { s: CardSession; lines: number }) {
  return (
    <div className={styles.log}>
      {s.log.slice(-lines).map((l, i) => (
        <div key={i} className={styles.logLine} data-kind={l.kind || undefined}>
          <span className={styles.logT}>{l.t}</span>
          <span className={styles.logText}>{l.text}</span>
        </div>
      ))}
    </div>
  );
}

function SummaryCard({ s, size }: { s: CardSession; size: "sm" | "md" | "lg" }) {
  const tone = dotTone(s.state);

  if (size === "sm") {
    return (
      <button type="button" className={styles.card} data-size="sm" data-tone={tone}>
        <Dot tone={tone} />
        <span className={styles.smTitle}>{s.title}</span>
        <span className={styles.smAttr}>{s.agent}</span>
        <span className={styles.ago}>{s.ago}</span>
      </button>
    );
  }

  if (size === "md") {
    return (
      <button type="button" className={styles.card} data-size="md" data-tone={tone}>
        <header className={styles.cardHead}>
          <h3 className={styles.title}>{s.title}</h3>
          <span className={styles.state} data-tone={tone}>
            <Dot tone={tone} />
            {stateLine(s)}
          </span>
        </header>
        <Attribution s={s} avatar={18} />
        <Log s={s} lines={3} />
        <div className={styles.metaRow}>
          <span><span className={styles.metaKey}>ctx</span>{s.ctx}%</span>
          <span><span className={styles.metaKey}>tok</span>{s.tokens}</span>
          <span><span className={styles.metaKey}>turns</span>{s.turns}</span>
        </div>
      </button>
    );
  }

  // lg — the focus pane
  return (
    <section className={styles.card} data-size="lg" data-tone={tone} aria-label={s.title}>
      <header className={styles.cardHead}>
        <h3 className={styles.titleLg}>{s.title}</h3>
        <span className={styles.state} data-tone={tone}>
          <Dot tone={tone} />
          {stateLine(s)}
        </span>
        <button type="button" className={styles.ghostLink}>Open ↗</button>
      </header>
      <Attribution s={s} avatar={20} />

      <div className={styles.decision}>
        <button type="button" className={styles.primary}>
          {s.state === "waiting" ? "Continue" : s.state === "working" ? "Steer" : "Resume"}
        </button>
        <button type="button" className={styles.ghost}>Steer instead</button>
        <button type="button" className={styles.ghost}>Take over</button>
        <span className={styles.metaRow}>
          <span><span className={styles.metaKey}>ctx</span>{s.ctx}%</span>
          <span><span className={styles.metaKey}>tokens</span>{s.tokens} in</span>
          <span><span className={styles.metaKey}>turns</span>{s.turns}</span>
        </span>
      </div>

      <div className={styles.logHead}>
        <span className={styles.logHeadTitle}>Session log</span>
        <span className={styles.logHeadMeta}>last {Math.min(s.log.length, 5)} of {s.log.length}</span>
      </div>
      <Log s={s} lines={5} />
    </section>
  );
}

const SIZES: { key: "sm" | "md" | "lg"; label: string; note: string }[] = [
  { key: "sm", label: "Small", note: "a session row — state · title · agent · ago" },
  { key: "md", label: "Medium", note: "a tile — title, attribution, a few log lines, meta" },
  { key: "lg", label: "Large", note: "the focus pane — title, decision, and a longer session log" },
];

export default function SessionSummaryCardStudy() {
  return (
    <ScoutStudyShell
      pageId="session-summary-card"
      title="Session summary card"
      initialSkin="graphite"
      blurb={
        <>
          One <strong>summary</strong> card for a <strong>session</strong>, three sizes. The work is
          the headline; the agent demotes to a small attribution line. The body is a compact{" "}
          <strong>log</strong> of recent activity — a few timestamped lines, almost a changelog — that{" "}
          <strong>scales down to a session row (SM)</strong> and <strong>up to the focus pane (LG)</strong>.
          A preview, never a trace replay. One accent dot: waiting&nbsp;▸&nbsp;working&nbsp;▸&nbsp;idle.
        </>
      }
    >
      <div className={styles.surface}>
        {SIZES.map((sz) => (
          <section key={sz.key} className={styles.sizeBlock}>
            <div className={styles.sizeHead}>
              <span className={styles.sizeLabel}>{sz.label}</span>
              <span className={styles.sizeKey}>{sz.key.toUpperCase()}</span>
              <span className={styles.sizeNote}>{sz.note}</span>
            </div>
            <div className={styles.cardGrid} data-size={sz.key}>
              {SESSIONS.map((s) => (
                <SummaryCard key={s.title} s={s} size={sz.key} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </ScoutStudyShell>
  );
}
