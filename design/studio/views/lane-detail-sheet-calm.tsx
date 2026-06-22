"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HarnessMark } from "@/components/HarnessMark";
import { SpriteAvatar } from "@/components/SpriteAvatar";

/**
 * Agent Lane · Detail Sheet — CALM direction.
 *
 * Same surface as lane-detail-sheet (the web OPS lane inspector for one
 * agent's live work), but stripped to the FLOOR and disclosed in context.
 *
 * At rest the panel answers three things and nothing else:
 *   WHO      — agent + harness
 *   WHAT NOW — the live action, plus context health
 *   HEADLINE — the one change figure (+adds / −dels across N files)
 *
 * Everything else (full file inventory, every command, runtime ids, the raw
 * token grid, plans) lives one calm tap deep behind reveal toggles. The
 * millions-scale token dump is demoted entirely. Attention is the only thing
 * allowed to stand out — when nothing needs the human, the panel is quiet.
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
/** Compact a count to a calm magnitude (15.4M, 48.6k, 882). */
const mag = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return `${n}`;
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
function CopyVal({ value, id, display, mono = true }: { value: string; id: string; display?: string; mono?: boolean }) {
  return (
    <span className={`cval${mono ? " cval--mono" : ""}`}>
      <span className="cval-text">{display ?? value}</span>
      <CopyDot value={value} id={id} />
    </span>
  );
}

