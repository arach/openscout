"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";

/**
 * ScoutNext Home - iOS study.
 *
 * Local browser workbench for the SwiftUI Home surface. The goal is fast
 * row-grammar + chrome iteration before porting the winning shape back to
 * apps/ios/ScoutNext/HomeSurface.swift.
 *
 * Direction: tight vertical rhythm, one-line agent rows, a locked right-edge
 * column (runtime then a fixed age slot), a readable file-tree spine, and a
 * compact "currently working" card for live agents.
 */

type WidthMode = "mini" | "standard";
type Density = "tight" | "current" | "roomy";
type AgentState = "live" | "idle" | "offline";

interface Agent {
  id: string;
  title: string;
  harness: string;
  age: string;
  state: AgentState;
  branch?: string;
  /** Live-only: the action it's mid-flight on, shown with a blinking caret. */
  action?: string;
  /** Live-only: uncommitted file count, surfaced as +N. */
  dirty?: number;
}

interface Project {
  id: string;
  name: string;
  age: string;
  agents: Agent[];
}

interface DensitySpec {
  label: string;
  projectY: number;
  agentY: number;
  rail: number;
  projectSize: number;
  agentSize: number;
}

const DENSITIES: Record<Density, DensitySpec> = {
  tight: {
    label: "Tight",
    projectY: 9,
    agentY: 6,
    rail: 24,
    projectSize: 15,
    agentSize: 12.5,
  },
  current: {
    label: "Swift pass",
    projectY: 11,
    agentY: 8,
    rail: 26,
    projectSize: 15,
    agentSize: 13,
  },
  roomy: {
    label: "Roomy",
    projectY: 13,
    agentY: 10,
    rail: 28,
    projectSize: 15,
    agentSize: 13,
  },
};

const PROJECTS: Project[] = [
  {
    id: "talkie",
    name: "talkie",
    age: "4h",
    agents: [
      { id: "talkie.ios", title: "iOS capture pass", harness: "claude", age: "41m", state: "idle", branch: "mini-home" },
      { id: "talkie.voice", title: "voice tray", harness: "codex", age: "2h", state: "idle", branch: "main" },
      { id: "talkie.site", title: "landing polish", harness: "claude", age: "3h", state: "offline" },
      { id: "talkie.agent", title: "Talkie", harness: "claude", age: "4h", state: "idle" },
    ],
  },
  {
    id: "openscout",
    name: "openscout",
    age: "now",
    agents: [
      {
        id: "openscout.home",
        title: "Home layout",
        harness: "codex",
        age: "now",
        state: "live",
        branch: "mini-home",
        action: "editing HomeSurface.swift",
        dirty: 3,
      },
      { id: "openscout.card.k.1", title: "Openscout Card K 1c26ij", harness: "codex", age: "7h", state: "idle", branch: "scoutnext-home" },
      { id: "openscout.base.1", title: "Openscout", harness: "claude", age: "7h", state: "idle" },
      { id: "openscout.base.2", title: "Openscout", harness: "claude", age: "7h", state: "idle" },
      { id: "openscout.base.3", title: "Openscout", harness: "codex", age: "7h", state: "idle" },
      { id: "openscout.card.e", title: "Openscout Card E C0j003", harness: "codex", age: "8h", state: "offline" },
      { id: "openscout.card.k.2", title: "Openscout Card K 1c26ij", harness: "codex", age: "8h", state: "idle" },
      { id: "openscout.oscodex", title: "Oscodex", harness: "codex", age: "9h", state: "idle" },
      { id: "openscout.sco061", title: "Sco061", harness: "claude", age: "10h", state: "idle" },
    ],
  },
  {
    id: "dewey",
    name: "Dewey",
    age: "1d",
    agents: [{ id: "dewey.main", title: "Dewey", harness: "claude", age: "1d", state: "idle" }],
  },
  {
    id: "contextual",
    name: "Contextual",
    age: "2d",
    agents: [{ id: "contextual.main", title: "Contextual", harness: "claude", age: "2d", state: "idle" }],
  },
  {
    id: "studio",
    name: "Studio",
    age: "2d",
    agents: [{ id: "studio.main", title: "Studio", harness: "claude", age: "2d", state: "offline" }],
  },
];

