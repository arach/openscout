import { useMemo, useState } from "react";
import { ChevronDown, Pin, Search, X } from "lucide-react";
import type { Route } from "../../lib/types.ts";
import { timeAgo } from "../../lib/time.ts";
import "./projects.css";
import { pathLeaf } from "../agents/model.ts";
import {
  displayProjectSessionPreview,
  projectSessionLastAt,
  projectSessionMeta,
} from "./model.ts";
import type { BrowseProject, ProjectSessionEntry } from "./model.ts";
import { useProjectsData } from "./useProjectsData.ts";

type Navigate = (route: Route) => void;
type ProjectSort = "recent" | "name" | "sessions";

const PROJECT_SESSION_PREVIEW_LIMIT = 4;
const PINNED_PROJECTS_STORAGE_KEY = "openscout.projects.pinned";

type ProjectRailGroup = {
  project: BrowseProject;
  sessions: ProjectSessionEntry[];
  lastActivityAt: number;
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
  const [pinnedProjects, setPinnedProjects] = useState<Set<string>>(() => readPinnedProjects());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());

  const projectGroups = useMemo(
    () => buildProjectRailGroups(browseProjects, projectSessions),
    [browseProjects, projectSessions],
  );

  const visibleGroups = useMemo(
    () => filterAndSortProjectGroups(projectGroups, projectQuery, projectSort, pinnedProjects),
    [pinnedProjects, projectGroups, projectQuery, projectSort],
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

  const togglePinned = (slug: string) => {
    setPinnedProjects((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      writePinnedProjects(next);
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
            pinned={pinnedProjects.has(group.project.slug)}
            expanded={expandedProjects.has(group.project.slug)}
            onOpenProject={() => openProject(group.project.slug)}
            onOpenSession={openSession}
            onTogglePinned={() => togglePinned(group.project.slug)}
            onToggleExpanded={() => toggleExpanded(group.project.slug)}
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
    </div>
  );
}

function ProjectRailGroup({
  group,
  selected,
  pinned,
  expanded,
  onOpenProject,
  onOpenSession,
  onTogglePinned,
  onToggleExpanded,
}: {
  group: ProjectRailGroup;
  selected: boolean;
  pinned: boolean;
  expanded: boolean;
  onOpenProject: () => void;
  onOpenSession: (entry: ProjectSessionEntry) => void;
  onTogglePinned: () => void;
  onToggleExpanded: () => void;
}) {
  const { project, sessions } = group;
  const visibleSessions = expanded
    ? sessions
    : sessions.slice(0, PROJECT_SESSION_PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, sessions.length - visibleSessions.length);

  return (
    <div className="av2-projectGroup" data-selected={selected || undefined} data-pinned={pinned || undefined}>
      <div className="av2-projectGroupHead">
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
        <button
          type="button"
          className="av2-projectPin"
          data-pinned={pinned || undefined}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin /${project.title}` : `Pin /${project.title}`}
          title={pinned ? "Unpin project" : "Pin project"}
          onClick={onTogglePinned}
        >
          <Pin size={12} strokeWidth={2} aria-hidden />
        </button>
      </div>

      {visibleSessions.length > 0 ? (
        <div className="av2-projectSessionList">
          {visibleSessions.map((entry) => (
            <button
              key={`${entry.projectSlug}:${entry.session.key}`}
              type="button"
              className="av2-projectSession"
              data-active={entry.session.status === "active" || undefined}
              title={entry.session.transcriptPath ?? displayProjectSessionPreview(entry)}
              onClick={() => onOpenSession(entry)}
            >
              <span className="av2-projectSessionTitle">{projectSessionTitle(entry)}</span>
              <span className="av2-projectSessionWhen">{projectSessionWhen(entry)}</span>
              <span className="av2-projectSessionMeta">{projectSessionMeta(entry)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="av2-projectSessionEmpty">No sessions yet</div>
      )}

      {hiddenCount > 0 ? (
        <button type="button" className="av2-projectShowMore" onClick={onToggleExpanded}>
          Show more
        </button>
      ) : expanded && sessions.length > PROJECT_SESSION_PREVIEW_LIMIT ? (
        <button type="button" className="av2-projectShowMore" onClick={onToggleExpanded}>
          Show less
        </button>
      ) : null}
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
  return raw
    .replace(/\s+/g, " ")
    .trim();
}

function projectSessionWhen(entry: ProjectSessionEntry): string {
  const at = projectSessionLastAt(entry);
  return at ? timeAgo(at) : "—";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function filterAndSortProjectGroups(
  groups: ProjectRailGroup[],
  query: string,
  sort: ProjectSort,
  pinnedProjects: Set<string>,
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
    const pinDelta = Number(pinnedProjects.has(b.project.slug)) - Number(pinnedProjects.has(a.project.slug));
    if (pinDelta) return pinDelta;
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

function readPinnedProjects(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(PINNED_PROJECTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function writePinnedProjects(projects: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_PROJECTS_STORAGE_KEY, JSON.stringify([...projects]));
  } catch {
    // Best-effort UI preference.
  }
}
