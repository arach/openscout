import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import "../slots/ctx-panel.css";
import { useScout } from "../Provider.tsx";
import { normalizeAgentState } from "../../lib/agent-state.ts";
import { api } from "../../lib/api.ts";
import {
  filterAgentsByMachineScope,
  filterFleetByMachineScope,
  machineScopedAgentIds,
} from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import { RailRow } from "../slots/RailRow.tsx";
import type {
  Agent,
  FleetActivity,
  FleetAsk,
  FleetAttentionItem,
  FleetState,
  HomeContextSelection,
  ProjectLandscapeItem,
  ProjectLandscapeState,
  Route,
} from "../../lib/types.ts";

const PROJECT_CONTEXT_LIMIT = 8;
const AGENT_PULSE_LIMIT = 8;
const ACTIVITY_LOG_LIMIT = 14;

const FLEET_REFRESH_EVENTS = new Set([
  "message.posted",
  "flight.updated",
  "collaboration.event.appended",
  "agent.updated",
  "agent.registered",
  "invocation.requested",
  "delivery.state.changed",
]);

type HomeContextTone = "overview" | "project" | "agent" | "activity" | "ask" | "attention";

type HomeContextChromeData = {
  tone: HomeContextTone;
  label: string;
  title: string;
  meta: string;
};

