"use client";

import { useState } from "react";
import { HarnessMark } from "@/components/HarnessMark";
import { SpriteAvatar } from "@/components/SpriteAvatar";

/**
 * Agent Lanes · Card — design surface for the web OPS lane card.
 * Full card: identity header → summary panel → trace timeline, plus the
 * harness brand-mark set. Iterate here, port to
 * packages/web/client/screens/ops/AgentLaneSummaryCard.tsx + SessionObserve.
 */

const HARNESSES = ["claude", "codex", "grok", "gemini", "cursor", "github", "opencode", "amp", "pi", "native", "worker", "quad"] as const;

type FileRow = { state: "mod" | "new" | "read"; path: string };

/** Tools we know how to style (Claude Code / Codex tool surface). */
type ToolName = "Read" | "Edit" | "Write" | "Bash" | "Grep" | "Glob" | "Task" | "WebFetch" | "WebSearch" | "TodoWrite";
type Todo = { state: "done" | "doing" | "todo"; text: string };

/** The normalized 7-kind taxonomy from packages/web/server/core/observe/service.ts */
type TraceEv =
  | { t?: string; kind: "boot"; text: string }
  | { t?: string; kind: "message"; dir: "to" | "from"; text?: string }
  | { t?: string; kind: "think"; text?: string }
  | { t?: string; kind: "ask"; text: string }
  | { t?: string; kind: "note"; text: string }
  | { t?: string; kind: "system"; text: string; error?: boolean }
  | { t?: string; kind: "tool"; tool: ToolName; arg?: string; diff?: { add: number; del: number }; result?: string; todos?: Todo[] };

type Lane = {
  name: string;
  harness: string;
  model: string | null;
  effort: string | null;
  cwd: string;
  branch: string | null;
  sessionId: string;
  parentSessionId?: string;
  time: string;
  working: boolean;
  headDir: "to" | "from";
  head: string;
  stats: { tools: number; edits: number; reads: number; files: number };
  files: FileRow[];
  moreFiles?: number;
  trace: TraceEv[];
};

const LANES: Lane[] = [
  {
    name: "openscout",
    harness: "claude",
    model: "opus-4.8",
    effort: "high",
    cwd: "dev/openscout",
    branch: "codex/preserve-in-flight-work",
    sessionId: "8f2a3c1",
    time: "28m",
    working: true,
    headDir: "to",
    head: "Done — type-clean. Reload /ops/lanes and the unified secondary line lands.",
    stats: { tools: 106, edits: 19, reads: 9, files: 19 },
    files: [
      { state: "mod", path: "studio-pages.ts" },
      { state: "mod", path: "agent-lanes-card.tsx" },
      { state: "mod", path: "HarnessMark.tsx" },
    ],
    trace: [
      { t: "1h", kind: "think", text: "Remove the dead corner-chip rules, then re-run tsc to confirm clean." },
      { t: "1h", kind: "tool", tool: "Edit", arg: "…/screens/ops/agent-lanes.css", diff: { add: 4, del: 22 } },
      { t: "1h", kind: "tool", tool: "Bash", arg: "tsc --noEmit -p . | grep HarnessMark", result: "0 errors" },
      { t: "58m", kind: "note", text: "wrote /tmp/lane-card.png" },
      { t: "48m", kind: "message", dir: "from", text: "let's do a lane agent lane study. beautiful and perfect" },
      { t: "44m", kind: "ask", text: "Center the harness with the name, or bottom-align?" },
      { t: "31m", kind: "message", dir: "to", text: "Building the full lane card — header, summary, trace." },
    ],
  },
  {
    name: "lattices",
    harness: "codex",
    model: "gpt-5.5",
    effort: "xhigh",
    cwd: "dev/lattices",
    branch: "main",
    sessionId: "4c1b907",
    parentSessionId: "9d7e2f5",
    time: "16m",
    working: false,
    headDir: "to",
    head: "Merged PR #250 into main. Merge commit 44bcad1.",
    stats: { tools: 55, edits: 0, reads: 12, files: 16 },
    files: [
      { state: "mod", path: "StudioLayersView.swift" },
      { state: "mod", path: "PiChatSession.swift" },
      { state: "mod", path: "AgentTurnView.swift" },
    ],
    moreFiles: 10,
    trace: [
      { t: "22m", kind: "boot", text: "session started · dev/lattices · codex/gpt-5.5" },
      { t: "22m", kind: "message", dir: "from", text: "ship the layers view behind the flag" },
      { t: "21m", kind: "think", text: "Gate the layer list on the existing feature-flag primitive." },
      { t: "20m", kind: "tool", tool: "Edit", arg: "apps/macos/StudioLayersView.swift", diff: { add: 24, del: 6 } },
      { t: "17m", kind: "tool", tool: "Bash", arg: "gh pr merge 250 --squash", result: "merged 44bcad1" },
      { t: "16m", kind: "system", text: "context compacted · 142k → 38k" },
    ],
  },
];

