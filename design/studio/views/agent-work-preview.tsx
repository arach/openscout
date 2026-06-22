import { Fragment } from "react";

/**
 * Agent Work-in-Progress preview — study.
 *
 * Extends the (locked) agent inspector card with a live activity block that
 * appears BELOW the static metadata while an agent is working — so you can see
 * what a long-running agent is doing without drilling into the full Observe
 * pane (⌘O) or the global Tail. The block is placed last because it is
 * variable-length: the fixed metadata keeps stable positions, the dynamic
 * content grows below and scrolls.
 *
 * Three sections, each with a quiet "open full" affordance:
 *   · NOW            — condensed Observe timeline (think / tool / ask / message)
 *                      with a live dot + turn count.
 *   · TAIL · this agent — recent system tail events scoped to this agent.
 *   · FILES · N changed — recently touched files snapshot.
 *
 * Mock shapes mirror the native types so the port is ~1:1:
 *   observe event  { kind, text, tool?, t }      ← ScoutObserveEvent
 *   tail event     { kind, summary, age }         ← ScoutTailEvent
 *   file           { path, state, touches, age }  ← ScoutObserveFile
 * (Native ScoutObserveFile carries no per-file +adds/−dels — diffs are
 *  per-event with no path link — so FILES shows `state · Nx · age`, not +/−.)
 *
 * Ports to: apps/macos/Sources/Scout/ScoutRootView.swift (ScoutAgentInspector)
 */

type AgentState = "working" | "available" | "needs-attention" | "idle" | "offline";

interface InspectorAgent {
  name: string;
  id: string;
  state: AgentState;
  role: string;
  harness: string;
  transport: string;
  model: string;
  node: string;
  branch: string;
  path: string;
  cid: string;
  session?: { id: string; started: string };
}

type ObserveKind = "think" | "tool" | "ask" | "message";
interface ObserveEvent {
  kind: ObserveKind;
  text: string;
  tool?: string;
  t: string;
}

type TailKind = "tool" | "spawn" | "io" | "system";
interface TailEvent {
  kind: TailKind;
  summary: string;
  age: string;
  origin?: string;
}

type FileState = "modified" | "created" | "deleted";
interface FileTouch {
  path: string;
  state: FileState;
  touches: number;
  age: string;
}

interface LiveData {
  turn: number;
  live: boolean;
  loading?: boolean;
  events: ObserveEvent[];
  tail: TailEvent[];
  files: FileTouch[];
}

const STATE_COLOR: Record<AgentState, string> = {
  working: "var(--status-warn-fg)",
  "needs-attention": "var(--status-error-fg)",
  available: "var(--status-ok-fg)",
  idle: "var(--scout-accent)",
  offline: "var(--studio-ink-faint)",
};

const OBSERVE_KIND: Record<ObserveKind, { label: string; color: string }> = {
  think: { label: "THINK", color: "var(--studio-ink-faint)" },
  tool: { label: "TOOL", color: "var(--scout-accent)" },
  ask: { label: "ASK", color: "var(--status-warn-fg)" },
  message: { label: "MSG", color: "var(--status-ok-fg)" },
};

const TAIL_KIND: Record<TailKind, { glyph: string; color: string }> = {
  tool: { glyph: "→", color: "var(--scout-accent)" },
  spawn: { glyph: "✦", color: "var(--status-ok-fg)" },
  io: { glyph: "·", color: "var(--studio-ink-faint)" },
  system: { glyph: "▪", color: "var(--studio-ink-muted)" },
};

const FILE_STATE_COLOR: Record<FileState, string> = {
  created: "var(--status-ok-fg)",
  modified: "var(--scout-accent)",
  deleted: "var(--status-error-fg)",
};

/* ── Mock agents + live data ────────────────────────────────────── */

const SCOUT: InspectorAgent = {
  name: "Scout",
  id: "scoutbot",
  state: "working",
  role: "Relay agent",
  harness: "codex",
  transport: "codex_app_server",
  model: "gpt-5.5",
  node: "arts-mac-mini-local",
  branch: "main",
  path: "~/dev/openscout",
  cid: "c.960f31ec",
  session: { id: "0199a2f1-8c4d-7b2a-9e10-4f6db8c1a233", started: "2m" },
};

