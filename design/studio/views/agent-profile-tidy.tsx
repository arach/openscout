"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Scout · Agent Profile — tidy pass  (before / after)

   Two changes to the live Agents → profile surface, shown in context:

   1. Center metadata facets: stretchy `flex: 1 1 220px` (two cells balloon to
      fill the row) → uniform `grid auto-fill minmax(220px, 1fr)`. The long
      Agent-ID cell spans two columns. Bottom padding trimmed 7xl → 6xl.

   2. Cross-panel redundancy: the right rail was re-printing what the center
      already owns (State · Identity · Project). On the profile tab it now drops
      those blocks, folds a live state line into its header, and reads as a pure
      Instrument (presence · capabilities · sessions).

   Source of truth:
     packages/web/client/screens/AgentsScreen.tsx        (center facets)
     packages/web/client/screens/agents-screen.css       (.s-profile-facets)
     packages/web/client/scout/inspector/AgentsInspector.tsx (rail)
   ─────────────────────────────────────────────────────────────────────────── */

import React from "react";

const INK = {
  canvas: "oklch(0.118 0.008 80)",
  panel: "oklch(0.145 0.008 80)",
  rail: "oklch(0.105 0.006 80)",
  module: "oklch(0.165 0.008 80)",
  edge: "oklch(0.27 0.008 80)",
  edgeSoft: "oklch(0.205 0.008 80)",
};
const ACCENT = "var(--scout-accent)";
const DEL = "var(--status-error-fg)";

type Facet = { label: string; value: string; detail?: string; mono?: boolean; wide?: boolean };

const FACETS: Facet[] = [
  { label: "Agent ID", value: "openscout-card-0.lxrq1a", detail: "definition openscout-card-0", mono: true, wide: true },
  { label: "Selector", value: "@openscout-card-0-lxrq1a", mono: true },
  { label: "Authority", value: "art-mac", detail: "qualified route" },
  { label: "Machine", value: "art-mac" },
  { label: "Workspace", value: "openscout", detail: "8 teammates" },
  { label: "Repo / Branch", value: "openscout", detail: "⎇ codex/sign-scoutd-repo-watch" },
  { label: "Working Dir", value: "~/dev/openscout", detail: "uptime 2m" },
  { label: "Session", value: "a1b2c3d4", detail: "3 sessions · started 5m", mono: true },
  { label: "Context", value: "0% used", detail: "0 turns · last activity now" },
];

/* ── center pane ──────────────────────────────────────────────────────────── */

function Avatar({ size = 34 }: { size?: number }) {
  return (
    <div
      className="flex flex-none items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: "oklch(0.62 0.17 38)",
        color: INK.canvas,
        boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.16)",
      }}
    >
      O
    </div>
  );
}

function StatePill({ inline }: { inline?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />
      <span
        className={inline ? "text-[10px] text-studio-ink-muted" : "font-mono text-[9px] uppercase tracking-[0.16em]"}
        style={inline ? undefined : { color: "var(--studio-ink)" }}
      >
        Ready
      </span>
      <span className="font-mono text-[8.5px] text-studio-ink-faint">· 2m</span>
    </span>
  );
}

function FacetCell({ facet, wide }: { facet: Facet; wide?: boolean }) {
  return (
    <div
      className="min-w-0 px-3 py-2.5"
      style={{ background: INK.canvas, gridColumn: wide ? "span 2" : undefined }}
    >
      <div className="mb-1 font-mono text-[7.5px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">
        {facet.label}
      </div>
      <div
        className={`truncate ${facet.mono ? "font-mono text-[10px]" : "text-[12px]"}`}
        style={{ color: "var(--studio-ink)" }}
      >
        {facet.value}
      </div>
      {facet.detail ? (
        <div className="mt-0.5 truncate font-mono text-[8.5px] text-studio-ink-faint">{facet.detail}</div>
      ) : null}
    </div>
  );
}

