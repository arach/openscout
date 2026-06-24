"use client";

import { useMemo, useState } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { HarnessMark } from "@/components/HarnessMark";
import styles from "./page.module.css";

/* ────────────────────────────────────────────────────────────────────────
   Agents · detailed roster — the project directory, but each row is a
   session-summary MD card instead of a terse one-line directory row.

   The live roster shows name · branch · "6 instances · 12 conv" · ago — that
   is metadata, not work. Here each agent is a card: the WORK is the headline,
   the agent demotes to a small attribution line, and the body is a compact LOG
   of recent activity — a few timestamped lines, almost a changelog. More
   detail per agent, inline, no drill required.

   The frame above the roster (masthead · digest · find) is lifted from the
   agents-project study. The card material is the session-summary MD card.
   One accent dot on a precedence ladder: waiting ▸ working ▸ idle.
   ──────────────────────────────────────────────────────────────────────── */

const HARNESS_HUE: Record<string, number> = {
  claude: 28,
  codex: 210,
  grok: 280,
  gemini: 150,
  general: 220,
};

type LogLine = { t: string; text: string; kind?: "tool" | "msg" | "ask" };
type Agent = {
  /** what the agent is doing — the headline */
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
  turns: number;
  instances: number;
  conv: number;
};

const AGENTS: Agent[] = [
  {
    title: "Wire the quick-capture overlay readouts to the broker",
    agent: "Talkie",
    harness: "codex",
    model: "gpt-5",
    branch: "quick-capture-live",
    state: "working",
    ago: "now",
    log: [
      { t: "−6m", text: "read QuickCaptureOverlay.swift, BrokerClient.swift" },
      { t: "−4m", text: "edited QuickCaptureOverlay.swift — bind live word count" },
      { t: "now", text: "wiring the partial-transcript subscription", kind: "msg" },
    ],
    ctx: 47,
    turns: 28,
    instances: 6,
    conv: 12,
  },
  {
    title: "Review the transcription pipeline before the Whisper bump",
    agent: "Talkie Arch Review",
    harness: "claude",
    model: "opus-4-8",
    branch: "arch/transcribe-audit",
    state: "waiting",
    ago: "18m",
    log: [
      { t: "−9m", text: "read TranscriptionService.swift, AudioRingBuffer.swift" },
      { t: "−6m", text: "traced the resample path — found a double-copy" },
      { t: "now", text: "flag the buffer reuse before I rewrite it — go ahead?", kind: "ask" },
    ],
    ctx: 33,
    turns: 19,
    instances: 2,
    conv: 7,
  },
  {
    title: "Tighten the diff on the menu-bar recorder refactor",
    agent: "Talkie Review",
    harness: "codex",
    model: "gpt-5",
    branch: "menubar-recorder",
    state: "working",
    ago: "now",
    log: [
      { t: "−5m", text: "read MenuBarController.swift, RecorderState.swift" },
      { t: "−2m", text: "edited RecorderState.swift — collapse the two enums" },
      { t: "now", text: "ran swift build — clean, re-checking the diff", kind: "msg" },
    ],
    ctx: 51,
    turns: 24,
    instances: 4,
    conv: 9,
  },
  {
    title: "Port the clipboard-insert path off the deprecated API",
    agent: "Talkie CB Codex",
    harness: "codex",
    model: "gpt-5",
    branch: "clipboard-insert-rewrite",
    state: "idle",
    ago: "2d",
    log: [
      { t: "−2d", text: "edited ClipboardInserter.swift — NSPasteboard path" },
      { t: "−2d", text: "ran the suite — 96/96 green" },
      { t: "−2d", text: "wrapped — clean tree, ready for review" },
    ],
    ctx: 22,
    turns: 16,
    instances: 3,
    conv: 5,
  },
  {
    title: "Draft the changelog and release notes for 0.4",
    agent: "Talkie Notes",
    harness: "claude",
    model: "haiku-4-5",
    branch: "main",
    state: "idle",
    ago: "5d",
    log: [
      { t: "−5d", text: "read CHANGELOG.md, the last 40 commits" },
      { t: "−5d", text: "drafted the 0.4 section — grouped by surface" },
      { t: "−5d", text: "wrapped — left it staged for a copy pass" },
    ],
    ctx: 14,
    turns: 11,
    instances: 1,
    conv: 4,
  },
];

const HARNESSES = ["codex", "general", "claude"];

const dotTone = (s: Agent["state"]) => (s === "working" ? "live" : s === "waiting" ? "needs" : "idle");
const stateLine = (s: Agent) =>
  s.state === "waiting" ? `waiting · ${s.ago}` : s.state === "working" ? "working" : `idle · ${s.ago}`;

function Dot({ tone }: { tone: "needs" | "live" | "idle" }) {
  if (tone === "idle") return null;
  return <span className={styles.dot} data-tone={tone} aria-hidden />;
}

