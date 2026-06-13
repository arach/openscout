"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Scout · Agent Profile — Rebalance (sessions-first)

   What you actually care about when you open an agent profile, in order:
     1. the essentials — cwd · harness · model (and branch)
     2. its recent sessions, by recency — which are active / recently active
     3. for a session: a context snapshot + who initiated it
     4. the action: continue an existing session, or start a new one

   So the profile is a compact essentials header over a recency-ordered session
   list (the spine), with the selected session's detail in the rail. No giant
   idle "Now" hero — an idle agent reads as a calm list, an active one lights its
   top session. Toggle Current ↔ Rebalanced; "Current" recreates the live Hudson
   profile so the shift is apples-to-apples.
   ─────────────────────────────────────────────────────────────────────────── */

import React from "react";
import { cn } from "@/lib/utils";
import { SpriteAvatar } from "@/components/SpriteAvatar";

/* ── palette ──────────────────────────────────────────────────────────────── */

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

const AGENT = "Hudson";

function Dot({ on = true, size = 6 }: { on?: boolean; size?: number }) {
  return (
    <span
      className="inline-block flex-none rounded-full"
      style={{ width: size, height: size, background: on ? ACCENT : INK.edge }}
    />
  );
}

/* ── shared chrome ──────────────────────────────────────────────────────────── */

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
        ← All agents
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

/* ═══════════════════════════════════════════════════════════════════════════
   REBALANCED — sessions-first
   ═══════════════════════════════════════════════════════════════════════════ */

type Session = {
  id: string;
  snapshot: string;
  initiator: string;
  initiatorKind: "agent" | "you" | "channel";
  state: "active" | "ended";
  ago: string;
  transport: string;
  context: string[];
};

const SESSIONS: Session[] = [
  {
    id: "relay-hu",
    snapshot: "Live comms relay — routing asks to Hudson",
    initiator: "Operator",
    initiatorKind: "agent",
    state: "active",
    ago: "now",
    transport: "tmux",
    context: [
      "Relay channel open; agent idle, awaiting next task.",
      "Last action: published feat/hud-markdown-renderer.",
    ],
  },
  {
    id: "relay-hu · 2",
    snapshot: "Ship hudsonkit feature-flags: PR → merge → publish",
    initiator: "you",
    initiatorKind: "you",
    state: "ended",
    ago: "2d",
    transport: "tmux",
    context: [
      "Merged #128, published hudsonkit@0.2.1.",
      "Bumped the OpenScout dep and cleared the feature-flag gate.",
    ],
  },
  {
    id: "8af1c2d0",
    snapshot: "HudEdgeSheet — edge-switchable modal sheet (SCO-065)",
    initiator: "#premotion",
    initiatorKind: "channel",
    state: "ended",
    ago: "5d",
    transport: "claude",
    context: [
      "Prototyped the edge-switchable sheet primitive.",
      "Handed back to #premotion for design review.",
    ],
  },
  {
    id: "1c7d22a",
    snapshot: "feature-flag primitive — research + simple v1",
    initiator: "you",
    initiatorKind: "you",
    state: "ended",
    ago: "6d",
    transport: "claude",
    context: ["Scoped the flag primitive and landed slice 1."],
  },
];

const TAIL = [
  "$ git push origin feat/hud-markdown-renderer",
  "remote: Resolving deltas: 100% (9/9)",
  "  feat/hud-markdown-renderer → published",
  "✓ idle — awaiting next task",
];

/** Who started a session — a sprite for agents, plain for you / a channel. */
function Initiator({ s, size = 12 }: { s: Session; size?: number }) {
  if (s.initiatorKind === "agent") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <SpriteAvatar name={s.initiator} size={size} />
        <span>{s.initiator}</span>
      </span>
    );
  }
  if (s.initiatorKind === "channel") {
    return (
      <span style={{ color: "color-mix(in srgb, var(--scout-accent) 65%, var(--studio-ink-muted))" }}>
        {s.initiator}
      </span>
    );
  }
  return <span>you</span>;
}

