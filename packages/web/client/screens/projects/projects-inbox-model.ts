/* Projects · Inbox — the foundational model.

   A project is a place where work happens. The unit of triage is the work
   THREAD (a harness conversation/session): its title is the WORK, the agent is
   attribution — like a sender on an email. Agents are collapsed per
   (project · name) so the ~149 ID-proliferation records never masquerade as a
   fleet; the recognizable agent leads, phantom mirrors fold away. Attention is
   the only sort: needs-you › working › recent › dormant. Counts are truthful —
   we surface "3 moving · 1 needs you", never "149 agents".

   Pure + dependency-light so the whole thing stays unit-testable. All live
   fetching + sharing lives in useProjectsInbox.ts. */

import type {
  Agent,
  FleetAsk,
  FleetState,
  Route,
  SessionEntry,
  TailDiscoverySnapshot,
} from "../../lib/types.ts";
import { filterAgentsByMachineScope } from "../../lib/machine-scope.ts";
import {
  buildDirProjects,
  buildNativeSessionRows,
  directSessionMaps,
  isAgentRowWorking,
  rowForAgentInventory,
  type DirProject,
  type ProjectTreeSessionNode,
} from "../agents/model.ts";
import { isGroupLive } from "../agents/agents-project-model.ts";
import {
  agentPrecedence,
  buildRegistryAgents,
  harnessOf,
  humanizeWorkText,
  openProjectAgentProfile,
  registryWorkLine,
  type RegistryAgentEntry,
} from "./model.ts";

const DAY_MS = 24 * 60 * 60_000;

export type SmartView = "needs" | "working" | "recent" | "everything";

/** The three attention buckets the inbox groups by (plumbing like harness never groups). */
export type ThreadGroup = "needs" | "working" | "recent";

export type InboxThread = {
  /** Stable across refreshes so selection + cursor survive re-renders. */
  id: string;
  kind: "agent" | "native";
  projectSlug: string;
  projectTitle: string;
  projectRoot: string | null;
  // ── attribution ──
  agentId: string | null;
  agentName: string;
  harness: string;
  branch: string | null;
  // ── the work ──
  work: string;
  group: ThreadGroup;
  needs: boolean;
  working: boolean;
  lastActivityAt: number;
  sessionCount: number;
  /** Context window %, only when honestly known (needs observe — usually null here). */
  contextPct: number | null;
  // ── routing ──
  conversationId: string | null;
  sessionId: string | null;
};

export type InboxSession = {
  /** Stable across refreshes so session selection + cursor survive re-renders. */
  id: string;
  kind: "session";
  projectSlug: string;
  projectTitle: string;
  projectRoot: string | null;
  agentId: string | null;
  agentName: string;
  harness: string;
  branch: string | null;
  work: string;
  group: ThreadGroup;
  needs: false;
  working: boolean;
  lastActivityAt: number;
  sessionCount: 1;
  contextPct: number | null;
  conversationId: string | null;
  sessionId: string | null;
  route: Route | null;
};

export type InboxProject = {
  slug: string;
  title: string;
  root: string | null;
  agentCount: number;
  sessionCount: number;
  liveSessionCount: number;
  worktreeCount: number;
  needs: number;
  working: number;
  threadCount: number;
  lastActivityAt: number;
  /** Distinct non-trunk branch names in the project — feeds the New agent modal. */
  branches: string[];
};

export type ProjectsInboxModel = {
  projects: InboxProject[];
  threads: InboxThread[];
  sessions: InboxSession[];
  counts: Record<SmartView, number>;
};

export type BuildInboxInput = {
  agents: Agent[];
  machineId: string | null;
  sessions: SessionEntry[];
  fleet: FleetState | null;
  discovery: TailDiscoverySnapshot | null;
  nowMs: number;
  showEphemeral: boolean;
};

function asksByAgentId(fleet: FleetState | null): Map<string, FleetAsk[]> {
  const map = new Map<string, FleetAsk[]>();
  for (const ask of fleet?.activeAsks ?? []) {
    const list = map.get(ask.agentId) ?? [];
    list.push(ask);
    map.set(ask.agentId, list);
  }
  return map;
}

function titleCaseHarness(harness: string): string {
  return harness ? harness.charAt(0).toUpperCase() + harness.slice(1) : "Harness";
}

function branchLabel(branches: string[]): string | null {
  if (branches.length === 1) return branches[0] ?? null;
  if (branches.length > 1) return `${branches.length} branches`;
  return null;
}

