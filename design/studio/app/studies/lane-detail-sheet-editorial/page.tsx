"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HarnessMark } from "@/components/HarnessMark";
import { SpriteAvatar } from "@/components/SpriteAvatar";

/**
 * Agent Lane · Detail Sheet — EDITORIAL direction.
 *
 * Same surface as lane-detail-sheet (the web /ops lane inspector for ONE
 * agent's live conversation), re-typeset for real hierarchy instead of a
 * uniform mono data-dump.
 *
 * The flaw it fixes: the reference is all 9–12px mono in 2–3 grays, no focal
 * point. This variant establishes THREE TIERS of importance:
 *
 *   TIER 1 — the HERO: a plain-language state-line ("Opening a PR") + a single
 *            digest line + a prominent CONTEXT readout. This is the focal point.
 *   TIER 2 — the WORK: files and commands, mid-weight, scannable inventories.
 *   TIER 3 — the SUBSTRATE: raw runtime ids + the token millions, demoted to
 *            quiet rows behind a reveal — available, never shouting.
 *
 * Synthesis over enumeration; CONTEXT % is the usage headline, not the
 * 15,403,083 token grid. Instrument house rules hold: flat surfaces (no
 * cards round sections), one emerald accent, hairlines, thin SVG glyphs.
 *
 * Iterate here, port to packages/web/client/screens/ops/AgentLaneDetailSheet.tsx.
 */

/* ── palette (matches lane-detail-sheet / agent-lanes-card) ─────────────── */
const C = {
  bg: "#0b0d0e",
  panel: "#0e1112",
  ink: "#e8eaed",
  muted: "#9aa3a8",
  dim: "#5e676c",
  faint: "#3a4146",
  green: "#41d18a",
  red: "#d98c84",
  edge: "rgba(255,255,255,.07)",
  edgeSoft: "rgba(255,255,255,.045)",
};

/* ── mock data (verbatim from lane-detail-sheet, for direct comparison) ── */
type FileState = "new" | "mod" | "read";
type TouchedFile = { state: FileState; path: string; add?: number; del?: number };
type CommandKind = "bash" | "edit" | "read";
type Command = { kind: CommandKind; text: string; result?: string };
type PlanStep = { state: "done" | "doing" | "todo"; text: string };
type Plan = { title: string; steps: PlanStep[] };

const AGENT = {
  name: "lattices",
  harness: "codex",
  model: "gpt-5.5",
  effort: "xhigh",
  branch: "codex/integrate-broker-review-fixes",
  cwd: "/Users/art/dev/lattices",
  sessionId: "019ee662-bbb3-70f0-bfd0-e843675f5be6",
  transcript: "~/.codex/sessions/019ee662-bbb3-70f0-bfd0-e843675f5be6.jsonl",
  origin: "spawned by openscout · ask(to:)",
  attribution: "art · cmd+shift+L",
  age: "2m",
  working: true,
  turn: "active · #4",
};

const CURRENT_ACTION =
  'gh pr create --base main --head codex/integrate-broker-review-fixes --title "Integrate broker review fixes"';

const STATS = { tools: 171, edits: 16, reads: 0, thinks: 0, files: 45, events: 288 };

const USAGE = {
  input: 15_403_083,
  output: 48_553,
  cacheRead: 14_236_928,
  cacheWrite: 1_118_204,
  total: 15_451_636,
  reasoning: 22_870,
  ctxPct: 42,
};

const FILES: TouchedFile[] = [
  // NEW
  { state: "new", path: "Sources/Broker/ReviewQueue.swift", add: 88, del: 0 },
  { state: "new", path: "Sources/Broker/ReviewQueue+Persistence.swift", add: 41, del: 0 },
  { state: "new", path: "Tests/BrokerTests/ReviewQueueTests.swift", add: 132, del: 0 },
  { state: "new", path: "design/notes/broker-review.md", add: 27, del: 0 },
  // MODIFIED
  { state: "mod", path: "Sources/Commands/PaletteCommand.swift", add: 18, del: 3 },
  { state: "mod", path: "Sources/Views/SettingsView.swift", add: 44, del: 12 },
  { state: "mod", path: "Sources/Broker/BrokerService.swift", add: 63, del: 21 },
  { state: "mod", path: "Sources/Broker/BrokerRouter.swift", add: 29, del: 8 },
  { state: "mod", path: "Resources/keyboard-remaps.json", add: 4, del: 1 },
  { state: "mod", path: "Sources/Model/SessionStore.swift", add: 11, del: 4 },
  { state: "mod", path: "Sources/Views/AgentTurnView.swift", add: 22, del: 6 },
  { state: "mod", path: "Sources/Views/MainView.swift", add: 9, del: 2 },
  { state: "mod", path: "Sources/App/AppDelegate.swift", add: 7, del: 1 },
  { state: "mod", path: "Package.swift", add: 5, del: 0 },
  { state: "mod", path: "Sources/Broker/ReviewPolicy.swift", add: 31, del: 14 },
  // READ
  { state: "read", path: "Sources/Input/HotkeyStore.swift" },
  { state: "read", path: "Sources/Views/MainView.swift" },
  { state: "read", path: "Sources/Broker/BrokerProtocol.swift" },
  { state: "read", path: "Sources/Model/Session.swift" },
  { state: "read", path: "Sources/Commands/CommandRegistry.swift" },
  { state: "read", path: "Sources/Views/PaletteView.swift" },
  { state: "read", path: "Tests/BrokerTests/RouterTests.swift" },
  { state: "read", path: "README.md" },
];

