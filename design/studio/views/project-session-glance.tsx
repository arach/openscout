"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Projects · Session Glance

   The two-band selected-session treatment under a stable project header,
   per docs/design/project-session-glance-proposal.md. The project header is
   identical across scenarios (that is the point); only Bands A/B and the
   selected-session signal panel change with the selected session.

   Band A — masthead: Sessions ▸ title · state/recency, one mono meta line
            (agent · harness · model · branch · started · duration · turn).
   Band B — vitals strip: turns/tools/edits/files · one static context bar ·
            collapsed token total. Tokens expand to a proportional bar with
            the legend BELOW it (never labels inside segments). No sparkline;
            per-turn context history is synthetic today, so no trend chart.
   Signals — files changed, tools/context/topology, and recent agent-to-agent
             threads. No transcript replay in the glance.
   ─────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import styles from "./project-session-glance.module.css";

type TokenBucket = { key: "input" | "cache-read" | "cache-write" | "output"; label: string; display: string; value: number };

type FileSignal = { path: string; kind: "read" | "modified" | "new"; detail: string };

type ToolSignal = { name: string; value: string; detail: string };

type ContextSignal = { label: string; value: string; detail: string; tone?: "warn" | "good" };

type ThreadSignal = { title: string; channel: string; state: string; ago: string; participants: string; why: string };

type Scenario = {
  id: string;
  tab: string;
  note: string;
  title: string;
  live: boolean;
  stateLabel: string; // "live · last 7s" | "ended 3d ago"
  agent: string;
  harness: string;
  model: string;
  branch: string;
  started: string;
  duration: string;
  turn: number | null;
  turns: string;
  tools: string;
  edits: string;
  files: string;
  filesDetail: string | null;
  worktree: string | null; // shown only when cwd ≠ project root
  ctxPct: number | null;
  tokenTotal: string | null; // null = no usage metadata → telemetry hidden
  buckets: TokenBucket[];
  filesChanged: FileSignal[];
  toolsUsed: ToolSignal[];
  contextSignals: ContextSignal[];
  threads: ThreadSignal[];
};