export function HomeAgentsInspector() {
  const {
    agents,
    navigate,
    route,
    homeContextSelection,
    setHomeContextSelection,
  } = useScout();
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [landscape, setLandscape] = useState<ProjectLandscapeState | null>(null);
  const machineId = routeMachineId(route);
  const scopedAgentIds = useMemo(
    () => machineScopedAgentIds(agents, machineId),
    [agents, machineId],
  );
  const scopedAgents = useMemo(
    () => filterAgentsByMachineScope(agents, machineId),
    [agents, machineId],
  );
  const scopedFleet = useMemo(
    () => filterFleetByMachineScope(fleet, scopedAgentIds),
    [fleet, scopedAgentIds],
  );

  const load = useCallback(async () => {
    const [fleetResult, landscapeResult] = await Promise.allSettled([
      api<FleetState>("/api/fleet"),
      api<ProjectLandscapeState>("/api/project-landscape?limit=12"),
    ]);
    if (fleetResult.status === "fulfilled") setFleet(fleetResult.value);
    if (landscapeResult.status === "fulfilled") setLandscape(landscapeResult.value);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBrokerEvents((event) => {
    if (FLEET_REFRESH_EVENTS.has(event.kind)) {
      void load();
    }
  });

  const visibleProjects = useMemo(
    () => filterProjectsByAgentScope(landscape?.projects ?? [], scopedAgentIds),
    [landscape?.projects, scopedAgentIds],
  );
  const projectTotals = useMemo(() => summarizeProjectTotals(visibleProjects), [visibleProjects]);
  const projectContext = useMemo(
    () => sortProjectsForContext(visibleProjects),
    [visibleProjects],
  );
  const activeAsks = scopedFleet?.activeAsks ?? [];
  const asks = useMemo(
    () => [...(scopedFleet?.activeAsks ?? []), ...(scopedFleet?.recentCompleted ?? [])],
    [scopedFleet?.activeAsks, scopedFleet?.recentCompleted],
  );
  const needsAttention = scopedFleet?.needsAttention ?? [];
  const activity = scopedFleet?.activity ?? [];
  const recentAgents = useMemo(
    () => [...scopedAgents]
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, AGENT_PULSE_LIMIT),
    [scopedAgents],
  );

  if (agents.length === 0) {
    return (
      <div className="ctx-panel ctx-panel--empty">
        <div className="ctx-panel-empty-state">
          <div className="ctx-panel-empty-hint">Connect an agent to see fleet context here.</div>
        </div>
      </div>
    );
  }

  const selectedProject = homeContextSelection.kind === "project"
    ? visibleProjects.find((project) => project.key === homeContextSelection.projectKey) ?? null
    : null;
  const selectedAgent = homeContextSelection.kind === "agent"
    ? scopedAgents.find((agent) => agent.id === homeContextSelection.agentId) ?? null
    : null;
  const selectedAsk = homeContextSelection.kind === "ask"
    ? asks.find((ask) => ask.invocationId === homeContextSelection.invocationId) ?? null
    : null;
  const selectedAttention = homeContextSelection.kind === "attention"
    ? needsAttention.find((item) => item.recordId === homeContextSelection.recordId) ?? null
    : null;
  const selectedActivity = homeContextSelection.kind === "activity"
    ? activity.find((item) => item.id === homeContextSelection.activityId) ?? null
    : null;
  const contextChrome = buildHomeContextChrome(homeContextSelection, {
    selectedProject,
    selectedAgent,
    selectedAsk,
    selectedAttention,
    selectedActivity,
    projectContext,
    projectTotals,
    scopedAgents,
    activeAsks,
    activity,
  });
  const contextKey = homeContextKey(homeContextSelection);

  const commonProps = {
    navigate,
    setHomeContextSelection,
    scopedAgents,
    asks,
    activeAsks,
    needsAttention,
    activity,
    projectContext,
    projectTotals,
    recentAgents,
  };

  return (
    <div className="ctx-panel ctx-panel--home-inspector" data-home-context-tone={contextChrome.tone}>
      <HomeContextChrome chrome={contextChrome} contextKey={contextKey} />
      <div className="ctx-home-context-body">
        {homeContextSelection.kind === "overview" && <OverviewContext {...commonProps} />}
        {homeContextSelection.kind === "projects" && <ProjectsContext {...commonProps} />}
        {homeContextSelection.kind === "project" && (
          <ProjectContext
            {...commonProps}
            project={selectedProject}
          />
        )}
        {homeContextSelection.kind === "agent" && (
          <AgentContext
            {...commonProps}
            agent={selectedAgent}
          />
        )}
        {homeContextSelection.kind === "ask" && (
          <AskContext
            {...commonProps}
            ask={selectedAsk}
          />
        )}
        {homeContextSelection.kind === "attention" && (
          <AttentionContext
            {...commonProps}
            item={selectedAttention}
          />
        )}
        {homeContextSelection.kind === "activity-log" && <ActivityLogContext {...commonProps} />}
        {homeContextSelection.kind === "activity" && (
          <ActivityContext
            {...commonProps}
            item={selectedActivity}
          />
        )}
      </div>
    </div>
  );
}

type HomeContextProps = {
  navigate: (route: Route) => void;
  setHomeContextSelection: (selection: HomeContextSelection) => void;
  scopedAgents: Agent[];
  asks: FleetAsk[];
  activeAsks: FleetAsk[];
  needsAttention: FleetAttentionItem[];
  activity: FleetActivity[];
  projectContext: ProjectLandscapeItem[];
  projectTotals: { dirtyProjects: number; changedFiles: number };
  recentAgents: Agent[];
};

function HomeContextChrome({
  chrome,
  contextKey,
}: {
  chrome: HomeContextChromeData;
  contextKey: string;
}) {
  return (
    <div className="ctx-home-context-bar">
      <span key={contextKey} className="ctx-home-context-marker" aria-hidden="true" />
      <div className="ctx-home-context-copy">
        <span className="ctx-home-context-label">{chrome.label}</span>
        <strong className="ctx-home-context-title" title={chrome.title}>{chrome.title}</strong>
      </div>
      <span className="ctx-home-context-meta" title={chrome.meta}>{chrome.meta}</span>
    </div>
  );
}

function OverviewContext({
  setHomeContextSelection,
  scopedAgents,
  activeAsks,
  needsAttention,
  activity,
  projectContext,
  projectTotals,
}: HomeContextProps) {
  const activeAgents = scopedAgents.filter((agent) => normalizeAgentState(agent.state) === "working");
  return (
    <>
      <PanelSection label="Overview">
        <div className="ctx-panel-list">
          <RailRow
            name="Project landscape"
            sub={`${projectContext.length} projects · ${projectTotals.dirtyProjects} dirty · ${projectTotals.changedFiles} changed`}
            tone="neutral"
            onClick={() => setHomeContextSelection({ kind: "projects" })}
          />
          <RailRow
            name="Activity log"
            sub={`${activity.length} recent records`}
            meta={activity[0]?.ts ? timeAgo(activity[0].ts) : undefined}
            tone="neutral"
            onClick={() => setHomeContextSelection({ kind: "activity-log" })}
          />
          <RailRow
            name="Active jobs"
            sub={activeAsks.length > 0 ? `${activeAsks.length} open` : "0 open"}
            tone={activeAsks.length > 0 ? "working" : "neutral"}
            unread={activeAsks.length > 0}
            onClick={() => {
              if (activeAsks[0]) {
                setHomeContextSelection({ kind: "ask", invocationId: activeAsks[0].invocationId });
              }
            }}
          />
        </div>
      </PanelSection>

      {needsAttention.length > 0 && (
        <PanelSection label="Needs you" count={needsAttention.length}>
          <div className="ctx-panel-list">
            {needsAttention.slice(0, 4).map((item) => (
              <AttentionRow
                key={item.recordId}
                item={item}
                onClick={() => setHomeContextSelection({ kind: "attention", recordId: item.recordId })}
              />
            ))}
          </div>
        </PanelSection>
      )}

      <PanelSection label="Pulse">
        <div className="ctx-panel-list">
          <RailRow
            name="Agents"
            sub={`${activeAgents.length} active · ${scopedAgents.length} in scope`}
            tone={activeAgents.length > 0 ? "working" : "neutral"}
          />
          <RailRow
            name="Latest project"
            sub={projectContext[0] ? `${projectContext[0].title} · ${projectDiffLabel(projectContext[0])}` : "0 projects"}
            meta={projectContext[0]?.lastActivityAt ? timeAgo(projectContext[0].lastActivityAt) : undefined}
            tone="neutral"
            onClick={() => {
              if (projectContext[0]) {
                setHomeContextSelection({ kind: "project", projectKey: projectContext[0].key });
              }
            }}
          />
        </div>
      </PanelSection>
    </>
  );
}

function ProjectsContext({
  projectContext,
  projectTotals,
  setHomeContextSelection,
}: HomeContextProps) {
  return (
    <>
      <PanelSection label="Project landscape" count={projectContext.length}>
        {projectContext.length === 0 ? (
          <div className="ctx-panel-empty">0 projects</div>
        ) : (
          <div className="ctx-panel-list">
            {projectContext.slice(0, PROJECT_CONTEXT_LIMIT).map((project) => (
              <ProjectContextRow
                key={project.key}
                project={project}
                onClick={() => setHomeContextSelection({ kind: "project", projectKey: project.key })}
              />
            ))}
          </div>
        )}
      </PanelSection>
      <PanelSection label="Diff rollup">
        <div className="ctx-home-facts">
          <FactRow label="dirty projects" value={`${projectTotals.dirtyProjects}`} />
          <FactRow label="changed files" value={`${projectTotals.changedFiles}`} />
        </div>
      </PanelSection>
    </>
  );
}

function ProjectContext({
  project,
  scopedAgents,
  activeAsks,
  activity,
  navigate,
  setHomeContextSelection,
}: HomeContextProps & {
  project: ProjectLandscapeItem | null;
}) {
  if (!project) {
    return <MissingContext label="Project" onReset={() => setHomeContextSelection({ kind: "projects" })} />;
  }
  const agentIds = new Set(project.agentIds);
  const projectAgents = scopedAgents
    .filter((agent) => agentIds.has(agent.id))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 5);
  const projectAsks = activeAsks.filter((ask) => agentIds.has(ask.agentId));
  const projectActivity = activity
    .filter((item) => (item.agentId && agentIds.has(item.agentId)) || (item.actorId && agentIds.has(item.actorId)))
    .slice(0, 5);

  return (
    <>
      <PanelSection label="Project">
        <SelectedCard
          title={project.title}
          meta={compactProjectPath(project.root)}
          body={[
            `diff: ${projectDiffLabel(project)}`,
            `branch: ${project.diff?.branch ?? project.branches[0] ?? "unknown"}`,
            `agents: ${project.agentCount}`,
            `harnesses: ${project.harnesses.join(", ") || "unknown"}`,
          ].join("\n")}
          actionLabel="Open project view"
          onAction={() => navigate({ view: "agents", projectKey: project.key })}
        />
      </PanelSection>

      <PanelSection label="Open jobs" count={projectAsks.length}>
        {projectAsks.length === 0 ? (
          <div className="ctx-panel-empty">0 open</div>
        ) : (
          <div className="ctx-panel-list">
            {projectAsks.map((ask) => (
              <AskRow
                key={ask.invocationId}
                ask={ask}
                onClick={() => setHomeContextSelection({ kind: "ask", invocationId: ask.invocationId })}
              />
            ))}
          </div>
        )}
      </PanelSection>

      <PanelSection label="Recent agents" count={projectAgents.length}>
        {projectAgents.length === 0 ? (
          <div className="ctx-panel-empty">No agents in scope</div>
        ) : (
          <div className="ctx-panel-list">
            {projectAgents.map((agent) => (
              <AgentPulseRow
                key={agent.id}
                agent={agent}
                onClick={() => setHomeContextSelection({ kind: "agent", agentId: agent.id })}
              />
            ))}
          </div>
        )}
      </PanelSection>

      <PanelSection label="Activity" count={projectActivity.length}>
        {projectActivity.length === 0 ? (
          <div className="ctx-panel-empty">No recent project activity</div>
        ) : (
          <div className="ctx-panel-list">
            {projectActivity.map((item) => (
              <ActivityRow
                key={item.id}
                item={item}
                onClick={() => setHomeContextSelection({ kind: "activity", activityId: item.id })}
              />
            ))}
          </div>
        )}
      </PanelSection>
    </>
  );
}