function agentThread(
  entry: RegistryAgentEntry,
  conversationByAgentId: Map<string, string>,
  nowMs: number,
): InboxThread {
  const group = entry.group;
  const needs = group.needs;
  const working = !needs && group.nodes.some((node) => isAgentRowWorking(node.row));
  const recent = isGroupLive(group, nowMs);
  const bucket: ThreadGroup = needs ? "needs" : working ? "working" : "recent";
  const tone = needs ? "needs" : working || recent ? "live" : "idle";
  const lead = entry.leadAgent;
  const conversationId = conversationByAgentId.get(lead.id) ?? lead.conversationId ?? null;

  return {
    id: `${entry.projectSlug}:agent:${lead.id}`,
    kind: "agent",
    projectSlug: entry.projectSlug,
    projectTitle: entry.projectTitle,
    projectRoot: entry.projectRoot,
    agentId: lead.id,
    agentName: group.name,
    harness: harnessOf(group.harness),
    branch: branchLabel(group.branches),
    work: registryWorkLine(entry, tone),
    group: bucket,
    needs,
    working,
    lastActivityAt: group.lastActivityAt,
    sessionCount: group.sessionCount,
    contextPct: null,
    conversationId,
    sessionId: null,
  };
}

function nativeSessionIdFromRoute(route: Route | null): string | null {
  return route && route.view === "sessions" && route.sessionId ? route.sessionId : null;
}

/** Unattributed native transcript that is live *right now* (no named agent owns it yet). */
function nativeThread(
  project: DirProject,
  node: ProjectTreeSessionNode,
  nowMs: number,
): InboxThread {
  const harness = harnessOf(node.harness);
  return {
    id: `${project.slice.slug}:native:${node.key}`,
    kind: "native",
    projectSlug: project.slice.slug,
    projectTitle: project.slice.title,
    projectRoot: project.slice.root,
    agentId: null,
    agentName: `${titleCaseHarness(harness)} session`,
    harness,
    branch: null,
    work: humanizeWorkText(node.detail ?? node.label) || node.label,
    group: "working",
    needs: false,
    working: true,
    lastActivityAt: node.lastActivityAt ?? nowMs,
    sessionCount: 1,
    contextPct: null,
    conversationId: null,
    sessionId: nativeSessionIdFromRoute(node.route),
  };
}

function sessionGroup(node: ProjectTreeSessionNode, nowMs: number): ThreadGroup {
  if (node.status === "active" || node.status === "workflow") return "working";
  if (node.lastActivityAt && nowMs - node.lastActivityAt < DAY_MS) return "recent";
  return "recent";
}

function sessionRouteId(route: Route | null): string | null {
  if (!route) return null;
  if (route.view === "sessions") return route.sessionId ?? null;
  if (route.view === "conversation") return route.conversationId;
  return null;
}

function projectSession(
  project: DirProject,
  node: ProjectTreeSessionNode,
  nowMs: number,
  agent?: Agent,
  branch?: string | null,
): InboxSession {
  const harness = harnessOf(node.harness);
  const routeId = sessionRouteId(node.route);
  const working = node.status === "active" || node.status === "workflow";
  return {
    id: `${project.slice.slug}:session:${node.key}`,
    kind: "session",
    projectSlug: project.slice.slug,
    projectTitle: project.slice.title,
    projectRoot: project.slice.root,
    agentId: agent?.id ?? null,
    agentName: agent?.name ?? `${titleCaseHarness(harness)} session`,
    harness,
    branch: branchLabel(branch ? [branch] : []),
    work: humanizeWorkText(node.detail ?? node.label) || node.label,
    group: sessionGroup(node, nowMs),
    needs: false,
    working,
    lastActivityAt: node.lastActivityAt ?? nowMs,
    sessionCount: 1,
    contextPct: null,
    conversationId: node.route?.view === "conversation" ? node.route.conversationId : null,
    sessionId: node.route?.view === "sessions" ? node.route.sessionId ?? routeId : routeId,
    route: node.route,
  };
}

function projectSessions(project: DirProject, nowMs: number): InboxSession[] {
  const sessions: InboxSession[] = [];
  for (const agentNode of project.agents) {
    for (const node of agentNode.sessions) {
      sessions.push(
        projectSession(
          project,
          node,
          nowMs,
          agentNode.row.agent,
          agentNode.row.branch,
        ),
      );
    }
  }
  for (const node of project.unassigned) {
    sessions.push(projectSession(project, node, nowMs));
  }
  return sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.agentName.localeCompare(b.agentName));
}

function projectWorktreeCount(project: DirProject): number {
  const roots = new Set<string>();
  for (const node of project.agents) {
    const root = node.row.agent.cwd ?? node.row.agent.projectRoot ?? project.slice.root;
    if (root) roots.add(root);
  }
  for (const session of project.slice.nativeSessions) {
    if (session.cwd) roots.add(session.cwd);
  }
  return roots.size || (project.slice.root ? 1 : 0);
}

