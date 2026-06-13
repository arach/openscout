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
  // "Trace" = the parsed feed (its own tab); "Observe" is reserved for watching
  // the live terminal (a rail action), so the two surfaces don't share a word.
  const tabs = ["Profile", "Trace", "Message"];
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

/* Agent-level runtime for the rail's lower Context card. cwd · branch · harness ·
   model · host already live in the header, so this keeps only what they don't. */
const SESSION_RUNTIME: Array<{ k: string; v: string }> = [
  { k: "Transport", v: "tmux" },
  { k: "Role", v: "relay agent" },
  { k: "Class", v: "general" },
];

/* What the session has actually been doing — a summary of the trace. The full
   feed lives one click away in the Trace tab; this is the at-a-glance readout
   for the session context. (turns + window are cheap from the live context
   state; tools/reads/edits + files-touched come from the parsed trace.) */
const SESSION_STATS: Array<{ k: string; v: string }> = [
  { k: "turns", v: "80" },
  { k: "tools", v: "489" },
  { k: "edits", v: "169" },
  { k: "reads", v: "125" },
  { k: "files", v: "71" },
  { k: "window", v: "16h" },
];

type TouchState = "read" | "created" | "modified";
const FILES_TOUCHED: Array<{ path: string; touches: number; state: TouchState }> = [
  { path: "packages/web/client/screens/AgentsScreen.tsx", touches: 73, state: "modified" },
  { path: "packages/web/client/screens/agents-screen.css", touches: 41, state: "modified" },
  { path: "packages/web/client/lib/session-catalog.ts", touches: 6, state: "created" },
  { path: "design/studio/app/studies/agent-profile-rebalance/page.tsx", touches: 24, state: "read" },
  { path: "packages/web/client/scout/inspector/AgentsInspector.tsx", touches: 12, state: "read" },
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

/* ── header essentials: composition treatments ──────────────────────────────
   The contested bit. We carry the same five facts (cwd · branch · harness ·
   model · host) but compose them concisely instead of as a labeled word-list.
   Switch between treatments live to pick the right one before porting. */

type HeaderTreatment = "dotted" | "tiered" | "glyph" | "labeled";

const ESSENTIALS = {
  cwd: "~/dev/hudson",
  branch: "feat/hud-markdown-renderer",
  harness: "claude",
  model: "opus-4.8",
  host: "arts-mac-mini",
};

/* Tiny monochrome line-glyphs (geometric, not emoji) for the glyph treatment. */
const ICO = "h-[11px] w-[11px] flex-none";
function IcoFolder() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={ICO}>
      <path d="M2 4h4l1.4 1.6H14v6.4H2z" strokeLinejoin="round" />
    </svg>
  );
}
function IcoBranch() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={ICO}>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M4.5 5v6M4.5 11c0-3 7-1.4 7-4" strokeLinecap="round" />
    </svg>
  );
}
function IcoChip() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={ICO}>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
      <path d="M6.5 2v2M9.5 2v2M6.5 12v2M9.5 12v2M2 6.5h2M2 9.5h2M12 6.5h2M12 9.5h2" strokeLinecap="round" />
    </svg>
  );
}
function IcoHost() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={ICO}>
      <rect x="2.5" y="3.5" width="11" height="7" rx="1" />
      <path d="M6 13h4M8 10.5V13" strokeLinecap="round" />
    </svg>
  );
}

function FactSep() {
  return <span style={{ color: INK.edge }}>·</span>;
}

