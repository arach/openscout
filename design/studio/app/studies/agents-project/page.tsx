"use client";

import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { HarnessMark } from "@/components/HarnessMark";
import fixtureJson from "./fixture.json";
import styles from "./page.module.css";

/* ────────────────────────────────────────────────────────────────────────
   Agents · Project view — the wide pane when you focus ONE project.

   Built on a REAL broker snapshot (packages/web/scripts/build-agents-fixture.ts
   over a live /api/agents + /api/conversations + /api/tail/discover capture),
   normalized through the actual project-identity layer.

   Refinement pass: decorations stripped (no card borders, no chip pills, no
   button outlines), hierarchy carried by type weight, spacing, and hairlines.
   One accent, spent only as a precedence dot: needs-you ▸ live ▸ idle.

   Goals: FIND (search + harness filter) · CONTEXT (digest · branch · model ·
   live) · MANAGE (＋New agent · Resume · ＋Session · Steer · ⋯, on hover).
   ──────────────────────────────────────────────────────────────────────── */

const HARNESS_HUE: Record<string, number> = {
  claude: 28,
  codex: 210,
  grok: 280,
  pi: 280,
  gemini: 150,
  general: 220,
};

type FxSession = {
  kind: string;
  status: string;
  harness: string;
  label: string;
  detail: string | null;
  lastActivityAt: number | null;
};
type FxAgentRow = {
  name: string;
  harness: string;
  status: string;
  stateLabel: string;
  branch: string;
  activeTask: string | null;
  activeAskCount: number;
  lastActivityAt: number | null;
  model: string | null;
  sessions: FxSession[];
};
type FxProject = {
  slug: string;
  title: string;
  root: string;
  harnesses: string[];
  sessionCount: number;
  lastActivityAt: number | null;
  liveProcesses: number;
  liveHarnesses: string[];
  agents: FxAgentRow[];
  unassigned: FxSession[];
  blockedReason?: string | null;
};
type FxRecent = {
  agentName: string;
  agentId: string;
  task: string;
  conversationId: string;
  completedAt: number | null;
};
type Fx = { generatedAt: number; recentCompleted: FxRecent[]; projects: FxProject[] };

const FX = fixtureJson as unknown as Fx;
const NOW = FX.generatedAt;
const LIVE_WINDOW = 30 * 60_000;

/* ── helpers ─────────────────────────────────────────────────────────────── */
function ago(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = NOW - ms;
  if (d < 0) return "now";
  const m = Math.round(d / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
const harnessOf = (h: string) => (h === "pi" ? "grok" : h);
const firstToken = (name: string) => name.toLowerCase().split(/\s+/)[0] ?? name.toLowerCase();
const shortModel = (m: string | null) => (m ? m.replace(/^claude-/, "").replace(/-\d{8}$/, "") : null);

// The broker mints a separate identity per workflow card + numeric clone —
// "Openscout Card J Sh3vxg", "Openscout 185", "Sco061". Demote those so the
// recognizable agents lead.
function isEphemeral(name: string): boolean {
  return (
    /\bcard\b/i.test(name) ||
    /\b\d{3,}\b/i.test(name) ||
    /sco\d{2,}/i.test(name) ||
    /grok\d+$/i.test(name) ||
    /codex\s*\d+$/i.test(name) ||
    /message\s+(attach|workflow)/i.test(name)
  );
}
function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? "agent";
  let max = 0;
  for (const [v, n] of counts) if (n > max) ((max = n), (best = v));
  return best;
}

type Group = {
  name: string;
  harness: string;
  model: string | null;
  rows: FxAgentRow[];
  branches: string[];
  sessionCount: number;
  lastAt: number;
  needs: boolean;
  ephemeral: boolean;
};
function groupsFor(p: FxProject): Group[] {
  const byName = new Map<string, FxAgentRow[]>();
  for (const r of p.agents) {
    const arr = byName.get(r.name) ?? [];
    arr.push(r);
    byName.set(r.name, arr);
  }
  const groups: Group[] = [];
  for (const [name, rows] of byName) {
    const branches = [...new Set(rows.map((r) => r.branch).filter((b) => b && b !== "—"))];
    groups.push({
      name,
      harness: mostCommon(rows.map((r) => r.harness)),
      model: rows.map((r) => r.model).find(Boolean) ?? null,
      rows: [...rows].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)),
      branches,
      sessionCount: rows.reduce((n, r) => n + r.sessions.length, 0),
      lastAt: Math.max(0, ...rows.map((r) => r.lastActivityAt ?? 0)),
      needs: rows.some((r) => r.activeAskCount > 0),
      ephemeral: isEphemeral(name),
    });
  }
  return groups.sort((a, b) => {
    if (a.needs !== b.needs) return a.needs ? -1 : 1;
    return b.lastAt - a.lastAt || b.sessionCount - a.sessionCount;
  });
}
function branchesInFlight(p: FxProject): string[] {
  const seen = new Map<string, number>();
  for (const r of p.agents) {
    if (!r.branch || r.branch === "—" || r.branch === "main") continue;
    seen.set(r.branch, Math.max(seen.get(r.branch) ?? 0, r.lastActivityAt ?? 0));
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b);
}
function recentFor(p: FxProject): FxRecent[] {
  const names = new Set(p.agents.map((a) => a.name.toLowerCase()));
  return FX.recentCompleted.filter(
    (r) => names.has(r.agentName.toLowerCase()) || p.slug.startsWith(firstToken(r.agentName)),
  );
}