const SCENARIOS: Scenario[] = [
  {
    id: "live-cache-heavy",
    tab: "1 · Live codex",
    note: "Live Codex session, cache-read dominates input — the screenshot case. Context 77% (below the amber threshold).",
    title: "Session token telemetry pass",
    live: true,
    stateLabel: "live · last 7s",
    agent: "@codex-seneca",
    harness: "codex",
    model: "gpt-5.x",
    branch: "codex/project-session-token-telemetry",
    started: "started 22:14",
    duration: "14h 18m",
    turn: 30,
    turns: "30",
    tools: "1.2k",
    edits: "0",
    files: "—",
    filesDetail: null,
    worktree: null,
    ctxPct: 77,
    tokenTotal: "93.1m",
    buckets: [
      { key: "input", label: "input", display: "4.8m", value: 4.8 },
      { key: "cache-read", label: "cache rd", display: "87.1m", value: 87.1 },
      { key: "cache-write", label: "cache wr", display: "780k", value: 0.78 },
      { key: "output", label: "output", display: "412k", value: 0.41 },
    ],
    filesChanged: [
      { path: "packages/agent-sessions/src/history.ts", kind: "modified", detail: "host metadata projection" },
      { path: "packages/agent-sessions/src/adapters/codex/adapter.ts", kind: "modified", detail: "live stream projection" },
      { path: "design/studio/views/project-session-glance.tsx", kind: "read", detail: "visual study source" },
    ],
    toolsUsed: [
      { name: "read", value: "312", detail: "repo + history inspection" },
      { name: "bash", value: "51", detail: "focused verification" },
      { name: "apply_patch", value: "7", detail: "source edits" },
    ],
    contextSignals: [
      { label: "context", value: "77%", detail: "under warning threshold" },
      { label: "budget", value: "65% / 7d", detail: "codex subscription window" },
      { label: "topology", value: "parent → current", detail: "continued from project review" },
    ],
    threads: [
      { title: "Project session navigation review", channel: "project-seneca", state: "answered", ago: "2h", participants: "@arach ↔ @claude-code", why: "same branch and same component" },
      { title: "Design study handoff", channel: "project-seneca", state: "working", ago: "19s", participants: "@codex ↔ @claude-code", why: "studio artifact in progress" },
    ],
  },
  {
    id: "ended-no-usage",
    tab: "2 · Ended claude",
    note: "Ended Claude session with no usage metadata — token telemetry and context bar are absent, but files and the final coordination thread still give the glance useful shape.",
    title: "Inspector polish pass",
    live: false,
    stateLabel: "ended · 3d ago",
    agent: "@claude-main",
    harness: "claude",
    model: "opus-4.8",
    branch: "main",
    started: "started Jun 30",
    duration: "42m",
    turn: 12,
    turns: "12",
    tools: "84",
    edits: "6",
    files: "9",
    filesDetail: "6 mod · 3 read",
    worktree: null,
    ctxPct: null,
    tokenTotal: null,
    buckets: [],
    filesChanged: [
      { path: "packages/web/client/scout/slots/Inspector.tsx", kind: "modified", detail: "spacing normalization" },
      { path: "packages/web/client/scout/slots/inspector.css", kind: "modified", detail: "density cleanup" },
    ],
    toolsUsed: [
      { name: "edit", value: "6", detail: "component polish" },
      { name: "typecheck", value: "1", detail: "green before handoff" },
    ],
    contextSignals: [
      { label: "context", value: "n/a", detail: "usage metadata unavailable" },
      { label: "repo", value: "clean", detail: "no worktree divergence", tone: "good" },
    ],
    threads: [
      { title: "Inspector design pass", channel: "project-review", state: "closed", ago: "3d", participants: "@arach ↔ @claude-main", why: "final decision thread" },
    ],
  },
  {
    id: "worktree-diverged",
    tab: "3 · Worktree",
    note: "Session running in a separate worktree — the WORKTREE field appears only because cwd ≠ project root. Context 86% crosses the amber threshold; topology and coordination threads carry the extra signal.",
    title: "Harness families readout wiring",
    live: true,
    stateLabel: "live · last 41s",
    agent: "@vega",
    harness: "codex",
    model: "gpt-5.x",
    branch: "feat/harness-families",
    started: "started 09:02",
    duration: "3h 40m",
    turn: 58,
    turns: "58",
    tools: "412",
    edits: "23",
    files: "14",
    filesDetail: "11 mod · 3 new",
    worktree: "~/dev/openscout-wt/harness-families",
    ctxPct: 86,
    tokenTotal: "8.2m",
    buckets: [
      { key: "input", label: "input", display: "1.1m", value: 1.1 },
      { key: "cache-read", label: "cache rd", display: "6.7m", value: 6.7 },
      { key: "cache-write", label: "cache wr", display: "310k", value: 0.31 },
      { key: "output", label: "output", display: "96k", value: 0.096 },
    ],
    filesChanged: [
      { path: "packages/agent-sessions/src/model-window-registry.ts", kind: "modified", detail: "window metadata" },
      { path: "packages/web/client/screens/ops/runtime.tsx", kind: "modified", detail: "harness readout" },
      { path: "packages/protocol/src/harness.ts", kind: "new", detail: "shared shape" },
    ],
    toolsUsed: [
      { name: "grep", value: "96", detail: "call-site migration" },
      { name: "test", value: "14", detail: "model window coverage" },
      { name: "lint fence", value: "1", detail: "sync-exec guard" },
    ],
    contextSignals: [
      { label: "context", value: "86%", detail: "approaching threshold", tone: "warn" },
      { label: "worktree", value: "diverged", detail: "cwd differs from project root", tone: "warn" },
      { label: "topology", value: "M3 child", detail: "stacked under runtime cleanup" },
    ],
    threads: [
      { title: "Harness families schema sketch", channel: "sco-078-m3", state: "accepted", ago: "1d", participants: "@arach ↔ @codex", why: "same branch lineage" },
      { title: "Runtime probe migration", channel: "sco-078-m3", state: "verified", ago: "3h", participants: "@claude-code ↔ @codex", why: "migration evidence" },
    ],
  },
];

