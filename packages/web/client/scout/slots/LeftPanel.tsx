import { useMemo, useState } from "react";
import { useScout } from "../Provider.tsx";
import { normalizeAgentState, type AgentDisplayState } from "../../lib/agent-state.ts";
import { stateColor, actorColor } from "../../lib/colors.ts";
import { timeAgo } from "../../lib/time.ts";
import type { Agent } from "../../lib/types.ts";

type ParentGroup = {
  key: string;
  label: string;
  agents: Agent[];
  bestState: AgentDisplayState;
  latestUpdate: number;
};

const STATE_RANK: Record<string, number> = { working: 0, available: 1, offline: 2 };

function agentProject(agent: Agent): string {
  if (agent.project) return agent.project.toLowerCase();
  return "other";
}

function buildGroups(agents: Agent[]): ParentGroup[] {
  const map = new Map<string, Agent[]>();
  for (const agent of agents) {
    const key = agentProject(agent);
    const list = map.get(key);
    if (list) list.push(agent);
    else map.set(key, [agent]);
  }

  const groups: ParentGroup[] = [];
  for (const [key, list] of map) {
    list.sort((a, b) => {
      const sd = (STATE_RANK[normalizeAgentState(a.state)] ?? 9) -
                 (STATE_RANK[normalizeAgentState(b.state)] ?? 9);
      if (sd !== 0) return sd;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });

    const bestState = list.reduce<AgentDisplayState>((best, a) => {
      const s = normalizeAgentState(a.state);
      return (STATE_RANK[s] ?? 9) < (STATE_RANK[best] ?? 9) ? s : best;
    }, "offline");

    const latestUpdate = Math.max(...list.map((a) => a.updatedAt ?? 0));

    groups.push({ key, label: key, agents: list, bestState, latestUpdate });
  }

  groups.sort((a, b) => {
    const sd = (STATE_RANK[a.bestState] ?? 9) - (STATE_RANK[b.bestState] ?? 9);
    if (sd !== 0) return sd;
    return b.latestUpdate - a.latestUpdate;
  });

  return groups;
}

export function ScoutLeftPanel() {
  const { agents, route, navigate } = useScout();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const groups = useMemo(() => buildGroups(agents), [agents]);

  const selectedAgentId = route.view === "agents" ? route.agentId : undefined;

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="s-left-roster">
      {agents.length === 0 ? (
        <div className="s-left-roster-empty">No agents registered</div>
      ) : (
        groups.map((group) => {
          const isSingle = group.agents.length === 1;
          const isOpen = expanded.has(group.key);
          const only = isSingle ? group.agents[0] : null;
          const anySelected = group.agents.some((a) => a.id === selectedAgentId);

          return (
            <div key={group.key} className="s-left-roster-parent">
              <button
                className={`s-left-roster-row${anySelected && (isSingle || !isOpen) ? " s-left-roster-row--active" : ""}`}
                onClick={() => {
                  if (isSingle) {
                    navigate({ view: "agents", agentId: only!.id });
                  } else {
                    toggle(group.key);
                  }
                }}
              >
                <span className="s-left-roster-avatar-wrap">
                  <span
                    className="s-left-roster-avatar"
                    style={{ background: actorColor(group.label) }}
                  >
                    {group.label[0].toUpperCase()}
                  </span>
                  <span
                    className={`s-left-roster-dot s-left-roster-dot--${group.bestState}`}
                    style={{ background: stateColor(group.bestState === "working" ? "working" : group.bestState === "available" ? "available" : null) }}
                  />
                </span>

                <span className="s-left-roster-body">
                  <span className="s-left-roster-name">
                    {group.label}
                  </span>
                  {isSingle && (only!.project || only!.branch) && (
                    <span className="s-left-roster-sub">
                      {only!.name}
                      {only!.branch ? ` · ${only!.branch}` : ""}
                    </span>
                  )}
                  {!isSingle && !isOpen && (
                    <span className="s-left-roster-sub">
                      {group.agents.length} agents
                    </span>
                  )}
                </span>

                {!isSingle && (
                  <span className="s-left-roster-ct">
                    {isOpen ? "▾" : "▸"}
                  </span>
                )}
                {isSingle && only!.updatedAt && (
                  <span className="s-left-roster-time">{timeAgo(only!.updatedAt)}</span>
                )}
              </button>

              {!isSingle && isOpen && (
                <div className="s-left-roster-instances">
                  {group.agents.map((agent) => (
                    <button
                      key={agent.id}
                      className={`s-left-roster-instance${agent.id === selectedAgentId ? " s-left-roster-instance--active" : ""}`}
                      onClick={() => navigate({ view: "agents", agentId: agent.id })}
                    >
                      <span
                        className={`s-left-roster-instance-dot s-left-roster-dot--${normalizeAgentState(agent.state)}`}
                        style={{ background: stateColor(agent.state) }}
                      />
                      <span className="s-left-roster-instance-label">
                        {agent.name}
                        {agent.branch ? ` · ${agent.branch}` : ""}
                      </span>
                      {agent.updatedAt && (
                        <span className="s-left-roster-time">{timeAgo(agent.updatedAt)}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
