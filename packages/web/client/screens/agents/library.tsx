import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalFlag } from "hudsonkit/flags";
import { normalizeAgentState } from "../../lib/agent-state.ts";
import { formatLabel } from "../../lib/text.ts";
import { timeAgo } from "../../lib/time.ts";
import { ObservedTopologyPanel } from "../../components/ObservedTopologyPanel.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import { useScout } from "../../scout/Provider.tsx";
import type {
  Agent,
  FleetAsk,
  FleetState,
  HarnessTopologySnapshot,
  Route,
  SessionEntry,
  TailDiscoverySnapshot,
} from "../../lib/types.ts";
import {
  DEFAULT_TIME_HORIZON,
  TIME_HORIZON_OPTIONS,
  agentInventoryRowMatchesQuery,
  agentInventoryStatusClass,
  buildNativeSessionRows,
  buildProjectSlices,
  buildProjectTree,
  buildWorkflowRows,
  classPart,
  countLabel,
  harnessChipClass,
  isWithinTimeHorizon,
  nativeSessionMatchesFilters,
  primaryAgentSelector,
  readCollapsedProjectTreeRows,
  rowForAgentInventory,
  scoutSessionMatchesFilters,
  shortSessionId,
  showProjectLevelSessionInOverview,
  sortProjectTreeSessions,
  treeDotColor,
  workflowMatchesFilters,
  workflowSessionNode,
  writeCollapsedProjectTreeRows,
  type AgentInventoryRow,
  type ProjectSlice,
  type ProjectTreeSessionNode,
  type TimeHorizonKey,
} from "./model.ts";

/* ── Projects-first model ──────────────────────────────────────────────
   The project is the primary object; under each, its agents' work surfaces
   as session rows. Lenses (needs/active/all) narrow the set; tiered
   disclosure keeps rows to title+recency until you click for coordinates. */

type Lens = "needs" | "active" | "all";

const LENSES: { id: Lens; label: string; attn?: boolean }[] = [
  { id: "needs", label: "Needs you", attn: true },
  { id: "active", label: "Active" },
  { id: "all", label: "All" },
];

type AgentsView = "project" | "recent";

/** A unified "work row" — an agent's current thread, in the studio's session
 *  shape (title · sref · card · harness · branch · recency). */
type WorkRow = {
  row: AgentInventoryRow;
  title: string;
  sref: string | null;
  card: string;
  harness: string;
  branch: string | null;
  time: number | null;
  working: boolean;
  attn: boolean;
};

function projectWorkingCount(project: ProjectSlice): number {
  return project.agents.filter((row) => row.status === "in_turn" || row.status === "in_flight").length;
}

function projectNeedsAttention(project: ProjectSlice): boolean {
  return project.agents.some((row) => row.activeAskCount > 0);
}

function agentWorkRow(row: AgentInventoryRow): WorkRow {
  const sessionId = row.session?.id ?? row.agent.harnessSessionId ?? null;
  return {
    row,
    title: row.activeTask ?? row.session?.preview ?? row.agent.name,
    sref: sessionId ? shortSessionId(sessionId) : null,
    card: row.agent.name,
    harness: row.harness,
    branch: row.branch && row.branch !== "—" ? row.branch : null,
    time: row.lastActivityAt,
    working: row.status === "in_turn" || row.status === "in_flight",
    attn: row.activeAskCount > 0,
  };
}

