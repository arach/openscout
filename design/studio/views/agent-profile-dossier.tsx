"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Scout · Agent Profile — the Dossier direction

   Lens: the profile is a calm, composed document — a well-set dossier. Strong
   typographic hierarchy (identity masthead → definition lists → thin section
   rules), no boxed-cell grid, no dead canvas. Whitespace reads as deliberate
   page rhythm rather than emptiness.

   Clean panel split:
     CENTER  → identity masthead + the full static record (definition lists,
               recent work trace). Owns every fact.
     RAIL    → a live Instrument only (presence mesh · context gauge ·
               capabilities · running sessions). Repeats none of the facts.

   Source of truth for the data + Instrument language:
     packages/web/client/screens/AgentsScreen.tsx
     packages/web/client/scout/inspector/AgentsInspector.tsx
     design/studio/app/studies/scout-inspectors/page.tsx  (structure vocab)
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

/* ── data ─────────────────────────────────────────────────────────────────── */

type Field = { k: string; v: string; sub?: string; mono?: boolean };

const IDENTITY: Field[] = [
  { k: "Agent ID", v: "openscout-card-0.lxrq1a", sub: "definition openscout-card-0", mono: true },
  { k: "Selector", v: "@openscout-card-0-lxrq1a", mono: true },
  { k: "Class", v: "relay_agent", mono: true },
  { k: "Transport", v: "tmux", mono: true },
  { k: "Authority", v: "art-mac", sub: "qualified route" },
  { k: "Machine", v: "art-mac" },
];

const PROJECT: Field[] = [
  { k: "Workspace", v: "openscout", sub: "8 teammates" },
  { k: "Repo", v: "openscout", sub: "branch · codex/sign-scoutd-repo-watch", mono: true },
  { k: "Working dir", v: "~/dev/openscout", sub: "uptime 2m", mono: true },
];

type Work = { title: string; ago: string };
const RECENT: Work[] = [
  { title: "Wire scoutd repo-watch signing", ago: "12m" },
  { title: "Fix HUD tail backlog state", ago: "1h" },
  { title: "Inject CLI version into docs view", ago: "3h" },
];

type Peer = { name: string; state: "working" | "ready" | "idle" };
const PEERS: Peer[] = [
  { name: "Atlas", state: "working" },
  { name: "Juno", state: "ready" },
  { name: "Hudson", state: "ready" },
  { name: "Relay", state: "idle" },
];

const CAPS = ["read", "edit", "shell", "ask", "spawn"];

/* ── shared atoms ─────────────────────────────────────────────────────────── */

function Avatar({ size }: { size: number }) {
  return (
    <div
      className="flex flex-none items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: "oklch(0.62 0.17 38)",
        color: INK.canvas,
        boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.16)",
      }}
    >
      O
    </div>
  );
}

function Dot({ color = ACCENT, size = 6 }: { color?: string; size?: number }) {
  return <span className="inline-block flex-none rounded-full" style={{ width: size, height: size, background: color }} />;
}

/* Faint mono eyebrow + a thin hairline that runs to the column edge. */
function SectionRule({ label, meta }: { label: string; meta?: React.ReactNode }) {
  return (
    <div className="mb-3.5 flex items-baseline gap-3">
      <span className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.2em] text-studio-ink-faint">{label}</span>
      <span className="h-px flex-1" style={{ background: INK.edgeSoft }} />
      {meta != null ? <span className="font-mono text-[8.5px] tabular-nums text-studio-ink-faint">{meta}</span> : null}
    </div>
  );
}

/* The dossier's core: a definition list — label column, value column, aligned.
   No cells, no borders between rows. Hierarchy is pure type + a baseline grid. */