const COMMANDS: Command[] = [
  { kind: "bash", text: 'gh pr create --base main --head codex/integrate-broker-review-fixes --title "Integrate broker review fixes"' },
  { kind: "bash", text: "swift build -c release 2>&1 | tail -20", result: "Build complete!" },
  { kind: "bash", text: 'rg "ReviewQueue" Sources --type swift -n', result: "31 matches" },
  { kind: "edit", text: "Sources/Broker/BrokerService.swift" },
  { kind: "edit", text: "Sources/Views/SettingsView.swift" },
  { kind: "bash", text: "git add -A && git commit -m 'Integrate broker review fixes'", result: "9d7e2f5" },
  { kind: "read", text: "Sources/Broker/BrokerProtocol.swift" },
];

const PLANS: Plan[] = [
  {
    title: "Keyboard navigation + help for native macOS Scout app",
    steps: [
      { state: "done", text: "Map command registry to a keymap layer" },
      { state: "doing", text: "Wire the palette command to the broker review queue" },
      { state: "todo", text: "Help overlay — list active bindings" },
    ],
  },
  {
    title: "Nexus — one unified command bar",
    steps: [
      { state: "done", text: "Spec the command bar surface" },
      { state: "done", text: "Define the result taxonomy (agents · sessions · files)" },
      { state: "doing", text: "Cross-fleet lookup behind ⌘K" },
      { state: "todo", text: "Inline composer on a matched agent" },
    ],
  },
];

const DOCS: { title: string; path: string }[] = [];

/* ── small utils ────────────────────────────────────────────────────────── */
const fmt = (n: number) => n.toLocaleString("en-US");
const basename = (p: string) => p.replace(/^.*\//u, "");
const dirname = (p: string) => {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i + 1);
};

