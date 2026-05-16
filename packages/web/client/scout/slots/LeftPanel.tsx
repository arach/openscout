import { type ReactNode, useMemo, useState } from "react";
import { useScout } from "../Provider.tsx";
import { normalizeAgentState, type AgentDisplayState } from "../../lib/agent-state.ts";
import { timeAgo } from "../../lib/time.ts";
import { useFleetActiveAsks } from "../../lib/use-fleet-active-asks.ts";
import type { Agent, FleetAsk, Route } from "../../lib/types.ts";
import { BaseLeftRail } from "./BaseLeftRail.tsx";
import { MeshNavLeftPanel } from "./MeshNavLeftPanel.tsx";
import { ScoutMessagesLeftPanel } from "./MessagesLeftPanel.tsx";
import { ScoutMissionControlLeftPanel } from "./MissionControlLeftPanel.tsx";
import { ScoutOpsAgentsLeftPanel } from "./OpsAgentsLeftPanel.tsx";
import { ScoutOpsLeftPanel } from "./OpsLeftPanel.tsx";
import { ScoutPlanArchiveLeftPanel } from "./PlanArchiveLeftPanel.tsx";
import { RailRow } from "./RailRow.tsx";
import { FleetSearch } from "./FleetSearch.tsx";
import { FleetFilterPills, type FleetStateToken } from "./FleetFilterPills.tsx";
import { openAgent } from "./openAgent.ts";

type LeftRailSlot =
  | { mode: "takeover"; render: () => ReactNode }
  | { mode: "prepend"; render: () => ReactNode };

/**
 * Single registry mapping a route to how it customizes the left rail.
 * Anything not listed here falls through to the BaseLeftRail with no prepend.
 *   - takeover: page owns the entire rail (BaseLeftRail does not render)
 *   - prepend:  page block renders ABOVE the BaseLeftRail's four sections
 */
function resolveLeftRailSlot(route: Route): LeftRailSlot | null {
  if (route.view === "ops") {
    if (route.mode === "mission") return { mode: "takeover", render: () => <ScoutMissionControlLeftPanel /> };
    if (route.mode === "plan") return { mode: "takeover", render: () => <ScoutPlanArchiveLeftPanel /> };
    if (route.mode === "agents") return { mode: "takeover", render: () => <ScoutOpsAgentsLeftPanel /> };
    return { mode: "takeover", render: () => <ScoutOpsLeftPanel /> };
  }
  switch (route.view) {
    case "agents":
    case "agent-info":
      return { mode: "takeover", render: () => <ScoutAgentsLeftPanel /> };
    case "messages":
    case "channels":
    case "conversation":
      return { mode: "takeover", render: () => <ScoutMessagesLeftPanel /> };
    case "mesh":
      return { mode: "takeover", render: () => <MeshNavLeftPanel /> };
    default:
      return null;
  }
}

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
  openAgent(navigate, agent, {
    ...options,
    from: "agents-tree",
    returnTo: { view: "agents" },
  });
}

export function ScoutLeftPanel() {
  const { route } = useScout();
  const slot = resolveLeftRailSlot(route);
  if (slot?.mode === "takeover") {
    return slot.render();
  }
  return <BaseLeftRail prepend={slot?.mode === "prepend" ? slot.render() : undefined} />;
}

const DEFAULT_STATE_FILTERS: ReadonlySet<FleetStateToken> = new Set([
  "working",
  "available",
  "offline",
]);

function ScoutAgentsLeftPanel() {
  const { agents, route, navigate } = useScout();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [stateFilters, setStateFilters] = useState<ReadonlySet<FleetStateToken>>(
    DEFAULT_STATE_FILTERS,
  );
  const asksByAgent = useFleetActiveAsks();

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
      agents.filter((agent) => {
        const s = normalizeAgentState(agent.state);
        const token: FleetStateToken =
          s === "working" || s === "available" ? s : "offline";
        if (!stateFilters.has(token)) return false;
        return agentMatchesQuery(agent, normalizedQuery);
      }),
    [agents, normalizedQuery, stateFilters],
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

          if (isSingle && only) {
            const ask = asksByAgent.get(only.id);
            return (
              <RailRow
                key={group.key}
                name={group.label}
                meta={only.updatedAt ? timeAgo(only.updatedAt) : undefined}
                sub={singleAgentSub(only, ask, onlySessionMatch)}
                tone={normalizeAgentState(only.state)}
                active={only.id === selectedAgentId}
                title={agentRowTooltip(only, ask, onlySessionMatch)}
                onClick={() =>
                  navigateToAgent(navigate, only, { observe: Boolean(onlySessionMatch) })
                }
              />
            );
          }

          const collisions = collidingAgentIds(group.agents);
          return (
            <div key={group.key}>
              <RailRow
                name={group.label}
                meta={groupRollup(group.agents)}
                sub={`${group.agents.length} agents`}
                tone={group.bestState}
                caret={isOpen ? "open" : "closed"}
                active={anySelected && !isOpen}
                onClick={() => toggle(group.key)}
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

function singleAgentSub(
  agent: Agent,
  ask: FleetAsk | undefined,
  sessionMatch: string | null,
): string | undefined {
  if (sessionMatch) return `session · ${sessionMatch}`;
  if (ask) return ask.task;
  const branch = branchChip(agent);
  if (branch) return branch;
  return undefined;
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
  let available = 0;
  let offline = 0;
  for (const agent of agents) {
    const s = normalizeAgentState(agent.state);
    if (s === "working") working += 1;
    else if (s === "available") available += 1;
    else offline += 1;
  }
  const parts: string[] = [];
  if (working) parts.push(`${working}w`);
  if (available) parts.push(`${available}a`);
  if (offline && !working && !available) parts.push(`${offline}o`);
  if (parts.length === 0) return `${agents.length}`;
  return parts.join(" · ");
}
