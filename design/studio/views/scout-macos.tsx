/**
 * Scout macOS · Elevated — the four core screens of the live macOS app
 * (Comms · Agents · Tail · Repos) rendered together in one elevated frame.
 *
 * This is the iteration canvas for the "more elevated, more elegant"
 * direction. Where `scout-macos-shell` is the baseline + ledger and
 * `scout-macos-refresh` is the Comms decision artifact, this study is the
 * design *target*: the ScoutNext elegant language (frosted-raised surfaces,
 * soft depth, corner ticks, bracketed controls, snug spacing, ink-strong
 * type) brought to the macOS shell so all four screens read as one system.
 *
 * Content mirrors the live app today (rows lifted from the
 * scout-macos-shell current-state capture). The *treatment* is the proposal.
 *
 * Static reference only — no app code lives here. Status: concept.
 */

import { EyebrowLabel } from "@/components/EyebrowLabel";

/* ════════════════════════════════════════════════════════════════════
   Design tokens local to this study — the frosted-depth surface system.
   Built on the studio/scout tokens; only depth + alpha live here.
   ════════════════════════════════════════════════════════════════════ */

const GLASS_WINDOW: React.CSSProperties = {
  background:
    "linear-gradient(180deg, color-mix(in oklab, var(--studio-surface) 82%, transparent), color-mix(in oklab, var(--studio-canvas-alt) 88%, transparent))",
  backdropFilter: "blur(28px) saturate(150%)",
  WebkitBackdropFilter: "blur(28px) saturate(150%)",
  border: "1px solid var(--studio-edge-strong)",
  boxShadow:
    "inset 0 1px 0 0 color-mix(in oklab, var(--studio-ink) 12%, transparent), 0 2px 6px -2px rgba(0,0,0,.5), 0 36px 80px -34px rgba(0,0,0,.8)",
};

const GLASS_PANEL: React.CSSProperties = {
  background: "color-mix(in oklab, var(--studio-surface) 60%, transparent)",
  border: "1px solid var(--studio-edge)",
  boxShadow: "inset 0 1px 0 0 color-mix(in oklab, var(--studio-ink) 7%, transparent)",
};

const GLASS_RAISED: React.CSSProperties = {
  background: "color-mix(in oklab, var(--studio-surface) 92%, transparent)",
  border: "1px solid var(--studio-edge-strong)",
  boxShadow:
    "inset 0 1px 0 0 color-mix(in oklab, var(--studio-ink) 14%, transparent), 0 8px 20px -10px rgba(0,0,0,.6)",
};

const STATE_TINT: Record<string, string> = {
  working: "oklch(0.80 0.15 145)",
  available: "oklch(0.80 0.10 205)",
  done: "oklch(0.74 0.12 250)",
  "needs-attention": "oklch(0.80 0.15 70)",
  idle: "var(--studio-ink-faint)",
  offline: "var(--studio-ink-faint)",
};

/* ════════════════════════════════════════════════════════════════════
   Hand-drawn glyphs — minimal line marks, no SF Symbols / icon libs.
   16px, 1.4 stroke, currentColor.
   ════════════════════════════════════════════════════════════════════ */