function threadRank(thread: InboxThread, nowMs: number): number {
  if (thread.needs) return 3;
  if (thread.working) return 2;
  if (nowMs - thread.lastActivityAt < DAY_MS) return 1;
  return 0;
}

export function buildProjectsInboxModel(input: BuildInboxInput): ProjectsInboxModel {
  const { nowMs, showEphemeral } = input;
  const agents = filterAgentsByMachineScope(input.agents, input.machineId);
  const asks = asksByAgentId(input.fleet);
  const { conversationByAgentId, sessionByAgentId } = directSessionMaps(input.sessions);

  const rows = agents.map((agent) =>
    rowForAgentInventory(agent, sessionByAgentId.get(agent.id) ?? null, asks.get(agent.id) ?? []),
  );
  const native = buildNativeSessionRows(input.discovery, nowMs);
  const dirProjects = buildDirProjects(rows, input.sessions, native);
  const registryAgents = buildRegistryAgents(dirProjects, showEphemeral);

  const threads: InboxThread[] = registryAgents.map((entry) =>
    agentThread(entry, conversationByAgentId, nowMs),
  );

  // Fold in native transcripts that are live *now* and unattributed — a real
  // harness session no named agent has claimed yet. Idle transcripts stay out;
  // they are history, not the inbox.
  for (const project of dirProjects) {
    for (const node of project.unassigned) {
      if (node.kind !== "native" || node.status !== "active" || !node.route) continue;
      threads.push(nativeThread(project, node, nowMs));
    }
  }

  threads.sort((a, b) => threadRank(b, nowMs) - threadRank(a, nowMs) || b.lastActivityAt - a.lastActivityAt);

  const sessions = dirProjects.flatMap((project) => projectSessions(project, nowMs));

  const threadsBySlug = new Map<string, InboxThread[]>();
  for (const thread of threads) {
    const list = threadsBySlug.get(thread.projectSlug) ?? [];
    list.push(thread);
    threadsBySlug.set(thread.projectSlug, list);
  }
  const sessionsBySlug = new Map<string, InboxSession[]>();
  for (const session of sessions) {
    const list = sessionsBySlug.get(session.projectSlug) ?? [];
    list.push(session);
    sessionsBySlug.set(session.projectSlug, list);
  }
  const agentCountBySlug = new Map<string, number>();
  for (const entry of registryAgents) {
    agentCountBySlug.set(entry.projectSlug, (agentCountBySlug.get(entry.projectSlug) ?? 0) + 1);
  }

  const projects: InboxProject[] = dirProjects.map((project) => {
    const list = threadsBySlug.get(project.slice.slug) ?? [];
    const projectSessionList = sessionsBySlug.get(project.slice.slug) ?? [];
    const branches = [
      ...new Set(
        project.agents
          .map((node) => node.row.branch)
          .filter((branch): branch is string => Boolean(branch) && branch !== "—" && branch !== "main"),
      ),
    ];
    return {
      slug: project.slice.slug,
      title: project.slice.title,
      root: project.slice.root,
      agentCount: agentCountBySlug.get(project.slice.slug) ?? 0,
      sessionCount: projectSessionList.length,
      liveSessionCount: projectSessionList.filter((session) => session.working).length,
      worktreeCount: projectWorktreeCount(project),
      needs: list.filter((thread) => thread.needs).length,
      working: list.filter((thread) => thread.working).length,
      threadCount: list.length,
      lastActivityAt: project.lastActivityAt,
      branches,
    };
  });
  projects.sort(
    (a, b) => projectRank(b) - projectRank(a) || b.lastActivityAt - a.lastActivityAt || a.title.localeCompare(b.title),
  );

  const counts: Record<SmartView, number> = {
    needs: threads.filter((thread) => thread.needs).length,
    working: threads.filter((thread) => thread.working).length,
    recent: threads.filter((thread) => nowMs - thread.lastActivityAt < DAY_MS).length,
    everything: threads.length,
  };

  return { projects, threads, sessions, counts };
}

function projectRank(project: InboxProject): number {
  if (project.needs > 0) return 2;
  if (project.working > 0) return 1;
  return 0;
}

/** A dormant project has nothing live and no activity in a day — folds behind disclosure. */
export function isDormantProject(project: InboxProject, nowMs: number): boolean {
  return (
    project.needs === 0 &&
    project.working === 0 &&
    (project.threadCount === 0 || nowMs - project.lastActivityAt > DAY_MS)
  );
}

export function filterThreadsForView(threads: InboxThread[], view: SmartView, nowMs: number): InboxThread[] {
  switch (view) {
    case "needs":
      return threads.filter((thread) => thread.needs);
    case "working":
      return threads.filter((thread) => thread.working);
    case "recent":
      return threads.filter((thread) => nowMs - thread.lastActivityAt < DAY_MS);
    case "everything":
      return threads;
  }
}