export function AgentsLibrary({
  agents,
  fleet,
  sessionByAgentId,
  conversationByAgentId,
  sessions,
  discovery,
  topologySnapshot,
  navigate,
}: {
  agents: Agent[];
  fleet: FleetState | null;
  sessionByAgentId: Map<string, SessionEntry>;
  conversationByAgentId: Map<string, string>;
  sessions: SessionEntry[];
  discovery: TailDiscoverySnapshot | null;
  topologySnapshot: HarnessTopologySnapshot | null;
  navigate: (r: Route) => void;
}) {
  const { route } = useScout();
  // Workflow / harness-topology telemetry is a power surface — the lean
  // directory is just the project-grouped agent board (cards/tree).
  const workflowsEnabled = useOptionalFlag("surface.workflows", false);
  const [query, setQuery] = useState("");
  // Search is engage-on-demand: the box stays out of the way until you reach for
  // it (the search action, or "/"), so the board leads with the list, not chrome.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Project blocks expand by default when a project has working agents; idle
  // projects fold to a line. `openOverride` records explicit user toggles.
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(Date.now());

  // Filters are gone for now — search-first; we fold filters back into search
  // later. Keep the data unscoped (all time, no harness narrowing) and the
  // board fixed to the project grouping.
  const [timeHorizon] = useState<TimeHorizonKey>("all");
  const [harnessFilter] = useState<Set<string>>(() => new Set());
  const lens: Lens = "all";

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  // Focus the box the moment search is engaged.
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // "/" reaches for search from anywhere on the board (skip while typing).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const inEditable = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target?.isContentEditable ?? false);
      if (inEditable) return;
      event.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeAsksByAgent = useMemo(() => {
    const byAgent = new Map<string, FleetAsk[]>();
    for (const ask of fleet?.activeAsks ?? []) {
      const list = byAgent.get(ask.agentId) ?? [];
      list.push(ask);
      byAgent.set(ask.agentId, list);
    }
    return byAgent;
  }, [fleet?.activeAsks]);

  const rows = useMemo(
    () =>
      agents.map((agent) =>
        rowForAgentInventory(
          agent,
          sessionByAgentId.get(agent.id) ?? null,
          activeAsksByAgent.get(agent.id) ?? [],
        ),
      ),
    [activeAsksByAgent, agents, sessionByAgentId],
  );

  const nativeSessions = useMemo(
    () => buildNativeSessionRows(discovery, now),
    [discovery, now],
  );

  const workflowRows = useMemo(
    () => buildWorkflowRows(topologySnapshot),
    [topologySnapshot],
  );

  const horizonRows = useMemo(
    () => rows.filter((row) =>
      isWithinTimeHorizon(row.lastActivityAt, timeHorizon, now, row.status === "in_turn" || row.status === "in_flight"),
    ),
    [now, rows, timeHorizon],
  );

  const horizonNativeSessions = useMemo(
    () => nativeSessions.filter((row) =>
      isWithinTimeHorizon(row.lastActivityAt, timeHorizon, now, row.status === "active"),
    ),
    [nativeSessions, now, timeHorizon],
  );

  const horizonScoutSessions = useMemo(
    () => sessions.filter((session) =>
      isWithinTimeHorizon(session.lastMessageAt, timeHorizon, now, false),
    ),
    [now, sessions, timeHorizon],
  );

  const horizonWorkflowRows = useMemo(
    () => workflowRows.filter((row) =>
      isWithinTimeHorizon(row.lastActivityAt, timeHorizon, now, row.activeTaskCount > 0 || row.status === "running"),
    ),
    [now, timeHorizon, workflowRows],
  );

  const allProjects = useMemo(
    () => buildProjectSlices(horizonRows, horizonScoutSessions, horizonNativeSessions, horizonWorkflowRows),
    [horizonNativeSessions, horizonRows, horizonScoutSessions, horizonWorkflowRows],
  );

  const summary = useMemo(
    () => ({
      notReady: horizonRows.filter((row) => row.status === "blocked").length,
      projects: allProjects.length,
      nativeSessions: horizonNativeSessions.length,
    }),
    [allProjects, horizonNativeSessions, horizonRows],
  );

  const harnessOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of horizonRows) counts.set(row.harness, (counts.get(row.harness) ?? 0) + 1);
    for (const row of horizonNativeSessions) counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
    for (const row of horizonWorkflowRows) counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
    for (const session of horizonScoutSessions) {
      const harness = formatLabel(session.harness) ?? "scout";
      counts.set(harness, (counts.get(harness) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [horizonNativeSessions, horizonRows, horizonScoutSessions, horizonWorkflowRows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return horizonRows.filter((row) => {
      if (harnessFilter.size > 0 && !harnessFilter.has(row.harness)) return false;
      return agentInventoryRowMatchesQuery(row, q);
    });
  }, [harnessFilter, horizonRows, query]);

  const filteredNativeSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return horizonNativeSessions.filter((row) => nativeSessionMatchesFilters(row, q, harnessFilter));
  }, [harnessFilter, horizonNativeSessions, query]);

  const filteredScoutSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return horizonScoutSessions.filter((session) => scoutSessionMatchesFilters(session, q, harnessFilter));
  }, [harnessFilter, horizonScoutSessions, query]);

  const filteredWorkflowRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return horizonWorkflowRows.filter((row) => workflowMatchesFilters(row, q, harnessFilter));
  }, [harnessFilter, horizonWorkflowRows, query]);

  const projects = useMemo(
    () => buildProjectSlices(filteredRows, filteredScoutSessions, filteredNativeSessions, filteredWorkflowRows),
    [filteredNativeSessions, filteredRows, filteredScoutSessions, filteredWorkflowRows],
  );

  const selectedProjectKey = route.view === "agents" && !route.agentId ? route.projectKey : undefined;
  const selectedProject = useMemo(
    () => selectedProjectKey
      ? allProjects.find((project) => project.key === selectedProjectKey) ?? null
      : null,
    [allProjects, selectedProjectKey],
  );
  const visibleProjects = useMemo(
    () => selectedProjectKey
      ? projects.filter((project) => project.key === selectedProjectKey)
      : projects,
    [projects, selectedProjectKey],
  );
  const openAgent = (row: AgentInventoryRow) => {
    const conversationId = conversationByAgentId.get(row.agent.id);
    navigate({
      view: "agents",
      agentId: row.agent.id,
      ...(conversationId ? { conversationId } : {}),
    });
  };

  const selectProject = (project: ProjectSlice) => {
    navigate({ view: "agents", projectKey: project.key });
  };

  const clearProjectSelection = () => {
    navigate({ view: "agents" });
  };

  // Active count drives the footer; with filters gone the board shows every
  // visible project.
  const counts = useMemo(
    () => ({
      active: visibleProjects.filter((p) => projectWorkingCount(p) > 0).length,
    }),
    [visibleProjects],
  );

  const lensProjects = visibleProjects;

  const isProjectOpen = (project: ProjectSlice) =>
    openOverride[project.key] ?? projectWorkingCount(project) > 0;

  const toggleProjectOpen = (project: ProjectSlice) =>
    setOpenOverride((prev) => ({
      ...prev,
      [project.key]: !(prev[project.key] ?? projectWorkingCount(project) > 0),
    }));

  return (
    <div className="s-agents-library s-agents-library--inventory">
      <div className="s-agents-inventory">
        {/* Search has no standing button — the board leads with the list. Press
            "/" to engage; the box appears only once you've reached for it. */}
        {searchOpen && (
          <div className="s-pf-toolbar">
            <div className="s-atop-search s-pf-search">
              <span className="s-atop-search-prompt">▸</span>
              <input
                ref={searchInputRef}
                className="s-atop-search-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="search projects · agents · sessions"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setQuery("");
                    setSearchOpen(false);
                  }
                }}
                onBlur={() => {
                  if (!query.trim()) setSearchOpen(false);
                }}
              />
              <span className="s-atop-search-kbd">esc</span>
            </div>
          </div>
        )}

        {workflowsEnabled && (
          <div className="s-agents-library-topology">
            <ObservedTopologyPanel
              title="Observed harness families"
              size="compact"
              maxAgents={8}
              maxTasks={4}
              showEmpty
            />
          </div>
        )}

        {selectedProjectKey ? (
          selectedProject ? (
            <div className="s-pf-deep">
              <div className="s-pf-deep-head">
                <button type="button" className="s-pf-deep-back" onClick={clearProjectSelection}>
                  ◂ all projects
                </button>
                <span className="s-pf-deep-title">{selectedProject.title}</span>
                {selectedProject.root && (
                  <span className="s-pf-deep-path">{selectedProject.root}</span>
                )}
              </div>
              <ProjectLabeledAgentTree
                project={selectedProject}
                navigate={navigate}
                route={route}
                openAgent={openAgent}
              />
            </div>
          ) : (
            <ProjectsEmpty kind="selected-missing" query={query} lens={lens} />
          )
        ) : lensProjects.length === 0 ? (
          <ProjectsEmpty
            kind={summary.projects === 0 ? "no-projects" : "no-match"}
            query={query}
            lens={lens}
          />
        ) : (
          <div className="s-pf-table">
            <div className="s-pf-colhead s-pf-colhead--proj" aria-hidden>
              <span>project</span>
              <span>working</span>
              <span>sessions</span>
              <span>last</span>
            </div>
            <div className="s-pf-projects">
              {lensProjects.map((project) => (
                <PfProjectBlock
                  key={project.key}
                  project={project}
                  open={isProjectOpen(project)}
                  onToggle={() => toggleProjectOpen(project)}
                  onOpenProject={() => selectProject(project)}
                  openAgent={openAgent}
                />
              ))}
            </div>
          </div>
        )}

        <div className="s-atop-keys">
          <span className="s-atop-keys-count">
            <strong>{lensProjects.length}</strong> / {summary.projects} project{summary.projects === 1 ? "" : "s"}
            {lens !== "all" ? ` · ${lens}` : ""}
          </span>
          <span className="s-atop-keys-spacer" />
          <span>{timeHorizon === "all" ? "all time" : `last ${timeHorizon}`}</span>
          <span>{counts.active} active</span>
          <span>{summary.nativeSessions} harness session{summary.nativeSessions === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}
