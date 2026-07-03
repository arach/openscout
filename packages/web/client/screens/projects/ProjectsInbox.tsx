import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { ArrowRight, FolderPlus, Search } from "lucide-react";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { api } from "../../lib/api.ts";
import { formatClockTimestamp, formatDurationClock, normalizeTimestampMs, timeAgo } from "../../lib/time.ts";
import type { ObserveData, Route } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { pathLeaf } from "../agents/model.ts";
import { SessionRefScreen, type SessionRefLookup } from "../sessions/SessionRefScreen.tsx";
import { shortHomePath } from "./project-overview-helpers.ts";
import { refreshProjectsInbox, useProjectsInbox, useProjectsInboxView } from "./useProjectsInbox.ts";
import {
  filterThreadsForView,
  groupItems,
  isSessionSelected,
  isThreadSelected,
  sessionOpenRoute,
  sessionSelectRoute,
  sessionsForProject,
  threadOpenRoute,
  threadSelectRoute,
  type InboxProject,
  type InboxSession,
  type InboxThread,
  type ProjectsInboxModel,
  threadsForProject,
} from "./projects-inbox-model.ts";
import "./projects-inbox.css";

type Navigate = (route: Route) => void;
type ProjectHarness = "claude" | "codex";

type ProjectPickOption = {
  slug: string;
  title: string;
  root: string | null;
  agentCount: number;
  sessionCount: number;
  lastActivityAt: number;
};

const ZERO_COUNTS = {
  needs: 0,
  working: 0,
  recent: 0,
  everything: 0,
};

function ThreadRow({
  thread,
  crossProject,
  selected,
  cursor,
  nowMs,
  onSelect,
  onOpen,
  rowRef,
}: {
  thread: InboxThread | InboxSession;
  crossProject: boolean;
  selected: boolean;
  cursor: boolean;
  nowMs: number;
  onSelect: () => void;
  onOpen: () => void;
  rowRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={rowRef}
      type="button"
      className="pi-row"
      data-state={thread.group}
      data-needs={thread.needs || undefined}
      data-selected={selected || undefined}
      data-cursor={cursor || undefined}
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      <span className="pi-rowDot" aria-hidden />
      <span className="pi-rowBody">
        <span className="pi-rowWork" title={thread.work}>
          {thread.work}
        </span>
        <span className="pi-rowAttr">
          <span className="pi-rowAvatar">
            <AgentAvatar
              agent={{
                name: thread.agentName,
                harness: thread.harness,
                state: thread.working ? "in_turn" : null,
              }}
              placement="row"
              size={22}
            />
          </span>
          <span className="pi-rowAgent" title={thread.agentName}>
            {thread.agentName}
          </span>
          <span className="pi-rowHmark" aria-hidden>
            <HarnessMark harness={thread.harness} size={11} />
          </span>
          {crossProject ? (
            <span className="pi-rowChip" title={`/${thread.projectTitle}`}>
              /{thread.projectTitle}
            </span>
          ) : thread.branch ? (
            <span className="pi-rowBranch" title={thread.branch}>
              {thread.branch}
            </span>
          ) : null}
        </span>
      </span>
      <span className="pi-rowVitals">
        {thread.needs ? (
          <span className="pi-rowNeedsTag">needs you</span>
        ) : thread.working ? (
          <span className="pi-rowLiveTag">live</span>
        ) : null}
        <span className="pi-rowAgo">{thread.lastActivityAt ? timeAgo(thread.lastActivityAt, nowMs) : "—"}</span>
        {thread.contextPct != null ? <span className="pi-rowCtx">{thread.contextPct}%</span> : null}
      </span>
    </button>
  );
}

type ProjectMode = "overview" | "agents" | "sessions";

