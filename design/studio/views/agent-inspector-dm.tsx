"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Scout · Agent Inspector — DM context (session-elevated)

   This is the COMPACT right-rail card shown WHILE you're inside a DM with one
   agent (ScoutRootView.swift → ScoutAgentInspector). Not the full Profile page
   (that's /studies/agent-profile-rebalance) — the narrow stacked card in the
   conversation's right inspector.

   The realization that drives the restructure: this card renders inside a DM,
   so the centre of gravity is THE session this conversation is bound to — not a
   generic, mid-card "Engage" CTA strip wedged between summary and facts.

     · "Message" is dead weight here — you're already in the message. What makes
       sense against a live session is Observe / Take over / Traces.
     · So ENGAGE-as-a-block goes away; its one non-redundant verb (Observe) folds
       into the session.
     · RUNTIME moves UP into that slot — runtime IS the attached session's
       metadata (transport · role · class · the session id). Promote it and hang
       the session CTAs off it.
     · "Sessions" (plural) demotes to "Other sessions from this agent" — the one
       you're in is elevated up top; the rest are a quiet list below. Solves the
       "why is this plural when I'm in one chat" itch.

   The card is ONE component flexed across the contexts it serves (switch with the
   control at top): your own DM (one bound session, no Message), an agent↔agent DM
   (two sides, Message returns as Interject), and the agent view with no DM open
   (sessions as a peer list, Message present). The constant is the session CTA
   gradient — Traces · Watch · Take over. What flexes: the session region (bound
   vs list) and whether Message shows — which it does only when you're NOT already
   a participant.
   ─────────────────────────────────────────────────────────────────────────── */

import React from "react";
import { SpriteAvatar } from "@/components/SpriteAvatar";

/* ── palette (shared with agent-profile-rebalance for parity) ──────────────── */

const INK = {
  canvas: "oklch(0.118 0.008 80)",
  panel: "oklch(0.145 0.008 80)",
  module: "oklch(0.165 0.008 80)",
  edge: "oklch(0.27 0.008 80)",
  edgeSoft: "oklch(0.205 0.008 80)",
};
const ACCENT = "var(--scout-accent)";
const MUTED = "var(--studio-ink-muted)";
const FAINT = "var(--studio-ink-faint)";
const INKC = "var(--studio-ink)";

const AGENT = "Claude";

/* ── mock data — mirrors the live card in the screenshot ───────────────────── */

const ESSENTIALS = {
  cwd: "~/dev/openscout",
  branch: "codex/scoutd-apple-silicon-install-path",
  host: "arts-mac-mini",
  harness: "claude",
  model: "opus-4-8",
};

const ACTIVITY = { turns: 4, tools: 27, edits: 3, reads: 7, files: 6, window: "3h", fill: 74 };

const FILES = [
  { path: "Scout/ScoutRootView.swift", delta: "+5", state: "modified" as const },
  { path: "Scout/ScoutCommsView.swift", delta: "+1", state: "modified" as const },
  { path: "lib/session-catalog.ts", delta: "+1", state: "created" as const },
];

const ATTACHED = {
  id: "relay-claude-feat-sco-065-repo-diff-viewer-arts-mac-mini-local-claude",
  transport: "tmux",
  role: "relay agent",
  klass: "general",
  live: true,
};

const OTHER_SESSIONS = [
  { id: "openscout", role: "RELAY", msgs: 4, ago: "3h", live: true },
  { id: "8af1c2d0", role: "BUILD", msgs: 12, ago: "2d", live: false },
];

type SessionT = { id: string; transport: string; role: string; klass: string; live: boolean };

/* A second agent — the OTHER side of an agent↔agent conversation, with its own
   session driving its half. */
type Ident = { name: string; handle: string; cwd: string; branch: string; host: string; harness: string; model: string };
const CLAUDE: Ident = {
  name: AGENT, handle: "@claude", cwd: ESSENTIALS.cwd, branch: ESSENTIALS.branch,
  host: ESSENTIALS.host, harness: ESSENTIALS.harness, model: ESSENTIALS.model,
};
const OPERATOR: Ident = {
  name: "Operator", handle: "@operator", cwd: "~/dev/openscout", branch: "main",
  host: "arts-mac-mini", harness: "codex", model: "gpt-5.1",
};
const ATTACHED_OPERATOR: SessionT = {
  id: "relay-operator-main-arts-mac-mini-local-codex",
  transport: "tmux", role: "operator", klass: "general", live: true,
};

/* Agent context (no DM): the agent's sessions as PEERS — none is "the bound
   one", so they read as a list, active first. */
const AGENT_SESSIONS: Array<SessionT & { msgs: number; ago: string }> = [
  { ...ATTACHED, id: "relay-claude · now", msgs: 4, ago: "now" },
  { id: "8af1c2d0", transport: "claude", role: "build", klass: "general", live: false, msgs: 12, ago: "2d" },
  { id: "1c7d22a", transport: "claude", role: "research", klass: "general", live: false, msgs: 6, ago: "6d" },
];

/* ── small primitives ──────────────────────────────────────────────────────── */

function Dot({ on = true, size = 6 }: { on?: boolean; size?: number }) {
  return (
    <span
      className="inline-block flex-none rounded-full"
      style={{ width: size, height: size, background: on ? ACCENT : INK.edge }}
    />
  );
}

function Eyebrow({ children, meta }: { children: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>
        {children}
      </span>
      {meta != null ? (
        <span className="font-mono text-[8.5px] tabular-nums" style={{ color: FAINT }}>
          {meta}
        </span>
      ) : null}
    </div>
  );
}

function Divider() {
  return <div className="h-px w-full flex-none" style={{ background: INK.edgeSoft }} />;
}

function Sep() {
  return <span style={{ color: INK.edge }}>·</span>;
}

/* tiny geometric glyphs (no emoji) for the session CTAs */
const ICO = "h-[11px] w-[11px] flex-none";
function IcoEye() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={ICO}>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  );
}
function IcoTakeover() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={ICO}>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.2" />
      <path d="M5.5 7.5 8 10l2.5-2.5M8 10V5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IcoTraces() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={ICO}>
      <path d="M1.5 8h2L5 4l2.5 8L10 6l1.5 2h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── card chrome ───────────────────────────────────────────────────────────── */