function ProjectsEmpty({
  kind,
  query,
  lens,
}: {
  kind: "no-projects" | "no-match" | "selected-missing";
  query: string;
  lens: Lens;
}) {
  const title =
    kind === "selected-missing"
      ? "project no longer visible"
      : kind === "no-projects"
        ? "no projects visible"
        : "no projects match";
  const body =
    kind === "selected-missing"
      ? "Return to all projects or pick another from the current set."
      : kind === "no-projects"
        ? "Projects appear when agents, Scout sessions, or harness sessions are discovered."
        : query.trim()
          ? "Adjust the current filter or search."
          : lens === "needs"
            ? "Nothing needs you right now."
            : lens === "active"
              ? "No projects are active in this window."
              : "Adjust the current filter.";
  return (
    <div className="s-pf-projects s-pf-projects--empty">
      <div className="s-pf-empty">
        <div className="s-pf-empty-title">{title}</div>
        <div className="s-pf-empty-body">{body}</div>
      </div>
    </div>
  );
}

// A project row — a group header in the table: project · working · sessions ·
// last. Working projects open by default; expanding reveals session sub-rows
// whose recency aligns under the project's "last" column.
function PfProjectBlock({
  project,
  open,
  onToggle,
  onOpenProject,
  openAgent,
}: {
  project: ProjectSlice;
  open: boolean;
  onToggle: () => void;
  onOpenProject: () => void;
  openAgent: (row: AgentInventoryRow) => void;
}) {
  const working = projectWorkingCount(project);
  const attn = projectNeedsAttention(project);
  const rows = project.agents.map(agentWorkRow);
  const extra =
    project.scoutSessions.length + project.nativeSessions.length + project.workflows.length;

  return (
    <div className="s-pf-proj" data-attn={attn || undefined}>
      <div
        className="s-pf-row s-pf-row--proj s-pf-proj-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="s-pf-cell s-pf-cell--name">
          <span className="s-pf-chevron" data-open={open} aria-hidden>
            ▸
          </span>
          <span className={`s-pf-proj-name${working === 0 ? " s-pf-proj-name--idle" : ""}`}>
            {project.title}
          </span>
          {project.root && (
            <span className="s-pf-proj-path" title={project.root}>
              {project.root}
            </span>
          )}
          {attn && <span className="s-pf-tag">needs you</span>}
        </span>
        <span className="s-pf-cell s-pf-cell--num">
          {working > 0 ? working : <span className="s-pf-dash">—</span>}
        </span>
        <span className="s-pf-cell s-pf-cell--num">
          {project.agents.length}
          {extra > 0 ? <span className="s-pf-extra">+{extra}</span> : null}
        </span>
        <span className="s-pf-cell s-pf-cell--num s-pf-cell--last">
          {project.lastActivityAt ? timeAgo(project.lastActivityAt) : <span className="s-pf-dash">—</span>}
        </span>
      </div>
      {open && (
        <div className="s-pf-sessions">
          {rows.length === 0 ? (
            <div className="s-pf-empty-inline">No active agent threads.</div>
          ) : (
            rows.map((workRow) => (
              <PfSessionRow
                key={workRow.row.agent.id}
                row={workRow}
                layout="sub"
                onOpen={() => openAgent(workRow.row)}
              />
            ))
          )}
          {extra > 0 && (
            <button type="button" className="s-pf-more" onClick={onOpenProject}>
              + {extra} more session{extra === 1 ? "" : "s"} · open project ▸
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// A session row in the table. As a project sub-row: title (+ harness · branch)
// spanning, recency aligned under the project's "last" column. In recent view:
// last · session · project · harness · branch. Clicking opens the agent.
function PfSessionRow({
  row,
  layout,
  project,
  onOpen,
}: {
  row: WorkRow;
  layout: "sub" | "recent";
  project?: string;
  onOpen: () => void;
}) {
  const titleClass = `s-pf-session-title${
    row.attn
      ? " s-pf-session-title--attn"
      : row.working
        ? " s-pf-session-title--working"
        : ""
  }`;

  if (layout === "recent") {
    return (
      <div
        className="s-pf-row s-pf-row--recent s-pf-session"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        <span className="s-pf-cell s-pf-cell--num s-pf-cell--lead">
          {row.time ? timeAgo(row.time) : "—"}
        </span>
        <span className="s-pf-cell s-pf-cell--name">
          {row.attn && <span className="s-pf-dot" aria-hidden />}
          <span className={titleClass}>{row.title}</span>
        </span>
        <span className="s-pf-cell s-pf-col">{project}</span>
        <span className="s-pf-cell s-pf-col">{row.harness}</span>
        <span className="s-pf-cell s-pf-col">{row.branch ?? "—"}</span>
      </div>
    );
  }

  return (
    <div
      className="s-pf-row s-pf-row--proj s-pf-row--sub s-pf-session"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="s-pf-cell s-pf-cell--name s-pf-cell--span">
        {row.attn && <span className="s-pf-dot" aria-hidden />}
        <span className={titleClass}>{row.title}</span>
        <span className="s-pf-sub-meta">
          {row.harness}
          {row.branch ? ` · ${row.branch}` : ""}
        </span>
      </span>
      <span className="s-pf-cell s-pf-cell--num s-pf-cell--last">
        {row.time ? timeAgo(row.time) : ""}
      </span>
    </div>
  );
}

// Recent view — the same work flattened to a time-ordered firehose.
function RecentList({
  rows,
  openAgent,
}: {
  rows: (WorkRow & { project: string })[];
  openAgent: (row: AgentInventoryRow) => void;
}) {
  return (
    <div className="s-pf-recent">
      {rows.map((workRow) => (
        <PfSessionRow
          key={`${workRow.project}:${workRow.row.agent.id}`}
          row={workRow}
          layout="recent"
          project={workRow.project}
          onOpen={() => openAgent(workRow.row)}
        />
      ))}
    </div>
  );
}

// One accent only — brightness encodes state, not hue (working brightest,
// ready mid, everything else dim). Replaces the categorical stateColor() dots
// on the Agents page per the locked Instrument direction.
// Collapsible group of project-level sessions (workflow runs, native processes)
// so low-signal rows don't render at the same weight as the agents above them.
function ProjectTreeSessionGroup({
  label,
  noun,
  nounPlural,
  sessions,
  open,
  onToggle,
  onOpenSession,
}: {
  label: string;
  noun: string;
  nounPlural: string;
  sessions: ProjectTreeSessionNode[];
  open: boolean;
  onToggle: () => void;
  onOpenSession: (session: ProjectTreeSessionNode) => void;
}) {
  if (sessions.length === 0) return null;
  const count = sessions.length;
  return (
    <Fragment>
      <div className="s-agent-project-tree-row s-agent-project-tree-row--group" role="row">
        <div className="s-agent-project-tree-target">
          <button
            type="button"
            className="s-agent-project-tree-toggle"
            aria-label={`${open ? "Collapse" : "Expand"} ${label.toLowerCase()}`}
            aria-expanded={open}
            onClick={onToggle}
          >
            {open ? "▾" : "▸"}
          </button>
          <span className="s-agent-project-tree-copy">
            <span className="s-agent-project-tree-primary">{label}</span>
            <span className="s-agent-project-tree-secondary">
              {count} {count === 1 ? noun : nounPlural}
            </span>
          </span>
        </div>
        <span className="s-agent-project-tree-muted" />
        <span className="s-agent-project-tree-muted" />
        <span className="s-agent-project-tree-muted" />
        <span className="s-agent-project-tree-mono">
          {sessions[0]?.lastActivityAt ? timeAgo(sessions[0].lastActivityAt) : "—"}
        </span>
      </div>
      {open && sessions.map((session) => (
        <ProjectTreeSessionRow
          key={session.key}
          session={session}
          compact
          onOpen={() => onOpenSession(session)}
        />
      ))}
    </Fragment>
  );
}

function ProjectLabeledAgentTree({
  project,
  navigate,
  route,
  openAgent,
}: {
  project: ProjectSlice;
  navigate: (r: Route) => void;
  route: Route;
  openAgent: (row: AgentInventoryRow) => void;
}) {
  const tree = useMemo(() => buildProjectTree(project), [project]);
  const projectLevelSessions = useMemo(
    () => sortProjectTreeSessions([
      ...project.workflows.map(workflowSessionNode),
      ...tree.unassignedSessions,
    ].filter(showProjectLevelSessionInOverview)),
    [project.workflows, tree.unassignedSessions],
  );
  const workflowSessions = useMemo(
    () => projectLevelSessions.filter((session) => session.kind === "workflow"),
    [projectLevelSessions],
  );
  const otherSessions = useMemo(
    () => projectLevelSessions.filter((session) => session.kind !== "workflow"),
    [projectLevelSessions],
  );

  // Workflows and native processes each collapse into a group node, persisted
  // per project. Default both to collapsed on first visit (each gated by its own
  // marker) so the run/process lists don't bury the agents above them.
  const collapsedStorageKey = `openscout.agents.labeledTree.collapsed:${project.key}`;
  const workflowsKey = `${project.key}:workflows`;
  const nativeKey = `${project.key}:native`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const stored = readCollapsedProjectTreeRows(collapsedStorageKey);
    for (const key of [workflowsKey, nativeKey]) {
      const marker = `${key}:default`;
      if (!stored.has(marker)) {
        stored.add(key);
        stored.add(marker);
      }
    }
    return stored;
  });
  useEffect(() => {
    writeCollapsedProjectTreeRows(collapsedStorageKey, collapsed);
  }, [collapsed, collapsedStorageKey]);
  const workflowsOpen = !collapsed.has(workflowsKey);
  const nativeOpen = !collapsed.has(nativeKey);
  const toggleRow = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openSession = (session: ProjectTreeSessionNode) => {
    if (!session.route) return;
    openContent(navigate, session.route, { returnTo: route });
  };

  return (
    <div className="s-agent-project-tree s-agent-project-tree--compact" role="treegrid" aria-label={`${project.title} agent and session outline`}>
      <div className="s-agent-project-tree-grid">
        {tree.agents.map((node) => {
          const row = node.row;
          const attachedSessions = node.sessions.length;
          return (
            <Fragment key={node.key}>
              <div className={`s-agent-project-tree-row s-agent-project-tree-row--agent s-agent-project-tree-row--${agentInventoryStatusClass(row.status)}`} role="row">
                <div className="s-agent-project-tree-target">
                  <span className="s-agent-project-tree-branch" aria-hidden />
                  <button
                    type="button"
                    className="s-agent-project-tree-link"
                    onClick={() => openAgent(row)}
                    title={primaryAgentSelector(row.agent) ?? row.agent.id}
                  >
                    <span className="s-agent-project-tree-primary">
                      <span
                        className="s-agent-project-tree-dot"
                        style={{ background: treeDotColor(row.agent.state) }}
                        aria-hidden
                      />
                      {row.agent.name}
                    </span>
                    <span className="s-agent-project-tree-secondary">{row.activeTask ?? row.session?.preview ?? row.agent.id}</span>
                  </button>
                </div>
                <span className={`s-agent-project-tree-state s-agent-project-tree-state--${agentInventoryStatusClass(row.status)}`}>
                  {row.stateLabel.toLowerCase()}
                </span>
                <span className="s-agent-project-tree-mono" title={row.agent.cwd ?? row.agent.projectRoot ?? undefined}>
                  {row.branch !== "—" ? row.branch : "—"}
                </span>
                <span className="s-agent-project-tree-mono">{attachedSessions || "—"}</span>
                <span className="s-agent-project-tree-mono">{row.lastActivityAt ? timeAgo(row.lastActivityAt) : "—"}</span>
              </div>
              {node.sessions.map((session) => (
                <ProjectTreeSessionRow
                  key={session.key}
                  session={session}
                  compact
                  onOpen={() => openSession(session)}
                />
              ))}
            </Fragment>
          );
        })}

        <ProjectTreeSessionGroup
          label="Workflows"
          noun="run"
          nounPlural="runs"
          sessions={workflowSessions}
          open={workflowsOpen}
          onToggle={() => toggleRow(workflowsKey)}
          onOpenSession={openSession}
        />

        <ProjectTreeSessionGroup
          label="Native processes"
          noun="process"
          nounPlural="processes"
          sessions={otherSessions}
          open={nativeOpen}
          onToggle={() => toggleRow(nativeKey)}
          onOpenSession={openSession}
        />
      </div>
    </div>
  );
}

function ProjectTreeSessionRow({
  session,
  onOpen,
  compact = false,
}: {
  session: ProjectTreeSessionNode;
  onOpen: () => void;
  compact?: boolean;
}) {
  const rowClass = `s-agent-project-tree-row s-agent-project-tree-row--session s-agent-project-tree-row--${session.kind}`;
  const target = (
    <div className="s-agent-project-tree-target">
      <span className="s-agent-project-tree-branch" aria-hidden />
      <button
        type="button"
        className="s-agent-project-tree-link"
        disabled={!session.route}
        onClick={onOpen}
        title={session.detail ?? session.label}
      >
        <span className="s-agent-project-tree-primary">{session.label}</span>
        <span className="s-agent-project-tree-secondary">{session.detail ?? session.kind}</span>
      </button>
    </div>
  );

  if (compact) {
    // These rows live under a labeled group ("Workflows" / "Native processes"),
    // so the per-row kind is redundant. Workflows surface their worker/task
    // progress (status is always "workflow"); native rows keep their live state.
    return (
      <div className={rowClass} role="row">
        {target}
        <span className={`s-agent-project-tree-state s-agent-project-tree-state--${classPart(session.status)}`}>
          {session.kind === "workflow" ? "" : session.status}
        </span>
        <span className="s-agent-project-tree-muted">{session.subLabel ?? ""}</span>
        <span className="s-agent-project-tree-muted" />
        <span className="s-agent-project-tree-mono">{session.lastActivityAt ? timeAgo(session.lastActivityAt) : "live"}</span>
      </div>
    );
  }

  return (
    <div className={rowClass} role="row">
      {target}
      <span className={`s-agent-project-tree-state s-agent-project-tree-state--${classPart(session.status)}`}>
        {session.status}
      </span>
      <span className={harnessChipClass(session.harness)}>{session.harness}</span>
      <span className="s-agent-project-tree-muted">{session.kind}</span>
      <span className="s-agent-project-tree-muted">—</span>
      <span className="s-agent-project-tree-mono">{session.lastActivityAt ? timeAgo(session.lastActivityAt) : "live"}</span>
      <span className="s-agent-project-tree-actions">
        <button
          type="button"
          className="s-agent-project-tree-action"
          disabled={!session.route}
          onClick={onOpen}
        >
          {session.kind === "native" ? "observe" : session.kind === "workflow" ? "trace" : "open"}
        </button>
      </span>
    </div>
  );
}
