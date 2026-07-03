import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { ArrowRight, FolderPlus, Search } from "lucide-react";

import { api } from "../../lib/api.ts";
import { routePath } from "../../lib/router.ts";
import { timeAgo } from "../../lib/time.ts";
import type { ProjectStateFilter, Route } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { pathLeaf, type DirProject } from "../agents/model.ts";
import "./projects.css";
import {
  agentPrecedence,
  displayProjectSessionPreview,
  filterRegistryAgents,
  filterProjectSessions,
  groupProjectSessionsByHarness,
  indexViewOf,
  openProjectAgentProfile,
  partitionRegistryAgents,
  projectSessionLastAt,
  projectSessionMeta,
  registryAgentSubline,
  registryWorkLine,
  scopeLabel,
  scopeMetaLabel,
  selectProjectAgent,
  shortSessionRef,
} from "./model.ts";
import type { ProjectSessionEntry } from "./model.ts";
import { ProjectOverview, useProjectOverviewContext } from "./ProjectOverview.tsx";
import { shortHomePath } from "./project-overview-helpers.ts";
import { useProjectsData } from "./useProjectsData.ts";

type Navigate = (route: Route) => void;

type AgentRowEntry = ReturnType<typeof filterRegistryAgents>[number];
type DefaultHarness = "claude" | "codex";

type ProjectPickOption = {
  slug: string;
  title: string;
  root: string | null;
  agentCount: number;
  sessionCount: number;
  lastActivityAt: number;
};

function ProjectSessionIndexRow({
  entry,
  idx,
  cursor,
  route,
  rowRefs,
  showProject,
}: {
  entry: ProjectSessionEntry;
  idx: number;
  cursor: number;
  route: Extract<Route, { view: "agents-v2" }>;
  rowRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  showProject: boolean;
}) {
  const sessionRoute: Extract<Route, { view: "agents-v2" }> = {
    view: "agents-v2",
    projectSlug: entry.projectSlug,
    indexView: "sessions",
    sessionId: entry.session.refId,
    selectedAgentId: undefined,
    ...(route.showEphemeral ? { showEphemeral: true } : {}),
  };
  const sessionHref = routePath(sessionRoute);
  const when = projectSessionLastAt(entry);
  const owner = entry.mappedAgent?.handle?.trim() || entry.mappedAgent?.name || null;
  const title = shortSessionRef(entry.session.refId);
  const preview = displayProjectSessionPreview(entry);
  const meta = [
    owner ? `@${owner.replace(/^@+/, "")}` : null,
    projectSessionMeta(entry),
  ].filter(Boolean).join(" · ");

  return (
    <div
      key={`${entry.projectSlug}:${entry.session.key}`}
      ref={(el) => {
        if (el) rowRefs.current.set(entry.session.refId, el);
        else rowRefs.current.delete(entry.session.refId);
      }}
      className="av2-row"
      data-cursor={cursor === idx || undefined}
      data-session-ref={entry.session.refId}
      data-tone={entry.session.status === "active" ? "live" : undefined}
    >
      <a className="av2-rowMain" href={sessionHref}>
        <span className="av2-dot" data-tone={entry.session.status === "active" ? "live" : undefined} aria-hidden />
        <span className="av2-agentCell">
          <span className="av2-agentName">{title}</span>
          <span className="av2-agentSub">
            {showProject ? `/${entry.projectTitle} · ` : null}
            {meta}
          </span>
        </span>
        <span className="av2-workCell" title={entry.session.transcriptPath ?? preview}>
          {preview}
        </span>
        <span className="av2-metaCell" title={entry.session.cwd ?? undefined}>
          {entry.harness}
          {entry.session.status === "active" ? " · active" : ""}
        </span>
      </a>
      <div className="av2-rowTail">
        <span className="av2-tailWhen">{when ? timeAgo(when) : "—"}</span>
        <a className="av2-openAct" href={sessionHref}>
          Select
        </a>
      </div>
    </div>
  );
}

