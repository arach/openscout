"use client";

/**
 * Comms Mobile — study.
 *
 * Iteration 3. Direction settled: no avatar, lean toward single-line, and
 * stop shouting in green. Three refinements this pass:
 *
 *   1. One list, implicit split. Channels and DMs no longer live under their
 *      own headers in two stacked lists. They interleave by recency in a single
 *      feed; a muted "#" is the only thing that says "channel." Keeps the door
 *      open for a unified, recency-sorted inbox later without a structural redo.
 *
 *   2. Less green. The accent was doing five jobs at once (row wash, glow, green
 *      timestamp, count pill, channel #). Now it does one: the unread count.
 *      Standout comes from a brightness ladder (near-white titles) and a faint
 *      *neutral* lift on unread rows — not a field of green light.
 *
 *   3. Strip our own gibberish. Agent transcripts carry machine signatures —
 *      "[ask:f-mpyn6fet]" task ids and the like. Those get cleaned out of the
 *      preview so the row shows the human sentence, not the routing envelope.
 *
 * Source of truth for the live surface: apps/ios/ScoutNext/CommsSurface.swift.
 */

import { useEffect, useState } from "react";

type Kind = "channel" | "dm";

interface Convo {
  kind: Kind;
  title: string;
  author?: string; // last-message author label ("You", agent name)
  preview: string;
  age: string;
  unread?: number;
}

/* One feed, interleaved by recency — channels and DMs share the list. */
const CONVOS: Convo[] = [
  { kind: "channel", title: "voice", author: "tail-tuner", preview: "Parakeet warm-up no longer cancels on thread exit", age: "40m", unread: 4 },
  { kind: "dm", title: "Talkie", author: "Talkie", preview: "[ask:f-mpyn6fet] Reviewed tlk-027 against current snap math…", age: "16h", unread: 2 },
  { kind: "dm", title: "Hudson Voice Codex", author: "Hudson Voice Codex", preview: "Using the Hudson agent-action wrapper to gate the geometry pass", age: "19h" },
  { kind: "dm", title: "Hudson", author: "Hudson", preview: "Everything is verified end-to-end. Cleaning up — the handoff note", age: "1d", unread: 1 },
  { kind: "channel", title: "font-studio", author: "Narrative Studio", preview: "oh? say more — what's landing?", age: "1d" },
  { kind: "dm", title: "Sco061", author: "Sco061", preview: "Complete — inspected the doc and repo; no files modified", age: "1d" },
  { kind: "dm", title: "Oscodex", author: "You", preview: "Continue the OpenScout + HudsonKit SCO-061 native share work", age: "2d" },
  { kind: "dm", title: "Openscout Card", author: "Openscout Card", preview: "[ask:f-mpwqmar4] Shipped per the brief; verdict below", age: "2d" },
  { kind: "dm", title: "Sco-Web", author: "Sco-Web", preview: "Landing copy is in — pushed to the basel branch for review", age: "3d" },
  { kind: "channel", title: "ops", author: "broker", preview: "nightly snapshot compacted · 524 → 511 messages", age: "4d" },
];

/* Drop our own routing envelope — "[ask:f-…]" task ids, leading [tags]. */
function cleanPreview(s: string): string {
  return s.replace(/^\s*(\[[^\]]*\]\s*)+/, "").trim();
}

/* Last-speaker prefix, or null when it's just the DM counterpart talking. */
function speakerOf(c: Convo): string | null {
  return c.author && c.author !== c.title ? c.author : null;
}

