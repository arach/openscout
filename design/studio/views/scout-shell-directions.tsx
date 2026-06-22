"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Scout shell · the inspector sidebar  —  Instrument language, anchored

   Structure vocabulary lifted from the live app's CONTEXT panel: flat sections
   under faint labels, big stat readouts, tag-distribution pills, dot+name list
   rows, plain empty states. No boxes. One green accent (dots / live signal /
   primary action); green-red reserved for diff churn.

   Anchored on the four real surfaces — Agents · Comms · Tail · Repos. Each
   inspector: identity → a specialised lead → flat structured sections → footer.
   The center list is a dimmed placeholder; it's explored separately.
   ─────────────────────────────────────────────────────────────────────────── */

import React from "react";

/* ── Instrument palette ───────────────────────────────────────────────────── */

const INK = {
  canvas: "oklch(0.118 0.008 80)",
  panel: "oklch(0.145 0.008 80)",
  rail: "oklch(0.105 0.006 80)",
  module: "oklch(0.165 0.008 80)",
  edge: "oklch(0.27 0.008 80)",
  edgeSoft: "oklch(0.205 0.008 80)",
};
const ACCENT = "var(--scout-accent)";
const ADD = "var(--status-ok-fg)";
const DEL = "var(--status-error-fg)";

/* ── shell ────────────────────────────────────────────────────────────────── */

function Rail({ children, flush }: { children: React.ReactNode; flush?: boolean }) {
  return (
    <div
      className="flex h-[600px] w-[304px] flex-none flex-col overflow-hidden"
      style={{ background: INK.panel, border: `1px solid ${INK.edge}`, borderRadius: flush ? 0 : 10 }}
    >
      {children}
    </div>
  );
}

function RailHeader({ label, status }: { label: string; status?: string }) {
  return (
    <div className="flex h-[34px] flex-none items-center justify-between px-3.5" style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}>
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-[2px] rounded-full" style={{ background: ACCENT }} />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-studio-ink-muted">{label}</span>
      </div>
      {status ? (
        <span className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-studio-ink-faint">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: INK.edge }} />
          {status}
        </span>
      ) : null}
    </div>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-hidden px-3.5 py-3.5">{children}</div>;
}

function Footer({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <div className="flex flex-none items-center gap-1.5 px-3 py-2.5" style={{ borderTop: `1px solid ${INK.edgeSoft}`, background: INK.rail }}>
      <button className="flex-1 rounded-[4px] py-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ background: ACCENT, color: INK.canvas }}>{primary}</button>
      <button className="flex-1 rounded-[4px] py-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-studio-ink-muted" style={{ border: `1px solid ${INK.edge}` }}>{secondary}</button>
    </div>
  );
}

/* ── structure vocabulary (from the live CONTEXT panel) ───────────────────── */

function Section({ label, count, children }: { label: string; count?: React.ReactNode; children: React.ReactNode }) {
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

/* big-number stat readout — AGENTS 25 · PROJECTS 15 · WORKING 0 */
type Stat = { k: string; v: string; accent?: boolean };
function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div className="flex">
      {stats.map((s, i) => (
        <div
          key={s.k}
          className="flex flex-1 flex-col gap-1.5"
          style={{ paddingLeft: i ? 12 : 0, marginLeft: i ? 12 : 0, borderLeft: i ? `1px solid ${INK.edgeSoft}` : undefined }}
        >
          <span className="font-mono text-[7.5px] font-semibold uppercase tracking-[0.12em] text-studio-ink-faint">{s.k}</span>
          <span className="font-mono text-[19px] leading-none tabular-nums" style={{ color: s.accent ? ACCENT : "var(--studio-ink)" }}>{s.v}</span>
        </div>
      ))}
    </div>
  );
}

/* tag-distribution pills — Openscout 8 · claude 16 */
type T = { label: string; count?: string };
function TagMix({ tags }: { tags: T[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span key={t.label} className="inline-flex items-center gap-1.5 rounded-[3px] px-1.5 py-[2.5px] font-mono text-[9px]" style={{ border: `1px solid ${INK.edge}` }}>
          <span className="text-studio-ink-muted">{t.label}</span>
          {t.count != null ? <span className="tabular-nums text-studio-ink-faint">{t.count}</span> : null}
        </span>
      ))}
    </div>
  );
}