function IcoSearch() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/* ── one agent, rendered as a session-summary MD card ──────────────────── */
function RosterCard({ a }: { a: Agent }) {
  const tone = dotTone(a.state);
  const live = a.state === "working";
  return (
    <button type="button" className={styles.card} data-tone={tone}>
      <header className={styles.cardHead}>
        <h3 className={styles.title}>{a.title}</h3>
        <span className={styles.state} data-tone={tone}>
          <Dot tone={tone} />
          {stateLine(a)}
        </span>
      </header>

      <span className={styles.attr}>
        <SpriteAvatar name={a.agent} size={18} hue={HARNESS_HUE[a.harness]} tile cornerPulse={live} />
        <span className={styles.attrText}>
          {a.agent} · {a.branch} · {a.model}
        </span>
        <HarnessMark harness={a.harness} size={11} />
      </span>

      <div className={styles.log}>
        {a.log.map((l, i) => (
          <div key={i} className={styles.logLine} data-kind={l.kind || undefined}>
            <span className={styles.logT}>{l.t}</span>
            <span className={styles.logText}>{l.text}</span>
          </div>
        ))}
      </div>

      <div className={styles.metaRow}>
        <span><span className={styles.metaKey}>ctx</span>{a.ctx}%</span>
        <span><span className={styles.metaKey}>turns</span>{a.turns}</span>
        <span className={styles.metaDim}>
          {a.instances} instance{a.instances === 1 ? "" : "s"} · {a.conv} conv
        </span>
      </div>
    </button>
  );
}

/* ── page ──────────────────────────────────────────────────────────────── */
function Roster() {
  const [q, setQ] = useState("");
  const [harness, setHarness] = useState<string | null>(null);
  const [showEph, setShowEph] = useState(false);

  const query = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      AGENTS.filter(
        (a) =>
          (!harness || a.harness === harness) &&
          (!query ||
            a.agent.toLowerCase().includes(query) ||
            a.title.toLowerCase().includes(query) ||
            a.branch.toLowerCase().includes(query) ||
            a.harness.includes(query)),
      ),
    [query, harness],
  );

  return (
    <div className={styles.pane}>
      {/* masthead */}
      <header className={styles.head}>
        <SpriteAvatar name="talkie" size={40} tile />
        <div className={styles.headIdent}>
          <div className={styles.headTop}>
            <h1 className={styles.headName}>talkie</h1>
            <span className={styles.headState}>
              <span className={styles.dot} data-tone="live" aria-hidden /> 3 live
            </span>
          </div>
          <span className={styles.headRoot}>~/dev/talkie</span>
        </div>
        <div className={styles.headActions}>
          <button type="button" className={styles.headGhost}>Steer all</button>
          <button type="button" className={styles.headCta}>＋ New agent</button>
        </div>
      </header>

      {/* digest — one quiet stat line */}
      <div className={styles.digest}>
        <span className={styles.stat}>
          <span className={styles.statNum}>5</span>
          <span className={styles.statLbl}>agents</span>
        </span>
        <span className={styles.stat}>
          <span className={styles.statNum}>42</span>
          <span className={styles.statLbl}>conversations</span>
        </span>
        <span className={styles.stat}>
          <span className={styles.statNum}>3</span>
          <span className={styles.statLbl}>branches in flight</span>
        </span>
        <span className={styles.statMarks}>
          {["codex", "claude"].map((h) => (
            <span key={h} title={h} aria-hidden>
              <HarnessMark harness={h} size={13} />
            </span>
          ))}
        </span>
      </div>

      {/* find — search field + harness toggles */}
      <div className={styles.find}>
        <span className={styles.findIco} aria-hidden><IcoSearch /></span>
        <input
          className={styles.findInput}
          placeholder="Find an agent, branch, or harness…  (⌘K)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className={styles.findFilters}>
          {HARNESSES.map((h) => (
            <button
              key={h}
              type="button"
              className={styles.filter}
              data-on={harness === h || undefined}
              onClick={() => setHarness((cur) => (cur === h ? null : h))}
            >
              <HarnessMark harness={h} size={11} />
              {h}
            </button>
          ))}
        </div>
      </div>

      {/* roster — a stack of MD cards */}
      <div className={styles.main}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Agents</span>
          <span className={styles.sectionMeta}>
            {shown.length} shown{query || harness ? " · filtered" : ""}
          </span>
        </div>

        <div className={styles.roster}>
          {shown.map((a) => (
            <RosterCard key={a.agent} a={a} />
          ))}
          {shown.length === 0 ? <div className={styles.empty}>No agents match.</div> : null}
        </div>

        <div className={styles.ephBlock}>
          <button type="button" className={styles.ephToggle} onClick={() => setShowEph((v) => !v)}>
            <span className={styles.ephCount}>4</span> ephemeral · workflow &amp; clone agents
            <span className={styles.ephCaret}>{showEph ? "▴" : "▾"}</span>
          </button>
        </div>

        <button type="button" className={styles.newAgent}>＋ New agent on this project</button>
      </div>
    </div>
  );
}

export default function AgentsRosterDetailedStudy() {
  return (
    <ScoutStudyShell
      pageId="agents-roster-detailed"
      title="Agents · detailed roster"
      initialSkin="graphite"
      blurb={
        <>
          The project directory, but each roster row is a <strong>session-summary card</strong> instead
          of a terse one-line row. The <strong>work</strong> is the headline; the agent demotes to a
          small attribution line; the body is a compact <strong>log</strong> of recent activity — a few
          timestamped lines, almost a changelog. More detail per agent, inline, no drill required. The
          frame above (masthead · digest · find) is lifted from the project view. One accent dot:
          waiting&nbsp;▸&nbsp;working&nbsp;▸&nbsp;idle.
        </>
      }
    >
      <div className={styles.surface}>
        <Roster />
      </div>
    </ScoutStudyShell>
  );
}