export function threadsForProject(threads: InboxThread[], slug: string): InboxThread[] {
  return threads.filter((thread) => thread.projectSlug === slug);
}

export function sessionsForProject(sessions: InboxSession[], slug: string): InboxSession[] {
  return sessions.filter((session) => session.projectSlug === slug);
}

const GROUP_ORDER: ThreadGroup[] = ["needs", "working", "recent"];
const GROUP_LABEL: Record<ThreadGroup, string> = {
  needs: "Needs you",
  working: "In flight",
  recent: "Recent",
};

export function groupItems<T extends { group: ThreadGroup }>(
  items: T[],
): Array<{ group: ThreadGroup; label: string; items: T[] }> {
  const byGroup = new Map<ThreadGroup, T[]>();
  for (const item of items) {
    const list = byGroup.get(item.group) ?? [];
    list.push(item);
    byGroup.set(item.group, list);
  }
  return GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => ({
    group,
    label: GROUP_LABEL[group],
    items: byGroup.get(group)!,
  }));
}

export function groupThreads(threads: InboxThread[]): Array<{ group: ThreadGroup; label: string; threads: InboxThread[] }> {
  return groupItems(threads).map((group) => ({
    group: group.group,
    label: group.label,
    threads: group.items,
  }));
}

/* ── routing: threads link into existing surfaces, never new plumbing ── */

function scopeBase(route: Extract<Route, { view: "agents-v2" }>): Extract<Route, { view: "agents-v2" }> {
  return {
    view: "agents-v2",
    ...(route.projectSlug ? { projectSlug: route.projectSlug } : {}),
    ...(route.machineId ? { machineId: route.machineId } : {}),
  };
}

export function threadKey(thread: InboxThread): string {
  return thread.agentId ? `agent:${thread.agentId}` : `native:${thread.sessionId ?? thread.id}`;
}

export function isThreadSelected(thread: InboxThread, route: Extract<Route, { view: "agents-v2" }>): boolean {
  if (thread.agentId && route.selectedAgentId) return route.selectedAgentId === thread.agentId;
  if (thread.kind === "native" && thread.sessionId && route.sessionId) return route.sessionId === thread.sessionId;
  return false;
}

/** Single click — peek the thread in the right aside without leaving the inbox. */
export function threadSelectRoute(
  thread: InboxThread,
  route: Extract<Route, { view: "agents-v2" }>,
): Extract<Route, { view: "agents-v2" }> {
  if (thread.kind === "native") {
    return { ...scopeBase(route), sessionId: thread.sessionId ?? undefined };
  }
  return { ...scopeBase(route), selectedAgentId: thread.agentId ?? undefined };
}

/** Enter / open — the primary destination: the live conversation or session. */
export function threadOpenRoute(thread: InboxThread, route: Extract<Route, { view: "agents-v2" }>): Route {
  if (thread.kind === "native" && thread.sessionId) return { view: "sessions", sessionId: thread.sessionId };
  if (thread.conversationId) return { view: "conversation", conversationId: thread.conversationId };
  if (thread.agentId) return openProjectAgentProfile(route, thread.agentId);
  return scopeBase(route);
}

export function threadObserveRoute(
  thread: InboxThread,
  route: Extract<Route, { view: "agents-v2" }>,
): Route | null {
  if (thread.kind === "native" && thread.sessionId) return { view: "sessions", sessionId: thread.sessionId };
  if (thread.agentId) return { ...openProjectAgentProfile(route, thread.agentId), tab: "observe" };
  return null;
}

export function sessionSelectRoute(
  session: InboxSession,
  route: Extract<Route, { view: "agents-v2" }>,
): Extract<Route, { view: "agents-v2" }> {
  const sessionId = sessionRouteRef(session);
  return {
    ...scopeBase(route),
    indexView: "sessions",
    sessionId,
    selectedAgentId: undefined,
  };
}

export function isSessionSelected(session: InboxSession, route: Extract<Route, { view: "agents-v2" }>): boolean {
  const sessionRef = sessionRouteRef(session);
  if (sessionRef && route.sessionId) return route.sessionId === sessionRef;
  return false;
}

export function sessionRouteRef(session: InboxSession): string {
  if (session.sessionId) return session.sessionId;
  if (session.conversationId) return session.conversationId;
  const marker = ":session:";
  const markerIndex = session.id.indexOf(marker);
  return markerIndex >= 0
    ? session.id.slice(markerIndex + marker.length)
    : session.id;
}

export function sessionOpenRoute(session: InboxSession, route: Extract<Route, { view: "agents-v2" }>): Route {
  if (session.route) return session.route;
  if (session.agentId) return openProjectAgentProfile(route, session.agentId);
  return scopeBase(route);
}

export { agentPrecedence };