// A synthesized SPARSE project — the case the directory layout fails on: one
// agent, one harness, no branches, stalled 18h waiting on you. This is the
// live-app Lattices situation, given a real blocking reason + a transcript tail
// so the focus view has something true-shaped to lead with.
const STALLED_LATTICES: FxProject = {
  slug: "lattices",
  title: "Lattices",
  root: "~/dev/lattices",
  harnesses: ["claude"],
  sessionCount: 1,
  lastActivityAt: NOW - 18 * 60 * 60_000,
  liveProcesses: 1,
  liveHarnesses: ["claude"],
  blockedReason:
    "Stopped waiting for a synchronous result after 5m (300000 ms timeout) — it is still holding the run open, waiting on you to continue or redirect it.",
  agents: [
    {
      name: "Lattices",
      harness: "claude",
      status: "waiting",
      stateLabel: "waiting on you",
      branch: "main",
      activeTask: "Refactor the lane-card resize handlers, then verify the diff against main before continuing.",
      activeAskCount: 1,
      lastActivityAt: NOW - 18 * 60 * 60_000,
      model: "claude-opus-4-8",
      sessions: [
        {
          kind: "agent",
          status: "waiting",
          harness: "claude",
          label: "main",
          detail: "--model claude-opus-4-8 --name lattices --allowedTools Read,Edit,Bash,Grep",
          lastActivityAt: NOW - 18 * 60 * 60_000,
        },
      ],
    },
  ],
  unassigned: [],
};

const PROJECTS = [STALLED_LATTICES, ...FX.projects.filter((p) => p.slug !== "lattices")].sort(
  (a, b) => b.liveProcesses - a.liveProcesses || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0),
);
// Open on the sparse case so the focus treatment is what you see first.
const DEFAULT = STALLED_LATTICES;

// A project collapses to the focus view when it has at most one real agent —
// the directory chrome (digest, find, roster, aside) has nothing to organize.
function isSparseFocus(p: FxProject): boolean {
  return groupsFor(p).filter((g) => !g.ephemeral).length <= 1;
}

/* ── session drill-down ────────────────────────────────────────────────────
   The fixture has no transcript, but each session carries its launch command
   (--model · --name · --allowedTools) and the project carries the seed prompt
   (recentCompleted). Parse the former, stage a coalesced trace off the latter,
   so drilling into a session lands on something real-shaped instead of a stub. */
function parseLaunch(detail: string | null): { model: string | null; name: string | null; tools: number | null } | null {
  if (!detail) return null;
  const model = detail.match(/--model\s+([^\s]+)/)?.[1] ?? null;
  const name = detail.match(/--name\s+([^\s]+)/)?.[1] ?? null;
  const list = detail.match(/--allowedTools\s+([^\s]+)/)?.[1];
  const tools = list ? list.split(",").filter(Boolean).length : null;
  return { model, name, tools };
}
function seedTaskFor(name: string): string | null {
  return FX.recentCompleted.find((r) => r.agentName.toLowerCase() === name.toLowerCase())?.task ?? null;
}
function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : `${n}`);
function usageFor(inst: FxAgentRow, session: FxSession | null) {
  const h = hash((session?.label ?? inst.branch) + (inst.model ?? ""));
  return {
    ctx: 22 + (h % 64),
    inTok: 6_000 + (h % 22_000),
    outTok: 1_200 + ((h >> 3) % 9_000),
    cacheRd: 120_000 + (h % 560_000),
    adds: 90 + (h % 260),
    dels: h % 80,
  };
}

type EvKind = "you" | "agent" | "thinking" | "tool" | "notify";
type TraceEvent = { kind: EvKind; label?: string; ago: string; text: string; tone?: "live" | "needs" };
type CoalescedEvent = TraceEvent & { count: number };
const EV_GLYPH: Record<EvKind, string> = { you: "❯", agent: "◆", thinking: "✳", tool: "▪", notify: "✓" };