type ActivityKind = "assistant" | "tool" | "user";

interface ActivityEvent {
  id: string;
  summary: string;
  source: string;
  kind: ActivityKind;
  age: string;
}

const ACTIVITY: ActivityEvent[] = [
  { id: "a1", summary: "Ran swift build — 0 errors, 0 warnings", source: "claude", kind: "tool", age: "20s" },
  { id: "a2", summary: "Wired the code highlighter into the message renderer", source: "codex", kind: "assistant", age: "2m" },
  { id: "a3", summary: "Edited ConversationSurface.swift (+14 −6)", source: "claude", kind: "tool", age: "5m" },
  { id: "a4", summary: "git commit — projects-first Home + machine rail", source: "codex", kind: "tool", age: "14m" },
];

// Tabs render single, clean marks — the two-figure `agents` / two-bubble `comms`
// turn to mud at tab scale, so the Agents tab uses the single silhouette and the
// `comms` glyph itself is a single bubble. (The multi-figure `agents` still lives
// inline in the project-count segment.)
const TABS: Array<{ label: string; kind: GlyphKind }> = [
  { label: "Home", kind: "home" },
  { label: "Agents", kind: "agent" },
  { label: "Comms", kind: "comms" },
  { label: "Terminal", kind: "terminal" },
  { label: "New", kind: "plus" },
];

