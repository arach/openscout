"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Scout · Agent Profile — Cockpit direction  (live telemetry-forward)

   A real swing at the Agents → agent profile surface. The live version is a
   boxy metadata grid (two cells balloon), a dead canvas below, and a rail that
   re-prints the same facts. This direction inverts the hierarchy:

   LEAD WITH WHAT THE AGENT IS DOING — not who it is. The hero is a live status
   band (current activity + a context-load gauge + a last-activity pulse + the
   conversation it sits in). Identity (ids, machine, repo) is demoted to a
   compact eyebrow strip and one quiet facts band below the fold of attention.
   A "Ready" agent with no active task gets a confident resting state, not a
   void — "idle, ready · last shipped 12m ago" + the recent-work ledger fills it.

   CENTER owns live state + identity. RAIL is a complementary Instrument
   (presence mesh · capabilities · running sessions) and repeats nothing the
   center shows.

   Source of truth for the live surface:
     packages/web/client/screens/AgentsScreen.tsx
     packages/web/client/scout/inspector/AgentsInspector.tsx
   Palette + vocabulary lifted from scout-inspectors / agent-profile-tidy.
   ─────────────────────────────────────────────────────────────────────────── */

import React from "react";

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
const INK_TXT = "var(--studio-ink)";
const INK_MUTED = "var(--studio-ink-muted, oklch(0.7 0.01 80))";

/* ── mock data (shared across the three directions) ───────────────────────── */

const RECENT = [
  { title: "Wire scoutd repo-watch signing", ago: "12m" },
  { title: "Fix HUD tail backlog state", ago: "1h" },
  { title: "Inject CLI version into docs view", ago: "3h" },
];

const FACTS: { k: string; v: string; sub?: string; wide?: boolean }[] = [
  { k: "Agent ID", v: "openscout-card-0.lxrq1a", sub: "definition openscout-card-0", wide: true },
  { k: "Class", v: "relay_agent" },
  { k: "Transport", v: "tmux" },
  { k: "Selector", v: "@openscout-card-0-lxrq1a", wide: true },
  { k: "Authority", v: "art-mac", sub: "qualified route" },
  { k: "Machine", v: "art-mac" },
  { k: "Workspace", v: "openscout", sub: "8 teammates" },
  { k: "Working dir", v: "~/dev/openscout", sub: "uptime 2m" },
];

const PEERS = [
  { name: "Atlas", state: "working", live: true },
  { name: "Juno", state: "ready", live: false },
  { name: "Hudson", state: "ready", live: false },
  { name: "Relay", state: "idle", live: false },
];

const CAPS = ["read", "edit", "shell", "ask", "spawn"];

/* ── small primitives ─────────────────────────────────────────────────────── */

function Dot({ live = false, size = 6 }: { live?: boolean; size?: number }) {
  return (
    <span
      className="inline-block flex-none rounded-full"
      style={{
        width: size,
        height: size,
        background: live ? ACCENT : INK.edge,
        boxShadow: live ? `0 0 0 3px color-mix(in oklab, ${ACCENT} 16%, transparent)` : undefined,
      }}
    />
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[7.5px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">
      {children}
    </span>
  );
}

/* The avatar reads as a glyph tile, not a photo — keeps identity quiet. */
function Avatar({ size = 30 }: { size?: number }) {
  return (
    <div
      className="grid flex-none place-items-center rounded-[7px] font-mono"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: INK.module,
        border: `1px solid ${INK.edgeSoft}`,
        color: INK_MUTED,
      }}
    >
      O
    </div>
  );
}

/* ── HERO: the live band ──────────────────────────────────────────────────── */

/* A thin horizontal gauge for context load. The empty/low case is designed:
   a quiet track with a 2px lead cap parked at the origin, labelled "headroom"
   — it reads as "plenty of room", not "broken / nothing here". */
