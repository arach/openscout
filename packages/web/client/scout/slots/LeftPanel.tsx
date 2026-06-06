import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useScout } from "../Provider.tsx";
import { normalizeAgentState, type AgentDisplayState } from "../../lib/agent-state.ts";
import { api } from "../../lib/api.ts";
import { filterAgentsByMachineScope } from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import { useFleetActiveAsks } from "../../lib/use-fleet-active-asks.ts";
import type { Agent, FleetAsk, PlanDocument, PlanDocumentSource, PlanDocumentStatus, PlanDocumentsResponse, Route } from "../../lib/types.ts";
import { BaseLeftRail } from "./BaseLeftRail.tsx";
import { GlobalJumpDock } from "./GlobalJumpDock.tsx";
import { MeshNavLeftPanel } from "./MeshNavLeftPanel.tsx";
import { ScoutMessagesLeftPanel } from "./MessagesLeftPanel.tsx";
import { ScoutMissionControlLeftPanel } from "./MissionControlLeftPanel.tsx";
import { ScoutOpsAgentsLeftPanel } from "./OpsAgentsLeftPanel.tsx";
import { ScoutOpsLeftPanel } from "./OpsLeftPanel.tsx";
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
    if (route.mode === "agents") return { mode: "takeover", render: () => <ScoutOpsAgentsLeftPanel /> };
    if (route.mode === "plan") return { mode: "takeover", render: () => <ScoutPlanDocumentsLeftPanel /> };
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

const STATE_RANK: Record<string, number> = { working: 0, ready: 1, not_ready: 2 };

function pathBasename(path: string | null | undefined): string | null {
  const cleaned = path?.trim().replace(/\/+$/, "");
  if (!cleaned) return null;
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

function normalizedProjectLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function worktreeFamilyFromRoot(root: string | null | undefined): string | null {
  const leaf = normalizedProjectLabel(pathBasename(root));
  if (!leaf || leaf === "~") return null;
  const match = leaf.match(/^(.+?)(?:-(?:parity|codex))?-c\d+$/);
  return match?.[1] ?? null;
}

function agentProject(agent: Agent): string {
  return worktreeFamilyFromRoot(agent.projectRoot ?? agent.cwd)
    ?? normalizedProjectLabel(agent.project)
    ?? normalizedProjectLabel(pathBasename(agent.projectRoot ?? agent.cwd))
    ?? "other";
}

function projectRouteKeyForGroup(group: ParentGroup): string {
  return `project:${group.key || "unscoped"}`;
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
    }, "not_ready");

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
  const rail = slot?.mode === "takeover"
    ? slot.render()
    : <BaseLeftRail prepend={slot?.mode === "prepend" ? slot.render() : undefined} />;
  return (
    <div className="scout-left-shell">
      <div className="scout-left-shell-rail">{rail}</div>
      <GlobalJumpDock />
    </div>
  );
}

type PlanSourceFilter = "all" | PlanDocumentSource;

const PLAN_SOURCE_LABELS: Record<PlanSourceFilter, string> = {
  all: "All",
  claude: "Claude",
  codex: "Codex",
  openscout: "OpenScout",
  workspace: "Workspace",
  unknown: "Other",
};

const PLAN_STATUS_LABELS: Record<PlanDocumentStatus, string> = {
  active: "Active",
  archived: "Archived",
  blocked: "Blocked",
  completed: "Complete",
  draft: "Draft",
  unknown: "Unknown",
};

