"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  insertionPointForId,
  studyForInsertionPoint,
} from "@/lib/studio-pages";

type StudyMode = "before" | "after";
type AgentState = "working" | "ready" | "attention" | "offline";

interface AgentFixture {
  id: string;
  name: string;
  handle: string;
  state: AgentState;
  role: string;
  harness: string;
  branch: string;
  task: string;
  last: string;
  sessionCount: number;
}

interface ProjectFixture {
  id: string;
  title: string;
  root: string;
  signal: string;
  agents: AgentFixture[];
  sessions: number;
  nativeSessions: number;
}

const PROJECTS: ProjectFixture[] = [
  {
    id: "openscout",
    title: "openscout",
    root: "~/dev/openscout",
    signal: "Working: agent view refactor study",
    sessions: 9,
    nativeSessions: 3,
    agents: [
      {
        id: "hudson",
        name: "Hudson",
        handle: "@hudson",
        state: "working",
        role: "web design system",
        harness: "codex",
        branch: "feat/studio-mode",
        task: "Refactoring the agent directory into insertion points",
        last: "18s",
        sessionCount: 3,
      },
      {
        id: "scout",
        name: "Scout",
        handle: "@scout",
        state: "attention",
        role: "operator assistant",
        harness: "codex",
        branch: "main",
        task: "Needs a call on before/after placement",
        last: "1m",
        sessionCount: 2,
      },
      {
        id: "quill",
        name: "Quill",
        handle: "@quill",
        state: "ready",
        role: "docs",
        harness: "claude",
        branch: "docs/agent-view",
        task: "Ready to turn the chosen study into copy",
        last: "7m",
        sessionCount: 1,
      },
    ],
  },
  {
    id: "hudson",
    title: "hudson",
    root: "~/dev/hudson",
    signal: "2 ready agents - 4 active sessions",
    sessions: 4,
    nativeSessions: 1,
    agents: [
      {
        id: "atlas",
        name: "Atlas",
        handle: "@atlas",
        state: "ready",
        role: "hudsonkit primitives",
        harness: "claude",
        branch: "main",
        task: "Standing by for insertion-point API work",
        last: "22m",
        sessionCount: 2,
      },
      {
        id: "pike",
        name: "Pike",
        handle: "@pike",
        state: "ready",
        role: "native bridge",
        harness: "codex",
        branch: "native/webview-host",
        task: "Reviewing WKWebView study-host options",
        last: "31m",
        sessionCount: 2,
      },
    ],
  },
  {
    id: "lattices",
    title: "lattices",
    root: "~/dev/lattices",
    signal: "Observed sessions - no active agent",
    sessions: 2,
    nativeSessions: 2,
    agents: [
      {
        id: "cobalt",
        name: "Cobalt",
        handle: "@cobalt",
        state: "offline",
        role: "workspace scanner",
        harness: "claude",
        branch: "workspace/api",
        task: "No endpoint attached",
        last: "2h",
        sessionCount: 0,
      },
    ],
  },
];

const ANCHORS = [
  { id: "agent.directory.header", scope: "page" },
  { id: "agent.directory.filters", scope: "section" },
  { id: "agent.active-strip", scope: "section" },
  { id: "agent.project-board", scope: "section" },
  { id: "agent.detail-preview", scope: "object" },
];

const STATE_LABEL: Record<AgentState, string> = {
  working: "working",
  ready: "ready",
  attention: "needs call",
  offline: "offline",
};

const STATE_COLOR: Record<AgentState, string> = {
  working: "var(--status-warn-fg)",
  ready: "var(--status-ok-fg)",
  attention: "var(--status-error-fg)",
  offline: "var(--studio-ink-faint)",
};

const HOST_ANCHOR = "agents.directory";
const HOST_INSERTION_POINT = insertionPointForId(HOST_ANCHOR);
const HOST_STUDY = studyForInsertionPoint(HOST_ANCHOR);