const SEG_FLOOR = 0.035;

function StableProjectHeader() {
  return (
    <header className={styles.projectHead}>
      <div className={styles.projectIdent}>
        <span className={styles.projectKind}>Project</span>
        <h2 className={styles.projectTitle}>/openscout</h2>
        <span className={styles.projectRoot}>~/dev/openscout</span>
        <span className={styles.projectDigest}>
          <b>1 moving</b> · 30 conversations
        </span>
      </div>
      <nav className={styles.facets} aria-label="Project sections">
        <button type="button" className={styles.facet}>Overview</button>
        <button type="button" className={styles.facet} data-on>
          Sessions <b>112</b>
        </button>
        <button type="button" className={styles.facet}>
          Agents <b>10</b>
        </button>
        <button type="button" className={styles.facet}>
          Worktrees <b>2</b>
        </button>
        <button type="button" className={styles.facet}>
          Rules <b>set</b>
        </button>
      </nav>
    </header>
  );
}

function Masthead({ s }: { s: Scenario }) {
  return (
    <section className={styles.masthead} aria-label="Selected session">
      <div className={styles.mastTop}>
        <span className={styles.crumb}>Sessions ▸</span>
        <h3 className={styles.mastTitle} title={s.title}>{s.title}</h3>
        <span className={styles.mastState}>
          {s.live ? <span className={styles.liveDot} aria-hidden /> : null}
          {s.stateLabel}
        </span>
      </div>
      <div className={styles.mastMeta}>
        <span className={styles.metaStrong}>{s.agent}</span>
        <span>{s.harness}</span>
        <span>{s.model}</span>
        <span title={s.branch}>{s.branch}</span>
        <span>{s.started}</span>
        <span>{s.duration}</span>
        {s.turn != null ? <span>turn {s.turn}</span> : null}
      </div>
    </section>
  );
}

function Vital({ label, value, detail, title }: { label: string; value: string; detail?: string | null; title?: string }) {
  return (
    <span className={styles.vital} title={title}>
      <span>{label}</span>
      <b>{value}</b>
      {detail ? <small>{detail}</small> : null}
    </span>
  );
}

function Vitals({ s, tokensOpen, onToggleTokens }: { s: Scenario; tokensOpen: boolean; onToggleTokens: () => void }) {
  const warn = s.ctxPct != null && s.ctxPct >= 80;
  return (
    <section className={styles.vitals} aria-label="Session vitals">
      <Vital label="Turns" value={s.turns} />
      <Vital label="Tools" value={s.tools} />
      <Vital label="Edits" value={s.edits} />
      <Vital label="Files" value={s.files} detail={s.filesDetail} />
      {s.worktree ? <Vital label="Worktree" value={s.worktree} title="Session cwd differs from the project root" /> : null}
      {s.ctxPct != null ? (
        <span className={`${styles.vital} ${styles.ctxVital}`} title="Context window usage — static, no synthetic trend">
          <span>Ctx</span>
          <span className={styles.ctxBar} aria-hidden>
            <span className={styles.ctxFill} data-warn={warn || undefined} style={{ width: `${s.ctxPct}%` }} />
          </span>
          <b data-warn={warn || undefined}>{s.ctxPct}%</b>
        </span>
      ) : null}
      {s.tokenTotal ? (
        <button type="button" className={styles.tokensToggle} onClick={onToggleTokens} aria-expanded={tokensOpen}>
          <span>Tokens</span>
          <b>{s.tokenTotal}</b>
          <i>{tokensOpen ? "▾" : "▸"}</i>
        </button>
      ) : null}
    </section>
  );
}

const SEG_COLOR: Record<TokenBucket["key"], string> = {
  input: "#4a5731",
  "cache-read": "#66783f",
  "cache-write": "#3a4229",
  output: "#3c4552",
};