export default function CommsMobileStudy() {
  return (
    <div className="px-6 py-6">
      <header className="mb-6 max-w-[70ch]">
        <h1 className="font-sans text-[19px] font-semibold tracking-tight text-studio-ink">
          Comms Mobile — one list, less green
        </h1>
        <p className="mt-1.5 font-sans text-[13px] leading-relaxed text-studio-ink-muted">
          No avatar; single-line by default. Channels and DMs fold into one
          recency feed — a muted <span className="font-mono">#</span> is the only
          tell, so the split is implicit, not two stacked lists. The accent stops
          doing five jobs and does one (the unread count); standout now comes from
          near-white titles and a faint neutral lift on unread rows. And our own
          machine signatures — <span className="font-mono">[ask:f-…]</span> task
          ids — are stripped from previews so the row reads as a sentence.
        </p>
      </header>

      <div className="flex flex-wrap items-start gap-7">
        <Labeled label="Card ship" sub="current · sectioned · ~7 / screen">
          <Phone><BeforeList /></Phone>
        </Labeled>

        <Labeled label="Single line" sub="proposed · ~18 / screen" accent>
          <Phone><CompactList /></Phone>
        </Labeled>

        <Labeled label="Two line" sub="roomier · ~13 / screen">
          <Phone><BareList /></Phone>
        </Labeled>
      </div>

      <SemanticGlyphSection />

      <Notes />
    </div>
  );
}

/* ───────────────────────── Phone shell ───────────────────────── */

function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-[290px] overflow-hidden rounded-[34px] border border-studio-edge-strong bg-black p-[6px] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)]">
      <div className="relative overflow-hidden rounded-[28px] bg-[#0a0a0a]">
        <StatusBar />
        <TitleBar />
        <SearchField />
        <div className="h-[470px] overflow-hidden">{children}</div>
        <TabBar />
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="flex items-center justify-between px-6 pt-2.5 pb-1 text-white">
      <span className="font-sans text-[13px] font-semibold tracking-tight">11:34</span>
      <span className="h-[18px] w-[78px] rounded-full bg-black" />
      <span className="flex items-center gap-1 opacity-90">
        <span className="text-[10px]">···</span>
        <span className="text-[11px]">📶</span>
        <span className="text-[11px]">🔋</span>
      </span>
    </div>
  );
}

function TitleBar() {
  return (
    <div className="flex items-center justify-between px-5 pt-3 pb-3">
      <div className="flex items-baseline gap-2">
        <span className="font-sans text-[20px] font-semibold tracking-tight text-white">Scout</span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--scout-accent)]">Next</span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="flex items-center gap-1 rounded-[5px] border border-[color-mix(in_oklab,var(--scout-accent)_40%,transparent)] px-1.5 py-[3px] font-mono text-[9px] font-semibold tracking-wide text-[var(--scout-accent)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--scout-accent)]" /> LAN
        </span>
        <span className="text-[14px] text-white/60">⚙</span>
      </div>
    </div>
  );
}

function SearchField() {
  return (
    <div className="px-4 pb-2">
      <div className="flex items-center gap-2 rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3 py-2">
        <span className="text-[12px] text-white/30">⌕</span>
        <span className="font-mono text-[12px] text-white/30">Search conversations</span>
      </div>
    </div>
  );
}

