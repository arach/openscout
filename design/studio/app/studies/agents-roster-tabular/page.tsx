"use client";

import { useState } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { HarnessMark } from "@/components/HarnessMark";
import styles from "./page.module.css";

/* ────────────────────────────────────────────────────────────────────────
   Agents · tabular roster + right-rail detail (master–detail).

   The current roster is either terse one-liners (too little) or fat cards
   (too much). The middle: a DENSE TABLE — one line per agent, with context
   columns (a one-line summary · ctx · last-turn · files · turns) so you can
   scan many agents and compare them at a glance. Clicking a row doesn't
   expand IN PLACE — it loads "a bit more" into the RIGHT RAIL (the detail
   pane): attribution · a context gauge · touched files · the session log ·
   a decision row. One selection always live.

   Design only, no app wiring. One accent (--s-accent), spent on the
   precedence dot, the selected-row left edge, the ctx gauge fill, and the
   primary CTA. Hierarchy from type weight, spacing, hairlines, alignment.
   The header row and the data rows share one CSS grid template so columns
   actually line up into a real table.
   ──────────────────────────────────────────────────────────────────────── */

const HARNESS_HUE: Record<string, number> = {
  claude: 28,
  codex: 210,
  grok: 280,
  gemini: 150,
  general: 220,
};

type State = "working" | "waiting" | "idle";
type TouchedFile = { path: string; tag: "read" | "edit" };
type LogLine = { t: string; text: string; kind?: "tool" | "msg" | "ask" };

type Agent = {
  id: string;
  name: string;
  harness: "claude" | "codex";
  model: string;
  branch: string;
  state: State;
  /** one-line work summary — the headline column */
  summary: string;
  ctx: number; // 0–100
  tokens: number; // input tokens, for the rail readout
  lastTurn: string; // mono, e.g. "16:38" or "2m"
  ageWords: string; // "2m old"
  files: TouchedFile[];
  turns: number;
  log: LogLine[];
};

const CTX_TOTAL = 160; // 160k window

