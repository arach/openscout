"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Scout · Agent Profile — Modular stack (calm pass + context-card rail)

   Center = the work narrative. Rail = the agent's context card. Clean split,
   nothing printed twice:

     CENTER  identity (sprite + name) → Now → Recent work → Conversations
     RAIL    Runtime (harness·model·transport·role·class·host, a tight 2-col
             grid) → Workspace (name·⎇branch·cwd) → Sessions (recent; the active
             one carries Observe/Trace/Takeover) → Talks to (who it communicates
             with most) → Capabilities

   The rail no longer replays which agent we're looking at — we're already
   focused on it. The metadata all matters, so it stays — but organized tightly
   instead of two verbose stacked sections.
   ─────────────────────────────────────────────────────────────────────────── */

import React from "react";
import { SpriteAvatar } from "@/components/SpriteAvatar";

/* ── palette ──────────────────────────────────────────────────────────────── */

const INK = {
  canvas: "oklch(0.118 0.008 80)",
  panel: "oklch(0.145 0.008 80)",
  rail: "oklch(0.105 0.006 80)",
  module: "oklch(0.165 0.008 80)",
  edge: "oklch(0.27 0.008 80)",
  edgeSoft: "oklch(0.205 0.008 80)",
};
const ACCENT = "var(--scout-accent)";
const MUTED = "var(--studio-ink-muted)";
const FAINT = "var(--studio-ink-faint)";
const INKC = "var(--studio-ink)";

const AGENT_NAME = "Claude";

function Dot({ on = true, size = 6 }: { on?: boolean; size?: number }) {
  return (
    <span
      className="inline-block flex-none rounded-full"
      style={{ width: size, height: size, background: on ? ACCENT : INK.edge }}
    />
  );
}

/* ── top bar — back + tabs, a peer of NAVIGATION / CONTEXT ──────────────────── */

function TopBar() {
  const tabs = ["Profile", "Observe", "Message"];
  return (
    <div
      className="flex h-[34px] flex-none items-center justify-between px-3.5"
      style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}
    >
      <button
        type="button"
        className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] transition-colors hover:text-[color:var(--studio-ink)]"
        style={{ color: FAINT }}
      >
        ← Back to inbox
      </button>
      <nav className="flex items-center gap-1">
        {tabs.map((t, i) => (
          <span
            key={t}
            className="cursor-pointer px-2 py-[7px] text-[11px] transition-colors"
            style={{
              color: i === 0 ? INKC : FAINT,
              borderBottom: i === 0 ? `2px solid ${ACCENT}` : "2px solid transparent",
            }}
          >
            {t}
          </span>
        ))}
      </nav>
    </div>
  );
}

/* ── center: identity header — creature + name, nothing else ───────────────── */

function IdentityHeader() {
  return (
    <div className="flex items-center gap-3.5" style={{ padding: "22px 18px 18px" }}>
      <SpriteAvatar name={AGENT_NAME} size={52} tile />
      <span className="font-display text-[26px] leading-none" style={{ color: INKC }}>
        {AGENT_NAME}
      </span>
    </div>
  );
}

/* ── center: module bands ──────────────────────────────────────────────────── */

function Module({
  label,
  meta,
  grow,
  children,
}: {
  label: string;
  meta?: React.ReactNode;
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`flex flex-col ${grow ? "flex-1" : "flex-none"}`}
      style={{ borderTop: `1px solid ${INK.edgeSoft}` }}
    >
      <header className="flex flex-none items-center justify-between px-4 pb-1.5 pt-3">
        <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>
          {label}
        </span>
        {meta != null ? (
          <span className="font-mono text-[8.5px] tabular-nums" style={{ color: FAINT }}>
            {meta}
          </span>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-3.5">{children}</div>
    </section>
  );
}

function NowModule() {
  return (
    <Module label="Now" meta="active">
      <div
        className="flex items-start gap-2.5 rounded-[5px] px-3 py-2.5"
        style={{ background: INK.module, border: `1px solid ${INK.edgeSoft}` }}
      >
        <span className="mt-[5px]">
          <Dot />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px]" style={{ color: INKC }}>
            Reviewing the TalkieAgent overlay settings page
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[8.5px]" style={{ color: FAINT }}>
            <span>talkie</span>
            <span style={{ color: INK.edge }}>·</span>
            <span>⎇ main</span>
            <span style={{ color: INK.edge }}>·</span>
            <span>~/dev/talkie</span>
          </div>
        </div>
      </div>
    </Module>
  );
}