const C = {
  bg: "#0b0d0e",
  ink: "#e8eaed",
  muted: "#9aa3a8",
  dim: "#5e676c",
  green: "#41d18a",
  red: "#d98c84",
};

function DirArrow({ dir }: { dir: "to" | "from" }) {
  return <span className={`dir dir--${dir}`} aria-hidden>{dir === "from" ? "←" : "→"}</span>;
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden className="gmark">
      <path d="M2 4.2c0-.4.3-.7.7-.7h2.1l1 1h3.5c.4 0 .7.3.7.7V9c0 .4-.3.7-.7.7H2.7c-.4 0-.7-.3-.7-.7V4.2Z" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

/** chip / compute glyph for the model line */
function ModelGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden className="gmark">
      <rect x="3.2" y="3.2" width="5.6" height="5.6" rx="1.1" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M5 1.6v1.4M7 1.6v1.4M5 9v1.4M7 9v1.4M1.6 5H3M1.6 7H3M9 5h1.4M9 7h1.4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

/** session lineage glyph (a stacked-node mark) */
function SessionGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden className="gmark">
      <circle cx="6" cy="3" r="1.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="6" cy="9" r="1.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M6 4.5v3" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/** Four edge guides (top/bottom/left/right) extended across the card. */
function GuideBox() {
  return (
    <>
      <i className="gl gl-t" /><i className="gl gl-b" /><i className="gl gl-l" /><i className="gl gl-r" />
    </>
  );
}

/** Type glyph for the centered gutter column — shape encodes the kind. */
function traceGlyph(ev: TraceEv): string {
  switch (ev.kind) {
    case "boot": return "⏻";
    case "message": return ev.dir === "from" ? "←" : "→";
    case "think": return "✦";
    case "ask": return "?";
    case "note": return "·";
    case "system": return ev.error ? "!" : "·";
    case "tool": return ev.tool === "Bash" ? "$" : "▸";
  }
}
/** Status colour for the glyph — green = human axis, red = error. */
function traceStatus(ev: TraceEv): string {
  if (ev.kind === "message" && ev.dir === "from") return " tg--in";
  if (ev.kind === "ask") return " tg--in";
  if (ev.kind === "system" && ev.error) return " tg--err";
  return "";
}

/** One trace event row — three columns: time (left) · glyph (center) · content (one start). */
function TraceRow({ ev, showTime = true, compact = false }: { ev: TraceEv; showTime?: boolean; compact?: boolean }) {
  const g = <span className={`tg${traceStatus(ev)}`} aria-hidden>{traceGlyph(ev)}</span>;
  return (
    <div className={`trow trow--${ev.kind}${compact ? " trow--compact" : ""}`}>
      {!compact && <span className="ttime">{showTime && ev.t ? ev.t : ""}</span>}
      <span className="tgut" />
      <div className="tbody">
        {ev.kind === "boot" && <div className="tprimary tprimary--system">{g}<span className="ttext">{ev.text}</span></div>}
        {ev.kind === "message" && (
          <>
            <div className="tprimary">{g}<span>message</span></div>
            {ev.text && <div className="tsub tsub--text">{ev.text}</div>}
          </>
        )}
        {ev.kind === "think" && (
          <>
            <div className="tprimary tprimary--think">{g}<span>thinking</span></div>
            {ev.text && <div className="tsub tsub--think">{ev.text}</div>}
          </>
        )}
        {ev.kind === "ask" && <div className="tprimary tprimary--ask">{g}<span className="ttext">{ev.text}</span></div>}
        {ev.kind === "note" && <div className="tprimary tnote">{g}<span className="ttext">{ev.text}</span></div>}
        {ev.kind === "system" && <div className={`tprimary tprimary--system${ev.error ? " tprimary--error" : ""}`}>{g}<span className="ttext">{ev.text}</span></div>}
        {ev.kind === "tool" && (
          <>
            <div className="tprimary tprimary--tool">
              {g}
              <span className="ttool-name">{ev.tool}</span>
              {ev.arg && <span className="targ">{ev.arg}</span>}
              {ev.diff && <span className="tdiff"><span className="tadd">+{ev.diff.add}</span><span className="tdel">−{ev.diff.del}</span></span>}
              {ev.result && <span className="tresult">{ev.result}</span>}
            </div>
            {ev.todos && (
              <div className="ttodos">
                {ev.todos.map((td, i) => (
                  <div className={`ttodo ttodo--${td.state}`} key={i}>
                    <span className="ttodo-box" aria-hidden>{td.state === "done" ? "✓" : td.state === "doing" ? "▸" : "○"}</span>
                    <span className="ttodo-text">{td.text}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Catalog samples — one styled row per kind + per tool. */
const KIND_SAMPLES: { tag: string; ev: TraceEv }[] = [
  { tag: "boot", ev: { kind: "boot", text: "session started · dev/openscout · claude/opus-4.8" } },
  { tag: "message", ev: { kind: "message", dir: "from", text: "ship the layers view behind the flag" } },
  { tag: "think", ev: { kind: "think", text: "Gate the layer list on the existing feature-flag primitive." } },
  { tag: "ask", ev: { kind: "ask", text: "Env flag or config key for the gate — which do you want?" } },
  { tag: "note", ev: { kind: "note", text: "wrote design/notes/layers.md" } },
  { tag: "system", ev: { kind: "system", text: "context compacted · 142k → 38k tokens" } },
  { tag: "system · error", ev: { kind: "system", error: true, text: "tool_result error — file not found" } },
];

const TOOL_SAMPLES: { tag: string; ev: TraceEv }[] = [
  { tag: "Read", ev: { kind: "tool", tool: "Read", arg: "src/view-model/layers.ts" } },
  { tag: "Edit", ev: { kind: "tool", tool: "Edit", arg: "apps/macos/StudioLayersView.swift", diff: { add: 24, del: 6 } } },
  { tag: "Write", ev: { kind: "tool", tool: "Write", arg: "design/notes/layers.md", result: "new file" } },
  { tag: "Bash", ev: { kind: "tool", tool: "Bash", arg: "gh pr merge 250 --squash", result: "merged 44bcad1" } },
  { tag: "Grep", ev: { kind: "tool", tool: "Grep", arg: '"featureFlag\\\\(" -n', result: "14 matches" } },
  { tag: "Glob", ev: { kind: "tool", tool: "Glob", arg: "**/*.swift", result: "212 files" } },
  { tag: "Task", ev: { kind: "tool", tool: "Task", arg: "Explore — map the flag system" } },
  { tag: "WebFetch", ev: { kind: "tool", tool: "WebFetch", arg: "developer.apple.com/…/layers" } },
  { tag: "WebSearch", ev: { kind: "tool", tool: "WebSearch", arg: '"swiftui layer compositing"' } },
  { tag: "TodoWrite", ev: { kind: "tool", tool: "TodoWrite", todos: [
    { state: "done", text: "wrap layer list in flag gate" },
    { state: "doing", text: "wire the config key" },
    { state: "todo", text: "merge + verify on device" },
  ] } },
];

function LaneCard({ lane, guides }: { lane: Lane; guides: boolean }) {
  return (
    <section className={`card${lane.working ? " card--working" : ""}${guides ? " guides-on" : ""}`}>
      {/* header — avatar + big name (hero), harness centered with the name;
          recent-activity + collapse caret pinned to the top corner */}
      <div className="head">
        <span className="anchor anchor--av"><GuideBox /><SpriteAvatar name={lane.name} size={46} className="lane-av" /></span>
        <div className="title">
          <span className="name">{lane.name}</span>
          <span className="subid">
            <SessionGlyph /><span className="val">{lane.sessionId}</span>
            {lane.parentSessionId && <><span className="gchar" aria-hidden>↳</span><span className="val">{lane.parentSessionId}</span></>}
          </span>
        </div>
        <span className="anchor anchor--hm"><GuideBox /><HarnessMark harness={lane.harness} size={21} className="hmark" /></span>
        <div className="corner">
          <span className="time">{lane.time}</span>
          <button className="caret" aria-label="collapse">
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden><path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>

      {/* fact lines — where (cwd · branch), what (model · effort), lineage */}
      <div className="details">
        <div className="drow">
          <span className="d d--strong"><FolderGlyph /><span className="val">{lane.cwd}</span></span>
          {lane.branch && <span className="d"><span className="gchar" aria-hidden>⎇</span><span className="val">{lane.branch}</span></span>}
        </div>
        <div className="drow">
          <span className="d d--strong"><ModelGlyph /><span className="val">{lane.model ?? "—"}</span></span>
          {lane.effort && <span className="d d--dim">{lane.effort}</span>}
        </div>
      </div>

      {/* summary panel */}
      <div className="summary">
        <div className="current">
          <DirArrow dir={lane.headDir} />
          <span className="head-text">{lane.head}</span>
        </div>
        <div className="stats">
          {([
            [lane.stats.tools, "tools"],
            [lane.stats.edits, "edits"],
            [lane.stats.reads, "reads"],
            [lane.stats.files, "files"],
          ] as const).filter(([n]) => n > 0).map(([n, label]) => (
            <span className="stat" key={label}>{n} {label}</span>
          ))}
        </div>
        <div className="files">
          {lane.files.map((f, i) => (
            <div className="file" key={i}>
              <span className={`fstate fstate--${f.state}`}>{f.state}</span>
              <span className="fpath">{f.path}</span>
            </div>
          ))}
          {lane.moreFiles ? <div className="fmore">+{lane.moreFiles} more changed</div> : null}
        </div>
      </div>

      {/* trace */}
      <div className="trace">
        <div className="trace-head"><span className="trace-label">Trace</span><span className="trace-span">last 30m · {lane.trace.length} events</span></div>
        <div className="tlist">
          <span className="t-spine" aria-hidden />
          {lane.trace.map((ev, i) => {
            const prev = lane.trace[i - 1];
            const showTime = !prev || prev.t !== ev.t;
            return <TraceRow key={i} ev={ev} showTime={showTime} />;
          })}
        </div>
      </div>
    </section>
  );
}

export default function AgentLanesCardPage() {
  const [guides, setGuides] = useState(false);
  return (
    <main className="lanes-study">
      <style>{CSS}</style>
      <header className="study-head">
        <div className="eyebrow">· studies · web · agent-lanes-card</div>
        <h1>Agent Lanes · Card</h1>
        <p className="sub">full lane card — identity · summary · trace — and the harness brand-mark set</p>
        <label className="toggle">
          <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} />
          alignment guides (also on card hover)
        </label>
      </header>

      <div className="lane-row">
        {LANES.map((lane, i) => <LaneCard key={i} lane={lane} guides={guides} />)}
      </div>

      <h2 className="sec">Trace · event kinds</h2>
      <div className="catalog">
        {KIND_SAMPLES.map((s, i) => (
          <div className="cat-item" key={i}>
            <span className="cat-tag">{s.tag}</span>
            <TraceRow ev={s.ev} compact />
          </div>
        ))}
      </div>

      <h2 className="sec">Trace · tools</h2>
      <div className="catalog">
        {TOOL_SAMPLES.map((s, i) => (
          <div className="cat-item" key={i}>
            <span className="cat-tag">{s.tag}</span>
            <TraceRow ev={s.ev} compact />
          </div>
        ))}
      </div>

      <h2 className="sec">Harness marks · large</h2>
      <div className="bigmarks">
        {HARNESSES.map((h) => (
          <div className="bm" key={h}>
            <HarnessMark harness={h} size={56} className="bm-ink" />
            <small>{h}</small>
          </div>
        ))}
      </div>
    </main>
  );
}

const CSS = `
.lanes-study{min-height:100vh;background:${C.bg};color:${C.ink};font-family:Inter,system-ui,sans-serif;padding:40px}
.study-head{margin-bottom:24px}
.eyebrow{font-family:ui-monospace,monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:${C.dim}}
.lanes-study h1{font-size:28px;font-weight:600;margin:4px 0}
.sub{font-family:ui-monospace,monospace;font-size:12px;color:${C.dim};margin:0}
.sec{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:${C.muted};margin:36px 0 14px}

.lane-row{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}

/* ── card ── */
.card{width:368px;border:1px solid rgba(255,255,255,.07);border-radius:9px;overflow:hidden;
  background:linear-gradient(180deg,rgba(255,255,255,.022),rgba(255,255,255,.006))}
.card--working{background:linear-gradient(180deg,color-mix(in srgb,${C.green} 4%,rgba(255,255,255,.02)),rgba(255,255,255,.006))}

/* working motion — only active lanes move; resting lanes stay still. subtle:
   an occasional blink + accent shimmer + a slow breathe (a couple of things,
   not drastic), plus a gentle pulse on the live activity line. */
@keyframes av-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}
@keyframes av-blink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.12)}}
@keyframes av-shimmer{0%,100%{opacity:.95}50%{opacity:.5}}
@keyframes spine-pulse{0%,100%{opacity:.78}50%{opacity:1}}
.card--working .lane-av{transform-origin:center;animation:av-breathe 3.6s ease-in-out infinite}
.card--working .sprite-cell--eye{transform-box:fill-box;transform-origin:center;animation:av-blink 4.8s ease-in-out infinite}
.card--working .sprite-cell--accent{animation:av-shimmer 2.8s ease-in-out infinite}
.card--working .sprite-cell--accent:nth-of-type(even){animation-duration:3.5s;animation-delay:1s}
.card--working .t-spine{animation:spine-pulse 3.2s ease-in-out infinite}
/* pupils occasionally glance left/right (avatar default, not per-creature) */
@keyframes pupil-glance{0%,22%{transform:translateX(0)}34%,48%{transform:translateX(1px)}60%,74%{transform:translateX(-1px)}86%,100%{transform:translateX(0)}}
.card--working .sprite-pupil{transform-box:fill-box;transform-origin:center;animation:pupil-glance 6.5s ease-in-out infinite}
/* a faint accent glow flows down the live activity line (ambient, around the card) */
@keyframes spine-flow{0%{top:-12%;opacity:0}14%{opacity:.8}86%{opacity:.8}100%{top:100%;opacity:0}}
.card--working .t-spine::after{content:"";position:absolute;left:50%;transform:translateX(-50%);width:3px;height:15px;border-radius:3px;
  background:linear-gradient(180deg,transparent,color-mix(in srgb,${C.green} 60%,transparent),transparent);filter:blur(.4px);animation:spine-flow 3s linear infinite}
@media (prefers-reduced-motion:reduce){
  .card--working .lane-av,.card--working .sprite-cell--eye,.card--working .sprite-cell--accent,.card--working .sprite-pupil,.card--working .t-spine{animation:none}
  .card--working .t-spine::after{display:none}
}

/* header — avatar + big name (hero), harness centered with the name;
   recent-activity + collapse caret pinned to the top corner */
/* top-aligned: the avatar anchors the header, name + session-id align to its top */
.head{position:relative;display:flex;align-items:flex-start;gap:10px;padding:9px 13px 6px}
.title{display:flex;flex-direction:column;gap:1px;flex:0 1 auto;min-width:0;max-width:calc(100% - 132px)}
.name{font-size:16px;font-weight:600;letter-spacing:-.02em;color:${C.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.subid{display:inline-flex;align-items:center;gap:5px;font-family:ui-monospace,monospace;font-size:9.5px;color:${C.dim};min-width:0}
.subid .gmark{color:${C.dim};flex:none}
.subid .gchar{color:${C.dim};flex:none;font-size:10px;line-height:1}
.subid .val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.anchor--hm{align-self:flex-start;margin-top:1px}
.hmark{color:${C.muted};display:inline-flex}
.card--working .hmark{color:${C.ink}}
.corner{position:absolute;top:11px;right:14px;display:flex;align-items:center;gap:7px}
.time{font-family:ui-monospace,monospace;font-size:10.5px;color:${C.dim}}
.caret{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;
  border:0;background:transparent;color:${C.dim};border-radius:6px;cursor:pointer}

/* fact lines — glyph-led, one cluster per concern, ready to grow (session/parent) */
.details{display:flex;flex-direction:column;gap:3px;padding:0 13px 9px}
.drow{display:flex;align-items:center;gap:13px;flex-wrap:wrap;font-family:ui-monospace,monospace;font-size:11px;min-width:0}
.d{display:inline-flex;align-items:center;gap:5px;min-width:0;color:${C.muted}}
.d .gmark{color:${C.dim};flex:none}
.d .gchar{color:${C.dim};flex:none;font-size:11px;line-height:1}
.d .val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.d--strong{color:${C.ink}}
.d--dim{color:${C.dim}}
.drow--lineage .d{color:${C.dim}}

/* alignment guides — super-thin dashed (striped) crosshairs centered on the
   avatar + harness logo. Reveal on card hover or via the toggle. */
.toggle{display:inline-flex;align-items:center;gap:7px;margin-top:14px;font-family:ui-monospace,monospace;font-size:11px;color:${C.muted};cursor:pointer}
.toggle input{accent-color:${C.green}}
.card{position:relative}
/* per-icon bounding guides — top/bottom/left/right edges of each logo/avatar,
   extended across the card as super-thin striped lines */
.anchor{position:relative;display:inline-flex}
.gl{position:absolute;opacity:0;transition:opacity .16s ease;pointer-events:none;z-index:6}
.gl-t,.gl-b{left:-600px;right:-600px;height:1px;
  background:repeating-linear-gradient(90deg,rgba(255,255,255,.26) 0 3px,transparent 3px 6px)}
.gl-l,.gl-r{top:-600px;bottom:-600px;width:1px;
  background:repeating-linear-gradient(0deg,rgba(255,255,255,.26) 0 3px,transparent 3px 6px)}
.gl-t{top:0}.gl-b{bottom:0}.gl-l{left:0}.gl-r{right:0}
.card:hover .gl,.card.guides-on .gl{opacity:1}

/* the trace's single structural vertical is the spine itself — no overlaid
   guides. On hover it just brightens to read as the alignment line. */
.trace{position:relative}

/* summary — the current-state screen: a bezeled box with a dark recessed interior
   (same "dark screen" vibe as the trace below), green-tinted while working. */
.summary{margin:4px 13px 9px;padding:9px 10px;border:1px solid rgba(255,255,255,.06);border-radius:7px;
  background:rgba(0,0,0,.2);display:flex;flex-direction:column;gap:7px}
.card--working .summary{border-color:color-mix(in srgb,${C.green} 14%,transparent);background:color-mix(in srgb,${C.green} 4%,rgba(0,0,0,.22))}
.current{display:flex;gap:6px;font-size:12px;line-height:1.35;color:${C.ink}}
.head-text{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* direction reads from the arrow shape (←/→), not colour — uniform with all marks */
.dir{font-family:ui-monospace,monospace;flex:none;font-weight:600;color:${C.dim}}
/* stats — understated subtle pills (matching the app's .s-agent-lane-stat):
   a faint ink-wash bg, muted mono, small. grounded but quiet, not a heavy bar. */
.stats{display:flex;flex-wrap:wrap;gap:5px}
.stat{display:inline-flex;align-items:center;padding:2px 7px;border-radius:4px;
  font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.01em;color:${C.muted};
  background:color-mix(in srgb,${C.ink} 4%,transparent)}
.files{display:flex;flex-direction:column;gap:2px}
.file{display:flex;gap:8px;align-items:baseline;font-family:ui-monospace,monospace;font-size:11px}
.fstate{color:${C.dim};text-transform:uppercase;font-size:9px;letter-spacing:.04em;width:24px;flex:none}
.fstate--mod,.fstate--new{color:${C.muted}}
.fpath{color:${C.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fmore{font-family:ui-monospace,monospace;font-size:10.5px;color:${C.dim};padding-left:32px}

/* trace — the BOTTOM section: a recessed log panel split from the identity/summary
   above by a full-width divider + darker inset background. */
.trace{padding:9px 13px 12px;border-top:1px solid rgba(255,255,255,.07);background:rgba(0,0,0,.22)}
.trace-head{display:flex;align-items:baseline;justify-content:space-between;padding:0 0 7px}
.trace-label{font-family:ui-monospace,monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:${C.muted}}
.trace-span{font-family:ui-monospace,monospace;font-size:10px;color:${C.dim}}
/* three columns: time (left) · spine line · content. the glyph is the FIRST
   CHARACTER of the content; the spine is a clean, consistent vertical rule. */
.trow{display:grid;grid-template-columns:22px 14px 1fr;column-gap:6px;align-items:start}
.trow--compact{grid-template-columns:14px 1fr}
.ttime{font-family:ui-monospace,monospace;font-size:10px;line-height:16px;color:${C.dim};text-align:left}
.tgut{position:relative;align-self:stretch}
/* card timeline — ONE continuous spine, very thin, slight accent gradient that
   fades at top + bottom (drawn from the real lanes activity line). */
.tlist{position:relative}
.t-spine{position:absolute;left:35px;top:7px;bottom:9px;width:1px;
  background:linear-gradient(180deg,transparent 0%,color-mix(in srgb,${C.green} 34%,transparent) 13%,color-mix(in srgb,${C.green} 50%,transparent) 50%,color-mix(in srgb,${C.green} 34%,transparent) 87%,transparent 100%)}
/* per-event elbow — a thin accent tick from the spine to each event (connected feel) */
.tbody{position:relative;padding:0 0 7px;min-width:0}
.tbody::before{content:"";position:absolute;left:-13px;top:8px;width:11px;height:1px;background:color-mix(in srgb,${C.green} 28%,transparent)}
/* catalog keeps a per-row accented spine (continuous via stacking) + the same elbow */
.cat-item .tgut::before{content:"";position:absolute;left:50%;top:0;bottom:0;width:1px;background:color-mix(in srgb,${C.green} 38%,transparent);transform:translateX(-50%)}
.catalog .cat-item:first-child .tgut::before{top:8px}
.catalog .cat-item:last-child .tgut::before{bottom:auto;height:8px}
/* content line — glyph leads; shape = kind, colour = status (green axis / red error) */
.tprimary{display:flex;align-items:baseline;gap:6px;font-family:ui-monospace,monospace;font-size:11px;line-height:16px;color:${C.muted};min-width:0}
.tg{flex:none;width:11px;text-align:center;color:${C.dim}}
.tg--in{color:${C.green}}
.tg--err{color:${C.red}}
.ttext{min-width:0;overflow-wrap:anywhere}
.tprimary--think{color:${C.dim};font-style:italic}
.tprimary--ask{color:${C.ink}}
.tprimary--system{color:${C.dim}}
.tprimary--error{color:${C.red}}
.ttool-name{color:${C.ink};flex:none}
.targ{color:${C.dim};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.tnote{color:${C.dim};font-style:italic}
/* detail lines hang under the primary text (11px glyph + 6px gap) */
.tsub{padding-left:17px;margin-top:3px;min-width:0}
.tsub--think{font-size:12px;line-height:1.45;color:${C.dim};font-style:italic;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tsub--text{font-size:12px;line-height:1.45;color:${C.muted};display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* tool diff + result — neutral, no categorical colour */
.tdiff{display:inline-flex;gap:5px;flex:none;font-size:10px}
.tadd{color:${C.muted}}
.tdel{color:${C.dim}}
.tresult{flex:none;color:${C.dim};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
/* todo checklist (TodoWrite) */
.ttodos{display:flex;flex-direction:column;gap:2px;padding-left:20px;margin-top:4px}
.ttodo{display:flex;align-items:baseline;gap:6px;font-family:ui-monospace,monospace;font-size:10.5px;color:${C.muted}}
.ttodo-box{flex:none;width:9px;text-align:center;color:${C.dim}}
.ttodo--done .ttodo-text{color:${C.dim};text-decoration:line-through}
.ttodo--doing .ttodo-text{color:${C.ink}}

/* catalog — left label + one styled row per kind / tool */
.catalog{max-width:560px;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:14px 16px 8px;background:rgba(255,255,255,.012)}
.cat-item{display:grid;grid-template-columns:104px 1fr;column-gap:12px;align-items:start}
.cat-tag{font-family:ui-monospace,monospace;font-size:10px;color:${C.dim};text-align:right;padding-top:1px;white-space:nowrap}

/* big marks */
.bigmarks{display:flex;flex-wrap:wrap;gap:26px;padding:22px;border:1px solid rgba(255,255,255,.07);border-radius:12px;
  background:rgba(255,255,255,.012);align-items:flex-end;max-width:1000px}
.bm{display:flex;flex-direction:column;align-items:center;gap:8px}
.bm-ink{color:${C.ink};display:inline-flex}
.bm small{font-family:ui-monospace,monospace;font-size:10px;color:${C.muted}}
`;