const AGENTS: Agent[] = [
  {
    id: "vox",
    name: "vox",
    harness: "claude",
    model: "opus-4-8",
    branch: "feat/voice-stream",
    state: "waiting",
    summary: "stalled — waiting on you to confirm the new mic-permission copy before shipping",
    ctx: 71,
    tokens: 114_000,
    lastTurn: "5m",
    ageWords: "5m old",
    files: [
      { path: "DictationMic.tsx", tag: "edit" },
      { path: "dictation-mic.css", tag: "edit" },
      { path: "scout-voice.ts", tag: "read" },
      { path: "vox.ts", tag: "read" },
    ],
    turns: 27,
    log: [
      { t: "−9m", text: "read scout-voice.ts, vox.ts — the permission gate" },
      { t: "−6m", text: "edited DictationMic — reworded the mic prompt" },
      { t: "−4m", text: "edited dictation-mic.css — denied-state styling" },
      { t: "−3m", text: "ran vite build — clean" },
      { t: "now", text: "is this copy right before I ship it?", kind: "ask" },
    ],
  },
  {
    id: "relay",
    name: "relay",
    harness: "codex",
    model: "gpt-5",
    branch: "feat/relay-apns",
    state: "working",
    summary: "wiring the APNs token refresh into the relay reconnect loop",
    ctx: 48,
    tokens: 77_000,
    lastTurn: "now",
    ageWords: "now",
    files: [
      { path: "relay-daemon.ts", tag: "edit" },
      { path: "apns.ts", tag: "edit" },
      { path: "reconnect.ts", tag: "read" },
    ],
    turns: 33,
    log: [
      { t: "−4m", text: "read reconnect.ts — the backoff schedule" },
      { t: "−2m", text: "edited relay-daemon — refresh on 410 Gone" },
      { t: "−1m", text: "edited apns.ts — cache the device token" },
      { t: "now", text: "running the relay integration suite", kind: "msg" },
    ],
  },
  {
    id: "atlas",
    name: "atlas",
    harness: "claude",
    model: "opus-4-8",
    branch: "feat/pair-bonjour",
    state: "working",
    summary: "advertising _scout-pair._tcp and listing same-Wi-Fi Macs on Connect",
    ctx: 62,
    tokens: 99_000,
    lastTurn: "1m",
    ageWords: "1m old",
    files: [
      { path: "BonjourBrowser.swift", tag: "edit" },
      { path: "ConnectScreen.swift", tag: "edit" },
      { path: "pair.ts", tag: "read" },
    ],
    turns: 21,
    log: [
      { t: "−5m", text: "read pair.ts — the /pair handshake" },
      { t: "−3m", text: "edited BonjourBrowser — resolve TXT records" },
      { t: "−1m", text: "edited ConnectScreen — one-tap pair row" },
      { t: "now", text: "verifying on two sims over LAN", kind: "msg" },
    ],
  },
  {
    id: "scribe",
    name: "scribe",
    harness: "codex",
    model: "gpt-5",
    branch: "main",
    state: "working",
    summary: "regenerating the web-taxonomy registry off the live surface map",
    ctx: 34,
    tokens: 54_000,
    lastTurn: "2m",
    ageWords: "2m old",
    files: [
      { path: "web-taxonomy.ts", tag: "edit" },
      { path: "library.tsx", tag: "read" },
    ],
    turns: 12,
    log: [
      { t: "−6m", text: "read library.tsx — the surface inventory" },
      { t: "−2m", text: "edited web-taxonomy.ts — 66 surfaces mapped" },
      { t: "now", text: "diffing against the prior registry", kind: "msg" },
    ],
  },
  {
    id: "pixel",
    name: "pixel",
    harness: "claude",
    model: "sonnet-4-5",
    branch: "feat/sprite-parity",
    state: "idle",
    summary: "ported the name→creature hash to Swift; JS/Swift outputs bit-match",
    ctx: 26,
    tokens: 41_000,
    lastTurn: "18m",
    ageWords: "18m old",
    files: [
      { path: "agent-identity.ts", tag: "read" },
      { path: "AgentSprite.swift", tag: "edit" },
      { path: "SpriteHash.swift", tag: "edit" },
    ],
    turns: 16,
    log: [
      { t: "−22m", text: "read agent-identity.ts — the FNV hash" },
      { t: "−19m", text: "edited SpriteHash.swift — ported the mix" },
      { t: "−18m", text: "wrapped — 512/512 names bit-match across ports" },
    ],
  },
  {
    id: "broker",
    name: "broker",
    harness: "codex",
    model: "gpt-5",
    branch: "fix/port-range",
    state: "idle",
    summary: "split the broker port pick across dev and mesh advertise scopes",
    ctx: 92,
    tokens: 147_000,
    lastTurn: "2h",
    ageWords: "2h old",
    files: [
      { path: "broker-daemon.ts", tag: "edit" },
      { path: "mesh/service.ts", tag: "edit" },
    ],
    turns: 40,
    log: [
      { t: "−2h", text: "moved the port pick behind resolveAdvertiseScope()" },
      { t: "−2h", text: "added a fallback sweep when 43110 is taken" },
      { t: "−2h", text: "wrapped — clean tree, ready for review" },
    ],
  },
  {
    id: "dewey",
    name: "dewey",
    harness: "claude",
    model: "opus-4-8",
    branch: "main",
    state: "idle",
    summary: "migrated the index and rolled the old shard table; 214/214 green",
    ctx: 8,
    tokens: 13_000,
    lastTurn: "3d",
    ageWords: "3d old",
    files: [{ path: "migrate.ts", tag: "edit" }],
    turns: 22,
    log: [
      { t: "−3d", text: "applied the migration, dropped the old shard" },
      { t: "−3d", text: "ran the suite — 214/214 green" },
      { t: "−3d", text: "wrapped — clean tree, ready for review" },
    ],
  },
  {
    id: "glint",
    name: "glint",
    harness: "codex",
    model: "gpt-5",
    branch: "feat/landing-basel",
    state: "working",
    summary: "rebuilding the landing hero in the Basel system — Archivo, one red",
    ctx: 55,
    tokens: 88_000,
    lastTurn: "16:38",
    ageWords: "9m old",
    files: [
      { path: "globals.css", tag: "edit" },
      { path: "Hero.tsx", tag: "edit" },
      { path: "tokens.md", tag: "read" },
    ],
    turns: 18,
    log: [
      { t: "−12m", text: "read tokens.md — the paper/ink palette" },
      { t: "−9m", text: "edited Hero.tsx — layered-plain headline" },
      { t: "now", text: "rm -rf .next then restarting the dev server", kind: "msg" },
    ],
  },
  {
    id: "ember",
    name: "ember",
    harness: "claude",
    model: "sonnet-4-5",
    branch: "feat/push-trigger",
    state: "idle",
    summary: "drafted the delivery-issue push trigger; iOS register/handle still open",
    ctx: 19,
    tokens: 30_000,
    lastTurn: "2d",
    ageWords: "2d old",
    files: [
      { path: "push-trigger.ts", tag: "edit" },
      { path: "roadmap.md", tag: "read" },
    ],
    turns: 9,
    log: [
      { t: "−2d", text: "read roadmap.md — the question/approval gap" },
      { t: "−2d", text: "edited push-trigger.ts — delivery-issue path" },
      { t: "−2d", text: "wrapped — iOS client side deferred" },
    ],
  },
];