export default function AgentViewBeforeAfterPage() {
  const [mode, setMode] = useState<StudyMode>("before");
  const [altHeld, setAltHeld] = useState(false);
  const renderedMode: StudyMode = altHeld ? opposite(mode) : mode;
  const selectedAgent = PROJECTS[0]!.agents[0]!;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey) setAltHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!event.altKey) setAltHeld(false);
    };
    const onBlur = () => setAltHeld(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-7 grid gap-6 border-b border-studio-edge pb-7 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="max-w-[880px]">
          <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            studies / web / agent-view-before-after
          </div>
          <h1 className="mt-2 font-display text-[34px] font-medium leading-tight text-studio-ink">
            Agent view before / after
          </h1>
          <p className="mt-3 max-w-[72ch] font-sans text-[14px] leading-relaxed text-studio-ink-faint">
            A Studio clone of the Scout Agents board for rapid comparison. The
            before view keeps the current project-card model. The after view
            treats the same data as controlled insertion regions that can be
            swapped independently later.
          </p>
        </div>

        <div className="self-end">
          <ModeToggle mode={mode} renderedMode={renderedMode} onChange={setMode} />
        </div>
      </header>

      <section className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <StudyFrame mode={renderedMode}>
            {renderedMode === "before" ? (
              <BeforeAgentDirectory />
            ) : (
              <AfterAgentDirectory selectedAgent={selectedAgent} />
            )}
          </StudyFrame>
        </div>

        <aside className="space-y-5">
          <ComparisonNotes mode={renderedMode} />
          <AnchorInventory />
        </aside>
      </section>
    </main>
  );
}

function opposite(mode: StudyMode): StudyMode {
  return mode === "before" ? "after" : "before";
}