/* ── reveal: a calm, full-width disclosure with a leading caret ─────────── */
function Disclose({
  label,
  hint,
  defaultOpen = false,
  children,
}: {
  label: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`disc${open ? " disc--open" : ""}`}>
      <button type="button" className="disc-head" onClick={() => setOpen((o) => !o)}>
        <span className="disc-caret"><CaretGlyph open={open} /></span>
        <span className="disc-label">{label}</span>
        {hint != null && <span className="disc-hint">{hint}</span>}
      </button>
      {open && <div className="disc-body">{children}</div>}
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

/* ── plan row (flat — no bordered card; structure from rule + indent) ───── */
function PlanRow({ p, idx }: { p: Plan; idx: number }) {
  const [open, setOpen] = useState(false);
  const done = p.steps.filter((s) => s.state === "done").length;
  const doing = p.steps.find((s) => s.state === "doing");
  return (
    <div className={`plan${open ? " plan--open" : ""}`}>
      <button type="button" className="plan-head" onClick={() => setOpen((o) => !o)}>
        <span className="plan-caret"><CaretGlyph open={open} /></span>
        <span className="plan-title" title={p.title}>{p.title}</span>
        <span className="plan-tally">{done}/{p.steps.length}</span>
      </button>
      {!open && doing && (
        <div className="plan-now" title={doing.text}>
          <span className="plan-now-mark" aria-hidden>▸</span>
          {doing.text}
        </div>
      )}
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
  const changedCount = newFiles.length + modFiles.length;

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

  // The one variable that earns attention. Toggle to feel the quiet→loud shift.
  const [needsYou, setNeedsYou] = useState(false);

  return (
    <aside className="sheet">
      {/* HEADER — who. calm, no anchor bar, no stat strip. */}
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

      <div className="sheet-scroll">
        {/* ATTENTION — the ONLY thing allowed to stand out. quiet by default. */}
        {needsYou && (
          <section className="attn">
            <span className="attn-mark" aria-hidden />
            <div className="attn-body">
              <span className="attn-q">Push this branch and open the PR?</span>
              <div className="attn-acts">
                <Ghost primary onClick={() => setNeedsYou(false)}>Approve</Ghost>
                <Ghost onClick={() => setNeedsYou(false)}>Reply</Ghost>
              </div>
            </div>
          </section>
        )}

        {/* NOW — what it's doing, right now. the lead. */}
        <section className="now">
          <div className="now-cap">doing now</div>
          <div className="now-action">
            <span className="now-prompt" aria-hidden>❯</span>
            <span className="now-cmd" title={CURRENT_ACTION}>{CURRENT_ACTION}</span>
            <span className="now-acts">
              <button type="button" className="rowact" title="Open trace at this step"><TraceGlyph /></button>
              <CopyDot value={CURRENT_ACTION} id="now" label="Copy full command" />
            </span>
          </div>
        </section>

        {/* HEALTH — context fill. one number + bar, nothing else. */}
        <section className="health">
          <div className="health-row">
            <span className="health-k">context</span>
            <span className="health-bar" aria-hidden>
              <span className="health-fill" style={{ width: `${USAGE.ctxPct}%` }} />
            </span>
            <span className="health-v">{USAGE.ctxPct}%</span>
          </div>
        </section>

        {/* HEADLINE — the one change figure. a glance, not an inventory. */}
        <section className="headline">
          <div className="headline-fig">
            <span className="fadd">+{totalAdd}</span>
            <span className="fdel">−{totalDel}</span>
          </div>
          <div className="headline-cap">across {changedCount} files this turn</div>
        </section>

        {/* ACTIONS — the two things you'd actually do, nothing more. */}
        <section className="actions">
          <Ghost primary>Open conversation</Ghost>
          <Ghost>Open trace</Ghost>
        </section>

        {/* ── everything below is one calm tap deep ── */}
        <div className="reveals">
          <Disclose label="Files" hint={`${changedCount} changed · ${readFiles.length} read`}>
            <div className="disc-bar">
              <span className="diff-tally"><span className="fadd">+{totalAdd}</span><span className="fdel">−{totalDel}</span></span>
              <span className="disc-bar-spacer" />
              <Ghost onClick={() => CopyCtx.copy(changedPaths, "f-all")}>Copy changed</Ghost>
              <Ghost>Open all ▸ diff</Ghost>
            </div>
            <div className="filegroup">
              <div className="fglabel"><span className="fglabel-mark fglabel-mark--new" aria-hidden /> NEW <span className="fglabel-n">{newFiles.length}</span></div>
              {newFiles.map((f, i) => <FileRow key={i} f={f} idx={`new-${i}`} />)}
            </div>
            <div className="filegroup">
              <div className="fglabel"><span className="fglabel-mark fglabel-mark--mod" aria-hidden /> MODIFIED <span className="fglabel-n">{modFiles.length}</span></div>
              {modFiles.map((f, i) => <FileRow key={i} f={f} idx={`mod-${i}`} />)}
            </div>
            <Disclose label="Read" hint={`${readFiles.length} files`}>
              <div className="filegroup filegroup--nested">
                {readFiles.map((f, i) => <FileRow key={i} f={f} idx={`read-${i}`} />)}
              </div>
            </Disclose>
          </Disclose>

          <Disclose label="Commands" hint={`${COMMANDS.length} this turn`}>
            <div className="disc-bar">
              <span className="disc-bar-spacer" />
              <Ghost onClick={() => CopyCtx.copy(allCommands, "c-all")}>Copy all</Ghost>
            </div>
            <div className="cmdlist">
              {COMMANDS.map((c, i) => <CommandRow key={i} c={c} idx={`${i}`} />)}
            </div>
          </Disclose>

          <Disclose label="Plans" hint={`${PLANS.length}`}>
            <div className="planlist">
              {PLANS.map((p, i) => <PlanRow key={i} p={p} idx={i} />)}
            </div>
          </Disclose>

          <Disclose label="Runtime" hint={`${a.harness} · ${a.model}`}>
            <div className="disc-bar">
              <span className="disc-bar-spacer" />
              <Ghost onClick={() => CopyCtx.copy(diagnostics, "diag")}>Copy diagnostics</Ghost>
            </div>
            <div className="kvgrid">
              <KV k="model"><CopyVal value={a.model} id="rt-model" /> <span className="kv-aux">{a.effort}</span></KV>
              <KV k="branch"><CopyVal value={a.branch} id="rt-branch" /></KV>
              <KV k="cwd"><CopyVal value={a.cwd} id="rt-cwd" display={a.cwd.replace(/\/Users\/[^/]+/, "~")} /></KV>
              <KV k="session"><CopyVal value={a.sessionId} id="rt-sid" display={`${a.sessionId.slice(0, 13)}…`} /></KV>
              <KV k="transcript"><CopyVal value={a.transcript} id="rt-tx" display={"~/.codex/sessions/019ee662….jsonl"} /></KV>
              <KV k="origin"><CopyVal value={a.origin} id="rt-origin" mono={false} /></KV>
              <KV k="by"><CopyVal value={a.attribution} id="rt-attr" mono={false} /></KV>
            </div>
          </Disclose>

          <Disclose label="Tokens" hint={mag(USAGE.total)}>
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
            </div>
          </Disclose>

          {DOCS.length > 0 && (
            <Disclose label="Docs" hint={`${DOCS.length}`}>
              <div className="cmdlist" />
            </Disclose>
          )}
        </div>

        <div className="sheet-foot">
          <span className="foot-id">{a.sessionId.slice(0, 8)}</span> · live
          <span className="foot-spacer" />
          <button type="button" className="foot-demo" onClick={() => setNeedsYou((n) => !n)}>
            demo: {needsYou ? "clear" : "needs you"}
          </button>
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

export default function LaneDetailSheetCalmPage() {
  const { hit, copy } = useCopy();
  // expose copy to the static CopyDot/Ctx helpers (single sheet on the page)
  CopyCtx.hit = hit;
  CopyCtx.copy = copy;

  return (
    <main className="lds-study">
      <style>{CSS}</style>
      <header className="study-head">
        <div className="eyebrow">· studies · web · lane-detail-sheet-calm</div>
        <h1>Agent Lane · Detail Sheet — Calm</h1>
        <p className="sub">minimum cog-load: at rest, only who · what now · context health · the one change figure. files, commands, plans, runtime and the token dump are one calm tap deep. attention is the only thing that stands out.</p>
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
.sheet-head{display:flex;align-items:center;gap:10px;padding:14px 16px 13px;border-bottom:1px solid ${C.edge}}
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

/* scroll body — generous, calm */
.sheet-scroll{overflow-y:auto;flex:1 1 auto;padding:0 0 8px}
.sheet-scroll::-webkit-scrollbar{width:8px}
.sheet-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.07);border-radius:4px}

/* ATTENTION — the one loud thing. a left accent bar (flat band, allowed). */
.attn{display:flex;gap:11px;padding:14px 16px 15px;border-bottom:1px solid ${C.edgeSoft};
  background:color-mix(in srgb,${C.green} 6%,transparent)}
.attn-mark{flex:none;width:2px;border-radius:1px;background:${C.green};align-self:stretch;
  box-shadow:0 0 8px color-mix(in srgb,${C.green} 40%,transparent)}
.attn-body{display:flex;flex-direction:column;gap:9px;min-width:0;flex:1 1 auto}
.attn-q{font-size:13px;line-height:1.45;color:${C.ink};font-weight:500}
.attn-acts{display:inline-flex;gap:7px}

/* NOW — the lead. */
.now{padding:18px 16px 16px}
.now-cap{font-family:ui-monospace,monospace;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:${C.dim};margin-bottom:9px}
.now-action{display:flex;align-items:flex-start;gap:8px;
  background:#070809;border:1px solid color-mix(in srgb,${C.ink} 12%,transparent);border-radius:7px;
  padding:9px 11px;box-shadow:inset 0 1px 0 rgba(255,255,255,.03),0 1px 2px rgba(0,0,0,.4)}
.now-prompt{flex:none;color:color-mix(in srgb,${C.green} 80%,${C.muted});font-weight:700;font-family:ui-monospace,monospace;font-size:12px;line-height:1.5}
.now-cmd{flex:1 1 auto;min-width:0;font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.55;color:${C.ink};
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}
.now-acts{display:inline-flex;align-items:center;gap:3px;flex:none}

/* HEALTH — one calm gauge */
.health{padding:4px 16px 16px}
.health-row{display:flex;align-items:center;gap:11px}
.health-k{font-family:ui-monospace,monospace;font-size:10px;color:${C.dim};text-transform:lowercase;letter-spacing:.04em;flex:none;width:54px}
.health-bar{flex:1 1 auto;height:3px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden}
.health-fill{display:block;height:100%;background:${C.green};border-radius:3px}
.health-v{flex:none;font-family:ui-monospace,monospace;font-size:11px;color:${C.muted};font-variant-numeric:tabular-nums;min-width:34px;text-align:right}

/* HEADLINE — the single change figure, breathing */
.headline{padding:0 16px 18px;border-bottom:1px solid ${C.edgeSoft};margin-bottom:2px}
.headline-fig{display:flex;align-items:baseline;gap:10px;font-family:ui-monospace,monospace;font-size:22px;font-weight:600;letter-spacing:-.01em;line-height:1}
.headline-fig .fadd{color:${C.ink}}
.headline-fig .fdel{color:${C.dim}}
.headline-cap{margin-top:7px;font-family:ui-monospace,monospace;font-size:10.5px;color:${C.dim}}

/* ACTIONS */
.actions{display:flex;flex-wrap:wrap;gap:7px;padding:14px 16px 6px}
.ghost{display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border:1px solid ${C.edge};border-radius:6px;
  background:rgba(255,255,255,.015);color:${C.muted};font-family:ui-monospace,monospace;font-size:11px;cursor:pointer;white-space:nowrap}
.ghost:hover{color:${C.ink};border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.04)}
.ghost--primary{color:${C.ink};border-color:color-mix(in srgb,${C.green} 36%,transparent);
  background:color-mix(in srgb,${C.green} 9%,transparent)}
.ghost--primary:hover{border-color:color-mix(in srgb,${C.green} 55%,transparent);background:color-mix(in srgb,${C.green} 14%,transparent)}

/* ── REVEALS — calm progressive disclosure ── */
.reveals{padding:10px 0 0}
.disc{border-top:1px solid ${C.edgeSoft}}
.disc-head{display:flex;align-items:center;gap:9px;width:100%;border:0;background:transparent;cursor:pointer;
  padding:11px 16px;text-align:left}
.disc-head:hover{background:rgba(255,255,255,.018)}
.disc-caret{flex:none;color:${C.dim};display:inline-flex}
.disc-head:hover .disc-caret{color:${C.muted}}
.disc-label{font-family:ui-monospace,monospace;font-size:11px;color:${C.ink};letter-spacing:.01em;flex:none}
.disc-hint{margin-left:auto;font-family:ui-monospace,monospace;font-size:10px;color:${C.dim};white-space:nowrap}
.disc-body{padding:0 0 12px}
.disc--open>.disc-head .disc-label{color:${C.ink}}

/* nested disclose (read files inside files) sits a touch quieter, no top rule */
.disc-body .disc{border-top:1px solid ${C.edgeSoft};margin-top:2px}
.disc-body .disc-head{padding:9px 16px 9px 24px}
.disc-body .disc-label{font-size:10px;color:${C.muted}}

/* a small in-disclosure action bar */
.disc-bar{display:flex;align-items:center;gap:6px;padding:2px 16px 8px}
.disc-bar-spacer{flex:1 1 auto}
.diff-tally{display:inline-flex;gap:5px;font-family:ui-monospace,monospace;font-size:10px}

/* kv grid (runtime) */
.kvgrid{display:flex;flex-direction:column;gap:0;padding:0 16px}
.kv{display:grid;grid-template-columns:74px 1fr;column-gap:10px;align-items:center;padding:4px 0;min-width:0}
.kv-k{font-family:ui-monospace,monospace;font-size:10px;color:${C.dim};text-transform:lowercase;letter-spacing:.02em}
.kv-v{font-family:ui-monospace,monospace;font-size:11px;color:${C.ink};min-width:0;display:flex;align-items:center;gap:8px}
.kv-aux{color:${C.dim};font-size:10px}

/* copy value + dot */
.cval{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%}
.cval--mono{font-family:ui-monospace,monospace}
.cval-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.copydot{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;
  border:1px solid transparent;border-radius:4px;background:transparent;color:${C.faint};cursor:pointer;
  opacity:0;transition:opacity .12s ease,color .12s ease,border-color .12s ease}
.cval:hover .copydot,.frow:hover .copydot,.crow:hover .copydot,.sheet-name:hover .copydot,.kv:hover .copydot,.now-action:hover .copydot{opacity:1}
.copydot:hover{color:${C.ink};border-color:${C.edge};background:rgba(255,255,255,.04)}
.copydot--ok{opacity:1;color:${C.green};border-color:color-mix(in srgb,${C.green} 30%,transparent)}

/* TOKENS (demoted, flat grid only when revealed) */
.usage{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin:0 16px;border:1px solid ${C.edge};border-radius:7px;overflow:hidden;background:${C.edge}}
.ucell{display:flex;flex-direction:column;gap:2px;padding:8px 10px;background:${C.panel}}
.ucell-n{font-family:ui-monospace,monospace;font-size:12px;color:${C.ink};font-variant-numeric:tabular-nums}
.ucell-l{font-family:ui-monospace,monospace;font-size:9px;color:${C.dim};text-transform:lowercase;letter-spacing:.04em}

/* FILES */
.fadd{color:${C.muted}}.fdel{color:${C.dim}}
.filegroup{padding:0 16px;margin-top:4px}
.filegroup--nested{margin-top:0}
.fglabel{display:flex;align-items:center;gap:7px;padding:7px 0 4px;font-family:ui-monospace,monospace;font-size:9px;font-weight:600;letter-spacing:.1em;color:${C.dim};width:100%;border:0;background:transparent;text-align:left}
.fglabel-mark{width:6px;height:6px;border-radius:1.5px;flex:none}
.fglabel-mark--new{background:${C.green}}
.fglabel-mark--mod{background:${C.muted}}
.fglabel-mark--read{background:${C.faint}}
.fglabel-n{color:${C.faint};font-weight:400}
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

/* COMMANDS */
.cmdlist{padding:0 16px}
.crow{display:flex;align-items:center;gap:8px;padding:4px 6px;margin:0 -6px;border-radius:5px;min-width:0}
.crow:hover{background:rgba(255,255,255,.025)}
.cmark{flex:none;width:12px;text-align:center;font-family:ui-monospace,monospace;font-size:11px;color:${C.dim}}
.crow--bash .cmark{color:color-mix(in srgb,${C.green} 70%,${C.muted})}
.ctext{flex:1 1 auto;min-width:0;font-family:ui-monospace,monospace;font-size:11px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.crow--bash .ctext{color:${C.ink}}
.cresult{flex:none;font-family:ui-monospace,monospace;font-size:9.5px;color:${C.dim};white-space:nowrap}
.crow-acts{flex:none;display:inline-flex;align-items:center}

/* PLANS — flat rows, no bordered card */
.planlist{padding:0 16px;display:flex;flex-direction:column}
.plan{border-top:1px solid ${C.edgeSoft}}
.plan:first-child{border-top:0}
.plan-head{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;cursor:pointer;padding:9px 0;text-align:left;min-width:0}
.plan-head:hover .plan-title{color:${C.ink}}
.plan-caret{flex:none;color:${C.dim};display:inline-flex}
.plan-title{flex:1 1 auto;min-width:0;font-size:12px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plan-tally{flex:none;font-family:ui-monospace,monospace;font-size:9.5px;color:${C.dim}}
.plan-now{display:flex;align-items:baseline;gap:7px;padding:0 0 9px 18px;font-family:ui-monospace,monospace;font-size:10.5px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plan-now-mark{flex:none;color:${C.green}}
.plan-steps{padding:0 0 11px 18px;display:flex;flex-direction:column;gap:3px}
.pstep{display:flex;align-items:baseline;gap:8px;font-family:ui-monospace,monospace;font-size:10.5px;color:${C.muted};padding-top:5px}
.pstep-box{flex:none;width:11px;text-align:center;color:${C.dim}}
.pstep--done .pstep-text{color:${C.dim};text-decoration:line-through}
.pstep--doing .pstep-box{color:${C.green}}
.pstep--doing .pstep-text{color:${C.ink}}
.plan-foot{margin-top:8px}

/* foot */
.sheet-foot{margin:14px 16px 6px;padding-top:12px;border-top:1px solid ${C.edgeSoft};
  font-family:ui-monospace,monospace;font-size:9.5px;color:${C.faint};display:flex;align-items:center;gap:6px}
.foot-id{color:${C.dim}}
.foot-spacer{flex:1 1 auto}
.foot-demo{border:0;background:transparent;color:${C.faint};font-family:ui-monospace,monospace;font-size:9.5px;cursor:pointer;padding:0}
.foot-demo:hover{color:${C.muted}}
`;