function AgentIndexRow({
  entry,
  idx,
  cursor,
  route,
  navigate,
  nowMs,
  rowRefs,
  showProject,
}: {
  entry: AgentRowEntry;
  idx: number;
  cursor: number;
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
  nowMs: number;
  rowRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  showProject: boolean;
}) {
  const tone = agentPrecedence(entry, nowMs);
  const handle = entry.leadAgent.handle?.trim() || entry.group.name;
  const work = registryWorkLine(entry, tone);
  const subline = registryAgentSubline(entry);
  const branch =
    entry.group.branches.length > 1
      ? `${entry.group.branches.length} branches`
      : entry.group.branches[0] ?? "main";
  const selectAgent = () => navigate(selectProjectAgent(route, entry.leadAgent.id));
  const openProfile = () => navigate(openProjectAgentProfile(route, entry.leadAgent.id));
  const selected = route.selectedAgentId === entry.leadAgent.id;

  return (
    <div
      key={`${entry.projectSlug}:${entry.group.name}`}
      ref={(el) => {
        if (el) rowRefs.current.set(entry.leadAgent.id, el);
        else rowRefs.current.delete(entry.leadAgent.id);
      }}
      className="av2-row"
      data-cursor={cursor === idx || undefined}
      data-selected={selected || undefined}
      data-tone={tone === "idle" ? undefined : tone}
    >
      <button type="button" className="av2-rowMain" onClick={selectAgent}>
        <span className="av2-dot" data-tone={tone === "idle" ? undefined : tone} aria-hidden />
        <span className="av2-agentCell">
          <span className="av2-agentName" data-idle={tone === "idle" || undefined}>
            @{handle}
          </span>
          <span className="av2-agentSub" title={subline}>
            {showProject ? `/${entry.projectTitle} · ` : null}
            {subline}
          </span>
        </span>
        <span className="av2-workCell" title={work}>
          {work}
        </span>
        <span className="av2-metaCell" title={branch}>
          {branch}
          {entry.group.sessionCount > 0 ? ` · ${entry.group.sessionCount} sess` : ""}
        </span>
      </button>
      <div className="av2-rowTail">
        <span className="av2-tailWhen">
          {entry.group.lastActivityAt ? timeAgo(entry.group.lastActivityAt) : "—"}
        </span>
        <button type="button" className="av2-openAct" onClick={openProfile}>
          Profile ↗
        </button>
      </div>
    </div>
  );
}

const STATE_FILTERS: Array<{ id: ProjectStateFilter | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "needs", label: "Needs you" },
  { id: "live", label: "Live" },
  { id: "idle", label: "Idle" },
];

function selectionRoute(
  base: Extract<Route, { view: "agents-v2" }>,
  patch: { selectedAgentId?: string; sessionId?: string },
): Extract<Route, { view: "agents-v2" }> {
  return { ...base, ...patch, view: "agents-v2", agentId: undefined };
}

function IndexViewToggle({
  route,
  navigate,
  indexView,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
  indexView: ReturnType<typeof indexViewOf>;
}) {
  return (
    <div className="av2-viewToggle" role="group" aria-label="Index view">
      <button
        type="button"
        className="av2-viewBtn"
        data-on={indexView === "agents" || undefined}
        onClick={() => navigate({ ...route, indexView: route.projectSlug ? "agents" : undefined })}
      >
        Agents
      </button>
      <button
        type="button"
        className="av2-viewBtn"
        data-on={indexView === "sessions" || undefined}
        onClick={() => navigate({ ...route, indexView: "sessions" })}
      >
        Sessions
      </button>
    </div>
  );
}