function ModeToggle({
  mode,
  renderedMode,
  onChange,
}: {
  mode: StudyMode;
  renderedMode: StudyMode;
  onChange: (mode: StudyMode) => void;
}) {
  const peeking = mode !== renderedMode;

  return (
    <div className="rounded-md border border-studio-edge bg-studio-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            compare
          </div>
          <div className="mt-1 font-sans text-[12px] text-studio-ink-muted">
            {peeking ? `Option held: showing ${renderedMode}` : "Toggle or hold Option"}
          </div>
        </div>
        <div className="grid grid-cols-2 overflow-hidden rounded border border-studio-edge">
          {(["before", "after"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={[
                "h-8 px-4 font-mono text-[10px] uppercase tracking-ch transition-colors",
                item === mode
                  ? "bg-scout-accent-soft text-scout-accent"
                  : "bg-transparent text-studio-ink-faint hover:bg-studio-canvas-alt hover:text-studio-ink",
              ].join(" ")}
              aria-pressed={item === mode}
              onClick={() => onChange(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-studio-canvas-alt">
        <div
          className="h-full bg-scout-accent transition-transform"
          style={{
            width: "50%",
            transform: renderedMode === "before" ? "translateX(0)" : "translateX(100%)",
          }}
        />
      </div>
    </div>
  );
}

function StudyFrame({
  mode,
  children,
}: {
  mode: StudyMode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-studio-edge bg-studio-canvas shadow-2xl">
      <div className="flex items-center justify-between border-b border-studio-edge bg-studio-surface px-4 py-2">
        <div className="font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint">
          Scout / Agents / {mode}
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-studio-ink-faint">
          <span className="h-2 w-2 rounded-full bg-status-warn-fg" />
          studio clone
        </div>
      </div>
      <div className="min-h-[760px] bg-studio-canvas-alt">{children}</div>
    </div>
  );
}

function BeforeAgentDirectory() {
  const summary = useMemo(() => summarize(PROJECTS), []);
  const workingAgents = useMemo(
    () => PROJECTS.flatMap((project) => project.agents).filter((agent) => agent.state === "working"),
    [],
  );

  return (
    <div className="p-5">
      <AnchorFrame label="agent.directory.header">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
              Agents
            </div>
            <h2 className="mt-1 font-display text-[30px] leading-none text-studio-ink">
              Board
            </h2>
            <div className="mt-2 font-sans text-[13px] text-studio-ink-faint">
              {summary.agents}/{summary.agents} agents - {PROJECTS.length}/{PROJECTS.length} projects
            </div>
          </div>
          <MetricStrip summary={summary} />
        </div>
      </AnchorFrame>

      <AnchorFrame label="agent.directory.filters" className="mt-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex h-9 min-w-[280px] flex-1 items-center gap-2 rounded border border-studio-edge bg-studio-surface px-3">
            <span className="font-mono text-[13px] text-studio-ink-faint">/</span>
            <input
              readOnly
              value=""
              placeholder="Search agents, projects, sessions"
              className="h-full min-w-0 flex-1 bg-transparent font-sans text-[13px] text-studio-ink outline-none placeholder:text-studio-ink-faint"
            />
          </label>
          <Segment values={["Board", "List"]} active="Board" />
          <Segment values={["All", "Working", "Ready", "Not ready"]} active="All" />
          <GhostSelect label="All harnesses" />
          <GhostSelect label="All time" />
        </div>
      </AnchorFrame>

      <AnchorFrame label="agent.active-strip" className="mt-4">
        <div className="flex items-center gap-3 overflow-x-auto">
          <div className="shrink-0 font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint">
            Working now <strong className="text-studio-ink">{workingAgents.length}</strong>
          </div>
          {workingAgents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className="flex min-w-[270px] items-center gap-2 rounded border border-studio-edge bg-studio-surface px-3 py-2 text-left"
            >
              <StateDot state={agent.state} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-sans text-[13px] font-medium text-studio-ink">
                  {agent.name}
                </span>
                <span className="block truncate font-sans text-[12px] text-studio-ink-faint">
                  {agent.task}
                </span>
              </span>
              <span className="font-mono text-[10px] text-studio-ink-faint">{agent.last}</span>
            </button>
          ))}
        </div>
      </AnchorFrame>

      <AnchorFrame label="agent.project-board" className="mt-4">
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {PROJECTS.map((project) => (
            <BeforeProjectCard key={project.id} project={project} />
          ))}
        </div>
      </AnchorFrame>

      <div className="mt-4 flex flex-wrap gap-3 border-t border-studio-edge pt-3 font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint">
        <span>{PROJECTS.length} / {PROJECTS.length} projects</span>
        <span>{summary.offline} not ready</span>
        <span>{summary.nativeSessions} harness sessions</span>
      </div>
    </div>
  );
}

function AfterAgentDirectory({ selectedAgent }: { selectedAgent: AgentFixture }) {
  const summary = useMemo(() => summarize(PROJECTS), []);

  return (
    <div className="grid min-h-[760px] grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 p-5">
        <AnchorFrame label="agent.directory.header">
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-eyebrow text-scout-accent">
                Agents
              </div>
              <h2 className="mt-1 font-display text-[30px] leading-none text-studio-ink">
                Project command center
              </h2>
              <p className="mt-2 max-w-[64ch] font-sans text-[13px] leading-relaxed text-studio-ink-faint">
                Same agent data, but the operator scans from active pressure to
                project lanes to one pinned detail preview.
              </p>
            </div>
            <div className="grid grid-cols-4 overflow-hidden rounded border border-studio-edge bg-studio-surface">
              <RefactorMetric label="working" value={summary.working} tone="warn" />
              <RefactorMetric label="ready" value={summary.ready} tone="ok" />
              <RefactorMetric label="needs call" value={summary.attention} tone="error" />
              <RefactorMetric label="sessions" value={summary.sessions} tone="info" />
            </div>
          </div>
        </AnchorFrame>

        <AnchorFrame label="agent.directory.filters" className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <FilterChip label="All projects" active />
              <FilterChip label="Needs call" count={summary.attention} />
              <FilterChip label="Working" count={summary.working} />
              <FilterChip label="Codex" count={3} />
              <FilterChip label="Claude" count={3} />
            </div>
            <button
              type="button"
              className="h-8 rounded border border-studio-edge px-3 font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint"
            >
              saved view: agent ops
            </button>
          </div>
        </AnchorFrame>

        <AnchorFrame label="agent.active-strip" className="mt-4">
          <div className="grid gap-3 lg:grid-cols-2">
            {PROJECTS[0]!.agents.slice(0, 2).map((agent) => (
              <ActionQueueItem key={agent.id} agent={agent} />
            ))}
          </div>
        </AnchorFrame>

        <AnchorFrame label="agent.project-board" className="mt-4">
          <div className="space-y-3">
            {PROJECTS.map((project) => (
              <AfterProjectLane key={project.id} project={project} selectedAgentId={selectedAgent.id} />
            ))}
          </div>
        </AnchorFrame>
      </div>

      <AnchorFrame
        label="agent.detail-preview"
        className="border-t border-studio-edge bg-studio-surface p-4 2xl:min-h-full 2xl:border-l 2xl:border-t-0"
        compact
      >
        <AgentPreview agent={selectedAgent} />
      </AnchorFrame>
    </div>
  );
}

function BeforeProjectCard({ project }: { project: ProjectFixture }) {
  const working = project.agents.filter((agent) => agent.state === "working").length;
  const ready = project.agents.filter((agent) => agent.state === "ready").length;
  const status = project.agents.some((agent) => agent.state === "working")
    ? "working"
    : project.agents.some((agent) => agent.state === "ready")
      ? "ready"
      : "offline";

  return (
    <section className="rounded-md border border-studio-edge bg-studio-surface p-4">
      <button type="button" className="block w-full text-left">
        <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint">
          <StateDot state={status} />
          {STATE_LABEL[status]}
        </span>
        <span className="mt-3 block truncate font-sans text-[18px] font-semibold text-studio-ink">
          {project.title}
        </span>
        <span className="mt-1 block truncate font-mono text-[10px] text-studio-ink-faint">
          {project.root}
        </span>
        <span className="mt-4 block min-h-[38px] font-sans text-[13px] leading-snug text-studio-ink-muted">
          {project.signal}
        </span>
      </button>

      <div className="mt-4 flex flex-wrap gap-2 font-mono text-[10px] text-studio-ink-faint">
        {working > 0 && <MetricPill label={`${working} working`} tone="warn" />}
        {ready > 0 && <MetricPill label={`${ready} ready`} tone="ok" />}
        <MetricPill label={`${project.agents.length} agents`} />
        <MetricPill label={`${project.sessions} sessions`} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {project.agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            className="inline-flex h-7 items-center gap-2 rounded border border-studio-edge bg-studio-canvas-alt px-2 font-sans text-[12px] text-studio-ink-muted"
          >
            <StateDot state={agent.state} />
            {agent.name}
          </button>
        ))}
      </div>
    </section>
  );
}

function AfterProjectLane({
  project,
  selectedAgentId,
}: {
  project: ProjectFixture;
  selectedAgentId: string;
}) {
  const projectState: AgentState = project.agents.some((agent) => agent.state === "attention")
    ? "attention"
    : project.agents.some((agent) => agent.state === "working")
      ? "working"
      : project.agents.some((agent) => agent.state === "ready")
        ? "ready"
        : "offline";

  return (
    <section className="grid gap-3 rounded-md border border-studio-edge bg-studio-surface p-3 lg:grid-cols-[220px_minmax(0,1fr)_140px]">
      <div className="min-w-0 border-b border-studio-edge pb-3 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-3">
        <div className="flex items-center gap-2">
          <StateDot state={projectState} />
          <span className="truncate font-sans text-[15px] font-semibold text-studio-ink">
            {project.title}
          </span>
        </div>
        <div className="mt-1 truncate font-mono text-[10px] text-studio-ink-faint">
          {project.root}
        </div>
        <div className="mt-3 font-sans text-[12px] leading-snug text-studio-ink-muted">
          {project.signal}
        </div>
      </div>

      <div className="min-w-0 space-y-2">
        {project.agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            className={[
              "grid w-full min-w-0 grid-cols-[18px_minmax(0,1fr)_90px] items-center gap-2 rounded px-2 py-2 text-left",
              agent.id === selectedAgentId
                ? "bg-scout-accent-soft text-studio-ink"
                : "bg-studio-canvas-alt text-studio-ink-muted",
            ].join(" ")}
          >
            <StateDot state={agent.state} />
            <span className="min-w-0">
              <span className="block truncate font-sans text-[13px] font-medium">
                {agent.name} <span className="text-studio-ink-faint">{agent.handle}</span>
              </span>
              <span className="block truncate font-sans text-[12px] text-studio-ink-faint">
                {agent.task}
              </span>
            </span>
            <span className="justify-self-end font-mono text-[10px] text-studio-ink-faint">
              {agent.sessionCount} sessions
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-row gap-2 lg:flex-col">
        <MetricPill label={`${project.sessions} Scout`} tone="info" />
        <MetricPill label={`${project.nativeSessions} native`} />
        <button
          type="button"
          className="mt-auto h-8 rounded bg-scout-accent-soft px-3 font-mono text-[10px] uppercase tracking-ch text-scout-accent"
        >
          open lane
        </button>
      </div>
    </section>
  );
}

function ActionQueueItem({ agent }: { agent: AgentFixture }) {
  const attention = agent.state === "attention";
  return (
    <button
      type="button"
      className={[
        "grid min-h-[92px] grid-cols-[3px_minmax(0,1fr)] overflow-hidden rounded-md border text-left",
        attention
          ? "border-status-error-fg bg-status-error-bg"
          : "border-studio-edge bg-studio-surface",
      ].join(" ")}
    >
      <span
        className="h-full"
        style={{ background: STATE_COLOR[agent.state] }}
        aria-hidden
      />
      <span className="min-w-0 p-3">
        <span className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint">
            {STATE_LABEL[agent.state]}
          </span>
          <span className="font-mono text-[10px] text-studio-ink-faint">{agent.last}</span>
        </span>
        <span className="mt-2 block truncate font-sans text-[15px] font-semibold text-studio-ink">
          {agent.name} - {agent.role}
        </span>
        <span className="mt-1 block font-sans text-[13px] leading-snug text-studio-ink-muted">
          {agent.task}
        </span>
      </span>
    </button>
  );
}

function AgentPreview({ agent }: { agent: AgentFixture }) {
  return (
    <div className="flex h-full min-h-[620px] flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            pinned agent
          </div>
          <h3 className="mt-2 font-display text-[24px] leading-none text-studio-ink">
            {agent.name}
          </h3>
          <div className="mt-1 font-mono text-[10px] text-studio-ink-faint">
            {agent.handle}
          </div>
        </div>
        <StateDot state={agent.state} large />
      </div>

      <div className="mt-5 space-y-3">
        <PreviewRow label="state" value={STATE_LABEL[agent.state]} />
        <PreviewRow label="role" value={agent.role} />
        <PreviewRow label="harness" value={agent.harness} />
        <PreviewRow label="branch" value={agent.branch} />
        <PreviewRow label="sessions" value={String(agent.sessionCount)} />
      </div>

      <section className="mt-5 border-t border-studio-edge pt-4">
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          current work
        </div>
        <p className="mt-2 font-sans text-[13px] leading-relaxed text-studio-ink-muted">
          {agent.task}
        </p>
      </section>

      <section className="mt-5 border-t border-studio-edge pt-4">
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          insertion target
        </div>
        <code className="mt-2 block rounded border border-studio-edge bg-studio-canvas-alt px-3 py-2 font-mono text-[11px] text-scout-accent">
          agent.detail-preview
        </code>
      </section>

      <div className="mt-auto grid grid-cols-2 gap-2 pt-6">
        <button className="h-9 rounded border border-studio-edge font-mono text-[10px] uppercase tracking-ch text-studio-ink-muted">
          observe
        </button>
        <button className="h-9 rounded bg-scout-accent-soft font-mono text-[10px] uppercase tracking-ch text-scout-accent">
          message
        </button>
      </div>
    </div>
  );
}

function MetricStrip({ summary }: { summary: ReturnType<typeof summarize> }) {
  return (
    <div className="grid grid-cols-4 overflow-hidden rounded border border-studio-edge bg-studio-surface">
      <RefactorMetric label="working" value={summary.working} tone="warn" />
      <RefactorMetric label="ready" value={summary.ready} tone="ok" />
      <RefactorMetric label="not ready" value={summary.offline} tone="neutral" />
      <RefactorMetric label="sessions" value={summary.sessions} tone="info" />
    </div>
  );
}

function RefactorMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "error" | "info" | "neutral";
}) {
  return (
    <div className="border-r border-studio-edge px-3 py-2 last:border-r-0">
      <div
        className="font-sans text-[20px] font-semibold leading-none"
        style={{ color: `var(--status-${tone}-fg)` }}
      >
        {value}
      </div>
      <div className="mt-1 truncate font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
        {label}
      </div>
    </div>
  );
}

