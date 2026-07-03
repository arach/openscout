import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pin, Search, X } from "lucide-react";
import type { Route } from "../../lib/types.ts";
import { timeAgo } from "../../lib/time.ts";
import "./projects.css";
import { pathLeaf } from "../agents/model.ts";
import {
  projectSessionLastAt,
  projectSessionMeta,
} from "./model.ts";
import type { BrowseProject, ProjectSessionEntry } from "./model.ts";
import { useProjectsData } from "./useProjectsData.ts";

type Navigate = (route: Route) => void;
type ProjectSort = "recent" | "name" | "sessions";

const PROJECT_SESSION_PREVIEW_LIMIT = 4;
const PINNED_SESSIONS_STORAGE_KEY = "openscout.projects.pinnedSessions";

type ProjectRailGroup = {
  project: BrowseProject;
  sessions: ProjectSessionEntry[];
  lastActivityAt: number;
};

type SessionPreviewState = {
  entry: ProjectSessionEntry;
  left: number;
  top: number;
};

function scopeRoute(
  base: Extract<Route, { view: "agents-v2" }>,
  patch: Partial<Extract<Route, { view: "agents-v2" }>>,
): Extract<Route, { view: "agents-v2" }> {
  const next: Extract<Route, { view: "agents-v2" }> = {
    ...base,
    ...patch,
    view: "agents-v2",
    agentId: undefined,
    selectedAgentId: undefined,
    sessionId: undefined,
  };
  if ("projectSlug" in patch) {
    delete next.harness;
    delete next.node;
    delete next.set;
    if (!patch.projectSlug) delete next.projectSlug;
  }
  if ("harness" in patch) {
    delete next.projectSlug;
    delete next.node;
    delete next.set;
    if (!patch.harness) delete next.harness;
  }
  if ("node" in patch) {
    delete next.projectSlug;
    delete next.harness;
    delete next.set;
    if (!patch.node) delete next.node;
  }
  if ("set" in patch) {
    delete next.projectSlug;
    delete next.harness;
    delete next.node;
    if (!patch.set) delete next.set;
  }
  return next;
}