function AgentContext({
  agent,
  activeAsks,
  activity,
  navigate,
  setHomeContextSelection,
}: HomeContextProps & {
  agent: Agent | null;
}) {
  if (!agent) {
    return <MissingContext label="Agent" onReset={() => setHomeContextSelection({ kind: "overview" })} />;
  }
  const state = normalizeAgentState(agent.state);
  const agentAsks = activeAsks.filter((ask) => ask.agentId === agent.id);
  const agentActivity = activity
    .filter((item) => item.agentId === agent.id || item.actorId === agent.id || item.actorName === agent.name)
    .slice(0, 6);

  return (
    <>
      <PanelSection label="Agent">
        <SelectedCard
          title={agent.name}
          meta={[state, agent.harness, agent.branch].filter(Boolean).join(" · ")}
          body={[
            `project: ${agent.project ?? "unknown"}`,
            `root: ${compactProjectPath(agent.projectRoot ?? agent.cwd)}`,
            `session: ${agent.harnessSessionId ?? agent.conversationId}`,
            `updated: ${agent.updatedAt ? timeAgo(agent.updatedAt) : "unknown"}`,
          ].join("\n")}
          actionLabel={state === "working" ? "Observe session" : "Open profile"}
          onAction={() =>
            navigate({
              view: "agents",
              agentId: agent.id,
              conversationId: agent.conversationId,
              tab: state === "working" ? "observe" : "profile",
            })
          }
        />
      </PanelSection>

      <PanelSection label="Open jobs" count={agentAsks.length}>
        {agentAsks.length === 0 ? (
          <div className="ctx-panel-empty">0 open</div>
        ) : (
          <div className="ctx-panel-list">
            {agentAsks.map((ask) => (
              <AskRow
                key={ask.invocationId}
                ask={ask}
                onClick={() => setHomeContextSelection({ kind: "ask", invocationId: ask.invocationId })}
              />
            ))}
          </div>
        )}
      </PanelSection>

      <PanelSection label="Activity" count={agentActivity.length}>
        {agentActivity.length === 0 ? (
          <div className="ctx-panel-empty">No recent agent activity</div>
        ) : (
          <div className="ctx-panel-list">
            {agentActivity.map((item) => (
              <ActivityRow
                key={item.id}
                item={item}
                onClick={() => setHomeContextSelection({ kind: "activity", activityId: item.id })}
              />
            ))}
          </div>
        )}
      </PanelSection>
    </>
  );
}

