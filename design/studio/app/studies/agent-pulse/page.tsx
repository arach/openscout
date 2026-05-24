/**
 * Agent Pulse — study.
 *
 * Visual primitive lifted from scout's HomeAgentsInspector AgentRow
 * (packages/web/client/scout/inspector/HomeAgentsInspector.tsx:69-111),
 * rebuilt against studio tokens. Shows the agent state vocabulary in
 * one place: working, idle/online, blocked/needs-attention, offline,
 * error. Three densities for layout planning.
 *
 * Static mock data — no live broker connection.
 */

type AgentState =
  | "working"
  | "available"
  | "needs-attention"
  | "idle"
  | "offline"
  | "error";

interface MockAgent {
  id: string;
  name: string;
  state: AgentState;
  task?: string;
  updatedAgo: string;
}

const AGENTS: MockAgent[] = [
  {
    id: "scout",
    name: "Scout",
    state: "working",
    task: "indexing channel.shared",
    updatedAgo: "2s",
  },
  {
    id: "hudson",
    name: "Hudson",
    state: "working",
    task: "reviewing PR #214",
    updatedAgo: "11s",
  },
  {
    id: "qb",
    name: "QB",
    state: "needs-attention",
    task: "awaiting decision on flight 0c8f",
    updatedAgo: "1m",
  },
  {
    id: "cody",
    name: "Cody",
    state: "available",
    task: "idle, ready to dispatch",
    updatedAgo: "4m",
  },
  {
    id: "ranger",
    name: "Ranger",
    state: "idle",
    task: "tail watcher",
    updatedAgo: "18m",
  },
  {
    id: "vox",
    name: "Vox",
    state: "error",
    task: "TTS provider auth failed",
    updatedAgo: "32m",
  },
  {
    id: "atlas",
    name: "Atlas",
    state: "offline",
    task: undefined,
    updatedAgo: "2h",
  },
  {
    id: "vault",
    name: "Vault",
    state: "offline",
    task: undefined,
    updatedAgo: "1d",
  },
];

const STATE_COLOR: Record<AgentState, string> = {
  working: "var(--status-warn-fg)",
  "needs-attention": "var(--status-error-fg)",
  available: "var(--status-ok-fg)",
  idle: "var(--scout-accent)",
  offline: "var(--studio-ink-faint)",
  error: "var(--status-error-fg)",
};

const STATE_LABEL: Record<AgentState, string> = {
  working: "working",
  "needs-attention": "needs attention",
  available: "available",
  idle: "idle",
  offline: "offline",
  error: "error",
};

const AVATAR_HUES: Record<string, number> = {
  Scout: 125,
  Hudson: 210,
  QB: 25,
  Cody: 85,
  Ranger: 295,
  Vox: 340,
  Atlas: 175,
  Vault: 250,
};

function avatarColor(name: string): string {
  const hue = AVATAR_HUES[name] ?? 200;
  return `oklch(0.72 0.14 ${hue})`;
}

export default function AgentPulsePage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · agent-pulse
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent pulse
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Single primitive for "this agent is doing X." Visual lifted from{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            HomeAgentsInspector.AgentRow
          </code>{" "}
          and rebuilt against studio tokens. Six agent states, three densities.
        </p>
      </header>

      <Section title="Comfortable" hint="Roster sidebar density (current scout default)">
        <div className="max-w-[560px] overflow-hidden rounded-md border border-studio-edge bg-studio-surface p-2">
          {AGENTS.map((a) => (
            <AgentRow key={a.id} agent={a} density="comfortable" />
          ))}
        </div>
      </Section>

      <Section title="Compact" hint="When the operator wants ~25 rows above the fold">
        <div className="max-w-[560px] overflow-hidden rounded-md border border-studio-edge bg-studio-surface p-1">
          {AGENTS.map((a) => (
            <AgentRow key={a.id} agent={a} density="compact" />
          ))}
        </div>
      </Section>

      <Section title="Inline manifest" hint="Single-line dense form for ops/tail surfaces">
        <div className="max-w-[820px] overflow-hidden rounded-md border border-studio-edge bg-studio-surface">
          {AGENTS.map((a) => (
            <AgentRow key={a.id} agent={a} density="manifest" />
          ))}
        </div>
      </Section>
    </main>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline gap-3">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · {title}
        </div>
        <div className="font-mono text-[10px] text-studio-ink-faint">{hint}</div>
        <div className="ml-3 h-px flex-1 bg-studio-edge" />
      </div>
      {children}
    </section>
  );
}

