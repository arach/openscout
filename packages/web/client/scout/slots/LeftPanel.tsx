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

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function agentSearchFields(agent: Agent): string[] {
  return [
    agent.id,
    agent.name,
    agent.handle ?? "",
    agent.selector ?? "",
    agent.project ?? "",
    agent.branch ?? "",
    agent.role ?? "",
    agent.harness ?? "",
    agent.harnessSessionId ?? "",
    agent.conversationId,
    agent.harnessLogPath ?? "",
  ];
}

function agentMatchesQuery(agent: Agent, query: string): boolean {
  if (!query) {
    return true;
  }
  return agentSearchFields(agent).some((field) => field.toLowerCase().includes(query));
}

function matchedSessionIdentifier(agent: Agent, query: string): string | null {
  if (!query) {
    return null;
  }
  const candidates = [
    agent.harnessSessionId,
    agent.conversationId,
  ];
  return candidates.find((value) => value?.toLowerCase().includes(query)) ?? null;
}

function navigateToAgent(
  navigate: ReturnType<typeof useScout>["navigate"],
  agent: Agent,
  options: { observe?: boolean } = {},
): void {
  navigate({
    view: "agents",
    agentId: agent.id,
    ...(options.observe ? { conversationId: agent.conversationId, tab: "observe" } : {}),
  });
}

export function ScoutLeftPanel() {
  const { agents, route, navigate } = useScout();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");

  const normalizedQuery = normalizeQuery(query);
  const searchActive = normalizedQuery.length > 0;

  const filteredAgents = useMemo(
    () => agents.filter((agent) => agentMatchesQuery(agent, normalizedQuery)),
    [agents, normalizedQuery],
  );

  const groups = useMemo(() => buildGroups(filteredAgents), [filteredAgents]);
  const firstMatch = filteredAgents[0] ?? null;

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
      <div className="s-left-roster-search s-search">
        <input
          type="text"
          className="s-search-input"
          placeholder="Search agents or session IDs…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (query) {
                setQuery("");
              } else {
                (event.target as HTMLInputElement).blur();
              }
            }

            if (event.key === "Enter" && firstMatch) {
              navigateToAgent(navigate, firstMatch, {
                observe: Boolean(matchedSessionIdentifier(firstMatch, normalizedQuery)),
              });
            }
          }}
        />
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>

      {agents.length === 0 ? (
        <div className="s-left-roster-empty">No agents registered</div>
      ) : filteredAgents.length === 0 ? (
        <div className="s-left-roster-empty">
          No agents match this session or agent search.
        </div>
      ) : (
        groups.map((group) => {
          const isSingle = group.agents.length === 1;
          const isOpen = searchActive || expanded.has(group.key);
          const only = isSingle ? group.agents[0] : null;
          const anySelected = group.agents.some((a) => a.id === selectedAgentId);
          const onlySessionMatch = only ? matchedSessionIdentifier(only, normalizedQuery) : null;

          return (
            <div key={group.key} className="s-left-roster-parent">
              <button
                className={`s-left-roster-row${anySelected && (isSingle || !isOpen) ? " s-left-roster-row--active" : ""}`}
                onClick={() => {
                  if (isSingle) {
                    navigateToAgent(navigate, only!, {
                      observe: Boolean(onlySessionMatch),
                    });
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
                  {isSingle && onlySessionMatch ? (
                    <span
                      className="s-left-roster-sub"
                      title={onlySessionMatch}
                    >
                      session · {onlySessionMatch}
                    </span>
                  ) : isSingle && (only!.project || only!.branch) && (
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
                      onClick={() => navigateToAgent(navigate, agent, {
                        observe: Boolean(matchedSessionIdentifier(agent, normalizedQuery)),
                      })}
                      title={matchedSessionIdentifier(agent, normalizedQuery) ?? undefined}
                    >
                      <span
                        className={`s-left-roster-instance-dot s-left-roster-dot--${normalizeAgentState(agent.state)}`}
                        style={{ background: stateColor(agent.state) }}
                      />
                      <span className="s-left-roster-instance-label">
                        {agent.name}
                        {agent.branch ? ` · ${agent.branch}` : ""}
                        {matchedSessionIdentifier(agent, normalizedQuery)
                          ? ` · ${matchedSessionIdentifier(agent, normalizedQuery)}`
                          : ""}
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
    </div>
  );
}
