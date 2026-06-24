"use client";

import { useState } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import styles from "./agents-session-expand.module.css";

/* ────────────────────────────────────────────────────────────────────────
   Agents · session-expand — the directory as a project → agent → session
   spine where SESSIONS are the core, discoverable flow AND every fact you'd
   want to scan is right there, not in a side rail or a separate page.

   A collapsed session is still scannable — under the headline a quiet meta
   line carries branch · id · files · peers. Opening one expands IN PLACE
   into the full instrument: session id, the work, context, tools, recent
   FILES touched, who it's been TALKING TO, subagents, transcript, and a
   state-aware steer/resume.

   Two rationed tones: emerald = identity / done / healthy; amber = active /
   running / attention. Precedence reads on the SESSION dot, not the agent.
   ──────────────────────────────────────────────────────────────────────── */

type Status = "running" | "done" | "idle";
type Tool = { name: string; n: number };
type Subagent = { name: string; task: string; status: Status };
type FileTouch = { path: string; dir: string; state: "created" | "modified" | "read"; n: number };
type Peer = { handle: string; msgs: number; live?: boolean };

type Session = {
  id: string;
  /** the work — the headline (a topic, not dialogue) */
  title: string;
  status: Status;
  branch: string;
  model: string;
  ctx: number;
  ago: string;
  subagents?: number;
  files: number;
  peers: number;
  detail: {
    started: string;
    duration: string;
    turns: number;
    ctxUsed: number;
    ctxTotal: number;
    tokensIn: string;
    tokensOut: string;
    cache: string;
    toolCalls: number;
    tools: Tool[];
    agents: Subagent[];
    fileList: FileTouch[];
    talksTo: Peer[];
    /** running sessions show what they're doing right now */
    activity?: string;
  };
};

const AGENT = { handle: "lattices", branch: "main", dot: "done" as Status, host: "studio.local" };

const SESSIONS: Session[] = [
  {
    id: "a1c4f9",
    title:
      "Sanity-check the Talkie macOS hotkey regression — Caps Lock remapped to Hyper stops firing capture after the wake",
    status: "done",
    branch: "fix/hotkey-wake",
    model: "opus-4.8",
    ctx: 71,
    ago: "5h",
    subagents: 2,
    files: 5,
    peers: 2,
    detail: {
      started: "5h ago",
      duration: "38m",
      turns: 8,
      ctxUsed: 142,
      ctxTotal: 200,
      tokensIn: "118k",
      tokensOut: "24k",
      cache: "86k",
      toolCalls: 56,
      tools: [
        { name: "read", n: 28 },
        { name: "edit", n: 9 },
        { name: "bash", n: 11 },
        { name: "grep", n: 6 },
        { name: "write", n: 2 },
      ],
      agents: [
        { name: "repro-runner", task: "reproduce + bisect", status: "done" },
        { name: "patch-writer", task: "write the fix", status: "done" },
      ],
      fileList: [
        { path: "RealWindowAnimator.swift", dir: "apps/mac/Sources/Core/", state: "modified", n: 12 },
        { path: "HotkeyManager.swift", dir: "apps/mac/Sources/Input/", state: "modified", n: 8 },
        { path: "hotkey-wake.md", dir: "docs/", state: "created", n: 3 },
        { path: "WindowTiler.swift", dir: "apps/mac/Sources/Core/", state: "read", n: 5 },
        { path: "DiagnosticLog.swift", dir: "apps/mac/Sources/Util/", state: "read", n: 2 },
      ],
      talksTo: [
        { handle: "hudson", msgs: 4, live: true },
        { handle: "talkie", msgs: 1 },
      ],
    },
  },
  {
    id: "7b20e3",
    title: "routability probe — verify relay reaches all four peers after the mesh restart",
    status: "idle",
    branch: "main",
    model: "opus-4.8",
    ctx: 9,
    ago: "1d",
    files: 2,
    peers: 1,
    detail: {
      started: "1d ago",
      duration: "12m",
      turns: 4,
      ctxUsed: 18,
      ctxTotal: 200,
      tokensIn: "14k",
      tokensOut: "3k",
      cache: "9k",
      toolCalls: 11,
      tools: [
        { name: "read", n: 6 },
        { name: "bash", n: 4 },
        { name: "grep", n: 1 },
      ],
      agents: [],
      fileList: [
        { path: "relay.ts", dir: "packages/net/src/", state: "read", n: 4 },
        { path: "mesh-router.ts", dir: "packages/net/src/", state: "read", n: 3 },
      ],
      talksTo: [{ handle: "pages-tail", msgs: 2 }],
    },
  },
  {
    id: "019ef2",
    title: "tmux session routing — sessions spawned from voice command land in the wrong pane group",
    status: "running",
    branch: "feat/tmux-panes",
    model: "opus-4.8",
    ctx: 32,
    ago: "12m",
    subagents: 1,
    files: 3,
    peers: 2,
    detail: {
      started: "12m ago",
      duration: "12m · live",
      turns: 6,
      ctxUsed: 64,
      ctxTotal: 200,
      tokensIn: "52k",
      tokensOut: "9k",
      cache: "31k",
      toolCalls: 19,
      tools: [
        { name: "read", n: 9 },
        { name: "edit", n: 4 },
        { name: "bash", n: 5 },
        { name: "grep", n: 1 },
      ],
      agents: [{ name: "pane-mapper", task: "map panes → voice groups", status: "running" }],
      fileList: [
        { path: "TmuxRouter.swift", dir: "apps/mac/Sources/Term/", state: "modified", n: 7 },
        { path: "PaneGroup.swift", dir: "apps/mac/Sources/Term/", state: "modified", n: 4 },
        { path: "VoiceCommand.swift", dir: "apps/mac/Sources/Voice/", state: "read", n: 3 },
      ],
      talksTo: [
        { handle: "pages-tail", msgs: 3, live: true },
        { handle: "hudson", msgs: 1 },
      ],
      activity: "mapping panes to the voice-command groups…",
    },
  },
];