const PROJECTS: { slug: string; live: number }[] = [
  { slug: "lattices", live: 0 },
  { slug: "openscout", live: 3 },
  { slug: "pomo", live: 0 },
  { slug: "talkie", live: 3 },
  { slug: "hudson", live: 0 },
  { slug: "og", live: 0 },
  { slug: "scope", live: 0 },
  { slug: "dewey", live: 0 },
  { slug: "atelier", live: 0 },
];

const NAV = ["home", "agents", "terminals", "chat", "search", "ops"];

const fmtK = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : `${n}`;

const dotTone = (s: State) => (s === "working" ? "live" : s === "waiting" ? "needs" : "idle");
const stateWord = (a: Agent) =>
  a.state === "waiting" ? `waiting · ${a.ageWords.replace(" old", "")}` : a.state === "working" ? "working" : `idle · ${a.ageWords.replace(" old", "")}`;
const primaryLabel = (s: State) => (s === "waiting" ? "Continue" : s === "working" ? "Steer" : "Resume");

function Dot({ tone }: { tone: "needs" | "live" | "idle" }) {
  if (tone === "idle") return null;
  return <span className={styles.dot} data-tone={tone} aria-hidden />;
}

/* ── the right-rail detail — "a bit more" for the selected agent ─────────── */
function RailDetail({ a }: { a: Agent }) {
  const tone = dotTone(a.state);
  const ctxK = Math.round((a.ctx / 100) * CTX_TOTAL);

  return (
    <aside className={styles.rail} aria-label="Agent detail">
      <header className={styles.railTop}>
        <SpriteAvatar name={a.name} size={34} hue={HARNESS_HUE[a.harness]} tile cornerPulse={a.state === "working"} />
        <div className={styles.railIdent}>
          <div className={styles.railIdentTop}>
            <span className={styles.railName}>{a.name}</span>
            <span className={styles.railState} data-tone={tone}>
              <Dot tone={tone} />
              {stateWord(a)}
            </span>
          </div>
          <span className={styles.railSub}>
            {a.branch} · {a.model}
            <span className={styles.railMark} aria-hidden>
              <HarnessMark harness={a.harness} size={11} />
            </span>
          </span>
        </div>
        <button type="button" className={styles.railOpen}>Open ↗</button>
      </header>

      {/* context */}
      <div className={styles.group}>
        <div className={styles.groupHead}>Context</div>
        <div className={styles.gauge} aria-hidden>
          <span className={styles.gaugeFill} style={{ width: `${a.ctx}%` }} />
        </div>
        <div className={styles.gaugeRead}>
          <span className={styles.gaugeNum}>{fmtK(a.tokens)}</span>
          <span className={styles.gaugeDim}>/ {CTX_TOTAL}k</span>
          <span className={styles.gaugeSep} aria-hidden>·</span>
          <span className={styles.gaugeDim}>{a.turns} turns</span>
          <span className={styles.gaugeSep} aria-hidden>·</span>
          <span className={styles.gaugeDim}>{a.ageWords}</span>
        </div>
      </div>

      {/* files */}
      <div className={styles.group}>
        <div className={styles.groupHead}>
          Files <span className={styles.groupCount}>{a.files.length}</span>
        </div>
        <div className={styles.files}>
          {a.files.map((f) => (
            <div key={f.path} className={styles.fileRow}>
              <span className={styles.fileTag} data-tag={f.tag}>{f.tag}</span>
              <span className={styles.filePath}>{f.path}</span>
            </div>
          ))}
        </div>
      </div>

      {/* session log */}
      <div className={styles.group}>
        <div className={styles.groupHead}>
          Session log <span className={styles.groupCount}>last {Math.min(a.log.length, 4)}</span>
        </div>
        <div className={styles.log}>
          {a.log.slice(-4).map((l, i) => (
            <div key={i} className={styles.logLine} data-kind={l.kind || undefined}>
              <span className={styles.logT}>{l.t}</span>
              <span className={styles.logText}>{l.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* decision */}
      <div className={styles.decision}>
        <button type="button" className={styles.primary}>{primaryLabel(a.state)}</button>
        {a.state === "waiting" ? <button type="button" className={styles.ghost}>Steer instead</button> : null}
        <button type="button" className={styles.ghost}>Take over</button>
      </div>
    </aside>
  );
}

export default function AgentsRosterTabularStudy() {
  const [selectedId, setSelectedId] = useState<string>(
    // default to a working agent so the rail leads with live detail
    AGENTS.find((a) => a.state === "working")?.id ?? AGENTS[0].id,
  );
  const selected = AGENTS.find((a) => a.id === selectedId) ?? AGENTS[0];

  const liveCount = AGENTS.filter((a) => a.state === "working").length;
  const branches = new Set(AGENTS.map((a) => a.branch).filter((b) => b !== "main"));

  return (
    <ScoutStudyShell
      pageId="agents-roster-tabular"
      title="Agents · tabular + rail detail"
      initialSkin="graphite"
      blurb={
        <>
          The roster as a <strong>dense table</strong> — one line per agent with{" "}
          context columns (<strong>summary · ctx · last turn · files · turns</strong>) so you can
          scan many agents and compare them. Clicking a row doesn&rsquo;t expand in place; it
          loads <strong>&ldquo;a bit more&rdquo;</strong> into the <strong>right rail</strong> — the
          master&ndash;detail pane (attribution · context gauge · touched files · session log ·
          decision). One accent, one selection always live.
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

        {/* ── body: projects rail | tabular roster | detail rail ───────── */}
        <div className={styles.body}>
          {/* left projects rail */}
          <nav className={styles.projects} aria-label="Projects">
            <div className={styles.projectsHead}>Projects</div>
            {PROJECTS.map((p) => (
              <button
                key={p.slug}
                type="button"
                className={styles.projRow}
                data-selected={p.slug === "talkie" || undefined}
              >
                <SpriteAvatar name={p.slug} size={20} tile />
                <span className={styles.projName} data-idle={p.live === 0 || undefined}>{p.slug}</span>
                {p.live > 0 ? <span className={styles.projCount}>{p.live}</span> : null}
              </button>
            ))}
          </nav>

          {/* center — the tabular roster */}
          <div className={styles.center}>
            {/* masthead */}
            <header className={styles.masthead}>
              <SpriteAvatar name="talkie" size={32} tile />
              <div className={styles.mastIdent}>
                <div className={styles.mastTop}>
                  <h1 className={styles.mastName}>talkie</h1>
                  <span className={styles.mastState}>
                    <span className={styles.dot} data-tone="live" aria-hidden /> {liveCount} live
                  </span>
                  <span className={styles.mastRoot}>~/dev/talkie</span>
                </div>
                <div className={styles.digest}>
                  {AGENTS.length} agents · {AGENTS.reduce((n, a) => n + a.turns, 0)} conversations ·{" "}
                  {branches.size} branches in flight
                </div>
              </div>
              <div className={styles.mastActions}>
                <button type="button" className={styles.ghost}>Steer all</button>
                <button type="button" className={styles.mastCta}>＋ New agent</button>
              </div>
            </header>

            {/* the table */}
            <div className={styles.table} role="table" aria-label="Agents">
              {/* column-header row */}
              <div className={styles.colhead} role="row">
                <span className={styles.chAgent}>Agent</span>
                <span className={styles.chSummary}>Summary</span>
                <span className={styles.chCtx}>Ctx</span>
                <span className={styles.chLast}>Last turn</span>
                <span className={styles.chFiles}>Files</span>
                <span className={styles.chTurns}>Turns</span>
              </div>

              {/* data rows */}
              {AGENTS.map((a) => {
                const tone = dotTone(a.state);
                const selectedRow = a.id === selectedId;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="row"
                    className={styles.row}
                    data-selected={selectedRow || undefined}
                    data-tone={tone}
                    onClick={() => setSelectedId(a.id)}
                  >
                    {/* agent — dot + avatar + name + branch */}
                    <span className={styles.cAgent}>
                      <span className={styles.dotSlot}><Dot tone={tone} /></span>
                      <SpriteAvatar name={a.name} size={18} hue={HARNESS_HUE[a.harness]} tile cornerPulse={a.state === "working"} />
                      <span className={styles.agentName} data-idle={tone === "idle" || undefined}>{a.name}</span>
                      <span className={styles.agentBranch}>{a.branch}</span>
                    </span>
                    {/* one-line work summary */}
                    <span className={styles.cSummary}>{a.summary}</span>
                    {/* ctx — tiny bar + % */}
                    <span className={styles.cCtx}>
                      <span className={styles.ctxBar} aria-hidden>
                        <span className={styles.ctxFill} style={{ width: `${a.ctx}%` }} />
                      </span>
                      <span className={styles.ctxPct}>{a.ctx}%</span>
                    </span>
                    {/* last turn */}
                    <span className={styles.cLast}>{a.lastTurn}</span>
                    {/* files */}
                    <span className={styles.cFiles}>{a.files.length}</span>
                    {/* turns */}
                    <span className={styles.cTurns}>{a.turns}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* right rail — the expand-on-click detail */}
          <RailDetail a={selected} />
        </div>

        {/* ── status bar ───────────────────────────────────────────────── */}
        <footer className={styles.statusbar}>
          <div className={styles.statusLeft}>
            <span className={styles.statusItem}><span className={styles.statusDot} aria-hidden />broker</span>
            <span className={styles.statusItem}>active agents {AGENTS.length}</span>
            <span className={styles.statusItem}>mesh</span>
          </div>
          <div className={styles.statusRight}>
            <span className={styles.statusItem}>console</span>
            <span className={styles.statusItem}>16:42</span>
          </div>
        </footer>
      </div>
    </ScoutStudyShell>
  );
}