function ProjectScopeHeader({
  route,
  navigate,
  slug,
  model,
  mode,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
  slug: string;
  model: ProjectsInboxModel;
  mode: ProjectMode;
}) {
  const project = model.projects.find((entry) => entry.slug === slug) ?? null;
  const projectThreads = threadsForProject(model.threads, slug);
  const agentThreads = projectThreads.filter((thread) => thread.kind === "agent");
  const title = project?.title ?? slug;
  const root = project?.root ?? null;
  const showAgentFacet = (project?.agentCount ?? agentThreads.length) > 1;
  const machineScope = route.machineId ? { machineId: route.machineId } : {};
  const baseRoute = { view: "agents-v2" as const, projectSlug: slug, ...machineScope };
  const showProjectAvatar = !route.sessionId;
  const compact = Boolean(route.sessionId);

  const digest = digestLine(project?.needs ?? 0, project?.working ?? 0, projectThreads.length);

  return (
    <header className="pi-projectHead" data-compact={compact || undefined}>
      <div className="pi-projectHeadTop" data-no-avatar={!showProjectAvatar || undefined}>
        {showProjectAvatar ? <AgentAvatar name={title} placement="row" size={40} presence={false} /> : null}
        <div className="pi-projectIdent">
          <div className="pi-projectTitleRow">
            <span className="pi-projectKind">Project</span>
            <h1 className="pi-projectTitle">/{title}</h1>
          </div>
          {root ? (
            <div className="pi-projectRoot" title={root}>
              {shortHomePath(root)}
            </div>
          ) : null}
          <div className="pi-projectDigest">{digest}</div>
        </div>
      </div>

      <div className="pi-projectFacets" aria-label="Project sections">
        <button
          type="button"
          className="pi-projectFacet"
          data-selected={mode === "overview" || mode === "sessions" || undefined}
          onClick={() => navigate({ ...baseRoute, indexView: "sessions" })}
        >
          <span>Sessions</span>
          <b>{project?.sessionCount ?? 0}</b>
        </button>
        {showAgentFacet ? (
          <button
            type="button"
            className="pi-projectFacet"
            data-selected={mode === "agents" || undefined}
            onClick={() => navigate({ ...baseRoute, indexView: "agents" })}
          >
            <span>Agents</span>
            <b>{project?.agentCount ?? agentThreads.length}</b>
          </button>
        ) : null}
        <button type="button" className="pi-projectFacet" onClick={() => navigate({ view: "repos", ...machineScope })}>
          <span>Worktrees</span>
          <b>{project?.worktreeCount ?? 0}</b>
        </button>
        <span className="pi-projectFacet pi-projectFacet--static">
          <span>Rules</span>
          <b>{root ? "set" : "—"}</b>
        </span>
      </div>

      {project && !compact ? (
        <div className="pi-projectGlance">
          <span>{project.liveSessionCount} live session{project.liveSessionCount === 1 ? "" : "s"}</span>
          <span>{project.worktreeCount} worktree{project.worktreeCount === 1 ? "" : "s"}</span>
          {project.branches.length > 0 ? (
            <span title={project.branches.join(", ")}>{project.branches.length} branch{project.branches.length === 1 ? "" : "es"}</span>
          ) : (
            <span>mainline</span>
          )}
        </div>
      ) : null}
    </header>
  );
}

function digestLine(needs: number, working: number, total: number): ReactNode {
  if (total === 0) return <span>No conversations yet.</span>;
  const parts: ReactNode[] = [];
  if (working > 0) parts.push(<b key="w">{working} moving</b>);
  if (needs > 0) parts.push(<b key="n">{needs} needs you</b>);
  parts.push(<span key="t">{total} conversation{total === 1 ? "" : "s"}</span>);
  return parts.reduce<ReactNode[]>((acc, node, index) => {
    if (index > 0) acc.push(<span key={`sep${index}`}> · </span>);
    acc.push(node);
    return acc;
  }, []);
}