function ActivityLogContext({
  activity,
  setHomeContextSelection,
}: HomeContextProps) {
  return (
    <PanelSection label="Activity log" count={activity.length}>
      {activity.length === 0 ? (
        <div className="ctx-panel-empty">No recent activity</div>
      ) : (
        <div className="ctx-panel-list ctx-panel-list--scroll">
          {activity.slice(0, ACTIVITY_LOG_LIMIT).map((item) => (
            <ActivityRow
              key={item.id}
              item={item}
              onClick={() => setHomeContextSelection({ kind: "activity", activityId: item.id })}
            />
          ))}
        </div>
      )}
    </PanelSection>
  );
}

function AskContext({
  ask,
  scopedAgents,
  navigate,
  setHomeContextSelection,
}: HomeContextProps & {
  ask: FleetAsk | null;
}) {
  if (!ask) {
    return <MissingContext label="Ask" onReset={() => setHomeContextSelection({ kind: "activity-log" })} />;
  }
  const agent = scopedAgents.find((candidate) => candidate.id === ask.agentId) ?? null;
  return (
    <>
      <PanelSection label="Ask">
        <SelectedCard
          title={ask.task}
          meta={[ask.agentName ?? agent?.name ?? ask.agentId, ask.statusLabel, timeAgo(ask.updatedAt)].join(" · ")}
          body={[
            ask.summary ?? "No summary",
            `harness: ${ask.harness ?? agent?.harness ?? "unknown"}`,
            `agent: ${ask.agentName ?? agent?.name ?? ask.agentId}`,
            `status: ${ask.status}`,
          ].join("\n")}
          actionLabel="Open source"
          onAction={() => navigate(routeForAsk(ask))}
        />
      </PanelSection>
      {agent && (
        <PanelSection label="Agent">
          <div className="ctx-panel-list">
            <AgentPulseRow
              agent={agent}
              onClick={() => setHomeContextSelection({ kind: "agent", agentId: agent.id })}
            />
          </div>
        </PanelSection>
      )}
    </>
  );
}