const ATLAS: InspectorAgent = {
  name: "Atlas",
  id: "atlas.main.arts-mac-mini-local",
  state: "idle",
  role: "Session agent",
  harness: "claude",
  transport: "claude_stream_json",
  model: "opus-4.7",
  node: "arts-mac-mini-local",
  branch: "design/atlas-iconography",
  path: "~/dev/atlas",
  cid: "c.7f21aa0c",
};

const SCOUT_LIVE: LiveData = {
  turn: 3,
  live: true,
  events: [
    { kind: "message", text: "Drafting the three-bullet orientation reply…", t: "2s" },
    { kind: "tool", tool: "grep", text: "observeAgentId across ScoutCommsStore", t: "6s" },
    { kind: "tool", tool: "read", text: "ScoutRootView.swift — ScoutAgentInspector", t: "11s" },
    { kind: "think", text: "Three sections below the card: NOW, TAIL, FILES.", t: "18s" },
  ],
  tail: [
    { kind: "tool", summary: "tool_call read_file ScoutRootView.swift", age: "3s", origin: "codex" },
    { kind: "spawn", summary: "spawn pid 81234 (codex)", age: "8s", origin: "codex" },
    { kind: "io", summary: "stdout 1.2 KB", age: "12s", origin: "codex" },
    { kind: "system", summary: "turn 3 started", age: "20s", origin: "scout" },
  ],
  files: [
    { path: "apps/macos/Sources/Scout/ScoutRootView.swift", state: "modified", touches: 4, age: "3s" },
    { path: "design/studio/app/studies/agent-work-preview/page.tsx", state: "created", touches: 1, age: "1m" },
    { path: "design/studio/lib/studio-pages.ts", state: "modified", touches: 2, age: "1m" },
  ],
};

const SCOUT_LOADING: LiveData = { turn: 1, live: true, loading: true, events: [], tail: [], files: [] };
const SCOUT_EMPTY: LiveData = { turn: 1, live: true, events: [], tail: [], files: [] };

function avatarColor(_name: string): string {
  return "oklch(0.42 0.008 80)";
}

/* ── Page ───────────────────────────────────────────────────────── */

export default function AgentWorkPreviewPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <style>{`@keyframes awp-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · macos · agent-work-preview
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent work-in-progress
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          When an agent is <strong className="text-studio-ink-muted">working</strong>, a live block
          appears below the metadata card so you can see what it&apos;s doing without going a level
          deeper. <strong className="text-studio-ink-muted">NOW</strong> previews the Observe
          timeline, <strong className="text-studio-ink-muted">TAIL</strong> shows system events
          scoped to this agent, <strong className="text-studio-ink-muted">FILES</strong> snapshots
          what it&apos;s touched. It sits last because it&apos;s variable-length. Rendered at the
          real inspector width (~300px).
        </p>
      </header>

      <div className="flex flex-wrap items-start gap-10">
        <Labeled label="Working — full activity">
          <AgentCard agent={SCOUT} live={SCOUT_LIVE} />
        </Labeled>
        <Labeled label="Working — reading activity">
          <AgentCard agent={SCOUT} live={SCOUT_LOADING} />
        </Labeled>
        <Labeled label="Working — nothing yet">
          <AgentCard agent={SCOUT} live={SCOUT_EMPTY} />
        </Labeled>
        <Labeled label="Idle — no live block">
          <AgentCard agent={ATLAS} />
        </Labeled>
      </div>
    </main>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="w-[300px]">
      <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-scout-accent">
        {label}
      </div>
      {children}
    </div>
  );
}

/* ── The card ───────────────────────────────────────────────────── */

function AgentCard({ agent, live }: { agent: InspectorAgent; live?: LiveData }) {
  const showLive = agent.state === "working" && live;
  return (
    <article className="flex flex-col gap-3 overflow-hidden rounded-md border border-studio-edge bg-studio-surface p-3.5">
      <CardHeader agent={agent} />
      <Divider />
      <Section
        label="Runtime"
        rows={[
          ["Role", agent.role],
          ["Harness", agent.harness],
          ["Transport", agent.transport],
          ["Model", agent.model],
          ["Node", agent.node],
        ]}
      />
      <Divider />
      <Section
        label="Workspace"
        rows={[
          ["Branch", agent.branch],
          ["Path", agent.path],
          ["cId", agent.cid],
        ]}
      />
      {agent.session ? (
        <>
          <Divider />
          <SessionSection session={agent.session} />
        </>
      ) : null}
      <NewSessionLink />
      {showLive ? <LiveWell live={live} /> : null}
    </article>
  );
}

/** Clickable identity header → profile. State rides the presence dot only. */
function CardHeader({ agent }: { agent: InspectorAgent }) {
  const stateColor = STATE_COLOR[agent.state];
  return (
    <button
      type="button"
      className="group flex min-w-0 items-start gap-2.5 text-left"
      title={`Open ${agent.name}'s profile`}
    >
      <div
        className="relative grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full font-mono text-[12px]"
        style={{ background: avatarColor(agent.name), color: "var(--studio-canvas)" }}
      >
        {agent.name[0]?.toUpperCase()}
        <span
          className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full"
          style={{ background: stateColor, boxShadow: "0 0 0 2px var(--studio-surface)" }}
        />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="truncate font-sans text-[15px] font-semibold tracking-tight text-studio-ink decoration-studio-ink-faint underline-offset-2 group-hover:underline">
          {agent.name}
        </div>
        <div className="truncate font-mono text-[9.5px] text-studio-ink-faint">{agent.id}</div>
      </div>
    </button>
  );
}

