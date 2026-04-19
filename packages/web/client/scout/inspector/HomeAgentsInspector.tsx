import { useScout } from "../Provider.tsx";
import { agentStateLabel, isAgentOnline } from "../../lib/agent-state.ts";
import { actorColor } from "../../lib/colors.ts";
import { timeAgo } from "../../lib/time.ts";
import type { Agent, Route } from "../../lib/types.ts";

export function HomeAgentsInspector() {
  const { agents, navigate } = useScout();

  if (agents.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center px-4 text-center text-[11px] text-white/30 font-mono leading-relaxed">
        <div className="mb-1 uppercase tracking-[0.15em]">No agents</div>
        <div>Connect an agent to see your roster here.</div>
      </div>
    );
  }

  const online = agents.filter((a) => isAgentOnline(a.state));
  const offline = agents.filter((a) => !isAgentOnline(a.state));

  return (
    <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
      {online.length > 0 && (
        <Section label="Online" count={online.length}>
          {online.map((agent) => (
            <AgentRow key={agent.id} agent={agent} navigate={navigate} />
          ))}
        </Section>
      )}
      {offline.length > 0 && (
        <Section label="Standby" count={offline.length}>
          {offline.map((agent) => (
            <AgentRow key={agent.id} agent={agent} navigate={navigate} dim />
          ))}
        </Section>
      )}
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
        <span className="text-[9px] font-mono uppercase tracking-[0.15em] text-white/30">
          {label}
        </span>
        <span className="text-[9px] font-mono tabular-nums text-white/25">
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function AgentRow({
  agent,
  navigate,
  dim,
}: {
  agent: Agent;
  navigate: (r: Route) => void;
  dim?: boolean;
}) {
  const online = isAgentOnline(agent.state);
  return (
    <button
      onClick={() => navigate({ view: "agents", agentId: agent.id })}
      className={`group flex items-center gap-2.5 px-2 py-1.5 rounded-sm text-left transition-colors ${
        dim
          ? "opacity-60 hover:opacity-100 hover:bg-white/[0.03]"
          : "hover:bg-white/[0.03]"
      }`}
    >
      <div className="relative w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono text-black/80 shrink-0"
           style={{ background: actorColor(agent.name) }}>
        {agent.name[0]?.toUpperCase() ?? "?"}
        {online && (
          <span className="absolute -right-0.5 -bottom-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-neutral-950" />
        )}
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[12px] text-white/80 truncate group-hover:text-white transition-colors">
          {agent.name}
        </span>
        <span className="text-[10px] font-mono text-white/30 truncate">
          {agentStateLabel(agent.state)}
        </span>
      </div>
      {agent.updatedAt && (
        <span className="text-[9px] font-mono tabular-nums text-white/25 shrink-0">
          {timeAgo(agent.updatedAt)}
        </span>
      )}
    </button>
  );
}