function AnchorFrame({
  label,
  className = "",
  compact = false,
  children,
}: {
  label: string;
  className?: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={[
        "relative border border-dashed border-studio-edge-strong",
        compact ? "" : "rounded-md bg-studio-canvas p-3",
        className,
      ].join(" ")}
      data-studio-anchor={label}
    >
      <div className="pointer-events-none absolute right-2 top-2 z-10 rounded bg-studio-canvas px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-ch text-studio-ink-faint">
        {label}
      </div>
      {children}
    </section>
  );
}

function AnchorInventory() {
  return (
    <div className="space-y-5">
      <section className="rounded-md border border-studio-edge bg-studio-surface p-4">
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          registered host point
        </div>
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-[1fr_72px] gap-3 border-b border-studio-edge pb-2">
            <code className="truncate font-mono text-[11px] text-studio-ink-muted">
              {HOST_INSERTION_POINT?.id ?? HOST_ANCHOR}
            </code>
            <span className="justify-self-end rounded bg-studio-canvas-alt px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
              {HOST_INSERTION_POINT?.scope ?? "page"}
            </span>
          </div>
          <div className="font-sans text-[12px] leading-relaxed text-studio-ink-faint">
            {HOST_STUDY?.label ?? "Agent View Before / After"} ·{" "}
            {HOST_STUDY?.target?.mode ?? "replace"}
          </div>
        </div>
      </section>

      <section className="rounded-md border border-studio-edge bg-studio-surface p-4">
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          candidate section points
        </div>
        <div className="mt-3 space-y-2">
          {ANCHORS.map((anchor) => (
            <div
              key={anchor.id}
              className="grid grid-cols-[1fr_72px] gap-3 border-b border-studio-edge pb-2 last:border-b-0 last:pb-0"
            >
              <code className="truncate font-mono text-[11px] text-studio-ink-muted">
                {anchor.id}
              </code>
              <span className="justify-self-end rounded bg-studio-canvas-alt px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
                {anchor.scope}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ComparisonNotes({ mode }: { mode: StudyMode }) {
  const notes = mode === "before"
    ? [
        "Project cards compete with filters, metrics, and the active strip.",
        "The selected agent has no persistent preview in the board state.",
        "Cards are useful but too coarse for swap-level experimentation.",
      ]
    : [
        "The after pass separates pressure, lanes, and selected detail.",
        "Each lane has a named insertion point for future Studio mode swaps.",
        "The detail preview becomes the first object-level substitution target.",
      ];

  return (
    <section className="rounded-md border border-studio-edge bg-studio-surface p-4">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        {mode} read
      </div>
      <ul className="mt-3 space-y-2 font-sans text-[13px] leading-relaxed text-studio-ink-muted">
        {notes.map((note) => (
          <li key={note} className="border-l border-studio-edge pl-3">
            {note}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Segment({ values, active }: { values: string[]; active: string }) {
  return (
    <div className="flex h-9 overflow-hidden rounded border border-studio-edge bg-studio-surface">
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className={[
            "border-r border-studio-edge px-3 font-mono text-[10px] uppercase tracking-ch last:border-r-0",
            value === active
              ? "bg-scout-accent-soft text-scout-accent"
              : "text-studio-ink-faint",
          ].join(" ")}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

function GhostSelect({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="h-9 rounded border border-studio-edge bg-studio-surface px-3 font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint"
    >
      {label}
    </button>
  );
}

function FilterChip({
  label,
  count,
  active = false,
}: {
  label: string;
  count?: number;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={[
        "inline-flex h-8 items-center gap-2 rounded border px-3 font-mono text-[10px] uppercase tracking-ch",
        active
          ? "border-scout-accent bg-scout-accent-soft text-scout-accent"
          : "border-studio-edge bg-studio-surface text-studio-ink-faint",
      ].join(" ")}
    >
      {label}
      {count !== undefined && (
        <span className="text-studio-ink-muted">{count}</span>
      )}
    </button>
  );
}

function MetricPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "ok" | "warn" | "error" | "info" | "neutral";
}) {
  return (
    <span
      className="inline-flex h-6 items-center rounded border border-studio-edge px-2 font-mono text-[10px]"
      style={{
        color: `var(--status-${tone}-fg)`,
        background: `var(--status-${tone}-bg)`,
      }}
    >
      {label}
    </span>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-3 border-b border-studio-edge pb-2 last:border-b-0">
      <div className="font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
        {label}
      </div>
      <div className="truncate font-sans text-[13px] text-studio-ink-muted">
        {value}
      </div>
    </div>
  );
}

function StateDot({ state, large = false }: { state: AgentState; large?: boolean }) {
  return (
    <span
      className={large ? "h-4 w-4 rounded-full" : "h-2.5 w-2.5 rounded-full"}
      style={{ background: STATE_COLOR[state] }}
      aria-hidden
    />
  );
}

function summarize(projects: ProjectFixture[]) {
  const agents = projects.flatMap((project) => project.agents);
  return {
    agents: agents.length,
    working: agents.filter((agent) => agent.state === "working").length,
    ready: agents.filter((agent) => agent.state === "ready").length,
    attention: agents.filter((agent) => agent.state === "attention").length,
    offline: agents.filter((agent) => agent.state === "offline").length,
    sessions: projects.reduce((sum, project) => sum + project.sessions, 0),
    nativeSessions: projects.reduce((sum, project) => sum + project.nativeSessions, 0),
  };
}