function ProjectZeroComposer({
  route,
  navigate,
  projects,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
  projects: InboxProject[];
}) {
  const { onboarding, refreshOnboarding, reload } = useScout();
  const currentDefaultHarness = defaultHarnessOf(onboarding?.defaultHarness);
  const [draft, setDraft] = useState("");
  const [selectedSlug, setSelectedSlug] = useState("");
  const [harness, setHarness] = useState<ProjectHarness>(currentDefaultHarness);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [createdRoot, setCreatedRoot] = useState<string | null>(null);

  useEffect(() => {
    setHarness(currentDefaultHarness);
  }, [currentDefaultHarness]);

  const options = useMemo(() => buildProjectPickOptions(projects), [projects]);
  const matches = useMemo(() => filterProjectPickOptions(options, draft), [draft, options]);
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
      refreshProjectsInbox();
      await Promise.all([refreshOnboarding(), reload()]);
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
    <div className="pi-zero">
      <div className="pi-zeroHead">
        <span className="pi-zeroKicker">
          <FolderPlus size={13} strokeWidth={1.9} aria-hidden />
          Projects
        </span>
        <h2>Pick a project to start.</h2>
      </div>

      <form className="pi-zeroComposer" onSubmit={submit}>
        <div className="pi-zeroBar">
          <label className="pi-zeroSelect">
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
          <div className="pi-zeroHarness" role="group" aria-label="Default harness">
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

        <div className="pi-zeroInputRow">
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
          <button type="submit" className="pi-zeroSend" disabled={busy || !canSubmit} title={primaryLabel}>
            <ArrowRight size={15} strokeWidth={2} aria-hidden />
            <span>{busy ? "Working" : primaryLabel}</span>
          </button>
        </div>

        {matches.length > 0 ? (
          <div className="pi-zeroMatches" aria-label="Matching projects">
            {matches.map((option) => (
              <button
                key={option.slug}
                type="button"
                className="pi-zeroMatch"
                data-selected={selectedOption?.slug === option.slug || undefined}
                onClick={() => chooseProject(option)}
                onDoubleClick={() => openProject(option)}
              >
                <span className="pi-zeroMatchMain">
                  <span className="pi-zeroMatchTitle">/{option.title}</span>
                  <span className="pi-zeroMatchRoot" title={option.root ?? undefined}>
                    {option.root ? shortHomePath(option.root) : option.slug}
                  </span>
                </span>
                <span className="pi-zeroMatchMeta">{projectOptionMeta(option)}</span>
              </button>
            ))}
          </div>
        ) : trimmedDraft ? (
          <div className="pi-zeroEmpty">No project matches.</div>
        ) : null}

        {error ? <div className="pi-zeroError">{error}</div> : null}
        {status ? <div className="pi-zeroStatus">{status}</div> : null}
      </form>
    </div>
  );
}

function defaultHarnessOf(value: string | null | undefined): ProjectHarness {
  return value === "codex" ? "codex" : "claude";
}

function projectRoute(
  route: Extract<Route, { view: "agents-v2" }>,
  projectSlug: string,
): Extract<Route, { view: "agents-v2" }> {
  return {
    view: "agents-v2",
    projectSlug,
    indexView: "sessions",
    ...(route.showEphemeral ? { showEphemeral: true } : {}),
    ...(route.machineId ? { machineId: route.machineId } : {}),
  };
}

function buildProjectPickOptions(projects: InboxProject[]): ProjectPickOption[] {
  return projects
    .map((project) => ({
      slug: project.slug,
      title: project.title,
      root: project.root,
      agentCount: project.agentCount,
      sessionCount: project.sessionCount,
      lastActivityAt: project.lastActivityAt,
    }))
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
    const rootLeaf = normalizeProjectQuery(option.root ? pathLeaf(option.root) : "");
    return normalizeProjectQuery(option.title) === query
      || normalizeProjectQuery(option.slug) === query
      || root === query
      || rootLeaf === query
      || normalizeProjectQuery(option.root ? shortHomePath(option.root) : "") === query;
  }) ?? null;
}

