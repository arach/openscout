import { useMemo, useState } from "react";
import { useScout } from "../../scout/Provider.tsx";
import { normalizeAgentState, type AgentDisplayState } from "../../lib/agent-state.ts";
import { filterAgentsByMachineScope } from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import { timeAgo } from "../../lib/time.ts";
import { useFleetActiveAsks } from "../../lib/use-fleet-active-asks.ts";
import type { Agent, FleetAsk } from "../../lib/types.ts";
import { RailRow } from "../../scout/slots/RailRow.tsx";
import { FleetSearch } from "../../scout/slots/FleetSearch.tsx";
import { FleetFilterPills, type FleetStateToken } from "../../scout/slots/FleetFilterPills.tsx";
import { openAgent } from "../../scout/slots/openAgent.ts";
import { AGENT_STATUS_RANK, projectIdentityForAgent } from "./model.ts";

type ParentGroup = {
  key: string;
  label: string;
  agents: Agent[];
  bestState: AgentDisplayState;
  latestUpdate: number;
};

function projectRouteKeyForGroup(group: ParentGroup): string {
  return group.key;
}

function buildGroups(agents: Agent[]): ParentGroup[] {
  const map = new Map<string, { label: string; agents: Agent[] }>();
  for (const agent of agents) {
    const identity = projectIdentityForAgent(agent);
    const group = map.get(identity.key);
    if (group) {
      group.agents.push(agent);
    } else {
      map.set(identity.key, { label: identity.title, agents: [agent] });
    }
  }

  const groups: ParentGroup[] = [];
  for (const [key, group] of map) {
    const list = group.agents;
    list.sort((a, b) => {
      const sd = (AGENT_STATUS_RANK[normalizeAgentState(a.state)] ?? 9) -
                 (AGENT_STATUS_RANK[normalizeAgentState(b.state)] ?? 9);
      if (sd !== 0) return sd;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });

    const bestState = list.reduce<AgentDisplayState>((best, a) => {
      const s = normalizeAgentState(a.state);
      return (AGENT_STATUS_RANK[s] ?? 9) < (AGENT_STATUS_RANK[best] ?? 9) ? s : best;
    }, "not_ready");

    const latestUpdate = Math.max(...list.map((a) => a.updatedAt ?? 0));

    groups.push({ key, label: group.label, agents: list, bestState, latestUpdate });
  }

  groups.sort((a, b) => {
    const sd = (AGENT_STATUS_RANK[a.bestState] ?? 9) - (AGENT_STATUS_RANK[b.bestState] ?? 9);
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
  openAgent(navigate, agent, {
    ...options,
    from: "agents-tree",
    returnTo: { view: "agents" },
  });
}

const DEFAULT_STATE_FILTERS: ReadonlySet<FleetStateToken> = new Set([
  "working",
  "ready",
  "not_ready",
]);

export function AgentsLeft() {
  const { agents, route, navigate } = useScout();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [stateFilters, setStateFilters] = useState<ReadonlySet<FleetStateToken>>(
    DEFAULT_STATE_FILTERS,
  );
  const asksByAgent = useFleetActiveAsks();
  const machineId = routeMachineId(route);
  const scopedAgents = useMemo(
    () => filterAgentsByMachineScope(agents, machineId),
    [agents, machineId],
  );

  const normalizedQuery = normalizeQuery(query);
  const searchActive = normalizedQuery.length > 0;

  const toggleStateFilter = (token: FleetStateToken) => {
    setStateFilters((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  };

  const filteredAgents = useMemo(
    () =>
      scopedAgents.filter((agent) => {
        const s = normalizeAgentState(agent.state);
        const token: FleetStateToken = s;
        if (!stateFilters.has(token)) return false;
        return agentMatchesQuery(agent, normalizedQuery);
      }),
    [normalizedQuery, scopedAgents, stateFilters],
  );

  const groups = useMemo(() => buildGroups(filteredAgents), [filteredAgents]);
  const firstMatch = filteredAgents[0] ?? null;

  const selectedAgentId = route.view === "agents" ? route.agentId : undefined;
  const selectedProjectKey = route.view === "agents" && !route.agentId ? route.projectKey : undefined;

  const toggleProjectGroup = (
    key: string,
    projectRouteKey: string,
    projectSelected: boolean,
  ) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (searchActive) {
        next.add(key);
      } else if (next.has(key) && projectSelected) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    navigate({ view: "agents", projectKey: projectRouteKey });
  };

  return (
    <div className="s-left-roster">
      <div className="s-left-roster-search">
        <FleetSearch
          value={query}
          onChange={setQuery}
          placeholder="Search agents or session IDs…"
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
        <FleetFilterPills active={stateFilters} onToggle={toggleStateFilter} />
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>

      {scopedAgents.length === 0 ? (
        <div className="s-left-roster-empty">
          {machineId ? "No agents on this machine" : "No agents registered"}
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="s-left-roster-empty">
          No agents match this session or agent search.
        </div>
      ) : (
        groups.map((group) => {
          const isOpen = searchActive || expanded.has(group.key);
          const anySelected = group.agents.some((a) => a.id === selectedAgentId);
          const projectRouteKey = projectRouteKeyForGroup(group);
          const projectSelected = selectedProjectKey === projectRouteKey;

          const collisions = collidingAgentIds(group.agents);
          return (
            <div key={group.key}>
              <RailRow
                name={group.label}
                meta={groupRollup(group.agents)}
                sub={`${group.agents.length} agents`}
                tone={group.bestState}
                caret={isOpen ? "open" : "closed"}
                active={projectSelected || (anySelected && !isOpen)}
                selected={anySelected && !projectSelected}
                title={`${isOpen && projectSelected && !searchActive ? "Collapse" : "Open"} ${group.label}`}
                onClick={() => {
                  toggleProjectGroup(group.key, projectRouteKey, projectSelected);
                }}
              />
              {isOpen &&
                group.agents.map((agent) => {
                  const ask = asksByAgent.get(agent.id);
                  const sessionMatch = matchedSessionIdentifier(agent, normalizedQuery);
                  const collides = collisions.has(agent.id);
                  return (
                    <RailRow
                      key={agent.id}
                      depth={1}
                      name={agent.name}
                      meta={agent.updatedAt ? timeAgo(agent.updatedAt) : undefined}
                      sub={instanceAgentSub(agent, ask, sessionMatch, collides)}
                      tone={normalizeAgentState(agent.state)}
                      avatarName={agent.name}
                      active={agent.id === selectedAgentId}
                      title={agentRowTooltip(agent, ask, sessionMatch)}
                      onClick={() =>
                        navigateToAgent(navigate, agent, {
                          observe: Boolean(sessionMatch),
                        })
                      }
                    />
                  );
                })}
            </div>
          );
        })
      )}
      </div>
    </div>
  );
}

const BRANCH_GLYPH = "⎇";

function sessionTail(agent: Agent): string {
  const id = agent.conversationId ?? agent.harnessSessionId ?? "";
  return id.slice(-5);
}

function branchChip(agent: Agent): string | null {
  if (!agent.branch) return null;
  return `${BRANCH_GLYPH} ${agent.branch}`;
}

function instanceAgentSub(
  agent: Agent,
  ask: FleetAsk | undefined,
  sessionMatch: string | null,
  collides: boolean,
): string | undefined {
  if (sessionMatch) return `session · ${sessionMatch}`;
  if (ask) return ask.task;
  const parts: string[] = [];
  const branch = branchChip(agent);
  if (branch) parts.push(branch);
  if (collides) {
    const tail = sessionTail(agent);
    if (tail) parts.push(`#${tail}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function collidingAgentIds(agents: Agent[]): Set<string> {
  const counts = new Map<string, number>();
  for (const a of agents) {
    const key = `${a.name}::${a.branch ?? ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ids = new Set<string>();
  for (const a of agents) {
    const key = `${a.name}::${a.branch ?? ""}`;
    if ((counts.get(key) ?? 0) > 1) ids.add(a.id);
  }
  return ids;
}

function agentRowTooltip(
  agent: Agent,
  ask: FleetAsk | undefined,
  sessionMatch: string | null,
): string | undefined {
  const parts: string[] = [];
  if (ask) parts.push(`task: ${ask.task}`);
  if (agent.branch) parts.push(`branch: ${agent.branch}`);
  if (agent.harness) parts.push(`harness: ${agent.harness}`);
  if (sessionMatch) parts.push(`session: ${sessionMatch}`);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function groupRollup(agents: Agent[]): string {
  let working = 0;
  let ready = 0;
  let notReady = 0;
  for (const agent of agents) {
    const s = normalizeAgentState(agent.state);
    if (s === "working") working += 1;
    else if (s === "ready") ready += 1;
    else notReady += 1;
  }
  const parts: string[] = [];
  if (working) parts.push(`${working}w`);
  if (ready) parts.push(`${ready}r`);
  if (notReady && !working && !ready) parts.push(`${notReady}nr`);
  if (parts.length === 0) return `${agents.length}`;
  return parts.join(" · ");
}
