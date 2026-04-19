import { useScout } from "../Provider.tsx";
import { agentStateLabel, isAgentOnline } from "../../lib/agent-state.ts";
import { actorColor } from "../../lib/colors.ts";
import { timeAgo } from "../../lib/time.ts";

export function AgentsInspector() {
  const { route, agents } = useScout();
  if (route.view !== "agents") return null;

  const agent = route.agentId
    ? agents.find((a) => a.id === route.agentId) ?? null
    : null;

  if (!agent) {
    const working = agents.filter((a) => isAgentOnline(a.state)).length;
    return (
      <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
        <Row label="Total" value={`${agents.length}`} />
        <Row label="Working" value={`${working}`} />
        <Row label="Available" value={`${agents.length - working}`} />
        <div className="mt-2 text-[10px] font-mono uppercase tracking-[0.15em] text-white/25 leading-relaxed">
          Select an agent from the roster to see its identity + session context
          here.
        </div>
      </div>
    );
  }

  const online = isAgentOnline(agent.state);

  return (
    <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
      {/* Identity */}
      <div className="flex items-center gap-3 pb-3 border-b border-white/[0.04]">
        <div
          className="relative w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-mono text-black/80 shrink-0"
          style={{ background: actorColor(agent.name) }}
        >
          {agent.name[0]?.toUpperCase() ?? "?"}
          {online && (
            <span className="absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-neutral-950" />
          )}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[13px] text-white/90 truncate">{agent.name}</span>
          {agent.handle && (
            <span className="text-[10px] font-mono text-cyan-400/70">
              @{agent.handle}
            </span>
          )}
        </div>
      </div>

      {/* State */}
      <Section label="State">
        <div className="flex items-baseline gap-2">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              online ? "bg-emerald-400" : "bg-white/20"
            }`}
          />
          <span className="text-[12px] text-white/80 capitalize">
            {agentStateLabel(agent.state)}
          </span>
        </div>
        {agent.updatedAt && (
          <div className="text-[10px] font-mono text-white/30 mt-1">
            Updated {timeAgo(agent.updatedAt)}
          </div>
        )}
      </Section>

      {/* Identity detail */}
      <Section label="Identity">
        <Row label="Class" value={agent.agentClass} />
        {agent.role && <Row label="Role" value={agent.role} />}
        {agent.harness && <Row label="Harness" value={agent.harness} />}
        {agent.transport && <Row label="Transport" value={agent.transport} />}
      </Section>

      {/* Project */}
      {(agent.project || agent.branch || agent.cwd) && (
        <Section label="Project">
          {agent.project && <Row label="Name" value={agent.project} />}
          {agent.branch && <Row label="Branch" value={agent.branch} />}
          {agent.cwd && <Row label="Cwd" value={agent.cwd} />}
        </Section>
      )}

      {/* Capabilities */}
      {agent.capabilities.length > 0 && (
        <Section label={`Capabilities · ${agent.capabilities.length}`}>
          <div className="flex flex-wrap gap-1">
            {agent.capabilities.map((cap) => (
              <span
                key={cap}
                className="text-[10px] font-mono text-white/50 px-1.5 py-0.5 rounded-sm bg-white/[0.04]"
              >
                {cap}
              </span>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="text-[9px] font-mono uppercase tracking-[0.15em] text-white/30 mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-0.5 gap-2">
      <span className="text-[10px] font-mono uppercase tracking-wider text-white/30 shrink-0">
        {label}
      </span>
      <span className="text-[11px] text-white/70 font-mono truncate">
        {value}
      </span>
    </div>
  );
}