export function ProjectsBrowse({
  route,
  navigate,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
}) {
  const { browseProjects, projectSessions } = useProjectsData(Boolean(route.showEphemeral));
  const [projectQuery, setProjectQuery] = useState("");
  const [projectSort, setProjectSort] = useState<ProjectSort>("recent");
  const [pinnedSessions, setPinnedSessions] = useState<Set<string>>(() => readPinnedSessions());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());
  const [previewSession, setPreviewSession] = useState<SessionPreviewState | null>(null);

  const projectGroups = useMemo(
    () => buildProjectRailGroups(browseProjects, projectSessions),
    [browseProjects, projectSessions],
  );

  const visibleGroups = useMemo(
    () => filterAndSortProjectGroups(projectGroups, projectQuery, projectSort),
    [projectGroups, projectQuery, projectSort],
  );

  const openProject = (slug: string) => navigate(scopeRoute(route, { projectSlug: slug }));
  const openSession = (entry: ProjectSessionEntry) =>
    navigate({
      view: "agents-v2",
      projectSlug: entry.projectSlug,
      indexView: "sessions",
      sessionId: entry.session.refId,
      selectedAgentId: undefined,
      ...(route.showEphemeral ? { showEphemeral: true } : {}),
    });

  const togglePinnedSession = (sessionId: string) => {
    setPinnedSessions((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      writePinnedSessions(next);
      return next;
    });
  };

  const toggleCollapsed = (slug: string) => {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const toggleExpanded = (slug: string) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const showSessionPreview = (entry: ProjectSessionEntry, node: HTMLElement) => {
    const rect = node.getBoundingClientRect();
    const width = 300;
    const height = 188;
    const left = Math.min(window.innerWidth - width - 12, rect.right + 10);
    const top = Math.max(12, Math.min(window.innerHeight - height - 12, rect.top - 22));
    setPreviewSession({ entry, left, top });
  };

  const allSelected =
    !route.projectSlug && !route.harness && !route.node && !route.set;

  return (
    <div className="s-av2-browse">
      <div className="av2-projectRailTools" role="search">
        <div className="av2-projectRailSearchWrap">
          <Search size={13} strokeWidth={1.8} aria-hidden />
          <input
            className="av2-projectRailSearch"
            type="search"
            value={projectQuery}
            placeholder="Find project"
            aria-label="Search projects"
            onChange={(event) => setProjectQuery(event.currentTarget.value)}
          />
          {projectQuery ? (
            <button
              type="button"
              className="av2-projectRailClear"
              aria-label="Clear project search"
              title="Clear project search"
              onClick={() => setProjectQuery("")}
            >
              <X size={12} strokeWidth={2} aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="av2-projectRailSortWrap" title="Sort projects">
          <select
            className="av2-projectRailSort"
            value={projectSort}
            aria-label="Sort projects"
            onChange={(event) => setProjectSort(event.currentTarget.value as ProjectSort)}
          >
            <option value="recent">Recent</option>
            <option value="name">Name</option>
            <option value="sessions">Sessions</option>
          </select>
          <ChevronDown className="av2-projectRailChevron" size={12} strokeWidth={2} aria-hidden />
        </div>
      </div>

      <div className="av2-browseSection av2-browseSection--projects">
        <div className="av2-browseHead">Projects</div>
        <button
          type="button"
          className="av2-browseItem"
          data-selected={allSelected || undefined}
          onClick={() => navigate(scopeRoute(route, { projectSlug: undefined, harness: undefined, node: undefined, set: undefined }))}
        >
          <span className="av2-browseLabel">All projects</span>
        </button>
        {visibleGroups.map((group) => (
          <ProjectRailGroup
            key={group.project.slug}
            group={group}
            selected={route.projectSlug === group.project.slug}
            collapsed={collapsedProjects.has(group.project.slug)}
            expanded={expandedProjects.has(group.project.slug)}
            pinnedSessions={pinnedSessions}
            onOpenProject={() => openProject(group.project.slug)}
            onOpenSession={openSession}
            onToggleCollapsed={() => toggleCollapsed(group.project.slug)}
            onToggleExpanded={() => toggleExpanded(group.project.slug)}
            onTogglePinnedSession={togglePinnedSession}
            onPreviewSession={showSessionPreview}
            onClearPreview={() => setPreviewSession(null)}
          />
        ))}
        {visibleGroups.length === 0 ? (
          <div className="av2-browseEmpty">No projects matched.</div>
        ) : null}
      </div>

      <div className="av2-browseFoot">
        <button type="button" className="av2-browseLink" onClick={() => navigate({ view: "search" })}>
          Search agents & sessions →
        </button>
      </div>
      {previewSession ? <ProjectSessionHoverCard preview={previewSession} /> : null}
    </div>
  );
}

function ProjectRailGroup({
  group,
  selected,
  collapsed,
  expanded,
  pinnedSessions,
  onOpenProject,
  onOpenSession,
  onToggleCollapsed,
  onToggleExpanded,
  onTogglePinnedSession,
  onPreviewSession,
  onClearPreview,
}: {
  group: ProjectRailGroup;
  selected: boolean;
  collapsed: boolean;
  expanded: boolean;
  pinnedSessions: Set<string>;
  onOpenProject: () => void;
  onOpenSession: (entry: ProjectSessionEntry) => void;
  onToggleCollapsed: () => void;
  onToggleExpanded: () => void;
  onTogglePinnedSession: (sessionId: string) => void;
  onPreviewSession: (entry: ProjectSessionEntry, node: HTMLElement) => void;
  onClearPreview: () => void;
}) {
  const { project, sessions } = group;
  const orderedSessions = sortSessionsForProjectRail(sessions, pinnedSessions);
  const visibleSessions = collapsed
    ? []
    : expanded
      ? orderedSessions
      : orderedSessions.slice(0, PROJECT_SESSION_PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, sessions.length - visibleSessions.length);

  return (
    <div className="av2-projectGroup" data-selected={selected || undefined} data-collapsed={collapsed || undefined}>
      <div className="av2-projectGroupHead">
        <button
          type="button"
          className="av2-projectDisclosure"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand /${project.title}` : `Collapse /${project.title}`}
          title={collapsed ? "Expand project" : "Collapse project"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? (
            <ChevronRight size={12} strokeWidth={2} aria-hidden />
          ) : (
            <ChevronDown size={12} strokeWidth={2} aria-hidden />
          )}
        </button>
        <button
          type="button"
          className="av2-projectPath"
          title={projectBrowseTitle(project)}
          aria-label={projectBrowseTitle(project)}
          onClick={onOpenProject}
        >
          <span className="av2-projectPathText">/{project.title}</span>
          <span className="av2-projectPathMeta">{projectMeta(project)}</span>
        </button>
      </div>

      {!collapsed && visibleSessions.length > 0 ? (
        <div className="av2-projectSessionList">
          {visibleSessions.map((entry) => (
            <div
              key={`${entry.projectSlug}:${entry.session.key}`}
              className="av2-projectSession"
              data-active={entry.session.status === "active" || undefined}
              data-pinned={pinnedSessions.has(entry.session.refId) || undefined}
              onMouseEnter={(event) => onPreviewSession(entry, event.currentTarget)}
              onMouseLeave={onClearPreview}
              onFocusCapture={(event) => onPreviewSession(entry, event.currentTarget)}
              onBlurCapture={onClearPreview}
            >
              <button
                type="button"
                className="av2-projectSessionMain"
                onClick={() => {
                  onClearPreview();
                  onOpenSession(entry);
                }}
              >
                <span className="av2-projectSessionTitle">{projectSessionTitle(entry)}</span>
              </button>
              <button
                type="button"
                className="av2-sessionPin"
                data-pinned={pinnedSessions.has(entry.session.refId) || undefined}
                aria-pressed={pinnedSessions.has(entry.session.refId)}
                aria-label={pinnedSessions.has(entry.session.refId) ? "Unpin session" : "Pin session"}
                title={pinnedSessions.has(entry.session.refId) ? "Unpin session" : "Pin session"}
                onClick={() => onTogglePinnedSession(entry.session.refId)}
              >
                <Pin size={11} strokeWidth={2} aria-hidden />
              </button>
              <span className="av2-projectSessionWhen">{projectSessionWhen(entry)}</span>
            </div>
          ))}
        </div>
      ) : !collapsed ? (
        <div className="av2-projectSessionEmpty">No sessions yet</div>
      ) : null}

      {!collapsed && hiddenCount > 0 ? (
        <button type="button" className="av2-projectShowMore" onClick={onToggleExpanded}>
          Show more
        </button>
      ) : !collapsed && expanded && sessions.length > PROJECT_SESSION_PREVIEW_LIMIT ? (
        <button type="button" className="av2-projectShowMore" onClick={onToggleExpanded}>
          Show less
        </button>
      ) : null}
    </div>
  );
}

function ProjectSessionHoverCard({
  preview,
}: {
  preview: SessionPreviewState;
}) {
  const { entry, left, top } = preview;
  const agent = entry.mappedAgent?.handle?.trim() || entry.mappedAgent?.name || null;
  const workspace = entry.session.cwd ? pathLeaf(entry.session.cwd) : entry.projectTitle;
  const transcript = entry.session.transcriptPath ? pathLeaf(entry.session.transcriptPath) : entry.session.refId;
  const process = entry.session.process?.command?.trim() || null;

  return (
    <div
      className="av2-sessionHoverCard"
      role="tooltip"
      style={{ left, top }}
    >
      <div className="av2-sessionHoverKicker">
        <span>/{entry.projectTitle}</span>
        <span>{projectSessionWhen(entry)}</span>
      </div>
      <div className="av2-sessionHoverTitle">{projectSessionTitle(entry)}</div>
      <div className="av2-sessionHoverContext">
        {sessionContextLine(entry)}
      </div>
      <div className="av2-sessionHoverFacts">
        <span>{entry.harness}</span>
        <span>{entry.session.status}</span>
        <span>{workspace}</span>
        {agent ? <span>@{agent.replace(/^@+/, "")}</span> : null}
      </div>
      <div className="av2-sessionHoverRef">
        <span>{transcript}</span>
        {process ? <span>{process}</span> : null}
      </div>
    </div>
  );
}

function buildProjectRailGroups(
  projects: BrowseProject[],
  projectSessions: ProjectSessionEntry[],
): ProjectRailGroup[] {
  const sessionsByProject = new Map<string, ProjectSessionEntry[]>();
  for (const entry of projectSessions) {
    const list = sessionsByProject.get(entry.projectSlug) ?? [];
    list.push(entry);
    sessionsByProject.set(entry.projectSlug, list);
  }
  return projects.map((project) => {
    const sessions = [...(sessionsByProject.get(project.slug) ?? [])]
      .sort((a, b) => projectSessionLastAt(b) - projectSessionLastAt(a));
    return {
      project,
      sessions,
      lastActivityAt: sessions[0] ? projectSessionLastAt(sessions[0]) : 0,
    };
  });
}

function projectBrowseTitle(project: BrowseProject): string {
  const parts = [
    `/${project.title}`,
    plural(project.agentCount, "agent"),
  ];
  if (project.sessionCount > 0) parts.push(plural(project.sessionCount, "session"));
  if (project.needsCount > 0) parts.push(`${plural(project.needsCount, "agent")} needs attention`);
  if (project.liveCount > 0) parts.push(`${plural(project.liveCount, "agent")} live`);
  return parts.join(" · ");
}

function projectMeta(project: BrowseProject): string {
  const parts = [];
  if (project.liveCount > 0) parts.push(`${project.liveCount} live`);
  if (project.sessionCount > 0) parts.push(plural(project.sessionCount, "session"));
  else if (project.agentCount > 0) parts.push(plural(project.agentCount, "agent"));
  return parts.join(" · ");
}

function projectSessionTitle(entry: ProjectSessionEntry): string {
  const raw =
    entry.session.transcriptPath
      ? pathLeaf(entry.session.transcriptPath)
      : entry.session.sessionId || entry.session.refId;
  return compactSessionLabel(raw, entry)
    .replace(/\s+/g, " ")
    .trim();
}

function compactSessionLabel(raw: string, entry: ProjectSessionEntry): string {
  const harness = sentenceCase(entry.harness);
  const stem = raw.replace(/\.jsonl$/iu, "");
  const rollout = stem.match(/^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/u);
  if (rollout) return `${harness} rollout ${rollout[4]}:${rollout[5]}`;
  const uuid = stem.match(/^([0-9a-f]{8})-[0-9a-f-]{27,}$/iu);
  if (uuid) return `${harness} session ${uuid[1]}`;
  return stem.length > 42 ? `${stem.slice(0, 39).trim()}...` : stem;
}

function projectSessionWhen(entry: ProjectSessionEntry): string {
  const at = projectSessionLastAt(entry);
  return at ? timeAgo(at) : "—";
}

function sessionContextLine(entry: ProjectSessionEntry): string {
  const owner = entry.mappedAgent?.handle?.trim() || entry.mappedAgent?.name || null;
  const action = entry.session.status === "active" ? "Working" : "Last touched";
  const where = entry.session.cwd ? pathLeaf(entry.session.cwd) : entry.projectTitle;
  const who = owner ? ` by @${owner.replace(/^@+/, "")}` : "";
  return `${action}${who} in ${where}.`;
}

function sentenceCase(value: string): string {
  const clean = value.trim();
  if (!clean) return "Session";
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function sortSessionsForProjectRail(
  sessions: ProjectSessionEntry[],
  pinnedSessions: Set<string>,
): ProjectSessionEntry[] {
  return [...sessions].sort((a, b) => {
    const pinnedDelta = Number(pinnedSessions.has(b.session.refId)) - Number(pinnedSessions.has(a.session.refId));
    if (pinnedDelta) return pinnedDelta;
    return projectSessionLastAt(b) - projectSessionLastAt(a);
  });
}

function filterAndSortProjectGroups(
  groups: ProjectRailGroup[],
  query: string,
  sort: ProjectSort,
): ProjectRailGroup[] {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? groups.filter((group) =>
        group.project.title.toLowerCase().includes(needle)
        || group.project.slug.toLowerCase().includes(needle)
        || group.sessions.some((entry) =>
          projectSessionTitle(entry).toLowerCase().includes(needle)
          || projectSessionMeta(entry).toLowerCase().includes(needle)
        )
      )
    : groups;
  return [...filtered].sort((a, b) => {
    switch (sort) {
      case "name":
        return a.project.title.localeCompare(b.project.title);
      case "sessions":
        return b.project.sessionCount - a.project.sessionCount
          || b.lastActivityAt - a.lastActivityAt
          || a.project.title.localeCompare(b.project.title);
      case "recent":
      default:
        return b.project.liveCount - a.project.liveCount
          || b.lastActivityAt - a.lastActivityAt
          || b.project.sessionCount - a.project.sessionCount
          || a.project.title.localeCompare(b.project.title);
    }
  });
}

function readPinnedSessions(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function writePinnedSessions(sessions: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify([...sessions]));
  } catch {
    // Best-effort UI preference.
  }
}