function AttentionContext({
  item,
  navigate,
  setHomeContextSelection,
}: HomeContextProps & {
  item: FleetAttentionItem | null;
}) {
  if (!item) {
    return <MissingContext label="Attention" onReset={() => setHomeContextSelection({ kind: "activity-log" })} />;
  }
  const route = routeForAttention(item);
  return (
    <>
      <PanelSection label="Needs attention">
        <SelectedCard
          title={item.title}
          meta={[item.agentName ?? item.agentId ?? "operator", item.kind, timeAgo(item.updatedAt)].join(" · ")}
          body={[
            item.summary ?? "No summary",
            `state: ${item.state}`,
            `acceptance: ${item.acceptanceState}`,
          ].join("\n")}
          actionLabel={route ? "Open source" : undefined}
          onAction={route ? () => navigate(route) : undefined}
        />
      </PanelSection>
      <PanelSection label="Context">
        <div className="ctx-home-facts">
          <FactRow label="kind" value={item.kind.replace(/_/g, " ")} />
          <FactRow label="agent" value={item.agentName ?? item.agentId ?? "operator"} />
          <FactRow label="state" value={item.state.replace(/_/g, " ")} />
          <FactRow label="updated" value={timeAgo(item.updatedAt)} />
        </div>
      </PanelSection>
    </>
  );
}