function AgentRow({
  agent,
  density,
}: {
  agent: MockAgent;
  density: "comfortable" | "compact" | "manifest";
}) {
  const dim = agent.state === "offline";
  const dotColor = STATE_COLOR[agent.state];

  if (density === "manifest") {
    return (
      <div
        role="button"
        tabIndex={0}
        className={[
          "group relative flex cursor-pointer items-baseline gap-4 px-3 py-1.5 transition-[background-color,color] duration-75 ease-out",
          "hover:bg-studio-canvas-alt",
          "before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-transparent before:transition-[background-color,color] duration-75 ease-out",
          "hover:before:bg-[var(--scout-accent)]",
          dim ? "opacity-55 hover:opacity-100" : "",
        ].join(" ")}
        style={{ ['--agent-accent' as never]: dotColor }}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full transition-shadow"
          style={{
            background: dotColor,
            boxShadow:
              agent.state === "working"
                ? `0 0 0 3px color-mix(in oklab, ${dotColor} 32%, transparent)`
                : undefined,
          }}
        />
        <span className="w-[80px] shrink-0 font-sans text-[13px] font-medium text-studio-ink">
          {agent.name}
        </span>
        <span
          className="w-[110px] shrink-0 font-mono text-[10px] uppercase tracking-eyebrow"
          style={{ color: dotColor }}
        >
          {STATE_LABEL[agent.state]}
        </span>
        <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] text-studio-ink-faint group-hover:text-studio-ink">
          {agent.task ?? "—"}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-studio-ink-faint group-hover:text-studio-ink-faint">
          {agent.updatedAgo}
        </span>
      </div>
    );
  }

  const padY = density === "compact" ? "py-1" : "py-1.5";
  const avatarSize =
    density === "compact" ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[10.5px]";
  const dotRing = density === "compact" ? "ring-1" : "ring-2";

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        "group relative flex cursor-pointer items-center gap-2.5 rounded-sm px-2 transition-[background-color,color] duration-75 ease-out",
        "hover:bg-studio-canvas-alt",
        "before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:rounded-l-sm before:bg-transparent before:transition-[background-color,color] duration-75 ease-out",
        "hover:before:bg-[var(--scout-accent)]",
        padY,
        dim ? "opacity-55 hover:opacity-100" : "",
      ].join(" ")}
    >
      <div
        className={`relative shrink-0 rounded-full font-mono ${avatarSize} flex items-center justify-center transition-shadow group-hover:shadow-[0_0_0_2px_var(--scout-accent-soft)]`}
        style={{
          background: avatarColor(agent.name),
          color: "var(--studio-canvas)",
        }}
      >
        {agent.name[0]?.toUpperCase()}
        {agent.state === "working" || agent.state === "available" ? (
          <span
            className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ${dotRing}`}
            style={{
              background: dotColor,
              boxShadow: `0 0 0 2px var(--studio-surface)`,
            }}
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-sans text-[12.5px] text-studio-ink">
          {agent.name}
        </span>
        <span
          className="truncate font-mono text-[10px]"
          style={{ color: dotColor }}
        >
          {STATE_LABEL[agent.state]}
          {agent.task ? (
            <span className="text-studio-ink-faint group-hover:text-studio-ink"> · {agent.task}</span>
          ) : null}
        </span>
      </div>
      <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-studio-ink-faint group-hover:text-studio-ink-faint">
        {agent.updatedAgo}
      </span>
    </div>
  );
}