type GlyphProps = { size?: number; className?: string };
const gp = (s = 16) => ({
  width: s,
  height: s,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.35,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

function CommsGlyph({ size, className }: GlyphProps) {
  return (
    <svg {...gp(size)} className={className} aria-hidden>
      <path d="M2.4 4.3a1.4 1.4 0 0 1 1.4-1.4h6.1a1.4 1.4 0 0 1 1.4 1.4v3.1a1.4 1.4 0 0 1-1.4 1.4H5.6L3.2 10v-1.2H3.8" />
      <path d="M8.4 8.8h3.8a1.4 1.4 0 0 1 1.4 1.4v1.7a1.4 1.4 0 0 1-1.4 1.4h-.6V14l-1.8-1.7H7.6" opacity=".55" />
    </svg>
  );
}
function AgentsGlyph({ size, className }: GlyphProps) {
  return (
    <svg {...gp(size)} className={className} aria-hidden>
      <circle cx="6" cy="5.4" r="2.1" />
      <path d="M2.6 12.4c0-2 1.5-3.3 3.4-3.3s3.4 1.3 3.4 3.3" />
      <circle cx="11.2" cy="6" r="1.6" opacity=".55" />
      <path d="M10 12.4c0-1.6.9-2.7 2.2-2.7 1 0 1.7.6 2 1.5" opacity=".55" />
    </svg>
  );
}
function TailGlyph({ size, className }: GlyphProps) {
  return (
    <svg {...gp(size)} className={className} aria-hidden>
      <path d="M1.6 8h2.1l1.3-3.6 1.9 7L9 6.1l1.1 1.9h3.3" />
    </svg>
  );
}
function ReposGlyph({ size, className }: GlyphProps) {
  return (
    <svg {...gp(size)} className={className} aria-hidden>
      <circle cx="4.4" cy="4" r="1.5" />
      <circle cx="4.4" cy="12" r="1.5" />
      <circle cx="11.6" cy="4" r="1.5" />
      <path d="M4.4 5.5v5" />
      <path d="M4.4 9.2c0-2.8 2.4-2.8 4.6-3.4 1.2-.3 2.6-.8 2.6-2.3" opacity=".75" />
    </svg>
  );
}
function SettingsGlyph({ size, className }: GlyphProps) {
  return (
    <svg {...gp(size)} className={className} aria-hidden>
      <path d="M2.5 4.5h7M11.5 4.5h2" />
      <circle cx="10" cy="4.5" r="1.4" />
      <path d="M2.5 11.5h2M6.5 11.5h7" />
      <circle cx="5" cy="11.5" r="1.4" />
    </svg>
  );
}
function PlusGlyph({ size = 13, className }: GlyphProps) {
  return (
    <svg {...gp(size)} className={className} aria-hidden>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Shared primitives — corner ticks, traffic lights, state pip,
   bracketed segment control, inspector grammar (Section / KV / Pill).
   ════════════════════════════════════════════════════════════════════ */

function CornerTicks({
  color = "var(--studio-edge-strong)",
  gap = 5,
  len = 6,
  opacity = 1,
}: { color?: string; gap?: number; len?: number; opacity?: number }) {
  const base: React.CSSProperties = {
    position: "absolute",
    width: len,
    height: len,
    borderColor: color,
    opacity,
    pointerEvents: "none",
  };
  return (
    <>
      <span style={{ ...base, top: gap, left: gap, borderTop: "1px solid", borderLeft: "1px solid" }} />
      <span style={{ ...base, top: gap, right: gap, borderTop: "1px solid", borderRight: "1px solid" }} />
      <span style={{ ...base, bottom: gap, left: gap, borderBottom: "1px solid", borderLeft: "1px solid" }} />
      <span style={{ ...base, bottom: gap, right: gap, borderBottom: "1px solid", borderRight: "1px solid" }} />
    </>
  );
}

function TrafficLights() {
  const dot = "h-[11px] w-[11px] rounded-full";
  return (
    <div className="flex items-center gap-2">
      <span className={dot} style={{ background: "oklch(0.68 0.17 25)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.25)" }} />
      <span className={dot} style={{ background: "oklch(0.82 0.13 85)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.25)" }} />
      <span className={dot} style={{ background: "oklch(0.78 0.16 145)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.25)" }} />
    </div>
  );
}

function StatePip({ state, size = 7 }: { state: string; size?: number }) {
  const tint = STATE_TINT[state] ?? "var(--studio-ink-faint)";
  const glow = state === "working" || state === "available";
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        background: tint,
        boxShadow: glow ? `0 0 0 3px color-mix(in oklab, ${tint} 22%, transparent)` : undefined,
      }}
    />
  );
}

function Segments({ items, active }: { items: string[]; active: string }) {
  return (
    <div className="flex items-center gap-1">
      {items.map((it) => {
        const on = it === active;
        return (
          <span
            key={it}
            className="font-mono text-[10px] uppercase tracking-[0.13em] px-1.5 py-[3px] rounded-[5px] inline-flex items-center gap-1"
            style={
              on
                ? { color: "var(--scout-accent)", ...GLASS_RAISED }
                : { color: "var(--studio-ink-muted)" }
            }
          >
            {on && <span style={{ color: "var(--scout-accent)", opacity: 0.7 }}>⌜</span>}
            {it}
            {on && <span style={{ color: "var(--scout-accent)", opacity: 0.7 }}>⌝</span>}
          </span>
        );
      })}
    </div>
  );
}

function Section({ title, children, ticks }: { title: string; children: React.ReactNode; ticks?: boolean }) {
  return (
    <div className="relative rounded-lg px-3 py-2.5" style={GLASS_PANEL}>
      {ticks && <CornerTicks gap={4} len={5} opacity={0.6} />}
      <EyebrowLabel size="xs" className="!text-studio-ink-muted mb-2">{title}</EyebrowLabel>
      <div className="space-y-[5px]">{children}</div>
    </div>
  );
}

function KV({ k, v, tint }: { k: string; v: React.ReactNode; tint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-studio-ink-faint">{k}</span>
      <span className="font-mono text-[11px] text-studio-ink tabular-nums text-right" style={tint ? { color: tint } : undefined}>{v}</span>
    </div>
  );
}

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "accent" | "amber" | "info" }) {
  const tones: Record<string, React.CSSProperties> = {
    neutral: { color: "var(--studio-ink-muted)", border: "1px solid var(--studio-edge)" },
    accent: { color: "var(--scout-accent)", border: "1px solid color-mix(in oklab, var(--scout-accent) 45%, transparent)", background: "var(--scout-accent-soft)" },
    amber: { color: "oklch(0.84 0.15 75)", border: "1px solid color-mix(in oklab, oklch(0.84 0.15 75) 40%, transparent)", background: "oklch(0.84 0.15 75 / 0.14)" },
    info: { color: "oklch(0.82 0.10 220)", border: "1px solid color-mix(in oklab, oklch(0.82 0.10 220) 40%, transparent)", background: "oklch(0.82 0.10 220 / 0.14)" },
  };
  return (
    <span className="font-mono text-[9px] uppercase tracking-[0.1em] px-1.5 py-[2px] rounded-[4px] inline-flex items-center gap-1" style={tones[tone]}>
      {children}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Window chrome — titlebar · nav rail · body · status bar.
   ════════════════════════════════════════════════════════════════════ */

type SectionId = "comms" | "agents" | "tail" | "repos";
const NAV: { id: SectionId; label: string; Glyph: (p: GlyphProps) => React.ReactNode }[] = [
  { id: "comms", label: "Comms", Glyph: CommsGlyph },
  { id: "agents", label: "Agents", Glyph: AgentsGlyph },
  { id: "tail", label: "Tail", Glyph: TailGlyph },
  { id: "repos", label: "Repos", Glyph: ReposGlyph },
];

function NavRail({ active }: { active: SectionId }) {
  return (
    <div
      className="flex flex-col items-center gap-1.5 py-3 px-2 shrink-0"
      style={{ width: 56, background: "color-mix(in oklab, var(--studio-canvas) 55%, transparent)", borderRight: "1px solid var(--studio-edge)" }}
    >
      {NAV.map(({ id, label, Glyph }) => {
        const on = id === active;
        return (
          <div key={id} className="relative flex h-9 w-9 items-center justify-center rounded-[9px]" style={on ? GLASS_RAISED : undefined} title={label}>
            {on && <span className="absolute left-[-8px] top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full" style={{ background: "var(--scout-accent)" }} />}
            <span style={{ color: on ? "var(--scout-accent)" : "var(--studio-ink-muted)" }}>
              <Glyph size={18} />
            </span>
          </div>
        );
      })}
      <div className="mt-auto flex h-9 w-9 items-center justify-center rounded-[9px]" style={{ color: "var(--studio-ink-faint)" }} title="Settings">
        <SettingsGlyph size={18} />
      </div>
    </div>
  );
}

function AppWindow({
  active,
  title,
  badge,
  children,
}: {
  active: SectionId;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-[14px]" style={GLASS_WINDOW}>
      {/* Titlebar */}
      <div className="flex items-center gap-3 px-3.5 h-[42px]" style={{ borderBottom: "1px solid var(--studio-edge)" }}>
        <TrafficLights />
        <div className="flex items-baseline gap-2 ml-1">
          <span className="font-mono text-[11px] tracking-[0.04em] text-studio-ink font-semibold">Scout</span>
          <span className="text-studio-ink-faint text-[11px]">—</span>
          <span className="font-mono text-[11px] tracking-[0.06em] text-studio-ink-muted uppercase">{title}</span>
        </div>
        <div className="ml-auto">{badge}</div>
      </div>
      {/* Body */}
      <div className="flex" style={{ height: 408 }}>
        <NavRail active={active} />
        <div className="flex-1 min-w-0 flex flex-col">{children}</div>
      </div>
    </div>
  );
}

function StatusBar({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3.5 h-[26px] mt-auto" style={{ borderTop: "1px solid var(--studio-edge)", background: "color-mix(in oklab, var(--studio-canvas) 40%, transparent)" }}>
      <span className="font-mono text-[9.5px] tracking-[0.08em] text-studio-ink-faint uppercase">{left}</span>
      <span className="ml-auto font-mono text-[9.5px] tracking-[0.08em] text-studio-ink-faint uppercase">{right}</span>
    </div>
  );
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 h-[38px] shrink-0" style={{ borderBottom: "1px solid var(--studio-edge)" }}>
      {children}
    </div>
  );
}

function NewButton({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[7px] px-2 py-[5px] font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--scout-accent)", ...GLASS_RAISED }}>
      <PlusGlyph size={12} />
      {label}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════════
   §1 — Comms
   ════════════════════════════════════════════════════════════════════ */

type Conv = { name: string; preview: string; time: string; unread: number; state: string; ask: null | "pending" | "answered" };
const NOW: Conv[] = [
  { name: "Dewey", preview: "Great breakdown. Take both — and surface the active theme…", time: "2m", unread: 2, state: "working", ask: null },
  { name: "Hudson", preview: "On it. Moved resolveStartupTheme() ahead of the composer…", time: "8m", unread: 0, state: "available", ask: "answered" },
  { name: "Scout · iOS pairing", preview: "QR handoff from iOS. Awaiting the second-device scan.", time: "11m", unread: 1, state: "needs-attention", ask: "pending" },
];
const TODAY: Conv[] = [
  { name: "Atlas", preview: "Dropped the iconography study. Want to walk through it?", time: "22m", unread: 0, state: "available", ask: null },
  { name: "Preframe", preview: "Today's standup is in 5m — I'll bring up the worktree map.", time: "1h", unread: 0, state: "idle", ask: null },
];
const EARLIER: Conv[] = [
  { name: "Lattices", preview: "Pushed a fix for the new-conversation footer button.", time: "1d", unread: 0, state: "offline", ask: null },
];

function ConvRow({ c, selected }: { c: Conv; selected?: boolean }) {
  return (
    <div className="relative flex items-start gap-2.5 rounded-[8px] px-2.5 py-2" style={selected ? GLASS_RAISED : undefined}>
      <span className="mt-[3px]"><StatePip state={c.state} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-[12px] text-studio-ink truncate">{c.name}</span>
          {c.ask === "pending" && <Pill tone="amber">ask</Pill>}
          {c.ask === "answered" && <Pill tone="accent">✓ ask</Pill>}
          <span className="ml-auto font-mono text-[10px] text-studio-ink-faint tabular-nums">{c.time}</span>
          {c.unread > 0 && (
            <span className="font-mono text-[9px] tabular-nums rounded-full px-1.5 py-[1px]" style={{ color: "var(--studio-canvas)", background: "var(--scout-accent)" }}>{c.unread}</span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-studio-ink-muted line-clamp-1">{c.preview}</p>
      </div>
    </div>
  );
}

function CommsWindow() {
  return (
    <AppWindow active="comms" title="Comms" badge={<NewButton label="New" />}>
      <div className="flex flex-1 min-h-0">
        {/* List */}
        <div className="flex flex-col" style={{ width: 268, borderRight: "1px solid var(--studio-edge)" }}>
          <Toolbar>
            <Segments items={["All", "Asks", "Unread"]} active="All" />
          </Toolbar>
          <div className="flex-1 overflow-hidden px-2 py-2 space-y-3">
            <div>
              <EyebrowLabel size="xs" className="!text-studio-ink-faint px-1.5 mb-1">Now</EyebrowLabel>
              <ConvRow c={NOW[0]} selected />
              <ConvRow c={NOW[1]} />
              <ConvRow c={NOW[2]} />
            </div>
            <div>
              <EyebrowLabel size="xs" className="!text-studio-ink-faint px-1.5 mb-1">Today</EyebrowLabel>
              {TODAY.map((c) => <ConvRow key={c.name} c={c} />)}
            </div>
            <div>
              <EyebrowLabel size="xs" className="!text-studio-ink-faint px-1.5 mb-1">Earlier</EyebrowLabel>
              {EARLIER.map((c) => <ConvRow key={c.name} c={c} />)}
            </div>
          </div>
        </div>
        {/* Thread */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-2.5 px-4 h-[44px] shrink-0" style={{ borderBottom: "1px solid var(--studio-edge)" }}>
            <StatePip state="working" size={8} />
            <div>
              <div className="text-[12.5px] font-semibold text-studio-ink leading-none">Dewey</div>
              <div className="font-mono text-[9.5px] text-studio-ink-faint mt-1">~/dev/dewey · channel</div>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <Pill>Observe</Pill>
              <Pill tone="accent">Message</Pill>
            </div>
          </div>
          <div className="flex-1 overflow-hidden px-4 py-3.5 space-y-3">
            {/* reply-context backlink — the headline feature */}
            <div className="flex items-center gap-2 rounded-[7px] px-2.5 py-1.5 w-fit" style={GLASS_PANEL}>
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-studio-ink-faint">reply ▸</span>
              <span className="text-[11px] text-studio-ink">surface active theme in inspector</span>
              <Pill tone="accent">done</Pill>
            </div>
            <Bubble who="them">Great breakdown. Take both — and surface the active theme in the inspector while you're in the view layer.</Bubble>
            <Bubble who="me">On it. I'll thread it through <span className="font-mono text-[10.5px] text-studio-ink">resolveStartupTheme()</span> and land the inspector chip in the same pass.</Bubble>
          </div>
          <div className="px-4 pb-3 pt-1 shrink-0">
            <div className="rounded-[9px] px-3 py-2 flex items-center" style={GLASS_PANEL}>
              <span className="text-[11px] text-studio-ink-faint">Message Dewey…</span>
              <span className="ml-auto font-mono text-[9px] text-studio-ink-faint uppercase tracking-[0.1em]">⌘↵</span>
            </div>
          </div>
        </div>
        {/* Inspector */}
        <div className="shrink-0 flex flex-col gap-2.5 px-2.5 py-2.5" style={{ width: 196, borderLeft: "1px solid var(--studio-edge)", background: "color-mix(in oklab, var(--studio-canvas) 30%, transparent)" }}>
          <Section title="Conversation" ticks>
            <KV k="Last" v="2m ago" />
            <KV k="Unread" v="2" tint="var(--scout-accent)" />
            <KV k="Channel" v="DM" />
          </Section>
          <Section title="Project">
            <KV k="Repo" v="dewey" />
            <KV k="Branch" v="main" />
          </Section>
          <Section title="Ask">
            <div className="flex items-center gap-1.5"><Pill tone="amber">pending</Pill><span className="text-[10.5px] text-studio-ink-muted">from Scout</span></div>
            <p className="text-[11px] leading-snug text-studio-ink mt-0.5">Confirm the second-device scan to finish pairing.</p>
          </Section>
        </div>
      </div>
      <StatusBar left="24 conversations · 3 unread" right="broker online" />
    </AppWindow>
  );
}

function Bubble({ who, children }: { who: "me" | "them"; children: React.ReactNode }) {
  const me = who === "me";
  return (
    <div className={me ? "flex justify-end" : "flex justify-start"}>
      <div
        className="max-w-[78%] rounded-[11px] px-3 py-2 text-[12px] leading-snug"
        style={
          me
            ? { color: "var(--studio-canvas)", background: "var(--scout-accent)", boxShadow: "0 6px 16px -8px color-mix(in oklab, var(--scout-accent) 60%, transparent)" }
            : { color: "var(--studio-ink)", ...GLASS_RAISED }
        }
      >
        {children}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   §2 — Agents
   ════════════════════════════════════════════════════════════════════ */

type AgentRow = { name: string; role: string; harness?: string; transport?: string; updated: string; state: string };
type AgentGroup = { project: string; path?: string; count: number; agents: AgentRow[] };
const AGENT_GROUPS: AgentGroup[] = [
  { project: "Action", path: "~/dev/action", count: 1, agents: [{ name: "Action", role: "Relay agent", harness: "claude", transport: "stream-json", updated: "1d", state: "available" }] },
  { project: "Hudson", path: "~/dev/hudson", count: 4, agents: [
    { name: "Grok Hudson", role: "Relay agent", harness: "pi", transport: "pi-rpc", updated: "1d", state: "available" },
    { name: "Hudson", role: "Relay agent", harness: "claude", transport: "stream-json", updated: "1d", state: "working" },
  ] },
  { project: "Openscout", path: "~/dev/openscout", count: 9, agents: [
    { name: "Claude", role: "Relay agent", harness: "claude", transport: "tmux", updated: "10h", state: "working" },
    { name: "Scout", role: "Relay agent", harness: "claude", transport: "tmux", updated: "1d", state: "available" },
  ] },
  { project: "Lattices", path: "~/dev/lattices", count: 1, agents: [{ name: "Lattices", role: "Relay agent", harness: "claude", transport: "stream-json", updated: "1d", state: "offline" }] },
];

function AgentsWindow() {
  return (
    <AppWindow active="agents" title="Agents" badge={<NewButton label="Spin up" />}>
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-w-0">
          <Toolbar>
            <Segments items={["All", "Working", "Idle"]} active="All" />
            <span className="ml-auto font-mono text-[10px] text-studio-ink-faint uppercase tracking-[0.1em]">24 · 22 idle</span>
          </Toolbar>
          <div className="flex-1 overflow-hidden px-2.5 py-2 space-y-3">
            {AGENT_GROUPS.map((g, gi) => (
              <div key={g.project}>
                <div className="flex items-center gap-2 px-1 mb-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-studio-ink-muted">{g.project}</span>
                  {g.path && <span className="font-mono text-[9.5px] text-studio-ink-faint">{g.path}</span>}
                  <span className="ml-auto font-mono text-[9px] text-studio-ink-faint rounded-full px-1.5 py-[1px]" style={{ border: "1px solid var(--studio-edge)" }}>{g.count}</span>
                </div>
                {g.agents.map((a, ai) => (
                  <div key={a.name + ai} className="relative flex items-center gap-2.5 rounded-[8px] px-2.5 py-[7px]" style={gi === 0 && ai === 0 ? GLASS_RAISED : undefined}>
                    <StatePip state={a.state} />
                    <span className="text-[12px] text-studio-ink font-medium">{a.name}</span>
                    <span className="text-[10.5px] text-studio-ink-faint">{a.role}</span>
                    {a.harness && <Pill>{a.harness}</Pill>}
                    <span className="ml-auto font-mono text-[10px] text-studio-ink-faint tabular-nums">{a.updated}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        {/* Inspector — agent dossier */}
        <div className="shrink-0 flex flex-col gap-2.5 px-2.5 py-2.5" style={{ width: 220, borderLeft: "1px solid var(--studio-edge)", background: "color-mix(in oklab, var(--studio-canvas) 30%, transparent)" }}>
          <div className="flex items-center gap-2.5 px-1">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] font-semibold text-[13px] text-studio-ink" style={GLASS_RAISED}>A</span>
            <div>
              <div className="text-[13px] font-semibold text-studio-ink leading-none">Action</div>
              <div className="mt-1 flex items-center gap-1.5"><StatePip state="available" size={6} /><span className="font-mono text-[9.5px] text-studio-ink-muted uppercase tracking-[0.08em]">available</span></div>
            </div>
          </div>
          <Section title="Runtime" ticks>
            <KV k="Harness" v="claude" />
            <KV k="Transport" v="stream-json" />
            <KV k="Model" v="opus-4.8" />
          </Section>
          <Section title="Project">
            <KV k="Repo" v="action" />
            <KV k="Path" v="~/dev/action" />
          </Section>
          <Section title="Activity">
            <KV k="Last seen" v="1d ago" />
            <KV k="Sessions" v="3" />
          </Section>
        </div>
      </div>
      <StatusBar left="24 agents · 6 projects" right="2 working" />
    </AppWindow>
  );
}

/* ════════════════════════════════════════════════════════════════════
   §3 — Tail
   ════════════════════════════════════════════════════════════════════ */

type TailKind = "SYS" | "ASST" | "TOOL" | "OUT";
const TAIL_KIND: Record<TailKind, "info" | "accent" | "amber" | "neutral"> = { SYS: "info", ASST: "accent", TOOL: "amber", OUT: "neutral" };
type TailRow = { time: string; name: string; shortId: string; pid: string; kind: TailKind; msg: string };
const TAIL_ROWS: TailRow[] = [
  { time: "00:01:07", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "ASST", msg: "Both builds succeeded. I'm relaunching TalkieA…" },
  { time: "00:01:10", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "TOOL", msg: 'exec_command({"cmd":"./run.sh TalkieAgent Talk…"})' },
  { time: "00:01:14", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "OUT", msg: "→ Chunk ID: 51697a · Wall time: 4.0798s…" },
  { time: "00:01:14", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS", msg: "tokens · 12621726" },
  { time: "00:01:31", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "ASST", msg: "The relaunch completed; the agent signing step…" },
  { time: "00:01:31", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "TOOL", msg: 'exec_command({"cmd":"pgrep -fl \\"TalkieAgent\\""})' },
  { time: "00:01:42", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "ASST", msg: "Both processes are running again and the final…" },
  { time: "00:01:42", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "TOOL", msg: 'exec_command({"cmd":"git status --short -- app…"})' },
  { time: "00:01:42", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "OUT", msg: "→ Chunk ID: 2dcbb4 · Wall time: 0.0000s…" },
  { time: "00:01:55", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "ASST", msg: "Done. I tightened the selector geometry and qu…" },
  { time: "00:01:55", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS", msg: "task complete" },
];

function TailWindow() {
  return (
    <AppWindow active="tail" title="Tail" badge={<span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-studio-ink-muted"><StatePip state="working" size={6} />live</span>}>
      <Toolbar>
        <Segments items={["All", "Asst", "Tool"]} active="All" />
        <div className="ml-auto flex items-center gap-1.5">
          <Pill tone="info">codex</Pill>
          <Pill>native</Pill>
          <span className="font-mono text-[10px] text-studio-ink-faint">talkie · 4894</span>
        </div>
      </Toolbar>
      <div className="flex-1 overflow-hidden">
        <div className="grid" style={{ gridTemplateColumns: "62px 52px 1fr" }}>
          {TAIL_ROWS.map((r, i) => {
            const zebra = i % 2 === 1;
            return (
              <div key={i} className="contents">
                <div className="font-mono text-[9.5px] text-studio-ink-faint tabular-nums px-3 py-[5px]" style={{ background: zebra ? "color-mix(in oklab, var(--studio-ink) 3%, transparent)" : undefined }}>{r.time}</div>
                <div className="px-1 py-[5px] flex items-start" style={{ background: zebra ? "color-mix(in oklab, var(--studio-ink) 3%, transparent)" : undefined }}>
                  <Pill tone={TAIL_KIND[r.kind]}>{r.kind}</Pill>
                </div>
                <div className="font-mono text-[10.5px] text-studio-ink-muted px-3 py-[5px] truncate" style={{ background: zebra ? "color-mix(in oklab, var(--studio-ink) 3%, transparent)" : undefined }}>{r.msg}</div>
              </div>
            );
          })}
        </div>
      </div>
      <StatusBar left="1 stream · talkie" right="codex · native · 019eb9da" />
    </AppWindow>
  );
}

/* ════════════════════════════════════════════════════════════════════
   §4 — Repos
   ════════════════════════════════════════════════════════════════════ */

type Worktree = { branch: string; add: number | null; del: number | null; files: number | null; drift: number | null; agents: string | null; highlight?: boolean };
type Repo = { name: string; path: string; agents: number; state: "attention" | "ok"; worktrees: Worktree[]; selected?: boolean };
const REPOS: Repo[] = [
  { name: "action", path: "~/dev/action", agents: 1, state: "attention", selected: true, worktrees: [{ branch: "codex/polished-mira-demo", add: 284, del: 39, files: 27, drift: 21, agents: "@action", highlight: true }] },
  { name: "hudson", path: "~/dev/hudson", agents: 6, state: "attention", worktrees: [
    { branch: "feat/hud-markdown-renderer", add: 239, del: 57, files: 24, drift: 35, agents: "@hudson @grok-hudson +2", highlight: true },
    { branch: "main", add: null, del: null, files: null, drift: -47, agents: null },
  ] },
  { name: "openscout", path: "~/dev/openscout", agents: 183, state: "attention", worktrees: [{ branch: "feat/scout-ios-lan-pairing", add: 1534, del: 1810, files: 42, drift: null, agents: "@scout @claude +26" }] },
  { name: "dewey", path: "~/dev/dewey", agents: 1, state: "ok", worktrees: [{ branch: "main", add: null, del: null, files: null, drift: null, agents: "@dewey" }] },
];

function DriftBar({ value }: { value: number | null }) {
  if (value === null) return <span className="font-mono text-[9px] text-studio-ink-faint">—</span>;
  const pct = Math.min(100, (Math.abs(value) / 50) * 100);
  const color = value < 0 ? "oklch(0.72 0.17 25)" : "oklch(0.84 0.15 75)";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="block h-[3px] rounded-[1px]" style={{ width: `${Math.max(pct, 10)}%`, maxWidth: 30, background: color }} />
      <span className="font-mono text-[9px] tabular-nums" style={{ color }}>{value > 0 ? `+${value}` : value}</span>
    </span>
  );
}

function ReposWindow() {
  return (
    <AppWindow active="repos" title="Repos" badge={<span className="font-mono text-[10px] uppercase tracking-[0.1em] text-studio-ink-muted">10 repos</span>}>
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-w-0">
          <Toolbar>
            <Segments items={["All", "Attention", "Drift"]} active="Attention" />
          </Toolbar>
          <div className="flex-1 overflow-hidden px-2.5 py-2 space-y-1.5">
            {REPOS.map((repo) => (
              <div key={repo.name} className="relative rounded-[9px] px-2.5 py-2" style={repo.selected ? GLASS_RAISED : GLASS_PANEL}>
                {repo.selected && <CornerTicks gap={4} len={5} opacity={0.5} />}
                <div className="flex items-center gap-2">
                  <StatePip state={repo.state === "attention" ? "needs-attention" : "available"} size={6} />
                  <span className="text-[12px] font-semibold text-studio-ink">{repo.name}</span>
                  <span className="font-mono text-[9.5px] text-studio-ink-faint">{repo.path}</span>
                  <span className="ml-auto font-mono text-[9px] text-studio-ink-faint">{repo.agents} {repo.agents === 1 ? "idle" : "agents"}</span>
                </div>
                <div className="mt-1.5 space-y-[3px]">
                  {repo.worktrees.map((w, wi) => (
                    <div key={wi} className="flex items-center gap-2 pl-3.5">
                      <span className="font-mono text-[10.5px] truncate flex-1" style={{ color: w.highlight ? "oklch(0.86 0.13 75)" : "var(--studio-ink-muted)" }}>{w.branch}</span>
                      {w.add !== null && <span className="font-mono text-[9px] tabular-nums" style={{ color: "oklch(0.78 0.14 145)" }}>+{w.add}</span>}
                      {w.del !== null && <span className="font-mono text-[9px] tabular-nums" style={{ color: "oklch(0.72 0.16 25)" }}>−{w.del}</span>}
                      <DriftBar value={w.drift} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Inspector — repo detail */}
        <div className="shrink-0 flex flex-col gap-2.5 px-2.5 py-2.5" style={{ width: 210, borderLeft: "1px solid var(--studio-edge)", background: "color-mix(in oklab, var(--studio-canvas) 30%, transparent)" }}>
          <div className="px-1">
            <div className="text-[13px] font-semibold text-studio-ink">action</div>
            <div className="font-mono text-[9.5px] text-studio-ink-faint mt-0.5">~/dev/action</div>
          </div>
          <Section title="Worktree" ticks>
            <KV k="Branch" v="codex/polished…" />
            <KV k="Files" v="27" />
            <KV k="Diff" v={<span><span style={{ color: "oklch(0.78 0.14 145)" }}>+284</span> <span style={{ color: "oklch(0.72 0.16 25)" }}>−39</span></span>} />
            <KV k="Drift" v="+21 ahead" tint="oklch(0.84 0.15 75)" />
          </Section>
          <Section title="Agents">
            <div className="flex items-center gap-1.5"><StatePip state="available" size={6} /><span className="text-[11px] text-studio-ink">@action</span></div>
          </Section>
          <div className="mt-auto flex gap-1.5">
            <Pill tone="accent">Open</Pill>
            <Pill>Diff</Pill>
            <Pill>Pull</Pill>
          </div>
        </div>
      </div>
      <StatusBar left="10 repos · 7 need attention" right="198 agents" />
    </AppWindow>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Page
   ════════════════════════════════════════════════════════════════════ */

const PAGES: { id: SectionId; label: string; role: string; Window: () => React.ReactNode }[] = [
  { id: "comms", label: "Comms", role: "list · thread · inspector — the agent conversation surface", Window: CommsWindow },
  { id: "agents", label: "Agents", role: "project-grouped roster with an agent dossier inspector", Window: AgentsWindow },
  { id: "tail", label: "Tail", role: "the live event firehose across every running agent", Window: TailWindow },
  { id: "repos", label: "Repos", role: "worktrees, drift, and which agents hold each branch", Window: ReposWindow },
];

export default function ScoutMacOSElevated() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Ambient depth — soft accent glow for the frosted panels to refract */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute -top-40 left-1/4 h-[420px] w-[520px] rounded-full" style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--scout-accent) 14%, transparent), transparent)", filter: "blur(40px)" }} />
        <div className="absolute top-1/3 right-[8%] h-[360px] w-[420px] rounded-full" style={{ background: "radial-gradient(closest-side, oklch(0.6 0.12 250 / 0.16), transparent)", filter: "blur(48px)" }} />
      </div>

      <div className="mx-auto max-w-[1140px] px-6 py-10">
        {/* Header */}
        <header className="mb-10">
          <EyebrowLabel className="mb-3">Studies · macOS · Elevated</EyebrowLabel>
          <h1 className="text-[30px] font-semibold tracking-tight text-studio-ink leading-none">Scout macOS · Elevated</h1>
          <p className="mt-3 max-w-[64ch] text-[13.5px] leading-relaxed text-studio-ink-muted">
            The four core screens — <span className="text-studio-ink">Comms · Agents · Tail · Repos</span> — brought into one
            elevated frame. The ScoutNext elegant language applied to the desktop shell: frosted-raised surfaces with real
            depth, corner ticks, bracketed controls, hand-drawn glyphs, and ink-strong type. Content mirrors the live app
            today; the treatment is the proposal. This is the canvas we iterate on.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Pill tone="accent">concept</Pill>
            <Pill>frosted depth</Pill>
            <Pill>4 screens · 1 shell</Pill>
            <span className="font-mono text-[10px] text-studio-ink-faint">baseline → scout-macos-shell · comms → scout-macos-refresh</span>
          </div>
        </header>

        {/* Four windows */}
        <div className="space-y-12">
          {PAGES.map(({ id, label, role, Window }) => (
            <section key={id}>
              <div className="mb-3 flex items-baseline gap-3">
                <EyebrowLabel size="md" tone="ink" as="h2">{label}</EyebrowLabel>
                <span className="text-[12px] text-studio-ink-faint">{role}</span>
              </div>
              <Window />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
