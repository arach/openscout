import type { CSSProperties, ReactNode } from "react";

type Motion = "none" | "low" | "medium" | "high" | "blocked";

interface AgentActivity {
  name: string;
  handle: string;
  motion: Motion;
  activity: string;
  work: string;
  detail: string;
  updated: string;
  needsYou?: boolean;
}

interface ActivityEvent {
  kind: string;
  title: string;
  summary: string;
  age: string;
  motion: Motion;
}

const MOTION_STYLE: Record<Motion, CSSProperties> = {
  none: { color: "var(--studio-ink-faint)", borderColor: "var(--studio-edge)" },
  low: { color: "var(--studio-ink-muted)", borderColor: "var(--studio-edge-strong)" },
  medium: { color: "var(--scout-accent)", borderColor: "color-mix(in oklch, var(--scout-accent) 48%, var(--studio-edge))" },
  high: { color: "var(--status-ok-fg)", borderColor: "color-mix(in oklch, var(--status-ok-fg) 48%, var(--studio-edge))" },
  blocked: { color: "var(--status-warn-fg)", borderColor: "color-mix(in oklch, var(--status-warn-fg) 58%, var(--studio-edge))" },
};

const AGENTS: AgentActivity[] = [
  {
    name: "Scout",
    handle: "scout.codex.local",
    motion: "blocked",
    activity: "permission",
    work: "Approve filesystem write",
    detail: "Runtime projector wants to create activity-projection.ts",
    updated: "5s",
    needsYou: true,
  },
  {
    name: "Atlas",
    handle: "atlas.claude.local",
    motion: "high",
    activity: "working",
    work: "Port session list rows",
    detail: "Editing HomeSurface.swift and checking compact widths",
    updated: "18s",
  },
  {
    name: "Nova",
    handle: "nova.codex.remote",
    motion: "medium",
    activity: "review",
    work: "Validate fork policy copy",
    detail: "Waiting for local tests before handoff",
    updated: "1m",
  },
  {
    name: "Echo",
    handle: "echo.cursor.local",
    motion: "none",
    activity: "idle",
    work: "No active work",
    detail: "Endpoint is registered and quiet",
    updated: "8m",
  },
];

const EVENTS: ActivityEvent[] = [
  {
    kind: "permission",
    title: "Approve filesystem write",
    summary: "Scout needs operator attention before editing runtime files.",
    age: "5s",
    motion: "blocked",
  },
  {
    kind: "flight",
    title: "Port session list rows",
    summary: "Atlas is applying the compact row treatment.",
    age: "18s",
    motion: "high",
  },
  {
    kind: "work_item",
    title: "Validate fork policy copy",
    summary: "Nova moved the work item into review.",
    age: "1m",
    motion: "medium",
  },
];

const LAYERS = [
  {
    title: "Sources",
    body: "Broker records, observed harness events, session runtime state.",
    tags: ["messages", "flights", "unblocks", "sessions"],
  },
  {
    title: "Adapter Boundary",
    body: "Native interactions and harness traces are normalized before they touch product UI.",
    tags: ["permission", "approval", "tool", "tail"],
  },
  {
    title: "Core Read Model",
    body: "Observed status folds into activity summaries with motion, current work, and attention.",
    tags: ["status", "projector", "reducer"],
  },
  {
    title: "Projections",
    body: "One contract feeds fleet digest, agent rows, focused session panels, and operator attention.",
    tags: ["fleet", "agent", "session", "attention"],
  },
  {
    title: "Surfaces",
    body: "Shell stays calm, lists stay scannable, focused views expose event-level detail.",
    tags: ["shell", "list", "focused"],
  },
];

export default function ActivitySystemPage() {
  const workingCount = AGENTS.filter((agent) => agent.motion === "high" || agent.motion === "medium").length;
  const needsYouCount = AGENTS.filter((agent) => agent.needsYou).length;

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-[760px]">
        <div className="font-mono text-[11px] text-scout-accent">studies / activity-system</div>
        <h1 className="mt-2 font-display text-[30px] font-medium leading-tight text-studio-ink">
          Activity system architecture
        </h1>
        <p className="mt-3 max-w-[680px] font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          A broker-owned activity language for agent work: the same projection becomes a shell
          digest, dense list rows, focused session detail, and operator attention.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <ShellDigest needsYouCount={needsYouCount} workingCount={workingCount} />
        <Counters />
      </section>

      <section className="mt-8">
        <SectionTitle eyebrow="model" title="Signal path" />
        <div className="grid gap-3 lg:grid-cols-5">
          {LAYERS.map((layer, index) => (
            <LayerCard key={layer.title} index={index + 1} {...layer} />
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div>
          <SectionTitle eyebrow="list altitude" title="Agent activity rows" />
          <div className="overflow-hidden rounded-md border border-studio-edge bg-studio-surface">
            {AGENTS.map((agent) => (
              <AgentRow key={agent.handle} agent={agent} />
            ))}
          </div>
        </div>
        <div>
          <SectionTitle eyebrow="focused altitude" title="Focused session" />
          <FocusedPanel />
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle eyebrow="contract" title="Projection primitives" />
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Primitive
            name="ScoutFleetActivitySummary"
            body="Global digest, counts, latest events, and sorted agent summaries."
          />
          <Primitive
            name="ScoutAgentActivitySummary"
            body="Per-agent phase, activity, motion level, current work, and latest event."
          />
          <Primitive
            name="ScoutActivityEvent"
            body="Compact event envelope with kind, source ref, severity, and timestamp."
          />
          <Primitive
            name="SessionDisplayState"
            body="Focused-session reducer output for turns, tools, suspensions, and files."
          />
        </div>
      </section>
    </main>
  );
}

function ShellDigest({ needsYouCount, workingCount }: { needsYouCount: number; workingCount: number }) {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-studio-ink-faint">shell digest</div>
          <div className="mt-2 font-display text-[24px] font-medium leading-tight text-studio-ink">
            Needs you
          </div>
          <p className="mt-2 max-w-[540px] text-[13px] leading-relaxed text-studio-ink-muted">
            {needsYouCount} {plural("agent", needsYouCount)} {needsYouCount === 1 ? "is" : "are"} waiting
            for operator action while {workingCount} {plural("agent", workingCount)} continue moving in
            the background.
          </p>
        </div>
        <MotionBadge motion="blocked">blocked</MotionBadge>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {EVENTS.map((event) => (
          <EventTile key={event.title} event={event} />
        ))}
      </div>
    </div>
  );
}

function Counters() {
  const items = [
    ["needs you", "1"],
    ["working", "2"],
    ["active", "3"],
    ["quiet", "1"],
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border border-studio-edge bg-studio-surface p-4">
          <div className="font-display text-[26px] font-medium leading-none text-studio-ink">{value}</div>
          <div className="mt-2 font-mono text-[11px] text-studio-ink-faint">{label}</div>
        </div>
      ))}
    </div>
  );
}