function projectPickScore(option: ProjectPickOption, query: string): number | null {
  const title = normalizeProjectQuery(option.title);
  const slug = normalizeProjectQuery(option.slug);
  const root = normalizeProjectQuery(option.root ?? "");
  const rootLeaf = normalizeProjectQuery(option.root ? pathLeaf(option.root) : "");
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
    option.root ? shortHomePath(option.root) : "",
    option.root ? pathLeaf(option.root) : "",
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

function findSelectedSession(sessions: InboxSession[], route: Extract<Route, { view: "agents-v2" }>): InboxSession | null {
  if (!route.sessionId) return null;
  return (
    sessions.find((session) =>
      session.sessionId === route.sessionId ||
      session.conversationId === route.sessionId ||
      session.id === route.sessionId
    ) ?? null
  );
}

function isSyntheticProcessSessionRef(value: string | null | undefined): boolean {
  return /^native:process:/iu.test(value ?? "");
}

function isPathLikeWork(value: string): boolean {
  return value.startsWith("/") || value.startsWith("~/") || (value.includes("/") && /\.(jsonl?|events)$/i.test(value));
}

function sessionHeadline(work: string | null | undefined, agentName: string, sessionRef: string): string {
  const raw = work?.trim() ?? "";
  if (!raw || isPathLikeWork(raw)) return agentName;
  return raw;
}

function ProjectSessionOverview({
  session,
  sessionRef,
  sessions,
  lookup,
  route,
  nowMs,
}: {
  session: InboxSession | null;
  sessionRef: string;
  sessions: InboxSession[];
  lookup: SessionRefLookup | null;
  route: Extract<Route, { view: "agents-v2" }>;
  nowMs: number;
}) {
  const projectSlug = session?.projectSlug ?? route.projectSlug;
  const projectTitle = session?.projectTitle ?? projectSlug ?? "Project";
  const agentName = session?.agentName ?? route.selectedAgentId ?? route.agentId ?? "Session";
  const harness = session?.harness ?? "session";
  const statusLabel = session?.working ? "live" : "recent";
  const headline = sessionHeadline(session?.work, agentName, sessionRef);

  return (
    <section className="pi-sessionOverview" aria-label="Session overview">
      <section className="pi-sessionHero" data-state={session?.working ? "working" : "recent"}>
        <div className="pi-sessionHeroCopy">
          <div className="pi-sessionKicker">
            <span>/{projectTitle}</span>
            <span>{statusLabel}</span>
            <span>{session?.lastActivityAt ? timeAgo(session.lastActivityAt, nowMs) : "—"}</span>
          </div>
          <h2 className="pi-sessionHeadline" title={headline}>
            {headline}
          </h2>
          <div className="pi-sessionAttribution">
            <span>{agentName}</span>
            <span className="pi-sessionHmark" aria-hidden>
              <HarnessMark harness={harness} size={12} />
            </span>
            <span>{harness}</span>
            {session?.branch ? <span>{session.branch}</span> : null}
          </div>
        </div>
      </section>

      <ProjectSessionGlance
        lookup={lookup}
        session={session}
        sessionRef={sessionRef}
        sessions={sessions}
        nowMs={nowMs}
      />
    </section>
  );
}

function SelectedSessionMain({
  session,
  sessionRef,
  sessions,
  route,
  navigate,
  nowMs,
}: {
  session: InboxSession | null;
  sessionRef: string;
  sessions: InboxSession[];
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
  nowMs: number;
}) {
  const [lookup, setLookup] = useState<SessionRefLookup | null>(null);

  useEffect(() => {
    setLookup(null);
  }, [sessionRef]);

  return (
    <main className="pi-sessionDetail" aria-label="Selected session">
      <div className="pi-sessionContent">
        <ProjectSessionOverview
          session={session}
          sessionRef={sessionRef}
          sessions={sessions}
          lookup={lookup}
          route={route}
          nowMs={nowMs}
        />
        <SessionRefScreen
          sessionRef={sessionRef}
          navigate={navigate}
          showObserveRail={false}
          onLookup={setLookup}
        />
      </div>
    </main>
  );
}

type EventBucket = {
  key: string;
  label: string;
  count: number;
};

function compactNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1000) return value.toLocaleString("en-US");
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
    .format(value)
    .toLowerCase();
}

