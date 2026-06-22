/**
 * Agent Cards — study.
 *
 * Info-dense agent tiles. Each card surfaces what an operator needs to
 * make a routing decision in one glance: who, doing what, where, what
 * tools, how recently. Four states + a "selected" treatment.
 *
 * The shape draws from what scout already shows piecemeal across
 * HomeAgentsInspector, AgentsInspector, and ChannelInspectorPanel —
 * consolidated into one canonical primitive.
 */

type AgentState =
  | "working"
  | "available"
  | "needs-attention"
  | "idle"
  | "offline";

interface AgentCard {
  id: string;
  name: string;
  handle: string;
  state: AgentState;
  task?: string;
  taskProgress?: number; // 0..1
  project: { repo: string; branch: string; cwd?: string };
  harness: string;
  model: string;
  tools: string[];
  lastTouched: string;
  unread?: number;
}

const AGENTS: AgentCard[] = [
  {
    id: "hudson",
    name: "Hudson",
    handle: "@hudson",
    state: "working",
    task: "Reviewing PR #214 — inspector atom rollout",
    taskProgress: 0.62,
    project: {
      repo: "openscout",
      branch: "atoms/inspector-section",
      cwd: "packages/web/client/scout/inspector",
    },
    harness: "claude-code",
    model: "opus-4.7",
    tools: ["bash", "edit", "grep", "ToolSearch"],
    lastTouched: "12s",
    unread: 2,
  },
  {
    id: "qb",
    name: "QB",
    handle: "@qb",
    state: "needs-attention",
    task: "Awaiting decision on flight 0c8fee",
    project: {
      repo: "openscout",
      branch: "main",
      cwd: "packages/runtime",
    },
    harness: "codex",
    model: "gpt-5",
    tools: ["bash", "edit"],
    lastTouched: "1m",
    unread: 5,
  },
  {
    id: "scout",
    name: "Scout",
    handle: "@scout",
    state: "available",
    task: "idle, ready to dispatch",
    project: {
      repo: "openscout",
      branch: "main",
      cwd: "packages/web/client",
    },
    harness: "claude-code",
    model: "sonnet-4.6",
    tools: ["bash", "edit", "grep", "WebFetch"],
    lastTouched: "4m",
  },
  {
    id: "atlas",
    name: "Atlas",
    handle: "@atlas",
    state: "offline",
    task: undefined,
    project: {
      repo: "openscout",
      branch: "design/atlas-iconography",
    },
    harness: "claude-code",
    model: "opus-4.7",
    tools: ["bash", "edit"],
    lastTouched: "2h",
  },
];

const STATE_LABEL: Record<AgentState, string> = {
  working: "WORKING",
  "needs-attention": "NEEDS ATTENTION",
  available: "AVAILABLE",
  idle: "IDLE",
  offline: "OFFLINE",
};

const STATE_COLOR: Record<AgentState, string> = {
  working: "var(--status-warn-fg)",
  "needs-attention": "var(--status-error-fg)",
  available: "var(--status-ok-fg)",
  idle: "var(--scout-accent)",
  offline: "var(--studio-ink-faint)",
};

function avatarColor(_name: string): string {
  return "oklch(0.42 0.008 80)";
}

export default function AgentCardsPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · agent-cards
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent cards
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Canonical agent tile. Five rows: identity · state · task ·
          project · capabilities. The first one is shown selected
          (accent rule on left) — the rest in their default state.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {AGENTS.map((a, i) => (
          <AgentCardView key={a.id} agent={a} selected={i === 0} />
        ))}
      </div>

      <section className="mt-12 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · used by
        </div>
        <ul className="font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              packages/web/client/scout/inspector/HomeAgentsInspector.tsx
            </code>{" "}
            — agent roster
          </li>
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              packages/web/client/scout/inspector/AgentsInspector.tsx
            </code>{" "}
            — agent detail
          </li>
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              packages/web/client/screens/AgentsScreen.tsx
            </code>{" "}
            — the agents fleet view
          </li>
        </ul>
      </section>
    </main>
  );
}

