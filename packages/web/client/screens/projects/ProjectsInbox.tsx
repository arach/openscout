import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { formatClockTimestamp, formatDurationClock, normalizeTimestampMs, timeAgo } from "../../lib/time.ts";
import type { ObserveData, Route } from "../../lib/types.ts";
import { SessionRefScreen, type SessionRefLookup } from "../sessions/SessionRefScreen.tsx";
import { shortHomePath } from "./project-overview-helpers.ts";
import { useProjectsInbox, useProjectsInboxView } from "./useProjectsInbox.ts";
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
  type InboxSession,
  threadsForProject,
  type InboxThread,
  type ProjectsInboxModel,
} from "./projects-inbox-model.ts";
import "./projects-inbox.css";

type Navigate = (route: Route) => void;

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

function ProjectSurfaceState({
  title,
  detail,
  tone = "muted",
}: {
  title: string;
  detail?: string;
  tone?: "loading" | "error" | "muted";
}) {
  return (
    <div className="pi-stateBlock" data-tone={tone} role={tone === "loading" ? "status" : "note"}>
      <span className="pi-statePulse" aria-hidden />
      <span className="pi-stateTitle">{title}</span>
      {detail ? <span className="pi-stateDetail">{detail}</span> : null}
    </div>
  );
}

function ProjectRowsSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="pi-loadingRows" aria-hidden="true">
      <div className="pi-sectionHead pi-sectionHead--loading">
        <span className="pi-loadingLine pi-loadingLine--label" />
        <span className="pi-loadingLine pi-loadingLine--count" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div className="pi-row pi-row--loading" key={index}>
          <span className="pi-rowDot" />
          <span className="pi-rowBody">
            <span className="pi-loadingLine pi-loadingLine--title" />
            <span className="pi-loadingLine pi-loadingLine--meta" />
          </span>
          <span className="pi-rowVitals">
            <span className="pi-loadingLine pi-loadingLine--time" />
          </span>
        </div>
      ))}
    </div>
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
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
}) {
  const { model, nowMs, loading, error } = useProjectsInbox(route);
  const [view] = useProjectsInboxView();
  const scoped = Boolean(route.projectSlug);
  const selectedSessionRef = scoped ? route.sessionId ?? null : null;
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
      if (selectedSessionRef) return [];
      if (!scoped) return filterThreadsForView(model.threads, view, nowMs);
      const slug = route.projectSlug!;
      const projectThreads = threadsForProject(model.threads, slug);
      const projectSessions = sessionsForProject(model.sessions, slug);
      if (mode === "agents") return projectThreads.filter((thread) => thread.kind === "agent");
      if (projectSessions.length > 0) return projectSessions;
      return projectThreads;
    },
    [model.sessions, model.threads, mode, nowMs, route.projectSlug, scoped, selectedSessionRef, view],
  );
  const sections = useMemo(() => groupItems(items), [items]);
  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const hasModelData = model.projects.length > 0 || model.threads.length > 0 || model.sessions.length > 0;
  const initialLoading = loading && !hasModelData;
  const resolvingSelectedSession = Boolean(selectedSessionRef && !selectedSession && loading);

  const [cursor, setCursor] = useState(-1);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

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
    <div className="s-pi s-pi-inbox" aria-busy={loading || undefined} data-loading={loading || undefined}>
      {scoped ? (
        <ProjectScopeHeader route={route} navigate={navigate} slug={route.projectSlug!} model={model} mode={mode} />
      ) : (
        <div className="pi-inboxHead">
          <h1 className="pi-inboxTitle">Projects</h1>
          <span className="pi-inboxDigest">{digestLine(model.counts.needs, model.counts.working, model.counts.everything)}</span>
          <span className="pi-inboxKbd" aria-hidden>
            j/k move · ↵ open
          </span>
        </div>
      )}

      {selectedSessionRef ? (
        resolvingSelectedSession ? (
          <main className="pi-sessionDetail" aria-label="Selected session">
            <ProjectSurfaceState
              tone="loading"
              title="Resolving session"
              detail="Looking for a live trace or readable session archive."
            />
          </main>
        ) : (
          <SelectedSessionMain
            session={selectedSession}
            sessionRef={selectedSessionRef}
            sessions={model.sessions}
            route={route}
            navigate={navigate}
            nowMs={nowMs}
          />
        )
      ) : (
        <div className="pi-threads">
          {initialLoading ? <ProjectRowsSkeleton /> : null}

          {!initialLoading && sections.map((section) => {
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

          {!initialLoading && items.length === 0 ? (
            error && !hasModelData ? (
              <ProjectSurfaceState tone="error" title="Projects unavailable" detail={error} />
            ) : (
              <ProjectSurfaceState
                title={emptyLabel(scoped, mode, view)}
                detail={!scoped && view !== "everything" ? "Nothing here right now." : undefined}
              />
            )
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