/* ── glyphs (thin SVG, currentColor) ────────────────────────────────────── */
function CopyGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
function CheckGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function OpenGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12v-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M9 3.5h4.5V8M13 4 7 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function RevealGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 5.2c0-.5.4-.9.9-.9h3.2l1.1 1.1h5c.5 0 .9.4.9.9V11c0 .5-.4.9-.9.9H2.9c-.5 0-.9-.4-.9-.9V5.2Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}
function TraceGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="4" cy="4" r="1.4" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="4" cy="12" r="1.4" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="12" cy="8" r="1.4" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4 5.4v5.2M5.3 4.6 10.7 7.4M5.3 11.4 10.7 8.6" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}
function CaretGlyph({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}>
      <path d="M3.5 2 L6.5 5 L3.5 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── copy affordance ────────────────────────────────────────────────────── */
function useCopy() {
  const [hit, setHit] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = useCallback((value: string, id: string) => {
    void navigator.clipboard?.writeText(value).catch(() => {});
    setHit(id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHit(null), 1100);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { hit, copy };
}

const CopyCtx = { hit: null as string | null, copy: (_: string, __: string) => {} };

function CopyDot({ value, id, label = "Copy" }: { value: string; id: string; label?: string }) {
  const ok = CopyCtx.hit === id;
  return (
    <button
      type="button"
      className={`copydot${ok ? " copydot--ok" : ""}`}
      title={ok ? "Copied" : label}
      onClick={(e) => { e.stopPropagation(); CopyCtx.copy(value, id); }}
    >
      {ok ? <CheckGlyph /> : <CopyGlyph />}
    </button>
  );
}

/** A value that exposes its copy dot on hover and copies the FULL value. */
function CopyVal({ value, id, display, mono = true }: { value: string; id: string; display?: string; mono?: boolean }) {
  return (
    <span className={`cval${mono ? " cval--mono" : ""}`}>
      <span className="cval-text">{display ?? value}</span>
      <CopyDot value={value} id={id} />
    </span>
  );
}

/* ── reveal row (progressive disclosure for long paths/ids) ─────────────── */
function RevealRow({ short, full, copyId }: { short: string; full: string; copyId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="reveal">
      <button type="button" className="reveal-toggle" onClick={() => setOpen((o) => !o)} title={open ? "Hide full" : "Reveal full"}>
        <CaretGlyph open={open} />
      </button>
      <span className="cval cval--mono">
        <span className="cval-text">{open ? full : short}</span>
        <CopyDot value={full} id={copyId} />
      </span>
    </span>
  );
}

/* ── tiny ghost action button ───────────────────────────────────────────── */
function Ghost({ children, onClick, primary = false }: { children: React.ReactNode; onClick?: () => void; primary?: boolean }) {
  return (
    <button type="button" className={`ghost${primary ? " ghost--primary" : ""}`} onClick={onClick}>{children}</button>
  );
}

/* ── tier-2 section header — quieter than the reference, a label + count
      riding a hairline. No actions cluster competing with the hero. ─────── */
function SecHead({ id, label, count, actions }: { id: string; label: string; count?: string; actions?: React.ReactNode }) {
  return (
    <div className="sechead" id={id}>
      <span className="sechead-label">{label}</span>
      {count != null && <span className="sechead-count">{count}</span>}
      <span className="sechead-rule" />
      {actions && <span className="sechead-actions">{actions}</span>}
    </div>
  );
}

/* ── file row ───────────────────────────────────────────────────────────── */
function FileRow({ f, idx }: { f: TouchedFile; idx: string }) {
  return (
    <div className="frow">
      <span className={`fstate fstate--${f.state}`} aria-hidden>{f.state === "new" ? "+" : f.state === "mod" ? "~" : "○"}</span>
      <span className="fpath" title={f.path}>
        <span className="fdir">{dirname(f.path)}</span>
        <span className="fbase">{basename(f.path)}</span>
      </span>
      {(f.add != null || f.del != null) && (
        <span className="fdiff">
          {f.add ? <span className="fadd">+{f.add}</span> : null}
          {f.del ? <span className="fdel">−{f.del}</span> : null}
        </span>
      )}
      <span className="frow-acts">
        <button type="button" className="rowact" title="Open in diff"><OpenGlyph /></button>
        <button type="button" className="rowact" title="Reveal in tree"><RevealGlyph /></button>
        <CopyDot value={f.path} id={`f-${idx}`} label="Copy path" />
      </span>
    </div>
  );
}

/* ── command row ────────────────────────────────────────────────────────── */
function CommandRow({ c, idx }: { c: Command; idx: string }) {
  const mark = c.kind === "bash" ? "❯" : c.kind === "edit" ? "✎" : "◎";
  return (
    <div className={`crow crow--${c.kind}`}>
      <span className="cmark" aria-hidden>{mark}</span>
      <span className="ctext" title={c.text}>{c.text}</span>
      {c.result && <span className="cresult">{c.result}</span>}
      <span className="crow-acts">
        <CopyDot value={c.text} id={`c-${idx}`} label="Copy command" />
      </span>
    </div>
  );
}

/* ── plan card ──────────────────────────────────────────────────────────── */
function PlanCard({ p, idx }: { p: Plan; idx: number }) {
  const [open, setOpen] = useState(idx === 0);
  const done = p.steps.filter((s) => s.state === "done").length;
  const doing = p.steps.filter((s) => s.state === "doing").length;
  const todo = p.steps.filter((s) => s.state === "todo").length;
  return (
    <div className={`plan${open ? " plan--open" : ""}`}>
      <button type="button" className="plan-head" onClick={() => setOpen((o) => !o)}>
        <span className="plan-caret"><CaretGlyph open={open} /></span>
        <span className="plan-title" title={p.title}>{p.title}</span>
        <span className="plan-tally">{done} done · {doing} active · {todo} todo</span>
      </button>
      {open && (
        <div className="plan-steps">
          {p.steps.map((s, i) => (
            <div className={`pstep pstep--${s.state}`} key={i}>
              <span className="pstep-box" aria-hidden>{s.state === "done" ? "✓" : s.state === "doing" ? "▸" : "○"}</span>
              <span className="pstep-text">{s.text}</span>
            </div>
          ))}
          <div className="plan-foot">
            <Ghost>Open in Plans →</Ghost>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── editorial synthesis ────────────────────────────────────────────────── *
 * Turn the raw current action into a plain-language state-line. In the real
 * port this is derived from the active tool-call; here we read it off the
 * mock so the headline stays honest to CURRENT_ACTION.                      */
function deriveState(action: string): { headline: string; verb: string } {
  if (/gh pr create/.test(action)) return { headline: "Opening a pull request", verb: "opening PR" };
  if (/git (commit|add)/.test(action)) return { headline: "Committing changes", verb: "committing" };
  if (/swift build|cargo build|npm run build/.test(action)) return { headline: "Building the project", verb: "building" };
  if (/\brg\b|grep|find /.test(action)) return { headline: "Searching the tree", verb: "searching" };
  return { headline: "Running a command", verb: "running" };
}

/* ── the sheet ──────────────────────────────────────────────────────────── */
function LaneDetailSheet() {
  const a = AGENT;
  const newFiles = FILES.filter((f) => f.state === "new");
  const modFiles = FILES.filter((f) => f.state === "mod");
  const readFiles = FILES.filter((f) => f.state === "read");
  const [readOpen, setReadOpen] = useState(false);
  const [showAllMod, setShowAllMod] = useState(false);
  const MOD_CAP = 8;
  const visibleMod = showAllMod ? modFiles : modFiles.slice(0, MOD_CAP);

  const totalAdd = FILES.reduce((s, f) => s + (f.add ?? 0), 0);
  const totalDel = FILES.reduce((s, f) => s + (f.del ?? 0), 0);
  const changedCount = newFiles.length + modFiles.length;

  const { headline } = deriveState(CURRENT_ACTION);
  // The one-line digest — synthesis, not enumeration.
  const digest = `${USAGE.ctxPct}% context · +${totalAdd}/−${totalDel} across ${changedCount} files · ${a.model} ${a.effort}`;

  const changedPaths = [...newFiles, ...modFiles].map((f) => f.path).join("\n");
  const allCommands = COMMANDS.map((c) => (c.kind === "bash" ? c.text : `${c.kind}: ${c.text}`)).join("\n");
  const diagnostics = [
    `agent: ${a.name}`,
    `harness: ${a.harness} · ${a.model} · ${a.effort}`,
    `branch: ${a.branch}`,
    `cwd: ${a.cwd}`,
    `session: ${a.sessionId}`,
    `transcript: ${a.transcript}`,
    `origin: ${a.origin}`,
  ].join("\n");

  return (
    <aside className="sheet">
      {/* HEADER — agent identity, kept lean; the hero carries the weight */}
      <div className="sheet-head">
        <SpriteAvatar name={a.name} size={30} className="sheet-av" />
        <div className="sheet-ident">
          <span className="sheet-name">
            {a.name}
            <CopyDot value={a.name} id="name" label="Copy name" />
          </span>
          <span className="sheet-sub">
            <span className="harness-inline" title={a.harness}><HarnessMark harness={a.harness} size={11} /> {a.harness}</span>
            <span className="dot-sep" aria-hidden>·</span>
            {a.branch.replace(/^codex\//, "")}
          </span>
        </div>
        <button type="button" className="closebtn" aria-label="Close">
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
      </div>

      <div className="sheet-scroll">
        {/* ── TIER 1 · THE HERO ─────────────────────────────────────────── *
            The focal point. A plain-language headline the eye lands on
            first, a single synthesized digest line, then the live command
            in the inset "now" well, then the prominent CONTEXT readout. */}
        <section className="hero">
          <div className="hero-meta">
            <span className="working-dot" aria-hidden />
            <span className="hero-meta-text">working · {a.age} · turn {a.turn}</span>
          </div>

          <h2 className="hero-headline">{headline}</h2>
          <p className="hero-digest">{digest}</p>

          <div className="now-action">
            <span className="now-prompt" aria-hidden>❯</span>
            <span className="now-cmd" title={CURRENT_ACTION}>{CURRENT_ACTION}</span>
            <span className="now-acts">
              <button type="button" className="rowact" title="Open trace at this step"><TraceGlyph /></button>
              <CopyDot value={CURRENT_ACTION} id="now" label="Copy full command" />
            </span>
          </div>

          {/* CONTEXT — the prominent usage readout (token millions demoted
              to Tier 3, below). A big number + a wide bar, nothing else. */}
          <div className="ctx">
            <div className="ctx-head">
              <span className="ctx-pct">{USAGE.ctxPct}<span className="ctx-pct-sign">%</span></span>
              <span className="ctx-label">context window in use</span>
            </div>
            <span className="ctx-bar" aria-hidden><span className="ctx-bar-fill" style={{ width: `${USAGE.ctxPct}%` }} /></span>
          </div>
        </section>

        {/* primary CTAs — flat, the one emerald action leads */}
        <section className="actions">
          <Ghost primary>Open conversation</Ghost>
          <Ghost>Open trace</Ghost>
          <Ghost>All changes ▸ diff</Ghost>
        </section>

        {/* ── TIER 2 · THE WORK ─────────────────────────────────────────── */}

        {/* FILES — grouped inventory, mid-weight, the bulk of the panel */}
        <SecHead
          id="sec-files"
          label="Files"
          count={`${changedCount} changed · ${readFiles.length} read`}
          actions={<>
            <span className="diff-tally"><span className="fadd">+{totalAdd}</span><span className="fdel">−{totalDel}</span></span>
            <Ghost onClick={() => CopyCtx.copy(changedPaths, "f-all")}>Copy changed</Ghost>
          </>}
        />
        <div className="filegroup">
          <div className="fglabel"><span className="fglabel-mark fglabel-mark--new" aria-hidden /> NEW <span className="fglabel-n">{newFiles.length}</span></div>
          {newFiles.map((f, i) => <FileRow key={i} f={f} idx={`new-${i}`} />)}
        </div>
        <div className="filegroup">
          <div className="fglabel"><span className="fglabel-mark fglabel-mark--mod" aria-hidden /> MODIFIED <span className="fglabel-n">{modFiles.length}</span></div>
          {visibleMod.map((f, i) => <FileRow key={i} f={f} idx={`mod-${i}`} />)}
          {modFiles.length > MOD_CAP && (
            <button type="button" className="showall" onClick={() => setShowAllMod((s) => !s)}>
              {showAllMod ? "Show fewer" : `Show all ${modFiles.length}`}
            </button>
          )}
        </div>
        <div className="filegroup">
          <button type="button" className="fglabel fglabel--btn" onClick={() => setReadOpen((o) => !o)}>
            <span className="fglabel-caret"><CaretGlyph open={readOpen} /></span>
            <span className="fglabel-mark fglabel-mark--read" aria-hidden /> READ <span className="fglabel-n">{readFiles.length}</span>
            {!readOpen && <span className="fglabel-hint">collapsed</span>}
          </button>
          {readOpen && readFiles.map((f, i) => <FileRow key={i} f={f} idx={`read-${i}`} />)}
        </div>

        {/* COMMANDS — run this turn */}
        <SecHead id="sec-commands" label="Commands" count="this turn" actions={<Ghost onClick={() => CopyCtx.copy(allCommands, "c-all")}>Copy all</Ghost>} />
        <div className="cmdlist">
          {COMMANDS.map((c, i) => <CommandRow key={i} c={c} idx={`${i}`} />)}
        </div>

        {/* PLANS */}
        <SecHead id="sec-plans" label="Plans" count={`${PLANS.length}`} actions={<Ghost>Open in Plans →</Ghost>} />
        <div className="planlist">
          {PLANS.map((p, i) => <PlanCard key={i} p={p} idx={i} />)}
        </div>

        {/* DOCS — collapsed/empty */}
        <SecHead id="sec-docs" label="Docs" count={`${DOCS.length}`} />
        {DOCS.length === 0 ? (
          <div className="empty">No docs produced this conversation.</div>
        ) : null}

        {/* ── TIER 3 · THE SUBSTRATE ───────────────────────────────────── *
            Raw runtime ids + the token millions. The least actionable
            numbers on the panel — demoted to one quiet collapsible block
            so they're available without competing for the eye.           */}
        <div className="substrate">
          <SubstrateReveal
            diagnostics={diagnostics}
            counts={`${STATS.tools} tools · ${STATS.edits} edits · ${STATS.events} events`}
          />
        </div>

        <div className="sheet-foot">
          conversation <span className="foot-id">{a.sessionId.slice(0, 8)}</span> · {STATS.events} events · live
        </div>
      </div>
    </aside>
  );
}

/* ── KV row (used inside the demoted substrate block) ───────────────────── */
function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{children}</span>
    </div>
  );
}

/* ── TIER 3 substrate — runtime ids + token dump, behind one reveal ─────── */
function SubstrateReveal({ diagnostics, counts }: { diagnostics: string; counts: string }) {
  const [open, setOpen] = useState(false);
  const a = AGENT;
  return (
    <>
      <button type="button" className="substrate-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="substrate-caret"><CaretGlyph open={open} /></span>
        <span className="substrate-title">Runtime &amp; tokens</span>
        <span className="substrate-hint">{open ? "" : counts}</span>
      </button>
      {open && (
        <div className="substrate-body">
          {/* runtime ids — quiet kv */}
          <div className="kvgrid">
            <KV k="model"><CopyVal value={a.model} id="rt-model" /> <span className="kv-aux">{a.effort}</span></KV>
            <KV k="branch"><CopyVal value={a.branch} id="rt-branch" /></KV>
            <KV k="cwd"><RevealRow short={a.cwd.replace(/\/Users\/[^/]+/, "~")} full={a.cwd} copyId="rt-cwd-c" /></KV>
            <KV k="conversation"><RevealRow short={a.sessionId.slice(0, 13) + "…"} full={a.sessionId} copyId="rt-sid-c" /></KV>
            <KV k="transcript"><RevealRow short={"~/.codex/sessions/019ee662….jsonl"} full={a.transcript} copyId="rt-tx-c" /></KV>
            <KV k="origin"><CopyVal value={a.origin} id="rt-origin" mono={false} /></KV>
            <KV k="by"><CopyVal value={a.attribution} id="rt-attr" mono={false} /></KV>
          </div>

          {/* the demoted token grid — context % lives up in the hero now */}
          <div className="tok-head">tokens</div>
          <div className="tokgrid">
            {([
              ["in", fmt(USAGE.input)],
              ["out", fmt(USAGE.output)],
              ["cache rd", fmt(USAGE.cacheRead)],
              ["cache wr", fmt(USAGE.cacheWrite)],
              ["total", fmt(USAGE.total)],
              ["reasoning", fmt(USAGE.reasoning)],
            ] as const).map(([label, v]) => (
              <span className="tcell" key={label}>
                <span className="tcell-l">{label}</span>
                <span className="tcell-n">{v}</span>
              </span>
            ))}
          </div>

          <div className="substrate-foot">
            <Ghost onClick={() => CopyCtx.copy(diagnostics, "diag")}>Copy diagnostics</Ghost>
          </div>
        </div>
      )}
    </>
  );
}

export default function LaneDetailSheetEditorialPage() {
  const { hit, copy } = useCopy();
  // expose copy to the static CopyDot/Ctx helpers (single sheet on the page)
  CopyCtx.hit = hit;
  CopyCtx.copy = copy;

  return (
    <main className="lds-study">
      <style>{CSS}</style>
      <header className="study-head">
        <div className="eyebrow">· studies · web · lane-detail-sheet · editorial</div>
        <h1>Agent Lane · Detail Sheet — Editorial</h1>
        <p className="sub">same inspector, re-typeset for real hierarchy. a plain-language hero state-line + one digest + the prominent context readout lead; files &amp; commands are the mid-weight work; the raw runtime ids and token millions are demoted to one quiet reveal at the foot.</p>
      </header>

      <div className="stage">
        <div className="stage-context" aria-hidden>
          <div className="ctx-line">/ops · lanes</div>
          <div className="ctx-lane ctx-lane--a"><span className="ctx-dot" />openscout · claude</div>
          <div className="ctx-lane ctx-lane--sel"><span className="ctx-dot ctx-dot--on" />lattices · codex</div>
          <div className="ctx-lane ctx-lane--b"><span className="ctx-dot" />studio · gemini</div>
        </div>
        <LaneDetailSheet />
      </div>
    </main>
  );
}

const CSS = `
.lds-study{min-height:100vh;background:${C.bg};color:${C.ink};font-family:Inter,system-ui,sans-serif;padding:40px}
.study-head{margin-bottom:22px;max-width:720px}
.eyebrow{font-family:ui-monospace,monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:${C.dim}}
.lds-study h1{font-size:28px;font-weight:600;margin:4px 0}
.sub{font-family:ui-monospace,monospace;font-size:12px;color:${C.dim};margin:0;line-height:1.5}

/* stage — a faint left context so the sheet reads as a right-rail, plus the panel */
.stage{display:flex;gap:0;align-items:flex-start;margin-top:8px;border:1px solid ${C.edge};border-radius:11px;overflow:hidden;width:fit-content;background:${C.bg}}
.stage-context{width:230px;padding:16px 14px;display:flex;flex-direction:column;gap:7px;opacity:.55}
.ctx-line{font-family:ui-monospace,monospace;font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:${C.dim};margin-bottom:6px}
.ctx-lane{display:flex;align-items:center;gap:8px;font-family:ui-monospace,monospace;font-size:12px;color:${C.muted};padding:7px 9px;border-radius:6px}
.ctx-lane--sel{background:rgba(255,255,255,.04);color:${C.ink};opacity:1}
.ctx-dot{width:6px;height:6px;border-radius:50%;background:${C.faint}}
.ctx-dot--on{background:${C.green};box-shadow:0 0 0 3px color-mix(in srgb,${C.green} 18%,transparent)}

/* ── the sheet ── */
.sheet{width:380px;align-self:stretch;background:${C.panel};border-left:1px solid ${C.edge};
  display:flex;flex-direction:column;max-height:920px;position:relative}

/* HEADER — lean identity; the hero, not this, is the focal point */
.sheet-head{display:flex;align-items:center;gap:10px;padding:12px 14px 11px;border-bottom:1px solid ${C.edge}}
.sheet-av{flex:none;border-radius:8px}
.sheet-ident{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.sheet-name{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:600;letter-spacing:-.01em;color:${C.ink}}
.sheet-sub{display:inline-flex;align-items:center;gap:6px;font-family:ui-monospace,monospace;font-size:10.5px;color:${C.dim};min-width:0}
.sheet-sub .harness-inline{display:inline-flex;align-items:center;gap:4px;color:${C.muted}}
.sheet-sub .dot-sep{color:${C.faint}}
.working-dot{width:6px;height:6px;border-radius:50%;background:${C.green};box-shadow:0 0 0 3px color-mix(in srgb,${C.green} 16%,transparent);animation:pulse 2.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.closebtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:0;background:transparent;color:${C.dim};border-radius:6px;cursor:pointer}
.closebtn:hover{color:${C.ink};background:rgba(255,255,255,.04)}

/* scroll body */
.sheet-scroll{overflow-y:auto;flex:1 1 auto;padding:0 0 8px}
.sheet-scroll::-webkit-scrollbar{width:8px}
.sheet-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.07);border-radius:4px}

/* ── TIER 1 · HERO ─────────────────────────────────────────────────────── */
.hero{padding:16px 14px 17px;border-bottom:1px solid ${C.edge};
  background:linear-gradient(180deg,color-mix(in srgb,${C.green} 4%,transparent),transparent 70%)}
.hero-meta{display:inline-flex;align-items:center;gap:7px;margin-bottom:11px}
.hero-meta-text{font-family:ui-monospace,monospace;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:${C.dim}}
/* the headline — the single biggest, lightest type on the panel. Not mono. */
.hero-headline{margin:0;font-family:Inter,system-ui,sans-serif;font-size:22px;line-height:1.15;font-weight:600;letter-spacing:-.02em;color:${C.ink}}
.hero-digest{margin:5px 0 0;font-family:ui-monospace,monospace;font-size:11px;line-height:1.5;color:${C.muted}}

/* the live command well — the reference's inset "now", kept */
.now-action{display:flex;align-items:flex-start;gap:8px;margin-top:13px;
  background:#070809;border:1px solid color-mix(in srgb,${C.ink} 12%,transparent);border-radius:7px;
  padding:7px 9px;box-shadow:inset 0 1px 0 rgba(255,255,255,.03),0 1px 2px rgba(0,0,0,.4)}
.now-prompt{flex:none;color:color-mix(in srgb,${C.green} 80%,${C.muted});font-weight:700;font-family:ui-monospace,monospace;font-size:12px;line-height:1.5}
.now-cmd{flex:1 1 auto;min-width:0;font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.5;color:${C.ink};
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}
.now-acts{display:inline-flex;align-items:center;gap:3px;flex:none}

/* CONTEXT — the prominent usage readout. Big number, wide bar, that's it. */
.ctx{margin-top:15px}
.ctx-head{display:flex;align-items:baseline;gap:9px}
.ctx-pct{font-family:ui-monospace,monospace;font-size:26px;font-weight:600;line-height:1;color:${C.green};font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.ctx-pct-sign{font-size:15px;margin-left:1px;color:color-mix(in srgb,${C.green} 75%,${C.muted})}
.ctx-label{font-family:ui-monospace,monospace;font-size:10px;color:${C.dim};letter-spacing:.02em}
.ctx-bar{display:block;margin-top:8px;height:4px;border-radius:3px;background:rgba(255,255,255,.07);overflow:hidden}
.ctx-bar-fill{display:block;height:100%;background:${C.green};border-radius:3px}

/* ACTIONS */
.actions{display:flex;flex-wrap:wrap;gap:7px;padding:13px 14px 4px}
.ghost{display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border:1px solid ${C.edge};border-radius:6px;
  background:rgba(255,255,255,.015);color:${C.muted};font-family:ui-monospace,monospace;font-size:11px;cursor:pointer;white-space:nowrap}
.ghost:hover{color:${C.ink};border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.04)}
.ghost--primary{color:${C.ink};border-color:color-mix(in srgb,${C.green} 36%,transparent);
  background:color-mix(in srgb,${C.green} 9%,transparent)}
.ghost--primary:hover{border-color:color-mix(in srgb,${C.green} 55%,transparent);background:color-mix(in srgb,${C.green} 14%,transparent)}

/* ── TIER 2 section head — quieter, smaller, just a label on a rule ────── */
.sechead{display:flex;align-items:center;gap:9px;padding:17px 14px 7px;scroll-margin-top:12px}
.sechead-label{font-family:ui-monospace,monospace;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:${C.dim};flex:none}
.sechead-count{font-family:ui-monospace,monospace;font-size:9.5px;color:${C.faint};flex:none}
.sechead-rule{flex:1 1 auto;height:1px;background:${C.edgeSoft};min-width:8px}
.sechead-actions{display:inline-flex;align-items:center;gap:6px;flex:none}

/* FILES */
.diff-tally{display:inline-flex;gap:5px;font-family:ui-monospace,monospace;font-size:10px}
.fadd{color:${C.muted}}.fdel{color:${C.dim}}
.filegroup{padding:0 14px;margin-top:4px}
.fglabel{display:flex;align-items:center;gap:7px;padding:7px 0 4px;font-family:ui-monospace,monospace;font-size:9px;font-weight:600;letter-spacing:.1em;color:${C.dim};width:100%;border:0;background:transparent;text-align:left;cursor:default}
.fglabel--btn{cursor:pointer}
.fglabel--btn:hover{color:${C.muted}}
.fglabel-caret{display:inline-flex;color:${C.dim}}
.fglabel-mark{width:6px;height:6px;border-radius:1.5px;flex:none}
.fglabel-mark--new{background:${C.green}}
.fglabel-mark--mod{background:${C.muted}}
.fglabel-mark--read{background:${C.faint}}
.fglabel-n{color:${C.faint};font-weight:400}
.fglabel-hint{margin-left:auto;color:${C.faint};font-weight:400;letter-spacing:.02em;text-transform:none}
.frow{display:flex;align-items:center;gap:8px;padding:3px 6px 3px 13px;margin:0 -6px;border-radius:5px;min-width:0}
.frow:hover{background:rgba(255,255,255,.025)}
.fstate{flex:none;width:11px;text-align:center;font-family:ui-monospace,monospace;font-size:12px;line-height:1;color:${C.dim}}
.fstate--new{color:${C.green}}
.fstate--mod{color:${C.muted}}
.fstate--read{color:${C.faint}}
.fpath{flex:1 1 auto;min-width:0;font-family:ui-monospace,monospace;font-size:11px;display:flex;align-items:baseline;overflow:hidden}
.fdir{color:${C.dim};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left;max-width:46%;flex:0 1 auto}
.fbase{color:${C.ink};white-space:nowrap;flex:none}
.fdiff{flex:none;display:inline-flex;gap:4px;font-family:ui-monospace,monospace;font-size:10px}
.frow-acts{flex:none;display:inline-flex;align-items:center;gap:1px}
.rowact{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:1px solid transparent;border-radius:4px;background:transparent;color:${C.faint};cursor:pointer;opacity:0;transition:opacity .12s ease,color .12s ease}
.frow:hover .rowact,.now-action:hover .rowact{opacity:1}
.rowact:hover{color:${C.ink};border-color:${C.edge};background:rgba(255,255,255,.04)}
.showall{margin:5px 0 2px 19px;border:0;background:transparent;color:${C.dim};font-family:ui-monospace,monospace;font-size:10.5px;cursor:pointer;padding:2px 0}
.showall:hover{color:${C.muted}}

/* COMMANDS */
.cmdlist{padding:2px 14px 0}
.crow{display:flex;align-items:center;gap:8px;padding:4px 6px;margin:0 -6px;border-radius:5px;min-width:0}
.crow:hover{background:rgba(255,255,255,.025)}
.cmark{flex:none;width:12px;text-align:center;font-family:ui-monospace,monospace;font-size:11px;color:${C.dim}}
.crow--bash .cmark{color:color-mix(in srgb,${C.green} 70%,${C.muted})}
.ctext{flex:1 1 auto;min-width:0;font-family:ui-monospace,monospace;font-size:11px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.crow--bash .ctext{color:${C.ink}}
.cresult{flex:none;font-family:ui-monospace,monospace;font-size:9.5px;color:${C.dim};white-space:nowrap}
.crow-acts{flex:none;display:inline-flex;align-items:center}

/* copy value + dot (shared) */
.cval{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%}
.cval--mono{font-family:ui-monospace,monospace}
.cval-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.copydot{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;
  border:1px solid transparent;border-radius:4px;background:transparent;color:${C.faint};cursor:pointer;
  opacity:0;transition:opacity .12s ease,color .12s ease,border-color .12s ease}
.cval:hover .copydot,.frow:hover .copydot,.crow:hover .copydot,.sheet-name:hover .copydot,.kv:hover .copydot,.now-action:hover .copydot{opacity:1}
.copydot:hover{color:${C.ink};border-color:${C.edge};background:rgba(255,255,255,.04)}
.copydot--ok{opacity:1;color:${C.green};border-color:color-mix(in srgb,${C.green} 30%,transparent)}

/* reveal row (shared) */
.reveal{display:inline-flex;align-items:center;gap:6px;min-width:0}
.reveal-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:0;background:transparent;color:${C.dim};cursor:pointer;border-radius:3px}
.reveal-toggle:hover{color:${C.ink}}

/* PLANS */
.planlist{padding:2px 14px 0;display:flex;flex-direction:column;gap:7px}
.plan{border:1px solid ${C.edge};border-radius:7px;overflow:hidden;background:rgba(255,255,255,.012)}
.plan-head{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;cursor:pointer;padding:8px 10px;text-align:left;min-width:0}
.plan-head:hover{background:rgba(255,255,255,.02)}
.plan-caret{flex:none;color:${C.dim};display:inline-flex}
.plan-title{flex:1 1 auto;min-width:0;font-size:12px;color:${C.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plan-tally{flex:none;font-family:ui-monospace,monospace;font-size:9.5px;color:${C.dim}}
.plan-steps{padding:2px 12px 9px 14px;border-top:1px solid ${C.edgeSoft};display:flex;flex-direction:column;gap:3px}
.pstep{display:flex;align-items:baseline;gap:8px;font-family:ui-monospace,monospace;font-size:10.5px;color:${C.muted};padding-top:5px}
.pstep-box{flex:none;width:11px;text-align:center;color:${C.dim}}
.pstep--done .pstep-text{color:${C.dim};text-decoration:line-through}
.pstep--doing .pstep-box{color:${C.green}}
.pstep--doing .pstep-text{color:${C.ink}}
.plan-foot{margin-top:7px}

/* DOCS / empty */
.empty{margin:2px 14px 0;padding:11px;border:1px dashed ${C.edge};border-radius:7px;text-align:center;
  font-family:ui-monospace,monospace;font-size:10.5px;color:${C.faint}}

/* ── TIER 3 · SUBSTRATE — runtime ids + token millions, demoted & hidden ── */
.substrate{margin:20px 14px 0;border-top:1px solid ${C.edgeSoft};padding-top:4px}
.substrate-toggle{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;cursor:pointer;
  padding:8px 0;text-align:left}
.substrate-caret{flex:none;color:${C.dim};display:inline-flex}
.substrate-title{font-family:ui-monospace,monospace;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:${C.dim}}
.substrate-toggle:hover .substrate-title{color:${C.muted}}
.substrate-hint{margin-left:auto;font-family:ui-monospace,monospace;font-size:9.5px;color:${C.faint};white-space:nowrap}
.substrate-body{padding:2px 0 6px}

/* quiet kv grid for runtime ids */
.kvgrid{display:flex;flex-direction:column;gap:0}
.kv{display:grid;grid-template-columns:88px 1fr;column-gap:10px;align-items:center;padding:4px 0;min-width:0}
.kv-k{font-family:ui-monospace,monospace;font-size:10px;color:${C.faint};text-transform:lowercase;letter-spacing:.02em}
.kv-v{font-family:ui-monospace,monospace;font-size:11px;color:${C.muted};min-width:0;display:flex;align-items:center;gap:8px}
.kv-aux{color:${C.faint};font-size:10px}

/* the demoted token grid — quiet, label-led, no emphasis */
.tok-head{font-family:ui-monospace,monospace;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:${C.faint};margin:11px 0 5px}
.tokgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:2px 14px}
.tcell{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:2px 0}
.tcell-l{font-family:ui-monospace,monospace;font-size:10px;color:${C.faint};text-transform:lowercase;letter-spacing:.02em}
.tcell-n{font-family:ui-monospace,monospace;font-size:10.5px;color:${C.dim};font-variant-numeric:tabular-nums}
.substrate-foot{margin-top:11px}

/* foot */
.sheet-foot{margin:18px 14px 6px;padding-top:11px;border-top:1px solid ${C.edgeSoft};
  font-family:ui-monospace,monospace;font-size:9.5px;color:${C.faint};display:flex;align-items:center;gap:6px}
.foot-id{color:${C.dim}}
`;