type Work = { title: string; ago: string };
const WORK: Work[] = [
  { title: "Wrote macos-visual-direction.md", ago: "2d" },
  { title: "Reviewed overlay settings polish", ago: "2d" },
  { title: "Injected CLI version into docs view", ago: "3d" },
];

function RecentWork() {
  return (
    <Module label="Recent work" meta={`${WORK.length}`}>
      <div className="flex flex-col">
        {WORK.map((w, i) => (
          <div
            key={w.title}
            className="flex items-center gap-2.5 py-[5px]"
            style={{ borderTop: i ? `1px solid ${INK.edgeSoft}` : undefined }}
          >
            <span className="flex-none">
              <Dot on={false} size={5} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: MUTED }}>
              {w.title}
            </span>
            <span className="flex-none font-mono text-[8.5px] tabular-nums" style={{ color: FAINT }}>
              {w.ago}
            </span>
          </div>
        ))}
      </div>
    </Module>
  );
}

type Conv = { title: string; msgs: string; ago: string; live?: boolean };
const CONVS: Conv[] = [
  { title: "TalkieAgent overlay settings", msgs: "2 msgs", ago: "1h", live: true },
  { title: "macOS visual direction", msgs: "1 / 2", ago: "2d" },
];

function Conversations() {
  const [sel, setSel] = React.useState(0);
  return (
    <Module label="Conversations" meta={`${CONVS.length}`} grow>
      <div className="flex flex-col gap-[3px]">
        {CONVS.map((c, i) => {
          const selected = i === sel;
          return (
            <button
              key={c.title}
              type="button"
              onClick={() => setSel(i)}
              className="relative flex w-full cursor-pointer items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left transition-colors"
              style={{
                background: selected ? `color-mix(in oklab, ${ACCENT} 10%, transparent)` : "transparent",
              }}
            >
              {selected ? (
                <span
                  className="absolute left-0 top-1/2 h-[16px] w-[2px] -translate-y-1/2 rounded-full"
                  style={{ background: ACCENT }}
                />
              ) : null}
              <span className="flex-none">
                <Dot on={!!c.live} size={5} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: selected ? INKC : MUTED }}>
                {c.title}
              </span>
              <span className="flex-none font-mono text-[8.5px] tabular-nums" style={{ color: FAINT }}>
                {c.msgs} · {c.ago}
              </span>
            </button>
          );
        })}
      </div>
    </Module>
  );
}

function CenterColumn() {
  return (
    <div className="flex min-w-0 flex-1 flex-col" style={{ background: INK.canvas }}>
      <TopBar />
      <IdentityHeader />
      <div className="flex flex-1 flex-col">
        <NowModule />
        <RecentWork />
        <Conversations />
      </div>
    </div>
  );
}

/* ── rail — the agent context card ─────────────────────────────────────────── */

function RailSection({ label, meta, children }: { label: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>
          {label}
        </span>
        {meta != null ? (
          <span className="font-mono text-[8.5px] tabular-nums" style={{ color: FAINT }}>
            {meta}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/* Runtime — tight 2-col readout of the facts that matter */
const RUNTIME: Array<{ k: string; v: string }> = [
  { k: "Harness", v: "claude" },
  { k: "Model", v: "opus-4.8" },
  { k: "Transport", v: "tmux" },
  { k: "Role", v: "relay agent" },
  { k: "Class", v: "general" },
  { k: "Host", v: "arts-mac-mini" },
];

function Runtime() {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
      {RUNTIME.map((f) => (
        <div key={f.k} className="min-w-0">
          <div className="font-mono text-[7px] font-semibold uppercase tracking-[0.14em]" style={{ color: FAINT }}>
            {f.k}
          </div>
          <div className="truncate font-mono text-[10px]" style={{ color: INKC }}>
            {f.v}
          </div>
        </div>
      ))}
    </div>
  );
}

/* Workspace — stacked, for the long path values */
function Workspace() {
  const rows = [
    { k: "Name", v: "talkie" },
    { k: "Branch", v: "⎇ main" },
    { k: "Cwd", v: "~/dev/talkie" },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.k} className="flex items-baseline justify-between gap-3">
          <span className="flex-none font-mono text-[7.5px] uppercase tracking-[0.12em]" style={{ color: FAINT }}>
            {r.k}
          </span>
          <span className="truncate font-mono text-[10px]" style={{ color: MUTED }}>
            {r.v}
          </span>
        </div>
      ))}
    </div>
  );
}