/* dot + name + faint right meta — the RECENT list row */
type LRow = { name: string; meta?: React.ReactNode; dot?: string; dim?: boolean };
function RowList({ rows }: { rows: LRow[] }) {
  return (
    <div className="flex flex-col gap-[7px]">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: r.dot ?? INK.edge }} />
          <span className="truncate font-mono text-[11px]" style={{ color: r.dim ? "var(--studio-ink-faint)" : "var(--studio-ink-muted)" }}>{r.name}</span>
          {r.meta != null ? <span className="ml-auto flex-none font-mono text-[9px] tabular-nums text-studio-ink-faint">{r.meta}</span> : null}
        </div>
      ))}
    </div>
  );
}

/* quiet label-left / value-right line — QUIET ROUTING SURFACE … 25 READY */
type KRow = { k: string; v: React.ReactNode; wide?: boolean; color?: string };
function QuietKV({ rows }: { rows: KRow[] }) {
  return (
    <div className="flex flex-col gap-[5px]">
      {rows.map((r) =>
        r.wide ? (
          <div key={r.k} className="flex flex-col gap-[2px]">
            <span className="font-mono text-[7.5px] uppercase tracking-[0.1em] text-studio-ink-faint">{r.k}</span>
            <span className="truncate font-mono text-[10px]" style={{ color: r.color ?? "var(--studio-ink-muted)" }}>{r.v}</span>
          </div>
        ) : (
          <div key={r.k} className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-studio-ink-faint">{r.k}</span>
            <span className="truncate text-right font-mono text-[10px] tabular-nums" style={{ color: r.color ?? "var(--studio-ink-muted)" }}>{r.v}</span>
          </div>
        )
      )}
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[10px] leading-relaxed text-studio-ink-faint">{children}</p>;
}

function Identity({ glyph, name, sub }: { glyph: React.ReactNode; name: string; sub: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[7px] text-studio-ink-muted" style={{ background: INK.module, border: `1px solid ${INK.edgeSoft}` }}>
        {glyph}
      </div>
      <div className="min-w-0">
        <div className="truncate font-mono text-[15px] leading-none text-studio-ink">{name}</div>
        <div className="mt-1.5 truncate font-mono text-[9px] text-studio-ink-faint">{sub}</div>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[3px] px-1.5 py-[1px] font-mono text-[8px] font-semibold uppercase tracking-[0.1em] text-studio-ink-faint" style={{ border: `1px solid ${INK.edge}` }}>
      {children}
    </span>
  );
}

/* ── specialised leads ────────────────────────────────────────────────────── */

function Sparkline() {
  const pts = [6, 9, 7, 12, 10, 16, 13, 19, 16, 23, 20, 27, 24, 30];
  const max = 32, w = 250, h = 22, step = w / (pts.length - 1);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - (p / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block w-full" style={{ height: h }}>
      <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill={ACCENT} opacity="0.09" />
      <path d={d} fill="none" stroke={ACCENT} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ChurnLead({ add, del }: { add: number; del: number }) {
  const total = add + del || 1;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.18em] text-studio-ink-faint">Churn · main</span>
        <span className="font-mono text-[10px] tabular-nums">
          <span style={{ color: ADD }}>+{add}</span> <span style={{ color: DEL }}>−{del}</span>
        </span>
      </div>
      <div className="flex h-[4px] w-full overflow-hidden rounded-full" style={{ background: INK.edgeSoft }}>
        <div className="h-full" style={{ width: `${(add / total) * 100}%`, background: ADD }} />
        <div className="h-full" style={{ width: `${(del / total) * 100}%`, background: DEL }} />
      </div>
    </div>
  );
}

function MessageQuote({ kind, text }: { kind: string; text: string }) {
  return (
    <div className="pl-2.5" style={{ borderLeft: `2px solid ${INK.edge}` }}>
      <div className="mb-1.5"><Tag>{kind}</Tag></div>
      <p className="font-mono text-[10px] leading-relaxed text-studio-ink-muted">{text}</p>
    </div>
  );
}

/* identity glyphs */
function GAgent() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.2" stroke="currentColor" strokeWidth="1.2" /><path d="M3.5 13c0-2.2 2-3.6 4.5-3.6s4.5 1.4 4.5 3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>; }
function GChat() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2.5 4h11v7h-7l-3 2.5V11h-1V4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>; }
function GRepo() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 4.5l1.5-1.5h3l1 1H14v8H2v-7.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><path d="M2 7h12" stroke="currentColor" strokeWidth="1.2" /></svg>; }
function GTail() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M1.5 8h2l1.5-4 2 8 2-6 1.5 2h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