function CenterPane({ mode }: { mode: "before" | "after" }) {
  const after = mode === "after";
  return (
    <div
      className="flex min-w-0 flex-1 flex-col"
      style={{ background: INK.canvas, padding: 18, paddingBottom: after ? 18 : 34 }}
    >
      {/* identity header */}
      <div className="flex items-start gap-3">
        <Avatar size={48} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-studio-ink-faint">agent · claude</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-[22px] leading-none" style={{ color: "var(--studio-ink)" }}>
              Openscout Card 0
            </span>
            <span className="font-mono text-[11px] text-studio-ink-faint">@openscout-card-0-lxrq1a</span>
          </div>
          <div className="mt-2">
            <StatePill />
          </div>
        </div>
      </div>

      {/* facets */}
      <div className="mt-4">
        <div
          className="overflow-hidden rounded-md"
          style={
            after
              ? {
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                  gap: 1,
                  border: `1px solid ${INK.edge}`,
                  background: INK.edge,
                }
              : {
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 1,
                  border: `1px solid ${INK.edge}`,
                  background: INK.edge,
                }
          }
        >
          {FACETS.map((f) => (
            <div
              key={f.label}
              className="min-w-0"
              style={
                after
                  ? { gridColumn: f.wide ? "span 2" : undefined }
                  : { flex: "1 1 220px", minWidth: 0 }
              }
            >
              <FacetCell facet={f} wide={false} />
            </div>
          ))}
        </div>
        {!after ? (
          <div className="mt-3 flex h-16 items-center justify-center rounded-md border border-dashed" style={{ borderColor: INK.edgeSoft }}>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-studio-ink-faint">cells balloon · 7xl bottom padding opens dead canvas</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── rail ─────────────────────────────────────────────────────────────────── */

function RailSection({
  label,
  echo,
  children,
}: {
  label: string;
  echo?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.18em] text-studio-ink-faint">{label}</span>
        {echo ? (
          <span
            className="rounded-[3px] px-1 py-[1px] font-mono text-[7px] uppercase tracking-[0.1em]"
            style={{ color: DEL, border: `1px solid color-mix(in srgb, ${DEL} 40%, transparent)` }}
          >
            echoes center
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function RailRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-studio-ink-faint">{k}</span>
      <span className="truncate font-mono text-[9.5px]" style={{ color: "var(--studio-ink-muted, oklch(0.7 0.01 80))" }}>{v}</span>
    </div>
  );
}

function MiniMesh() {
  return (
    <svg viewBox="0 0 200 96" className="w-full" aria-hidden>
      <circle cx="100" cy="48" r="30" fill="none" stroke={INK.edge} strokeDasharray="2 4" />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (2 * Math.PI * i) / 5 - Math.PI / 2;
        const x = 100 + 30 * Math.cos(a);
        const y = 48 + 30 * Math.sin(a);
        return (
          <g key={i}>
            <line x1="100" y1="48" x2={x} y2={y} stroke={ACCENT} strokeWidth="0.8" opacity="0.5" />
            <circle cx={x} cy={y} r="4" fill="oklch(0.55 0.12 200)" />
          </g>
        );
      })}
      <circle cx="100" cy="48" r="6" fill="oklch(0.62 0.17 38)" stroke={ACCENT} strokeWidth="1.2" />
    </svg>
  );
}

function Caps() {
  return (
    <div className="flex flex-wrap gap-1">
      {["read", "edit", "shell", "ask", "spawn"].map((c) => (
        <span key={c} className="rounded-[3px] px-1.5 py-[2px] font-mono text-[8px]" style={{ background: INK.module, color: "var(--studio-ink-muted, oklch(0.7 0.01 80))" }}>
          {c}
        </span>
      ))}
    </div>
  );
}

function SessionCard() {
  return (
    <div className="rounded border px-2 py-1.5" style={{ borderColor: "color-mix(in srgb, var(--scout-accent) 40%, transparent)", background: "color-mix(in srgb, var(--scout-accent) 8%, transparent)" }}>
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />
        <span className="font-mono text-[9.5px]" style={{ color: "var(--studio-ink)" }}>a1b2c3d4</span>
        <span className="rounded-sm px-1 font-mono text-[7px] uppercase tracking-[0.08em] text-studio-ink-faint" style={{ background: INK.module }}>tmux</span>
        <span className="ml-auto font-mono text-[7.5px] uppercase tracking-[0.12em]" style={{ color: ACCENT }}>active</span>
      </div>
      <div className="mt-0.5 font-mono text-[8px] text-studio-ink-faint">openscout</div>
    </div>
  );
}

function Rail({ mode }: { mode: "before" | "after" }) {
  const after = mode === "after";
  return (
    <div className="flex w-[228px] flex-none flex-col" style={{ background: INK.panel, borderLeft: `1px solid ${INK.edge}` }}>
      <div className="flex h-[30px] flex-none items-center px-3" style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}>
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">Context</span>
      </div>
      <div className="flex flex-col gap-3.5 p-3">
        {/* identity header */}
        <div className="flex items-center gap-2 pb-2.5" style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}>
          <Avatar size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px]" style={{ color: "var(--studio-ink)" }}>Openscout Card 0</div>
            <div className="font-mono text-[8.5px]" style={{ color: "oklch(0.7 0.08 200)" }}>@openscout-card-0-lxrq1a</div>
            {after ? <div className="mt-1"><StatePill inline /></div> : null}
          </div>
        </div>

        {after ? null : (
          <RailSection label="State" echo>
            <div className="flex items-baseline gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />
              <span className="text-[11px] capitalize" style={{ color: "var(--studio-ink)" }}>ready</span>
            </div>
            <div className="mt-1 font-mono text-[8.5px] text-studio-ink-faint">Updated 2m</div>
          </RailSection>
        )}

        <RailSection label="Presence">
          <MiniMesh />
        </RailSection>

        {after ? null : (
          <RailSection label="Identity" echo>
            <RailRow k="Class" v="relay_agent" />
            <RailRow k="Role" v="agent" />
            <RailRow k="Harness" v="claude" />
            <RailRow k="Transport" v="tmux" />
            <RailRow k="Host" v="art-mac" />
          </RailSection>
        )}

        {after ? null : (
          <RailSection label="Project" echo>
            <RailRow k="Name" v="openscout" />
            <RailRow k="Branch" v="codex/sign-scoutd…" />
            <RailRow k="Cwd" v="~/dev/openscout" />
          </RailSection>
        )}

        <RailSection label="Capabilities · 5">
          <Caps />
        </RailSection>

        <RailSection label="Running sessions · 1">
          <SessionCard />
        </RailSection>

        {after ? (
          <div className="mt-1 rounded-[4px] px-2 py-1.5" style={{ border: `1px dashed ${INK.edgeSoft}` }}>
            <span className="font-mono text-[7.5px] leading-relaxed text-studio-ink-faint">
              state · identity · project now owned by the center profile
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── frame ────────────────────────────────────────────────────────────────── */

function Frame({
  mode,
  label,
  caption,
  screenshot,
}: {
  mode: "before" | "after";
  label: string;
  caption: string;
  /** When set, render a real screen capture instead of the rendered mock. */
  screenshot?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className="rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em]"
          style={
            mode === "after"
              ? { color: INK.canvas, background: ACCENT }
              : { color: "var(--studio-ink-muted, oklch(0.7 0.01 80))", border: `1px solid ${INK.edge}` }
          }
        >
          {label}
        </span>
        <span className="font-mono text-[9px] text-studio-ink-faint">{caption}</span>
      </div>
      {screenshot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={screenshot}
          alt="Live Agents → profile capture, before the tidy pass"
          className="block w-full rounded-lg"
          style={{ border: `1px solid ${INK.edge}` }}
        />
      ) : (
        <div className="flex overflow-hidden rounded-lg" style={{ border: `1px solid ${INK.edge}`, minHeight: 460 }}>
          <CenterPane mode={mode} />
          <Rail mode={mode} />
        </div>
      )}
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function AgentProfileTidyPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · agent-profile-tidy
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent Profile · tidy pass
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Two cleanups to the live Agents → profile surface. The center metadata grid stops
          ballooning into 2 stretched cells, and the right rail stops re-printing the same
          facts the center already owns — it narrows to a live Instrument. Before / after below.
        </p>
      </header>

      <div className="grid grid-cols-1 items-start gap-7 xl:grid-cols-2">
        <Frame
          mode="before"
          label="Before"
          caption="live capture · stretched facets, dead canvas, rail repeats State · Identity · Project"
          screenshot="/studies/agent-profile-before.png"
        />
        <Frame mode="after" label="After" caption="grid auto-fill minmax(220px,1fr) · rail = instrument (rendered target)" />
      </div>

      <section className="mt-9 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">
          What changed
        </div>
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-studio-ink-faint">
          <li>
            <span style={{ color: "var(--studio-ink)" }}>Center facets →</span> stretchy flex-wrap
            (<code className="font-mono text-[11px]">flex: 1 1 220px</code>) replaced with a uniform
            <code className="font-mono text-[11px]"> grid</code>
            (<code className="font-mono text-[11px]">auto-fill, minmax(220px, 1fr)</code>); the long
            Agent-ID cell spans two columns. Bottom padding trimmed <code className="font-mono text-[11px]">7xl → 6xl</code>.
          </li>
          <li>
            <span style={{ color: "var(--studio-ink)" }}>Rail redundancy →</span> on the profile tab the
            rail drops <span style={{ color: DEL }}>State · Identity · Project</span>, folds a live state
            line into its header, and keeps only presence · capabilities · sessions. Guarded so the
            Observe/Message tabs and the standalone <code className="font-mono text-[11px]">agent-info</code> rail
            keep the full blocks.
          </li>
          <li>
            <span style={{ color: "var(--studio-ink)" }}>Trade-off →</span> hiding the rail&apos;s Identity
            block also removes <code className="font-mono text-[11px]">Class</code> +
            <code className="font-mono text-[11px]"> Transport</code> from the profile view (the center
            facets don&apos;t carry those two). Everything else was pure duplication.
          </li>
        </ul>
      </section>
    </main>
  );
}