/* ── Live block ─────────────────────────────────────────────────── */

/** The live data area — same card, but a different MATERIAL: a recessed well
 *  (darker than the surface, inset shadow) carrying a faint CRT scanline
 *  texture and a machined amber top seam. The material itself says "this part
 *  is live" — no "Live" banner, no turn badge. Bleeds to the card edges. */
function LiveWell({ live }: { live: LiveData }) {
  return (
    <div
      className="relative -mx-3.5 -mb-3.5 mt-1 flex flex-col gap-3 rounded-b-md px-3.5 pb-3.5 pt-3.5"
      style={{
        backgroundColor: "color-mix(in oklab, var(--studio-canvas) 78%, #000)",
        backgroundImage:
          "repeating-linear-gradient(0deg, color-mix(in oklab, var(--studio-ink) 5%, transparent) 0px, color-mix(in oklab, var(--studio-ink) 5%, transparent) 1px, transparent 1px, transparent 3px)",
        boxShadow: "inset 0 2px 7px -3px rgba(0,0,0,0.6)",
      }}
    >
      <ShimmerSeam />
      <NowSection live={live} />
      <WellDivider />
      <TailSection live={live} />
      <WellDivider />
      <FilesSection live={live} />
    </div>
  );
}

/** Divider tuned for the dark well (a faint light hairline, not the card edge). */
function WellDivider() {
  return (
    <div
      className="h-px w-full"
      style={{ background: "color-mix(in oklab, var(--studio-ink) 10%, transparent)" }}
    />
  );
}

/** The seam between metadata and live IS the activity cue: a static machined
 *  amber line with a bright glimmer sweeping across it — echoing the Claude
 *  Code TUI working-text shimmer. Full-bleed across the top of the well. */
function ShimmerSeam() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] overflow-hidden"
      style={{ background: "color-mix(in oklab, var(--status-warn-fg) 30%, var(--studio-edge-strong))" }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, transparent 35%, color-mix(in oklab, var(--status-warn-fg) 95%, transparent) 50%, transparent 65%, transparent 100%)",
          backgroundSize: "200% 100%",
          animation: "awp-shimmer 2.4s linear infinite",
        }}
      />
    </div>
  );
}