export default function ScoutNextHomeStudy() {
  const [widthMode, setWidthMode] = useState<WidthMode>("mini");
  const [density, setDensity] = useState<Density>("tight");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(["openscout"]),
  );
  const spec = DENSITIES[density];

  const liveAgents = useMemo(
    () =>
      PROJECTS.flatMap((p) =>
        p.agents
          .filter((a) => a.state === "live")
          .map((a) => ({ agent: a, project: p.name })),
      ),
    [],
  );

  function toggleProject(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main className="px-6 py-6">
      <header className="mb-6 flex max-w-[1180px] flex-wrap items-end justify-between gap-5 border-b border-studio-edge pb-5">
        <div className="max-w-[76ch]">
          <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            ios study - ScoutNext Home
          </div>
          <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
            Tight fleet home
          </h1>
          <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
            Browser-first mock of the Home surface. Tighten the vertical rhythm,
            the file-tree spine, the live working card, and the locked right-edge
            column here; then port the settled grammar back to SwiftUI.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented
            label="Width"
            value={widthMode}
            values={[
              ["mini", "13 mini"],
              ["standard", "15"],
            ]}
            onChange={(v) => setWidthMode(v as WidthMode)}
          />
          <Segmented
            label="Density"
            value={density}
            values={[
              ["tight", DENSITIES.tight.label],
              ["current", DENSITIES.current.label],
              ["roomy", DENSITIES.roomy.label],
            ]}
            onChange={(v) => setDensity(v as Density)}
          />
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(360px,440px)_minmax(420px,1fr)]">
        <section className="flex justify-center">
          <Phone widthMode={widthMode}>
            <HomeScreen
              spec={spec}
              liveAgents={liveAgents}
              expanded={expanded}
              onToggleProject={toggleProject}
            />
          </Phone>
        </section>

        <section className="grid content-start gap-4">
          <Panel title="Row grammar">
            <div className="grid gap-3 font-sans text-[13px] leading-relaxed text-studio-ink-muted">
              <GrammarRow
                name="Working card"
                value="pulse + name, action with caret, +dirty · branch · age"
              />
              <GrammarRow
                name="Multi-agent project"
                value="[folder] name / [agents] N agents, age, expand chevron"
              />
              <GrammarRow
                name="One-agent project"
                value="[folder] name / [agent] runtime, age, drill arrow"
              />
              <GrammarRow
                name="Expanded agent"
                value="tree spine + glyph, title, runtime · age slot"
              />
              <GrammarRow
                name="Section All"
                value="right-aligned All → in the Projects + Activity headers"
              />
            </div>
          </Panel>

          <Panel title="Tightening rules">
            <ul className="grid gap-2 font-sans text-[13px] leading-relaxed text-studio-ink-muted">
              <li>Right edge is a locked column: runtime (dim mono) then a fixed age slot, tabular, never truncates.</li>
              <li>Hierarchy reads by tone — project ink, agent muted, runtime/age dim — not just size.</li>
              <li>One indent system: the tree spine is the indent; the last child elbows off.</li>
              <li>Runtime is plain mono in child rows; the capsule survives only on the solo compressed row.</li>
              <li>Status chrome is just time + signal. No faux wifi / battery.</li>
            </ul>
          </Panel>

          <Panel title="Port notes">
            <div className="grid gap-2 font-mono text-[11px] leading-relaxed text-studio-ink-faint">
              <span>source: apps/ios/ScoutNext/HomeSurface.swift</span>
              <span>glyphs: apps/ios/ScoutNext/Glyphs.swift</span>
              <span>phone: iPhone 13 mini portrait, 375 pt width</span>
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function HomeScreen({
  spec,
  liveAgents,
  expanded,
  onToggleProject,
}: {
  spec: DensitySpec;
  liveAgents: Array<{ agent: Agent; project: string }>;
  expanded: Set<string>;
  onToggleProject: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col bg-[#080a09] text-white">
      <style>{KEYFRAMES}</style>
      <StatusBar />

      <div className="px-5 pt-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="font-sans text-[26px] font-semibold tracking-tight text-white/92">
              Scout
            </span>
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--scout-accent)]">
              Next
            </span>
          </div>
          <button
            type="button"
            aria-label="Settings"
            className="grid h-8 w-8 place-items-center rounded-full border border-white/[0.07] bg-white/[0.04] text-white/55"
          >
            <GlyphSvg kind="gear" size={16} />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
            Machines
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.04] px-2.5 py-1 font-sans text-[12.5px] font-medium text-white/82">
            <Dot live />
            arachs mac mini
          </span>
          <button
            type="button"
            aria-label="Add machine"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.035] px-2.5 py-1 font-sans text-[12.5px] font-medium text-white/55 transition-colors hover:bg-white/[0.06]"
          >
            <AddGlyph />
            Add
          </button>
        </div>

        <div className="mt-3 flex h-[40px] items-center gap-2.5 rounded-[9px] border border-white/[0.07] bg-black/60 px-3.5">
          <GlyphSvg kind="search" size={16} className="text-white/35" />
          <span className="font-sans text-[14px] text-white/30">
            Search the fleet
          </span>
        </div>
      </div>

      {liveAgents.length > 0 ? (
        <div className="mt-4 px-5">
          <SectionLabel title="Currently working" count={liveAgents.length} accent />
          <div className="mt-2 flex gap-2.5 overflow-x-auto pb-1">
            {liveAgents.map(({ agent, project }) => (
              <WorkingCard key={agent.id} agent={agent} project={project} />
            ))}
          </div>
        </div>
      ) : null}

      <div
        data-testid="scoutnext-project-scroll"
        className="mt-4 min-h-0 flex-1 overflow-y-auto px-4 pb-4"
      >
        <SectionLabel
          title="Projects"
          count={PROJECTS.length}
          onAll={() => {}}
        />
        <div className="mt-2 overflow-hidden rounded-[10px] border border-white/[0.10] bg-white/[0.025]">
          {PROJECTS.map((project, index) => {
            const isExpanded = expanded.has(project.id);
            const soloAgent =
              project.agents.length === 1 ? project.agents[0] : null;
            return (
              <div key={project.id}>
                {index > 0 ? <Hairline /> : null}
                <ProjectRow
                  project={project}
                  soloAgent={soloAgent}
                  expanded={isExpanded}
                  spec={spec}
                  onToggle={() => onToggleProject(project.id)}
                />
                {!soloAgent && isExpanded ? (
                  <div className="bg-black/25">
                    {project.agents.map((agent, agentIndex) => (
                      <AgentRow
                        key={`${project.id}:${agentIndex}:${agent.id}`}
                        agent={agent}
                        projectName={project.name}
                        spec={spec}
                        last={agentIndex === project.agents.length - 1}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mt-5">
          <SectionLabel title="Activity" count={ACTIVITY.length} onAll={() => {}} />
          <div className="mt-2 overflow-hidden rounded-[10px] border border-white/[0.10] bg-white/[0.025]">
            {ACTIVITY.map((event, index) => (
              <div key={event.id}>
                {index > 0 ? (
                  <div className="h-px bg-white/[0.05]" style={{ marginLeft: 30 }} />
                ) : null}
                <ActivityRow event={event} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <TabBar />
      <Footer />
    </div>
  );
}

function ProjectRow({
  project,
  soloAgent,
  expanded,
  spec,
  onToggle,
}: {
  project: Project;
  soloAgent: Agent | null;
  expanded: boolean;
  spec: DensitySpec;
  onToggle: () => void;
}) {
  const live = project.agents.some((a) => a.state === "live");
  return (
    <button
      type="button"
      data-testid={soloAgent ? "scoutnext-solo-project-row" : "scoutnext-project-row"}
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 px-3.5 text-left transition-colors hover:bg-white/[0.03]"
      style={{ paddingTop: spec.projectY, paddingBottom: spec.projectY }}
    >
      <GlyphSvg kind="folder" size={16} className="shrink-0 text-white/45" />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className="min-w-0 truncate font-sans font-semibold text-white/92"
          style={{ fontSize: spec.projectSize }}
        >
          {project.name}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-white/22">/</span>
        {soloAgent ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <GlyphSvg kind="agent" size={12} className="shrink-0 text-white/35" />
            <span
              className="min-w-0 truncate font-sans font-medium text-white/60"
              style={{ fontSize: spec.agentSize }}
            >
              {soloTitle(project.name, soloAgent)}
            </span>
            {soloTitle(project.name, soloAgent) !== runtimeLabel(soloAgent) ? (
              <RuntimePill label={soloAgent.harness} />
            ) : null}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5">
            <GlyphSvg kind="agents" size={13} className="shrink-0 text-white/35" />
            <span
              className="font-sans font-medium text-white/60"
              style={{ fontSize: spec.agentSize }}
            >
              {project.agents.length} agents
            </span>
          </span>
        )}
        {live ? <Dot live pulse /> : null}
      </div>
      <RightSlot>
        <span className="font-mono text-[10.5px] tabular-nums text-white/45">
          {project.age}
        </span>
        {soloAgent ? (
          <GlyphSvg kind="arrow" size={12} className="text-white/25" />
        ) : (
          <GlyphSvg
            kind="chevron"
            size={12}
            className="text-white/30"
            style={{ transform: expanded ? "rotate(90deg)" : "none" }}
          />
        )}
      </RightSlot>
    </button>
  );
}

function AgentRow({
  agent,
  projectName,
  spec,
  last,
}: {
  agent: Agent;
  projectName: string;
  spec: DensitySpec;
  last: boolean;
}) {
  const title = agentDisplayTitle(projectName, agent);
  const runtime = runtimeLabel(agent);
  const offline = agent.state === "offline";
  const live = agent.state === "live";
  return (
    <button
      type="button"
      data-testid="scoutnext-agent-row"
      className="group flex w-full items-stretch gap-1.5 px-3.5 text-left transition-colors hover:bg-white/[0.03]"
      style={{ paddingTop: spec.agentY, paddingBottom: spec.agentY, opacity: offline ? 0.5 : 1 }}
    >
      <TreeRail width={spec.rail} last={last} state={agent.state} />
      <span className="flex min-w-0 flex-1 items-center self-center gap-1.5">
        <span
          className={[
            "min-w-0 truncate font-sans font-medium",
            live ? "text-white/90" : "text-white/74",
          ].join(" ")}
          style={{ fontSize: spec.agentSize }}
        >
          {title}
        </span>
        {live ? <Caret /> : null}
      </span>
      <RightSlot>
        {runtime !== title ? (
          <span className="shrink-0 font-mono text-[10px] font-medium text-white/32">
            {runtime}
          </span>
        ) : null}
        <span
          className={[
            "w-[26px] shrink-0 text-right font-mono text-[10px] tabular-nums",
            live ? "text-[var(--scout-accent)]" : "text-white/48",
          ].join(" ")}
        >
          {agent.age}
        </span>
      </RightSlot>
    </button>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const tint =
    event.kind === "assistant"
      ? "var(--scout-accent)"
      : event.kind === "tool"
        ? "#d3b13c"
        : "rgba(255,255,255,0.4)";
  return (
    <button
      type="button"
      data-testid="scoutnext-activity-row"
      className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
    >
      <span
        className="mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full"
        style={{ background: tint }}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 font-sans text-[12.5px] leading-snug text-white/85">
          {event.summary}
        </span>
        <span className="font-mono text-[9.5px] text-white/40">
          {event.source} · {event.kind} · {event.age}
        </span>
      </span>
      <GlyphSvg kind="chevron" size={12} className="mt-[3px] shrink-0 text-white/22" />
    </button>
  );
}

function WorkingCard({ agent, project }: { agent: Agent; project: string }) {
  // Live strip: recency is implied by the pulse, so the meta line carries
  // location + git facts (project · +dirty · branch), not the age.
  const progress = [
    project,
    agent.dirty ? `+${agent.dirty}` : null,
    agent.branch ? `⎇ ${agent.branch}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      data-testid="scoutnext-working-card"
      className="flex w-[208px] shrink-0 flex-col gap-1.5 rounded-[11px] border px-3 py-2.5"
      style={{
        borderColor: "color-mix(in oklab, var(--scout-accent) 30%, transparent)",
        background: "color-mix(in oklab, var(--scout-accent) 7%, rgba(255,255,255,0.02))",
      }}
    >
      <div className="flex items-center gap-1.5">
        <Dot live pulse />
        <span className="min-w-0 truncate font-sans text-[12.5px] font-semibold text-white/92">
          {agent.title}
        </span>
      </div>
      <div className="flex min-w-0 items-baseline gap-1">
        <span className="min-w-0 truncate font-mono text-[11px] text-white/55">
          {agent.action ?? "working"}
        </span>
        <Caret />
      </div>
      <div className="truncate font-mono text-[9.5px] tracking-tight text-white/40">
        {progress}
      </div>
    </div>
  );
}

function RightSlot({ children }: { children: ReactNode }) {
  return (
    <span className="ml-2 flex shrink-0 items-center gap-2 self-center">
      {children}
    </span>
  );
}

function TreeRail({
  width,
  last,
  state,
}: {
  width: number;
  last: boolean;
  state: AgentState;
}) {
  const live = state === "live";
  const spineX = 6;
  const glyph = 12;
  const elbowEnd = width - glyph - 1;
  return (
    <span className="relative shrink-0 self-stretch" style={{ width }}>
      {/* vertical spine — abuts the next row's spine to read continuous */}
      <span
        className="absolute left-[6px] top-0 w-px bg-white/[0.16]"
        style={{ bottom: last ? "50%" : 0 }}
      />
      {/* elbow into the glyph */}
      <span
        className="absolute top-1/2 h-px bg-white/[0.16]"
        style={{ left: spineX, width: Math.max(0, elbowEnd - spineX) }}
      />
      {/* agent glyph, right-aligned at the end of the rail */}
      <span className="absolute right-0 top-1/2 -translate-y-1/2">
        <GlyphSvg
          kind="agent"
          size={glyph}
          className={live ? "text-[var(--scout-accent)]" : "text-white/40"}
        />
        {live ? (
          <span className="absolute -bottom-[1px] -right-[1px] h-[4px] w-[4px] rounded-full bg-[var(--scout-accent)]" />
        ) : null}
      </span>
    </span>
  );
}

function Phone({
  widthMode,
  children,
}: {
  widthMode: WidthMode;
  children: ReactNode;
}) {
  const width = widthMode === "mini" ? 375 : 393;
  const height = widthMode === "mini" ? 812 : 852;
  return (
    <div className="rounded-[34px] border border-studio-edge-strong bg-black p-[6px] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.8)]">
      <div
        data-testid="scoutnext-phone"
        className="overflow-hidden rounded-[28px]"
        style={{ width, height }}
      >
        {children}
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="flex h-11 items-center justify-between px-7 pt-1 font-sans text-white">
      <span className="text-[15px] font-semibold tracking-tight">9:22</span>
      <span className="inline-flex items-end gap-[2px]">
        {[6, 9, 12, 15].map((h) => (
          <span
            key={h}
            className="w-[3.5px] rounded-[1px] bg-white/90"
            style={{ height: h }}
          />
        ))}
      </span>
    </div>
  );
}

function SectionLabel({
  title,
  count,
  accent = false,
  onAll,
}: {
  title: string;
  count: number;
  accent?: boolean;
  onAll?: () => void;
}) {
  return (
    <div className="flex items-baseline gap-2">
      {accent ? <Dot live pulse className="self-center" /> : null}
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">
        {title}
      </span>
      <span className="font-mono text-[10px] font-semibold text-white/35">
        {count}
      </span>
      {onAll ? (
        <button
          type="button"
          onClick={onAll}
          data-testid="scoutnext-section-all"
          className="ml-auto self-center font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--scout-accent)] transition-opacity hover:opacity-80"
        >
          All
        </button>
      ) : null}
    </div>
  );
}

function TabBar() {
  return (
    <div className="grid grid-cols-5 border-t border-white/[0.06] bg-white/[0.025] px-2 pb-1.5 pt-1">
      {TABS.map((tab, index) => {
        const active = index === 0;
        return (
          <button
            key={tab.label}
            type="button"
            className="relative flex flex-col items-center gap-1 pt-2"
          >
            {/* Thin top indicator on the active tab — replaces the filled capsule. */}
            {active ? (
              <span className="absolute top-0 h-[2.5px] w-4 rounded-full bg-[var(--scout-accent)]" />
            ) : null}
            <GlyphSvg
              kind={tab.kind}
              size={18}
              className={active ? "text-[var(--scout-accent)]" : "text-white/45"}
            />
            <span
              className={[
                "font-sans text-[10px]",
                active ? "text-[var(--scout-accent)]" : "text-white/45",
              ].join(" ")}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Footer() {
  return (
    <div className="flex h-9 items-center border-t border-white/[0.06] bg-black px-5 font-mono text-[10px] text-white/45">
      <GlyphSvg kind="signal" size={14} className="text-[var(--scout-accent)]" />
      <span className="ml-2 text-[var(--scout-accent)]">TSN</span>
      <span className="mx-2 text-white/25">·</span>
      <span className="truncate">arachs mac...</span>
      <span className="ml-auto tabular-nums">37 agents · 1 live</span>
    </div>
  );
}

function RuntimePill({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.05] px-1.5 py-[1px] font-mono text-[8.5px] font-semibold text-white/45">
      {label}
    </span>
  );
}

function Dot({
  live,
  pulse = false,
  className = "",
}: {
  live: boolean;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={[
        "relative inline-flex h-[7px] w-[7px] shrink-0 rounded-full",
        live ? "bg-[var(--scout-accent)]" : "bg-white/25",
        className,
      ].join(" ")}
      style={
        live
          ? { boxShadow: "0 0 8px color-mix(in oklab, var(--scout-accent) 70%, transparent)" }
          : undefined
      }
    >
      {live && pulse ? (
        <span
          className="absolute inset-0 rounded-full bg-[var(--scout-accent)]"
          style={{ animation: "scoutPing 1.8s cubic-bezier(0,0,0.2,1) infinite" }}
        />
      ) : null}
    </span>
  );
}

function Caret() {
  return (
    <span
      className="inline-block h-[12px] w-[2px] shrink-0 translate-y-[1px] bg-[var(--scout-accent)]"
      style={{ animation: "scoutBlink 1.05s steps(1) infinite" }}
    />
  );
}

/** Thin + for the add-machine chip — bare cross, no enclosing box. */
function AddGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={9}
      height={9}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      className="text-white/45"
    >
      <path d="M12 5.5V18.5" />
      <path d="M5.5 12H18.5" />
    </svg>
  );
}

const KEYFRAMES = `
@keyframes scoutBlink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
@keyframes scoutPing {
  0% { transform: scale(1); opacity: 0.55 }
  70%, 100% { transform: scale(2.6); opacity: 0 }
}
`;

function Segmented({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-surface p-1">
      <div className="mb-1 px-1 font-mono text-[8px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </div>
      <div className="flex gap-1">
        {values.map(([key, text]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={[
              "rounded-[4px] px-2 py-1 font-mono text-[10px] transition-colors",
              value === key
                ? "bg-scout-accent text-black"
                : "text-studio-ink-faint hover:bg-studio-canvas-alt hover:text-studio-ink",
            ].join(" ")}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-studio-edge bg-studio-surface p-4">
      <h2 className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {title}
      </h2>
      {children}
    </section>
  );
}

function GrammarRow({ name, value }: { name: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-studio-edge/60 pb-2 last:border-b-0 last:pb-0 sm:grid-cols-[140px_1fr]">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-studio-ink-faint">
        {name}
      </span>
      <span>{value}</span>
    </div>
  );
}

function Hairline() {
  return <div className="h-px bg-white/[0.05]" style={{ marginLeft: 30 }} />;
}

function soloTitle(projectName: string, agent: Agent) {
  return agentDisplayTitle(projectName, agent);
}

function agentDisplayTitle(projectName: string, agent: Agent) {
  if (normalized(projectName) !== normalized(agent.title)) return agent.title;
  return runtimeLabel(agent) || shortIdentifier(agent.id) || agent.branch || "agent";
}

function runtimeLabel(agent: Agent) {
  return agent.harness.toLowerCase();
}

function shortIdentifier(value: string) {
  const parts = value.split(/[./:#\-_]+/).filter(Boolean);
  return parts.at(-1) || value;
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// MARK: - Glyphs
//
// Hand-drawn, thin-line marks ported from apps/ios/ScoutNext/Glyphs.swift so the
// browser mock and the SwiftUI app share one glyph language. Every path is
// authored on a 0…24 grid, stroked at a single weight with round caps.

type TabKind = "home" | "agents" | "comms" | "terminal" | "plus";
type GlyphKind =
  | TabKind
  | "folder"
  | "agent"
  | "gear"
  | "search"
  | "signal"
  | "chevron"
  | "arrow";

function GlyphSvg({
  kind,
  size = 18,
  className,
  style,
}: {
  kind: GlyphKind;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const sw = Math.max(1, size * (1.6 / 24));
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={["shrink-0", className].filter(Boolean).join(" ")}
      style={style}
    >
      {GLYPH_PATHS[kind]}
    </svg>
  );
}

const GLYPH_PATHS: Record<GlyphKind, ReactNode> = {
  home: (
    <>
      <rect x="3" y="3" width="7.75" height="7.75" rx="1.9" />
      <rect x="13.25" y="3" width="7.75" height="7.75" rx="1.9" />
      <rect x="3" y="13.25" width="7.75" height="7.75" rx="1.9" />
      <rect x="13.25" y="13.25" width="7.75" height="7.75" rx="1.9" />
    </>
  ),
  agents: (
    <>
      <circle cx="8.6" cy="7.8" r="2.4" />
      <path d="M3.6 18.2Q8.6 11.4 13.6 18.2" />
      <circle cx="15.6" cy="10" r="2.6" />
      <path d="M10.4 20.4Q15.9 13 21.4 20.4" />
    </>
  ),
  comms: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="3.4" />
      <path d="M8.5 16 7 20 12.5 16" />
    </>
  ),
  terminal: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="3" />
      <path d="M6.5 10 9.5 13 6.5 16" />
      <path d="M11.5 16 15.5 16" />
    </>
  ),
  plus: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3.6" />
      <path d="M12 9 12 15" />
      <path d="M9 12 15 12" />
    </>
  ),
  folder: (
    <path d="M3 8.5 3 6.5 8.5 6.5 10.5 8.5 M3 8.5h15.8a2.2 2.2 0 0 1 2.2 2.2v6.1a2.2 2.2 0 0 1-2.2 2.2H5.2a2.2 2.2 0 0 1-2.2-2.2Z" />
  ),
  agent: (
    <>
      <circle cx="12" cy="7.9" r="3.2" />
      <path d="M5.3 19.3Q12 12.4 18.7 19.3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v3M12 18.2v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.8 12h3M18.2 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15.2 15.2 4 4" />
    </>
  ),
  signal: (
    <>
      <circle cx="12" cy="18" r="1.1" fill="currentColor" stroke="none" />
      <path d="M9.4 16.4Q12 12.4 14.6 16.4" />
      <path d="M6.8 15.2Q12 8.4 17.2 15.2" />
      <path d="M4.3 14Q12 4.6 19.7 14" />
    </>
  ),
  chevron: <path d="M9.5 6 15.5 12 9.5 18" />,
  arrow: (
    <>
      <path d="M4.5 12 18.5 12" />
      <path d="M13 6.5 18.5 12 13 17.5" />
    </>
  ),
};