function LayerCard({
  body,
  index,
  tags,
  title,
}: {
  body: string;
  index: number;
  tags: string[];
  title: string;
}) {
  return (
    <article className="min-h-[190px] rounded-md border border-studio-edge bg-studio-surface p-4">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[11px] text-scout-accent">0{index}</div>
          {index < LAYERS.length ? (
            <div className="font-mono text-[11px] text-studio-ink-faint">-&gt;</div>
          ) : null}
        </div>
        <h2 className="mt-4 font-display text-[18px] font-medium leading-tight text-studio-ink">{title}</h2>
        <p className="mt-2 flex-1 text-[12px] leading-relaxed text-studio-ink-faint">{body}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded border border-studio-edge px-2 py-1 font-mono text-[10px] text-studio-ink-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

function AgentRow({ agent }: { agent: AgentActivity }) {
  return (
    <div className="grid min-h-[76px] grid-cols-[160px_108px_minmax(0,1fr)_70px] items-center gap-3 border-b border-studio-edge px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-studio-ink">{agent.name}</div>
        <div className="mt-1 truncate font-mono text-[10px] text-studio-ink-faint">{agent.handle}</div>
      </div>
      <MotionBadge motion={agent.motion}>{agent.activity}</MotionBadge>
      <div className="min-w-0">
        <div className="truncate text-[13px] text-studio-ink-muted">{agent.work}</div>
        <div className="mt-1 truncate text-[11px] text-studio-ink-faint">{agent.detail}</div>
      </div>
      <div className="text-right font-mono text-[11px] text-studio-ink-faint">{agent.updated}</div>
    </div>
  );
}

function FocusedPanel() {
  return (
    <aside className="rounded-md border border-studio-edge bg-studio-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-studio-ink-faint">Scout / session 8c1a</div>
          <h2 className="mt-2 font-display text-[20px] font-medium leading-tight text-studio-ink">
            Approve filesystem write
          </h2>
        </div>
        <MotionBadge motion="blocked">needs you</MotionBadge>
      </div>
      <div className="mt-4 space-y-3">
        <TimelineItem label="permission" tone="blocked">
          Codex requested a write to packages/runtime/src/activity-projection.ts.
        </TimelineItem>
        <TimelineItem label="tool" tone="high">
          TypeScript fixtures inspected registry, observed status, and unblock request contracts.
        </TimelineItem>
        <TimelineItem label="state reducer" tone="medium">
          Session display state keeps turns, tools, files, suspensions, and latest summary separate
          from broker records.
        </TimelineItem>
      </div>
    </aside>
  );
}

function EventTile({ event }: { event: ActivityEvent }) {
  return (
    <article className="min-h-[104px] rounded-md border bg-studio-bg p-3" style={MOTION_STYLE[event.motion]}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[10px]">{event.kind}</div>
        <div className="font-mono text-[10px] text-studio-ink-faint">{event.age}</div>
      </div>
      <div className="mt-3 line-clamp-1 text-[13px] font-medium text-studio-ink">{event.title}</div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-studio-ink-faint">{event.summary}</p>
    </article>
  );
}

function TimelineItem({ children, label, tone }: { children: ReactNode; label: string; tone: Motion }) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-3">
      <MotionBadge motion={tone}>{label}</MotionBadge>
      <p className="min-w-0 text-[12px] leading-relaxed text-studio-ink-muted">{children}</p>
    </div>
  );
}

function Primitive({ body, name }: { body: string; name: string }) {
  return (
    <article className="min-h-[132px] rounded-md border border-studio-edge bg-studio-surface p-4">
      <h2 className="break-words font-mono text-[12px] text-studio-ink">{name}</h2>
      <p className="mt-3 text-[12px] leading-relaxed text-studio-ink-faint">{body}</p>
    </article>
  );
}

function MotionBadge({ children, motion }: { children: ReactNode; motion: Motion }) {
  return (
    <span
      className="inline-flex h-7 max-w-full items-center justify-center rounded border px-2.5 font-mono text-[10px]"
      style={MOTION_STYLE[motion]}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <div className="font-mono text-[11px] text-scout-accent">{eyebrow}</div>
        <h2 className="mt-1 font-display text-[20px] font-medium leading-tight text-studio-ink">{title}</h2>
      </div>
    </div>
  );
}

function plural(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}
