import { useMemo, useState } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import type { Route } from "../../lib/types.ts";
import "./projects.css";
import type { BrowseProject } from "./model.ts";
import { useProjectsData } from "./useProjectsData.ts";

type Navigate = (route: Route) => void;
type ProjectSort = "activity" | "name" | "needs" | "agents" | "sessions";

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
  const { browseProjects } = useProjectsData(Boolean(route.showEphemeral));
  const [projectQuery, setProjectQuery] = useState("");
  const [projectSort, setProjectSort] = useState<ProjectSort>("activity");

  const visibleProjects = useMemo(
    () => filterAndSortProjects(browseProjects, projectQuery, projectSort),
    [browseProjects, projectQuery, projectSort],
  );

  const openProject = (slug: string) => navigate(scopeRoute(route, { projectSlug: slug }));

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
          <SlidersHorizontal size={13} strokeWidth={1.8} aria-hidden />
          <select
            className="av2-projectRailSort"
            value={projectSort}
            aria-label="Sort projects"
            onChange={(event) => setProjectSort(event.currentTarget.value as ProjectSort)}
          >
            <option value="activity">Active</option>
            <option value="name">Name</option>
            <option value="needs">Needs</option>
            <option value="agents">Agents</option>
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
        {visibleProjects.map((project) => (
          <button
            key={project.slug}
            type="button"
            className="av2-browseItem"
            data-selected={route.projectSlug === project.slug || undefined}
            title={projectBrowseTitle(project)}
            aria-label={projectBrowseTitle(project)}
            onClick={() => openProject(project.slug)}
          >
            <span className="av2-browseLabel">/{project.title}</span>
            {project.needsCount > 0 ? (
              <span className="av2-browseStatus" data-needs title={attentionTitle(project.needsCount)}>
                needs
              </span>
            ) : null}
          </button>
        ))}
        {visibleProjects.length === 0 ? (
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

function attentionTitle(count: number): string {
  return `${plural(count, "agent")} needs attention`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function filterAndSortProjects(
  projects: BrowseProject[],
  query: string,
  sort: ProjectSort,
): BrowseProject[] {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? projects.filter((project) =>
        project.title.toLowerCase().includes(needle)
        || project.slug.toLowerCase().includes(needle)
      )
    : projects;
  return [...filtered].sort((a, b) => {
    switch (sort) {
      case "name":
        return a.title.localeCompare(b.title);
      case "needs":
        return b.needsCount - a.needsCount
          || b.liveCount - a.liveCount
          || a.title.localeCompare(b.title);
      case "agents":
        return b.agentCount - a.agentCount
          || a.title.localeCompare(b.title);
      case "sessions":
        return b.sessionCount - a.sessionCount
          || a.title.localeCompare(b.title);
      case "activity":
      default:
        return b.liveCount - a.liveCount
          || b.needsCount - a.needsCount
          || a.title.localeCompare(b.title);
    }
  });
}