/* ═══════════════════════════════════════════════════════════════════════════
   THE FOUR SIDEBARS
   ═══════════════════════════════════════════════════════════════════════════ */

function AgentSidebar({ flush }: { flush?: boolean }) {
  return (
    <Rail flush={flush}>
      <RailHeader label="Agent" status="available" />
      <Body>
        <Identity glyph={<GAgent />} name="Action" sub="action · ~/dev/action" />

        <Section label="Telemetry · 1h">
          <StatRow stats={[{ k: "Tokens", v: "13.1M", accent: true }, { k: "Context", v: "61%" }, { k: "Msgs", v: "1.2k" }]} />
          <div className="mt-3"><Sparkline /></div>
        </Section>

        <Section label="Runtime">
          <TagMix tags={[{ label: "claude" }, { label: "opus-4.7" }, { label: "stream-json" }, { label: "relay agent" }]} />
        </Section>

        <Section label="Session">
          <QuietKV rows={[
            { k: "ID", v: "relay-action-claude", wide: true },
            { k: "Active", v: "1 day" },
            { k: "Last seen", v: "1d ago" },
            { k: "Branch", v: "(none)", color: "var(--studio-ink-faint)" },
          ]} />
        </Section>
      </Body>
      <Footer primary="Message" secondary="+ New" />
    </Rail>
  );
}

function CommsSidebar({ flush }: { flush?: boolean }) {
  return (
    <Rail flush={flush}>
      <RailHeader label="Conversation" status="active 2m" />
      <Body>
        <Identity glyph={<GChat />} name="#general" sub="channel · project dewey" />

        <Section label="Participants" count="4">
          <RowList rows={[
            { name: "Dewey", meta: "claude", dot: ACCENT },
            { name: "Hudson", meta: "claude", dot: ACCENT },
            { name: "Iris", meta: "claude", dot: ACCENT },
            { name: "You", meta: "human", dot: INK.edge, dim: true },
          ]} />
        </Section>

        <Section label="Activity">
          <StatRow stats={[{ k: "Unread", v: "2", accent: true }, { k: "Messages", v: "1.2k" }, { k: "Last", v: "2m" }]} />
        </Section>

        <Section label="Project">
          <QuietKV rows={[
            { k: "Repo", v: "dewey" },
            { k: "Branch", v: "main" },
            { k: "Path", v: "~/dev/dewey", wide: true },
          ]} />
        </Section>

        <Section label="Ask"><EmptyLine>No open asks on this thread.</EmptyLine></Section>
      </Body>
      <Footer primary="Open" secondary="Reply" />
    </Rail>
  );
}

function TailSidebar({ flush }: { flush?: boolean }) {
  return (
    <Rail flush={flush}>
      <RailHeader label="Event" status="codex" />
      <Body>
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-[20px] leading-none tabular-nums text-studio-ink">00:01:55</span>
          <span className="font-mono text-[9px] text-studio-ink-faint">talkie · 019eb9da</span>
        </div>

        <Section label="Message"><MessageQuote kind="assistant" text="Done. I tightened the selector geometry and quieted the idle pulse — the rail now settles in one frame instead of three." /></Section>

        <Section label="Origin">
          <div className="mb-2.5"><TagMix tags={[{ label: "codex" }, { label: "native" }]} /></div>
          <QuietKV rows={[
            { k: "Name", v: "talkie" },
            { k: "Session", v: "019eb9da" },
          ]} />
        </Section>

        <Section label="Metrics">
          <StatRow stats={[{ k: "Tokens", v: "13.1M", accent: true }, { k: "Δ tokens", v: "+167k" }, { k: "Wall", v: "—" }]} />
        </Section>
      </Body>
      <Footer primary="Copy" secondary="Open thread" />
    </Rail>
  );
}