// Each pid is a parallel process under the agent's shared seed prompt, working
// a different slice of the surface. Vary the thread by session label so the
// switcher actually changes what you read.
const PID_WORK: { focus: string; reads: string[]; edits: string[]; done: string; now: string }[] = [
  { focus: "the reserved tail lane", reads: ["AgentRow.tsx", "page.module.css"], edits: ["page.module.css", "page.tsx"], done: "tail reserves its own column — no overlap, no gradient", now: "checking the hover swap" },
  { focus: "the digest stat line", reads: ["page.tsx", "fixture.json"], edits: ["page.tsx"], done: "stats read straight off the broker snapshot", now: "labelling the counts" },
  { focus: "the ephemeral fold", reads: ["page.tsx", "page.module.css"], edits: ["page.tsx"], done: "clone + workflow rows fold under one toggle", now: "tuning the disclosure copy" },
  { focus: "the responsive collapse", reads: ["page.module.css"], edits: ["page.module.css"], done: "right rail drops below 900, rail wraps below 680", now: "testing the breakpoints" },
  { focus: "the precedence dot", reads: ["page.module.css"], edits: ["page.module.css"], done: "one accent — needs ▸ live ▸ idle", now: "balancing the soft-ring weight" },
  { focus: "the transcript coalescer", reads: ["page.tsx"], edits: ["page.tsx", "page.module.css"], done: "tool bursts fold into one ×N row", now: "merging the edit run" },
];

function traceFor(group: Group, inst: FxAgentRow, session: FxSession | null): TraceEvent[] {
  const sLive = session ? session.status === "active" : NOW - (inst.lastActivityAt ?? group.lastAt) < LIVE_WINDOW;
  const seed = seedTaskFor(group.name) ?? inst.activeTask;
  const branch = inst.branch === "—" ? "main" : inst.branch;
  const w = PID_WORK[hash((session?.label ?? branch) + group.name) % PID_WORK.length];
  const ev: TraceEvent[] = [];
  if (seed) ev.push({ kind: "you", ago: "6m", text: seed });
  ev.push({ kind: "thinking", ago: "5m", text: `orienting in ${branch} — ${w.focus}` });
  w.reads.forEach((f, i) => ev.push({ kind: "tool", label: "read", ago: i < 1 ? "5m" : "4m", text: f }));
  ev.push({ kind: "agent", ago: "4m", text: w.done });
  w.edits.forEach((f) => ev.push({ kind: "tool", label: "edit", ago: "3m", text: f }));
  ev.push({ kind: "tool", label: "bash", ago: "2m", text: "tsc --noEmit" });
  if (group.needs) ev.push({ kind: "agent", ago: "now", text: `${w.focus} is ready to apply — go ahead?`, tone: "needs" });
  else if (sLive) ev.push({ kind: "thinking", ago: "now", text: w.now, tone: "live" });
  else ev.push({ kind: "notify", ago: ago(session?.lastActivityAt ?? inst.lastActivityAt), text: "wrapped — ready for review" });
  return ev;
}
// Coalesce consecutive same-tool events into one ×N row so a 4-edit burst reads
// as one line, not four — the raw spam the trace must fold, not echo.
function coalesce(events: TraceEvent[]): CoalescedEvent[] {
  const out: Array<CoalescedEvent & { items: string[] }> = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    if (prev && e.kind === "tool" && prev.kind === "tool" && prev.label === e.label && !e.tone && !prev.tone) {
      prev.count += 1;
      prev.ago = e.ago;
      prev.items.push(e.text);
      prev.text = prev.items.join(" · ");
    } else {
      out.push({ ...e, count: 1, items: [e.text] });
    }
  }
  return out;
}

/* ── icons (kept to two, hairline weight) ──────────────────────────────── */
function IcoSearch() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function IcoOpen() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M9 3h4v4M13 3 7.5 8.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

/* ── dot (precedence whisper) ──────────────────────────────────────────── */
function Dot({ tone }: { tone: "needs" | "live" | "idle" }) {
  if (tone === "idle") return null;
  return <span className={styles.dot} data-tone={tone} aria-hidden />;
}