/** Compact essentials — the facts you care about most, always in view. */
function ProfileHeader() {
  const facts = [
    { k: "cwd", v: "~/dev/hudson" },
    { k: "harness", v: "claude" },
    { k: "model", v: "opus-4.8" },
    { k: "branch", v: "⎇ feat/hud-markdown-renderer" },
  ];
  return (
    <div
      className="flex items-start justify-between gap-3 px-[18px] py-3.5"
      style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <SpriteAvatar name={AGENT} size={36} tile />
        <div className="min-w-0">
          <div className="font-display text-[19px] leading-none" style={{ color: INKC }}>
            {AGENT}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {facts.map((f) => (
              <span key={f.k} className="inline-flex items-baseline gap-1.5 font-mono">
                <span className="text-[7.5px] uppercase tracking-[0.14em]" style={{ color: FAINT }}>
                  {f.k}
                </span>
                <span className="text-[10px]" style={{ color: MUTED }}>
                  {f.v}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="flex-none cursor-pointer rounded-[4px] px-3 py-[7px] font-mono text-[8.5px] font-semibold uppercase tracking-[0.1em]"
        style={{ background: ACCENT, color: INK.canvas }}
      >
        + New session
      </button>
    </div>
  );
}

function SessionRow({
  s,
  selected,
  onSelect,
}: {
  s: Session;
  selected: boolean;
  onSelect: () => void;
}) {
  const active = s.state === "active";
  const prefix = s.initiatorKind === "channel" ? "from" : "started by";
  return (
    <button
      type="button"
      onClick={onSelect}
      className="relative flex w-full cursor-pointer gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-[oklch(0.145_0.008_80)]"
      style={{
        background: selected ? `color-mix(in oklab, ${ACCENT} 9%, transparent)` : undefined,
        borderTop: `1px solid ${INK.edgeSoft}`,
      }}
    >
      {selected ? (
        <span className="absolute left-0 top-0 h-full w-[2px]" style={{ background: ACCENT }} />
      ) : null}
      <span className="mt-[3px] flex-none">
        <Dot on={active} size={6} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-mono text-[11px]" style={{ color: selected ? INKC : MUTED }}>
            {s.id}
          </span>
          <span
            className="flex-none font-mono text-[8.5px] uppercase tracking-[0.1em]"
            style={{ color: active ? ACCENT : FAINT }}
          >
            {active ? "active" : "ended"} · {s.ago}
          </span>
        </div>
        <div className="mt-1 truncate text-[12px]" style={{ color: selected ? INKC : MUTED }}>
          {s.snapshot}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[8.5px]" style={{ color: FAINT }}>
          <span>{prefix}</span>
          <Initiator s={s} size={12} />
          <span style={{ color: INK.edge }}>·</span>
          <span>{s.transport}</span>
        </div>
      </div>
    </button>
  );
}

function SessionsCenter({ sel, onSelect }: { sel: number; onSelect: (i: number) => void }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col" style={{ background: INK.canvas }}>
      <TopBar />
      <ProfileHeader />
      <div className="flex flex-none items-center justify-between px-4 pb-1 pt-3">
        <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>
          Recent sessions
        </span>
        <span className="font-mono text-[8.5px] tabular-nums" style={{ color: FAINT }}>
          {SESSIONS.length} · by recency
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {SESSIONS.map((s, i) => (
          <SessionRow key={s.id} s={s} selected={i === sel} onSelect={() => onSelect(i)} />
        ))}
      </div>
    </div>
  );
}

/** The selected session, in detail — context snapshot, initiator, the action. */
function SessionDetail({ s }: { s: Session }) {
  const active = s.state === "active";
  return (
    <div className="flex w-[300px] flex-none flex-col" style={{ background: INK.panel, borderLeft: `1px solid ${INK.edge}` }}>
      <div className="flex h-[34px] flex-none items-center justify-between px-3" style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}>
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>
          Session
        </span>
        <span className="font-mono text-[8px] uppercase tracking-[0.12em]" style={{ color: active ? ACCENT : FAINT }}>
          {active ? "active" : "ended"} · {s.ago}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3.5">
        <div>
          <div className="flex items-center gap-1.5">
            <Dot on={active} size={6} />
            <span className="font-mono text-[12px]" style={{ color: INKC }}>{s.id}</span>
            <span className="rounded-sm px-1 font-mono text-[7px] uppercase tracking-[0.08em]" style={{ background: INK.module, color: FAINT }}>
              {s.transport}
            </span>
          </div>
          <div className="mt-1.5 text-[12.5px] leading-snug" style={{ color: MUTED }}>{s.snapshot}</div>
        </div>

        <RailSection label="Context snapshot">
          <div className="flex flex-col gap-1.5">
            {s.context.map((line, i) => (
              <div key={i} className="flex gap-2 text-[11px] leading-snug" style={{ color: MUTED }}>
                <span className="flex-none" style={{ color: INK.edge }}>—</span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </RailSection>

        <RailSection label="Initiated by">
          <div className="flex items-center gap-2 font-mono text-[10px]" style={{ color: MUTED }}>
            <Initiator s={s} size={16} />
            <span style={{ color: INK.edge }}>·</span>
            <span style={{ color: FAINT }}>{s.ago} ago</span>
          </div>
        </RailSection>

        {active ? (
          <RailSection label="Transcript">
            <div
              className="rounded-[5px] p-2.5 font-mono text-[8.5px] leading-[1.5]"
              style={{ background: "oklch(0.09 0.006 80)", border: `1px solid ${INK.edgeSoft}`, color: MUTED }}
            >
              {TAIL.map((l, i) => (
                <div key={i} className="truncate" style={{ color: i === TAIL.length - 1 ? ACCENT : MUTED }}>
                  {l}
                </div>
              ))}
            </div>
          </RailSection>
        ) : null}

        <div className="mt-auto flex flex-col gap-1.5 pt-2">
          <button
            type="button"
            className="w-full cursor-pointer rounded-[4px] py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em]"
            style={{ background: ACCENT, color: INK.canvas }}
          >
            {active ? "Continue session" : "Resume session"}
          </button>
          {active ? (
            <div className="flex gap-1.5">
              {["Observe", "Trace", "Takeover"].map((b) => (
                <button
                  key={b}
                  type="button"
                  className="flex-1 cursor-pointer rounded-[4px] py-1.5 font-mono text-[8px] font-semibold uppercase tracking-[0.1em]"
                  style={{ border: `1px solid ${INK.edge}`, color: MUTED }}
                >
                  {b}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Frame() {
  const [sel, setSel] = React.useState(0);
  return (
    <div
      className="flex overflow-hidden rounded-lg"
      style={{ border: `1px solid ${INK.edge}`, minHeight: 600, background: INK.canvas }}
    >
      <SessionsCenter sel={sel} onSelect={setSel} />
      <SessionDetail s={SESSIONS[sel]} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CURRENT (recreated in code) — the live layout today, for comparison.
   Center sits half-empty (Now · Recent work · Signal, then a void); the rail
   hoards the interesting modules.
   ═══════════════════════════════════════════════════════════════════════════ */

type Work = { title: string; ago: string };
const WORK: Work[] = [
  { title: "Ship hudsonkit feature-flags: PR → merge → publish", ago: "4d" },
  { title: "HudsonKit feature-flags v1 — prototype", ago: "4d" },
  { title: "HudsonKit feature-flag primitive (research + simple v1)", ago: "5d" },
  { title: "HudEdgeSheet — edge-switchable modal sheet primitive (SCO-065)", ago: "6d" },
];

const TALKS_TO = [
  { name: "Premotion", count: 9, state: "ready" as const },
  { name: "Openscout 185", count: 6, state: "working" as const },
  { name: "Usetalkie Com", count: 4, state: "ready" as const },
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

function Workspace() {
  const rows = [
    { k: "Name", v: "Hudson" },
    { k: "Branch", v: "⎇ feat/hud-markdown-renderer" },
    { k: "Cwd", v: "~/dev/hudson" },
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

function CurBand({ label, meta, children }: { label: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-none flex-col" style={{ borderTop: `1px solid ${INK.edgeSoft}` }}>
      <header className="flex items-center justify-between px-4 pb-1.5 pt-3">
        <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>
          {label}
        </span>
        {meta != null ? (
          <span className="font-mono text-[8.5px] tabular-nums" style={{ color: FAINT }}>
            {meta}
          </span>
        ) : null}
      </header>
      <div className="px-4 pb-3">{children}</div>
    </section>
  );
}

function CurrentCenter() {
  return (
    <div className="flex min-w-0 flex-1 flex-col" style={{ background: INK.canvas }}>
      <TopBar />
      <div className="flex items-center gap-3.5" style={{ padding: "22px 18px 16px" }}>
        <SpriteAvatar name={AGENT} size={52} tile />
        <span className="font-display text-[26px] leading-none" style={{ color: INKC }}>
          {AGENT}
        </span>
      </div>

      <CurBand label="Now" meta="idle">
        <div className="flex items-start gap-2.5 rounded-[5px] px-3 py-2.5" style={{ background: INK.module, border: `1px solid ${INK.edgeSoft}` }}>
          <span className="mt-[5px]">
            <Dot on={false} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px]" style={{ color: INKC }}>
              Idle — ready for the next task
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[8.5px]" style={{ color: FAINT }}>
              <span>hudson</span>
              <span style={{ color: INK.edge }}>·</span>
              <span>⎇ feat/hud-markdown-renderer</span>
              <span style={{ color: INK.edge }}>·</span>
              <span>~/dev/hudson</span>
            </div>
          </div>
        </div>
      </CurBand>

      <CurBand label="Recent work" meta="4">
        <div className="flex flex-col">
          {WORK.map((w, i) => (
            <div
              key={w.title}
              className="flex items-center gap-2.5 py-[5px]"
              style={{ borderTop: i ? `1px solid ${INK.edgeSoft}` : undefined }}
            >
              <Dot on={false} size={5} />
              <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: MUTED }}>
                {w.title}
              </span>
              <span className="flex-none font-mono text-[8.5px] tabular-nums" style={{ color: FAINT }}>
                {w.ago}
              </span>
            </div>
          ))}
        </div>
      </CurBand>

      <CurBand label="Signal" meta="last 1h">
        <div className="py-1 text-[11.5px]" style={{ color: FAINT }}>
          No recent signal
        </div>
      </CurBand>

      {/* the void — bands don't grow, so the canvas below sits empty */}
      <div className="flex-1" />
    </div>
  );
}

const CUR_RUNTIME: Array<{ k: string; v: string }> = [
  { k: "Harness", v: "claude_stream_json" },
  { k: "Transport", v: "tmux" },
  { k: "Role", v: "relay agent" },
  { k: "Class", v: "general" },
  { k: "Host", v: "arts-mac-mini" },
];

function CurrentRail() {
  return (
    <div className="flex w-[244px] flex-none flex-col" style={{ background: INK.panel, borderLeft: `1px solid ${INK.edge}` }}>
      <div className="flex h-[34px] flex-none items-center justify-between px-3" style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}>
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>
          Context
        </span>
        <span className="flex gap-1">
          {["Trace", "Takeover"].map((t) => (
            <span key={t} className="rounded-sm px-1.5 py-[2px] font-mono text-[7px] uppercase tracking-[0.1em]" style={{ border: `1px solid ${INK.edge}`, color: FAINT }}>
              {t}
            </span>
          ))}
        </span>
      </div>
      <div className="flex flex-col gap-4 overflow-y-auto p-3">
        <RailSection label="Runtime">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            {CUR_RUNTIME.map((f) => (
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
        </RailSection>
        <RailSection label="Workspace">
          <Workspace />
        </RailSection>
        <RailSection label="Running sessions" meta="1">
          <div
            className="rounded-[5px] p-2"
            style={{ border: `1px solid color-mix(in srgb, var(--scout-accent) 40%, transparent)`, background: `color-mix(in srgb, var(--scout-accent) 8%, transparent)` }}
          >
            <div className="flex items-center gap-1.5">
              <Dot size={6} />
              <span className="font-mono text-[9.5px]" style={{ color: INKC }}>relay-hu</span>
              <span className="rounded-sm px-1 font-mono text-[7px] uppercase tracking-[0.08em]" style={{ background: INK.module, color: FAINT }}>
                tmux
              </span>
              <span className="ml-auto font-mono text-[7.5px] uppercase tracking-[0.12em]" style={{ color: ACCENT }}>
                active
              </span>
            </div>
          </div>
        </RailSection>
        <RailSection label="Talks to" meta={`${TALKS_TO.length}`}>
          <TalksToMesh />
          <div className="flex flex-col gap-[2px]">
            {TALKS_TO.map((p) => (
              <div key={p.name} className="flex items-center gap-2 px-1.5 py-1">
                <Dot on={p.state !== "idle"} size={5} />
                <span className="min-w-0 flex-1 truncate font-mono text-[9.5px]" style={{ color: MUTED }}>
                  {p.name}
                </span>
                <span className="font-mono text-[8px] tabular-nums" style={{ color: FAINT }}>
                  {p.count}
                </span>
              </div>
            ))}
          </div>
        </RailSection>
        <RailSection label="Capabilities" meta="3">
          <div className="flex flex-wrap gap-1">
            {["chat", "invoke", "deliver"].map((c) => (
              <span key={c} className="rounded-[3px] px-1.5 py-[2px] font-mono text-[8px]" style={{ background: INK.module, color: MUTED }}>
                {c}
              </span>
            ))}
          </div>
        </RailSection>
      </div>
    </div>
  );
}

export function CurrentFrame() {
  return (
    <div
      className="flex overflow-hidden rounded-lg"
      style={{ border: `1px solid ${INK.edge}`, minHeight: 600, background: INK.canvas }}
    >
      <CurrentCenter />
      <CurrentRail />
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

type View = "current" | "rebalanced";

export default function AgentProfileRebalancePage() {
  const [view, setView] = React.useState<View>("rebalanced");
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · agent-profile-rebalance
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent Profile · Rebalance
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Sessions-first. When you open an agent you care, in order, about{" "}
          <span className="text-studio-ink">the essentials (cwd · harness · model)</span>, then{" "}
          <span className="text-studio-ink">its recent sessions by recency</span> — which are active or
          recently active — and for a session, a{" "}
          <span className="text-studio-ink">context snapshot + who initiated it</span>. The action is
          simply: continue an existing session, or start a new one. So the profile is a compact
          essentials header over a recency-ordered session list, with the selected session&apos;s
          detail in the rail. No giant idle &ldquo;Now&rdquo; hero — idle reads as a calm list, active
          lights its top session.
        </p>
      </header>

      <div
        className="mb-3 inline-flex rounded-[6px] p-[3px]"
        style={{ background: "var(--studio-canvas-alt, oklch(0.16 0.006 80))", border: "1px solid var(--studio-edge, oklch(0.27 0.008 80))" }}
      >
        {(["current", "rebalanced"] as View[]).map((v) => {
          const active = view === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={active}
              className={cn(
                "cursor-pointer rounded-[4px] px-3.5 py-[6px] font-mono text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors",
                !active && "text-studio-ink-faint hover:bg-studio-canvas hover:text-studio-ink",
              )}
              style={active ? { background: ACCENT, color: INK.canvas } : undefined}
            >
              {v === "current" ? "Current (live)" : "Rebalanced"}
            </button>
          );
        })}
      </div>

      {view === "current" ? <CurrentFrame /> : <Frame />}
      <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-studio-ink-faint">
        {view === "current"
          ? "Recreated from the live :5180 Hudson capture — center half-empty, rail packed"
          : "Sessions-first — essentials header, recency-ordered sessions, selected session in the rail"}
      </div>

      <section className="mt-9 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">
          The hierarchy
        </div>
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-studio-ink-faint">
          <li>
            <span className="text-studio-ink">Essentials, always in view.</span> cwd · harness · model ·
            branch sit in a single compact line under the name — no big block, no scrolling for them.
          </li>
          <li>
            <span className="text-studio-ink">Sessions are the spine.</span> Ordered by recency; the
            active one carries a live dot, ended ones show how long ago. Idle no longer inflates into a
            hero — it&apos;s just a calm list.
          </li>
          <li>
            <span className="text-studio-ink">Each session reads at a glance.</span> A one-line context
            snapshot + who initiated it (a sprite for agents, plain for you / a channel).
          </li>
          <li>
            <span className="text-studio-ink">The decision is explicit.</span> Continue an existing
            session (rail, on the selected one) or <em>+ New session</em> (header). The selected
            session&apos;s fuller context + transcript live in the rail.
          </li>
        </ul>
      </section>
    </main>
  );
}