function planPathBasename(value: string): string {
  const clean = value.replace(/\\/g, "/").replace(/\/+$/g, "");
  const idx = clean.lastIndexOf("/");
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

function planProgressLabel(document: PlanDocument): string {
  if (document.steps.length === 0) return "No steps";
  const done = document.steps.filter((step) => step.status === "completed").length;
  return `${done}/${document.steps.length} steps`;
}

function planDocumentSearchText(document: PlanDocument): string {
  return [
    document.title,
    document.summary,
    document.source,
    document.documentKind,
    document.status,
    document.path,
    document.workspaceName,
    document.agentName,
    document.tags.join(" "),
    document.steps.map((step) => step.text).join(" "),
  ].filter(Boolean).join(" ").toLowerCase();
}

function ScoutPlanDocumentsLeftPanel() {
  const { route, navigate } = useScout();
  const [inventory, setInventory] = useState<PlanDocumentsResponse | null>(null);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<PlanSourceFilter>("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await api<PlanDocumentsResponse>("/api/plan-documents").catch(() => null);
    setInventory(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBrokerEvents((event) => {
    if (
      event.kind === "message.posted" ||
      event.kind === "flight.updated" ||
      event.kind === "collaboration.event.appended"
    ) {
      void load();
    }
  });

  const documents = inventory?.documents ?? [];
  const selectedId = route.view === "ops" && route.mode === "plan" ? route.planDocumentId : undefined;
  const normalizedQuery = query.trim().toLowerCase();
  const sourceCounts = useMemo(() => {
    const counts: Record<PlanSourceFilter, number> = {
      all: documents.length,
      claude: 0,
      codex: 0,
      openscout: 0,
      workspace: 0,
      unknown: 0,
    };
    for (const document of documents) counts[document.source] += 1;
    return counts;
  }, [documents]);
  const visibleDocuments = useMemo(
    () => documents
      .filter((document) => sourceFilter === "all" || document.source === sourceFilter)
      .filter((document) => !normalizedQuery || planDocumentSearchText(document).includes(normalizedQuery)),
    [documents, normalizedQuery, sourceFilter],
  );

  return (
    <div className="s-plan-left-nav">
      <div className="s-left-roster-search">
        <FleetSearch
          value={query}
          onChange={setQuery}
          placeholder="Search plan documents..."
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (query) setQuery("");
              else (event.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>
      <div className="s-plan-left-source-grid">
        {(["all", "claude", "codex", "openscout", "workspace"] as PlanSourceFilter[]).map((source) => (
          <button
            key={source}
            type="button"
            className={`s-plan-left-source${sourceFilter === source ? " s-plan-left-source--active" : ""}`}
            onClick={() => setSourceFilter(source)}
          >
            <span>{PLAN_SOURCE_LABELS[source]}</span>
            <strong>{sourceCounts[source]}</strong>
          </button>
        ))}
      </div>
      <div className="s-plan-left-list">
        {loading && documents.length === 0 ? (
          <div className="s-left-roster-empty">Indexing plan documents...</div>
        ) : visibleDocuments.length === 0 ? (
          <div className="s-left-roster-empty">{documents.length === 0 ? "No plan documents found" : "No plans match"}</div>
        ) : (
          visibleDocuments.map((document) => (
            <button
              key={document.id}
              type="button"
              className={`s-plan-left-document${document.id === selectedId ? " s-plan-left-document--active" : ""}`}
              onClick={() => navigate({ view: "ops", mode: "plan", planDocumentId: document.id })}
              title={`${document.path}\n${document.summary ?? ""}`}
            >
              <div className="s-plan-left-document-top">
                <span className={`s-plan-left-status s-plan-left-status--${document.status}`}>
                  {PLAN_STATUS_LABELS[document.status]}
                </span>
                <span>{PLAN_SOURCE_LABELS[document.source]}</span>
                <time>{timeAgo(document.updatedAt)}</time>
              </div>
              <div className="s-plan-left-document-title">{document.title}</div>
              {document.summary && <div className="s-plan-left-document-summary">{document.summary}</div>}
              <div className="s-plan-left-document-foot">
                <span>{planProgressLabel(document)}</span>
                <span>{planPathBasename(document.path)}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

const DEFAULT_STATE_FILTERS: ReadonlySet<FleetStateToken> = new Set([
  "working",
  "ready",
  "not_ready",
]);

function ScoutAgentsLeftPanel() {
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