function DefList({ fields }: { fields: Field[] }) {
  return (
    <dl
      className="grid items-baseline gap-x-6 gap-y-3"
      style={{ gridTemplateColumns: "minmax(86px, max-content) 1fr" }}
    >
      {fields.map((f) => (
        <React.Fragment key={f.k}>
          <dt className="pt-px font-mono text-[8.5px] uppercase tracking-[0.14em] text-studio-ink-faint">{f.k}</dt>
          <dd className="min-w-0">
            <span className={`block truncate ${f.mono ? "font-mono text-[12px]" : "text-[13px]"}`} style={{ color: "var(--studio-ink)" }}>
              {f.v}
            </span>
            {f.sub ? <span className="mt-0.5 block truncate font-mono text-[9px] text-studio-ink-faint">{f.sub}</span> : null}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/* ── center · the composed page ───────────────────────────────────────────── */

function Masthead() {
  return (
    <header>
      <div className="flex items-start gap-4">
        <Avatar size={52} />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-studio-ink-faint">
            agent <span className="px-1 text-studio-ink-faint">·</span> harness claude
          </div>
          <h2 className="mt-1.5 font-display text-[30px] font-medium leading-none tracking-tight" style={{ color: "var(--studio-ink)" }}>
            Openscout Card 0
          </h2>
          <div className="mt-2 flex items-center gap-2.5">
            <span className="font-mono text-[11px]" style={{ color: "oklch(0.7 0.08 200)" }}>@openscout-card-0-lxrq1a</span>
            <span className="font-mono text-[9px] text-studio-ink-faint">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Dot />
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--studio-ink)" }}>Ready</span>
              <span className="font-mono text-[8.5px] text-studio-ink-faint">updated 2m ago</span>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

/* Quiet activity trace — fills the calm/empty case honestly: a Ready agent has
   no active task, so the page closes with what it last shipped, not a void. */
function RecentWork() {
  return (
    <ol className="flex flex-col">
      {RECENT.map((w, i) => (
        <li key={w.title} className="flex items-stretch gap-3">
          <div className="flex flex-none flex-col items-center" style={{ width: 6 }}>
            <span className="mt-[6px]"><Dot color={INK.edge} size={5} /></span>
            {i < RECENT.length - 1 ? <span className="w-px flex-1" style={{ background: INK.edgeSoft }} /> : null}
          </div>
          <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3 pb-3.5">
            <span className="truncate text-[12.5px]" style={{ color: "var(--studio-ink-muted, oklch(0.76 0.012 80))" }}>{w.title}</span>
            <span className="flex flex-none items-center gap-2">
              <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-studio-ink-faint">done</span>
              <span className="font-mono text-[9px] tabular-nums text-studio-ink-faint">{w.ago}</span>
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function CenterPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col" style={{ background: INK.canvas, padding: 26 }}>
      <Masthead />

      <div className="mt-7">
        <SectionRule label="Identity" />
        <DefList fields={IDENTITY} />
      </div>

      <div className="mt-8">
        <SectionRule label="Project" />
        <DefList fields={PROJECT} />
      </div>

      <div className="mt-8">
        <SectionRule label="Recent work" meta="3 shipped" />
        <RecentWork />
      </div>

      {/* quiet closing status line — the page resolves rather than trailing off */}
      <div className="mt-auto pt-6">
        <div className="flex items-center gap-2 font-mono text-[9px] text-studio-ink-faint">
          <Dot size={5} />
          <span className="uppercase tracking-[0.14em]">Ready</span>
          <span>· no active task · last activity now</span>
        </div>
      </div>
    </div>
  );
}

/* ── rail · the live Instrument (no facts repeated) ───────────────────────── */

function RailSection({ label, meta, children }: { label: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.18em] text-studio-ink-faint">{label}</span>
        {meta != null ? <span className="font-mono text-[8.5px] tabular-nums text-studio-ink-faint">{meta}</span> : null}
      </div>
      {children}
    </div>
  );
}

function PresenceMesh() {
  // self at center; 4 peers on a ring. Live signal (working) lit with accent.
  const cx = 100;
  const cy = 50;
  const r = 32;
  return (
    <svg viewBox="0 0 200 104" className="w-full" aria-hidden>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={INK.edge} strokeDasharray="2 4" />
      {PEERS.map((p, i) => {
        const a = (2 * Math.PI * i) / PEERS.length - Math.PI / 2;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        const live = p.state === "working";
        const color = live ? ACCENT : p.state === "ready" ? "oklch(0.55 0.02 200)" : INK.edge;
        return (
          <g key={p.name}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke={live ? ACCENT : INK.edgeSoft} strokeWidth={live ? 1 : 0.7} opacity={live ? 0.6 : 0.4} />
            <circle cx={x} cy={y} r="3.6" fill={color} />
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="6" fill="oklch(0.62 0.17 38)" stroke={ACCENT} strokeWidth="1.2" />
    </svg>
  );
}

function PeerList() {
  return (
    <div className="mt-2.5 flex flex-col gap-[3px]">
      {PEERS.map((p) => {
        const live = p.state === "working";
        const color = live ? ACCENT : p.state === "ready" ? "oklch(0.55 0.02 200)" : INK.edge;
        return (
          <div key={p.name} className="flex items-center gap-2 py-[1px]">
            <Dot color={color} size={5} />
            <span className="font-mono text-[10px]" style={{ color: live ? "var(--studio-ink)" : "var(--studio-ink-muted, oklch(0.76 0.012 80))" }}>{p.name}</span>
            <span className="ml-auto font-mono text-[8px] uppercase tracking-[0.1em] text-studio-ink-faint">{p.state}</span>
          </div>
        );
      })}
    </div>
  );
}

function ContextGauge() {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[16px] leading-none tabular-nums" style={{ color: "var(--studio-ink)" }}>0%</span>
        <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-studio-ink-faint">used</span>
      </div>
      <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full" style={{ background: INK.edgeSoft }}>
        <div className="h-full rounded-full" style={{ width: "1%", background: ACCENT }} />
      </div>
      <div className="mt-1.5 font-mono text-[8.5px] text-studio-ink-faint">0 turns · last activity now</div>
    </div>
  );
}

function Caps() {
  return (
    <div className="flex flex-wrap gap-1">
      {CAPS.map((c) => (
        <span key={c} className="rounded-[3px] px-1.5 py-[2px] font-mono text-[8.5px]" style={{ background: INK.module, color: "var(--studio-ink-muted, oklch(0.76 0.012 80))" }}>
          {c}
        </span>
      ))}
    </div>
  );
}

function SessionRow() {
  return (
    <div className="flex items-center gap-2 rounded-[4px] px-2 py-1.5" style={{ border: `1px solid color-mix(in srgb, var(--scout-accent) 35%, transparent)`, background: "color-mix(in srgb, var(--scout-accent) 7%, transparent)" }}>
      <Dot />
      <span className="font-mono text-[10px]" style={{ color: "var(--studio-ink)" }}>a1b2c3d4</span>
      <span className="rounded-sm px-1 font-mono text-[7px] uppercase tracking-[0.08em] text-studio-ink-faint" style={{ background: INK.module }}>tmux</span>
      <span className="ml-auto font-mono text-[7.5px] uppercase tracking-[0.12em]" style={{ color: ACCENT }}>active</span>
    </div>
  );
}

function Rail() {
  return (
    <div className="flex w-[228px] flex-none flex-col" style={{ background: INK.panel, borderLeft: `1px solid ${INK.edge}` }}>
      <div className="flex h-[30px] flex-none items-center gap-2 px-3" style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}>
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">Instrument</span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <Dot size={5} />
          <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-studio-ink-faint">live</span>
        </span>
      </div>
      <div className="flex flex-col gap-5 p-3.5">
        <RailSection label="Presence" meta="4 peers">
          <PresenceMesh />
          <PeerList />
        </RailSection>

        <RailSection label="Context">
          <ContextGauge />
        </RailSection>

        <RailSection label="Capabilities" meta="5">
          <Caps />
        </RailSection>

        <RailSection label="Running sessions" meta="1 active">
          <SessionRow />
        </RailSection>
      </div>
    </div>
  );
}

/* ── window frame ─────────────────────────────────────────────────────────── */

export function Frame() {
  return (
    <div className="overflow-hidden rounded-xl" style={{ border: `1px solid ${INK.edge}`, background: INK.canvas }}>
      {/* faux titlebar */}
      <div className="flex h-[32px] items-center gap-2 px-3.5" style={{ borderBottom: `1px solid ${INK.edgeSoft}`, background: INK.rail }}>
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: INK.edge }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: INK.edge }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: INK.edge }} />
        </span>
        <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.14em] text-studio-ink-faint">Agents · Openscout Card 0</span>
      </div>
      <div className="flex" style={{ minHeight: 540 }}>
        <CenterPage />
        <Rail />
      </div>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function AgentProfileDossierPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · agent-profile-dossier
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent Profile · the Dossier
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The profile reset as a composed editorial page. An identity masthead, the full static
          record laid out as aligned definition lists under thin section rules — no boxed-cell
          grid, no dead canvas. The right rail narrows to a pure live Instrument and stops
          re-printing the center&apos;s facts.
        </p>
      </header>

      <Frame />

      <section className="mt-9 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">
          Design notes
        </div>
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-studio-ink-faint">
          <li>
            <span style={{ color: "var(--studio-ink)" }}>Definition lists, not cells →</span> facts are a
            two-column <code className="font-mono text-[11px]">label → value</code> grid aligned on a shared
            baseline, grouped under <span style={{ color: "var(--studio-ink)" }}>Identity</span> and{" "}
            <span style={{ color: "var(--studio-ink)" }}>Project</span> by thin section rules. No boxes to
            balloon, no two cells stretching to fill a row — hierarchy is type weight + alignment.
          </li>
          <li>
            <span style={{ color: "var(--studio-ink)" }}>The void is filled honestly →</span> a Ready agent
            has no active task, so the page closes with a <span style={{ color: "var(--studio-ink)" }}>Recent
            work</span> trace (last 3 shipped) and a quiet status line pinned to the bottom. Whitespace
            reads as page rhythm; the canvas resolves instead of trailing into emptiness.
          </li>
          <li>
            <span style={{ color: "var(--studio-ink)" }}>Clean panel split →</span> the center owns every
            static fact; the rail is a pure <span style={{ color: "var(--studio-ink)" }}>Instrument</span> —
            presence mesh + peer list, context gauge, capabilities, the one running session. It carries
            only live signal, so nothing is duplicated across the divide.
          </li>
          <li>
            <span style={{ color: "var(--studio-ink)" }}>Instrument constraints held →</span> mono-first
            labels with a display face only on the name; one emerald accent, used solely for live signal
            (status dot, active peer/session, context fill); status is a dot + label, never a colored block;
            1px hairlines, no shadows.
          </li>
        </ul>
      </section>
    </main>
  );
}
