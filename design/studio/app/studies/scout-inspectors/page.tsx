"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Scout · inspector inventory  —  in context, in the Instrument language

   Every right-side inspector the app ships today, rendered AS the right rail
   inside the real window shell (left nav · dimmed center · inspector). Pick a
   surface on the left; the rail re-renders. Rows, steps and controls carry
   their real interactive treatment — hover to highlight, click to select.

   Source of truth: packages/web/client/scout/inspector/* + slots/Inspector.tsx.
   Structure vocabulary from the live CONTEXT panel: flat sections under faint
   labels, stat readouts, tag distributions, dot-led rows, plain empty states.
   One accent, used only for live signal / selection; green/red for diff churn.
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
const ADD = "var(--status-ok-fg)";
const DEL = "var(--status-error-fg)";
const HOVER = "hover:bg-[oklch(0.165_0.008_80)]"; // = INK.module, used where bg isn't set inline

/* ── rail shell ───────────────────────────────────────────────────────────── */

function Rail({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-[304px] flex-none flex-col overflow-hidden" style={{ background: INK.panel, borderLeft: `1px solid ${INK.edge}` }}>
      {children}
    </div>
  );
}

function RailHeader({ label }: { label: string }) {
  return (
    <div className="flex h-[34px] flex-none items-center justify-between px-3.5" style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}>
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">{label}</span>
      <span className="flex items-center gap-1.5 text-studio-ink-faint">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden><rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.1" /><path d="M10 3v10" stroke="currentColor" strokeWidth="1.1" /></svg>
      </span>
    </div>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-hidden px-3.5 py-3.5">{children}</div>;
}

function Footer({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <div className="flex flex-none items-center gap-1.5 px-3 py-2.5" style={{ borderTop: `1px solid ${INK.edgeSoft}`, background: INK.rail }}>
      <button className="flex-1 cursor-pointer rounded-[4px] py-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] transition hover:brightness-110 active:brightness-95" style={{ background: ACCENT, color: INK.canvas }}>{primary}</button>
      <button className={`flex-1 cursor-pointer rounded-[4px] py-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-studio-ink-muted transition-colors ${HOVER}`} style={{ border: `1px solid ${INK.edge}` }}>{secondary}</button>
    </div>
  );
}

/* ── structure vocabulary ─────────────────────────────────────────────────── */

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

type Stat = { k: string; v: string; accent?: boolean; warn?: boolean };
function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div className="flex">
      {stats.map((s, i) => (
        <div key={s.k} className="flex flex-1 flex-col gap-1.5" style={{ paddingLeft: i ? 11 : 0, marginLeft: i ? 11 : 0, borderLeft: i ? `1px solid ${INK.edgeSoft}` : undefined }}>
          <span className="font-mono text-[7px] font-semibold uppercase tracking-[0.1em] text-studio-ink-faint">{s.k}</span>
          <span className="font-mono text-[18px] leading-none tabular-nums" style={{ color: s.warn ? DEL : s.accent ? ACCENT : "var(--studio-ink)" }}>{s.v}</span>
        </div>
      ))}
    </div>
  );
}