function ContextGauge({ pct }: { pct: number }) {
  const filled = Math.max(pct, 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <Eyebrow>Context load</Eyebrow>
        <span className="font-mono text-[9px] tabular-nums text-studio-ink-faint">
          0 turns · last activity now
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[26px] leading-none tabular-nums" style={{ color: INK_TXT }}>
          {pct}
          <span className="ml-0.5 text-[12px] text-studio-ink-faint">%</span>
        </span>
        <div className="relative h-[5px] flex-1 overflow-hidden rounded-full" style={{ background: INK.edgeSoft }}>
          {filled > 0 ? (
            <div className="h-full rounded-full" style={{ width: `${filled}%`, background: ACCENT }} />
          ) : (
            /* origin lead-cap for the empty case */
            <span className="absolute left-0 top-0 h-full w-[2px] rounded-full" style={{ background: ACCENT, opacity: 0.85 }} />
          )}
        </div>
        <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-studio-ink-faint">
          full headroom
        </span>
      </div>
    </div>
  );
}

/* The single loudest element on the page: what is this agent doing right now. */
function LiveBand() {
  return (
    <div
      className="relative overflow-hidden rounded-lg px-5 py-4"
      style={{
        background: `linear-gradient(180deg, color-mix(in oklab, ${ACCENT} 5%, ${INK.module}) 0%, ${INK.module} 60%)`,
        border: `1px solid color-mix(in oklab, ${ACCENT} 22%, ${INK.edge})`,
      }}
    >
      {/* state + activity headline */}
      <div className="flex items-start gap-3">
        <div className="mt-[3px] flex items-center gap-2">
          <Dot live size={7} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: ACCENT }}>
              Ready
            </span>
            <span className="font-mono text-[9px] text-studio-ink-faint">· idle, holding · updated 2m ago</span>
          </div>
          {/* resting-state headline — confident, not a void */}
          <div className="mt-2 text-[15px] leading-snug" style={{ color: INK_TXT }}>
            Idle and ready for the next task.
          </div>
          <div className="mt-1 font-mono text-[10px] text-studio-ink-faint">
            Last shipped{" "}
            <span style={{ color: INK_MUTED }}>“Wire scoutd repo-watch signing”</span> · 12m ago
          </div>
        </div>
        {/* the conversation it sits in */}
        <button
          type="button"
          className="flex flex-none cursor-pointer flex-col items-end gap-1 rounded-[5px] px-2.5 py-1.5 text-right transition-colors hover:bg-[oklch(0.165_0.008_80)]"
          style={{ border: `1px solid ${INK.edgeSoft}` }}
        >
          <Eyebrow>Conversation</Eyebrow>
          <span className="font-mono text-[11px]" style={{ color: INK_MUTED }}>
            scoutd · repo-watch
          </span>
          <span className="font-mono text-[8px] text-studio-ink-faint">open thread →</span>
        </button>
      </div>

      {/* gauge sits under the headline, hairline-separated */}
      <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${INK.edgeSoft}` }}>
        <ContextGauge pct={0} />
      </div>
    </div>
  );
}

/* ── recent-work ledger — fills the would-be void with live history ───────── */

function RecentWork() {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <Eyebrow>Recent work</Eyebrow>
        <span className="font-mono text-[8.5px] text-studio-ink-faint">last 3h</span>
      </div>
      <div className="flex flex-col">
        {RECENT.map((r, i) => (
          <button
            key={r.title}
            type="button"
            className="group flex items-center gap-3 rounded-[4px] px-2 py-2 text-left transition-colors hover:bg-[oklch(0.165_0.008_80)]"
            style={{ borderTop: i ? `1px solid ${INK.edgeSoft}` : undefined }}
          >
            <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: INK.edge }} />
            <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: INK_MUTED }}>
              {r.title}
            </span>
            <span className="flex-none rounded-[3px] px-1.5 py-[1px] font-mono text-[7.5px] font-semibold uppercase tracking-[0.1em] text-studio-ink-faint" style={{ border: `1px solid ${INK.edge}` }}>
              done
            </span>
            <span className="flex-none font-mono text-[9px] tabular-nums text-studio-ink-faint">{r.ago}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── identity strip + quiet facts band (demoted) ──────────────────────────── */

function IdentityStrip() {
  return (
    <div className="flex items-center gap-3">
      <Avatar size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Eyebrow>agent · claude</Eyebrow>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-display text-[19px] leading-none" style={{ color: INK_TXT }}>
            Openscout Card 0
          </span>
          <span className="font-mono text-[10px]" style={{ color: "oklch(0.7 0.08 200)" }}>
            @openscout-card-0-lxrq1a
          </span>
        </div>
      </div>
      {/* repo / branch lives in the header — it's identity, not live signal */}
      <div className="hidden flex-none flex-col items-end gap-0.5 sm:flex">
        <Eyebrow>Repo · branch</Eyebrow>
        <span className="font-mono text-[10px]" style={{ color: INK_MUTED }}>openscout</span>
        <span className="font-mono text-[8.5px] text-studio-ink-faint">codex/sign-scoutd-repo-watch</span>
      </div>
    </div>
  );
}

function FactsBand() {
  return (
    <div>
      <div className="mb-2.5">
        <Eyebrow>Identity</Eyebrow>
      </div>
      <div
        className="grid gap-x-6 gap-y-3.5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}
      >
        {FACTS.map((f) => (
          <div key={f.k} className="min-w-0" style={{ gridColumn: f.wide ? "span 2" : undefined }}>
            <div className="font-mono text-[7.5px] font-semibold uppercase tracking-[0.14em] text-studio-ink-faint">
              {f.k}
            </div>
            <div className="mt-1 truncate font-mono text-[10.5px]" style={{ color: INK_MUTED }}>
              {f.v}
            </div>
            {f.sub ? (
              <div className="mt-0.5 truncate font-mono text-[8.5px] text-studio-ink-faint">{f.sub}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── CENTER ───────────────────────────────────────────────────────────────── */

function Center() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-5" style={{ background: INK.canvas }}>
      <IdentityStrip />
      <LiveBand />
      <RecentWork />
      <div className="pt-1" style={{ borderTop: `1px solid ${INK.edgeSoft}` }} />
      <FactsBand />
    </div>
  );
}

/* ── RAIL: complementary Instrument (presence · caps · sessions) ──────────── */

function RailSection({ label, count, children }: { label: string; count?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.18em] text-studio-ink-faint">{label}</span>
        {count != null ? <span className="font-mono text-[8.5px] tabular-nums text-studio-ink-faint">{count}</span> : null}
      </div>
      {children}
    </div>
  );
}

/* Presence mesh — this agent at center, peers on a ring. Live peers get the
   accent; the rail OWNS presence (the center never shows it). */
function PresenceMesh() {
  const R = 32;
  const cx = 100;
  const cy = 50;
  return (
    <svg viewBox="0 0 200 100" className="w-full" aria-hidden>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={INK.edge} strokeDasharray="2 4" />
      {PEERS.map((p, i) => {
        const a = (2 * Math.PI * i) / PEERS.length - Math.PI / 2;
        const x = cx + R * Math.cos(a);
        const y = cy + R * Math.sin(a);
        return (
          <g key={p.name}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke={p.live ? ACCENT : INK.edge} strokeWidth="0.8" opacity={p.live ? 0.6 : 0.4} />
            <circle cx={x} cy={y} r="3.5" fill={p.live ? ACCENT : INK.edgeSoft} />
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="5.5" fill={INK.module} stroke={ACCENT} strokeWidth="1.3" />
    </svg>
  );
}

function PeerRow({ name, state, live }: { name: string; state: string; live: boolean }) {
  return (
    <div className="flex items-center gap-2 py-[3px]">
      <Dot live={live} />
      <span className="flex-1 truncate font-mono text-[10px]" style={{ color: live ? INK_TXT : INK_MUTED }}>{name}</span>
      <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-studio-ink-faint">{state}</span>
    </div>
  );
}

function Caps() {
  return (
    <div className="flex flex-wrap gap-1">
      {CAPS.map((c) => (
        <span key={c} className="rounded-[3px] px-1.5 py-[2px] font-mono text-[8px]" style={{ background: INK.module, color: INK_MUTED }}>
          {c}
        </span>
      ))}
    </div>
  );
}

function SessionCard() {
  return (
    <div className="rounded-[5px] px-2 py-1.5" style={{ border: `1px solid ${INK.edgeSoft}`, background: INK.rail }}>
      <div className="flex items-center gap-1.5">
        <Dot live />
        <span className="font-mono text-[9.5px]" style={{ color: INK_TXT }}>a1b2c3d4</span>
        <span className="rounded-sm px-1 font-mono text-[7px] uppercase tracking-[0.08em] text-studio-ink-faint" style={{ background: INK.module }}>tmux</span>
        <span className="ml-auto font-mono text-[7.5px] uppercase tracking-[0.12em]" style={{ color: ACCENT }}>active</span>
      </div>
      <div className="mt-1 font-mono text-[8px] text-studio-ink-faint">openscout</div>
    </div>
  );
}

function Rail() {
  return (
    <div className="flex w-[228px] flex-none flex-col" style={{ background: INK.panel, borderLeft: `1px solid ${INK.edge}` }}>
      <div className="flex h-[30px] flex-none items-center px-3" style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}>
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">Instrument</span>
      </div>
      <div className="flex flex-col gap-4 overflow-y-auto p-3.5">
        <RailSection label="Presence" count="4 peers">
          <PresenceMesh />
          <div className="mt-1.5 flex flex-col">
            {PEERS.map((p) => (
              <PeerRow key={p.name} {...p} />
            ))}
          </div>
        </RailSection>

        <div style={{ borderTop: `1px solid ${INK.edgeSoft}` }} />

        <RailSection label="Capabilities" count={`${CAPS.length}`}>
          <Caps />
        </RailSection>

        <div style={{ borderTop: `1px solid ${INK.edgeSoft}` }} />

        <RailSection label="Running sessions" count="1 active">
          <SessionCard />
        </RailSection>
      </div>
    </div>
  );
}

/* ── window frame ─────────────────────────────────────────────────────────── */

export function Frame() {
  return (
    <div className="overflow-hidden rounded-lg" style={{ border: `1px solid ${INK.edge}`, background: INK.canvas }}>
      {/* title bar */}
      <div className="flex h-[30px] items-center gap-3 px-3" style={{ borderBottom: `1px solid ${INK.edgeSoft}`, background: INK.rail }}>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-2 w-2 rounded-full" style={{ background: INK.edge }} />
          ))}
        </div>
        <span className="font-mono text-[9px] text-studio-ink-faint">Scout · Agents › Openscout Card 0</span>
      </div>
      <div className="flex" style={{ height: 560 }}>
        <Center />
        <Rail />
      </div>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function AgentProfileCockpitPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · agent-profile-cockpit
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent Profile · Cockpit
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Lead with what the agent is doing, not who it is. A live status band — state, the
          context-load gauge, last-activity pulse, the conversation it sits in — is the hero;
          identity drops to a compact header strip and one quiet facts band. The would-be dead
          canvas fills with the recent-work ledger, and the rail narrows to a pure Instrument.
        </p>
      </header>

      <Frame />

      <section className="mt-9 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">
          Design notes
        </div>
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-studio-ink-faint">
          <li>
            <span style={{ color: INK_TXT }}>Live-first hierarchy →</span> the brightest element is the
            status band (state · context gauge · last-activity · conversation), not the name. Identity is
            an eyebrow strip + a muted facts band below the fold of attention. The operator reads
            “what’s happening” before “who this is”.
          </li>
          <li>
            <span style={{ color: INK_TXT }}>Kills the void →</span> a Ready agent gets a confident
            resting state (“idle, ready · last shipped 12m ago”) plus the recent-work ledger, so the
            center is full of real history instead of empty canvas. The context gauge designs its
            empty case as an origin lead-cap labelled “full headroom”, not a broken-looking 0.
          </li>
          <li>
            <span style={{ color: INK_TXT }}>Kills the redundancy →</span> the center owns live state +
            identity; the rail owns the Instrument it alone can show — presence mesh + peer ring,
            capabilities, running sessions. No fact appears in both panels.
          </li>
          <li>
            <span style={{ color: INK_TXT }}>Instrument language →</span> near-black canvas, mono
            telemetry, a single emerald accent rationed to live signal (state dot, gauge fill, live
            peers, active session), thin 1px borders, status as dot + label. No second hue, no emoji.
          </li>
        </ul>
      </section>
    </main>
  );
}
