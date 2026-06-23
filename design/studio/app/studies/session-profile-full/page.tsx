"use client";

import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { HarnessMark } from "@/components/HarnessMark";
import styles from "./page.module.css";

/* ────────────────────────────────────────────────────────────────────────
   Session profile — FULL PAGE, framed in the real app window chrome.

   The same session material from /studies/session-profile, but staged inside
   the actual product window: a top nav, a left PROJECTS rail, the profile in
   the center, a right SECONDARY-INFO rail (place · runtime · context · caps),
   and a mono status bar. Secondary info lives ONLY in the right rail — the
   center column is just header + current-session card + sessions list.

   Design only, no app wiring. One accent (--s-accent), spent as the precedence
   dot and the primary CTA. Hierarchy from type weight, spacing, hairlines.
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
  host: "studio.local",
  branch: "main",
  model: "opus-4-8",
  live: 1,
  caps: ["Read", "Edit", "Bash", "Grep"],
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

/* the current session leading the profile — the one waiting on you */
const CURRENT = SESSIONS[0];

const PROJECTS: { slug: string; live: number }[] = [
  { slug: "lattices", live: 1 },
  { slug: "openscout", live: 3 },
  { slug: "pomo", live: 0 },
  { slug: "talkie", live: 1 },
  { slug: "hudson", live: 0 },
  { slug: "og", live: 0 },
  { slug: "scope", live: 0 },
  { slug: "dewey", live: 0 },
  { slug: "atelier", live: 0 },
  { slug: "preframe", live: 0 },
];

const NAV = ["home", "agents", "terminals", "chat", "search", "ops"];

const dotTone = (s: Session["state"]) => (s === "working" ? "live" : s === "waiting" ? "needs" : "idle");
const stateLine = (s: Session) =>
  s.state === "waiting" ? `waiting · ${s.ago}` : s.state === "working" ? "working" : `idle · ${s.ago}`;
const primaryLabel = (s: Session["state"]) =>
  s === "waiting" ? "Continue" : s === "working" ? "Steer" : "Resume";

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

/* the session card — LG (current) and SM (the sessions list) */
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
        <button type="button" className={styles.primary}>{primaryLabel(s.state)}</button>
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

export default function SessionProfileFullStudy() {
  // CONTEXT gauge — reads off the current session.
  const ctxUsed = 61;
  const ctxTotal = 160;
  const ctxPct = Math.round((ctxUsed / ctxTotal) * 100); // 38%

  return (
    <ScoutStudyShell
      pageId="session-profile-full"
      title="Session profile · full page"
      initialSkin="graphite"
      blurb={
        <>
          The <strong>session profile</strong> staged in the real app window — top nav · left{" "}
          <strong>projects</strong> rail · the profile · a right{" "}
          <strong>secondary-info</strong> rail (place · runtime · context · capabilities) · status
          bar. Same session material as <code>/studies/session-profile</code>, framed. Secondary
          info lives only in the right rail; the center is header + current session + sessions list.
        </>
      }
    >
      <div className={styles.surface}>
        {/* ── top nav ──────────────────────────────────────────────────── */}
        <header className={styles.topnav}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden />
            <span className={styles.brandName}>Scout</span>
          </div>
          <nav className={styles.tabs} aria-label="Primary">
            {NAV.map((t) => (
              <button key={t} type="button" className={styles.tab} data-on={t === "agents" || undefined}>
                {t}
              </button>
            ))}
          </nav>
          <button type="button" className={styles.settings}>
            <span className={styles.gear} aria-hidden>⚙</span>
            Settings
          </button>
        </header>

        {/* ── body: rail | center | rail ───────────────────────────────── */}
        <div className={styles.body}>
          {/* left projects rail */}
          <nav className={styles.rail} aria-label="Projects">
            <div className={styles.railHead}>Projects</div>
            {PROJECTS.map((p) => (
              <button
                key={p.slug}
                type="button"
                className={styles.railRow}
                data-selected={p.slug === "lattices" || undefined}
              >
                <SpriteAvatar name={p.slug} size={20} tile />
                <span className={styles.railName} data-idle={p.live === 0 || undefined}>{p.slug}</span>
                {p.live > 0 ? <span className={styles.railCount}>{p.live}</span> : null}
              </button>
            ))}
          </nav>

          {/* center — the profile */}
          <div className={styles.center}>
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
                <button type="button" className={styles.ghost}>Edit config</button>
                <button type="button" className={styles.headCta}>＋ New session</button>
              </div>
            </header>

            <div className={styles.sectionLabel}>Current session</div>
            <SessionCard s={CURRENT} size="lg" />

            <div className={styles.sectionLabel}>
              Sessions <span className={styles.sectionCount}>{SESSIONS.length}</span>
            </div>
            <div className={styles.sessionList}>
              {SESSIONS.map((s) => (
                <SessionCard key={s.title} s={s} size="sm" />
              ))}
            </div>
          </div>

          {/* right secondary-info rail */}
          <aside className={styles.aside}>
            <div className={styles.group}>
              <div className={styles.groupHead}>Place</div>
              <div className={styles.kv}><span className={styles.kvKey}>root</span><span className={styles.kvVal}>{AGENT.root}</span></div>
              <div className={styles.kv}><span className={styles.kvKey}>host</span><span className={styles.kvVal}>{AGENT.host}</span></div>
              <div className={styles.kv}><span className={styles.kvKey}>branch</span><span className={styles.kvVal}>{AGENT.branch}</span></div>
            </div>

            <div className={styles.group}>
              <div className={styles.groupHead}>Runtime</div>
              <div className={styles.kv}><span className={styles.kvKey}>harness</span><span className={styles.kvVal}>{AGENT.harness}</span></div>
              <div className={styles.kv}><span className={styles.kvKey}>model</span><span className={styles.kvVal}>{AGENT.model}</span></div>
            </div>

            <div className={styles.group}>
              <div className={styles.groupHead}>Context</div>
              <div className={styles.gauge} aria-hidden>
                <span className={styles.gaugeFill} style={{ width: `${ctxPct}%` }} />
              </div>
              <div className={styles.gaugeRead}>
                <span className={styles.gaugeNum}>{ctxUsed}k</span>
                <span className={styles.gaugeDim}>/ {ctxTotal}k</span>
                <span className={styles.gaugeSep} aria-hidden>·</span>
                <span className={styles.gaugeDim}>19 turns</span>
              </div>
            </div>

            <div className={styles.group}>
              <div className={styles.groupHead}>Capabilities</div>
              <div className={styles.caps}>
                {AGENT.caps.map((c) => (
                  <span key={c} className={styles.cap}>{c}</span>
                ))}
              </div>
            </div>
          </aside>
        </div>

        {/* ── status bar ───────────────────────────────────────────────── */}
        <footer className={styles.statusbar}>
          <div className={styles.statusLeft}>
            <span className={styles.statusItem}><span className={styles.statusDot} aria-hidden />broker</span>
            <span className={styles.statusItem}>active agents 142</span>
            <span className={styles.statusItem}>mesh</span>
          </div>
          <div className={styles.statusRight}>
            <span className={styles.statusItem}>console</span>
            <span className={styles.statusItem}>02:00</span>
          </div>
        </footer>
      </div>
    </ScoutStudyShell>
  );
}
