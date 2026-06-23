"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HarnessMark } from "@/components/HarnessMark";
import { SpriteAvatar } from "@/components/SpriteAvatar";

/**
 * Agent Lane · Detail Sheet — design surface for the web OPS lane inspector.
 *
 * A tall right-side panel for ONE agent's work session. Replaces today's
 * read-only fact dump with a jumpable + copyable + grouped instrument:
 *   NOW (live action) → ACTIONS → RUNTIME (one block, no duplication) →
 *   USAGE → FILES (grouped inventory, no cap) → COMMANDS → PLANS → DOCS.
 *
 * Three north-star ergonomics:
 *   JUMP   — anchor bar + per-row open/reveal + trace links
 *   COPY   — a hover copy affordance on every id / path / value
 *   INVENTORY — collections are real, complete, groupable lists (no 10-cap)
 *
 * Iterate here, port to packages/web/client/screens/ops/AgentLaneDetailSheet.tsx.
 */

/* ── palette (matches agent-lanes-card) ─────────────────────────────────── */
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

/* ── mock data ──────────────────────────────────────────────────────────── */
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

/* ── copy affordance (the lane card's CopyDot) ──────────────────────────── */
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
function CopyVal({ value, id, display, mono = true, full }: { value: string; id: string; display?: string; mono?: boolean; full?: boolean }) {
  return (
    <span className={`cval${mono ? " cval--mono" : ""}${full ? " cval--full" : ""}`}>
      <span className="cval-text">{display ?? value}</span>
      <CopyDot value={value} id={id} />
    </span>
  );
}