function ActivityContext({
  item,
  navigate,
  setHomeContextSelection,
}: HomeContextProps & {
  item: FleetActivity | null;
}) {
  if (!item) {
    return <MissingContext label="Activity" onReset={() => setHomeContextSelection({ kind: "activity-log" })} />;
  }
  const route = routeForActivity(item);
  return (
    <>
      <PanelSection label="Activity">
        <SelectedCard
          title={item.title ?? activityKindLabel(item.kind)}
          meta={[item.actorName ?? item.agentName ?? item.agentId ?? "system", activityKindLabel(item.kind), timeAgo(item.ts)].join(" · ")}
          body={item.summary ?? item.title ?? activityKindLabel(item.kind)}
          actionLabel={route ? "Open source" : undefined}
          onAction={route ? () => navigate(route) : undefined}
        />
      </PanelSection>
      <PanelSection label="Context">
        <div className="ctx-home-facts">
          <FactRow label="actor" value={item.actorName ?? item.agentName ?? item.agentId ?? "system"} />
          <FactRow label="kind" value={activityKindLabel(item.kind)} />
          <FactRow label="time" value={timeAgo(item.ts)} />
          <FactRow label="record" value={item.recordId ?? item.flightId ?? item.invocationId ?? item.id} />
        </div>
      </PanelSection>
    </>
  );
}

function PanelSection({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="ctx-panel-section">
      <div className="ctx-panel-section-label">
        <span>{label}</span>
        {typeof count === "number" && <span className="ctx-panel-count">{count}</span>}
      </div>
      {children}
    </section>
  );
}