const CARD_W = 332;

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>
        {label}
      </div>
      <div
        className="flex flex-col overflow-hidden rounded-[10px]"
        style={{ width: CARD_W, border: `1px solid ${INK.edge}`, background: INK.panel }}
      >
        {children}
      </div>
    </div>
  );
}

function Section({ children, last = false }: { children: React.ReactNode; last?: boolean }) {
  return (
    <>
      <div className="px-3.5 py-3">{children}</div>
      {!last ? <Divider /> : null}
    </>
  );
}

/* ── shared sections (identical in both cards) ─────────────────────────────── */

/* Header trailing buttons. + New is always available; Message only shows when
   you're NOT already a participant in the thread (agent-context / agent↔agent),
   never in your own DM — that's the rule that unifies the contexts. */
function NewBtn() {
  return (
    <button type="button" className="flex-none cursor-pointer rounded-[4px] px-2.5 py-[5px] font-mono text-[8px] font-semibold uppercase tracking-[0.1em]" style={{ background: ACCENT, color: INK.canvas }}>
      + New
    </button>
  );
}
function MsgBtn({ label = "Message" }: { label?: string }) {
  return (
    <button type="button" className="flex-none cursor-pointer rounded-[4px] px-2.5 py-[5px] font-mono text-[8px] font-semibold uppercase tracking-[0.1em]" style={{ border: `1px solid ${INK.edge}`, color: MUTED }}>
      {label}
    </button>
  );
}

function HeaderBlock({ a = CLAUDE, trailing, compact = false }: { a?: Ident; trailing?: React.ReactNode; compact?: boolean }) {
  return (
    <Section>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <SpriteAvatar name={a.name} size={compact ? 26 : 34} tile />
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="font-display leading-none" style={{ color: INKC, fontSize: compact ? 13 : 15 }}>
                {a.name}
              </span>
              <span className="font-mono text-[9px]" style={{ color: FAINT }}>
                {a.handle}
              </span>
            </div>
            {compact ? (
              <div className="mt-1 truncate font-mono text-[9px]" style={{ color: FAINT }}>
                ⎇ {a.branch} <Sep /> {a.harness} · {a.model}
              </div>
            ) : (
              <div className="mt-1.5 flex flex-col gap-0.5 font-mono text-[9px] leading-tight" style={{ color: MUTED }}>
                <span className="truncate">
                  {a.cwd} <Sep /> ⎇ {a.branch}
                </span>
                <span className="truncate" style={{ color: FAINT }}>
                  {a.host} <Sep /> {a.harness} <Sep /> {a.model}
                </span>
              </div>
            )}
          </div>
        </div>
        <span className="flex flex-none items-center gap-1.5">{trailing ?? <NewBtn />}</span>
      </div>
    </Section>
  );
}