/* ── reveal row (progressive disclosure for long paths/ids) ─────────────── */
function RevealRow({ short, full, id, copyId }: { short: string; full: string; id: string; copyId: string }) {
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

/* ── section header ─────────────────────────────────────────────────────── */
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

/* ── tiny ghost action button ───────────────────────────────────────────── */
function Ghost({ children, onClick, primary = false }: { children: React.ReactNode; onClick?: () => void; primary?: boolean }) {
  return (
    <button type="button" className={`ghost${primary ? " ghost--primary" : ""}`} onClick={onClick}>{children}</button>
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
      {/* HEADER */}
      <div className="sheet-head">
        <SpriteAvatar name={a.name} size={34} className="sheet-av" />
        <div className="sheet-ident">
          <span className="sheet-name">
            {a.name}
            <CopyDot value={a.name} id="name" label="Copy name" />
          </span>
          <span className="sheet-sub">
            <span className="working-dot" aria-hidden />
            working · {a.age}
          </span>
        </div>
        <span className="harness-badge" title={a.harness}>
          <HarnessMark harness={a.harness} size={15} />
          <span className="harness-label">{a.harness}</span>
        </span>
        <button type="button" className="closebtn" aria-label="Close">
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
      </div>

      {/* anchor bar — sticky in-sheet jump nav for the long scroll */}
      <nav className="anchorbar">
        <a href="#sec-files" className="anchor-link">Files <span className="anchor-n">{newFiles.length + modFiles.length}</span></a>
        <a href="#sec-commands" className="anchor-link">Commands <span className="anchor-n">{COMMANDS.length}</span></a>
        <a href="#sec-plans" className="anchor-link">Plans <span className="anchor-n">{PLANS.length}</span></a>
        <span className="anchorbar-spacer" />
        <span className="anchorbar-turn">turn {a.turn}</span>
      </nav>

      <div className="sheet-scroll">
        {/* NOW — lead with the live action */}
        <section className="now">
          <div className="now-action">
            <span className="now-prompt" aria-hidden>❯</span>
            <span className="now-cmd" title={CURRENT_ACTION}>{CURRENT_ACTION}</span>
            <span className="now-acts">
              <button type="button" className="rowact" title="Open trace at this step"><TraceGlyph /></button>
              <CopyDot value={CURRENT_ACTION} id="now" label="Copy full command" />
            </span>
          </div>
          <div className="statstrip">
            {([
              ["tools", STATS.tools],
              ["edits", STATS.edits],
              ["reads", STATS.reads],
              ["files", STATS.files],
              ["events", STATS.events],
            ] as const).map(([label, n]) => (
              <span className="stat" key={label}><b>{n}</b> {label}</span>
            ))}
          </div>
        </section>

        {/* ACTIONS */}
        <section className="actions">
          <Ghost primary>Open conversation</Ghost>
          <Ghost>Open trace</Ghost>
          <Ghost>All changes ▸ diff</Ghost>
        </section>

        {/* RUNTIME — ONE block, no duplication */}
        <SecHead id="sec-runtime" label="Runtime" actions={<Ghost onClick={() => CopyCtx.copy(diagnostics, "diag")}>Copy diagnostics</Ghost>} />
        <div className="kvgrid">
          <KV k="model"><CopyVal value={a.model} id="rt-model" /> <span className="kv-aux">{a.effort}</span></KV>
          <KV k="branch"><CopyVal value={a.branch} id="rt-branch" /></KV>
          <KV k="cwd"><RevealRow short={a.cwd.replace(/\/Users\/[^/]+/, "~")} full={a.cwd} id="rt-cwd" copyId="rt-cwd-c" /></KV>
          <KV k="session"><RevealRow short={a.sessionId.slice(0, 13) + "…"} full={a.sessionId} id="rt-sid" copyId="rt-sid-c" /></KV>
          <KV k="transcript"><RevealRow short={"~/.codex/sessions/019ee662….jsonl"} full={a.transcript} id="rt-tx" copyId="rt-tx-c" /></KV>
        </div>
        <MoreBlock label="origin · attribution">
          <KV k="origin"><CopyVal value={a.origin} id="rt-origin" mono={false} /></KV>
          <KV k="by"><CopyVal value={a.attribution} id="rt-attr" mono={false} /></KV>
        </MoreBlock>

        {/* USAGE */}
        <SecHead id="sec-usage" label="Usage" />
        <div className="usage">
          {([
            ["in", fmt(USAGE.input)],
            ["out", fmt(USAGE.output)],
            ["cache rd", fmt(USAGE.cacheRead)],
            ["cache wr", fmt(USAGE.cacheWrite)],
            ["total", fmt(USAGE.total)],
            ["reasoning", fmt(USAGE.reasoning)],
          ] as const).map(([label, v]) => (
            <span className="ucell" key={label}>
              <span className="ucell-n">{v}</span>
              <span className="ucell-l">{label}</span>
            </span>
          ))}
          <span className="ucell ucell--ctx">
            <span className="ucell-n">{USAGE.ctxPct}%</span>
            <span className="ucell-l">context</span>
            <span className="ctxbar" aria-hidden><span className="ctxbar-fill" style={{ width: `${USAGE.ctxPct}%` }} /></span>
          </span>
        </div>

        {/* FILES — first-class grouped inventory, no cap */}
        <SecHead
          id="sec-files"
          label="Files"
          count={`${newFiles.length + modFiles.length} changed · ${readFiles.length} read`}
          actions={<>
            <span className="diff-tally"><span className="fadd">+{totalAdd}</span><span className="fdel">−{totalDel}</span></span>
            <Ghost onClick={() => CopyCtx.copy(changedPaths, "f-all")}>Copy changed</Ghost>
            <Ghost>Open all ▸ diff</Ghost>
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
          <div className="empty">No docs produced this session.</div>
        ) : null}

        <div className="sheet-foot">
          session <span className="foot-id">{a.sessionId.slice(0, 8)}</span> · {STATS.events} events · live
        </div>
      </div>
    </aside>
  );
}

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{children}</span>
    </div>
  );
}

function MoreBlock({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="more">
      <button type="button" className="more-toggle" onClick={() => setOpen((o) => !o)}>
        <CaretGlyph open={open} /> ‹more› {label}
      </button>
      {open && <div className="more-body kvgrid">{children}</div>}
    </div>
  );
}