function tokenLabel(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  return `${compactNumber(value)} tok`;
}

function eventBuckets(data: ObserveData | null): EventBucket[] {
  const counts = new Map<string, number>();
  for (const event of data?.events ?? []) {
    const key = event.kind === "boot" ? "system" : event.kind;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [
    { key: "message", label: "chat", count: counts.get("message") ?? 0 },
    { key: "tool", label: "tools", count: counts.get("tool") ?? 0 },
    { key: "think", label: "think", count: counts.get("think") ?? 0 },
    { key: "ask", label: "asks", count: counts.get("ask") ?? 0 },
    { key: "system", label: "system", count: counts.get("system") ?? 0 },
  ].filter((bucket) => bucket.count > 0);
}

function observedStartMs(data: ObserveData | null): number | null {
  const explicit = normalizeTimestampMs(data?.metadata?.session?.sessionStart);
  if (explicit !== null) return explicit;
  for (const event of data?.events ?? []) {
    const wall = normalizeTimestampMs(event.at);
    if (wall !== null) return wall;
  }
  return null;
}

function observedEndMs(data: ObserveData | null, fallback: number | null | undefined): number | null {
  for (let i = (data?.events.length ?? 0) - 1; i >= 0; i -= 1) {
    const wall = normalizeTimestampMs(data?.events[i]?.at);
    if (wall !== null) return wall;
  }
  const start = observedStartMs(data);
  const lastOffset = data?.events.at(-1)?.t;
  if (start !== null && typeof lastOffset === "number" && Number.isFinite(lastOffset)) {
    return start + lastOffset * 1000;
  }
  return normalizeTimestampMs(fallback);
}

function observedDuration(data: ObserveData | null, fallbackLastAt: number | null | undefined): string {
  const start = observedStartMs(data);
  const end = observedEndMs(data, fallbackLastAt);
  if (start !== null && end !== null) return formatDurationClock(Math.max(0, end - start)) || "—";
  const seconds = data?.events.at(-1)?.t;
  if (typeof seconds === "number" && Number.isFinite(seconds)) return formatDurationClock(seconds * 1000) || "—";
  return "—";
}

function topologyLine(data: ObserveData | null): string | null {
  const topology = data?.metadata?.topology;
  if (!topology) return null;
  const agents = topology.agents.length;
  const workers = topology.agents.filter((agent) => agent.role !== "lead").length;
  const workflows = topology.groups.filter((group) => group.kind === "workflow").length;
  const tasks = topology.tasks.length;
  const parts: string[] = [];
  if (workers > 0) parts.push(`${workers} worker${workers === 1 ? "" : "s"}`);
  else if (agents > 0) parts.push(`${agents} agent${agents === 1 ? "" : "s"}`);
  if (workflows > 0) parts.push(`${workflows} workflow${workflows === 1 ? "" : "s"}`);
  if (tasks > 0) parts.push(`${tasks} task${tasks === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : null;
}

function sessionRouteKey(session: InboxSession): string {
  return session.sessionId ?? session.conversationId ?? session.id;
}

function nearbySessions(currentRef: string, session: InboxSession | null, sessions: InboxSession[], nowMs: number): Array<{ label: string; time: string; title: string }> {
  const projectSlug = session?.projectSlug;
  return sessions
    .filter((entry) => entry !== session)
    .filter((entry) => !projectSlug || entry.projectSlug === projectSlug)
    .filter((entry) => sessionRouteKey(entry) !== currentRef)
    .slice(0, 3)
    .map((entry) => ({
      label: sessionHeadline(entry.work, entry.agentName, sessionRouteKey(entry)),
      time: entry.lastActivityAt ? timeAgo(entry.lastActivityAt, nowMs) : "—",
      title: entry.work,
    }));
}

function GlanceField({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span className="pi-sessionGlanceField" title={title}>
      <span>{label}</span>
      <b>{value}</b>
    </span>
  );
}

function ProjectSessionGlance({
  lookup,
  session,
  sessionRef,
  sessions,
  nowMs,
}: {
  lookup: SessionRefLookup | null;
  session: InboxSession | null;
  sessionRef: string;
  sessions: InboxSession[];
  nowMs: number;
}) {
  const data = lookup?.kind === "observe" ? lookup.observe.data : null;
  const sessionMeta = data?.metadata?.session;
  const usage = data?.metadata?.usage;
  const events = data?.events ?? [];
  const files = data?.files ?? [];
  const startMs = observedStartMs(data);
  const fallbackLastAt = session?.lastActivityAt ?? lookup?.session?.lastMessageAt ?? null;
  const endMs = observedEndMs(data, fallbackLastAt);
  const turnCount = sessionMeta?.turnCount ?? usage?.assistantMessages ?? (lookup?.kind === "conversation" ? lookup.session.messageCount : null);
  const toolCount = events.filter((event) => event.kind === "tool").length;
  const editCount = files.filter((file) => file.state === "created" || file.state === "modified").length;
  const contextPct = usage?.contextInputTokens && usage?.contextWindowTokens
    ? Math.round(Math.min(100, (usage.contextInputTokens / usage.contextWindowTokens) * 100))
    : null;
  const workspace = sessionMeta?.cwd ?? lookup?.session?.workspaceRoot ?? session?.projectRoot ?? null;
  const branch = sessionMeta?.gitBranch ?? lookup?.session?.currentBranch ?? session?.branch ?? null;
  const model = sessionMeta?.model ?? null;
  const topology = topologyLine(data);
  const buckets = eventBuckets(data);
  const totalBucketCount = Math.max(1, buckets.reduce((sum, bucket) => sum + bucket.count, 0));
  const nearby = nearbySessions(sessionRef, session, sessions, nowMs);
  const startedLabel = startMs ? formatClockTimestamp(startMs) : "—";
  const lastLabel = endMs ? timeAgo(endMs, nowMs) : session?.lastActivityAt ? timeAgo(session.lastActivityAt, nowMs) : "—";
  const duration = observedDuration(data, fallbackLastAt);
  const tokenTotal = tokenLabel(usage?.totalTokens ?? (
    typeof usage?.inputTokens === "number" || typeof usage?.outputTokens === "number"
      ? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
      : null
  ));
  const workspaceLabel = workspace ? shortHomePath(workspace) : "—";
  const branchLabel = branch || "branch unknown";
  const summaryParts = [
    startMs ? `started ${startedLabel}` : null,
    duration !== "—" ? duration : null,
    lastLabel !== "—" ? `last ${lastLabel}` : null,
  ].filter(Boolean);

  return (
    <section className="pi-sessionGlance" aria-label="Session glance">
      <div className="pi-sessionGlanceTop">
        <div className="pi-sessionGlanceLead">
          <span className="pi-sessionGlanceKicker">Session glance</span>
          <span className="pi-sessionGlanceSummary">{summaryParts.join(" · ") || "Trace context is still resolving."}</span>
        </div>
        <div className="pi-sessionGlancePills">
          {branch ? <span title={branch}>branch {branch}</span> : null}
          {model ? <span title={model}>{model}</span> : null}
          {topology ? <span>{topology}</span> : null}
        </div>
      </div>

      <div className="pi-sessionGlanceGrid">
        <div className="pi-sessionGlanceCard">
          <span className="pi-sessionGlanceCardLabel">Timeline</span>
          <div className="pi-sessionGlanceFields">
            <GlanceField label="Start" value={startedLabel} />
            <GlanceField label="Duration" value={duration} />
            <GlanceField label="Last" value={lastLabel} />
          </div>
        </div>

        <div className="pi-sessionGlanceCard">
          <span className="pi-sessionGlanceCardLabel">Activity</span>
          <div className="pi-sessionGlanceFields">
            <GlanceField label="Turns" value={compactNumber(turnCount)} />
            <GlanceField label="Events" value={compactNumber(events.length)} />
            <GlanceField label="Tools" value={compactNumber(toolCount)} />
            <GlanceField label="Edits" value={compactNumber(editCount)} />
          </div>
        </div>

        <div className="pi-sessionGlanceCard">
          <span className="pi-sessionGlanceCardLabel">Workspace</span>
          <div className="pi-sessionGlanceFields">
            <GlanceField label="Root" value={workspaceLabel} title={workspace ?? undefined} />
            <GlanceField label="Branch" value={branchLabel} title={branch ?? undefined} />
            <GlanceField label="Context" value={contextPct !== null ? `${contextPct}%` : tokenTotal} />
          </div>
        </div>

        <div className="pi-sessionGlanceCard">
          <span className="pi-sessionGlanceCardLabel">Related</span>
          {nearby.length > 0 ? (
            <div className="pi-sessionGlanceNearby">
              {nearby.map((entry) => (
                <span key={`${entry.label}:${entry.time}`} className="pi-sessionGlanceNearbyItem" title={entry.title}>
                  {entry.label}
                  <b>{entry.time}</b>
                </span>
              ))}
            </div>
          ) : (
            <span className="pi-sessionGlanceEmpty">No nearby sessions</span>
          )}
        </div>
      </div>

      {buckets.length > 0 ? (
        <div className="pi-sessionGlanceBars" aria-label="Event distribution">
          {buckets.map((bucket) => (
            <span
              key={bucket.key}
              className="pi-sessionGlanceBar"
              data-kind={bucket.key}
              style={{ "--bar-fr": `${Math.max(4, (bucket.count / totalBucketCount) * 100)}%` } as CSSProperties}
              title={`${bucket.count} ${bucket.label}`}
            >
              <span className="pi-sessionGlanceBarFill" />
              <span className="pi-sessionGlanceBarLabel">{bucket.label}</span>
              <span className="pi-sessionGlanceBarCount">{compactNumber(bucket.count)}</span>
            </span>
          ))}
        </div>
      ) : null}

    </section>
  );
}

export function ProjectsInbox({
  route,
  navigate,
  zeroPreview = false,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
  zeroPreview?: boolean;
}) {
  const { model, nowMs, loading } = useProjectsInbox(route);
  const [view] = useProjectsInboxView();
  const scoped = Boolean(route.projectSlug);
  const selectedSessionRef =
    scoped && !isSyntheticProcessSessionRef(route.sessionId) ? route.sessionId ?? null : null;
  const selectedSession = useMemo(
    () => selectedSessionRef ? findSelectedSession(model.sessions, route) : null,
    [model.sessions, route, selectedSessionRef],
  );
  const mode: ProjectMode = !scoped
    ? "overview"
    : route.indexView === "agents"
      ? "agents"
      : route.indexView === "sessions"
        ? "sessions"
        : "overview";

  const items = useMemo<Array<InboxThread | InboxSession>>(
    () => {
      if (zeroPreview) return [];
      if (selectedSessionRef) return [];
      if (!scoped) return filterThreadsForView(model.threads, view, nowMs);
      const slug = route.projectSlug!;
      const projectThreads = threadsForProject(model.threads, slug);
      const projectSessions = sessionsForProject(model.sessions, slug);
      if (mode === "agents") return projectThreads.filter((thread) => thread.kind === "agent");
      if (projectSessions.length > 0) return projectSessions;
      return projectThreads;
    },
    [model.sessions, model.threads, mode, nowMs, route.projectSlug, scoped, selectedSessionRef, view, zeroPreview],
  );
  const sections = useMemo(() => groupItems(items), [items]);
  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const displayCounts = zeroPreview ? ZERO_COUNTS : model.counts;
  const waiting = loading && !zeroPreview;
  const showProjectZeroState =
    !scoped && view === "everything" && !waiting && (zeroPreview || (model.projects.length === 0 && items.length === 0));

  const [cursor, setCursor] = useState(-1);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!scoped || !route.sessionId || !isSyntheticProcessSessionRef(route.sessionId)) return;
    navigate({
      ...route,
      indexView: "sessions",
      sessionId: undefined,
      selectedAgentId: undefined,
    });
  }, [navigate, route, scoped]);

  useEffect(() => {
    setCursor(-1);
  }, [route.projectSlug, view]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = Boolean(el) && (el!.tagName === "INPUT" || el!.tagName === "TEXTAREA" || el!.isContentEditable);
      if (typing) return;
      const max = flat.length;
      if (!max) return;
      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        setCursor((current) => (current < 0 ? 0 : Math.min(max - 1, current + 1)));
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        setCursor((current) => (current < 0 ? 0 : Math.max(0, current - 1)));
      } else if (event.key === "Enter") {
        const target = flat[cursor < 0 ? 0 : cursor];
        if (target) {
          event.preventDefault();
          navigate(target.kind === "session" ? sessionOpenRoute(target, route) : threadOpenRoute(target, route));
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cursor, flat, navigate, route]);

  useEffect(() => {
    if (cursor < 0) return;
    const target = flat[cursor];
    if (target) rowRefs.current.get(target.id)?.scrollIntoView({ block: "nearest" });
  }, [cursor, flat]);


  return (
    <div className="s-pi s-pi-inbox">
      {scoped ? (
        <ProjectScopeHeader route={route} navigate={navigate} slug={route.projectSlug!} model={model} mode={mode} />
      ) : (
        <div className="pi-inboxHead">
          <h1 className="pi-inboxTitle">Projects</h1>
          <span className="pi-inboxDigest">{digestLine(displayCounts.needs, displayCounts.working, displayCounts.everything)}</span>
          <span className="pi-inboxKbd" aria-hidden>
            j/k move · ↵ open
          </span>
        </div>
      )}

      {selectedSessionRef ? (
        <SelectedSessionMain
          session={selectedSession}
          sessionRef={selectedSessionRef}
          sessions={model.sessions}
          route={route}
          navigate={navigate}
          nowMs={nowMs}
        />
      ) : (
        <div className="pi-threads">
          {sections.map((section) => {
            let base = 0;
            for (const prior of sections) {
              if (prior.group === section.group) break;
              base += prior.items.length;
            }
            return (
              <div key={section.group}>
                <div className="pi-sectionHead" data-tone={section.group}>
                  <span className="pi-sectionLabel">{section.label}</span>
                  <span className="pi-sectionCount">{section.items.length}</span>
                </div>
                {section.items.map((thread, offset) => {
                  const index = base + offset;
                  return (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      crossProject={!scoped}
                      selected={thread.kind === "session" ? isSessionSelected(thread, route) : isThreadSelected(thread, route)}
                      cursor={cursor === index}
                      nowMs={nowMs}
                      onSelect={() => navigate(thread.kind === "session" ? sessionSelectRoute(thread, route) : threadSelectRoute(thread, route))}
                      onOpen={() => navigate(thread.kind === "session" ? sessionOpenRoute(thread, route) : threadOpenRoute(thread, route))}
                      rowRef={(el) => {
                        if (el) rowRefs.current.set(thread.id, el);
                        else rowRefs.current.delete(thread.id);
                      }}
                    />
                  );
                })}
              </div>
            );
          })}

          {items.length === 0 ? (
            <div className="pi-empty">
              {showProjectZeroState ? (
                <ProjectZeroComposer route={route} navigate={navigate} projects={model.projects} />
              ) : waiting ? (
                "Loading…"
              ) : (
                <>
                  <span>{emptyLabel(scoped, mode, view)}</span>
                  {!scoped && view !== "everything" ? (
                    <span className="pi-emptyHint">Nothing here right now.</span>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function emptyLabel(scoped: boolean, mode: ProjectMode, view: string): string {
  if (scoped && mode === "agents") return "No visible agents in this project.";
  if (scoped) return "No sessions in this project yet.";
  if (view === "needs") return "Nothing needs you.";
  if (view === "working") return "Nothing is moving right now.";
  if (view === "recent") return "No recent activity.";
  return "No conversations yet.";
}
