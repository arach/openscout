import { useScout } from "../Provider.tsx";
import { openAgent } from "../slots/openAgent.ts";
import { agentStateLabel, isAgentOnline } from "../../lib/agent-state.ts";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { timeAgo } from "../../lib/time.ts";
import type { Agent } from "../../lib/types.ts";

export function HomeAgentsInspector() {
  const { agents, navigate, route } = useScout();
  const openFromHome = (agent: Agent) =>
    openAgent(navigate, agent, { from: "home", returnTo: route });

  if (agents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center font-mono text-[11px] leading-relaxed text-[var(--scout-chrome-ink-faint)]">
        <div className="mb-1 uppercase tracking-[0.15em]">No agents</div>
        <div>Connect an agent to see your roster here.</div>
      </div>
    );
  }

  const sortedAgents = [...agents].sort((left, right) =>
    Number(isAgentOnline(right.state)) - Number(isAgentOnline(left.state))
    || (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
    || left.name.localeCompare(right.name),
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
      <Section label="Agents" count={agents.length}>
        {sortedAgents.map((agent) => (
          <AgentRow key={agent.id} agent={agent} onOpen={openFromHome} dim={!isAgentOnline(agent.state)} />
        ))}
      </Section>
    </div>
  );
}

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[9px] font-mono uppercase tracking-[0.15em] text-[var(--scout-chrome-ink-faint)]">
          {label}
        </span>
        <span className="text-[9px] font-mono tabular-nums text-[var(--scout-chrome-ink-ghost)]">
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function AgentRow({
  agent,
  onOpen,
  dim,
}: {
  agent: Agent;
  onOpen: (agent: Agent) => void;
  dim?: boolean;
}) {
  const stateLabel = agentStateLabel(agent.state);
  return (
    <button
      onClick={() => onOpen(agent)}
      className={`group flex items-center gap-2.5 px-2 py-1.5 rounded-sm text-left transition-colors ${
        dim
          ? "opacity-60 hover:opacity-100 hover:bg-[var(--scout-chrome-hover)]"
          : "hover:bg-[var(--scout-chrome-hover)]"
      }`}
    >
      <AgentAvatar agent={agent} placement="row" />
      <div className="flex flex-col min-w-0 flex-1">
        <span className="truncate text-[12px] text-[var(--scout-chrome-ink)] transition-colors group-hover:text-[var(--scout-chrome-ink-strong)]">
          {agent.name}
        </span>
        {stateLabel && (
          <span className="truncate text-[10px] font-mono text-[var(--scout-chrome-ink-faint)]">
            {stateLabel}
          </span>
        )}
      </div>
      {agent.updatedAt && (
        <span className="shrink-0 text-[9px] font-mono tabular-nums text-[var(--scout-chrome-ink-ghost)]">
          {timeAgo(agent.updatedAt)}
        </span>
      )}
    </button>
  );
}