export default function LaneDetailSheetPage() {
  const { hit, copy } = useCopy();
  // expose copy to the static CopyDot/Ctx helpers (single sheet on the page)
  CopyCtx.hit = hit;
  CopyCtx.copy = copy;

  return (
    <main className="lds-study">
      <style>{CSS}</style>
      <header className="study-head">
        <div className="eyebrow">· studies · web · lane-detail-sheet</div>
        <h1>Agent Lane · Detail Sheet</h1>
        <p className="sub">tall right-side inspector for one agent — JUMP · COPY · INVENTORY. lead with the live action, one runtime block, files as a grouped inventory.</p>
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

/* HEADER */
.sheet-head{display:flex;align-items:center;gap:10px;padding:12px 14px 11px;border-bottom:1px solid ${C.edge}}
.sheet-av{flex:none;border-radius:8px}
.sheet-ident{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.sheet-name{display:inline-flex;align-items:center;gap:6px;font-size:15px;font-weight:600;letter-spacing:-.01em;color:${C.ink}}
.sheet-sub{display:inline-flex;align-items:center;gap:6px;font-family:ui-monospace,monospace;font-size:10.5px;color:${C.dim}}
.working-dot{width:6px;height:6px;border-radius:50%;background:${C.green};box-shadow:0 0 0 3px color-mix(in srgb,${C.green} 16%,transparent);animation:pulse 2.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.harness-badge{display:inline-flex;align-items:center;gap:5px;flex:none;padding:3px 8px 3px 6px;border:1px solid ${C.edge};border-radius:5px;color:${C.muted};font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.02em}
.harness-badge .harness-label{color:${C.muted};text-transform:lowercase}
.closebtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:0;background:transparent;color:${C.dim};border-radius:6px;cursor:pointer}
.closebtn:hover{color:${C.ink};background:rgba(255,255,255,.04)}

/* anchor bar — sticky jump nav */
.anchorbar{display:flex;align-items:center;gap:4px;padding:7px 12px;border-bottom:1px solid ${C.edge};background:rgba(0,0,0,.18);position:sticky;top:0;z-index:5}
.anchor-link{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:5px;text-decoration:none;
  font-family:ui-monospace,monospace;font-size:10.5px;color:${C.muted};cursor:pointer}
.anchor-link:hover{background:rgba(255,255,255,.05);color:${C.ink}}
.anchor-n{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:14px;padding:0 4px;border-radius:7px;
  background:rgba(255,255,255,.06);color:${C.dim};font-size:9px}
.anchorbar-spacer{flex:1 1 auto}
.anchorbar-turn{margin-left:auto;font-family:ui-monospace,monospace;font-size:9.5px;color:${C.dim};display:inline-flex;align-items:center;gap:5px}
.anchorbar-turn::before{content:"";width:5px;height:5px;border-radius:50%;background:${C.green}}

/* scroll body */
.sheet-scroll{overflow-y:auto;flex:1 1 auto;padding:0 0 8px}
.sheet-scroll::-webkit-scrollbar{width:8px}
.sheet-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.07);border-radius:4px}

/* NOW */
.now{padding:13px 14px 11px;border-bottom:1px solid ${C.edgeSoft};background:color-mix(in srgb,${C.green} 3%,transparent)}
.now-action{display:flex;align-items:flex-start;gap:8px;
  background:#070809;border:1px solid color-mix(in srgb,${C.ink} 12%,transparent);border-radius:7px;
  padding:7px 9px;box-shadow:inset 0 1px 0 rgba(255,255,255,.03),0 1px 2px rgba(0,0,0,.4)}
.now-prompt{flex:none;color:color-mix(in srgb,${C.green} 80%,${C.muted});font-weight:700;font-family:ui-monospace,monospace;font-size:12px;line-height:1.5}
.now-cmd{flex:1 1 auto;min-width:0;font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.5;color:${C.ink};
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}
.now-acts{display:inline-flex;align-items:center;gap:3px;flex:none}
.statstrip{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.stat{font-family:ui-monospace,monospace;font-size:10px;color:${C.muted};padding:2px 7px;border-radius:4px;background:color-mix(in srgb,${C.ink} 4%,transparent)}
.stat b{color:${C.ink};font-weight:600}

/* ACTIONS */
.actions{display:flex;flex-wrap:wrap;gap:7px;padding:11px 14px}
.ghost{display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border:1px solid ${C.edge};border-radius:6px;
  background:rgba(255,255,255,.015);color:${C.muted};font-family:ui-monospace,monospace;font-size:11px;cursor:pointer;white-space:nowrap}
.ghost:hover{color:${C.ink};border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.04)}
.ghost--primary{color:${C.ink};border-color:color-mix(in srgb,${C.green} 36%,transparent);
  background:color-mix(in srgb,${C.green} 9%,transparent)}
.ghost--primary:hover{border-color:color-mix(in srgb,${C.green} 55%,transparent);background:color-mix(in srgb,${C.green} 14%,transparent)}

/* section head */
.sechead{display:flex;align-items:center;gap:9px;padding:16px 14px 7px;scroll-margin-top:46px}
.sechead-label{font-family:ui-monospace,monospace;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:${C.muted};flex:none}
.sechead-count{font-family:ui-monospace,monospace;font-size:9.5px;color:${C.dim};flex:none}
.sechead-rule{flex:1 1 auto;height:1px;background:${C.edge};min-width:8px}
.sechead-actions{display:inline-flex;align-items:center;gap:6px;flex:none}

/* kv grid (runtime) */
.kvgrid{display:flex;flex-direction:column;gap:0;padding:0 14px}
.kv{display:grid;grid-template-columns:74px 1fr;column-gap:10px;align-items:center;padding:4px 0;min-width:0}
.kv-k{font-family:ui-monospace,monospace;font-size:10px;color:${C.dim};text-transform:lowercase;letter-spacing:.02em}
.kv-v{font-family:ui-monospace,monospace;font-size:11px;color:${C.ink};min-width:0;display:flex;align-items:center;gap:8px}
.kv-aux{color:${C.dim};font-size:10px}

/* copy value + dot */
.cval{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%}
.cval--mono{font-family:ui-monospace,monospace}
.cval-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.cval--full .cval-text{white-space:normal;word-break:break-all}
.copydot{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;
  border:1px solid transparent;border-radius:4px;background:transparent;color:${C.faint};cursor:pointer;
  opacity:0;transition:opacity .12s ease,color .12s ease,border-color .12s ease}
.cval:hover .copydot,.frow:hover .copydot,.crow:hover .copydot,.sheet-name:hover .copydot,.kv:hover .copydot,.now-action:hover .copydot{opacity:1}
.copydot:hover{color:${C.ink};border-color:${C.edge};background:rgba(255,255,255,.04)}
.copydot--ok{opacity:1;color:${C.green};border-color:color-mix(in srgb,${C.green} 30%,transparent)}

/* reveal row */
.reveal{display:inline-flex;align-items:center;gap:6px;min-width:0}
.reveal-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:0;background:transparent;color:${C.dim};cursor:pointer;border-radius:3px}
.reveal-toggle:hover{color:${C.ink}}