function ActivityBlock() {
  const a = ACTIVITY;
  const stats: Array<[string | number, string]> = [
    [a.turns, "turns"],
    [a.tools, "tools"],
    [a.edits, "edits"],
    [a.reads, "reads"],
    [a.files, "files"],
    [a.window, "window"],
  ];
  return (
    <Section>
      <Eyebrow meta="now">Activity</Eyebrow>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono">
        {stats.map(([v, k], i) => (
          <span key={k} className="inline-flex items-baseline gap-1">
            {i > 0 ? <span className="mr-0.5" style={{ color: INK.edge }}>·</span> : null}
            <span className="text-[11px] tabular-nums" style={{ color: INKC }}>{v}</span>
            <span className="text-[8px] uppercase tracking-[0.08em]" style={{ color: FAINT }}>{k}</span>
          </span>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <div className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: INK.module }}>
          <div className="h-full rounded-full" style={{ width: `${a.fill}%`, background: MUTED }} />
        </div>
        <span className="font-mono text-[8.5px]" style={{ color: FAINT }}>{a.fill}% ctx</span>
      </div>
    </Section>
  );
}

function FilesBlock() {
  return (
    <Section>
      <Eyebrow meta={`${FILES.length} of 6`}>Files changed</Eyebrow>
      <div className="flex flex-col gap-1">
        {FILES.map((f) => {
          const parts = f.path.split("/");
          const name = parts.pop() ?? f.path;
          const dir = parts.length ? `${parts.join("/")}/` : "";
          const mark = f.state === "created" ? "+" : "~";
          return (
            <div key={f.path} className="flex items-baseline justify-between gap-2 font-mono text-[9.5px] leading-tight">
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="flex-none" style={{ color: ACCENT }}>{mark}</span>
                <span className="flex min-w-0 items-baseline">
                  <span className="truncate" style={{ color: INK.edge }}>{dir}</span>
                  <span className="flex-none" style={{ color: MUTED }}>{name}</span>
                </span>
              </span>
              <span className="flex-none tabular-nums text-[8.5px]" style={{ color: FAINT }}>{f.delta}</span>
            </div>
          );
        })}
        <button type="button" className="mt-0.5 w-fit cursor-pointer font-mono text-[9px] uppercase tracking-[0.1em]" style={{ color: ACCENT }}>
          Open full diff →
        </button>
      </div>
    </Section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CURRENT — the live card today
   ═══════════════════════════════════════════════════════════════════════════ */

/** ENGAGE — the redundant middle CTA strip. Each row labels a self-describing
    button (Conversation → Message, Terminal → Observe): the label restates the
    verb, and the whole block apes the Runtime table below it. */
function EngageCurrent() {
  const rows: Array<[string, string, boolean]> = [
    ["Conversation", "Message", true],
    ["Terminal", "Observe", false],
  ];
  return (
    <Section>
      <Eyebrow>Engage</Eyebrow>
      <div className="flex flex-col gap-1.5">
        {rows.map(([label, verb, filled]) => (
          <div key={label} className="flex items-center gap-2.5">
            <span className="w-[84px] flex-none font-mono text-[8px] uppercase tracking-[0.13em]" style={{ color: FAINT }}>
              {label}
            </span>
            <button
              type="button"
              className="cursor-pointer rounded-[4px] px-2.5 py-1.5 font-mono text-[8px] font-semibold uppercase tracking-[0.1em]"
              style={
                filled
                  ? { background: ACCENT, color: INK.canvas }
                  : { border: `1px solid ${INK.edge}`, color: MUTED }
              }
            >
              {verb}
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function SessionsCurrent() {
  return (
    <Section>
      <Eyebrow>Sessions</Eyebrow>
      <div className="flex items-baseline gap-2">
        <span className="mt-[3px]"><Dot size={5} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[10px]" style={{ color: INKC }}>Openscout</span>
            <span className="rounded-sm px-1 font-mono text-[7px] uppercase tracking-[0.08em]" style={{ background: INK.module, color: FAINT }}>
              relay agent
            </span>
            <span className="ml-auto font-mono text-[8px]" style={{ color: FAINT }}>6h</span>
          </div>
          <div className="mt-1 truncate font-mono text-[8.5px]" style={{ color: FAINT }}>
            codex/scoutd-apple-silicon-install-path · 4 msgs
          </div>
        </div>
      </div>
    </Section>
  );
}

function RuntimeCurrent() {
  const rows: Array<[string, string]> = [
    ["Transport", ATTACHED.transport],
    ["Role", ATTACHED.role],
    ["Class", ATTACHED.klass],
    ["Session", ATTACHED.id],
  ];
  return (
    <Section last>
      <Eyebrow>Runtime</Eyebrow>
      <div className="flex flex-col gap-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <span className="flex-none font-mono text-[7.5px] uppercase tracking-[0.12em]" style={{ color: FAINT }}>{k}</span>
            <span className="truncate text-right font-mono text-[9px]" style={{ color: k === "Session" ? MUTED : INKC }}>{v}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function CurrentCard() {
  return (
    <Card label="Current (live)">
      <HeaderBlock />
      <ActivityBlock />
      <FilesBlock />
      <EngageCurrent />
      <SessionsCurrent />
      <RuntimeCurrent />
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PROPOSED — session-elevated, DM-aware
   ═══════════════════════════════════════════════════════════════════════════ */

/* Session CTA verbs — committed, in one place. No toggle: a word doesn't need a
   variant explorer. Take over is locked; "Watch" is the read-only counterpart —
   swap to "Peek" here if we ever want the lighter voice. They form an ascending-
   commitment gradient: Traces (read the feed) → Watch (see the live terminal,
   hands-off) → Take over (grab the keyboard). Traces leads — the everyday glance. */
const SESSION_VERBS = { traces: "Traces", watch: "Watch", takeover: "Take over" };

/** The session-scoped action gradient — Traces (lead) · Watch · Take over. The
    same three verbs wherever a live session appears, so the card reads the same
    in every context. */
function SessionCTAs() {
  const ctas: Array<{ t: string; ico: React.ReactNode; lead?: boolean }> = [
    { t: SESSION_VERBS.traces, ico: <IcoTraces />, lead: true },
    { t: SESSION_VERBS.watch, ico: <IcoEye /> },
    { t: SESSION_VERBS.takeover, ico: <IcoTakeover /> },
  ];
  return (
    <div className="flex gap-1.5">
      {ctas.map((c) => (
        <button
          key={c.t}
          type="button"
          title={c.t}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] px-2.5 py-1.5 font-mono text-[8px] font-semibold uppercase tracking-[0.1em]"
          style={
            c.lead
              ? {
                  border: `1px solid color-mix(in oklab, ${ACCENT} 55%, transparent)`,
                  color: ACCENT,
                  background: `color-mix(in oklab, ${ACCENT} 8%, transparent)`,
                }
              : { border: `1px solid ${INK.edge}`, color: MUTED }
          }
        >
          <span style={{ color: c.lead ? ACCENT : FAINT }}>{c.ico}</span>
          {c.t}
        </button>
      ))}
    </div>
  );
}

/** The attached session, elevated into Runtime's old slot: a status line, the
    runtime facts that were buried at the bottom, and the session-scoped CTAs.
    No "Message" — you're already in this conversation. `s` makes it reusable for
    either side of an agent↔agent conversation. */
function SessionBlock({ s = ATTACHED, last = false }: { s?: SessionT; last?: boolean }) {
  // transport lives in the status meta (`live · tmux`) — don't echo it here.
  const facts: Array<[string, string]> = [
    ["role", s.role],
    ["class", s.klass],
  ];
  return (
    <Section last={last}>
      <Eyebrow
        meta={
          <span className="inline-flex items-center gap-1.5" style={{ color: s.live ? ACCENT : FAINT }}>
            <Dot on={s.live} size={5} />
            {s.live ? "live" : "ended"} · {s.transport}
          </span>
        }
      >
        Session
      </Eyebrow>

      <div className="truncate font-mono text-[10px]" style={{ color: MUTED }} title={s.id}>
        {s.id}
      </div>

      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono">
        {facts.map(([k, v], i) => (
          <span key={k} className="inline-flex items-baseline gap-1.5">
            {i > 0 ? <span style={{ color: INK.edge }}>·</span> : null}
            <span className="text-[7.5px] uppercase tracking-[0.12em]" style={{ color: FAINT }}>{k}</span>
            <span className="text-[9.5px]" style={{ color: INKC }}>{v}</span>
          </span>
        ))}
      </div>

      <div className="mt-3">
        <SessionCTAs />
      </div>
    </Section>
  );
}

/** The plural list, demoted: "Other sessions from this agent" — NOT the one
    you're in. These are the rows where Message/Observe-into-another-session
    actually make sense, on tap. */
function OtherSessions() {
  return (
    <Section last>
      <Eyebrow meta={`${OTHER_SESSIONS.length}`}>Other sessions from this agent</Eyebrow>
      <div className="flex flex-col">
        {OTHER_SESSIONS.map((s, i) => (
          <div
            key={s.id}
            className="group flex items-center gap-2.5 py-1.5"
            style={{ borderTop: i ? `1px solid ${INK.edgeSoft}` : undefined }}
          >
            <Dot on={s.live} size={5} />
            <span className="font-mono text-[9.5px]" style={{ color: MUTED }}>{s.id}</span>
            <span className="rounded-sm px-1 font-mono text-[7px] uppercase tracking-[0.08em]" style={{ background: INK.module, color: FAINT }}>
              {s.role}
            </span>
            <span className="font-mono text-[8px]" style={{ color: FAINT }}>{s.msgs} msgs</span>
            <span className="ml-auto flex items-center gap-2">
              {/* on-hover actions live HERE — these ARE other conversations, so
                  Message/Observe are meaningful (unlike the attached session). */}
              <span className="font-mono text-[8px] opacity-100 transition-opacity group-hover:opacity-0" style={{ color: FAINT }}>
                {s.ago}
              </span>
              <span className="pointer-events-none absolute -ml-1 flex gap-1.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                <span className="font-mono text-[7.5px] uppercase tracking-[0.1em]" style={{ color: FAINT }}>msg · obs</span>
              </span>
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** DM · you + agent — the bound case. One session elevated, others demoted, no
    Message (you're already the participant). */
function DmSoloCard() {
  return (
    <Card label="DM · you + agent">
      <HeaderBlock />
      <ActivityBlock />
      <FilesBlock />
      <SessionBlock />
      <OtherSessions />
    </Card>
  );
}

/* ── agent context (no DM): sessions as a peer list ────────────────────────── */

/** No single "bound" session, so sessions read as a peer LIST (active first).
    The active one carries the CTA gradient inline; the rest are compact rows you
    can open. Message lives in the header here — you're not in a thread yet. */
function SessionsListBlock() {
  return (
    <Section last>
      <Eyebrow meta={`${AGENT_SESSIONS.length}`}>Sessions</Eyebrow>
      <div className="flex flex-col">
        {AGENT_SESSIONS.map((s, i) => {
          const lead = i === 0;
          return (
            <div key={s.id} className="py-2" style={{ borderTop: i ? `1px solid ${INK.edgeSoft}` : undefined }}>
              <div className="flex items-center gap-2">
                <Dot on={s.live} size={5} />
                <span className="font-mono text-[9.5px]" style={{ color: lead ? INKC : MUTED }}>{s.id}</span>
                <span className="rounded-sm px-1 font-mono text-[7px] uppercase tracking-[0.08em]" style={{ background: INK.module, color: FAINT }}>{s.role}</span>
                <span className="font-mono text-[8px]" style={{ color: FAINT }}>{s.msgs} msgs</span>
                <span className="ml-auto font-mono text-[8px]" style={{ color: s.live ? ACCENT : FAINT }}>{s.live ? "live" : s.ago}</span>
              </div>
              {lead ? <div className="mt-2"><SessionCTAs /></div> : null}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** Agent context — the SAME card, but the session region is a peer list and the
    header gains Message (you're not in a thread, so messaging is a real action). */
function AgentContextCard() {
  return (
    <Card label="Agent (no DM)">
      <HeaderBlock trailing={<><MsgBtn /><NewBtn /></>} />
      <ActivityBlock />
      <FilesBlock />
      <SessionsListBlock />
    </Card>
  );
}

/* ── agent ↔ agent DM: two sides ───────────────────────────────────────────── */

/** A compact per-agent card for the two-sided conversation: identity + that
    agent's live session + the same CTA gradient. No Activity/Files — two full
    stacks would tower; the watch/take-over surface is what matters per side. */
function AgentSide({ a, s, last = false }: { a: Ident; s: SessionT; last?: boolean }) {
  return (
    <>
      <HeaderBlock
        a={a}
        compact
        trailing={<span className="font-mono text-[8px] uppercase tracking-[0.1em]" style={{ color: s.live ? ACCENT : FAINT }}>{s.live ? "live" : "idle"}</span>}
      />
      <SessionBlock s={s} last={last} />
    </>
  );
}

/** DM · agent ↔ agent — two agents, so two sides. You're the observer, so
    Message returns as "Interject" at the conversation level. */
function DmPairCard() {
  return (
    <Card label="DM · agent ↔ agent">
      <Section>
        <Eyebrow meta="2 agents">Conversation</Eyebrow>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px]" style={{ color: MUTED }}>
            <SpriteAvatar name={CLAUDE.name} size={16} tile /> {CLAUDE.name}
          </span>
          <span style={{ color: INK.edge }}>⇄</span>
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px]" style={{ color: MUTED }}>
            <SpriteAvatar name={OPERATOR.name} size={16} tile /> {OPERATOR.name}
          </span>
          <span className="ml-auto"><MsgBtn label="Interject" /></span>
        </div>
      </Section>
      <AgentSide a={CLAUDE} s={ATTACHED} />
      <AgentSide a={OPERATOR} s={ATTACHED_OPERATOR} last />
    </Card>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

type Ctx = "current" | "dm-solo" | "dm-pair" | "agent";
const CTXS: Array<{ id: Ctx; label: string }> = [
  { id: "current", label: "Current (live)" },
  { id: "dm-solo", label: "DM · you + agent" },
  { id: "dm-pair", label: "DM · agent ↔ agent" },
  { id: "agent", label: "Agent (no DM)" },
];

export default function AgentInspectorDmPage() {
  const [ctx, setCtx] = React.useState<Ctx>(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("ctx");
      if (p === "current" || p === "dm-solo" || p === "dm-pair" || p === "agent") return p;
    }
    return "dm-solo";
  });
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · macos · agent-inspector-dm
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent Inspector · contexts
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          One inspector card (<code className="font-mono text-[12px] text-studio-ink">ScoutAgentInspector</code>),
          flexed across the contexts it has to serve. The constant: a live session shows{" "}
          <span className="text-studio-ink">Traces · Watch · Take over</span>. What flexes is the{" "}
          <span className="text-studio-ink">session region</span> (one bound session, elevated — vs a peer
          list) and whether <span className="text-studio-ink">Message</span> appears — which it does{" "}
          <em>only when you&apos;re not already a participant</em>: hidden in your own DM, back as{" "}
          <span className="text-studio-ink">Interject</span> when you&apos;re observing two agents, and present
          in the agent view.
        </p>
      </header>

      <div
        className="mb-5 inline-flex rounded-[6px] p-[3px]"
        style={{ background: "var(--studio-canvas-alt, oklch(0.16 0.006 80))", border: "1px solid var(--studio-edge, oklch(0.27 0.008 80))" }}
      >
        {CTXS.map((c) => {
          const active = ctx === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCtx(c.id)}
              aria-pressed={active}
              className="cursor-pointer rounded-[4px] px-3 py-[6px] font-mono text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors"
              style={active ? { background: ACCENT, color: INK.canvas } : { color: "var(--studio-ink-faint)" }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-start gap-8">
        {ctx === "current" ? (
          <CurrentCard />
        ) : ctx === "dm-solo" ? (
          <DmSoloCard />
        ) : ctx === "dm-pair" ? (
          <DmPairCard />
        ) : (
          <AgentContextCard />
        )}
      </div>

      <section className="mt-10 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">
          One component, three axes
        </div>
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-studio-ink-faint">
          <li>
            <span className="text-studio-ink">Scope — bound vs list.</span> In a DM the conversation&apos;s
            session is elevated as the primary block (others demote to &ldquo;Other sessions&rdquo;). In the agent
            view there&apos;s no bound session, so they read as a peer list, active first.
          </li>
          <li>
            <span className="text-studio-ink">Sides — one agent vs two.</span> You + agent renders one card;
            agent ↔ agent renders a card per side, each with its own live session and the same
            Watch / Take over surface.
          </li>
          <li>
            <span className="text-studio-ink">Message follows participation.</span> Hidden when you&apos;re in the
            thread (your DM); present as <em>Interject</em> when you&apos;re observing two agents; present in the
            agent view where no thread is open yet. Removes the redundancy without losing the affordance where
            it&apos;s real.
          </li>
        </ul>
      </section>
    </main>
  );
}