/* Sessions — recent; the active one carries the terminal actions */
function ActiveSession() {
  return (
    <div
      className="rounded-[5px] p-2"
      style={{
        border: `1px solid color-mix(in srgb, var(--scout-accent) 40%, transparent)`,
        background: `color-mix(in srgb, var(--scout-accent) 8%, transparent)`,
      }}
    >
      <div className="flex items-center gap-1.5">
        <Dot size={6} />
        <span className="font-mono text-[9.5px]" style={{ color: INKC }}>relay-cl</span>
        <span className="rounded-sm px-1 font-mono text-[7px] uppercase tracking-[0.08em]" style={{ background: INK.module, color: FAINT }}>
          tmux
        </span>
        <span className="ml-auto font-mono text-[7.5px] uppercase tracking-[0.12em]" style={{ color: ACCENT }}>
          active · 1h
        </span>
      </div>
      <div className="mt-2 flex gap-1">
        {[
          { label: "Observe", primary: true },
          { label: "Trace" },
          { label: "Takeover" },
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            className="flex-1 cursor-pointer rounded-[4px] py-1.5 font-mono text-[8px] font-semibold uppercase tracking-[0.1em]"
            style={
              b.primary
                ? { background: ACCENT, color: INK.canvas }
                : { border: `1px solid ${INK.edge}`, color: MUTED }
            }
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const RECENT_SESSIONS = [
  { id: "relay-cl·2", harness: "tmux", ago: "2d" },
  { id: "8af1c2d0", harness: "claude", ago: "5d" },
];

function Sessions() {
  return (
    <div className="flex flex-col gap-1.5">
      <ActiveSession />
      {RECENT_SESSIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-left transition-colors hover:bg-[oklch(0.165_0.008_80)]"
        >
          <Dot on={false} size={5} />
          <span className="font-mono text-[9.5px]" style={{ color: MUTED }}>{s.id}</span>
          <span className="rounded-sm px-1 font-mono text-[7px] uppercase tracking-[0.08em]" style={{ background: INK.module, color: FAINT }}>
            {s.harness}
          </span>
          <span className="ml-auto font-mono text-[7.5px] tabular-nums" style={{ color: FAINT }}>{s.ago}</span>
        </button>
      ))}
    </div>
  );
}

/* Talks to — who it communicates with most */
const TALKS_TO = [
  { name: "Operator", count: 9, state: "ready" as const },
  { name: "Atlas", count: 6, state: "working" as const },
  { name: "Hudson", count: 4, state: "ready" as const },
  { name: "Scout", count: 2, state: "idle" as const },
];

function TalksToMesh() {
  return (
    <svg viewBox="0 0 200 84" className="mb-2 w-full" aria-hidden>
      <circle cx="100" cy="42" r="26" fill="none" stroke={INK.edge} strokeDasharray="2 4" />
      {TALKS_TO.map((p, i) => {
        const a = (2 * Math.PI * i) / TALKS_TO.length - Math.PI / 2;
        const x = 100 + 26 * Math.cos(a);
        const y = 42 + 26 * Math.sin(a);
        const lit = p.state !== "idle";
        return (
          <g key={p.name}>
            <line x1="100" y1="42" x2={x} y2={y} stroke={ACCENT} strokeWidth="0.8" opacity={lit ? 0.5 : 0.2} />
            <circle cx={x} cy={y} r="4" fill={lit ? "oklch(0.55 0.12 200)" : INK.edge} />
          </g>
        );
      })}
      <circle cx="100" cy="42" r="6" fill="oklch(0.62 0.17 38)" stroke={ACCENT} strokeWidth="1.2" />
    </svg>
  );
}

function TalksTo() {
  return (
    <div>
      <TalksToMesh />
      <div className="flex flex-col gap-[2px]">
        {TALKS_TO.map((p) => (
          <button
            key={p.name}
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-1.5 py-1 text-left transition-colors hover:bg-[oklch(0.165_0.008_80)]"
          >
            <Dot on={p.state !== "idle"} size={5} />
            <span className="min-w-0 flex-1 truncate font-mono text-[9.5px]" style={{ color: MUTED }}>{p.name}</span>
            <span className="font-mono text-[8px] tabular-nums" style={{ color: FAINT }}>{p.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Caps() {
  return (
    <div className="flex flex-wrap gap-1">
      {["read", "edit", "shell", "ask"].map((c) => (
        <span key={c} className="rounded-[3px] px-1.5 py-[2px] font-mono text-[8px]" style={{ background: INK.module, color: MUTED }}>
          {c}
        </span>
      ))}
    </div>
  );
}

function Rail() {
  return (
    <div className="flex w-[248px] flex-none flex-col" style={{ background: INK.panel, borderLeft: `1px solid ${INK.edge}` }}>
      <div className="flex h-[34px] flex-none items-center px-3" style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}>
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>
          Context
        </span>
      </div>
      <div className="flex flex-col gap-4 overflow-y-auto p-3">
        <RailSection label="Runtime">
          <Runtime />
        </RailSection>
        <RailSection label="Workspace">
          <Workspace />
        </RailSection>
        <RailSection label="Sessions" meta="3">
          <Sessions />
        </RailSection>
        <RailSection label="Talks to" meta={`${TALKS_TO.length}`}>
          <TalksTo />
        </RailSection>
        <RailSection label="Capabilities" meta="4">
          <Caps />
        </RailSection>
      </div>
    </div>
  );
}

/* ── frame ────────────────────────────────────────────────────────────────── */

export function Frame() {
  return (
    <div
      className="flex overflow-hidden rounded-lg"
      style={{ border: `1px solid ${INK.edge}`, minHeight: 580, background: INK.canvas }}
    >
      <CenterColumn />
      <Rail />
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function AgentProfileModularPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · agent-profile-modular
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent Profile · Modular stack
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Center is the work narrative (sprite + name → Now → Recent work → Conversations). The rail
          is the agent&apos;s context card and stops replaying who we&apos;re looking at: Runtime
          (harness · model · transport · role · class · host, a tight 2-col grid) → Workspace
          (name · ⎇ branch · cwd) → Sessions (recent; the active one carries Observe / Trace /
          Takeover) → Talks to (who it communicates with most) → Capabilities. The metadata all
          stays — just organized, and printed in one place.
        </p>
      </header>

      <Frame />

      <section className="mt-9 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">
          What changed in the rail
        </div>
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-studio-ink-faint">
          <li>
            <span style={{ color: INKC }}>No identity replay →</span> when you&apos;re already focused
            on one agent, the rail doesn&apos;t repeat the avatar / name / @handle / Ready·time. (That
            replay only earns its place in a multi-agent pick context.)
          </li>
          <li>
            <span style={{ color: INKC }}>Metadata organized, not dropped →</span> the two verbose
            stacked sections (IDENTITY + PROJECT) become a tight <em>Runtime</em> 2-col grid plus a
            stacked <em>Workspace</em> block — and <em>model</em> is finally shown. Nothing is lost;
            it just reads at a glance.
          </li>
          <li>
            <span style={{ color: INKC }}>Sessions lead →</span> recent sessions for this agent, with
            the active one carrying Observe / Trace / Takeover where they belong (per session).
          </li>
          <li>
            <span style={{ color: INKC }}>Talks to →</span> who the agent communicates with most,
            ranked, with the mesh. The center drops its Presence band so collaborators live in one
            place only.
          </li>
        </ul>
      </section>
    </main>
  );
}