/** NOW — condensed Observe timeline, newest-first. */
function NowSection({ live }: { live: LiveData }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <SectionLabel>Now</SectionLabel>
        <OpenLink label="Observe" icon={<EyeIcon />} />
      </div>
      {live.loading ? (
        <Hint>Reading activity…</Hint>
      ) : live.events.length === 0 ? (
        <Hint>Waiting for activity</Hint>
      ) : (
        <div className="flex flex-col gap-2">
          {live.events.map((e, i) => (
            <NowRow key={i} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function NowRow({ event }: { event: ObserveEvent }) {
  const meta = OBSERVE_KIND[event.kind];
  const muted = event.kind === "think";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span
          className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
          style={{ color: meta.color }}
        >
          {meta.label}
        </span>
        {event.tool ? (
          <code className="rounded-[3px] bg-studio-canvas-alt px-1 py-px font-mono text-[9px] text-scout-accent">
            {event.tool}
          </code>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-[9px] text-studio-ink-faint">{event.t}</span>
      </div>
      <p
        className={`line-clamp-2 font-sans text-[11px] leading-snug ${
          muted ? "text-studio-ink-muted" : "text-studio-ink"
        }`}
      >
        {event.text}
      </p>
    </div>
  );
}

/** TAIL — system events scoped to this agent, newest-first. */
function TailSection({ live }: { live: LiveData }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <SectionLabel>Tail · this agent</SectionLabel>
        <OpenLink label="Tail" icon={<StreamIcon />} />
      </div>
      {live.tail.length === 0 ? (
        <Hint>No tail events for this agent yet</Hint>
      ) : (
        <div className="flex flex-col gap-1">
          {live.tail.map((t, i) => (
            <TailRow key={i} event={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TailRow({ event }: { event: TailEvent }) {
  const meta = TAIL_KIND[event.kind];
  return (
    <div className="flex items-baseline gap-1.5 font-mono text-[10px]">
      <span className="w-2.5 shrink-0 text-center" style={{ color: meta.color }}>
        {meta.glyph}
      </span>
      <span className="truncate text-studio-ink-muted" title={event.summary}>
        {event.summary}
      </span>
      <span className="ml-auto shrink-0 text-[9px] text-studio-ink-faint">{event.age}</span>
    </div>
  );
}

/** FILES — recently touched files snapshot. */
function FilesSection({ live }: { live: LiveData }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SectionLabel>Files</SectionLabel>
          {live.files.length ? (
            <span className="rounded-[3px] bg-studio-canvas-alt px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-muted">
              {live.files.length} changed
            </span>
          ) : null}
        </div>
        <OpenLink label="Files" icon={<FileIcon />} />
      </div>
      {live.files.length === 0 ? (
        <Hint>No file touches yet</Hint>
      ) : (
        <div className="flex flex-col gap-1">
          {live.files.map((f, i) => (
            <FileRow key={i} file={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({ file }: { file: FileTouch }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className="mt-1 h-1.5 w-1.5 shrink-0 self-center rounded-full"
        style={{ background: FILE_STATE_COLOR[file.state] }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-right font-mono text-[10px] text-studio-ink" dir="rtl" title={file.path}>
          {file.path}
        </div>
        <div className="truncate font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          {file.state} · {file.touches}× · {file.age}
        </div>
      </div>
    </div>
  );
}

/* ── Shared bits (mirrors the inspector-card study) ─────────────── */

function Section({ label, rows }: { label: string; rows: [string, string][] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>{label}</SectionLabel>
      <div className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 font-mono text-[10.5px]">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <span className="uppercase tracking-eyebrow text-studio-ink-faint">{k}</span>
            <span className="truncate text-right text-studio-ink">{v}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function SessionSection({ session }: { session: NonNullable<InspectorAgent["session"]> }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <SectionLabel>Session</SectionLabel>
        <ObserveButton />
      </div>
      <div className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 font-mono text-[10.5px]">
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">id</span>
        <span className="truncate text-right text-studio-ink" title={session.id}>
          {session.id.slice(0, 8)}
          <span className="text-studio-ink-faint">…{session.id.slice(-4)}</span>
        </span>
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">started</span>
        <span className="truncate text-right text-studio-ink-muted">{session.started} ago</span>
      </div>
    </div>
  );
}

function ObserveButton() {
  return (
    <button
      type="button"
      title="Observe this session"
      className="flex shrink-0 items-center gap-1.5 rounded-[5px] border border-studio-edge-strong bg-studio-canvas-alt px-2 py-1 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted transition-colors hover:border-[color-mix(in_oklab,var(--status-ok-fg)_50%,transparent)] hover:bg-[color-mix(in_oklab,var(--status-ok-fg)_12%,transparent)] hover:text-[var(--status-ok-fg)]"
    >
      <EyeIcon />
      Observe
    </button>
  );
}

function NewSessionLink() {
  return (
    <button
      type="button"
      className="flex items-center gap-1 self-start font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint transition-colors hover:text-scout-accent"
    >
      <PlusIcon /> New session
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
      {children}
    </div>
  );
}

/** A quiet "open full" affordance — reads as a button at rest, warms on hover. */
function OpenLink({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      title={`Open full ${label}`}
      className="flex shrink-0 items-center gap-1 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint transition-colors hover:text-scout-accent"
    >
      {icon}
      {label}
    </button>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[10px] text-studio-ink-faint">{children}</div>;
}

function Divider() {
  return <div className="h-px w-full bg-studio-edge" />;
}

/* ── Icons ──────────────────────────────────────────────────────── */

function EyeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M1.5 8S3.8 3.5 8 3.5 14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8Z" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function StreamIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 1.5h5l3 3v10H4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9 1.5v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