type T = { label: string; count?: string };
function TagMix({ tags }: { tags: T[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <button key={t.label} className="inline-flex cursor-pointer items-center gap-1.5 rounded-[3px] border border-[oklch(0.27_0.008_80)] px-1.5 py-[2.5px] font-mono text-[9px] transition-colors hover:border-[oklch(0.37_0.008_80)]">
          <span className="text-studio-ink-muted">{t.label}</span>
          {t.count != null ? <span className="tabular-nums text-studio-ink-faint">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

type LRow = { name: string; meta?: React.ReactNode; sub?: string; dot?: string; dim?: boolean };
function RowList({ rows, defaultSelected }: { rows: LRow[]; defaultSelected?: number }) {
  const [sel, setSel] = React.useState<number>(defaultSelected ?? -1);
  const [hov, setHov] = React.useState<number>(-1);
  return (
    <div className="flex flex-col gap-[2px]">
      {rows.map((r, i) => {
        const selected = i === sel;
        const lit = selected || i === hov;
        return (
          <button
            key={r.name}
            type="button"
            onClick={() => setSel((s) => (s === i ? -1 : i))}
            onMouseEnter={() => setHov(i)}
            onMouseLeave={() => setHov((h) => (h === i ? -1 : h))}
            className="relative flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-1.5 py-[5px] text-left transition-colors"
            style={{ background: selected ? `color-mix(in oklab, ${ACCENT} 11%, transparent)` : i === hov ? INK.module : "transparent" }}
          >
            {selected ? <span className="absolute left-0 top-1/2 h-[14px] w-[2px] -translate-y-1/2 rounded-full" style={{ background: ACCENT }} /> : null}
            <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: selected ? ACCENT : r.dot ?? INK.edge }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate font-mono text-[11px]" style={{ color: lit ? "var(--studio-ink)" : r.dim ? "var(--studio-ink-faint)" : "var(--studio-ink-muted)" }}>{r.name}</span>
                {r.meta != null ? <span className="ml-auto flex-none font-mono text-[9px] tabular-nums text-studio-ink-faint">{r.meta}</span> : null}
              </div>
              {r.sub ? <div className="truncate font-mono text-[8.5px] text-studio-ink-faint">{r.sub}</div> : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

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
      <div className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[7px] text-studio-ink-muted" style={{ background: INK.module, border: `1px solid ${INK.edgeSoft}` }}>{glyph}</div>
      <div className="min-w-0">
        <div className="truncate font-mono text-[15px] leading-none text-studio-ink">{name}</div>
        <div className="mt-1.5 truncate font-mono text-[9px] text-studio-ink-faint">{sub}</div>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-[3px] px-1.5 py-[1px] font-mono text-[8px] font-semibold uppercase tracking-[0.1em] text-studio-ink-faint" style={{ border: `1px solid ${INK.edge}` }}>{children}</span>;
}

/* ── specialised treatments ───────────────────────────────────────────────── */

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
        <span className="font-mono text-[10px] tabular-nums"><span style={{ color: ADD }}>+{add}</span> <span style={{ color: DEL }}>−{del}</span></span>
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
    <button type="button" className={`block w-full cursor-pointer rounded-r-[4px] pl-2.5 text-left transition-colors ${HOVER}`} style={{ borderLeft: `2px solid ${INK.edge}` }}>
      <div className="mb-1.5 pt-1"><Tag>{kind}</Tag></div>
      <p className="pb-1 font-mono text-[10px] leading-relaxed text-studio-ink-muted">{text}</p>
    </button>
  );
}

type TLItem = { kind: string; actor: string; title?: string; ago: string; dot: string };
function Timeline({ items }: { items: TLItem[] }) {
  return (
    <div className="flex flex-col">
      {items.map((it, i) => (
        <button key={i} type="button" className={`flex cursor-pointer gap-2.5 rounded-[4px] px-1 text-left transition-colors ${HOVER}`}>
          <div className="flex flex-none flex-col items-center">
            <span className="mt-[5px] h-1.5 w-1.5 rounded-full" style={{ background: it.dot }} />
            {i < items.length - 1 ? <span className="w-px flex-1" style={{ background: INK.edgeSoft }} /> : null}
          </div>
          <div className="min-w-0 flex-1 pb-3 pt-1">
            <div className="flex items-baseline gap-2">
              <Tag>{it.kind}</Tag>
              <span className="ml-auto font-mono text-[8.5px] tabular-nums text-studio-ink-faint">{it.ago}</span>
            </div>
            <div className="mt-1 truncate font-mono text-[10.5px] text-studio-ink-muted">{it.actor}</div>
            {it.title ? <div className="truncate font-mono text-[9px] text-studio-ink-faint">{it.title}</div> : null}
          </div>
        </button>
      ))}
    </div>
  );
}

type Step = { mark: string; text: string; status: "done" | "active" | "blocked" | "todo" };
function Steps({ steps }: { steps: Step[] }) {
  return (
    <div className="flex flex-col gap-[1px]">
      {steps.map((s, i) => (
        <button key={i} type="button" className={`flex cursor-pointer items-center gap-2 rounded-[4px] px-1 py-[3px] text-left transition-colors ${HOVER}`}>
          <span className="w-2 flex-none text-center font-mono text-[10px]" style={{ color: s.status === "active" ? ACCENT : s.status === "blocked" ? DEL : "var(--studio-ink-faint)" }}>{s.mark}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px]" style={{ color: s.status === "done" ? "var(--studio-ink-faint)" : "var(--studio-ink-muted)" }}>{s.text}</span>
          <Tag>{s.status}</Tag>
        </button>
      ))}
    </div>
  );
}

function ModeGrid({ modes }: { modes: { label: string; active?: boolean }[] }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {modes.map((m) =>
        m.active ? (
          <button key={m.label} className="cursor-pointer rounded-[4px] py-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] transition hover:brightness-110" style={{ background: `color-mix(in oklab, ${ACCENT} 14%, transparent)`, color: ACCENT, border: `1px solid ${ACCENT}` }}>{m.label}</button>
        ) : (
          <button key={m.label} className={`cursor-pointer rounded-[4px] py-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-studio-ink-muted transition-colors ${HOVER}`} style={{ border: `1px solid ${INK.edge}` }}>{m.label}</button>
        )
      )}
    </div>
  );
}

function TermPre({ lines }: { lines: string[] }) {
  return (
    <div className="overflow-hidden rounded-[5px] p-2.5" style={{ background: INK.canvas, border: `1px solid ${INK.edgeSoft}` }}>
      <pre className="whitespace-pre font-mono text-[8px] leading-relaxed text-studio-ink-faint">{lines.join("\n")}</pre>
    </div>
  );
}

function HarnessBars({ rows }: { rows: { name: string; count: number }[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.name}>
          <div className="mb-1 flex items-baseline justify-between font-mono">
            <span className="text-[9px] text-studio-ink-muted">{r.name}</span>
            <span className="text-[9px] tabular-nums text-studio-ink-faint">{r.count}</span>
          </div>
          <div className="h-[3px] w-full overflow-hidden rounded-full" style={{ background: INK.edgeSoft }}>
            <div className="h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: INK.edge }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReachRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: ok ? ACCENT : INK.edge }} />
      <span className="font-mono text-[10.5px]" style={{ color: ok ? "var(--studio-ink-muted)" : "var(--studio-ink-faint)" }}>{label}</span>
    </div>
  );
}

const G = {
  agent: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.2" stroke="currentColor" strokeWidth="1.2" /><path d="M3.5 13c0-2.2 2-3.6 4.5-3.6s4.5 1.4 4.5 3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
  chat: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2.5 4h11v7h-7l-3 2.5V11h-1V4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>,
  repo: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 4.5l1.5-1.5h3l1 1H14v8H2v-7.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><path d="M2 7h12" stroke="currentColor" strokeWidth="1.2" /></svg>,
  mesh: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" /><circle cx="3" cy="4" r="1.4" stroke="currentColor" strokeWidth="1.2" /><circle cx="13" cy="4" r="1.4" stroke="currentColor" strokeWidth="1.2" /><circle cx="8" cy="14" r="1.4" stroke="currentColor" strokeWidth="1.2" /><path d="M6.4 6.8L3.8 5M9.6 6.8L12.2 5M8 10v2.6" stroke="currentColor" strokeWidth="1" /></svg>,
  plan: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="3" y="2.5" width="10" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" /><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></svg>,
  term: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3" width="11" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.2" /><path d="M5 6l2 2-2 2M8.5 10h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
};

/* ═══════════════════════════════════════════════════════════════════════════
   THE INSPECTORS — live-fleet data, no qualifier labels
   ═══════════════════════════════════════════════════════════════════════════ */

function HomeRoster() {
  return (
    <Rail>
      <RailHeader label="Roster" />
      <Body>
        <Section label="Ready" count="5">
          <RowList rows={[
            { name: "Action", meta: "1d", dot: ACCENT },
            { name: "Hudson", meta: "1d", dot: ACCENT },
            { name: "Dewey", meta: "1d", dot: ACCENT },
            { name: "Iris", meta: "1d", dot: ACCENT },
            { name: "Lattices", meta: "1d", dot: ACCENT },
          ]} />
        </Section>
        <Section label="Not ready" count="2">
          <RowList rows={[{ name: "Art", meta: "—", dim: true }, { name: "Grok Hudson Lite", meta: "3d", dim: true }]} />
        </Section>
      </Body>
      <Footer primary="Brief" secondary="New" />
    </Rail>
  );
}

function AgentsContext() {
  return (
    <Rail>
      <RailHeader label="Context" />
      <Body>
        <Section label="Directory context">
          <StatRow stats={[{ k: "Agents", v: "25" }, { k: "Projects", v: "15" }, { k: "Working", v: "0" }]} />
          <div className="mt-2 font-mono text-[8.5px] uppercase tracking-[0.1em] text-studio-ink-faint">25 ready · 15 projects</div>
        </Section>
        <Section label="Project mix">
          <TagMix tags={[{ label: "openscout", count: "8" }, { label: "hudson", count: "4" }, { label: "action", count: "1" }, { label: "art", count: "1" }, { label: "dewey", count: "1" }]} />
        </Section>
        <Section label="Harness mix">
          <TagMix tags={[{ label: "claude", count: "16" }, { label: "pi", count: "5" }, { label: "codex", count: "3" }, { label: "general", count: "1" }]} />
        </Section>
        <Section label="Recent">
          <RowList defaultSelected={0} rows={[
            { name: "Openscout Card 0 Lxrq1a", meta: "1d", dot: ACCENT },
            { name: "Openscout Card 1 J1r3ek", meta: "1d", dot: ACCENT },
            { name: "Openscout Card G 1nu9p7", meta: "1d", dot: ACCENT },
            { name: "Usetalkie Com", meta: "1d", dot: INK.edge, dim: true },
          ]} />
        </Section>
      </Body>
    </Rail>
  );
}

function AgentDetail() {
  return (
    <Rail>
      <RailHeader label="Agent" />
      <Body>
        <Identity glyph={G.agent} name="Action" sub="action · ~/dev/action" />
        <Section label="Identity">
          <QuietKV rows={[{ k: "Class", v: "general" }, { k: "Role", v: "Relay agent" }, { k: "Harness", v: "claude" }, { k: "Transport", v: "stream-json" }, { k: "Host", v: "arts-mac-mini" }]} />
        </Section>
        <Section label="Project">
          <QuietKV rows={[{ k: "Name", v: "action" }, { k: "Branch", v: "(none)", color: "var(--studio-ink-faint)" }, { k: "Cwd", v: "~/dev/action", wide: true }]} />
        </Section>
        <Section label="Capabilities">
          <TagMix tags={[{ label: "chat" }, { label: "invoke" }, { label: "deliver" }, { label: "execute" }]} />
        </Section>
        <Section label="Running sessions" count="1">
          <RowList defaultSelected={0} rows={[{ name: "relay-action-claude", meta: "1d", sub: "claude · active", dot: ACCENT }]} />
        </Section>
      </Body>
      <Footer primary="Message" secondary="Observe" />
    </Rail>
  );
}

function SessionsContext() {
  return (
    <Rail>
      <RailHeader label="Sessions" />
      <Body>
        <Section label="Sessions context">
          <StatRow stats={[{ k: "Scout", v: "12" }, { k: "Raw", v: "48" }, { k: "Live", v: "3", accent: true }]} />
          <div className="mt-2 font-mono text-[8.5px] uppercase tracking-[0.1em] text-studio-ink-faint">4 sources</div>
        </Section>
        <Section label="Sources">
          <TagMix tags={[{ label: "claude", count: "16" }, { label: "codex", count: "3" }, { label: "pi", count: "5" }]} />
        </Section>
        <Section label="Recent raw">
          <RowList rows={[
            { name: "talkie · 019eb9da", meta: "1d", sub: "codex · talkie", dot: ACCENT },
            { name: "openscout · 9919802e", meta: "2d", sub: "claude · openscout", dot: INK.edge, dim: true },
          ]} />
        </Section>
        <Section label="Recent scout">
          <RowList rows={[{ name: "Repo watch converge", meta: "1d", dot: INK.edge, dim: true }, { name: "Web taxonomy", meta: "2d", dot: INK.edge, dim: true }]} />
        </Section>
      </Body>
      <Footer primary="Open" secondary="Index" />
    </Rail>
  );
}

function TerminalDetail() {
  return (
    <Rail>
      <RailHeader label="Terminal" />
      <Body>
        <Identity glyph={G.term} name="Action" sub="@action · tmux" />
        <Section label="Terminal">
          <QuietKV rows={[{ k: "Mode", v: "Read-only" }, { k: "Backend", v: "tmux" }, { k: "Session", v: "019eb9da" }, { k: "State", v: "available" }]} />
        </Section>
        <Section label="Controls">
          <ModeGrid modes={[{ label: "Observe", active: true }, { label: "Takeover" }, { label: "Profile" }, { label: "Trace" }]} />
        </Section>
        <Section label="Sample · 132×44">
          <TermPre lines={["$ bun bin/scout-app.ts dev-build", "→ compiling Scout (HudsonKit)…", "  • ScoutRootView.swift", "  • ScoutAgentsTree.swift", "✓ build succeeded · 8.42s", "› relaunching Scout…"]} />
        </Section>
      </Body>
    </Rail>
  );
}

function ConversationDetail() {
  return (
    <Rail>
      <RailHeader label="Conversation" />
      <Body>
        <Identity glyph={G.chat} name="Hudson" sub="@hudson · claude" />
        <Section label="Now">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />
            <span className="font-mono text-[10.5px] text-studio-ink-muted">Working</span>
            <span className="ml-auto font-mono text-[9px] text-studio-ink-faint">2m</span>
          </div>
          <p className="mt-1.5 font-mono text-[9.5px] leading-relaxed text-studio-ink-faint">Refactoring AgentRow into a shared atom.</p>
        </Section>
        <Section label="Workspace">
          <QuietKV rows={[{ k: "Project", v: "hudson" }, { k: "Branch", v: "main" }, { k: "Path", v: "~/dev/hudson", wide: true }]} />
        </Section>
        <Section label="Activity">
          <StatRow stats={[{ k: "Messages", v: "47" }, { k: "People", v: "2" }, { k: "State", v: "working", accent: true }]} />
        </Section>
        <Section label="Latest">
          <MessageQuote kind="assistant" text="Pulled AgentRow into a shared atom — three call sites updated, types check." />
        </Section>
      </Body>
      <Footer primary="Open" secondary="Reply" />
    </Rail>
  );
}

function ChannelDetail() {
  return (
    <Rail>
      <RailHeader label="Channel" />
      <Body>
        <Identity glyph={G.chat} name="#general" sub="channel · project dewey" />
        <Section label="Participants" count="4">
          <RowList rows={[
            { name: "Dewey", meta: "claude", dot: ACCENT },
            { name: "Hudson", meta: "claude", dot: ACCENT },
            { name: "Iris", meta: "claude", dot: ACCENT },
            { name: "You", meta: "human", dot: INK.edge, dim: true },
          ]} />
        </Section>
        <Section label="Doing" count="2">
          <RowList defaultSelected={0} rows={[
            { name: "Dewey", meta: "2m", sub: "running · standup digest", dot: ACCENT },
            { name: "Hudson", meta: "5m", sub: "working · audit trail", dot: ACCENT },
          ]} />
        </Section>
        <Section label="Recent" count="2">
          <RowList rows={[{ name: "Iris", meta: "1h", sub: "done · iconography", dim: true }, { name: "Codex", meta: "3h", sub: "done · sec review", dim: true }]} />
        </Section>
      </Body>
      <Footer primary="Open" secondary="Post" />
    </Rail>
  );
}

function SearchDetail() {
  return (
    <Rail>
      <RailHeader label="Result" />
      <Body>
        <div>
          <div className="font-mono text-[7.5px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">Selected result</div>
          <div className="mt-1.5 font-mono text-[14px] leading-tight text-studio-ink">AgentRow shared atom</div>
        </div>
        <TagMix tags={[{ label: "openscout" }, { label: "claude" }, { label: "worktree diff" }, { label: "records 0..79" }]} />
        <Section label="Why ranked here">
          <QuietKV rows={[{ k: "Index rank", v: "0.92", color: ACCENT }, { k: "Matched terms", v: "agent row" }, { k: "Matched in", v: "summary · body" }]} />
        </Section>
        <Section label="Message hits" count="3">
          <RowList defaultSelected={0} rows={[
            { name: "0001 · assistant", meta: "×2", dot: ACCENT },
            { name: "0014 · tool", meta: "×1", dot: INK.edge, dim: true },
            { name: "0042 · assistant", meta: "×1", dot: INK.edge, dim: true },
          ]} />
        </Section>
        <Section label="Source">
          <QuietKV rows={[{ k: "Transcript", v: "~/.scout/raw/019eb9da.jsonl", wide: true }]} />
        </Section>
      </Body>
      <Footer primary="Open session" secondary="Open file" />
    </Rail>
  );
}

function OpsMission() {
  return (
    <Rail>
      <RailHeader label="Mission" />
      <Body>
        <Section label="Ops context">
          <StatRow stats={[{ k: "Needs", v: "0" }, { k: "Active", v: "3" }, { k: "Online", v: "25" }, { k: "Working", v: "0" }]} />
        </Section>
        <Section label="Queue"><EmptyLine>No operator cues.</EmptyLine></Section>
        <Section label="Runs" count="3">
          <RowList defaultSelected={0} rows={[
            { name: "repo-watch-converge-map", meta: "5w", dot: ACCENT },
            { name: "web-taxonomy", meta: "8w", dot: ACCENT },
            { name: "talkie-bridge-security-audit", meta: "78w", dot: ACCENT },
          ]} />
        </Section>
        <Section label="Agent pulse">
          <RowList rows={[
            { name: "Action", meta: "1d", sub: "available", dot: ACCENT },
            { name: "Hudson", meta: "1d", sub: "available", dot: ACCENT },
            { name: "Grok Hudson", meta: "1d", sub: "available", dot: ACCENT },
          ]} />
        </Section>
      </Body>
    </Rail>
  );
}

function PlanDetail() {
  return (
    <Rail>
      <RailHeader label="Plan" />
      <Body>
        <Identity glyph={G.plan} name="Inspector sidebar" sub="docs/plan.md · 1d" />
        <Section label="Steps" count="5">
          <Steps steps={[
            { mark: "x", text: "Inventory the app", status: "done" },
            { mark: "x", text: "Lift structure vocabulary", status: "done" },
            { mark: ">", text: "Render full inspector set", status: "active" },
            { mark: " ", text: "Port to native SwiftUI", status: "todo" },
            { mark: " ", text: "Sign-off + ship", status: "todo" },
          ]} />
        </Section>
        <Section label="Around this plan" count="2">
          <RowList rows={[
            { name: "scout-shell-directions", meta: "1d", sub: "session · claude", dot: ACCENT },
            { name: "Repos presentation", meta: "1d", sub: "work · build", dot: INK.edge, dim: true },
          ]} />
        </Section>
      </Body>
      <Footer primary="Open doc" secondary="Refresh" />
    </Rail>
  );
}

function TailDetail() {
  return (
    <Rail>
      <RailHeader label="Event" />
      <Body>
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-[20px] leading-none tabular-nums text-studio-ink">00:01:55</span>
          <span className="font-mono text-[9px] text-studio-ink-faint">talkie · 019eb9da</span>
        </div>
        <Section label="Message">
          <MessageQuote kind="assistant" text="Done. I tightened the selector geometry and quieted the idle pulse — the rail now settles in one frame instead of three." />
        </Section>
        <Section label="Metadata">
          <QuietKV rows={[
            { k: "Source", v: "codex" },
            { k: "Agent", v: "native" },
            { k: "Session", v: "019eb9da" },
            { k: "Kind", v: "agent_message" },
            { k: "Tokens", v: "13.1M", color: ACCENT },
            { k: "Δ tokens", v: "+167,038" },
          ]} />
        </Section>
        <Section label="Stream">
          <RowList rows={[
            { name: "agent_message", meta: "00:01:55", dot: ACCENT },
            { name: "tool · exec_command", meta: "00:01:42", dot: INK.edge, dim: true },
            { name: "reasoning", meta: "00:01:35", dot: INK.edge, dim: true },
          ]} />
        </Section>
      </Body>
      <Footer primary="Copy" secondary="Open thread" />
    </Rail>
  );
}

function DispatchContext() {
  return (
    <Rail>
      <RailHeader label="Dispatch" />
      <Body>
        <Section label="Dispatch context">
          <StatRow stats={[{ k: "Sent", v: "142" }, { k: "Query", v: "0" }, { k: "Delivery", v: "1", warn: true }]} />
          <div className="mt-2 font-mono text-[8.5px] uppercase tracking-[0.1em] text-studio-ink-faint">0.7% fail · 1m ago</div>
        </Section>
        <Section label="Route mix">
          <TagMix tags={[{ label: "channel", count: "5" }, { label: "dm", count: "3" }, { label: "ask", count: "2" }]} />
        </Section>
        <Section label="Needs attention" count="1">
          <RowList rows={[{ name: "deliver fail", meta: "2m", sub: "hudson → atlas", dot: DEL }]} />
        </Section>
        <Section label="Recent dispatch">
          <RowList rows={[
            { name: "ask", meta: "1m", sub: "arts → hudson", dot: ACCENT },
            { name: "channel", meta: "2m", sub: "#general", dot: INK.edge, dim: true },
          ]} />
        </Section>
      </Body>
      <Footer primary="Retry" secondary="Open" />
    </Rail>
  );
}

function MeshSummary() {
  return (
    <Rail>
      <RailHeader label="Mesh" />
      <Body>
        <Identity glyph={G.mesh} name="arts-mac-mini" sub="this broker · localhost:6400" />
        <Section label="Summary">
          <StatRow stats={[{ k: "Agents", v: "25" }, { k: "Working", v: "0", accent: true }, { k: "Ready", v: "25" }, { k: "Not", v: "0" }]} />
        </Section>
        <Section label="By harness">
          <HarnessBars rows={[{ name: "claude", count: 16 }, { name: "pi", count: 5 }, { name: "codex", count: 3 }, { name: "general", count: 1 }]} />
        </Section>
        <Section label="Peers">
          <QuietKV rows={[{ k: "Mesh", v: "3" }, { k: "Tailnet", v: "2 online" }]} />
        </Section>
        <Section label="Reach"><ReachRow ok label="Discoverable on mesh" /></Section>
      </Body>
    </Rail>
  );
}

function RepoDrift() {
  return (
    <Rail>
      <RailHeader label="Repo" />
      <Body>
        <Identity glyph={G.repo} name="lattices" sub="~/dev/lattices · dirty main" />
        <Section label="Drift">
          <ChurnLead add={491} del={102} />
          <div className="mt-3"><StatRow stats={[{ k: "Files", v: "2" }, { k: "Ahead", v: "3" }, { k: "Behind", v: "0" }]} /></div>
        </Section>
        <Section label="Worktrees" count="3">
          <RowList defaultSelected={0} rows={[
            { name: "main", dot: ACCENT, meta: <><span style={{ color: ADD }}>+491</span> <span style={{ color: DEL }}>−102</span></> },
            { name: "preface", dot: INK.edge, meta: <><span style={{ color: ADD }}>+68</span> <span style={{ color: DEL }}>−15</span></> },
            { name: "ticker", dot: INK.edge, meta: <><span style={{ color: ADD }}>+12</span> <span style={{ color: DEL }}>−4</span></> },
          ]} />
        </Section>
        <Section label="Status">
          <QuietKV rows={[{ k: "Branch", v: "main" }, { k: "Agents", v: "2 idle", color: "var(--studio-ink-faint)" }, { k: "Touched", v: "2h ago" }, { k: "Remote", v: "origin" }]} />
        </Section>
      </Body>
      <Footer primary="Open" secondary="Diff" />
    </Rail>
  );
}

function WorkDetail() {
  return (
    <Rail>
      <RailHeader label="Work" />
      <Body>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />
          <span className="font-mono text-[11px] text-studio-ink-muted">Hudson</span>
          <span className="font-mono text-[10px] text-studio-ink-faint">→ Arach</span>
        </div>
        <Section label="Case">
          <QuietKV rows={[{ k: "Phase", v: "build" }, { k: "Acceptance", v: "pending" }, { k: "Priority", v: "high" }]} />
        </Section>
        <Section label="Timeline">
          <Timeline items={[
            { kind: "flight started", actor: "Hudson", title: "review 8 commits", ago: "2m", dot: ACCENT },
            { kind: "message", actor: "Hudson", title: "pulled AgentRow into a shared atom", ago: "5m", dot: INK.edge },
            { kind: "flight done", actor: "Hudson", title: "types check, ready to merge", ago: "1h", dot: INK.edge },
          ]} />
        </Section>
        <Section label="Routing">
          <QuietKV rows={[{ k: "Owner", v: "Hudson" }, { k: "Next move", v: "Arach" }, { k: "Children", v: "2" }, { k: "Flights", v: "4" }]} />
        </Section>
      </Body>
      <Footer primary="Open thread" secondary="Parent" />
    </Rail>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SURFACE REGISTRY + IN-CONTEXT WINDOW
   ═══════════════════════════════════════════════════════════════════════════ */

type Shape = "rows" | "log" | "table";
type Surface = { id: string; label: string; shape: Shape; decision: string; render: () => React.ReactNode };
const GROUPS: { group: string; items: Surface[] }[] = [
  { group: "Home", items: [{ id: "roster", label: "Roster", shape: "rows", decision: "Roster split by readiness — Ready / Not-ready, dot + name + last-seen.", render: () => <HomeRoster /> }] },
  { group: "Agents", items: [
    { id: "agents-context", label: "Context", shape: "rows", decision: "The live CONTEXT panel — directory stat readout, project + harness distributions, recent.", render: () => <AgentsContext /> },
    { id: "agent", label: "Agent", shape: "rows", decision: "Per-agent profile — identity + project as quiet kv, capabilities as tags, running sessions.", render: () => <AgentDetail /> },
    { id: "sessions", label: "Sessions", shape: "rows", decision: "Catalog — scout / raw / live counts, source mix, recent transcripts.", render: () => <SessionsContext /> },
    { id: "terminal", label: "Terminal", shape: "log", decision: "Observe / takeover controls as a mode grid, plus a live tmux sample.", render: () => <TerminalDetail /> },
  ] },
  { group: "Chat", items: [
    { id: "conversation", label: "Conversation", shape: "rows", decision: "Live flight state leads, then workspace, activity stats, latest message quoted.", render: () => <ConversationDetail /> },
    { id: "channel", label: "Channel", shape: "rows", decision: "Participants + active 'Doing' vs terminal 'Recent' runs — the channel's work.", render: () => <ChannelDetail /> },
  ] },
  { group: "Search", items: [{ id: "search", label: "Knowledge", shape: "rows", decision: "Selected result — metadata pills, a why-ranked readout, matched message hits.", render: () => <SearchDetail /> }] },
  { group: "Ops", items: [
    { id: "mission", label: "Mission", shape: "rows", decision: "Fleet stat readout, attention queue, active runs, agent pulse.", render: () => <OpsMission /> },
    { id: "plan", label: "Plan", shape: "rows", decision: "Parsed checklist steps with status markers, plus nearby matched activity.", render: () => <PlanDetail /> },
    { id: "tail", label: "Tail event", shape: "log", decision: "Timestamp hero, the log line quoted, metadata readout, adjacent stream.", render: () => <TailDetail /> },
    { id: "dispatch", label: "Dispatch", shape: "rows", decision: "Broker ledger — sent / failed stat readout, route mix, failed + recent dispatch.", render: () => <DispatchContext /> },
    { id: "mesh", label: "Mesh", shape: "rows", decision: "Fleet summary — counts, by-harness breakdown, peer reach control.", render: () => <MeshSummary /> },
  ] },
  { group: "Repos & Work", items: [
    { id: "repo", label: "Repo", shape: "table", decision: "Drift leads — diverging churn bar + worktrees with per-branch churn.", render: () => <RepoDrift /> },
    { id: "work", label: "Work", shape: "rows", decision: "State → next-move header, case facts, activity timeline, routing.", render: () => <WorkDetail /> },
  ] },
];
const ALL = GROUPS.flatMap((g) => g.items);

function Lights() {
  return (
    <div className="flex items-center gap-[6px]">
      <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#FF5F57" }} />
      <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#FEBC2E" }} />
      <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#28C840" }} />
    </div>
  );
}

function CenterSkeleton({ shape }: { shape: Shape }) {
  return (
    <div className="absolute inset-0 flex flex-col gap-[9px] p-4 opacity-[0.12]">
      {Array.from({ length: 14 }).map((_, i) => {
        if (shape === "log") return (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2 w-12 rounded" style={{ background: INK.edgeSoft }} />
            <div className="h-2 w-8 rounded" style={{ background: INK.edge }} />
            <div className="h-2 rounded" style={{ width: `${45 + ((i * 31) % 40)}%`, background: INK.edgeSoft }} />
          </div>
        );
        if (shape === "table") return (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full" style={{ background: INK.edge }} />
            <div className="h-2 rounded" style={{ width: `${22 + ((i * 17) % 18)}%`, background: INK.edgeSoft }} />
            <div className="ml-auto h-2 w-10 rounded" style={{ background: INK.edgeSoft }} />
            <div className="h-2 w-6 rounded" style={{ background: INK.edge }} />
          </div>
        );
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

function NavPanel({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex w-[176px] flex-none flex-col overflow-y-auto" style={{ background: INK.rail, borderRight: `1px solid ${INK.edgeSoft}` }}>
      <div className="flex h-[34px] flex-none items-center gap-2 px-3" style={{ borderBottom: `1px solid ${INK.edgeSoft}` }}>
        <div className="grid h-[18px] w-[18px] place-items-center rounded-[4px] font-mono text-[9px] font-semibold" style={{ background: ACCENT, color: INK.canvas }}>S</div>
        <span className="font-mono text-[10px] tracking-[0.1em] text-studio-ink-faint">scout</span>
      </div>
      <div className="flex flex-col gap-3 p-2">
        {GROUPS.map((g) => (
          <div key={g.group}>
            <div className="mb-1 px-1.5 font-mono text-[7.5px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">{g.group}</div>
            <div className="flex flex-col gap-[1px]">
              {g.items.map((it) => {
                const sel = it.id === selected;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => onSelect(it.id)}
                    className={`flex cursor-pointer items-center rounded-[4px] px-1.5 py-[5px] text-left font-mono text-[11px] transition-colors ${sel ? "" : HOVER}`}
                    style={{ background: sel ? INK.module : undefined, color: sel ? "var(--studio-ink)" : "var(--studio-ink-faint)" }}
                  >
                    {it.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InContext() {
  const [id, setId] = React.useState("agents-context");
  const surface = ALL.find((s) => s.id === id) ?? ALL[0];
  return (
    <div>
      <div className="overflow-hidden rounded-[10px]" style={{ background: INK.canvas, border: `1px solid ${INK.edge}`, boxShadow: "0 30px 70px -34px rgba(0,0,0,0.85)" }}>
        <div className="flex h-[30px] items-center px-3" style={{ borderBottom: `1px solid ${INK.edgeSoft}`, background: INK.rail }}>
          <Lights />
          <div className="flex-1 text-center font-mono text-[10px] tracking-[0.12em] text-studio-ink-faint">scout · {surface.label.toLowerCase()}</div>
          <div className="w-[44px]" />
        </div>

        <div className="flex h-[604px]">
          <NavPanel selected={id} onSelect={setId} />
          <div className="relative min-w-0 flex-1" style={{ borderRight: `1px solid ${INK.edgeSoft}`, background: INK.canvas }}>
            <CenterSkeleton shape={surface.shape} />
            <div className="absolute left-3 top-3 z-10 font-mono text-[8px] uppercase tracking-[0.14em]" style={{ color: INK.edge }}>center · separate study</div>
          </div>
          {surface.render()}
        </div>

        <div className="flex h-[22px] items-center gap-2 px-3" style={{ borderTop: `1px solid ${INK.edgeSoft}`, background: INK.rail }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: INK.edge }} />
          <span className="font-mono text-[8.5px] tracking-[0.14em] text-studio-ink-faint">broker up · 25 agents · dev main</span>
        </div>
      </div>

      <div className="mt-3.5 flex items-baseline gap-2.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-studio-ink-muted">{surface.label}</span>
        <span className="h-3 w-px" style={{ background: INK.edge }} />
        <p className="font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">{surface.decision}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

export default function ScoutInspectorsPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-10">
      <header className="mb-10 max-w-2xl">
        <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">· studies · macos · shell · instrument</div>
        <h1 className="font-display text-[34px] font-medium leading-[1.05] tracking-tight text-studio-ink">The inspector, in context</h1>
        <p className="mt-4 font-sans text-[14px] leading-relaxed text-studio-ink-faint">
          Every right-side inspector the app ships today, rendered as the actual
          right rail inside the window shell. Pick a surface in the left nav; the
          rail re-renders for that entity. Rows, steps and controls carry their
          real treatment — hover to highlight, click to select. The center list
          is dimmed; it's explored separately.
        </p>
      </header>

      <InContext />

      <div className="mt-12 rounded-[8px] border border-studio-edge bg-studio-canvas-alt px-5 py-4">
        <p className="font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-studio-ink-muted">{ALL.length} content-types · one grammar</span>
          <br />
          <span className="mt-1 block">Home · Agents · Chat · Search · Ops · Repos · Work — every surface in the live app that owns a right rail. Identity → a specialised lead → flat structured sections → footer; only the lead and treatments change to fit the entity. Inventoried from <code className="font-mono text-[12px] text-studio-ink-muted">scout/inspector/*</code>; data from the current fleet.</span>
        </p>
      </div>
    </main>
  );
}