/* ── one agent (rolled up from broker rows) ────────────────────────────── */
function AgentRow({
  g,
  selected,
  cursor,
  onOpen,
  rowRef,
}: {
  g: Group;
  selected?: boolean;
  cursor?: boolean;
  onOpen: (inst: FxAgentRow) => void;
  rowRef?: (el: HTMLDivElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const live = NOW - g.lastAt < LIVE_WINDOW;
  const tone: "needs" | "live" | "idle" = g.needs ? "needs" : live ? "live" : "idle";
  const branchLine = g.branches.slice(0, 2).join("  ·  ");

  return (
    <div ref={rowRef} tabIndex={-1} className={styles.row} data-tone={tone} data-open={open || undefined} data-selected={selected || undefined} data-cursor={cursor || undefined}>
      <div className={styles.rowMain} onClick={() => setOpen((v) => !v)}>
        <SpriteAvatar name={g.name} size={30} hue={HARNESS_HUE[g.harness]} tile cornerPulse={live} />
        <div className={styles.rowBody}>
          <div className={styles.rowTop}>
            <Dot tone={tone} />
            <span className={styles.rowName} data-idle={tone === "idle" || undefined}>
              {g.name}
            </span>
            <span className={styles.rowMark} aria-hidden>
              <HarnessMark harness={harnessOf(g.harness)} size={11} />
            </span>
            {g.needs ? <span className={styles.needsWord}>needs you</span> : null}
          </div>
          <div className={styles.rowMeta}>
            {branchLine ? <span className={styles.rowBranch}>{branchLine}</span> : <span className={styles.rowBranch} data-dim>main</span>}
            {g.branches.length > 2 ? <span className={styles.rowDim}>+{g.branches.length - 2}</span> : null}
            <span className={styles.rowDivider} aria-hidden />
            <span className={styles.rowDim}>
              {g.rows.length} instance{g.rows.length === 1 ? "" : "s"}
              {g.sessionCount ? ` · ${g.sessionCount} conv` : ""}
            </span>
          </div>
        </div>

        {/* tail lane — reserved width; ago/model by default, actions on hover/needs */}
        <div className={styles.rowTail}>
          <div className={styles.tailMeta} aria-hidden={tone === "needs" || undefined}>
            <span className={styles.rowAgo}>{ago(g.lastAt)}</span>
            {shortModel(g.model) ? <span className={styles.rowModel}>{shortModel(g.model)}</span> : null}
          </div>
          <div className={styles.rowActions}>
            <button
              type="button"
              className={`${styles.act} ${styles.actPrimary}`}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(g.rows[0]);
              }}
            >
              {g.needs ? "Approve" : live ? "Steer" : "Resume"}
            </button>
            <button type="button" className={styles.act} onClick={(e) => e.stopPropagation()}>＋ Session</button>
            <button type="button" className={styles.actIcon} title="More" onClick={(e) => e.stopPropagation()}>⋯</button>
          </div>
        </div>
      </div>

      {open ? (
        <div className={styles.instances}>
          {g.rows.map((r, i) => (
            <button key={i} type="button" className={styles.inst} data-active={NOW - (r.lastActivityAt ?? 0) < LIVE_WINDOW || undefined} onClick={() => onOpen(r)}>
              <span className={styles.instBranch}>{r.branch === "—" ? "main" : r.branch}</span>
              <span className={styles.instWhat}>
                {r.sessions.length ? `${r.sessions.length} session${r.sessions.length === 1 ? "" : "s"}` : r.stateLabel || "registered"}
              </span>
              <span className={styles.instAgo}>{ago(r.lastActivityAt)}</span>
              <span className={styles.instOpen} aria-hidden><IcoOpen /></span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── session detail (master–detail pane) ───────────────────────────────────
   Opens in place of the right rail — the project frame (masthead · search ·
   roster) stays put, so drilling reads as a panel updating, not a page change.
   Single column: compact header · meta strip · session switcher · transcript ·
   steer box. The right-rail readout is folded into one meta strip. */
function SessionDetail({ group, inst, onBack, backRef }: { group: Group; inst: FxAgentRow; onBack: () => void; backRef?: Ref<HTMLButtonElement> }) {
  const [reply, setReply] = useState("");
  const [sIdx, setSIdx] = useState(0);
  const live = NOW - (inst.lastActivityAt ?? group.lastAt) < LIVE_WINDOW;
  const tone: "needs" | "live" | "idle" = group.needs ? "needs" : live ? "live" : "idle";
  const branch = inst.branch === "—" ? "main" : inst.branch;
  const sessions = inst.sessions;
  const session = sessions[sIdx] ?? sessions[0] ?? null;
  const cfg = parseLaunch(session?.detail ?? null);
  const model = shortModel(inst.model ?? cfg?.model ?? group.model);
  const events = coalesce(traceFor(group, inst, session));
  const usage = usageFor(inst, session);
  const status = session?.status ?? inst.stateLabel ?? "registered";

  return (
    <section className={styles.detail} aria-label="Session detail">
      {/* header */}
      <header className={styles.detailHead}>
        <button ref={backRef} type="button" className={styles.detailBack} title="Back to roster (Esc)" onClick={onBack} aria-label="Back">‹</button>
        <SpriteAvatar name={group.name} size={34} hue={HARNESS_HUE[group.harness]} tile cornerPulse={live} />
        <div className={styles.detailIdent}>
          <div className={styles.detailTop}>
            <span className={styles.detailName}>{group.name}</span>
            <span className={styles.rowMark} aria-hidden>
              <HarnessMark harness={harnessOf(group.harness)} size={13} />
            </span>
            <span className={styles.headState} data-tone={tone}>
              {tone === "needs" ? (
                <><span className={styles.dot} data-tone="needs" aria-hidden /> needs you</>
              ) : tone === "live" ? (
                <><span className={styles.dot} data-tone="live" aria-hidden /> live</>
              ) : (
                <>idle · {ago(inst.lastActivityAt)}</>
              )}
            </span>
          </div>
          <span className={styles.detailSub}>
            {branch}
            {model ? `  ·  ${model}` : ""}
            {session?.label ? `  ·  ${session.label}` : ""}
          </span>
        </div>
        <div className={styles.headActions}>
          <button type="button" className={styles.headGhost}>Take over</button>
          <button type="button" className={styles.headCta}>{tone === "needs" ? "Approve" : "Steer"}</button>
        </div>
      </header>

      {/* meta strip — the right-rail readout folded into one row */}
      <div className={styles.metaStrip}>
        <span className={styles.metaItem}><span className={styles.metaKey}>status</span>{status}</span>
        <span className={styles.metaItem}><span className={styles.metaKey}>model</span>{model ?? "—"}</span>
        <span className={styles.metaItem}><span className={styles.metaKey}>tools</span>{cfg?.tools != null ? cfg.tools : "—"}</span>
        <span className={styles.metaItem}><span className={styles.metaKey}>ctx</span>{usage.ctx}%</span>
        <span className={styles.metaItem}><span className={styles.metaKey}>tokens</span>{fmtK(usage.inTok)} in · {fmtK(usage.outTok)} out</span>
        <span className={styles.metaChanges}><span className={styles.add}>+{usage.adds}</span> <span className={styles.del}>−{usage.dels}</span></span>
      </div>

      {/* session switcher — one instance can hold many live pids */}
      {sessions.length > 1 ? (
        <div className={styles.sessTabs} role="tablist" aria-label="Sessions">
          {sessions.map((s, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === sIdx}
              className={styles.sessTab}
              data-on={i === sIdx || undefined}
              onClick={() => setSIdx(i)}
            >
              <span className={styles.sessDot} data-on={s.status === "active" || undefined} aria-hidden />
              {s.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* transcript */}
      <div className={styles.detailBody}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Transcript</span>
          <span className={styles.sectionMeta}>
            {events.length} events{sessions.length > 1 ? ` · pid ${sIdx + 1}/${sessions.length}` : ""}
          </span>
        </div>
        <div className={styles.trace}>
          {events.map((e, i) => (
            <div key={i} className={styles.ev} data-kind={e.kind} data-tone={e.tone || undefined}>
              <span className={styles.evGutter} aria-hidden>{EV_GLYPH[e.kind]}</span>
              <div className={styles.evBody}>
                {e.label ? (
                  <span className={styles.evLabel}>
                    {e.label}
                    {e.count > 1 ? <span className={styles.evCount}> ×{e.count}</span> : null}
                  </span>
                ) : null}
                <span className={styles.evText}>{e.text}</span>
              </div>
              <span className={styles.evAgo}>{e.ago}</span>
            </div>
          ))}
        </div>
      </div>

      {/* steer */}
      <div className={styles.steer}>
        <input
          className={styles.steerInput}
          placeholder={`Steer ${group.name} — a directive…`}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
        <button type="button" className={styles.steerSend}>Send</button>
      </div>
    </section>
  );
}

/* ── project view ──────────────────────────────────────────────────────── */
function ProjectView({ p }: { p: FxProject }) {
  const [q, setQ] = useState("");
  const [harness, setHarness] = useState<string | null>(null);
  const [showEph, setShowEph] = useState(false);
  const [drill, setDrill] = useState<{ group: Group; inst: FxAgentRow } | null>(null);
  const [cursor, setCursor] = useState(-1);

  const findRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const wasOpen = useRef(false);

  const groups = useMemo(() => groupsFor(p), [p]);
  const flight = useMemo(() => branchesInFlight(p), [p]);
  const recent = useMemo(() => recentFor(p), [p]);

  const query = q.trim().toLowerCase();
  const match = (g: Group) =>
    (!harness || g.harness === harness || (harness === "grok" && g.harness === "pi")) &&
    (!query ||
      g.name.toLowerCase().includes(query) ||
      g.branches.some((b) => b.toLowerCase().includes(query)) ||
      g.harness.includes(query));

  const primary = groups.filter((g) => !g.ephemeral && match(g));
  const ephemeral = groups.filter((g) => g.ephemeral && match(g));
  const lead = primary.find((g) => g.needs) ?? primary[0];
  const filtering = Boolean(query || harness);
  const agentCount = groups.filter((g) => !g.ephemeral).length;

  // keyboard layer — j/k or ↑/↓ scrub the roster (live-loading the panel when
  // one is open), ↵ opens the cursor row, ⌘↵ jumps to whoever needs you, ⌘K // /
  // focuses search, Esc closes the panel. Inputs are guarded so typing is safe.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

      if ((e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        findRef.current?.focus();
        findRef.current?.select();
        return;
      }
      if (e.key === "Escape") {
        if (typing) { el?.blur(); return; }
        if (drill) { e.preventDefault(); setDrill(null); }
        return;
      }
      if (typing) return;

      const max = primary.length;
      if (!max) return;
      const openAt = (i: number) => { setCursor(i); if (drill) setDrill({ group: primary[i], inst: primary[i].rows[0] }); };

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        openAt(cursor < 0 ? 0 : Math.min(max - 1, cursor + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        openAt(cursor < 0 ? 0 : Math.max(0, cursor - 1));
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        const target = primary.find((g) => g.needs) ?? primary[0];
        e.preventDefault();
        setCursor(primary.indexOf(target));
        setDrill({ group: target, inst: target.rows[0] });
      } else if (e.key === "Enter") {
        const i = cursor < 0 ? 0 : cursor;
        e.preventDefault();
        setCursor(i);
        setDrill({ group: primary[i], inst: primary[i].rows[0] });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drill, primary, cursor]);

  // focus hand-off: into the panel's Back button when it opens, back to the
  // cursor row when it closes — so the keyboard never strands focus.
  useEffect(() => {
    const open = !!drill;
    if (open && !wasOpen.current) backRef.current?.focus();
    else if (!open && wasOpen.current) rowRefs.current.get(primary[cursor]?.name ?? "")?.focus();
    wasOpen.current = open;
  }, [drill, primary, cursor]);

  // keep the cursor in range as filtering shrinks the roster, and reveal it.
  useEffect(() => {
    if (cursor < 0) return;
    if (cursor >= primary.length) { setCursor(primary.length - 1); return; }
    rowRefs.current.get(primary[cursor]?.name ?? "")?.scrollIntoView({ block: "nearest" });
  }, [cursor, primary]);

  return (
    <div className={styles.view} data-detail={drill ? true : undefined}>
      <div className={styles.content}>
      {/* header */}
      <header className={styles.head}>
        <SpriteAvatar name={p.slug} size={40} tile />
        <div className={styles.headIdent}>
          <div className={styles.headTop}>
            <h1 className={styles.headName}>{p.slug}</h1>
            <span className={styles.headState}>
              {p.liveProcesses > 0 ? (
                <>
                  <span className={styles.dot} data-tone="live" aria-hidden /> {p.liveProcesses} live
                </>
              ) : (
                <>idle · {ago(p.lastActivityAt)}</>
              )}
            </span>
          </div>
          <span className={styles.headRoot}>{p.root}</span>
        </div>
        <div className={styles.headActions}>
          <button type="button" className={styles.headGhost}>Steer all</button>
          <button type="button" className={styles.headCta}>＋ New agent</button>
        </div>
      </header>

      {/* digest — one quiet stat line, no box */}
      <div className={styles.digest}>
        <span className={styles.stat}>
          <span className={styles.statNum}>{agentCount}</span>
          <span className={styles.statLbl}>agents</span>
        </span>
        <span className={styles.stat}>
          <span className={styles.statNum}>{p.sessionCount}</span>
          <span className={styles.statLbl}>conversations</span>
        </span>
        <span className={styles.stat}>
          <span className={styles.statNum}>{flight.length}</span>
          <span className={styles.statLbl}>branches in flight</span>
        </span>
        <span className={styles.statMarks}>
          {p.harnesses.map((h) => (
            <span key={h} title={harnessOf(h)} aria-hidden>
              <HarnessMark harness={harnessOf(h)} size={13} />
            </span>
          ))}
        </span>
      </div>

      {/* resume line — pick up where it left off (no box, accent dot) */}
      {lead && !filtering ? (
        <div className={styles.resume} data-tone={lead.needs ? "needs" : "live"} aria-live="polite">
          <span className={styles.dot} data-tone={lead.needs ? "needs" : "live"} aria-hidden />
          <span className={styles.resumeLbl}>{lead.needs ? "Waiting on you" : "Most recent"}</span>
          <span className={styles.resumeWho}>{lead.name}</span>
          <span className={styles.resumeMeta}>
            {lead.branches[0] ?? "main"} · {ago(lead.lastAt)}
          </span>
          <span className={styles.resumeActions}>
            <button type="button" className={styles.linkAccent}>{lead.needs ? "Approve & continue" : "Resume"}</button>
            <button type="button" className={styles.link}>Open</button>
          </span>
        </div>
      ) : null}

      {/* find — underline field + plain harness toggles */}
      <div className={styles.find}>
        <span className={styles.findIco} aria-hidden><IcoSearch /></span>
        <input
          ref={findRef}
          className={styles.findInput}
          placeholder="Find an agent, branch, or harness…  (⌘K)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className={styles.findFilters}>
          {p.harnesses.map((h) => {
            const key = harnessOf(h);
            return (
              <button
                key={h}
                type="button"
                className={styles.filter}
                data-on={harness === key || undefined}
                onClick={() => setHarness((cur) => (cur === key ? null : key))}
              >
                <HarnessMark harness={key} size={11} />
                {key}
              </button>
            );
          })}
        </div>
      </div>

      {/* roster */}
      <div className={styles.main}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Agents</span>
            <span className={styles.sectionMeta}>{primary.length} shown{filtering ? " · filtered" : ""}</span>
            <span className={styles.kbdHint} aria-hidden>↑↓ move · ↵ open · esc close</span>
          </div>

          <div className={styles.roster}>
            {primary.map((g, idx) => (
              <AgentRow
                key={g.name}
                g={g}
                selected={drill?.group.name === g.name}
                cursor={cursor === idx}
                rowRef={(el) => { if (el) rowRefs.current.set(g.name, el); else rowRefs.current.delete(g.name); }}
                onOpen={(inst) => { setCursor(idx); setDrill({ group: g, inst }); }}
              />
            ))}
            {primary.length === 0 ? <div className={styles.empty}>No agents match.</div> : null}
          </div>

          {ephemeral.length ? (
            <div className={styles.ephBlock}>
              <button type="button" className={styles.ephToggle} onClick={() => setShowEph((v) => !v)}>
                <span className={styles.ephCount}>{ephemeral.length}</span> ephemeral · workflow &amp; clone agents
                <span className={styles.ephCaret}>{showEph ? "▴" : "▾"}</span>
              </button>
              {showEph ? (
                <div className={styles.ephList}>
                  {ephemeral.map((g) => (
                    <button key={g.name} type="button" className={styles.ephRow}>
                      <span className={styles.ephMark} aria-hidden>
                        <HarnessMark harness={harnessOf(g.harness)} size={10} />
                      </span>
                      <span className={styles.ephName}>{g.name}</span>
                      <span className={styles.ephBranch}>{g.branches[0] ?? "main"}</span>
                      <span className={styles.ephAgo}>{ago(g.lastAt)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <button type="button" className={styles.newAgent}>＋ New agent on this project</button>
        </div>
      </div>

      {drill ? (
        <SessionDetail
          key={`${drill.group.name}:${drill.inst.branch}:${drill.inst.lastActivityAt ?? 0}`}
          group={drill.group}
          inst={drill.inst}
          onBack={() => setDrill(null)}
          backRef={backRef}
        />
      ) : (
        <aside className={styles.aside}>
          <div className={styles.group}>
            <div className={styles.groupHead}>Recently</div>
            {recent.length ? (
              recent.slice(0, 5).map((r, i) => (
                <button key={i} type="button" className={styles.recent}>
                  <span className={styles.recentWho}>{r.agentName}</span>
                  <span className={styles.recentAgo}>{ago(r.completedAt)}</span>
                  <span className={styles.recentTask}>{r.task}</span>
                </button>
              ))
            ) : (
              <div className={styles.groupDim}>No recent completions.</div>
            )}
          </div>

          <div className={styles.group}>
            <div className={styles.groupHead}>Place</div>
            <div className={styles.kv}>
              <span className={styles.kvKey}>root</span>
              <span className={styles.kvVal}>{p.root}</span>
            </div>
            <div className={styles.kv}>
              <span className={styles.kvKey}>live</span>
              <span className={styles.kvVal}>
                {p.liveProcesses} process{p.liveProcesses === 1 ? "" : "es"}
                {p.liveHarnesses.length ? <span className={styles.kvDim}> · {p.liveHarnesses.join(", ")}</span> : null}
              </span>
            </div>
            <div className={styles.kv}>
              <span className={styles.kvKey}>in flight</span>
              <span className={styles.kvBranches}>
                {flight.slice(0, 5).map((b) => (
                  <span key={b} className={styles.kvBranch}>{b}</span>
                ))}
                {flight.length === 0 ? <span className={styles.kvDim}>—</span> : null}
              </span>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}

/* ── sparse focus view ─────────────────────────────────────────────────────
   When a project has one real agent, the directory chrome (digest counts, a
   harness filter over a single row, a "recently" feed that just echoes the
   masthead) is pure scaffolding. This collapses the whole pane to the one thing
   that matters: who it is, what it's blocked on — the message the directory
   buried in a truncated aside line — the decision, and where it left off. */
function FocusView({ p }: { p: FxProject }) {
  const [reply, setReply] = useState("");
  const groups = useMemo(() => groupsFor(p), [p]);
  const g = groups.find((x) => !x.ephemeral) ?? groups[0];
  const ephemeral = groups.filter((x) => x.ephemeral);

  if (!g) {
    return (
      <div className={styles.focusEmpty}>
        No agents on this project yet.{" "}
        <button type="button" className={styles.focusFootLink}>＋ New agent</button>
      </div>
    );
  }

  const inst = g.rows[0];
  const live = NOW - g.lastAt < LIVE_WINDOW;
  const tone: "needs" | "live" | "idle" = g.needs ? "needs" : live ? "live" : "idle";
  const session = inst.sessions[0] ?? null;
  const cfg = parseLaunch(session?.detail ?? null);
  const model = shortModel(inst.model ?? cfg?.model ?? g.model);
  const usage = usageFor(inst, session);
  const events = coalesce(traceFor(g, inst, session));
  const branch = inst.branch === "—" ? "main" : inst.branch;

  return (
    <section className={styles.focus} data-tone={tone} aria-label={`${g.name} focus`}>
      <header className={styles.focusHead}>
        <SpriteAvatar name={p.slug} size={44} hue={HARNESS_HUE[g.harness]} tile cornerPulse={live} />
        <div className={styles.focusIdent}>
          <div className={styles.focusTop}>
            <h1 className={styles.focusName}>{p.slug}</h1>
            <span className={styles.rowMark} aria-hidden>
              <HarnessMark harness={harnessOf(g.harness)} size={13} />
            </span>
            <span className={styles.focusState} data-tone={tone}>
              <Dot tone={tone} />
              {tone === "needs" ? `waiting on you · ${ago(g.lastAt)}` : tone === "live" ? "live" : `idle · ${ago(g.lastAt)}`}
            </span>
          </div>
          <span className={styles.focusRoot}>
            {p.root}  ·  {branch}{model ? `  ·  ${model}` : ""}
          </span>
        </div>
        <button type="button" className={styles.focusOpen}>Open ↗</button>
      </header>

      {/* the situation — the headline the directory buried + truncated */}
      <div className={styles.situation} data-tone={tone}>
        <div className={styles.situationLead}>
          {tone === "needs"
            ? (p.blockedReason ?? `${g.name} is waiting on your input.`)
            : tone === "live"
              ? <>{g.name} is working on <b>{branch}</b>.</>
              : <>{g.name} left off {ago(g.lastAt)} ago on <b>{branch}</b>.</>}
        </div>
        {inst.activeTask ? <div className={styles.situationTask}>{inst.activeTask}</div> : null}
      </div>

      {/* the decision — the action is the whole point of this screen */}
      <div className={styles.decision}>
        <button type="button" className={styles.decisionPrimary}>
          {tone === "needs" ? "Approve & continue" : tone === "live" ? "Steer" : "Resume"}
        </button>
        {tone === "needs" ? <button type="button" className={styles.decisionGhost}>Steer instead</button> : null}
        <button type="button" className={styles.decisionGhost}>Open ↗</button>
        <span className={styles.decisionMeta}>
          <span><span className={styles.metaKey}>ctx</span>{usage.ctx}%</span>
          <span><span className={styles.metaKey}>tokens</span>{fmtK(usage.inTok)} in</span>
          <span><span className={styles.metaKey}>conv</span>{g.sessionCount || 1}</span>
        </span>
      </div>

      {/* where it left off — the transcript tail */}
      <div className={styles.focusBody}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Where it left off</span>
          <span className={styles.sectionMeta}>{events.length} events</span>
        </div>
        <div className={styles.trace}>
          {events.slice(-6).map((e, i) => (
            <div key={i} className={styles.ev} data-kind={e.kind} data-tone={e.tone || undefined}>
              <span className={styles.evGutter} aria-hidden>{EV_GLYPH[e.kind]}</span>
              <div className={styles.evBody}>
                {e.label ? (
                  <span className={styles.evLabel}>
                    {e.label}
                    {e.count > 1 ? <span className={styles.evCount}> ×{e.count}</span> : null}
                  </span>
                ) : null}
                <span className={styles.evText}>{e.text}</span>
              </div>
              <span className={styles.evAgo}>{e.ago}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.steer}>
        <input
          className={styles.steerInput}
          placeholder={`Reply to ${g.name}…`}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
        <button type="button" className={styles.steerSend}>Send</button>
      </div>

      {/* demoted: the rest of the project, as a quiet footer */}
      <div className={styles.focusFoot}>
        <button type="button" className={styles.focusFootLink}>＋ New agent on this project</button>
        {ephemeral.length ? (
          <span className={styles.focusFootDim}>{ephemeral.length} ephemeral · workflow &amp; clone agents</span>
        ) : null}
      </div>
    </section>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */
export default function AgentsProjectStudy() {
  const [slug, setSlug] = useState(DEFAULT.slug);
  const project = PROJECTS.find((p) => p.slug === slug) ?? DEFAULT;

  return (
    <ScoutStudyShell
      pageId="agents-project"
      title="Agents · Project view"
      initialSkin="graphite"
      blurb={
        <>
          The wide pane when you focus <strong>one project</strong> — on a{" "}
          <strong>real broker snapshot</strong>, decorations stripped so type, spacing and a single
          accent dot carry the hierarchy. <strong>Find</strong> the agent (search + harness),
          read its <strong>context</strong> (digest · branch · model · live), and{" "}
          <strong>manage</strong> sessions (Resume · ＋Session · Steer · ⋯, on hover). openscout&rsquo;s
          52 broker rows collapse to ~5 real agents; the ephemeral tail folds away.
        </>
      }
    >
      <div className={styles.surface}>
        <nav className={styles.rail} aria-label="Projects">
          <div className={styles.railHead}>Projects</div>
          {PROJECTS.map((p) => (
            <button
              key={p.slug}
              type="button"
              className={styles.railRow}
              data-selected={p.slug === slug || undefined}
              onClick={() => setSlug(p.slug)}
            >
              <SpriteAvatar name={p.slug} size={22} tile />
              <span className={styles.railName} data-idle={p.liveProcesses === 0 || undefined}>{p.slug}</span>
              {p.liveProcesses > 0 ? <span className={styles.railCount}>{p.liveProcesses}</span> : null}
            </button>
          ))}
        </nav>

        <div className={styles.pane}>
          {isSparseFocus(project) ? <FocusView key={slug} p={project} /> : <ProjectView key={slug} p={project} />}
        </div>
      </div>
    </ScoutStudyShell>
  );
}