const STATUS_LABEL: Record<Status, string> = { running: "RUNNING", done: "DONE", idle: "IDLE" };
const FILE_MARK: Record<FileTouch["state"], string> = { created: "+", modified: "~", read: "·" };
const TOOL_GLYPH: Record<string, string> = { read: "▤", edit: "✎", bash: ">_", grep: "⌕", write: "+" };

function Tri({ open }: { open: boolean }) {
  return (
    <span className={styles.tri} data-open={open || undefined} aria-hidden>
      ▸
    </span>
  );
}

function Dot({ tone }: { tone: Status }) {
  return <span className={styles.dot} data-tone={tone} aria-hidden />;
}

function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={styles.badge} data-tone={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Block({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <span className={styles.blockLbl}>{label}</span>
        {meta ? <span className={styles.blockMeta}>{meta}</span> : null}
      </div>
      {children}
    </div>
  );
}

function SessionDetail({ s }: { s: Session }) {
  const d = s.detail;
  const pct = Math.round((d.ctxUsed / d.ctxTotal) * 100);
  const running = s.status === "running";
  const stats: Array<[string, string]> = [
    ["session", `#${s.id}`],
    ["branch", s.branch],
    ["model", s.model],
    ["started", d.started],
    ["duration", d.duration],
    ["turns", `${d.turns}`],
  ];
  return (
    <div className={styles.card}>
      {running && d.activity ? (
        <div className={styles.activity}>
          <span className={styles.activityDot} aria-hidden />
          <span className={styles.activityText}>{d.activity}</span>
        </div>
      ) : null}

      <div className={styles.statGrid}>
        {stats.map(([k, v]) => (
          <div key={k} className={styles.stat}>
            <span className={styles.statKey}>{k}</span>
            <span className={styles.statVal} data-mono={k === "session" || undefined}>
              {v}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.cardCols}>
        <div className={styles.ctxBlock}>
          <div className={styles.blockHead}>
            <span className={styles.blockLbl}>context window</span>
            <span className={styles.ctxRead}>
              <span className={styles.ctxNum}>{d.ctxUsed}k</span>
              <span className={styles.ctxDim}> / {d.ctxTotal}k</span>
              <span className={styles.ctxSep}>·</span>
              <span className={styles.ctxPct}>{pct}%</span>
            </span>
          </div>
          <div className={styles.gauge} aria-hidden>
            <span className={styles.gaugeFill} style={{ width: `${pct}%` }} />
          </div>
          <div className={styles.ctxFlow}>
            <span>↑{d.tokensIn} in</span>
            <span>↓{d.tokensOut} out</span>
            <span className={styles.ctxCache}>cache {d.cache}</span>
          </div>
        </div>

        <Block label="tools used" meta={`${d.toolCalls} calls`}>
          <div className={styles.tools}>
            {d.tools.map((t) => (
              <span key={t.name} className={styles.tool}>
                <span className={styles.toolIcon} aria-hidden>
                  {TOOL_GLYPH[t.name] ?? "·"}
                </span>
                <span className={styles.toolName}>{t.name}</span>
                <span className={styles.toolN}>×{t.n}</span>
              </span>
            ))}
          </div>
        </Block>
      </div>

      <div className={styles.cardCols}>
        <Block label="files touched" meta={`${d.fileList.length}`}>
          <div className={styles.files}>
            {d.fileList.map((f) => {
              const changed = f.state !== "read";
              return (
                <div key={f.path} className={styles.fileRow} data-changed={changed || undefined}>
                  <span className={styles.fileMark} data-state={f.state} aria-hidden>
                    {FILE_MARK[f.state]}
                  </span>
                  <span className={styles.fileName}>{f.path}</span>
                  <span className={styles.fileDir}>{f.dir}</span>
                  <span className={styles.fileN}>×{f.n}</span>
                </div>
              );
            })}
          </div>
        </Block>

        <Block label="talks to" meta={`${d.talksTo.length}`}>
          <div className={styles.peers}>
            {d.talksTo.map((p) => (
              <div key={p.handle} className={styles.peerRow}>
                <span className={styles.peerDot} data-live={p.live || undefined} aria-hidden />
                <span className={styles.peerName}>@{p.handle}</span>
                <span className={styles.peerN}>{p.msgs}</span>
              </div>
            ))}
          </div>
        </Block>
      </div>

      {d.agents.length > 0 ? (
        <Block label="subagents" meta={`${d.agents.length}`}>
          <div className={styles.subs}>
            {d.agents.map((a) => (
              <div key={a.name} className={styles.sub}>
                <span className={styles.subBar} data-tone={a.status} aria-hidden />
                <span className={styles.subBody}>
                  <span className={styles.subTop}>
                    <span className={styles.subGlyph} aria-hidden>↳</span>
                    <span className={styles.subName}>{a.name}</span>
                    <StatusBadge status={a.status} />
                  </span>
                  <span className={styles.subTask}>{a.task}</span>
                </span>
              </div>
            ))}
          </div>
        </Block>
      ) : null}

      <button type="button" className={styles.transcript}>
        <span className={styles.tri} aria-hidden>▸</span>
        <span className={styles.transcriptLbl}>transcript</span>
        <span className={styles.transcriptMeta}>{d.turns} turns</span>
      </button>

      <div className={styles.resumeRow}>
        <div className={styles.composer}>
          {running ? "Steer this session…" : "Continue this session…"}
        </div>
        <button type="button" className={styles.resume}>
          {running ? "Steer" : "Resume"} <span aria-hidden>↵</span>
        </button>
      </div>
    </div>
  );
}

function SessionRow({ s, open, onToggle }: { s: Session; open: boolean; onToggle: () => void }) {
  return (
    <div className={styles.session} data-open={open || undefined} data-status={s.status}>
      <button type="button" className={styles.sessionRow} onClick={onToggle}>
        <Tri open={open} />
        <Dot tone={s.status} />
        <span className={styles.sessionBody}>
          <span className={styles.sessionLine}>
            <span className={styles.sessionTitle} title={s.title}>
              {s.title}
            </span>
            <span className={styles.sessionMeta}>
              {s.subagents ? (
                <span className={styles.subCount}>
                  <span aria-hidden>↳</span>
                  {s.subagents}
                </span>
              ) : null}
              <span className={styles.ctxTag}>{s.ctx}% ctx</span>
              <StatusBadge status={s.status} />
              <span className={styles.sessionAgo}>{s.ago}</span>
            </span>
          </span>
          {/* collapsed rows stay scannable — the facts you triage on, in place */}
          {!open ? (
            <span className={styles.sessionSub}>
              <span className={styles.subBranch}>{s.branch}</span>
              <span className={styles.subSep}>·</span>
              <span className={styles.subId}>#{s.id}</span>
              <span className={styles.subSep}>·</span>
              <span>{s.files} files</span>
              <span className={styles.subSep}>·</span>
              <span>↔ {s.peers}</span>
            </span>
          ) : null}
        </span>
      </button>
      {open ? <SessionDetail s={s} /> : null}
    </div>
  );
}

export default function AgentsSessionExpandStudy() {
  const [open, setOpen] = useState<string | null>("a1c4f9");
  const [agentOpen, setAgentOpen] = useState(true);

  return (
    <ScoutStudyShell
      pageId="agents-session-expand"
      title="Agents · session-expand"
      initialSkin="graphite"
      blurb={
        <>
          The directory as a <strong>project → agent → session</strong> spine, dense by design. A
          collapsed session still carries its facts (branch · id · files · peers); opening one{" "}
          <strong>expands in place</strong> into the full instrument — session id · context · tools
          · <strong>files touched</strong> · <strong>talks-to</strong> · subagents · resume — so you
          scan everything that matters right here, not in a side rail. Two rationed tones: emerald =
          identity / done, amber = active / running.
        </>
      }
    >
      <div className={styles.surface}>
        <header className={styles.masthead}>
          <span className={styles.tile} aria-hidden>L</span>
          <div className={styles.ident}>
            <h1 className={styles.name}>
              <span className={styles.sigil}>/</span>lattices
            </h1>
            <div className={styles.sub}>
              <span className={styles.subRoot}>~/dev/lattices</span>
              <span className={styles.subDot}>·</span>
              <span>1 agent</span>
              <span className={styles.subDot}>·</span>
              <span>6 sessions</span>
            </div>
          </div>
          <nav className={styles.tabs}>
            <button type="button" className={styles.tab} data-on>
              Directory
            </button>
            <button type="button" className={styles.tab}>
              Sessions
            </button>
            <button type="button" className={styles.tab}>
              Config
            </button>
          </nav>
          <button type="button" className={styles.newAgent}>
            <span aria-hidden>+</span> New agent
          </button>
        </header>

        <div className={styles.list}>
          <div className={styles.agent} data-open={agentOpen || undefined}>
            <button type="button" className={styles.agentRow} onClick={() => setAgentOpen((v) => !v)}>
              <Tri open={agentOpen} />
              <Dot tone={AGENT.dot} />
              <span className={styles.agentName}>
                <span className={styles.sigil}>@</span>
                {AGENT.handle}
              </span>
              <span className={styles.chip}>{AGENT.branch}</span>
              <span className={styles.agentHost}>{AGENT.host}</span>
              <span className={styles.agentCount}>{SESSIONS.length} sessions</span>
            </button>

            {agentOpen ? (
              <div className={styles.sessions}>
                {SESSIONS.map((s) => (
                  <SessionRow
                    key={s.id}
                    s={s}
                    open={open === s.id}
                    onToggle={() => setOpen((cur) => (cur === s.id ? null : s.id))}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <button type="button" className={styles.ephemeral}>
            <span className={styles.tri} aria-hidden>▸</span>
            <Dot tone="idle" />
            <span className={styles.ephLbl}>3 ephemeral · workflow &amp; clone agents</span>
            <span className={styles.chip} data-muted>
              detached
            </span>
            <span className={styles.ephTag}>EPHEMERAL</span>
            <span className={styles.agentCount}>3 sessions</span>
          </button>
        </div>
      </div>
    </ScoutStudyShell>
  );
}