function ReposSidebar({ flush }: { flush?: boolean }) {
  return (
    <Rail flush={flush}>
      <RailHeader label="Repo" status="dirty" />
      <Body>
        <Identity glyph={<GRepo />} name="lattices" sub="~/dev/lattices · dirty main" />

        <Section label="Drift">
          <ChurnLead add={491} del={102} />
          <div className="mt-3"><StatRow stats={[{ k: "Files", v: "2" }, { k: "Ahead", v: "3" }, { k: "Behind", v: "0" }]} /></div>
        </Section>

        <Section label="Worktrees" count="3">
          <RowList rows={[
            { name: "main", dot: ACCENT, meta: <><span style={{ color: ADD }}>+491</span> <span style={{ color: DEL }}>−102</span></> },
            { name: "preface", dot: INK.edge, meta: <><span style={{ color: ADD }}>+68</span> <span style={{ color: DEL }}>−15</span></> },
            { name: "ticker", dot: INK.edge, meta: <><span style={{ color: ADD }}>+12</span> <span style={{ color: DEL }}>−4</span></> },
          ]} />
        </Section>

        <Section label="Status">
          <QuietKV rows={[
            { k: "Branch", v: "main" },
            { k: "Agents", v: "2 idle", color: "var(--studio-ink-faint)" },
            { k: "Touched", v: "2h ago" },
            { k: "Remote", v: "origin" },
          ]} />
        </Section>
      </Body>
      <Footer primary="Open" secondary="Diff" />
    </Rail>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SURFACE FRAME — Instrument chrome, dimmed surface-shaped center, real sidebar
   ═══════════════════════════════════════════════════════════════════════════ */

function Lights() {
  return (
    <div className="flex items-center gap-[6px]">
      <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#FF5F57" }} />
      <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#FEBC2E" }} />
      <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#28C840" }} />
    </div>
  );
}

type Shape = "rows" | "log" | "table";
function CenterSkeleton({ shape }: { shape: Shape }) {
  const rows = Array.from({ length: 13 });
  return (
    <div className="absolute inset-0 flex flex-col gap-[9px] p-4 opacity-[0.12]">
      {rows.map((_, i) => {
        if (shape === "log") {
          return (
            <div key={i} className="flex items-center gap-2">
              <div className="h-2 w-12 rounded" style={{ background: INK.edgeSoft }} />
              <div className="h-2 w-8 rounded" style={{ background: INK.edge }} />
              <div className="h-2 rounded" style={{ width: `${45 + ((i * 31) % 40)}%`, background: INK.edgeSoft }} />
            </div>
          );
        }
        if (shape === "table") {
          return (
            <div key={i} className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full" style={{ background: INK.edge }} />
              <div className="h-2 rounded" style={{ width: `${22 + ((i * 17) % 18)}%`, background: INK.edgeSoft }} />
              <div className="ml-auto h-2 w-10 rounded" style={{ background: INK.edgeSoft }} />
              <div className="h-2 w-6 rounded" style={{ background: INK.edge }} />
              <div className="h-2 w-8 rounded" style={{ background: INK.edgeSoft }} />
            </div>
          );
        }
        return (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full" style={{ background: INK.edge }} />
            <div className="h-2 rounded" style={{ width: `${38 + ((i * 37) % 42)}%`, background: INK.edgeSoft }} />
            <div className="ml-auto h-2 w-8 rounded" style={{ background: INK.edgeSoft }} />
          </div>
        );
      })}
    </div>
  );
}

function SurfaceFrame({ title, shape, sidebar }: { title: string; shape: Shape; sidebar: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[10px]" style={{ background: INK.canvas, border: `1px solid ${INK.edge}`, boxShadow: "0 30px 70px -34px rgba(0,0,0,0.85)" }}>
      <div className="flex h-[30px] items-center px-3" style={{ borderBottom: `1px solid ${INK.edgeSoft}`, background: INK.rail }}>
        <Lights />
        <div className="flex-1 text-center font-mono text-[10px] tracking-[0.12em] text-studio-ink-faint">{title}</div>
        <div className="w-[44px]" />
      </div>

      <div className="flex h-[600px]">
        <div className="flex w-[40px] flex-none flex-col items-center gap-2 py-3 opacity-40" style={{ borderRight: `1px solid ${INK.edgeSoft}`, background: INK.rail }}>
          <div className="h-[24px] w-[24px] rounded-[5px]" style={{ background: INK.edge }} />
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[22px] w-[22px] rounded-[6px]" style={{ background: INK.edgeSoft }} />)}
        </div>

        <div className="relative min-w-0 flex-1" style={{ borderRight: `1px solid ${INK.edgeSoft}`, background: INK.canvas }}>
          <CenterSkeleton shape={shape} />
          <div className="absolute left-3 top-3 z-10 font-mono text-[8px] uppercase tracking-[0.14em]" style={{ color: INK.edge }}>
            center · separate study
          </div>
        </div>

        {sidebar}
      </div>

      <div className="flex h-[22px] items-center gap-2 px-3" style={{ borderTop: `1px solid ${INK.edgeSoft}`, background: INK.rail }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: INK.edge }} />
        <span className="font-mono text-[8.5px] tracking-[0.14em] text-studio-ink-faint">{title.split("·").pop()?.trim()}</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

function SurfaceHeading({ n, title, note }: { n: string; title: string; note: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-6">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-scout-accent">{n}</span>
        <h2 className="font-display text-[22px] font-medium tracking-tight text-studio-ink">{title}</h2>
      </div>
      <p className="max-w-md text-right font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">{note}</p>
    </div>
  );
}

export default function ScoutShellDirectionsPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-10">
      <header className="mb-14 max-w-2xl">
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">· studies · macos · shell</span>
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-[0.1em]" style={{ background: "var(--scout-accent-soft)", color: ACCENT }}>
            <span className="h-1 w-1 rounded-full bg-current" />Instrument
          </span>
        </div>
        <h1 className="font-display text-[34px] font-medium leading-[1.05] tracking-tight text-studio-ink">The inspector sidebar</h1>
        <p className="mt-4 font-sans text-[14px] leading-relaxed text-studio-ink-faint">
          The Instrument structure vocabulary — borrowed from the live app's
          CONTEXT panel — applied to the right-side inspector across the four
          real surfaces. Flat sections under faint labels; structure comes from
          stat readouts, tag distributions and dot-led list rows, not from
          boxes. Each inspector leads with the one component that matters most
          for that entity. The center list is dimmed; it's explored separately.
        </p>
      </header>

      <div className="flex flex-col gap-16">
        <section>
          <SurfaceHeading n="01" title="Agents" note="Leads with a telemetry stat readout (tokens · context · msgs) + sparkline. Harness/model/transport become a tag distribution; the rest is quiet session metadata." />
          <SurfaceFrame title="scout · agents" shape="rows" sidebar={<AgentSidebar flush />} />
        </section>

        <section>
          <SurfaceHeading n="02" title="Comms" note="The participant list is the lead — dot + name + harness, the live app's RECENT-row treatment. Activity is a stat readout; the empty ask is a plain faint line." />
          <SurfaceFrame title="scout · comms" shape="rows" sidebar={<CommsSidebar flush />} />
        </section>

        <section>
          <SurfaceHeading n="03" title="Tail" note="Timestamp hero, the message quoted as the lead, origin as tags + quiet meta, and a token stat readout. Kind is a neutral tag, not colour-coded." />
          <SurfaceFrame title="scout · tail" shape="log" sidebar={<TailSidebar flush />} />
        </section>

        <section>
          <SurfaceHeading n="04" title="Repos" note="The drift component up top — diverging churn bar + a files/ahead/behind stat row. Worktrees as list rows with per-branch churn. The one place colour earns its keep." />
          <SurfaceFrame title="scout · repos" shape="table" sidebar={<ReposSidebar flush />} />
        </section>
      </div>

      <div className="mt-16 rounded-[8px] border border-studio-edge bg-studio-canvas-alt px-5 py-4">
        <p className="font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-studio-ink-muted">The structure vocabulary</span>
          <br />
          <span className="mt-1 block">Stat readouts (big number · tiny label) · tag distributions (pill + count) · dot-led list rows · quiet label/value lines · plain empty states. Flat sections under faint labels — no boxes. A single accent for the live signal and primary action; green/red reserved for diff churn. Lifted from the live CONTEXT panel so the inspector and the rest of the app speak the same language.</span>
        </p>
      </div>
    </main>
  );
}
