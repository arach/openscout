"use client";

import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { HarnessMark } from "@/components/HarnessMark";
import styles from "./page.module.css";

/* ────────────────────────────────────────────────────────────────────────
   Session profile — a NORMAL profile page built from the session card.

   The card is no longer a special centered focus pane; it's the PRIMARY
   information of an ordinary profile: a header, a main column (the current
   session as an LG card + a Sessions list of SM rows), and a SECONDARY INFO
   rail (place · runtime · capabilities · talks-to). Same session material,
   normal page furniture around it.
   ──────────────────────────────────────────────────────────────────────── */

const HARNESS_HUE: Record<string, number> = { claude: 28, codex: 210, grok: 280, gemini: 150, general: 220 };

type LogLine = { t: string; text: string; kind?: "tool" | "msg" | "ask" };
type Session = {
  title: string;
  branch: string;
  model: string;
  state: "working" | "waiting" | "idle";
  ago: string;
  log: LogLine[];
  ctx: number;
  tokens: string;
  turns: number;
};

const AGENT = {
  name: "Lattices",
  harness: "claude",
  root: "~/dev/lattices",
  branch: "main",
  model: "opus-4-8",
  live: 1,
  caps: ["Read", "Edit", "Bash", "Grep"],
  talksTo: ["Scout", "Openscout"],
};

const SESSIONS: Session[] = [
  {
    title: "Refactor the lane-card resize handlers",
    branch: "main",
    model: "opus-4-8",
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
    title: "Wire the hyperspace grid snappiness pass",
    branch: "feat/grid-snap",
    model: "opus-4-8",
    state: "working",
    ago: "now",
    log: [
      { t: "−3m", text: "read docs/hyperspace-grid-snappiness.md" },
      { t: "−1m", text: "edited GridMotion — tighten the snap easing" },
      { t: "now", text: "running the snapshot tests", kind: "msg" },
    ],
    ctx: 38,
    tokens: "61k",
    turns: 19,
  },
  {
    title: "Audit the window motion mode transitions",
    branch: "main",
    model: "opus-4-8",
    state: "idle",
    ago: "2d",
    log: [
      { t: "−2d", text: "traced WindowMotionMode across the overlay stack" },
      { t: "−2d", text: "noted three unguarded transitions, filed a brief" },
      { t: "−2d", text: "wrapped — brief posted, nothing in flight" },
    ],
    ctx: 22,
    tokens: "44k",
    turns: 11,
  },
];

const dotTone = (s: Session["state"]) => (s === "working" ? "live" : s === "waiting" ? "needs" : "idle");
const stateLine = (s: Session) =>
  s.state === "waiting" ? `waiting · ${s.ago}` : s.state === "working" ? "working" : `idle · ${s.ago}`;

function Dot({ tone }: { tone: "needs" | "live" | "idle" }) {
  if (tone === "idle") return null;
  return <span className={styles.dot} data-tone={tone} aria-hidden />;
}

function Log({ s, lines }: { s: Session; lines: number }) {
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

/* the session card — LG (primary) and SM (the sessions list) */
function SessionCard({ s, size }: { s: Session; size: "sm" | "lg" }) {
  const tone = dotTone(s.state);

  if (size === "sm") {
    return (
      <button type="button" className={styles.card} data-size="sm" data-tone={tone}>
        <Dot tone={tone} />
        <span className={styles.smTitle}>{s.title}</span>
        <span className={styles.smBranch}>{s.branch}</span>
        <span className={styles.ago}>{s.ago}</span>
      </button>
    );
  }

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
      <div className={styles.cardAttr}>
        <span className={styles.cardAttrText}>{s.branch} · {s.model}</span>
        <HarnessMark harness={AGENT.harness} size={11} />
      </div>
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

export default function SessionProfileStudy() {
  const focused = SESSIONS[0];

  return (
    <ScoutStudyShell
      pageId="session-profile"
      title="Session profile"
      initialSkin="graphite"
      blurb={
        <>
          A <strong>normal profile page</strong> built from the session card. The card is the{" "}
          <strong>primary information</strong>; around it sits ordinary page furniture — a header, a{" "}
          <strong>Sessions</strong> list (SM rows), and a <strong>secondary info</strong> rail
          (place · runtime · capabilities · talks-to). Same session material, real profile chrome.
        </>
      }
    >
      <div className={styles.page}>
        {/* profile header */}
        <header className={styles.head}>
          <SpriteAvatar name={AGENT.name} size={44} hue={HARNESS_HUE[AGENT.harness]} tile cornerPulse />
          <div className={styles.headIdent}>
            <div className={styles.headTop}>
              <h1 className={styles.headName}>{AGENT.name}</h1>
              <HarnessMark harness={AGENT.harness} size={13} />
              <span className={styles.state} data-tone="needs">
                <Dot tone="needs" />
                waiting · 20h
              </span>
            </div>
            <span className={styles.headSub}>{AGENT.root} · {AGENT.branch} · {AGENT.model}</span>
          </div>
          <div className={styles.headActions}>
            <button type="button" className={styles.ghost}>Take over</button>
            <button type="button" className={styles.headCta}>Open ↗</button>
          </div>
        </header>

        <div className={styles.body}>
          {/* main — primary information + the sessions list */}
          <div className={styles.main}>
            <div className={styles.sectionLabel}>Current session</div>
            <SessionCard s={focused} size="lg" />

            <div className={styles.sectionLabel}>Sessions <span className={styles.sectionCount}>{SESSIONS.length}</span></div>
            <div className={styles.sessionList}>
              {SESSIONS.map((s) => (
                <SessionCard key={s.title} s={s} size="sm" />
              ))}
            </div>
          </div>

          {/* secondary info rail */}
          <aside className={styles.aside}>
            <div className={styles.group}>
              <div className={styles.groupHead}>Place</div>
              <div className={styles.kv}><span className={styles.kvKey}>root</span><span className={styles.kvVal}>{AGENT.root}</span></div>
              <div className={styles.kv}><span className={styles.kvKey}>live</span><span className={styles.kvVal}>{AGENT.live} process</span></div>
              <div className={styles.kv}><span className={styles.kvKey}>branch</span><span className={styles.kvVal}>{AGENT.branch}</span></div>
            </div>
            <div className={styles.group}>
              <div className={styles.groupHead}>Runtime</div>
              <div className={styles.kv}><span className={styles.kvKey}>harness</span><span className={styles.kvVal}>{AGENT.harness}</span></div>
              <div className={styles.kv}><span className={styles.kvKey}>model</span><span className={styles.kvVal}>{AGENT.model}</span></div>
            </div>
            <div className={styles.group}>
              <div className={styles.groupHead}>Capabilities</div>
              <div className={styles.caps}>
                {AGENT.caps.map((c) => (
                  <span key={c} className={styles.cap}>{c}</span>
                ))}
              </div>
            </div>
            <div className={styles.group}>
              <div className={styles.groupHead}>Talks to</div>
              <div className={styles.talks}>{AGENT.talksTo.join(" · ")}</div>
            </div>
          </aside>
        </div>
      </div>
    </ScoutStudyShell>
  );
}