function TokenSplit({ buckets }: { buckets: TokenBucket[] }) {
  const total = buckets.reduce((sum, b) => sum + b.value, 0);
  return (
    <section className={styles.tokenSplit} aria-label="Token split">
      <div className={styles.tokenBar}>
        {buckets.map((b) => (
          <span
            key={b.key}
            className={styles.tokenSeg}
            data-kind={b.key}
            style={{ flexGrow: total > 0 ? Math.max(SEG_FLOOR, b.value / total) : 1, flexBasis: 0 }}
            title={`${b.label}: ${b.display}`}
          />
        ))}
      </div>
      <div className={styles.tokenLegend}>
        {buckets.map((b) => (
          <span key={b.key}>
            <span className={styles.swatch} style={{ background: SEG_COLOR[b.key] }} aria-hidden />
            {b.label} <b>{b.display}</b>
          </span>
        ))}
      </div>
    </section>
  );
}

function SignalPanel({ s }: { s: Scenario }) {
  return (
    <section className={styles.signalPanel} aria-label="Session work signals">
      <div className={styles.signalColumn}>
        <div className={styles.signalHead}>
          <span>Files</span>
          <b>{s.filesChanged.length}</b>
        </div>
        <div className={styles.fileList}>
          {s.filesChanged.map((file) => (
            <div key={file.path} className={styles.fileRow}>
              <span data-kind={file.kind}>{file.kind}</span>
              <code title={file.path}>{file.path}</code>
              <small>{file.detail}</small>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.signalColumn}>
        <div className={styles.signalHead}>
          <span>Tools · Context · Topology</span>
        </div>
        <div className={styles.toolGrid}>
          {s.toolsUsed.map((tool) => (
            <span key={tool.name} className={styles.toolPill} title={tool.detail}>
              <b>{tool.name}</b>
              <em>{tool.value}</em>
            </span>
          ))}
        </div>
        <div className={styles.contextList}>
          {s.contextSignals.map((signal) => (
            <div key={`${signal.label}-${signal.value}`} className={styles.contextRow}>
              <span>{signal.label}</span>
              <b data-tone={signal.tone}>{signal.value}</b>
              <small>{signal.detail}</small>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.signalColumn}>
        <div className={styles.signalHead}>
          <span>Recent threads</span>
          <b>{s.threads.length}</b>
        </div>
        <div className={styles.threadList}>
          {s.threads.map((thread) => (
            <button key={`${thread.channel}-${thread.title}`} type="button" className={styles.threadRow}>
              <span className={styles.threadTitle}>{thread.title}</span>
              <span className={styles.threadMeta}>
                <b>{thread.channel}</b>
                <em>{thread.state}</em>
                <small>{thread.ago}</small>
              </span>
              <span className={styles.threadWhy}>{thread.participants} · {thread.why}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function ProjectSessionGlanceStudy() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]!.id);
  const [narrow, setNarrow] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0]!;

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <div className={styles.study}>
        <div className={styles.controls}>
          <div className={styles.tabs} role="tablist" aria-label="Scenario">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                className={styles.tab}
                data-on={scenarioId === s.id || undefined}
                aria-selected={scenarioId === s.id}
                onClick={() => {
                  setScenarioId(s.id);
                  setTokensOpen(false);
                }}
              >
                {s.tab}
              </button>
            ))}
          </div>
          <div className={styles.tabs} role="group" aria-label="Frame width">
            <button type="button" className={styles.tab} data-on={!narrow || undefined} onClick={() => setNarrow(false)}>
              Full
            </button>
            <button type="button" className={styles.tab} data-on={narrow || undefined} onClick={() => setNarrow(true)}>
              Narrow 420
            </button>
          </div>
        </div>

        <p className={styles.note}>{scenario.note}</p>

        <div className={styles.frame} data-narrow={narrow || undefined}>
          <StableProjectHeader />
          <Masthead s={scenario} />
          <Vitals s={scenario} tokensOpen={tokensOpen} onToggleTokens={() => setTokensOpen((open) => !open)} />
          {tokensOpen && scenario.buckets.length > 0 ? <TokenSplit buckets={scenario.buckets} /> : null}
          <SignalPanel s={scenario} />
        </div>
      </div>
    </main>
  );
}