function SelectedCard({
  title,
  meta,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  meta: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="ctx-panel-selected-card ctx-home-selected-card">
      <div className="ctx-panel-selected-title">{title}</div>
      <div className="ctx-panel-selected-meta">{meta}</div>
      <div className="ctx-panel-selected-body">{body}</div>
      {actionLabel && onAction && (
        <div className="ctx-home-action-row">
          <button type="button" className="ctx-panel-selected-action" onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function MissingContext({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <PanelSection label={label}>
      <div className="ctx-panel-empty">Selection is no longer in the current scope.</div>
      <div className="ctx-home-action-row">
        <button type="button" className="ctx-panel-selected-action" onClick={onReset}>
          Back to overview
        </button>
      </div>
    </PanelSection>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="ctx-home-fact-row">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function AttentionRow({
  item,
  onClick,
}: {
  item: FleetAttentionItem;
  onClick: () => void;
}) {
  return (
    <RailRow
      name={item.title}
      sub={`${item.agentName ?? item.agentId ?? "operator"} · ${item.kind.replace(/_/g, " ")}`}
      meta={timeAgo(item.updatedAt)}
      tone="working"
      unread
      onClick={onClick}
    />
  );
}

function AskRow({
  ask,
  onClick,
}: {
  ask: FleetAsk;
  onClick: () => void;
}) {
  return (
    <RailRow
      name={ask.task}
      sub={`${ask.agentName ?? ask.agentId} · ${ask.statusLabel}`}
      meta={timeAgo(ask.updatedAt)}
      tone={ask.status === "working" ? "working" : "neutral"}
      unread={ask.status === "working"}
      onClick={onClick}
    />
  );
}

function ProjectContextRow({
  project,
  onClick,
}: {
  project: ProjectLandscapeItem;
  onClick: () => void;
}) {
  const diffTone = project.diff?.status ?? "unknown";
  return (
    <RailRow
      name={project.title}
      sub={`${projectDiffLabel(project)} · ${compactProjectPath(project.root)}`}
      meta={projectContextMeta(project)}
      tone="neutral"
      leadingIcon={<span className={`ctx-home-project-marker ctx-home-project-marker--${diffTone}`} />}
      unread={project.diff?.status === "dirty" || project.workingAgents > 0}
      onClick={onClick}
      title={project.root ?? project.title}
    />
  );
}

function AgentPulseRow({
  agent,
  onClick,
}: {
  agent: Agent;
  onClick: () => void;
}) {
  const state = normalizeAgentState(agent.state);
  return (
    <RailRow
      name={agent.name || agent.id}
      sub={agent.branch ?? agent.project ?? state}
      meta={agent.updatedAt ? timeAgo(agent.updatedAt) : undefined}
      tone={state}
      avatarName={agent.name}
      unread={state === "working"}
      onClick={onClick}
    />
  );
}

function ActivityRow({
  item,
  onClick,
}: {
  item: FleetActivity;
  onClick: () => void;
}) {
  const actor = item.actorName ?? item.agentName ?? item.agentId ?? "system";
  return (
    <RailRow
      name={item.title ?? item.summary ?? activityKindLabel(item.kind)}
      sub={`${actor} · ${activityKindLabel(item.kind)}`}
      meta={timeAgo(item.ts)}
      tone="neutral"
      onClick={onClick}
    />
  );
}

function homeContextKey(selection: HomeContextSelection): string {
  switch (selection.kind) {
    case "overview":
    case "projects":
    case "activity-log":
      return selection.kind;
    case "project":
      return `project:${selection.projectKey}`;
    case "agent":
      return `agent:${selection.agentId}`;
    case "ask":
      return `ask:${selection.invocationId}`;
    case "attention":
      return `attention:${selection.recordId}`;
    case "activity":
      return `activity:${selection.activityId}`;
  }
}

function buildHomeContextChrome(
  selection: HomeContextSelection,
  context: {
    selectedProject: ProjectLandscapeItem | null;
    selectedAgent: Agent | null;
    selectedAsk: FleetAsk | null;
    selectedAttention: FleetAttentionItem | null;
    selectedActivity: FleetActivity | null;
    projectContext: ProjectLandscapeItem[];
    projectTotals: { dirtyProjects: number; changedFiles: number };
    scopedAgents: Agent[];
    activeAsks: FleetAsk[];
    activity: FleetActivity[];
  },
): HomeContextChromeData {
  switch (selection.kind) {
    case "overview":
      return {
        tone: "overview",
        label: "Overview context",
        title: "Fleet overview",
        meta: `${context.scopedAgents.length} agents · ${context.activeAsks.length} open`,
      };
    case "projects":
      return {
        tone: "project",
        label: "Project context",
        title: "Project landscape",
        meta: `${context.projectContext.length} projects · ${context.projectTotals.changedFiles} changed`,
      };
    case "project":
      return {
        tone: "project",
        label: "Project context",
        title: compactContextText(context.selectedProject?.title, "Project missing"),
        meta: context.selectedProject
          ? `${projectDiffLabel(context.selectedProject)} · ${compactProjectPath(context.selectedProject.root)}`
          : "selection out of scope",
      };
    case "agent": {
      const state = context.selectedAgent ? normalizeAgentState(context.selectedAgent.state) : "missing";
      return {
        tone: "agent",
        label: "Agent context",
        title: compactContextText(context.selectedAgent?.name, "Agent missing"),
        meta: context.selectedAgent
          ? [state, context.selectedAgent.harness, context.selectedAgent.branch].filter(Boolean).join(" · ")
          : "selection out of scope",
      };
    }
    case "ask":
      return {
        tone: "ask",
        label: "Ask context",
        title: compactContextText(context.selectedAsk?.task, "Ask missing"),
        meta: context.selectedAsk
          ? [context.selectedAsk.agentName ?? context.selectedAsk.agentId, context.selectedAsk.statusLabel].join(" · ")
          : "selection out of scope",
      };
    case "attention":
      return {
        tone: "attention",
        label: "Attention context",
        title: compactContextText(context.selectedAttention?.title, "Attention missing"),
        meta: context.selectedAttention
          ? [context.selectedAttention.agentName ?? context.selectedAttention.agentId ?? "operator", context.selectedAttention.kind].join(" · ")
          : "selection out of scope",
      };
    case "activity-log":
      return {
        tone: "activity",
        label: "Activity context",
        title: "Activity log",
        meta: `${context.activity.length} records`,
      };
    case "activity":
      return {
        tone: "activity",
        label: "Activity context",
        title: compactContextText(
          context.selectedActivity?.title ?? context.selectedActivity?.summary,
          context.selectedActivity ? activityKindLabel(context.selectedActivity.kind) : "Activity missing",
        ),
        meta: context.selectedActivity
          ? [context.selectedActivity.actorName ?? context.selectedActivity.agentName ?? context.selectedActivity.agentId ?? "system", activityKindLabel(context.selectedActivity.kind)].join(" · ")
          : "selection out of scope",
      };
  }
}

function compactContextText(value: string | null | undefined, fallback: string, max = 74): string {
  const compact = value?.replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function routeForAsk(ask: FleetAsk): Route {
  if (ask.conversationId) return { view: "conversation", conversationId: ask.conversationId };
  if (ask.collaborationRecordId) return { view: "work", workId: ask.collaborationRecordId };
  return { view: "agents", agentId: ask.agentId };
}

function routeForActivity(item: FleetActivity): Route | null {
  if (item.conversationId) return { view: "conversation", conversationId: item.conversationId };
  if (item.agentId) return { view: "agents", agentId: item.agentId };
  return null;
}

function routeForAttention(item: FleetAttentionItem): Route | null {
  if (item.kind === "work_item" && item.recordId) return { view: "work", workId: item.recordId };
  if (item.conversationId) return { view: "conversation", conversationId: item.conversationId };
  if (item.agentId) return { view: "agents", agentId: item.agentId };
  return null;
}

function filterProjectsByAgentScope(
  projects: ProjectLandscapeItem[],
  agentIds: Set<string> | null,
): ProjectLandscapeItem[] {
  if (!agentIds) return projects;
  return projects.filter((project) => project.agentIds.some((agentId) => agentIds.has(agentId)));
}

function summarizeProjectTotals(projects: ProjectLandscapeItem[]) {
  return projects.reduce(
    (totals, project) => {
      const changedFiles = project.diff?.changedFiles ?? 0;
      return {
        dirtyProjects: totals.dirtyProjects + (project.diff?.status === "dirty" ? 1 : 0),
        changedFiles: totals.changedFiles + changedFiles,
      };
    },
    { dirtyProjects: 0, changedFiles: 0 },
  );
}

function sortProjectsForContext(projects: ProjectLandscapeItem[]): ProjectLandscapeItem[] {
  return [...projects].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (a.workingAgents !== b.workingAgents) return b.workingAgents - a.workingAgents;
    if (a.openJobs !== b.openJobs) return b.openJobs - a.openJobs;
    if ((a.diff?.changedFiles ?? 0) !== (b.diff?.changedFiles ?? 0)) {
      return (b.diff?.changedFiles ?? 0) - (a.diff?.changedFiles ?? 0);
    }
    return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) || a.title.localeCompare(b.title);
  });
}

function projectDiffLabel(project: ProjectLandscapeItem): string {
  if (!project.diff) return "diff unknown";
  if (project.diff.error) return "diff unavailable";
  if (project.diff.changedFiles === 0) return "clean";
  return `${project.diff.changedFiles} changed`;
}

function projectContextMeta(project: ProjectLandscapeItem): string {
  if (project.openJobs > 0) return `${project.openJobs} jobs`;
  if (project.workingAgents > 0) return `${project.workingAgents} active`;
  return project.lastActivityAt ? timeAgo(project.lastActivityAt) : `${project.agentCount} agents`;
}

function compactProjectPath(path: string | null | undefined): string {
  if (!path) return "no root";
  if (path.startsWith("/Users/")) return `~/${path.split("/").slice(3).join("/")}`;
  return path;
}

function activityKindLabel(kind: string): string {
  return kind.replace(/[._]/g, " ");
}