function TabBar() {
  const tabs = ["Home", "Agents", "Comms", "Terminal", "New"];
  return (
    <div className="flex items-center justify-around border-t border-white/[0.06] bg-white/[0.02] px-2 pt-2 pb-3">
      {tabs.map((label, i) => (
        <div key={label} className="flex flex-col items-center gap-1">
          <span
            className={[
              "grid h-6 w-10 place-items-center rounded-full text-[12px]",
              i === 2 ? "bg-[color-mix(in_oklab,var(--scout-accent)_18%,transparent)] text-[var(--scout-accent)]" : "text-white/45",
            ].join(" ")}
          >
            {["▦", "○", "▣", "›", "+"][i]}
          </span>
          <span className={["font-sans text-[9px]", i === 2 ? "text-white/85" : "text-white/45"].join(" ")}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ───────── Card ship (reference: two sectioned lists, avatar, gaps) ───────── */

function BeforeList() {
  const channels = CONVOS.filter((c) => c.kind === "channel");
  const dms = CONVOS.filter((c) => c.kind === "dm");
  return (
    <div className="space-y-2 px-3 pt-1">
      <Eyebrow>CHANNELS · 3</Eyebrow>
      {channels.slice(0, 2).map((c) => <BeforeCard key={c.title} c={c} />)}
      <Eyebrow className="pt-1">DIRECT MESSAGES · 84</Eyebrow>
      {dms.slice(0, 3).map((c) => <BeforeCard key={c.title} c={c} />)}
    </div>
  );
}

function BeforeCard({ c }: { c: Convo }) {
  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
      <AvatarGlyph c={c} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-sans text-[14px] font-semibold text-white">{c.title}</span>
          <span className="shrink-0 font-mono text-[10px] text-white/40">{c.age}</span>
        </div>
        <p className="truncate font-sans text-[12px] text-white/45">
          {speakerOf(c) ? `${speakerOf(c)}: ` : ""}{c.preview}
        </p>
      </div>
    </div>
  );
}

/* ───────────────── Single line — proposed (one list, implicit #) ───────────────── */

function CompactList() {
  return (
    <div className="pt-1">
      {CONVOS.map((c, i) => {
        const unread = !!c.unread;
        const speaker = speakerOf(c);
        return (
          <div
            key={c.title}
            className={["relative flex items-center gap-2 px-4 py-[7px]", unread ? "bg-white/[0.035]" : ""].join(" ")}
          >
            <span
              className={["shrink-0 truncate font-sans text-[13px] tracking-tight", unread ? "font-semibold text-white" : "font-medium text-white/85"].join(" ")}
              style={{ maxWidth: 116 }}
            >
              {c.kind === "channel" ? <span className="font-mono text-white/35">#&thinsp;</span> : null}
              {c.title}
            </span>
            <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-white/40">
              {speaker ? <span className="text-white/30">{speaker}: </span> : null}{cleanPreview(c.preview)}
            </span>
            <span className="shrink-0 font-mono text-[9px] text-white/35">{c.age}</span>
            {unread ? <CountPill n={c.unread!} /> : null}
            {i < CONVOS.length - 1 ? <span className="absolute bottom-0 right-0 left-4 h-px bg-white/[0.05]" /> : null}
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────── Two line — roomier (same rules, more breathing room) ───────────────── */

function BareList() {
  return (
    <div className="pt-1">
      {CONVOS.map((c, i) => <BareRow key={c.title} c={c} divider={i < CONVOS.length - 1} />)}
    </div>
  );
}

function BareRow({ c, divider }: { c: Convo; divider: boolean }) {
  const unread = !!c.unread;
  const speaker = speakerOf(c);
  return (
    <div className={["relative px-4 py-[7px]", unread ? "bg-white/[0.035]" : ""].join(" ")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={["truncate font-sans text-[14px] tracking-tight", unread ? "font-semibold text-white" : "font-medium text-white/90"].join(" ")}>
          {c.kind === "channel" ? <span className="font-mono text-white/35">#&thinsp;</span> : null}
          {c.title}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-white/35">{c.age}</span>
      </div>
      <div className="mt-[2px] flex items-center justify-between gap-2">
        <p className="truncate font-sans text-[12px] leading-snug text-white/42">
          {speaker ? <span className="text-white/30">{speaker}: </span> : null}{cleanPreview(c.preview)}
        </p>
        {unread ? <CountPill n={c.unread!} /> : null}
      </div>
      {divider ? <span className="absolute bottom-0 right-0 left-4 h-px bg-white/[0.05]" /> : null}
    </div>
  );
}

/* ───────────────────────── shared bits ───────────────────────── */

/* Deterministic muted tint (only the card-ship reference still uses an avatar). */
function tint(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `oklch(0.62 0.09 ${h})`;
}

function AvatarGlyph({ c }: { c: Convo }) {
  if (c.kind === "channel") {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/[0.07] font-mono text-[15px] font-bold text-white/45">
        #
      </span>
    );
  }
  return (
    <span
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-sans text-[14px] font-semibold"
      style={{ background: tint(c.title), color: "#0a0a0a" }}
    >
      {c.title[0]}
    </span>
  );
}

/* The one place green is allowed: an unread count. Quieter than before. */
function CountPill({ n }: { n: number }) {
  return (
    <span className="shrink-0 rounded-full bg-[color-mix(in_oklab,var(--scout-accent)_85%,#0a0a0a)] px-1.5 text-[9px] font-bold leading-[15px] text-black tabular-nums">
      {n}
    </span>
  );
}

function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={["pb-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-white/40", className].join(" ")}>
      {children}
    </div>
  );
}

function Labeled({
  label,
  sub,
  accent,
  children,
}: {
  label: string;
  sub: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-2">
        <span className={["font-sans text-[13px] font-semibold tracking-tight", accent ? "text-[var(--scout-accent)]" : "text-studio-ink"].join(" ")}>
          {label}
        </span>
        <span className="font-mono text-[10px] text-studio-ink-faint">{sub}</span>
      </div>
      {children}
    </div>
  );
}

/* ═══════════════════════ Semantic glyphs ═══════════════════════ */
/*
 * Two axes of meaning, drawn small:
 *   LEFT  — conversation TYPE: # channel · • dm · ••• group · ↳ thread · ✳ system
 *   RIGHT — live STATUS, re-encoding the gibberish we stripped:
 *           ⠹ working (animates) · … composing · ? needs you (was [ask:…]) ·
 *           › your turn · ✓ done. Only "needs you" / "working" take the accent.
 *
 * In the app these become hand-drawn SwiftUI Shapes + a TimelineView spinner —
 * not SF Symbols (cockpit aesthetic). This is the design intent.
 */

type GKind = "channel" | "dm" | "group" | "thread" | "system";
type GState = "working" | "thinking" | "ask" | "turn" | "done" | undefined;

interface SConvo {
  kind: GKind;
  title: string;
  preview: string;
  age: string;
  state?: GState;
  unread?: number;
}

const SEM: SConvo[] = [
  { kind: "channel", title: "voice", preview: "tail-tuner: Parakeet warm-up no longer cancels", age: "40m", state: "working", unread: 4 },
  { kind: "dm", title: "Talkie", preview: "Reviewed tlk-027 against current snap math…", age: "16h", state: "ask", unread: 2 },
  { kind: "thread", title: "Hudson Voice Codex", preview: "Hudson: handoff note for the iOS split", age: "19h", state: "thinking" },
  { kind: "dm", title: "Hudson", preview: "Everything is verified end-to-end. Cleaning up", age: "1d", state: "done" },
  { kind: "group", title: "openscout · hudson · sco061", preview: "broker: snapshot compacted · 524 → 511", age: "1d", state: "working" },
  { kind: "dm", title: "Oscodex", preview: "You: continue the HudsonKit native share work", age: "1d", state: "turn" },
  { kind: "system", title: "broker", preview: "nightly backup complete · 2 agents idle", age: "2d" },
  { kind: "dm", title: "Openscout Card", preview: "Shipped per the brief; verdict below", age: "2d", state: "ask" },
];

const SVG = {
  width: 15, height: 15, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

function TypeGlyph({ kind }: { kind: GKind }) {
  switch (kind) {
    case "channel":
      return (<svg {...SVG}><line x1="9.5" y1="4" x2="8" y2="20" /><line x1="16" y1="4" x2="14.5" y2="20" /><line x1="5" y1="9" x2="19" y2="9" /><line x1="4.5" y1="15" x2="18.5" y2="15" /></svg>);
    case "dm":
      return (<svg {...SVG}><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" /></svg>);
    case "group":
      return (<svg {...SVG}><circle cx="6" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="2" fill="currentColor" stroke="none" /></svg>);
    case "thread":
      return (<svg {...SVG}><path d="M8 5 v6 a3 3 0 0 0 3 3 h6" /><path d="M14 11 l3 3 l-3 3" /></svg>);
    case "system":
      return (<svg {...SVG}><line x1="12" y1="5" x2="12" y2="19" /><line x1="6.2" y1="8.5" x2="17.8" y2="15.5" /><line x1="17.8" y1="8.5" x2="6.2" y2="15.5" /></svg>);
  }
}

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function BrailleSpinner() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % BRAILLE.length), 90);
    return () => clearInterval(t);
  }, []);
  return <span className="font-mono">{BRAILLE[i]}</span>;
}

function ThinkingDots() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setN((v) => (v % 3) + 1), 420);
    return () => clearInterval(t);
  }, []);
  return <span className="font-mono tracking-tight">{".".repeat(n)}</span>;
}

function StatusGlyph({ state }: { state: GState }) {
  switch (state) {
    case "working": return <span className="text-[var(--scout-accent)]"><BrailleSpinner /></span>;
    case "thinking": return <span className="text-white/55"><ThinkingDots /></span>;
    case "ask": return <span className="font-mono font-bold text-[var(--scout-accent)]">?</span>;
    case "turn": return <span className="font-mono text-white/45">›</span>;
    case "done": return <span className="font-mono text-white/35">✓</span>;
    default: return null;
  }
}

function SemanticGlyphSection() {
  return (
    <section className="mt-9">
      <div className="mb-4 max-w-[68ch]">
        <h2 className="font-sans text-[15px] font-semibold tracking-tight text-studio-ink">
          Semantic glyphs — type + live status
        </h2>
        <p className="mt-1 font-sans text-[12.5px] leading-relaxed text-studio-ink-muted">
          Two axes, drawn small. Left = what kind of conversation (the dot count
          for dm→group even reads as headcount). Right = live status, which
          re-encodes the <span className="font-mono">[ask:f-…]</span> token we
          stripped into a clean <span className="font-mono">?</span>, plus a
          braille spinner for an agent that's working <em>right now</em>. Glyphs
          earn their space here where an avatar didn't: they carry meaning, not
          identity. Only "needs you" and "working" take the accent.
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-8">
        <Labeled label="Indicator as separator" sub="status splits name · detail" accent>
          <Phone><SepList /></Phone>
        </Labeled>
        <Labeled label="Status at trailing edge" sub="status by the timestamp">
          <Phone><SemList /></Phone>
        </Labeled>
        <GlyphLegend />
      </div>
    </section>
  );
}

/* Placement variant: the indicator sits BETWEEN the name and the detail — it
 * separates them AND says what kind the detail is. With no status, a faint
 * middot keeps the same rhythm so the columns never wobble. */
function SepList() {
  return (
    <div className="pt-1">
      {SEM.map((c, i) => (
        <div key={c.title} className={["relative flex items-center gap-2.5 px-4 py-[9px]", c.unread ? "bg-white/[0.035]" : ""].join(" ")}>
          <span className="grid h-[15px] w-[15px] shrink-0 place-items-center text-white/40">
            <TypeGlyph kind={c.kind} />
          </span>
          <span className="shrink-0 truncate font-sans text-[14px] font-medium tracking-tight text-white" style={{ maxWidth: 118 }}>
            {c.title}
          </span>
          <span className="grid w-[18px] shrink-0 place-items-center text-[12px] leading-none">
            <SepGlyph state={c.state} />
          </span>
          <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-white/45">{c.preview}</span>
          <span className="shrink-0 font-mono text-[10px] text-white/35">{c.age}</span>
          {i < SEM.length - 1 ? <span className="absolute bottom-0 right-0 left-[42px] h-px bg-white/[0.05]" /> : null}
        </div>
      ))}
    </div>
  );
}

/* The separator: a real status glyph when there's something to say, else a
 * faint middot so the name | detail split stays legible. */
function SepGlyph({ state }: { state: GState }) {
  if (!state) return <span className="font-mono text-white/20">·</span>;
  return <StatusGlyph state={state} />;
}

function SemList() {
  return (
    <div className="pt-1">
      {SEM.map((c, i) => (
        <div key={c.title} className={["relative flex items-center gap-2.5 px-4 py-[9px]", c.unread ? "bg-white/[0.035]" : ""].join(" ")}>
          <span className="grid h-[15px] w-[15px] shrink-0 place-items-center text-white/40">
            <TypeGlyph kind={c.kind} />
          </span>
          <span className="shrink-0 truncate font-sans text-[14px] font-medium tracking-tight text-white" style={{ maxWidth: 116 }}>
            {c.title}
          </span>
          <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-white/45">{c.preview}</span>
          <span className="grid w-4 shrink-0 place-items-center text-[12px] leading-none">
            <StatusGlyph state={c.state} />
          </span>
          <span className="shrink-0 font-mono text-[10px] text-white/35">{c.age}</span>
          {i < SEM.length - 1 ? <span className="absolute bottom-0 right-0 left-[42px] h-px bg-white/[0.05]" /> : null}
        </div>
      ))}
    </div>
  );
}

function GlyphLegend() {
  const types: [GKind, string, string][] = [
    ["channel", "#", "Channel — shared, broadcast"],
    ["dm", "•", "Direct message — 1:1"],
    ["group", "•••", "Group — multi-party (dots = headcount)"],
    ["thread", "↳", "Thread — a reply offshoot"],
    ["system", "✳", "System — automated / broker"],
  ];
  const states: [string, string, boolean][] = [
    ["⠹", "Working — agent running right now (animates)", true],
    ["…", "Composing a reply", false],
    ["?", "Needs you — awaiting your reply (was [ask:…])", true],
    ["›", "Your turn — ready for input", false],
    ["✓", "Done — completed / verdict", false],
    ["[ ]→[✓]", "Task — queued → finished (bracket variant)", false],
  ];
  return (
    <div className="grid max-w-[40ch] gap-5">
      <LegendBlock title="Left · type">
        {types.map(([k, , label]) => (
          <div key={k} className="flex items-center gap-3">
            <span className="grid h-[15px] w-[15px] shrink-0 place-items-center text-studio-ink"><TypeGlyph kind={k} /></span>
            <span className="font-sans text-[12px] text-studio-ink-muted">{label}</span>
          </div>
        ))}
      </LegendBlock>
      <LegendBlock title="Right · status">
        {states.map(([g, label, accent]) => (
          <div key={label} className="flex items-center gap-3">
            <span className={["grid w-[28px] shrink-0 place-items-center font-mono text-[12px]", accent ? "text-[var(--scout-accent)]" : "text-studio-ink"].join(" ")}>{g}</span>
            <span className="font-sans text-[12px] text-studio-ink-muted">{label}</span>
          </div>
        ))}
      </LegendBlock>
    </div>
  );
}

function LegendBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-studio-ink-faint">{title}</div>
      <div className="grid gap-1.5">{children}</div>
    </div>
  );
}

function Notes() {
  const rows: [string, string][] = [
    ["One list, implicit split", "Channels and DMs interleave by recency in a single feed — no CHANNELS / DIRECT MESSAGES headers. A muted '#' is the only marker, so 'voice' can sit above 'Talkie' and you still read it as a channel at a glance. Sets up a unified recency inbox later with no structural change."],
    ["Green does one job", "The accent was on the row wash, a glow, the timestamp, the count, and the '#' all at once. Now it's only the unread count pill (and slightly desaturated). The '#' and timestamps go neutral."],
    ["Standout via brightness, not color", "Titles near-white (read ~85–90%, unread 100% + semibold) over ~40% previews. Unread rows take a faint *neutral* white lift (3.5%) instead of a green wash — they rise without the screen going green."],
    ["Strip our own signatures", "Previews run through a cleaner that drops leading machine envelopes — '[ask:f-mpyn6fet]', '[tag:…]' — so the row shows 'Reviewed tlk-027 against current snap math…', not the routing id. Human sentence first."],
    ["Single line is the default", "~26px rows, ~18 / screen: name (with '#' for channels) · cleaned preview · age · unread. Two-line is the same rules with ~38px rows for when previews need to breathe."],
  ];
  return (
    <section className="mt-8 max-w-[74ch]">
      <h2 className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-studio-ink-faint">
        What changed
      </h2>
      <dl className="grid gap-px overflow-hidden rounded-[8px] border border-studio-edge bg-studio-edge">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[190px_1fr] gap-4 bg-studio-canvas px-4 py-3">
            <dt className="font-sans text-[12.5px] font-semibold text-studio-ink">{k}</dt>
            <dd className="font-sans text-[12.5px] leading-relaxed text-studio-ink-muted">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