function ProjectZeroState({
  route,
  navigate,
  projects,
  projectSessions,
  reloadData,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
  projects: DirProject[];
  projectSessions: ProjectSessionEntry[];
  reloadData: () => Promise<void>;
}) {
  const { onboarding, refreshOnboarding, reload: reloadAgents } = useScout();
  const currentDefaultHarness = defaultHarnessOf(onboarding?.defaultHarness);
  const [draft, setDraft] = useState("");
  const [selectedSlug, setSelectedSlug] = useState("");
  const [harness, setHarness] = useState<DefaultHarness>(currentDefaultHarness);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [createdRoot, setCreatedRoot] = useState<string | null>(null);

  useEffect(() => {
    setHarness(currentDefaultHarness);
  }, [currentDefaultHarness]);

  const options = useMemo(
    () => buildProjectPickOptions(projects, projectSessions),
    [projectSessions, projects],
  );
  const matches = useMemo(
    () => filterProjectPickOptions(options, draft),
    [draft, options],
  );
  const selectedOption = useMemo(
    () => options.find((option) => option.slug === selectedSlug) ?? exactProjectOption(options, draft),
    [draft, options, selectedSlug],
  );
  const trimmedDraft = draft.trim();
  const canCreateProject = isProjectPathLike(trimmedDraft) && !exactProjectOption(options, trimmedDraft);
  const activeOption = selectedOption ?? (!canCreateProject && trimmedDraft ? matches[0] ?? null : null);
  const primaryLabel = activeOption ? "Open project" : canCreateProject ? "Create project" : "Find project";
  const canSubmit = Boolean(activeOption || canCreateProject || trimmedDraft);

  useEffect(() => {
    if (!selectedSlug) return;
    if (!options.some((option) => option.slug === selectedSlug)) setSelectedSlug("");
  }, [options, selectedSlug]);

  useEffect(() => {
    if (!createdRoot) return;
    const created = options.find((option) => projectOptionMatchesRoot(option, createdRoot));
    if (!created) return;
    setCreatedRoot(null);
    navigate(projectRoute(route, created.slug));
  }, [createdRoot, navigate, options, route]);

  const chooseProject = (option: ProjectPickOption) => {
    setSelectedSlug(option.slug);
    setDraft(option.title);
    setError(null);
    setStatus(null);
  };

  const openProject = (option: ProjectPickOption) => {
    navigate(projectRoute(route, option.slug));
  };

  const createProject = async (projectRoot: string) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await api("/api/onboarding/project", {
        method: "POST",
        body: JSON.stringify({
          contextRoot: projectRoot,
          sourceRoots: [projectRoot],
          defaultHarness: harness,
        }),
      });
      setCreatedRoot(projectRoot);
      setStatus("Project created. Refreshing inventory.");
      setSelectedSlug("");
      setDraft("");
      await Promise.all([refreshOnboarding(), reloadAgents(), reloadData()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create project.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (activeOption) {
      openProject(activeOption);
      return;
    }
    if (canCreateProject) {
      void createProject(trimmedDraft);
      return;
    }
    if (trimmedDraft) {
      setError("No project matches that search. Paste a repo path to create one.");
      return;
    }
    setError("Choose a project or paste a repo path.");
  };

  return (
    <div className="av2-projectZero">
      <div className="av2-projectZeroInner">
        <div className="av2-projectZeroHead">
          <span className="av2-projectZeroKicker">
            <FolderPlus size={13} strokeWidth={1.9} aria-hidden />
            Projects
          </span>
          <h2>Pick a project to start.</h2>
          <p>Open an existing project or add a repo root.</p>
        </div>

        <form className="av2-projectZeroComposer" onSubmit={submit}>
          <div className="av2-projectZeroBar">
            <label className="av2-projectZeroSelect">
              <Search size={13} strokeWidth={1.8} aria-hidden />
              <select
                value={selectedSlug}
                aria-label="Choose project"
                onChange={(event) => {
                  const option = options.find((candidate) => candidate.slug === event.currentTarget.value);
                  if (option) chooseProject(option);
                  else setSelectedSlug("");
                }}
              >
                <option value="">Choose project</option>
                {options.slice(0, 80).map((option) => (
                  <option key={option.slug} value={option.slug}>
                    {option.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="av2-projectZeroHarness" role="group" aria-label="Default harness">
              {(["claude", "codex"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  data-on={harness === item || undefined}
                  onClick={() => setHarness(item)}
                >
                  {item === "claude" ? "Claude" : "Codex"}
                </button>
              ))}
            </div>
          </div>

          <div className="av2-projectZeroInputRow">
            <textarea
              value={draft}
              rows={2}
              placeholder="Find project or paste /path/to/repo"
              aria-label="Find or create project"
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                setSelectedSlug("");
                setError(null);
                setStatus(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              type="submit"
              className="av2-projectZeroSend"
              disabled={busy || !canSubmit}
              title={primaryLabel}
            >
              <ArrowRight size={15} strokeWidth={2} aria-hidden />
              <span>{busy ? "Working" : primaryLabel}</span>
            </button>
          </div>

          {matches.length > 0 ? (
            <div className="av2-projectZeroMatches" aria-label="Matching projects">
              {matches.map((option) => (
                <button
                  key={option.slug}
                  type="button"
                  className="av2-projectZeroMatch"
                  data-selected={selectedOption?.slug === option.slug || undefined}
                  onClick={() => chooseProject(option)}
                  onDoubleClick={() => openProject(option)}
                >
                  <span className="av2-projectZeroMatchMain">
                    <span className="av2-projectZeroMatchTitle">/{option.title}</span>
                    <span className="av2-projectZeroMatchRoot" title={option.root ?? undefined}>
                      {option.root ? shortHomePath(option.root) : option.slug}
                    </span>
                  </span>
                  <span className="av2-projectZeroMatchMeta">{projectOptionMeta(option)}</span>
                </button>
              ))}
            </div>
          ) : trimmedDraft ? (
            <div className="av2-projectZeroEmpty">No project matches.</div>
          ) : null}

          {error ? <div className="av2-projectZeroError">{error}</div> : null}
          {status ? <div className="av2-projectZeroStatus">{status}</div> : null}
        </form>
      </div>
    </div>
  );
}

function defaultHarnessOf(value: string | null | undefined): DefaultHarness {
  return value === "codex" ? "codex" : "claude";
}

function projectRoute(
  route: Extract<Route, { view: "agents-v2" }>,
  projectSlug: string,
): Extract<Route, { view: "agents-v2" }> {
  return {
    view: "agents-v2",
    projectSlug,
    ...(route.showEphemeral ? { showEphemeral: true } : {}),
    ...("machineId" in route && route.machineId ? { machineId: route.machineId } : {}),
  };
}

function buildProjectPickOptions(
  projects: DirProject[],
  projectSessions: ProjectSessionEntry[],
): ProjectPickOption[] {
  const sessionCounts = new Map<string, number>();
  const sessionLastAt = new Map<string, number>();
  for (const entry of projectSessions) {
    sessionCounts.set(entry.projectSlug, (sessionCounts.get(entry.projectSlug) ?? 0) + 1);
    sessionLastAt.set(
      entry.projectSlug,
      Math.max(sessionLastAt.get(entry.projectSlug) ?? 0, projectSessionLastAt(entry)),
    );
  }

  return projects
    .map((project) => {
      const slug = project.slice.slug;
      return {
        slug,
        title: project.slice.title,
        root: project.slice.root,
        agentCount: project.agents.length,
        sessionCount: Math.max(project.slice.nativeSessions.length, sessionCounts.get(slug) ?? 0),
        lastActivityAt: Math.max(
          project.lastActivityAt ?? 0,
          project.slice.lastActivityAt ?? 0,
          sessionLastAt.get(slug) ?? 0,
        ),
      };
    })
    .sort((left, right) =>
      right.lastActivityAt - left.lastActivityAt
      || right.agentCount - left.agentCount
      || right.sessionCount - left.sessionCount
      || left.title.localeCompare(right.title),
    );
}

function filterProjectPickOptions(options: ProjectPickOption[], draft: string): ProjectPickOption[] {
  const query = normalizeProjectQuery(draft);
  if (!query) return options.slice(0, 6);
  return options
    .map((option) => ({ option, score: projectPickScore(option, query) }))
    .filter((entry): entry is { option: ProjectPickOption; score: number } => entry.score !== null)
    .sort((left, right) =>
      left.score - right.score
      || right.option.lastActivityAt - left.option.lastActivityAt
      || left.option.title.localeCompare(right.option.title),
    )
    .slice(0, 6)
    .map((entry) => entry.option);
}

function exactProjectOption(options: ProjectPickOption[], draft: string): ProjectPickOption | null {
  const query = normalizeProjectQuery(draft);
  if (!query) return null;
  return options.find((option) => {
    const root = normalizeProjectQuery(option.root ?? "");
    const rootLeaf = normalizeProjectQuery(option.root ? pathLeaf(option.root) ?? "" : "");
    return normalizeProjectQuery(option.title) === query
      || normalizeProjectQuery(option.slug) === query
      || root === query
      || rootLeaf === query
      || normalizeProjectQuery(shortHomePath(option.root) ?? "") === query;
  }) ?? null;
}

function projectPickScore(option: ProjectPickOption, query: string): number | null {
  const title = normalizeProjectQuery(option.title);
  const slug = normalizeProjectQuery(option.slug);
  const root = normalizeProjectQuery(option.root ?? "");
  const rootLeaf = normalizeProjectQuery(option.root ? pathLeaf(option.root) ?? "" : "");
  if (title === query || slug === query || root === query || rootLeaf === query) return 0;
  if (title.startsWith(query) || slug.startsWith(query) || rootLeaf.startsWith(query)) return 1;
  if (title.includes(query) || slug.includes(query) || rootLeaf.includes(query)) return 2;
  if (root.includes(query)) return 3;
  return null;
}

function normalizeProjectQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^~(?=\/)/u, "")
    .replace(/\s+/g, " ");
}

function isProjectPathLike(value: string): boolean {
  const trimmed = value.trim();
  return /^(~\/|\/|\.{1,2}\/)/u.test(trimmed) || trimmed.includes("/");
}

function projectOptionMatchesRoot(option: ProjectPickOption, value: string): boolean {
  const query = normalizeProjectQuery(value);
  if (!query) return false;
  const candidates = [
    option.root ?? "",
    shortHomePath(option.root) ?? "",
    option.root ? pathLeaf(option.root) ?? "" : "",
    option.slug,
    option.title,
  ].map(normalizeProjectQuery);
  return candidates.some((candidate) => candidate === query || candidate.endsWith(query));
}

function projectOptionMeta(option: ProjectPickOption): string {
  const parts = [
    plural(option.agentCount, "agent"),
    plural(option.sessionCount, "session"),
    option.lastActivityAt ? timeAgo(option.lastActivityAt) : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function previewProjectZeroState(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return false;
  const value = new URLSearchParams(window.location.search).get("zero")?.trim().toLowerCase();
  return value === "projects" || value === "project" || value === "1" || value === "true";
}

export function ProjectsIndex({
  route,
  navigate,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
}) {
  const showEphemeral = Boolean(route.showEphemeral);
  const { dataReady, dataSettled, registryAgents, projectSessions, projects, reloadData } =
    useProjectsData(showEphemeral);
  const projectContext = useProjectOverviewContext(route, registryAgents, projects, showEphemeral);
  const indexView = indexViewOf(route);
  const nowMs = Date.now();
  const scope = {
    projectSlug: route.projectSlug,
    harness: route.harness,
    node: route.node,
    set: route.set,
  };

  const agentRows = useMemo(
    () => filterRegistryAgents(registryAgents, scope, route.stateFilter, nowMs),
    [registryAgents, scope, route.stateFilter, nowMs],
  );

  const sessionRows = useMemo(
    () => filterProjectSessions(projectSessions, scope, nowMs),
    [projectSessions, scope, nowMs],
  );

  const isProjectZeroStateScope =
    indexView === "agents"
    && !route.projectSlug
    && !route.harness
    && !route.node
    && !route.set
    && !route.stateFilter;
  const projectZeroStatePreview = dataReady && isProjectZeroStateScope && previewProjectZeroState();
  const visibleAgentRows = projectZeroStatePreview ? [] : agentRows;
  const visibleSessionRows = sessionRows;
  const rows = indexView === "sessions" ? visibleSessionRows : visibleAgentRows;
  const projectAgentGroups = useMemo(() => {
    if (!route.projectSlug || indexView !== "agents" || visibleAgentRows.length < 2) {
      return null;
    }
    return partitionRegistryAgents(visibleAgentRows, nowMs);
  }, [indexView, nowMs, route.projectSlug, visibleAgentRows]);
  const flatAgentRows = projectAgentGroups
    ? [...projectAgentGroups.active, ...projectAgentGroups.registered]
    : visibleAgentRows;
  const [cursor, setCursor] = useState(-1);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    setCursor(-1);
  }, [route.projectSlug, route.harness, route.node, route.set, route.stateFilter, indexView]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;

      const max = rows.length;
      if (!max) return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setCursor((c) => (c < 0 ? 0 : Math.min(max - 1, c + 1)));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setCursor((c) => (c < 0 ? 0 : Math.max(0, c - 1)));
      } else if (e.key === "Enter") {
        const i = cursor < 0 ? 0 : cursor;
        e.preventDefault();
        if (indexView === "sessions") {
          const entry = visibleSessionRows[i];
          if (!entry) return;
          navigate(
            {
              view: "agents-v2",
              projectSlug: entry.projectSlug,
              indexView: "sessions",
              sessionId: entry.session.refId,
              selectedAgentId: undefined,
              ...(route.showEphemeral ? { showEphemeral: true } : {}),
            },
          );
        } else {
          const entry = flatAgentRows[i];
          if (!entry) return;
          navigate(selectProjectAgent(route, entry.leadAgent.id));
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cursor, flatAgentRows, indexView, navigate, route, rows.length, visibleSessionRows]);

  useEffect(() => {
    if (cursor < 0) return;
    const key =
      indexView === "sessions"
        ? visibleSessionRows[cursor]?.session.refId
        : flatAgentRows[cursor]?.leadAgent.id;
    rowRefs.current.get(key ?? "")?.scrollIntoView({ block: "nearest" });
  }, [cursor, flatAgentRows, indexView, visibleSessionRows]);

  const toggleState = (id: ProjectStateFilter | "all") => {
    navigate({
      ...route,
      stateFilter: id === "all" ? undefined : id,
    });
  };

  const toggleEphemeral = () => {
    navigate({ ...route, showEphemeral: !route.showEphemeral });
  };

  const indexViewToggle = <IndexViewToggle route={route} navigate={navigate} indexView={indexView} />;
  const projectSessionCount = route.projectSlug ? sessionRows.length : 0;
  const projectSessionRows = useMemo(
    () =>
      route.projectSlug
        ? projectSessions.filter((entry) => entry.projectSlug === route.projectSlug)
        : [],
    [projectSessions, route.projectSlug],
  );
  const groupedSessionRows = useMemo(
    () => groupProjectSessionsByHarness(visibleSessionRows),
    [visibleSessionRows],
  );
  const showProjectZeroState = isProjectZeroStateScope;

  return (
    <div className="s-av2-index" data-project={route.projectSlug || undefined}>
      {route.projectSlug ? (
        <ProjectOverview
          route={route}
          navigate={navigate}
          projectTitle={projectContext.projectTitle}
          projectRoot={projectContext.projectRoot}
          dirProject={projectContext.dirProject}
          agentEntries={projectContext.agentEntries}
          agentIdsKey={projectContext.agentIdsKey}
          projectSessions={projectSessionRows}
          sessionCount={projectSessionCount}
          indexViewToggle={indexViewToggle}
        />
      ) : (
        <header className="av2-indexHead">
          <h1 className="av2-indexTitle">{scopeLabel(route)}</h1>
          <span className="av2-indexMeta">
            {indexView === "sessions"
              ? `${visibleSessionRows.length} sessions`
              : scopeMetaLabel(route, visibleAgentRows.length, visibleSessionRows.length)
                || `${visibleAgentRows.length} agents`}
          </span>
          <span className="av2-indexSpacer" />
          {indexViewToggle}
        </header>
      )}

      {indexView === "agents" ? (
        <div className="av2-narrow">
          {STATE_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className="av2-filter"
              data-on={
                (filter.id === "all" && !route.stateFilter) || route.stateFilter === filter.id || undefined
              }
              onClick={() => toggleState(filter.id)}
            >
              {filter.label}
            </button>
          ))}
          <button
            type="button"
            className="av2-filter"
            data-on={route.showEphemeral || undefined}
            onClick={toggleEphemeral}
          >
            + Ephemeral
          </button>
        </div>
      ) : null}

      <div className="av2-sectionHead">
        <span className="av2-sectionTitle">{indexView === "sessions" ? "Sessions" : "Agents"}</span>
        <span className="av2-sectionMeta">
          {rows.length} shown
        </span>
        <span className="av2-kbdHint" aria-hidden>
          {indexView === "agents" ? "↑↓ move · ↵ select · profile ↗ to open" : "↑↓ move · ↵ select"}
        </span>
      </div>

      {indexView === "agents" ? (
        <div className="av2-colhead" aria-hidden>
          <div className="av2-colheadMain">
            <span />
            <span>Agent</span>
            <span>Work</span>
            <span>Context</span>
          </div>
          <span className="av2-colOpen">Profile</span>
        </div>
      ) : indexView === "sessions" ? (
        <div className="av2-colhead" aria-hidden>
          <div className="av2-colheadMain">
            <span />
            <span>Session</span>
            <span>Preview</span>
            <span>Agent</span>
          </div>
          <span className="av2-colOpen">Open</span>
        </div>
      ) : null}

      <div className="av2-indexList">
        {indexView === "agents" ? (
          projectAgentGroups ? (
            <>
              {projectAgentGroups.active.length > 0 ? (
                <>
                  <div className="av2-groupHead">
                    <span className="av2-groupTitle">In flight</span>
                    <span className="av2-groupMeta">{projectAgentGroups.active.length}</span>
                  </div>
                  {projectAgentGroups.active.map((entry, offset) => (
                    <AgentIndexRow
                      key={`${entry.projectSlug}:${entry.group.name}`}
                      entry={entry}
                      idx={offset}
                      cursor={cursor}
                      route={route}
                      navigate={navigate}
                      nowMs={nowMs}
                      rowRefs={rowRefs}
                      showProject={false}
                    />
                  ))}
                </>
              ) : null}
              {projectAgentGroups.registered.length > 0 ? (
                <>
                  <div className="av2-groupHead">
                    <span className="av2-groupTitle">Also registered</span>
                    <span className="av2-groupMeta">{projectAgentGroups.registered.length}</span>
                  </div>
                  {projectAgentGroups.registered.map((entry, offset) => (
                    <AgentIndexRow
                      key={`${entry.projectSlug}:${entry.group.name}`}
                      entry={entry}
                      idx={projectAgentGroups.active.length + offset}
                      cursor={cursor}
                      route={route}
                      navigate={navigate}
                      nowMs={nowMs}
                      rowRefs={rowRefs}
                      showProject={false}
                    />
                  ))}
                </>
              ) : null}
            </>
          ) : (
            flatAgentRows.map((entry, idx) => (
              <AgentIndexRow
                key={`${entry.projectSlug}:${entry.group.name}`}
                entry={entry}
                idx={idx}
                cursor={cursor}
                route={route}
                navigate={navigate}
                nowMs={nowMs}
                rowRefs={rowRefs}
                showProject={!route.projectSlug}
              />
            ))
          )
        ) : (
          groupedSessionRows.map((group) => {
            let offset = 0;
            for (const prior of groupedSessionRows) {
              if (prior.key === group.key) break;
              offset += prior.sessions.length;
            }
            return (
              <Fragment key={group.key}>
                <div key={`${group.key}:head`} className="av2-groupHead">
                  <span className="av2-groupTitle">{group.label}</span>
                  <span className="av2-groupMeta">
                    {group.sessions.length}
                    {group.activeCount > 0 ? ` · ${group.activeCount} active` : ""}
                  </span>
                </div>
                {group.sessions.map((entry, groupIdx) => (
                  <ProjectSessionIndexRow
                    key={`${entry.projectSlug}:${entry.session.key}`}
                    entry={entry}
                    idx={offset + groupIdx}
                    cursor={cursor}
                    route={route}
                    rowRefs={rowRefs}
                    showProject={!route.projectSlug}
                  />
                ))}
              </Fragment>
            );
          })
        )}

        {rows.length === 0 ? (
          !dataSettled ? (
            <div className="av2-empty">Loading projects...</div>
          ) : !dataReady ? (
            <div className="av2-empty">Project inventory unavailable.</div>
          ) : showProjectZeroState ? (
            <ProjectZeroState
              route={route}
              navigate={navigate}
              projects={projects}
              projectSessions={projectSessions}
              reloadData={reloadData}
            />
          ) : (
            <div className="av2-empty">
              {indexView === "sessions"
                ? "No sessions in this scope."
                : "No agents in this scope."}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
