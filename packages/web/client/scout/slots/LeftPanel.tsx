import { useMemo } from "react";
import { useScout } from "../Provider.tsx";
import { normalizeAgentState } from "../../lib/agent-state.ts";
import { stateColor, actorColor } from "../../lib/colors.ts";
import { timeAgo } from "../../lib/time.ts";
import type { Agent } from "../../lib/types.ts";

function agentFamily(agent: Agent): string {
  if (agent.project) return agent.project;
  const parts = agent.id.split(".");
  if (parts.length >= 2) return parts[0];
  return "other";
}

function agentQualifier(agent: Agent, all: Agent[]): string | null {
  const siblings = all.filter((a) => a.name === agent.name);
  if (siblings.length <= 1) return null;
  return agent.project ?? agent.branch ?? agent.id.replace(/^.*\./, "");
}

type FamilyGroup = { key: string; label: string; agents: Agent[] };

export function ScoutLeftPanel() {
  const { agents, route, navigate } = useScout();

  const groups = useMemo<FamilyGroup[]>(() => {
    const stateOrder: Record<string, number> = { working: 0, available: 1, offline: 2 };
    const sorted = [...agents].sort((a, b) => {
      const sd = (stateOrder[normalizeAgentState(a.state)] ?? 9) -
                 (stateOrder[normalizeAgentState(b.state)] ?? 9);
      if (sd !== 0) return sd;
      const ud = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
      if (ud !== 0) return ud;
      return a.name.localeCompare(b.name);
    });

    const map = new Map<string, Agent[]>();
    for (const agent of sorted) {
      const key = agentFamily(agent);
      const list = map.get(key);
      if (list) list.push(agent);
      else map.set(key, [agent]);
    }

    return Array.from(map.entries()).map(([key, list]) => ({
      key,
      label: key,
      agents: list,
    }));
  }, [agents]);

  const selectedAgentId = route.view === "agents" ? route.agentId : undefined;

  return (
    <div className="s-left-roster">
      {agents.length === 0 ? (
        <div className="s-left-roster-empty">
          No agents registered
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="s-left-roster-group">
            <div className="s-left-roster-group-hdr">
              <span className="s-left-roster-group-label">{g.label}</span>
              <span className="s-left-roster-group-ct">{g.agents.length}</span>
            </div>
            {g.agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                qualifier={agentQualifier(agent, agents)}
                selected={agent.id === selectedAgentId}
                onClick={() =>
                  navigate({ view: "agents", agentId: agent.id })
                }
              />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function AgentRow({
  agent,
  qualifier,
  selected,
  onClick,
}: {
  agent: Agent;
  qualifier: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  const state = normalizeAgentState(agent.state);
  const dotColor = stateColor(agent.state);
  const initial = (agent.name ?? "?")[0].toUpperCase();
  const bg = actorColor(agent.name ?? agent.id);

  return (
    <button
      onClick={onClick}
      className={`s-left-roster-row${selected ? " s-left-roster-row--active" : ""}`}
    >
      <span className="s-left-roster-avatar-wrap">
        <span className="s-left-roster-avatar" style={{ background: bg }}>
          {initial}
        </span>
        <span
          className={`s-left-roster-dot s-left-roster-dot--${state}`}
          style={{ background: dotColor }}
        />
      </span>

      <span className="s-left-roster-body">
        <span className="s-left-roster-name">
          {agent.name}
          {qualifier && (
            <span className="s-left-roster-qual">{qualifier}</span>
          )}
        </span>
        {(agent.project || agent.branch) && (
          <span className="s-left-roster-sub">
            {agent.project ?? ""}
            {agent.project && agent.branch ? " · " : ""}
            {agent.branch ?? ""}
          </span>
        )}
      </span>

      {agent.updatedAt && (
        <span className="s-left-roster-time">{timeAgo(agent.updatedAt)}</span>
      )}
    </button>
  );
}