/* more block */
.more{padding:2px 14px 0}
.more-toggle{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:${C.dim};cursor:pointer;
  font-family:ui-monospace,monospace;font-size:10px;padding:4px 0}
.more-toggle:hover{color:${C.muted}}
.more-body{padding:2px 0 4px}

/* USAGE */
.usage{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin:0 14px;border:1px solid ${C.edge};border-radius:7px;overflow:hidden;background:${C.edge}}
.ucell{display:flex;flex-direction:column;gap:2px;padding:8px 10px;background:${C.panel};position:relative}
.ucell-n{font-family:ui-monospace,monospace;font-size:12px;color:${C.ink};font-variant-numeric:tabular-nums}
.ucell-l{font-family:ui-monospace,monospace;font-size:9px;color:${C.dim};text-transform:lowercase;letter-spacing:.04em}
.ucell--ctx .ucell-n{color:${C.green}}
.ctxbar{position:absolute;left:10px;right:10px;bottom:6px;height:2px;border-radius:2px;background:rgba(255,255,255,.07);overflow:hidden}
.ctxbar-fill{display:block;height:100%;background:${C.green};border-radius:2px}

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

/* foot */
.sheet-foot{margin:18px 14px 6px;padding-top:11px;border-top:1px solid ${C.edgeSoft};
  font-family:ui-monospace,monospace;font-size:9.5px;color:${C.faint};display:flex;align-items:center;gap:6px}
.foot-id{color:${C.dim}}
`;