function AgentCardView({
  agent,
  selected,
}: {
  agent: AgentCard;
  selected: boolean;
}) {
  const stateColor = STATE_COLOR[agent.state];
  const dim = agent.state === "offline";
  return (
    <article
      role="button"
      tabIndex={0}
      className={[
        "group relative flex cursor-pointer flex-col gap-2.5 overflow-hidden rounded-md border bg-studio-surface px-4 py-3",
        "transition-[background-color,border-color,box-shadow] duration-75 ease-out",
        selected
          ? "border-scout-accent shadow-[inset_2px_0_0_var(--scout-accent)]"
          : [
              "border-studio-edge",
              "hover:border-studio-edge-strong",
              "hover:bg-[color-mix(in_oklab,var(--studio-canvas-alt)_60%,var(--studio-surface))]",
              "before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-transparent before:transition-colors before:duration-75",
              "hover:before:bg-[var(--scout-accent)]",
            ].join(" "),
        dim ? "opacity-70 hover:opacity-100" : "",
      ].join(" ")}
    >
      {/* Header — avatar · name+handle · state · unread */}
      <header className="flex items-start gap-3">
        <div
          className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-[13px]"
          style={{
            background: avatarColor(agent.name),
            color: "var(--studio-canvas)",
          }}
        >
          {agent.name[0]?.toUpperCase()}
          {agent.state === "working" || agent.state === "available" ? (
            <span
              className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full"
              style={{
                background: stateColor,
                boxShadow: `0 0 0 2px var(--studio-surface)`,
              }}
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-sans text-[15px] font-semibold tracking-tight text-studio-ink">
              {agent.name}
            </span>
            <span className="font-mono text-[10.5px] text-studio-ink-faint">
              {agent.handle}
            </span>
          </div>
          <div
            className="mt-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow"
            style={{ color: stateColor }}
          >
            {STATE_LABEL[agent.state]}
            <span className="ml-2 font-normal text-studio-ink-faint">
              · {agent.lastTouched} ago
            </span>
          </div>
        </div>

        {agent.unread ? (
          <span
            className="rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] font-semibold tabular-nums"
            style={{
              color: "var(--status-error-fg)",
              background: "var(--status-error-bg)",
            }}
          >
            {agent.unread}
          </span>
        ) : null}
      </header>

      {/* Task — current activity with progress */}
      {agent.task ? (
        <div className="rounded-[4px] bg-studio-canvas-alt px-2.5 py-2">
          <div className="flex items-baseline gap-2 font-sans text-[12.5px] text-studio-ink">
            <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
              task
            </span>
            <span className="min-w-0 flex-1 truncate">{agent.task}</span>
          </div>
          {typeof agent.taskProgress === "number" ? (
            <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-studio-edge">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round(agent.taskProgress * 100)}%`,
                  background: stateColor,
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Project — repo / branch / cwd */}
      <div className="grid grid-cols-[60px_1fr] gap-x-2 gap-y-1 font-mono text-[10.5px]">
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">
          Branch
        </span>
        <span className="truncate text-studio-ink">
          {agent.project.repo}
          <span className="text-studio-ink-faint">@</span>
          {agent.project.branch}
        </span>
        {agent.project.cwd ? (
          <>
            <span className="uppercase tracking-eyebrow text-studio-ink-faint">
              Cwd
            </span>
            <span className="truncate text-studio-ink-muted">
              {agent.project.cwd}
            </span>
          </>
        ) : null}
      </div>

      {/* Footer — harness · model · tools. No top border; whitespace +
       *  the lighter "tools" chips do the partitioning. */}
      <footer className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-1 font-mono text-[9.5px]">
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">
          {agent.harness}
        </span>
        <span className="text-studio-ink-faint">·</span>
        <span className="text-studio-ink">{agent.model}</span>
        <span className="text-studio-ink-faint">·</span>
        <span className="flex flex-wrap items-baseline gap-1">
          {agent.tools.map((t) => (
            <code
              key={t}
              className="rounded-[2px] bg-studio-canvas-alt px-1 py-px text-[9px] text-studio-ink-muted"
            >
              {t}
            </code>
          ))}
        </span>
      </footer>
    </article>
  );
}