/** A · dotted — label-less, dot-separated. Format carries meaning. */
function FactsDotted() {
  const facts = [ESSENTIALS.cwd, `⎇ ${ESSENTIALS.branch}`, ESSENTIALS.harness, ESSENTIALS.model, ESSENTIALS.host];
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px]" style={{ color: MUTED }}>
      {facts.map((v, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <FactSep /> : null}
          <span className="truncate">{v}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

/** B · tiered — workspace (path · ⎇branch) on top, runtime faint below. */
function FactsTiered() {
  return (
    <div className="flex flex-col gap-1 font-mono">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px]" style={{ color: MUTED }}>
        <span className="truncate">{ESSENTIALS.cwd}</span>
        <FactSep />
        <span className="truncate">⎇ {ESSENTIALS.branch}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 text-[9px]" style={{ color: FAINT }}>
        <span>{ESSENTIALS.harness}</span>
        <FactSep />
        <span>{ESSENTIALS.model}</span>
        <FactSep />
        <span>{ESSENTIALS.host}</span>
      </div>
    </div>
  );
}

/** C · tiered + glyph — the picked direction. A 2×2 grid: location on the left
    (path, then host beneath it), work context on the right (branch, then the
    merged harness·model beneath it). One line-glyph per row, no word labels. */
function FactsGlyph() {
  const cells = [
    { ico: <IcoFolder />, v: ESSENTIALS.cwd },
    { ico: <IcoBranch />, v: ESSENTIALS.branch },
    { ico: <IcoHost />, v: ESSENTIALS.host },
    { ico: <IcoChip />, v: `${ESSENTIALS.harness} · ${ESSENTIALS.model}` },
  ];
  return (
    <div
      className="grid w-fit grid-cols-[auto_auto] gap-x-8 gap-y-1.5 font-mono text-[10px]"
      style={{ color: MUTED }}
    >
      {cells.map((c, i) => (
        <span key={i} className="inline-flex min-w-0 items-center gap-1.5">
          <span className="flex-none" style={{ color: FAINT }}>
            {c.ico}
          </span>
          <span className="truncate">{c.v}</span>
        </span>
      ))}
    </div>
  );
}

/** D · labeled — the current baseline, uppercase key + value. */
function FactsLabeled() {
  const facts = [
    { k: "cwd", v: ESSENTIALS.cwd },
    { k: "branch", v: `⎇ ${ESSENTIALS.branch}` },
    { k: "harness", v: ESSENTIALS.harness },
    { k: "model", v: ESSENTIALS.model },
    { k: "host", v: ESSENTIALS.host },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {facts.map((f) => (
        <span key={f.k} className="inline-flex items-baseline gap-1.5 font-mono">
          <span className="text-[7.5px] uppercase tracking-[0.14em]" style={{ color: FAINT }}>{f.k}</span>
          <span className="text-[10px]" style={{ color: MUTED }}>{f.v}</span>
        </span>
      ))}
    </div>
  );
}

/** Compact essentials header. The avatar gets a sober (neutral) lift that
    accentuates on hover; the handle is dim (identity, not status). No live
    dot, no accent glow, no arbitrary color — the facts compose per treatment. */
function ProfileHeader({ treatment }: { treatment: HeaderTreatment }) {
  return (
    <div
      className="flex items-start justify-between gap-3 px-[18px] py-3.5"
      style={{
        borderBottom: `1px solid ${INK.edgeSoft}`,
        background: "linear-gradient(180deg, color-mix(in oklab, white 4%, transparent) 0%, transparent 70%)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="ap-avatar-light inline-flex flex-none">
          <SpriteAvatar name={AGENT} size={46} tile />
        </span>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[20px] leading-none" style={{ color: INKC }}>
              {AGENT}
            </span>
            <span className="font-mono text-[11px]" style={{ color: FAINT }}>
              @hudson
            </span>
          </div>
          <div className="mt-2">
            {treatment === "dotted" ? (
              <FactsDotted />
            ) : treatment === "tiered" ? (
              <FactsTiered />
            ) : treatment === "glyph" ? (
              <FactsGlyph />
            ) : (
              <FactsLabeled />
            )}
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
  unified = false,
}: {
  s: Session;
  selected: boolean;
  onSelect: () => void;
  /** When the row + its rollout are wrapped in one card, the card draws the
      border, tint and accent spine — the row defers its own so the two read as
      a single block, not two stacked sessions. */
  unified?: boolean;
}) {
  const active = s.state === "active";
  const prefix = s.initiatorKind === "channel" ? "from" : "started by";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex w-full cursor-pointer gap-2.5 px-4 py-2.5 text-left transition-colors",
        !unified && "hover:bg-[oklch(0.145_0.008_80)]",
      )}
      style={{
        background: !unified && selected ? `color-mix(in oklab, ${ACCENT} 9%, transparent)` : undefined,
        borderTop: unified ? undefined : `1px solid ${INK.edgeSoft}`,
      }}
    >
      {selected && !unified ? (
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
            {active ? "now" : `ended · ${s.ago}`}
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

function SessionsCenter({
  sel,
  onSelect,
  centerDetail = "none",
  headerTreatment = "dotted",
}: {
  sel: number;
  onSelect: (i: number) => void;
  centerDetail?: "none" | "full" | "light";
  headerTreatment?: HeaderTreatment;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col" style={{ background: INK.canvas }}>
      <TopBar />
      <ProfileHeader treatment={headerTreatment} />
      <div className="flex flex-none items-center justify-between px-4 pb-1 pt-3">
        <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>
          Recent sessions
        </span>
        <span className="font-mono text-[8.5px] tabular-nums" style={{ color: FAINT }}>
          {SESSIONS.length} sessions
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {SESSIONS.map((s, i) => {
          const isSel = i === sel;
          const showDetail = centerDetail !== "none" && isSel;
          if (!showDetail) {
            return <SessionRow key={s.id} s={s} selected={isSel} onSelect={() => onSelect(i)} />;
          }
          const active = s.state === "active";
          return (
            /* Selected row + rollout as ONE card: a single accent spine running
               the full height, a shared tint, and NO divider between them — so
               the rollout reads as the detail OF this session, not the next one
               in the list. (The neighbouring rows' borderTop still fences the
               card top & bottom, matching every other row separation.) */
            <div
              key={s.id}
              className="relative"
              style={{
                background: `color-mix(in oklab, ${ACCENT} 8%, transparent)`,
                borderTop: `1px solid ${INK.edgeSoft}`,
              }}
            >
              <span className="absolute left-0 top-0 h-full w-[2px]" style={{ background: ACCENT }} />
              <SessionRow s={s} selected onSelect={() => onSelect(i)} unified />
              {centerDetail === "full" ? (
                <div className="px-4 pb-3.5"><SessionDetailBody s={s} /></div>
              ) : (
                <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    {/* elbow — the rollout branches off the row above it */}
                    <span
                      className="ml-[2px] mt-[-6px] h-[9px] w-[9px] flex-none rounded-bl-[3px]"
                      style={{ borderLeft: `1px solid ${INK.edge}`, borderBottom: `1px solid ${INK.edge}` }}
                    />
                    <span className="truncate text-[11px]" style={{ color: MUTED }}>
                      {active ? s.context[0] ?? s.snapshot : `Last · ${s.context[0] ?? s.snapshot}`}
                    </span>
                  </div>
                  <EngagePrimary active={active} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── rail building blocks ─────────────────────────────────────────────────── */

/** Engage, grouped by the surface each action opens — so Continue (conversation)
    reads as distinct from Take over (terminal), without leaning on clever words. */
function EngageZone({ active }: { active: boolean }) {
  const rows: Array<{
    label: string;
    actions: Array<{ t: string; on: boolean; primary?: boolean; title: string }>;
  }> = [
    {
      label: "Conversation",
      actions: [
        {
          t: active ? "Continue" : "Resume",
          on: true,
          primary: true,
          title: active ? "Send a message into this conversation" : "Reopen this conversation and message it",
        },
      ],
    },
    {
      label: "Terminal",
      actions: [
        { t: "Observe", on: active, title: active ? "Watch the live terminal, read-only" : "No live terminal to observe" },
        { t: "Take over", on: active, title: active ? "Grab the keyboard and drive it" : "Can't take over an ended session" },
      ],
    },
  ];
  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="font-mono text-[8px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>
        Engage
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2.5">
            <span
              className="w-[78px] flex-none font-mono text-[8px] uppercase tracking-[0.13em]"
              style={{ color: FAINT }}
            >
              {r.label}
            </span>
            <div className="flex gap-1.5">
              {r.actions.map((a) => (
                <button
                  key={a.t}
                  type="button"
                  disabled={!a.on}
                  title={a.title}
                  className="rounded-[4px] px-2.5 py-1.5 font-mono text-[8px] font-semibold uppercase tracking-[0.1em] disabled:cursor-default"
                  style={
                    a.primary && a.on
                      ? { background: ACCENT, color: INK.canvas, cursor: "pointer" }
                      : {
                          cursor: a.on ? "pointer" : "default",
                          border: `1px solid ${a.on ? INK.edge : INK.edgeSoft}`,
                          color: a.on ? MUTED : INK.edge,
                        }
                  }
                >
                  {a.t}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The single most-likely action, sized up to sit inline in the center. */
function EngagePrimary({ active }: { active: boolean }) {
  return (
    <button
      type="button"
      className="flex-none cursor-pointer rounded-[4px] px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em]"
      style={{ background: ACCENT, color: INK.canvas }}
      title={active ? "Send a message into this conversation" : "Reopen this conversation and message it"}
    >
      {active ? "Continue" : "Resume"}
    </button>
  );
}

/** The secondary engage surface (Terminal) — for the session rail. The parsed
    trace has its own top-bar tab, so it isn't duplicated here. */
function EngageSecondary({ active }: { active: boolean }) {
  const rows: Array<{ label: string; actions: Array<{ t: string; on: boolean; title: string }> }> = [
    {
      label: "Terminal",
      actions: [
        { t: "Observe", on: active, title: active ? "Watch the live terminal, read-only" : "No live terminal to observe" },
        { t: "Take over", on: active, title: active ? "Grab the keyboard and drive it" : "Can't take over an ended session" },
      ],
    },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2.5">
          <span className="w-[64px] flex-none font-mono text-[8px] uppercase tracking-[0.13em]" style={{ color: FAINT }}>
            {r.label}
          </span>
          <div className="flex gap-1.5">
            {r.actions.map((a) => (
              <button
                key={a.t}
                type="button"
                disabled={!a.on}
                title={a.title}
                className="rounded-[4px] px-2.5 py-1.5 font-mono text-[8px] font-semibold uppercase tracking-[0.1em] disabled:cursor-default"
                style={{
                  cursor: a.on ? "pointer" : "default",
                  border: `1px solid ${a.on ? INK.edge : INK.edgeSoft}`,
                  color: a.on ? MUTED : INK.edge,
                }}
              >
                {a.t}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The selected session's detail — snapshot, initiator, transcript, engage.
    `engage` picks the full gradient (rail-only modes) or just the secondary
    surfaces (hybrid, where the primary Continue lives inline in the center). */
/** A flat metric readout — value bright, unit faint, dot-separated. No boxes:
    the calm session context reads stats as a line, not a grid of cards. */
function ActivityStats() {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5 font-mono">
      {SESSION_STATS.map((m, i) => (
        <span key={m.k} className="inline-flex items-baseline gap-1">
          {i > 0 ? <span className="mr-1" style={{ color: INK.edge }}>·</span> : null}
          <span className="text-[12px] tabular-nums" style={{ color: INKC }}>{m.v}</span>
          <span className="text-[8.5px] uppercase tracking-[0.08em]" style={{ color: FAINT }}>{m.k}</span>
        </span>
      ))}
    </div>
  );
}

/** The most concrete "what did it do" signal — files split into what it CHANGED
    (created/modified, accent +/~ mark, bright) vs what it only READ (dim), so the
    durable output reads first. Sorted changed-first, then by touch count. */
function FilesTouched({ limit = 4 }: { limit?: number }) {
  const ordered = [...FILES_TOUCHED].sort((a, b) => {
    const ra = a.state === "read" ? 0 : 1;
    const rb = b.state === "read" ? 0 : 1;
    return ra !== rb ? rb - ra : b.touches - a.touches;
  });
  const shown = ordered.slice(0, limit);
  const rest = FILES_TOUCHED.length - shown.length;
  return (
    <div className="flex flex-col gap-1">
      {shown.map((f) => {
        // parent/filename — the filename is the signal; a right-truncating full
        // path would clip it. Full path on hover.
        const parts = f.path.replace(/\/+$/, "").split("/");
        const name = parts.pop() ?? f.path;
        const parent = parts.pop();
        const dir = parent ? `${parent}/` : "";
        const changed = f.state !== "read";
        const mark = f.state === "created" ? "+" : f.state === "modified" ? "~" : "·";
        return (
          <div key={f.path} className="flex items-baseline justify-between gap-2 font-mono text-[10px] leading-tight" title={`${f.path} · ${f.state}`}>
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="flex-none tabular-nums" style={{ color: changed ? ACCENT : INK.edge }}>{mark}</span>
              <span className="flex min-w-0 items-baseline">
                <span className="truncate" style={{ color: INK.edge }}>{dir}</span>
                <span className="flex-none" style={{ color: changed ? MUTED : FAINT }}>{name}</span>
              </span>
            </span>
            <span className="flex-none tabular-nums text-[9px]" style={{ color: FAINT }}>×{f.touches}</span>
          </div>
        );
      })}
      {rest > 0 ? (
        <button
          type="button"
          className="mt-0.5 w-fit cursor-pointer font-mono text-[9px] uppercase tracking-[0.1em]"
          style={{ color: FAINT }}
        >
          +{rest} more in Trace →
        </button>
      ) : null}
    </div>
  );
}

function SessionDetailBody({ s, engage = "full" }: { s: Session; engage?: "full" | "secondary" }) {
  const active = s.state === "active";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-1.5">
          <Dot on={active} size={6} />
          <span className="font-mono text-[12px]" style={{ color: INKC }}>{s.id}</span>
          <span className="rounded-sm px-1 font-mono text-[7px] uppercase tracking-[0.08em]" style={{ background: INK.module, color: FAINT }}>
            {s.transport}
          </span>
          <span className="ml-auto font-mono text-[8px] uppercase tracking-[0.12em]" style={{ color: active ? ACCENT : FAINT }}>
            {active ? "now" : `ended · ${s.ago}`}
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

      <RailSection label="Activity">
        <ActivityStats />
        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${INK.edgeSoft}` }}>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="font-mono text-[8px] uppercase tracking-[0.14em]" style={{ color: FAINT }}>
              Files touched
            </span>
            <span className="font-mono text-[8px] tabular-nums" style={{ color: FAINT }}>
              {(() => {
                const changed = FILES_TOUCHED.filter((f) => f.state !== "read").length;
                return changed > 0 ? `${changed} changed · ${FILES_TOUCHED.length}` : `${FILES_TOUCHED.length}`;
              })()}
            </span>
          </div>
          <FilesTouched />
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

      {engage === "full" ? (
        <EngageZone active={active} />
      ) : (
        <RailSection label="Actions">
          <EngageSecondary active={active} />
        </RailSection>
      )}
    </div>
  );
}

/** The agent context card — runtime detail + relationships (no header dupes). */
function ContextBody() {
  return (
    <div className="flex flex-col gap-4">
      <RailSection label="Runtime">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          {SESSION_RUNTIME.map((f) => (
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
  );
}

const RAIL_W = 300;

/* ── three rail solutions ─────────────────────────────────────────────────── */

/** A · stacked — session detail on top, agent context card below. One scroll. */
function RailStacked({ s }: { s: Session }) {
  const active = s.state === "active";
  return (
    <div className="flex flex-none flex-col" style={{ width: RAIL_W, background: INK.panel, borderLeft: `1px solid ${INK.edge}` }}>
      <div className="flex h-[34px] flex-none items-center justify-between px-3" style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}>
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>Session</span>
        <span className="font-mono text-[8px] uppercase tracking-[0.12em]" style={{ color: active ? ACCENT : FAINT }}>
          {active ? "now" : `ended · ${s.ago}`}
        </span>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="p-3.5"><SessionDetailBody s={s} /></div>
        <div className="flex flex-col gap-4 p-3.5" style={{ borderTop: `1px solid ${INK.edge}`, background: "oklch(0.132 0.008 80)" }}>
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>Context</span>
          <ContextBody />
        </div>
      </div>
    </div>
  );
}

/** B · swap — a [Session | Context] toggle picks which one fills the rail. */
function RailSwap({ s }: { s: Session }) {
  const [tab, setTab] = React.useState<"session" | "context">("session");
  return (
    <div className="flex flex-none flex-col" style={{ width: RAIL_W, background: INK.panel, borderLeft: `1px solid ${INK.edge}` }}>
      <div className="flex h-[34px] flex-none items-center px-3" style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}>
        <div className="flex gap-0.5 rounded-[5px] p-[2px]" style={{ background: INK.canvas, border: `1px solid ${INK.edgeSoft}` }}>
          {(["session", "context"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="cursor-pointer rounded-[3px] px-2.5 py-[3px] font-mono text-[8px] font-semibold uppercase tracking-[0.12em] transition-colors"
              style={tab === t ? { background: ACCENT, color: INK.canvas } : { color: FAINT }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3.5">
        {tab === "session" ? <SessionDetailBody s={s} /> : <ContextBody />}
      </div>
    </div>
  );
}

/** C · context-only — rail is the agent card; session detail lives inline in center. */
function RailContextOnly() {
  return (
    <div className="flex flex-none flex-col" style={{ width: RAIL_W, background: INK.panel, borderLeft: `1px solid ${INK.edge}` }}>
      <div className="flex h-[34px] flex-none items-center px-3" style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}>
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>Context</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3.5"><ContextBody /></div>
    </div>
  );
}

/** D · hybrid — the rail is session-focused: session info + the secondary actions
    (Terminal · Trace). The primary Continue lives inline in the center, so the
    rail holds everything else about the session rather than high-level agent facts. */
function RailHybrid({ s }: { s: Session }) {
  const active = s.state === "active";
  return (
    <div className="flex flex-none flex-col" style={{ width: RAIL_W, background: INK.panel, borderLeft: `1px solid ${INK.edge}` }}>
      <div className="flex h-[34px] flex-none items-center justify-between px-3" style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}>
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>Session</span>
        <span className="font-mono text-[8px] uppercase tracking-[0.12em]" style={{ color: active ? ACCENT : FAINT }}>
          {active ? "now" : `ended · ${s.ago}`}
        </span>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto p-3.5">
        <SessionDetailBody s={s} engage="secondary" />
        <div className="mt-4 border-t pt-4" style={{ borderColor: INK.edgeSoft }}>
          <RailSection label="Runtime">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              {SESSION_RUNTIME.map((f) => (
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
        </div>
      </div>
    </div>
  );
}

type RailMode = "hybrid" | "inline" | "stacked" | "swap";

export function Frame({
  railMode = "hybrid",
  headerTreatment = "dotted",
}: {
  railMode?: RailMode;
  headerTreatment?: HeaderTreatment;
}) {
  const [sel, setSel] = React.useState(0);
  const s = SESSIONS[sel];
  const centerDetail: "none" | "full" | "light" =
    railMode === "inline" ? "full" : railMode === "hybrid" ? "light" : "none";
  return (
    <div
      className="flex overflow-hidden rounded-lg"
      style={{ border: `1px solid ${INK.edge}`, minHeight: 600, background: INK.canvas }}
    >
      <SessionsCenter sel={sel} onSelect={setSel} centerDetail={centerDetail} headerTreatment={headerTreatment} />
      {railMode === "hybrid" ? (
        <RailHybrid s={s} />
      ) : railMode === "stacked" ? (
        <RailStacked s={s} />
      ) : railMode === "swap" ? (
        <RailSwap s={s} />
      ) : (
        <RailContextOnly />
      )}
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
  const [railMode, setRailMode] = React.useState<RailMode>("hybrid");
  const [headerTreatment, setHeaderTreatment] = React.useState<HeaderTreatment>("glyph");
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("rail");
    if (r === "hybrid" || r === "inline" || r === "stacked" || r === "swap") setRailMode(r);
    const h = params.get("header");
    if (h === "dotted" || h === "tiered" || h === "glyph" || h === "labeled") setHeaderTreatment(h);
  }, []);
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      {/* Sober avatar lift — neutral ring + shallow drop, accentuated (still
          neutral) on hover. No accent glow. */}
      <style>{`
        .ap-avatar-light {
          border-radius: 12px;
          transition: box-shadow 0.18s ease;
          box-shadow: 0 0 0 1px color-mix(in oklab, white 9%, transparent),
                      0 5px 14px oklch(0.06 0.006 75 / 0.5);
        }
        .ap-avatar-light:hover {
          box-shadow: 0 0 0 1px color-mix(in oklab, white 20%, transparent),
                      0 0 16px color-mix(in oklab, white 9%, transparent),
                      0 8px 20px oklch(0.06 0.006 75 / 0.55);
        }
      `}</style>
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · agent-profile-rebalance
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent Profile · Rebalance
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Sessions-first. When you open an agent you care, in order, about{" "}
          <span className="text-studio-ink">the essentials (state · cwd · branch · harness · model)</span>,
          then <span className="text-studio-ink">its recent sessions by recency</span> — which are active
          or recently active — and for a session, a{" "}
          <span className="text-studio-ink">context snapshot + who initiated it</span>. Selecting a
          session opens its detail in the rail, where every way to engage lives in one place as a
          gradient — <span className="text-studio-ink">Continue → Activity → Observe → Take over</span>
          {" "}— or you start a new one. No giant idle &ldquo;Now&rdquo; hero, and no floating
          &ldquo;Terminal&rdquo; bar that just restates the active session — idle reads as a calm list,
          active lights its top session.
        </p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div
          className="inline-flex rounded-[6px] p-[3px]"
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

        {view === "rebalanced" ? (
          <div className="inline-flex items-center gap-2">
            <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-studio-ink-faint">Rail</span>
            <div
              className="inline-flex rounded-[6px] p-[3px]"
              style={{ background: "var(--studio-canvas-alt, oklch(0.16 0.006 80))", border: "1px solid var(--studio-edge, oklch(0.27 0.008 80))" }}
            >
              {([
                { id: "hybrid", label: "Hybrid" },
                { id: "inline", label: "Inline" },
                { id: "stacked", label: "Stacked" },
                { id: "swap", label: "Swap" },
              ] as Array<{ id: RailMode; label: string }>).map((m) => {
                const active = railMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setRailMode(m.id)}
                    aria-pressed={active}
                    className={cn(
                      "cursor-pointer rounded-[4px] px-3 py-[6px] font-mono text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors",
                      !active && "text-studio-ink-faint hover:bg-studio-canvas hover:text-studio-ink",
                    )}
                    style={active ? { background: ACCENT, color: INK.canvas } : undefined}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {view === "rebalanced" ? (
          <div className="inline-flex items-center gap-2">
            <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-studio-ink-faint">Header</span>
            <div
              className="inline-flex rounded-[6px] p-[3px]"
              style={{ background: "var(--studio-canvas-alt, oklch(0.16 0.006 80))", border: "1px solid var(--studio-edge, oklch(0.27 0.008 80))" }}
            >
              {([
                { id: "glyph", label: "Tiered+" },
                { id: "tiered", label: "Tiered" },
                { id: "dotted", label: "Dotted" },
                { id: "labeled", label: "Labeled" },
              ] as Array<{ id: HeaderTreatment; label: string }>).map((m) => {
                const active = headerTreatment === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setHeaderTreatment(m.id)}
                    aria-pressed={active}
                    className={cn(
                      "cursor-pointer rounded-[4px] px-3 py-[6px] font-mono text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors",
                      !active && "text-studio-ink-faint hover:bg-studio-canvas hover:text-studio-ink",
                    )}
                    style={active ? { background: ACCENT, color: INK.canvas } : undefined}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {view === "current" ? <CurrentFrame /> : <Frame railMode={railMode} headerTreatment={headerTreatment} />}
      <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-studio-ink-faint">
        {view === "current"
          ? "Recreated from the live :5180 Hudson capture — center half-empty, rail packed"
          : `${
              headerTreatment === "dotted"
                ? "Header: dotted — label-less, dot-separated"
                : headerTreatment === "tiered"
                  ? "Header: tiered — workspace on top, runtime faint below"
                  : headerTreatment === "glyph"
                    ? "Header: tiered + glyph — path · host (left), branch · harness/model (right), one glyph each"
                    : "Header: labeled — the current baseline"
            } · ${
              railMode === "hybrid"
                ? "Hybrid rail — Continue inline, session actions in the rail"
                : railMode === "stacked"
                  ? "Stacked rail"
                  : railMode === "swap"
                    ? "Swap rail"
                    : "Inline rail"
            }`}
      </div>

      <section className="mt-9 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">
          The hierarchy
        </div>
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-studio-ink-faint">
          <li>
            <span className="text-studio-ink">Essentials, always in view.</span> A state dot by the
            name, then cwd · ⎇branch · harness · model · host in a single compact line — no big block,
            no scrolling for them.
          </li>
          <li>
            <span className="text-studio-ink">Sessions are the spine.</span> Ordered by recency (no
            &ldquo;by recency&rdquo; label — the order says it); the active one carries a live dot, ended
            ones show how long ago. The active row <em>is</em> the live/terminal indicator — no separate
            floating &ldquo;Terminal&rdquo; bar restating it.
          </li>
          <li>
            <span className="text-studio-ink">Click selects, never jumps.</span> Clicking a session
            opens its detail in the rail (snapshot · who initiated · transcript) — it does not drop you
            into a live terminal. Entering a terminal is always a deliberate second click.
          </li>
          <li>
            <span className="text-studio-ink">One world to engage.</span> All the ways to engage a
            session live together in the rail, as a gradient: <em>Continue</em> (message into the
            conversation) → <em>Activity</em> (read the parsed feed) → <em>Observe</em> (watch the live
            terminal) → <em>Take over</em> (drive it). Observe / Take over grey out when the session
            isn&apos;t live. The other branch — <em>+ New session</em> — sits in the header.
          </li>
        </ul>
      </section>
    </main>
  );
}
