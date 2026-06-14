import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useOptionalFlag } from "hudsonkit/flags";
import { WorkList } from "../components/WorkList.tsx";
import { agentStateCssToken, agentStateLabel, normalizeAgentState } from "../lib/agent-state.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { api } from "../lib/api.ts";
import { copyTextToClipboard } from "../lib/clipboard.ts";
import { dismissOperatorAttention } from "../lib/operator-attention.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { queueTakeover } from "../lib/terminal-takeover.ts";
import { conversationForAgent, routeMachineId } from "../lib/router.ts";
import { filterAgentsByMachineScope } from "../lib/machine-scope.ts";
import { BackToPicker } from "../scout/slots/BackToPicker.tsx";
import { openContent } from "../scout/slots/openContent.ts";
import { useScout } from "../scout/Provider.tsx";
import { useContextMenu, type MenuItem } from "../components/ContextMenu.tsx";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable.tsx";
import { VantageHandoffButton } from "../components/VantageHandoffButton.tsx";
import { AgentLiveActions } from "../components/AgentLiveActions.tsx";
import { ObservedTopologyPanel } from "../components/ObservedTopologyPanel.tsx";
import type {
  AgentTab,
  Agent,
  AgentObservePayload,
  FleetAsk,
  FleetState,
  HarnessTopologySnapshot,
  LocalAgentContextState,
  Message,
  Route,
  SessionEntry,
  SessionCatalogWithResume,
  TailDiscoveredProcess,
  TailDiscoverySnapshot,
  WorkItem,
} from "../lib/types.ts";
import { ConversationScreen } from "./ConversationScreen.tsx";
import { SessionObserve } from "./SessionObserve.tsx";
import { AgentsSubnav } from "./AgentsSubnav.tsx";
import { DevOverride } from "../dev/override.tsx";
import "./agents-screen.css";
import "./ops-atop.css";
import "./ops-screen.css";


function agentLabel(
  agent: Agent,
  allAgents: Agent[],
): { name: string; qualifier: string | null } {
  const siblings = allAgents.filter((c) => c.name === agent.name);
  if (siblings.length <= 1) return { name: agent.name, qualifier: null };
  const qualifier = agent.project ?? agent.branch ?? agent.id.replace(/^.*\./, "");
  return { name: agent.name, qualifier };
}

function formatLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/_/g, " ");
  if (cleaned.toLowerCase() === "relay agent") return "agent";
  return cleaned;
}

function countLabel(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function handleLabel(agent: Agent): string | null {
  return agent.handle ? `@${agent.handle.replace(/^@+/, "")}` : null;
}

function primaryAgentSelector(agent: Agent): string | null {
  return agent.selector ?? agent.defaultSelector ?? handleLabel(agent);
}

function directSessionMaps(sessions: SessionEntry[]): {
  conversationByAgentId: Map<string, string>;
  sessionByAgentId: Map<string, SessionEntry>;
} {
  const directSessions = [...sessions]
    .filter(
      (s): s is SessionEntry & { agentId: string } =>
        s.kind === "direct" && Boolean(s.agentId),
    )
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

  const conversationByAgentId = new Map<string, string>();
  const sessionByAgentId = new Map<string, SessionEntry>();
  for (const session of directSessions) {
    const current = sessionByAgentId.get(session.agentId);
    if (!current || shouldPreferDirectSession(session, current)) {
      conversationByAgentId.set(session.agentId, session.id);
      sessionByAgentId.set(session.agentId, session);
    }
  }
  return { conversationByAgentId, sessionByAgentId };
}

function shouldPreferDirectSession(candidate: SessionEntry & { agentId: string }, existing: SessionEntry): boolean {
  const canonicalConversationId = conversationForAgent(candidate.agentId);
  const candidateIsCanonical = candidate.id === canonicalConversationId;
  const existingIsCanonical = existing.id === canonicalConversationId;
  if (candidateIsCanonical !== existingIsCanonical) return candidateIsCanonical;

  const candidateIsOperatorDm = candidate.id.startsWith(`dm.operator.`);
  const existingIsOperatorDm = existing.id.startsWith(`dm.operator.`);
  if (candidateIsOperatorDm !== existingIsOperatorDm) return candidateIsOperatorDm;

  const candidateLastAt = candidate.lastMessageAt ?? 0;
  const existingLastAt = existing.lastMessageAt ?? 0;
  if (candidateLastAt !== existingLastAt) return candidateLastAt > existingLastAt;

  return candidate.id < existing.id;
}

type AgentInventoryStatus = "working" | "ready" | "not_ready";

type AgentInventoryRow = {
  agent: Agent;
  status: AgentInventoryStatus;
  stateLabel: string;
  project: string;
  branch: string;
  harness: string;
  session: SessionEntry | null;
  activeTask: string | null;
  activeAskCount: number;
  lastActivityAt: number | null;
};

type AgentInventoryColumnKey =
  | "status"
  | "agent"
  | "project"
  | "task"
  | "harness"
  | "branch"
  | "active"
  | "session"
  | "last";

type AgentsLibraryViewMode = "cards" | "tree";

type TimeHorizonKey = "1h" | "24h" | "7d" | "all";

const DEFAULT_TIME_HORIZON: TimeHorizonKey = "24h";
const PROJECT_OVERVIEW_AGENT_LIMIT = 8;
const PROJECT_OVERVIEW_SESSION_LIMIT = 3;

const TIME_HORIZON_OPTIONS: Array<{ key: TimeHorizonKey; label: string }> = [
  { key: "1h", label: "1h" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "all", label: "all" },
];

type NativeSessionStatus = "active" | "idle";

type NativeSessionRow = {
  key: string;
  refId: string;
  source: string;
  project: string;
  cwd: string | null;
  transcriptPath: string | null;
  sessionId: string | null;
  mtimeMs: number | null;
  size: number | null;
  status: NativeSessionStatus;
  process: TailDiscoveredProcess | null;
  lastActivityAt: number | null;
};

type ProjectIdentity = {
  key: string;
  title: string;
  root: string | null;
};

type ProjectSlice = ProjectIdentity & {
  agents: AgentInventoryRow[];
  scoutSessions: SessionEntry[];
  nativeSessions: NativeSessionRow[];
  workflows: ProjectWorkflowRow[];
  status: AgentInventoryStatus;
  lastActivityAt: number | null;
};

type ProjectWorkflowRow = {
  key: string;
  source: string;
  label: string;
  project: ProjectIdentity;
  status: string;
  description: string | null;
  parentSessionId: string | null;
  workerCount: number;
  taskCount: number;
  activeTaskCount: number;
  completedTaskCount: number;
  lastActivityAt: number | null;
};

type ProjectTreeSessionKind = "native" | "scout" | "workflow";

type ProjectTreeSessionNode = {
  key: string;
  kind: ProjectTreeSessionKind;
  status: string;
  harness: string;
  label: string;
  detail: string | null;
  subLabel?: string;
  lastActivityAt: number | null;
  route: Route | null;
};

type ProjectTreeAgentNode = {
  key: string;
  row: AgentInventoryRow;
  sessions: ProjectTreeSessionNode[];
};

type ProjectTree = {
  agents: ProjectTreeAgentNode[];
  unassignedSessions: ProjectTreeSessionNode[];
};

type ProjectTreeSortKey = "target" | "state" | "harness" | "branch" | "sessions" | "last";

type ProjectTreeSort = {
  key: ProjectTreeSortKey;
  dir: 1 | -1;
};

type ProjectTreeColumn = {
  key: ProjectTreeSortKey | "actions";
  label: string;
  sortable: boolean;
};

const AGENT_STATUS_RANK: Record<AgentInventoryStatus, number> = {
  working: 0,
  ready: 1,
  not_ready: 2,
};

function agentInventoryStatusClass(status: AgentInventoryStatus): string {
  switch (status) {
    case "working":
      return "working";
    case "ready":
      return "available";
    case "not_ready":
      return "offline";
  }
}

function agentInventoryStatusLabel(status: AgentInventoryStatus): string {
  switch (status) {
    case "working":
      return "working";
    case "ready":
      return "ready";
    case "not_ready":
      return "not ready";
  }
}

const PROJECT_TREE_DEFAULT_SORT: ProjectTreeSort = { key: "target", dir: 1 };

const PROJECT_TREE_COLUMNS: ProjectTreeColumn[] = [
  { key: "target", label: "Target", sortable: true },
  { key: "state", label: "State", sortable: true },
  { key: "harness", label: "Harness", sortable: true },
  { key: "branch", label: "Branch / cwd", sortable: true },
  { key: "sessions", label: "Sessions", sortable: true },
  { key: "last", label: "Last", sortable: true },
  { key: "actions", label: "Actions", sortable: false },
];

const NATIVE_SESSION_ACTIVE_WINDOW_MS = 60_000;

function basename(path: string | null | undefined): string | null {
  if (!path) return null;
  const cleaned = path.replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

function normalizeProjectRoot(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "") || null;
}

function dirname(path: string): string | null {
  const cleaned = path.replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(0, idx) || "/" : null;
}

function readableProjectTitle(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function worktreeFamilyFromRoot(root: string | null): { title: string; root: string | null } | null {
  const leaf = basename(root)?.trim().toLowerCase();
  if (!root || !leaf || leaf === "~") return null;
  const match = leaf.match(/^(.+?)(?:-(?:parity|codex))?-c\d+$/);
  const family = match?.[1];
  if (!family) return null;
  const parent = dirname(root);
  return {
    title: readableProjectTitle(family),
    root: parent ? `${parent}/${family}` : family,
  };
}

function projectKeyFrom(root: string | null, title: string): string {
  const normalizedTitle = title.trim().toLowerCase();
  if (normalizedTitle && normalizedTitle !== "unscoped" && normalizedTitle !== "unknown") {
    return `project:${normalizedTitle}`;
  }
  return root ? `root:${root}` : `project:${normalizedTitle || "unscoped"}`;
}

function isTemporaryProjectRoot(root: string | null): boolean {
  return Boolean(root?.startsWith("/tmp/"));
}

function projectIdentity(title: string | null | undefined, root: string | null | undefined): ProjectIdentity {
  const normalizedRoot = normalizeProjectRoot(root);
  const resolvedTitle = title?.trim() || basename(normalizedRoot) || "Unscoped";
  return {
    key: projectKeyFrom(normalizedRoot, resolvedTitle),
    title: resolvedTitle,
    root: normalizedRoot,
  };
}

function projectIdentityForRooted(title: string | null | undefined, root: string | null | undefined): ProjectIdentity {
  const normalizedRoot = normalizeProjectRoot(root);
  const family = worktreeFamilyFromRoot(normalizedRoot);
  return family ? projectIdentity(family.title, family.root) : projectIdentity(title, normalizedRoot);
}

function projectIdentityForAgentRow(row: AgentInventoryRow): ProjectIdentity {
  const root = normalizeProjectRoot(row.agent.projectRoot ?? row.agent.cwd);
  const title = row.agent.project ?? row.project;
  return projectIdentityForRooted(title, root);
}

function projectIdentityForNativeSession(row: NativeSessionRow): ProjectIdentity {
  return projectIdentityForRooted(row.project, row.cwd);
}

function projectIdentityForScoutSession(session: SessionEntry): ProjectIdentity {
  return projectIdentityForRooted(session.agentName ?? session.title, session.workspaceRoot);
}

function topologySourceLabel(source: string): string {
  if (source.includes("claude")) return "claude";
  if (source.includes("codex")) return "codex";
  return formatLabel(source) ?? "workflow";
}

function workspaceRootFromObservedPath(path: string | null | undefined): string | null {
  const value = path?.trim();
  if (!value) return null;

  const localDevMatch = value.match(/^(\/Users\/[^/]+\/dev\/[^/]+)/);
  if (localDevMatch?.[1]) return localDevMatch[1];

  const homeDevMatch = value.match(/^(~\/dev\/[^/]+)/);
  if (homeDevMatch?.[1]) return homeDevMatch[1];

  const claudeProjectMatch = value.match(/\.claude\/projects\/-Users-([^-]+)-dev-([^/]+)/);
  if (claudeProjectMatch?.[1] && claudeProjectMatch[2]) {
    const projectName = claudeProjectMatch[2].split("-packages-")[0] ?? claudeProjectMatch[2];
    return `/Users/${claudeProjectMatch[1]}/dev/${projectName}`;
  }

  return null;
}

function stringMeta(meta: Record<string, unknown> | undefined, key: string): string | null {
  const value = meta?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function projectIdentityForWorkflow(row: ProjectWorkflowRow): ProjectIdentity {
  return projectIdentityForRooted(row.project.title, row.project.root);
}

function normalizeSessionRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const leaf = basename(trimmed) ?? trimmed;
  return leaf.endsWith(".jsonl") ? leaf.slice(0, -".jsonl".length) : leaf;
}

function addSessionRef(candidates: Set<string>, value: string | null | undefined): void {
  const raw = value?.trim();
  if (raw) candidates.add(raw.toLowerCase());
  const normalized = normalizeSessionRef(raw);
  if (normalized) candidates.add(normalized.toLowerCase());
}

function agentSessionRefs(row: AgentInventoryRow): Set<string> {
  const refs = new Set<string>();
  addSessionRef(refs, row.agent.conversationId);
  addSessionRef(refs, conversationForAgent(row.agent.id));
  addSessionRef(refs, row.agent.harnessSessionId);
  addSessionRef(refs, row.agent.harnessLogPath);
  addSessionRef(refs, row.session?.id);
  addSessionRef(refs, row.session?.harnessSessionId);
  addSessionRef(refs, row.session?.harnessLogPath);
  return refs;
}

function refMatches(candidates: Set<string>, value: string | null | undefined): boolean {
  const raw = value?.trim();
  if (raw && candidates.has(raw.toLowerCase())) return true;
  const normalized = normalizeSessionRef(raw);
  return Boolean(normalized && candidates.has(normalized.toLowerCase()));
}

function scoutSessionMatchesAgent(session: SessionEntry, row: AgentInventoryRow): boolean {
  if (session.agentId && session.agentId === row.agent.id) return true;
  const refs = agentSessionRefs(row);
  return refMatches(refs, session.id)
    || refMatches(refs, session.harnessSessionId)
    || refMatches(refs, session.harnessLogPath);
}

function nativeProcessMatchesAgent(process: TailDiscoveredProcess | null, row: AgentInventoryRow): boolean {
  const command = process?.command?.toLowerCase();
  if (!command) return false;
  const candidates = [
    row.agent.id,
    row.agent.selector?.replace(/^@/, "").replace(/\.node:.+$/, ""),
    row.agent.defaultSelector?.replace(/^@/, "").replace(/\.node:.+$/, ""),
    row.agent.harnessSessionId,
  ].filter((value): value is string => Boolean(value && value.length >= 8));
  return candidates.some((candidate) => command.includes(candidate.toLowerCase()));
}

function nativeSessionMatchesAgent(session: NativeSessionRow, row: AgentInventoryRow): boolean {
  const refs = agentSessionRefs(row);
  return refMatches(refs, session.refId)
    || refMatches(refs, session.sessionId)
    || refMatches(refs, session.transcriptPath)
    || nativeProcessMatchesAgent(session.process, row);
}

function buildNativeSessionRows(
  discovery: TailDiscoverySnapshot | null,
  now: number,
): NativeSessionRow[] {
  if (!discovery) return [];

  const rows: NativeSessionRow[] = [];
  for (const transcript of discovery.transcripts ?? []) {
    const source = transcript.source || "unknown";
    const refId = normalizeSessionRef(transcript.sessionId)
      ?? normalizeSessionRef(transcript.transcriptPath);
    if (!refId) continue;

    const lastActivityAt = transcript.mtimeMs || null;
    rows.push({
      key: `transcript:${transcript.transcriptPath}`,
      refId,
      source,
      project: transcript.project?.trim()
        || basename(transcript.cwd)
        || basename(transcript.transcriptPath)
        || "unknown",
      cwd: normalizeProjectRoot(transcript.cwd),
      transcriptPath: transcript.transcriptPath,
      sessionId: transcript.sessionId,
      mtimeMs: transcript.mtimeMs,
      size: transcript.size,
      status: lastActivityAt && now - lastActivityAt <= NATIVE_SESSION_ACTIVE_WINDOW_MS
        ? "active"
        : "idle",
      process: null,
      lastActivityAt,
    });
  }

  for (const process of discovery.processes ?? []) {
    const source = process.source || "unknown";

    const cwd = normalizeProjectRoot(process.cwd);
    rows.push({
      key: `process:${source}:${process.pid}`,
      refId: `pid-${process.pid}`,
      source,
      project: basename(cwd) ?? "unknown",
      cwd,
      transcriptPath: null,
      sessionId: null,
      mtimeMs: null,
      size: null,
      status: "active",
      process,
      lastActivityAt: null,
    });
  }

  return rows.sort((left, right) => {
    const statusDelta = (left.status === "active" ? 0 : 1) - (right.status === "active" ? 0 : 1);
    if (statusDelta !== 0) return statusDelta;
    return (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0)
      || left.project.localeCompare(right.project);
  });
}

function buildWorkflowRows(snapshot: HarnessTopologySnapshot | null): ProjectWorkflowRow[] {
  if (!snapshot) return [];
  const rows: ProjectWorkflowRow[] = [];

  for (const observation of snapshot.observations) {
    const topology = observation.topology;
    const source = topologySourceLabel(observation.source);
    const sourceRefs = new Map((topology.sourceRefs ?? []).map((ref) => [ref.id, ref.ref]));

    for (const group of topology.groups) {
      if (group.kind !== "workflow") continue;

      const runId = stringMeta(group.providerMeta, "claudeWorkflowRunId") ?? group.id;
      const tasks = topology.tasks.filter((task) =>
        stringMeta(task.providerMeta, "claudeWorkflowRunId") === runId,
      );
      const workers = topology.agents.filter((agent) =>
        stringMeta(agent.providerMeta, "claudeWorkflowRunId") === runId && agent.role !== "lead",
      );
      const activeTasks = tasks.filter((task) => task.state !== "completed");
      const completedTasks = tasks.filter((task) => task.state === "completed");
      const pathCandidates = [
        stringMeta(group.providerMeta, "workspaceRoot"),
        stringMeta(group.providerMeta, "cwd"),
        stringMeta(group.providerMeta, "transcriptDir"),
        stringMeta(group.providerMeta, "scriptPath"),
        group.sourceRef ? sourceRefs.get(group.sourceRef) : null,
        ...topology.agents.map((agent) => agent.cwd),
      ];
      const root = pathCandidates
        .map(workspaceRootFromObservedPath)
        .find((value): value is string => Boolean(value)) ?? null;
      const project = projectIdentityForRooted(basename(root) ?? group.name ?? "Workflows", root);
      const observedAt = Date.parse(topology.observedAt);
      const lastActivityAt = Math.max(
        Number.isFinite(observedAt) ? observedAt : 0,
        observation.changedAt ?? 0,
      ) || null;

      rows.push({
        key: group.id,
        source,
        label: group.name ?? runId,
        project,
        status: activeTasks.length > 0 ? "running" : tasks.length > 0 ? "completed" : "observed",
        description: stringMeta(group.providerMeta, "description"),
        parentSessionId: stringMeta(group.providerMeta, "parentSessionId"),
        workerCount: workers.length,
        taskCount: tasks.length,
        activeTaskCount: activeTasks.length,
        completedTaskCount: completedTasks.length,
        lastActivityAt,
      });
    }
  }

  return rows.sort((left, right) => {
    const activeDelta = (right.activeTaskCount > 0 ? 1 : 0) - (left.activeTaskCount > 0 ? 1 : 0);
    if (activeDelta !== 0) return activeDelta;
    return (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0)
      || left.label.localeCompare(right.label);
  });
}

function classPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function harnessChipClass(harness: string): string {
  return `s-atop-chip s-atop-chip--harness s-atop-chip--harness-${classPart(harness)}`;
}

function shortSessionId(value: string | null | undefined): string {
  if (!value) return "—";
  const compact = value.replace(/^session[_:-]?/i, "");
  return compact.length > 10 ? compact.slice(0, 8) : compact;
}

function activeTaskFromAsks(asks: FleetAsk[]): string | null {
  if (asks.length === 0) return null;
  const statusRank: Record<FleetAsk["status"], number> = {
    working: 0,
    needs_attention: 1,
    queued: 2,
    failed: 3,
    completed: 4,
  };
  const top = [...asks].sort((a, b) => {
    const ranked = statusRank[a.status] - statusRank[b.status];
    if (ranked !== 0) return ranked;
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  })[0];
  return (top.summary ?? top.task ?? top.statusLabel ?? "").trim() || null;
}

function rowForAgentInventory(
  agent: Agent,
  session: SessionEntry | null,
  activeAsks: FleetAsk[],
): AgentInventoryRow {
  const status = normalizeAgentState(agent.state) as AgentInventoryStatus;
  const project = agent.project ?? basename(agent.projectRoot) ?? "Unscoped";
  const branch = agent.branch ?? "—";
  const harness = formatLabel(agent.harness) ?? formatLabel(agent.agentClass) ?? "agent";
  return {
    agent,
    status,
    stateLabel: agentStateLabel(agent.state),
    project,
    branch,
    harness,
    session,
    activeTask: activeTaskFromAsks(activeAsks),
    activeAskCount: activeAsks.length,
    lastActivityAt: Math.max(
      0,
      session?.lastMessageAt ?? 0,
      agent.updatedAt ?? 0,
    ) || null,
  };
}

function emptyProjectSlice(identity: ProjectIdentity): ProjectSlice {
  return {
    ...identity,
    agents: [],
    scoutSessions: [],
    nativeSessions: [],
    workflows: [],
    status: "not_ready",
    lastActivityAt: null,
  };
}

function ensureProjectSlice(
  map: Map<string, ProjectSlice>,
  identity: ProjectIdentity,
): ProjectSlice {
  const existing = map.get(identity.key);
  if (existing) {
    if (
      identity.root
      && (!existing.root || (isTemporaryProjectRoot(existing.root) && !isTemporaryProjectRoot(identity.root)))
    ) {
      existing.root = identity.root;
    }
    return existing;
  }
  const next = emptyProjectSlice(identity);
  map.set(identity.key, next);
  return next;
}

function updateProjectSliceSummary(project: ProjectSlice): void {
  const hasWorkingAgent = project.agents.some((row) => row.status === "working");
  const hasActiveNativeSession = project.nativeSessions.some((row) => row.status === "active");
  const hasActiveWorkflow = project.workflows.some((row) => row.activeTaskCount > 0 || row.status === "running");
  const hasReadyAgent = project.agents.some((row) => row.status === "ready");
  project.status = hasWorkingAgent || hasActiveNativeSession || hasActiveWorkflow
    ? "working"
    : hasReadyAgent
      ? "ready"
      : "not_ready";

  const agentActivity = project.agents.map((row) => row.lastActivityAt ?? 0);
  const scoutActivity = project.scoutSessions.map((session) => session.lastMessageAt ?? 0);
  const nativeActivity = project.nativeSessions.map((session) => session.lastActivityAt ?? 0);
  const workflowActivity = project.workflows.map((workflow) => workflow.lastActivityAt ?? 0);
  const latest = Math.max(0, ...agentActivity, ...scoutActivity, ...nativeActivity, ...workflowActivity);
  project.lastActivityAt = latest || null;
}

function buildProjectSlices(
  agentRows: AgentInventoryRow[],
  scoutSessions: SessionEntry[],
  nativeSessions: NativeSessionRow[],
  workflows: ProjectWorkflowRow[],
): ProjectSlice[] {
  const map = new Map<string, ProjectSlice>();
  const projectKeyByAgentId = new Map<string, string>();

  for (const row of agentRows) {
    const identity = projectIdentityForAgentRow(row);
    const project = ensureProjectSlice(map, identity);
    project.agents.push(row);
    projectKeyByAgentId.set(row.agent.id, identity.key);
  }

  for (const row of nativeSessions) {
    const project = ensureProjectSlice(map, projectIdentityForNativeSession(row));
    project.nativeSessions.push(row);
  }

  for (const row of workflows) {
    const project = ensureProjectSlice(map, projectIdentityForWorkflow(row));
    project.workflows.push(row);
  }

  const seenSessionIdsByProject = new Map<string, Set<string>>();
  for (const session of scoutSessions) {
    const agentKey = session.agentId ? projectKeyByAgentId.get(session.agentId) : undefined;
    const identity = agentKey
      ? map.get(agentKey) ?? null
      : session.workspaceRoot
        ? ensureProjectSlice(map, projectIdentityForScoutSession(session))
        : null;
    if (!identity) continue;

    const project = identity;
    const seen = seenSessionIdsByProject.get(project.key) ?? new Set<string>();
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    seenSessionIdsByProject.set(project.key, seen);
    project.scoutSessions.push(session);
  }

  for (const project of map.values()) {
    project.agents.sort((left, right) => {
      const statusDelta = AGENT_STATUS_RANK[left.status] - AGENT_STATUS_RANK[right.status];
      if (statusDelta !== 0) return statusDelta;
      return (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0)
        || left.agent.name.localeCompare(right.agent.name);
    });
    project.scoutSessions.sort((left, right) => (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0));
    project.nativeSessions.sort((left, right) => {
      const statusDelta = (left.status === "active" ? 0 : 1) - (right.status === "active" ? 0 : 1);
      if (statusDelta !== 0) return statusDelta;
      return (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0);
    });
    project.workflows.sort((left, right) => {
      const activeDelta = (right.activeTaskCount > 0 ? 1 : 0) - (left.activeTaskCount > 0 ? 1 : 0);
      if (activeDelta !== 0) return activeDelta;
      return (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0)
        || left.label.localeCompare(right.label);
    });
    updateProjectSliceSummary(project);
  }

  return [...map.values()].sort((left, right) => {
    const statusDelta = AGENT_STATUS_RANK[left.status] - AGENT_STATUS_RANK[right.status];
    if (statusDelta !== 0) return statusDelta;
    return (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0)
      || left.title.localeCompare(right.title);
  });
}

function scoutSessionNode(session: SessionEntry): ProjectTreeSessionNode {
  const harness = formatLabel(session.harness) ?? "scout";
  return {
    key: `scout:${session.id}`,
    kind: "scout",
    status: session.kind,
    harness,
    label: session.title || session.agentName || session.id,
    detail: session.preview ?? session.id,
    lastActivityAt: session.lastMessageAt,
    route: { view: "conversation", conversationId: session.id },
  };
}

function nativeSessionNode(session: NativeSessionRow): ProjectTreeSessionNode {
  return {
    key: `native:${session.key}`,
    kind: "native",
    status: session.status,
    harness: session.source,
    label: shortSessionId(session.sessionId ?? session.refId),
    detail: session.transcriptPath ?? session.process?.command ?? session.cwd,
    lastActivityAt: session.lastActivityAt,
    route: session.sessionId || session.transcriptPath
      ? { view: "sessions", sessionId: session.refId }
      : null,
  };
}

function workflowSessionNode(workflow: ProjectWorkflowRow): ProjectTreeSessionNode {
  const completed = workflow.taskCount > 0
    ? `${workflow.completedTaskCount}/${workflow.taskCount} tasks`
    : "workflow";
  const active = workflow.activeTaskCount > 0
    ? `${workflow.activeTaskCount} active`
    : completed;
  const traceDetail = workflow.parentSessionId
    ? `parent session ${shortSessionId(workflow.parentSessionId)}`
    : null;
  return {
    key: `workflow:${workflow.key}`,
    kind: "workflow",
    status: "workflow",
    harness: workflow.source,
    label: workflow.label,
    detail: workflow.description && traceDetail
      ? `${workflow.description} · ${traceDetail}`
      : workflow.description ?? (traceDetail ? `Claude workflow observed from ${traceDetail}` : `${workflow.workerCount} workers · ${active}`),
    subLabel: `${workflow.workerCount} workers · ${active}`,
    lastActivityAt: workflow.lastActivityAt,
    route: workflow.parentSessionId
      ? { view: "sessions", sessionId: workflow.parentSessionId }
      : null,
  };
}

function compareProjectTreeAgents(left: AgentInventoryRow, right: AgentInventoryRow): number {
  return left.agent.name.localeCompare(right.agent.name)
    || left.agent.id.localeCompare(right.agent.id);
}

function compareNullableText(left: string | null | undefined, right: string | null | undefined): number {
  return (left ?? "").localeCompare(right ?? "");
}

function compareNullableNumber(left: number | null | undefined, right: number | null | undefined): number {
  return (left ?? 0) - (right ?? 0);
}

function projectTreeAgentBranchValue(row: AgentInventoryRow): string {
  return row.branch !== "—"
    ? row.branch
    : basename(row.agent.cwd ?? row.agent.projectRoot) ?? "";
}

function projectTreeSessionStateRank(session: ProjectTreeSessionNode): number {
  if (session.kind === "workflow") return 0;
  if (session.status === "active") return 0;
  if (session.status === "direct") return 1;
  if (session.status === "idle") return 2;
  return 3;
}

function projectTreeDefaultDirection(key: ProjectTreeSortKey): 1 | -1 {
  return key === "last" || key === "sessions" ? -1 : 1;
}

function sortProjectTreeSessions(sessions: ProjectTreeSessionNode[]): ProjectTreeSessionNode[] {
  const kindRank: Record<ProjectTreeSessionKind, number> = {
    workflow: 0,
    native: 1,
    scout: 2,
  };
  return [...sessions].sort((left, right) => {
    const kindDelta = kindRank[left.kind] - kindRank[right.kind];
    if (kindDelta !== 0) return kindDelta;
    return left.harness.localeCompare(right.harness)
      || left.key.localeCompare(right.key);
  });
}

function showProjectLevelSessionInOverview(session: ProjectTreeSessionNode): boolean {
  return session.kind === "workflow" || (session.kind === "native" && session.status === "active");
}

function timeHorizonCutoff(horizon: TimeHorizonKey, now: number): number | null {
  switch (horizon) {
    case "1h":
      return now - 60 * 60 * 1000;
    case "24h":
      return now - 24 * 60 * 60 * 1000;
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "all":
      return null;
  }
}

function isWithinTimeHorizon(
  timestamp: number | null | undefined,
  horizon: TimeHorizonKey,
  now: number,
  keepActive = false,
): boolean {
  if (horizon === "all") return true;
  if (keepActive) return true;
  const cutoff = timeHorizonCutoff(horizon, now);
  return Boolean(cutoff !== null && timestamp && timestamp >= cutoff);
}

function compareProjectTreeSessions(
  left: ProjectTreeSessionNode,
  right: ProjectTreeSessionNode,
  sort: ProjectTreeSort,
): number {
  let result = 0;
  switch (sort.key) {
    case "target":
      result = compareNullableText(left.label, right.label);
      break;
    case "state":
      result = projectTreeSessionStateRank(left) - projectTreeSessionStateRank(right);
      break;
    case "harness":
      result = compareNullableText(left.harness, right.harness);
      break;
    case "branch":
      result = compareNullableText(left.kind, right.kind);
      break;
    case "sessions":
      result = 0;
      break;
    case "last":
      result = compareNullableNumber(left.lastActivityAt, right.lastActivityAt);
      break;
  }
  return result !== 0 ? result * sort.dir : sortProjectTreeSessions([left, right])[0] === left ? -1 : 1;
}

function compareProjectTreeAgentNodes(
  left: ProjectTreeAgentNode,
  right: ProjectTreeAgentNode,
  sort: ProjectTreeSort,
): number {
  let result = 0;
  switch (sort.key) {
    case "target":
      result = compareProjectTreeAgents(left.row, right.row);
      break;
    case "state":
      result = AGENT_STATUS_RANK[left.row.status] - AGENT_STATUS_RANK[right.row.status];
      break;
    case "harness":
      result = compareNullableText(left.row.harness, right.row.harness);
      break;
    case "branch":
      result = compareNullableText(projectTreeAgentBranchValue(left.row), projectTreeAgentBranchValue(right.row));
      break;
    case "sessions":
      result = left.sessions.length - right.sessions.length;
      break;
    case "last":
      result = compareNullableNumber(left.row.lastActivityAt, right.row.lastActivityAt);
      break;
  }
  return result !== 0 ? result * sort.dir : compareProjectTreeAgents(left.row, right.row);
}

function sortedProjectTree(tree: ProjectTree, sort: ProjectTreeSort): ProjectTree {
  return {
    agents: [...tree.agents]
      .sort((left, right) => compareProjectTreeAgentNodes(left, right, sort))
      .map((agent) => ({
        ...agent,
        sessions: [...agent.sessions].sort((left, right) =>
          compareProjectTreeSessions(left, right, sort),
        ),
      })),
    unassignedSessions: [...tree.unassignedSessions].sort((left, right) =>
      compareProjectTreeSessions(left, right, sort),
    ),
  };
}

function buildProjectTree(project: ProjectSlice): ProjectTree {
  const assignedScout = new Set<string>();
  const assignedNative = new Set<string>();

  const agents = [...project.agents].sort(compareProjectTreeAgents).map((row) => {
    const sessions: ProjectTreeSessionNode[] = [];

    for (const session of project.scoutSessions) {
      if (assignedScout.has(session.id)) continue;
      if (!scoutSessionMatchesAgent(session, row)) continue;
      assignedScout.add(session.id);
      sessions.push(scoutSessionNode(session));
    }

    for (const session of project.nativeSessions) {
      if (assignedNative.has(session.key)) continue;
      if (!nativeSessionMatchesAgent(session, row)) continue;
      assignedNative.add(session.key);
      sessions.push(nativeSessionNode(session));
    }

    return {
      key: row.agent.id,
      row,
      sessions: sortProjectTreeSessions(sessions),
    };
  });

  const unassignedSessions = sortProjectTreeSessions([
    ...project.nativeSessions
      .filter((session) => !assignedNative.has(session.key))
      .map(nativeSessionNode),
    ...project.scoutSessions
      .filter((session) => !assignedScout.has(session.id))
      .map(scoutSessionNode),
  ]);

  return { agents, unassignedSessions };
}

function collapsedProjectTreeStorageKey(projectKey: string): string {
  return `openscout.agents.projectTree.collapsed:${projectKey}`;
}

function projectTreeSortStorageKey(projectKey: string): string {
  return `openscout.agents.projectTree.sort:${projectKey}`;
}

function isProjectTreeSortKey(value: unknown): value is ProjectTreeSortKey {
  return value === "target"
    || value === "state"
    || value === "harness"
    || value === "branch"
    || value === "sessions"
    || value === "last";
}

function readProjectTreeSort(storageKey: string): ProjectTreeSort {
  if (typeof window === "undefined") return PROJECT_TREE_DEFAULT_SORT;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return PROJECT_TREE_DEFAULT_SORT;
    const parsed = JSON.parse(raw);
    if (
      parsed
      && typeof parsed === "object"
      && isProjectTreeSortKey((parsed as { key?: unknown }).key)
      && ((parsed as { dir?: unknown }).dir === 1 || (parsed as { dir?: unknown }).dir === -1)
    ) {
      return parsed as ProjectTreeSort;
    }
  } catch {
    return PROJECT_TREE_DEFAULT_SORT;
  }
  return PROJECT_TREE_DEFAULT_SORT;
}

function writeProjectTreeSort(storageKey: string, sort: ProjectTreeSort): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(sort));
  } catch {
    // Local persistence is best-effort; the tree still works without it.
  }
}

function readCollapsedProjectTreeRows(storageKey: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((value): value is string => typeof value === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeCollapsedProjectTreeRows(storageKey: string, rows: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (rows.size === 0) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, JSON.stringify([...rows]));
    }
  } catch {
    // Local persistence is best-effort; the tree still works without it.
  }
}

function AgentInventoryStatusCell({ row }: { row: AgentInventoryRow }) {
  return (
    <span className={`s-agents-inventory-status s-agents-inventory-status--${agentInventoryStatusClass(row.status)}`}>
      <span className="s-agents-inventory-status-dot" />
      {row.stateLabel.toLowerCase()}
    </span>
  );
}

function AgentInventoryAgentCell({ row }: { row: AgentInventoryRow }) {
  return (
    <span className="s-agents-inventory-agent-cell">
      <span className="s-agents-inventory-agent-name">{row.agent.name}</span>
      <span className="s-agents-inventory-agent-id">
        {row.agent.handle ? `@${row.agent.handle}` : row.agent.id}
      </span>
    </span>
  );
}

function AgentInventoryTaskCell({ row }: { row: AgentInventoryRow }) {
  const preview = row.activeTask ?? row.session?.preview ?? row.stateLabel;
  return (
    <span
      className={`s-agents-inventory-task${row.activeTask ? "" : " s-agents-inventory-task--dim"}`}
      title={preview}
    >
      {preview}
    </span>
  );
}

const AGENT_INVENTORY_COLUMNS: DataTableColumn<AgentInventoryRow, AgentInventoryColumnKey>[] = [
  {
    key: "status",
    label: "Status",
    cls: "s-agents-inventory-col-status",
    kind: "text",
    defaultWidth: 108,
    minWidth: 82,
    sortValue: (row) => AGENT_STATUS_RANK[row.status],
    render: (row) => <AgentInventoryStatusCell row={row} />,
  },
  {
    key: "agent",
    label: "Agent",
    cls: "s-agents-inventory-col-agent",
    kind: "text",
    defaultWidth: 230,
    minWidth: 150,
    sortValue: (row) => row.agent.name.toLowerCase(),
    render: (row) => <AgentInventoryAgentCell row={row} />,
  },
  {
    key: "project",
    label: "Project",
    cls: "s-atop-col-project",
    kind: "text",
    defaultWidth: 176,
    minWidth: 96,
    maxWidth: 420,
    sortValue: (row) => row.project.toLowerCase(),
    render: (row) => <span title={row.agent.projectRoot ?? undefined}>{row.project}</span>,
  },
  {
    key: "task",
    label: "Current signal",
    cls: "s-agents-inventory-col-task",
    kind: "text",
    defaultWidth: 340,
    minWidth: 160,
    maxWidth: 640,
    sortValue: (row) => (row.activeTask ?? row.session?.preview ?? "").toLowerCase() || null,
    render: (row) => <AgentInventoryTaskCell row={row} />,
  },
  {
    key: "harness",
    label: "Harness",
    cls: "s-agents-inventory-col-harness",
    kind: "text",
    defaultWidth: 104,
    minWidth: 76,
    sortValue: (row) => row.harness.toLowerCase(),
    render: (row) => (
      <span className={harnessChipClass(row.harness)}>{row.harness}</span>
    ),
  },
  {
    key: "branch",
    label: "Branch",
    cls: "s-agents-inventory-col-branch",
    kind: "text",
    defaultWidth: 132,
    minWidth: 82,
    maxWidth: 260,
    sortValue: (row) => row.branch === "—" ? null : row.branch.toLowerCase(),
    render: (row) => <span title={row.agent.branch ?? undefined}>{row.branch}</span>,
  },
  {
    key: "active",
    label: "Active",
    cls: "s-atop-col-num",
    kind: "number",
    defaultWidth: 70,
    minWidth: 58,
    sortValue: (row) => row.activeAskCount,
    render: (row) => (
      <span className={row.activeAskCount > 0 ? "s-atop-col-num s-atop-col-num--green" : "s-atop-col-num s-atop-col-num--dim"}>
        {row.activeAskCount || "—"}
      </span>
    ),
  },
  {
    key: "session",
    label: "Session",
    cls: "s-agents-inventory-col-session",
    kind: "text",
    defaultWidth: 96,
    minWidth: 74,
    sortValue: (row) => row.session?.lastMessageAt ?? null,
    render: (row) => (
      <span title={row.session?.id ?? row.agent.harnessSessionId ?? undefined}>
        {shortSessionId(row.session?.id ?? row.agent.harnessSessionId)}
      </span>
    ),
  },
  {
    key: "last",
    label: "Last",
    cls: "s-atop-col-last",
    kind: "time",
    defaultWidth: 82,
    minWidth: 64,
    sortValue: (row) => row.lastActivityAt,
    render: (row) => row.lastActivityAt ? timeAgo(row.lastActivityAt) : "—",
  },
];

function agentInventoryRowMatchesQuery(row: AgentInventoryRow, query: string): boolean {
  if (!query) return true;
  const hay = [
    row.agent.name,
    row.agent.handle,
    row.agent.id,
    row.agent.selector,
    row.agent.defaultSelector,
    row.project,
    row.agent.projectRoot,
    row.branch,
    row.harness,
    row.activeTask,
    row.session?.preview,
    row.session?.id,
    row.agent.harnessSessionId,
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(query);
}

function nativeSessionMatchesFilters(
  row: NativeSessionRow,
  query: string,
  harnessFilter: Set<string>,
): boolean {
  if (harnessFilter.size > 0 && !harnessFilter.has(row.source)) return false;
  if (!query) return true;
  const hay = [
    row.refId,
    row.sessionId,
    row.source,
    row.project,
    row.cwd,
    row.transcriptPath,
    row.process?.command,
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(query);
}

function scoutSessionMatchesFilters(
  session: SessionEntry,
  query: string,
  harnessFilter: Set<string>,
): boolean {
  const harness = formatLabel(session.harness) ?? "scout";
  if (harnessFilter.size > 0 && !harnessFilter.has(harness)) return false;
  if (!query) return true;
  const hay = [
    session.id,
    session.kind,
    session.title,
    session.agentName,
    session.harness,
    session.harnessSessionId,
    session.currentBranch,
    session.preview,
    session.workspaceRoot,
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(query);
}

function workflowMatchesFilters(
  row: ProjectWorkflowRow,
  query: string,
  harnessFilter: Set<string>,
): boolean {
  if (harnessFilter.size > 0 && !harnessFilter.has(row.source)) return false;
  if (!query) return true;
  const hay = [
    row.label,
    row.source,
    row.status,
    row.description,
    row.project.title,
    row.project.root,
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(query);
}

function resolveSelectedAgent(agents: Agent[], selectedAgentId?: string): Agent | null {
  if (!selectedAgentId) return null;

  const normalized = selectedAgentId.trim().replace(/^@+/, "");
  if (!normalized) return null;

  const exact = agents.find((a) => a.id === normalized);
  if (exact) return exact;

  const segments = normalized.split(".").filter(Boolean);
  if (segments.length >= 3) return null;

  const candidates = agents.filter((agent) =>
    agent.handle === normalized ||
    agent.selector === `@${normalized}` ||
    agent.defaultSelector === `@${normalized}` ||
    agent.id.startsWith(`${normalized}.`)
  );
  const uniqueCandidates = Array.from(
    new Map(candidates.map((agent) => [agent.id, agent])).values(),
  );

  return uniqueCandidates.length === 1 ? uniqueCandidates[0]! : null;
}


function SessionFacet({ catalog, agentId }: { catalog: SessionCatalogWithResume; agentId: string }) {
  const { navigate, route } = useScout();
  const [sent, setSent] = useState(false);
  const shortId = catalog.activeSessionId?.slice(0, 8) ?? null;
  const active = catalog.sessions.find((s) => s.id === catalog.activeSessionId);

  const runTakeover = () => {
    if (!catalog.resumeCommand) return;
    void queueTakeover({
      command: catalog.resumeCommand,
      cwd: catalog.resumeCwd,
      agentId,
    }).then(() =>
      openContent(navigate, { view: "terminal", agentId }, { returnTo: route }),
    );
    setSent(true);
  };

  const openPair = () => {
    navigate({
      view: "messages",
      conversationId: conversationForAgent(agentId),
    });
  };

  return (
    <div className="s-profile-facet">
      <div className="s-profile-facet-label">Session</div>
      <div className="s-profile-facet-value s-profile-facet-value--mono" title={catalog.activeSessionId ?? undefined}>
        {shortId}
        <button
          type="button"
          className="s-profile-facet-action s-profile-facet-action--pair"
          onClick={openPair}
          title="Send messages into the live session without taking the terminal"
        >
          Pair
        </button>
        {catalog.resumeCommand && (
          <button
            type="button"
            className="s-profile-facet-action"
            onClick={runTakeover}
            title={catalog.resumeCommand}
          >
            {sent ? "Going…" : "Takeover"}
          </button>
        )}
        <VantageHandoffButton
          agentId={agentId}
          className="s-profile-facet-action s-profile-facet-action--vantage"
          statusClassName="s-profile-facet-handoff"
        />
      </div>
      {active && (
        <div className="s-profile-facet-detail">
          {catalog.sessions.length} session{catalog.sessions.length !== 1 ? "s" : ""} · started {timeAgo(active.startedAt)}
        </div>
      )}
    </div>
  );
}

function formatContextAge(ms: number | null): string {
  if (ms === null) return "age unknown";
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m old` : `${hours}h old`;
}

function contextLoadPercent(context: LocalAgentContextState): number {
  const turnRatio = context.policy.maxTurns > 0
    ? context.turnCount / context.policy.maxTurns
    : 0;
  return Math.max(0, Math.min(100, Math.round(turnRatio * 100)));
}

function contextTurnLabel(context: LocalAgentContextState): string {
  if (context.policy.maxTurns <= 0) {
    return `${context.turnCount} turn${context.turnCount === 1 ? "" : "s"}`;
  }
  return `${context.turnCount} / ${context.policy.maxTurns} turns`;
}

function formatContextLastActivity(
  lastActivityAt: number | null,
  sessionAgeMs: number | null,
): string {
  if (lastActivityAt) {
    const age = timeAgo(lastActivityAt);
    return age === "now" ? "last activity now" : `last activity ${age} ago`;
  }
  if (sessionAgeMs !== null) {
    return `session ${formatContextAge(sessionAgeMs)}`;
  }
  return "last activity unknown";
}

function ContextFacet({
  context,
  lastActivityAt,
  resetting,
  onReset,
}: {
  context: LocalAgentContextState;
  lastActivityAt: number | null;
  resetting: boolean;
  onReset: () => void;
}) {
  const percent = contextLoadPercent(context);
  const turns = contextTurnLabel(context);
  const lastActivity = formatContextLastActivity(
    lastActivityAt,
    context.sessionAgeMs,
  );
  const resetDisabled = resetting || context.currentTurnActive;
  return (
    <div className="s-profile-facet s-profile-context">
      <div className="s-profile-facet-label">Context</div>
      <div className="s-profile-context-head">
        <span className="s-profile-context-metric">{percent}% used</span>
        <button
          type="button"
          className="s-profile-facet-action"
          disabled={resetDisabled}
          onClick={onReset}
          title={context.currentTurnActive ? "Agent is currently working" : "Start a fresh session"}
        >
          {resetting ? "Starting..." : "New"}
        </button>
      </div>
      <div className="s-profile-context-gauge" aria-label={`Context load ${percent}%`}>
        <div className="s-profile-context-gauge-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="s-profile-facet-detail" title={`${turns} · ${lastActivity}`}>
        {turns} · {lastActivity}
      </div>
    </div>
  );
}

function AgentActivityFeed({
  agent,
  fleet,
  navigate,
}: {
  agent: Agent;
  fleet: FleetState | null;
  navigate: (r: Route) => void;
}) {
  const agentActivity = useMemo(() => {
    if (!fleet) return [];
    return fleet.activity
      .filter((a) => a.agentId === agent.id || a.actorId === agent.id)
      .slice(0, 6);
  }, [fleet, agent.id]);

  const agentCompletedAsks = useMemo(() => {
    if (!fleet) return [];
    return fleet.recentCompleted
      .filter((a) => a.agentId === agent.id)
      .slice(0, 4);
  }, [fleet, agent.id]);

  if (agentActivity.length === 0 && agentCompletedAsks.length === 0) {
    return null;
  }

  return (
    <>
      <SectionRule label="Activity" />
      <div className="s-profile-work">
        <div className="s-profile-activity-feed">
          {agentCompletedAsks.map((ask) => (
            <div
              key={ask.invocationId}
              className="s-profile-activity-row"
              onClick={() => {
                if (ask.conversationId) {
                  navigate({
                    view: "agents",
                    agentId: agent.id,
                    conversationId: ask.conversationId,
                  });
                }
              }}
            >
              <div className="s-profile-activity-dot s-profile-activity-dot--done" />
              <div className="s-profile-activity-body">
                <div className="s-profile-activity-title">
                  {ask.summary ?? ask.task}
                </div>
                <div className="s-profile-activity-meta">
                  {ask.status === "completed" ? "completed" : ask.status}
                  {ask.completedAt && ` · ${timeAgo(ask.completedAt)}`}
                </div>
              </div>
            </div>
          ))}
          {agentActivity.map((item) => (
            <div
              key={item.id}
              className="s-profile-activity-row"
              onClick={() => {
                if (item.conversationId) {
                  navigate({
                    view: "agents",
                    agentId: agent.id,
                    conversationId: item.conversationId,
                  });
                }
              }}
            >
              <div className="s-profile-activity-dot" />
              <div className="s-profile-activity-body">
                <div className="s-profile-activity-title">
                  {item.title ?? item.summary ?? item.kind}
                </div>
                <div className="s-profile-activity-meta">
                  {item.kind.replace(/_/g, " ")}
                  {item.actorName && ` · ${item.actorName}`}
                  {` · ${timeAgo(item.ts)}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function SectionRule({
  label,
  right,
  rightClassName,
}: {
  label: string;
  right?: string;
  rightClassName?: string;
}) {
  return (
    <div className="s-profile-section-rule">
      <span className="s-profile-section-rule-label">{label}</span>
      <span className="s-profile-section-rule-line" />
      {right && (
        <span
          className={`s-profile-section-rule-right${rightClassName ? ` ${rightClassName}` : ""}`}
        >
          {right}
        </span>
      )}
    </div>
  );
}

function SignalFeed({
  messages,
  navigate,
  conversationId,
  agentId,
}: {
  messages: Message[];
  navigate: (r: Route) => void;
  conversationId: string | null;
  agentId: string;
}) {
  const recent = messages.slice(-8).reverse();

  if (recent.length === 0) return null;

  return (
    <div className="s-profile-signals">
      <SectionRule label="Recent signal" right="last 1h" />
      <div className="s-profile-signal-list">
        {recent.map((msg) => {
          const isAsk = msg.class === "ask" || msg.body?.toLowerCase().startsWith("@");
          const kindLabel = isAsk ? "ASK" : "MESSAGE";
          return (
            <div
              key={msg.id}
              className="s-profile-signal"
              onClick={() => {
                if (conversationId) {
                  navigate({
                    view: "agents",
                    agentId,
                    conversationId,
                  });
                }
              }}
            >
              <div
                className="s-profile-signal-avatar"
                style={{ background: actorColor(msg.actorName ?? "?") }}
              >
                {(msg.actorName ?? "?")[0].toUpperCase()}
              </div>
              <div className="s-profile-signal-body">
                <div className="s-profile-signal-header">
                  <span className="s-profile-signal-kind">{kindLabel}</span>
                  <span className="s-profile-signal-sep">&middot;</span>
                  <span className="s-profile-signal-routing">
                    {msg.actorName}
                  </span>
                  <span className="s-profile-signal-time">
                    {timeAgo(msg.createdAt)}
                  </span>
                </div>
                <div className="s-profile-signal-text">{msg.body}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentDetailWithRail({
  agent,
  allAgents,
  session,
  conversationId,
  navigate,
  activeTab,
}: {
  agent: Agent;
  allAgents: Agent[];
  session: SessionEntry | null;
  conversationId: string | null;
  navigate: (r: Route) => void;
  activeTab: AgentTab;
}) {
  const { name, qualifier } = agentLabel(agent, allAgents);
  const [work, setWork] = useState<WorkItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [observe, setObserve] = useState<AgentObservePayload | null>(null);
  const [observeLoading, setObserveLoading] = useState(false);
  const [sessionCatalog, setSessionCatalog] = useState<SessionCatalogWithResume | null>(null);
  const [contextState, setContextState] = useState<LocalAgentContextState | null>(null);
  const [resettingContext, setResettingContext] = useState(false);
  const [dismissingWorkId, setDismissingWorkId] = useState<string | null>(null);
  const state = normalizeAgentState(agent.state);
  const showContextMenu = useContextMenu();
  const { route } = useScout();

  const load = useCallback(async () => {
    const [workResult, fleetResult] = await Promise.allSettled([
      api<WorkItem[]>(`/api/work?agentId=${encodeURIComponent(agent.id)}&active=false&limit=12`),
      api<FleetState>("/api/fleet"),
    ]);
    if (workResult.status === "fulfilled") setWork(workResult.value);
    if (fleetResult.status === "fulfilled") setFleet(fleetResult.value);
  }, [agent.id]);

  const dismissWorkAttention = useCallback(async (item: WorkItem) => {
    setDismissingWorkId(item.id);
    try {
      await dismissOperatorAttention({
        recordKind: "work_item",
        recordId: item.id,
        itemUpdatedAt: item.updatedAt,
      });
      await load();
    } finally {
      setDismissingWorkId(null);
    }
  }, [load]);

  const loadMessages = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    try {
      const result = await api<Message[]>(
        `/api/messages?conversationId=${encodeURIComponent(conversationId)}&limit=20`,
      );
      setMessages(result);
    } catch {
      setMessages([]);
    }
  }, [conversationId]);

  const loadObserve = useCallback(async () => {
    setObserveLoading(true);
    try {
      const result = await api<AgentObservePayload>(
        `/api/agents/${encodeURIComponent(agent.id)}/observe`,
      );
      setObserve(result);
    } catch {
      setObserve({
        agentId: agent.id,
        source: "unavailable",
        fidelity: "synthetic",
        historyPath: null,
        sessionId: null,
        updatedAt: Date.now(),
        data: {
          events: [
            {
              id: `${agent.id}:observe-error`,
              t: 0,
              kind: "system",
              text: "Observer data is temporarily unavailable.",
              detail: "Retrying will resume once the session source becomes reachable.",
            },
          ],
          files: [],
          contextUsage: [],
          live: false,
        },
      });
    } finally {
      setObserveLoading(false);
    }
  }, [agent.id]);

  const loadContextState = useCallback(async () => {
    if (!agent.transport) {
      setContextState(null);
      return;
    }
    try {
      const result = await api<LocalAgentContextState>(
        `/api/agents/${encodeURIComponent(agent.id)}/session/context`,
      );
      setContextState(result);
    } catch {
      setContextState(null);
    }
  }, [agent.id, agent.transport]);

  const resetAgentContext = useCallback(async () => {
    setResettingContext(true);
    try {
      const result = await api<{ ok: boolean; catalog: SessionCatalogWithResume }>(
        `/api/agents/${encodeURIComponent(agent.id)}/session/reset`,
        { method: "POST" },
      );
      setSessionCatalog(result.catalog);
      await loadContextState();
      if (activeTab === "observe") {
        await loadObserve();
      }
    } catch {
      await loadContextState();
    } finally {
      setResettingContext(false);
    }
  }, [activeTab, agent.id, loadContextState, loadObserve]);

  useEffect(() => {
    void load();
    void loadMessages();
    void loadContextState();
    api<SessionCatalogWithResume>(`/api/agents/${encodeURIComponent(agent.id)}/session-catalog`)
      .then(setSessionCatalog)
      .catch(() => {});
  }, [load, loadMessages, loadContextState, agent.id]);

  useEffect(() => {
    setObserve(null);
    setObserveLoading(false);
    setContextState(null);
  }, [agent.id]);

  useEffect(() => {
    if (activeTab !== "observe") {
      return;
    }
    void loadObserve();
  }, [activeTab, loadObserve]);

  useBrokerEvents(() => {
    void load();
    void loadMessages();
    void loadContextState();
    if (activeTab === "observe") {
      void loadObserve();
    }
  });

  useEffect(() => {
    if (activeTab !== "observe" || !observe?.data.live) {
      return;
    }
    const timer = setInterval(() => {
      void loadObserve();
    }, 2500);
    return () => clearInterval(timer);
  }, [activeTab, observe?.data.live, loadObserve]);

  const currentWork = work.find(
    (w) => w.state === "working" || w.state === "review",
  );
  const activeWork = work.filter(
    (w) =>
      (w.state === "working" || w.state === "review" || w.state === "waiting") &&
      w.id !== currentWork?.id,
  );
  const recentDone = work.filter((w) => w.state === "done").slice(0, 5);

  const roleLabel = formatLabel(agent.role) ?? formatLabel(agent.agentClass);
  const harnessLabel = agent.harness;
  const machineLabel = agent.authorityNodeName
    ?? agent.homeNodeName
    ?? agent.authorityNodeId
    ?? agent.homeNodeId;
  const machineDetail = agent.authorityNodeId && agent.homeNodeId && agent.authorityNodeId !== agent.homeNodeId
    ? `home ${agent.homeNodeName ?? agent.homeNodeId}`
    : null;
  const selectorLabel = primaryAgentSelector(agent);
  const authorityLabel = agent.authorityNodeName && agent.authorityNodeId
    ? `${agent.authorityNodeName} (${agent.authorityNodeId})`
    : agent.authorityNodeName ?? agent.authorityNodeId;
  const homeLabel = agent.homeNodeName && agent.homeNodeId
    ? `${agent.homeNodeName} (${agent.homeNodeId})`
    : agent.homeNodeName ?? agent.homeNodeId;
  const qualifierParts = [
    agent.workspaceQualifier ? `workspace ${agent.workspaceQualifier}` : null,
    agent.nodeQualifier ? `node ${agent.nodeQualifier}` : null,
  ].filter(Boolean);
  const eyebrowParts = [roleLabel, harnessLabel]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  const teammateCount = useMemo(
    () => allAgents.filter((a) => a.project === agent.project).length,
    [allAgents, agent.project],
  );

  const taskProgress = currentWork?.currentPhase === "review"
    ? 85
    : currentWork?.currentPhase === "working"
      ? 50
      : 20;
  const currentWorkAgeMs = currentWork ? Date.now() - currentWork.lastMeaningfulAt : 0;
  const currentWorkIsStale = currentWorkAgeMs > 30 * 60_000;
  const currentTaskStatus = currentWork
    ? currentWorkIsStale
      ? `no recent signal · ${timeAgo(currentWork.lastMeaningfulAt)}`
      : `${taskProgress}% · live`
    : "";

  const tabs: { key: AgentTab; label: string; disabled?: boolean }[] = [
    { key: "profile", label: "Profile" },
    { key: "observe", label: "Observe" },
    { key: "message", label: "Message", disabled: !conversationId },
  ];

  const navigateToTab = (tab: AgentTab) => {
    navigate({
      view: "agents",
      agentId: agent.id,
      ...(conversationId ? { conversationId } : {}),
      tab,
    });
  };

  const renderTabs = (className = "") => (
    <nav className={`s-profile-tabs${className ? ` ${className}` : ""}`}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`s-profile-tab${activeTab === t.key ? " s-profile-tab--active" : ""}`}
          disabled={t.disabled}
          onClick={() => navigateToTab(t.key)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );

  return (
    <div className={`s-profile-center${activeTab !== "profile" ? " s-profile-center--tabbed" : ""}`}>
      <div className="s-profile-return-row">
        <BackToPicker
          slot="agents"
          fallback={{ view: "agents" }}
          navigate={navigate}
          className="s-profile-back-position"
        />
      </div>


      {activeTab === "profile" ? (
        <section
          className="s-profile-identity"
          onContextMenu={(e) => {
            const sel = window.getSelection()?.toString().trim();
            const items: MenuItem[] = [];
            if (sel) {
              items.push({
                kind: "action",
                label: "Copy Selection",
                shortcut: "⌘C",
                onSelect: () => {
                  void copyTextToClipboard(sel);
                },
              });
              items.push({ kind: "separator" });
            }
            items.push({
              kind: "action",
              label: "Copy Agent Name",
              onSelect: () => {
                void copyTextToClipboard(name);
              },
            });
            items.push({
              kind: "action",
              label: "Copy Agent ID",
              onSelect: () => {
                void copyTextToClipboard(agent.id);
              },
            });
            if (agent.handle) {
              items.push({
                kind: "action",
                label: `Copy @${agent.handle}`,
                onSelect: () => {
                  void copyTextToClipboard(`@${agent.handle}`);
                },
              });
            }
            if (agent.selector) {
              items.push({
                kind: "action",
                label: "Copy Selector",
                onSelect: () => {
                  void copyTextToClipboard(agent.selector ?? "");
                },
              });
            }
            if (agent.defaultSelector && agent.defaultSelector !== agent.selector) {
              items.push({
                kind: "action",
                label: "Copy Default Selector",
                onSelect: () => {
                  void copyTextToClipboard(agent.defaultSelector ?? "");
                },
              });
            }
            showContextMenu(e, items);
          }}
        >
          <div className="s-profile-identity-top">
            <div className="s-profile-identity-avatar-wrap">
              <div
                className="s-profile-identity-avatar"
                style={{ background: actorColor(agent.name) }}
              >
                {agent.name[0].toUpperCase()}
              </div>
              <span
                className={`s-profile-identity-pulse s-profile-identity-pulse--${agentStateCssToken(state)}`}
                style={{ background: stateColor(agent.state) }}
              />
            </div>
            <div className="s-profile-identity-copy">
              {eyebrowParts.length > 0 && (
                <div className="s-profile-identity-eyebrow">
                  {eyebrowParts.join(" · ")}
                </div>
              )}
              <h1 className="s-profile-identity-name">
                {name}
                {qualifier && (
                  <span className="s-profile-identity-name-qualifier">
                    {qualifier}
                  </span>
                )}
                {agent.handle && (
                  <span className="s-profile-identity-name-handle">
                    @{agent.handle}
                  </span>
                )}
              </h1>
              <div className="s-profile-identity-state-row">
                <span className="s-profile-identity-state">
                  <span
                    className={`s-profile-identity-state-dot${state === "working" ? " s-profile-identity-state-dot--pulse" : ""}`}
                    style={{ background: stateColor(agent.state) }}
                  />
                  <span className="s-profile-identity-state-label">
                    {agentStateLabel(agent.state)}
                  </span>
                  {agent.updatedAt && (
                    <span className="s-profile-identity-state-detail">
                      &mdash; {timeAgo(agent.updatedAt)}
                    </span>
                  )}
                  {agent.staleLocalRegistration && (
                    <span className="s-profile-identity-state-detail">
                      superseded registration
                    </span>
                  )}
                </span>
              </div>
              <div className="s-profile-identity-qualified">
                <span>{agent.id}</span>
                {selectorLabel && <span>{selectorLabel}</span>}
                {agent.defaultSelector && agent.defaultSelector !== selectorLabel && (
                  <span>{agent.defaultSelector}</span>
                )}
              </div>
              <AgentLiveActions
                agent={agent}
                catalog={sessionCatalog}
                navigate={navigate}
                returnTo={route}
                variant="inline"
              />
            </div>
            {renderTabs()}
          </div>
        </section>
      ) : (
        <div className="s-profile-compact-tabs">
          {renderTabs("s-profile-tabs--compact")}
        </div>
      )}

      {activeTab === "profile" && (
        <div className="s-profile-tab-content">
          {(agent.id || selectorLabel || machineLabel || agent.project || agent.branch || agent.cwd || sessionCatalog?.activeSessionId || contextState) && (
            <div className="s-profile-facets">
              <div className="s-profile-facet s-profile-facet--identity">
                <div className="s-profile-facet-label">Agent ID</div>
                <div className="s-profile-facet-value s-profile-facet-value--mono">{agent.id}</div>
                <div className="s-profile-facet-detail">
                  definition {agent.definitionId}
                </div>
              </div>
              {selectorLabel && (
                <div className="s-profile-facet">
                  <div className="s-profile-facet-label">Selector</div>
                  <div className="s-profile-facet-value s-profile-facet-value--mono">{selectorLabel}</div>
                  {agent.defaultSelector && agent.defaultSelector !== selectorLabel && (
                    <div className="s-profile-facet-detail">
                      default {agent.defaultSelector}
                    </div>
                  )}
                </div>
              )}
              {(qualifierParts.length > 0 || authorityLabel || homeLabel) && (
                <div className="s-profile-facet">
                  <div className="s-profile-facet-label">Authority</div>
                  <div className="s-profile-facet-value">{authorityLabel ?? machineLabel ?? "local"}</div>
                  <div className="s-profile-facet-detail">
                    {qualifierParts.length > 0
                      ? qualifierParts.join(" · ")
                      : homeLabel && homeLabel !== authorityLabel
                        ? `home ${homeLabel}`
                        : "qualified route"}
                  </div>
                </div>
              )}
              {machineLabel && (
                <div className="s-profile-facet">
                  <div className="s-profile-facet-label">Machine</div>
                  <div className="s-profile-facet-value">{machineLabel}</div>
                  {machineDetail && (
                    <div className="s-profile-facet-detail">{machineDetail}</div>
                  )}
                </div>
              )}
              {agent.project && (
                <div className="s-profile-facet">
                  <div className="s-profile-facet-label">Workspace</div>
                  <div className="s-profile-facet-value">{agent.project}</div>
                  {teammateCount > 1 && (
                    <div className="s-profile-facet-detail">
                      {teammateCount} teammates
                    </div>
                  )}
                </div>
              )}
              {(agent.branch || agent.projectRoot) && (
                <div className="s-profile-facet">
                  <div className="s-profile-facet-label">Repo / Branch</div>
                  <div className="s-profile-facet-value">
                    {agent.projectRoot
                      ? agent.projectRoot.split("/").pop()
                      : agent.project ?? "—"}
                  </div>
                  {agent.branch && (
                    <div className="s-profile-facet-detail">
                      <span className="s-profile-facet-accent">⎇</span> {agent.branch}
                    </div>
                  )}
                </div>
              )}
              {agent.cwd && (
                <div className="s-profile-facet">
                  <div className="s-profile-facet-label">Working Dir</div>
                  <div className="s-profile-facet-value">
                    {agent.cwd.startsWith("/Users/")
                      ? "~/" + agent.cwd.split("/").slice(3).join("/")
                      : agent.cwd}
                  </div>
                  {agent.updatedAt && (
                    <div className="s-profile-facet-detail">
                      uptime {timeAgo(agent.updatedAt)}
                    </div>
                  )}
                </div>
              )}
              {sessionCatalog?.activeSessionId && (
                <SessionFacet catalog={sessionCatalog} agentId={agent.id} />
              )}
              {contextState && (
                <ContextFacet
                  context={contextState}
                  lastActivityAt={agent.updatedAt ?? null}
                  resetting={resettingContext}
                  onReset={() => void resetAgentContext()}
                />
              )}
            </div>
          )}
          {currentWork && state === "working" && (
            <>
              <SectionRule
                label="Current task"
                right={currentTaskStatus}
              />
              <div className="s-profile-task">
                <div className="s-profile-task-title">{currentWork.title}</div>
                {currentWork.lastMeaningfulSummary && (
                  <>
                    <div className="s-profile-task-progress">
                      <div
                        className="s-profile-task-progress-bar"
                        style={{ width: `${taskProgress}%` }}
                      />
                    </div>
                    <div className="s-profile-task-action">
                      <span className="s-profile-task-action-chevron">
                        &rsaquo;
                      </span>
                      <span>{currentWork.lastMeaningfulSummary}</span>
                      <span className="s-profile-task-cursor" />
                    </div>
                  </>
                )}
                <div className="s-profile-task-meta">
                  <span>{currentWork.currentPhase}</span>
                  <span>{timeAgo(currentWork.lastMeaningfulAt)}</span>
                </div>
                <div className="s-profile-task-controls" aria-label="Current task actions">
                  <button
                    type="button"
                    className="s-profile-task-btn s-profile-task-btn--primary"
                    onClick={() =>
                      openContent(
                        navigate,
                        { view: "work", workId: currentWork.id },
                        { returnTo: route },
                      )}
                  >
                    Open work
                  </button>
                  <button
                    type="button"
                    className="s-profile-task-btn"
                    onClick={() => navigateToTab("observe")}
                  >
                    Observe
                  </button>
                  {conversationId && (
                    <button
                      type="button"
                      className="s-profile-task-btn"
                      onClick={() => navigateToTab("message")}
                    >
                      Message
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {activeWork.length > 0 && (
            <>
              <SectionRule
                label="Active work"
                right={`${activeWork.length} in flight`}
              />
              <div className="s-profile-work">
                <WorkList
                  items={activeWork}
                  navigate={navigate}
                  emptyTitle="Nothing in flight"
                  onDismissAttention={(item) => void dismissWorkAttention(item)}
                  dismissingId={dismissingWorkId}
                />
              </div>
            </>
          )}

          {recentDone.length > 0 && (
            <>
              <SectionRule
                label={activeWork.length > 0 ? "Recently completed" : "Recent work"}
                right={`${recentDone.length}`}
              />
              <div className="s-profile-work">
                <WorkList
                  items={recentDone}
                  navigate={navigate}
                  emptyTitle=""
                />
              </div>
            </>
          )}

          <AgentActivityFeed
            agent={agent}
            fleet={fleet}
            navigate={navigate}
          />

          <SignalFeed
            messages={messages}
            navigate={navigate}
            conversationId={conversationId}
            agentId={agent.id}
          />
        </div>
      )}

      {activeTab === "observe" && (
        <div className="s-profile-tab-conversation">
          {observeLoading && !observe ? (
            <div className="s-profile-activity-empty">
              <div className="s-profile-activity-empty-title">Loading trace</div>
              <div className="s-profile-activity-empty-detail">
                Resolving the best available live or history-backed session stream for this agent.
              </div>
            </div>
          ) : (
            <SessionObserve
              data={observe?.data}
              agentId={agent.id}
              sessionId={observe?.sessionId}
              showRail={false}
            />
          )}
        </div>
      )}

      {activeTab === "message" && conversationId && (
        <div className="s-profile-tab-conversation">
          <ConversationScreen
            conversationId={conversationId}
            navigate={navigate}
            embedded
          />
        </div>
      )}
    </div>
  );
}

export function AgentsScreen({
  navigate,
  selectedAgentId,
  conversationId: activeConversationId,
  tab: activeTab,
  activeRoute,
}: {
  navigate: (r: Route) => void;
  selectedAgentId?: string;
  conversationId?: string;
  tab?: AgentTab;
  activeRoute?: Route;
}) {
  const { agents, route } = useScout();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [discovery, setDiscovery] = useState<TailDiscoverySnapshot | null>(null);
  const [topologySnapshot, setTopologySnapshot] = useState<HarnessTopologySnapshot | null>(null);
  const machineId = routeMachineId(route);
  const scopedAgents = useMemo(
    () => filterAgentsByMachineScope(agents, machineId),
    [agents, machineId],
  );

  const load = useCallback(async () => {
    const [sessionsResult, fleetResult, discoveryResult, topologyResult] = await Promise.allSettled([
      api<SessionEntry[]>("/api/conversations"),
      api<FleetState>("/api/fleet"),
      api<TailDiscoverySnapshot>("/api/tail/discover"),
      api<HarnessTopologySnapshot>("/api/topology/snapshot?force=1"),
    ]);
    if (sessionsResult.status === "fulfilled") setSessions(sessionsResult.value);
    if (fleetResult.status === "fulfilled") setFleet(fleetResult.value);
    if (discoveryResult.status === "fulfilled") setDiscovery(discoveryResult.value);
    if (topologyResult.status === "fulfilled") setTopologySnapshot(topologyResult.value);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const id = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(id);
  }, [load]);
  useBrokerEvents(() => {
    void load();
  });

  const selectedAgent = resolveSelectedAgent(scopedAgents, selectedAgentId);
  const selectedAgentWasAliased = Boolean(
    selectedAgentId && selectedAgent && selectedAgent.id !== selectedAgentId,
  );

  const { conversationByAgentId, sessionByAgentId } =
    directSessionMaps(sessions);

  useEffect(() => {
    if (!selectedAgentId || !selectedAgent || !selectedAgentWasAliased) return;
    const staleDirectConversationId = conversationForAgent(selectedAgentId);
    const canonicalConversationId =
      activeConversationId === staleDirectConversationId
        ? selectedAgent.conversationId
        : activeConversationId;
    navigate({
      view: "agents",
      agentId: selectedAgent.id,
      ...(canonicalConversationId ? { conversationId: canonicalConversationId } : {}),
      ...(activeTab ? { tab: activeTab } : {}),
    });
  }, [activeConversationId, activeTab, navigate, selectedAgent, selectedAgentId, selectedAgentWasAliased]);

  if (selectedAgent) {
    const staleDirectConversationId =
      selectedAgentWasAliased && selectedAgentId
        ? conversationForAgent(selectedAgentId)
        : null;
    const resolvedConversationId =
      activeConversationId === staleDirectConversationId
        ? selectedAgent.conversationId
        : (
          activeConversationId ??
          conversationByAgentId.get(selectedAgent.id) ??
          selectedAgent.conversationId ??
          null
        );
    const resolvedTab = activeTab
      ?? (activeConversationId ? "message" : "profile");
    return (
      <AgentsRouteFrame activeRoute={activeRoute ?? route} navigate={navigate}>
        <AgentDetailWithRail
          agent={selectedAgent}
          allAgents={scopedAgents}
          session={sessionByAgentId.get(selectedAgent.id) ?? null}
          conversationId={resolvedConversationId}
          navigate={navigate}
          activeTab={resolvedTab}
        />
      </AgentsRouteFrame>
    );
  }

  return (
    <AgentsRouteFrame activeRoute={activeRoute ?? route} navigate={navigate}>
      <DevOverride id="agents.directory">
        <AgentsLibrary
          agents={scopedAgents}
          fleet={fleet}
          sessionByAgentId={sessionByAgentId}
          conversationByAgentId={conversationByAgentId}
          sessions={sessions}
          discovery={discovery}
          topologySnapshot={topologySnapshot}
          navigate={navigate}
        />
      </DevOverride>
    </AgentsRouteFrame>
  );
}

function AgentsRouteFrame({
  activeRoute,
  children,
  navigate,
}: {
  activeRoute: Route;
  children: ReactNode;
  navigate: (r: Route) => void;
}) {
  return (
    <div className="s-secondary-nav-shell">
      <div className="s-secondary-nav-bar">
        <AgentsSubnav activeRoute={activeRoute} navigate={navigate} />
      </div>
      <div className="s-secondary-nav-body">{children}</div>
    </div>
  );
}

function AgentsLibrary({
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
  const [harnessFilter, setHarnessFilter] = useState<Set<string>>(() => new Set());
  const [statusFilter, setStatusFilter] = useState<Set<AgentInventoryStatus>>(() => new Set());
  const [viewMode, setViewMode] = useState<AgentsLibraryViewMode>("cards");
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizonKey>(DEFAULT_TIME_HORIZON);
  const [now, setNow] = useState(Date.now());
  const [sort, setSort] = useState<{ key: AgentInventoryColumnKey; dir: 1 | -1 }>({
    key: "status",
    dir: 1,
  });

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
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
      isWithinTimeHorizon(row.lastActivityAt, timeHorizon, now, row.status === "working"),
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
      total: horizonRows.length,
      online: horizonRows.filter((row) => row.status !== "not_ready").length,
      working: horizonRows.filter((row) => row.status === "working").length,
      ready: horizonRows.filter((row) => row.status === "ready").length,
      notReady: horizonRows.filter((row) => row.status === "not_ready").length,
      projects: allProjects.length,
      scoutSessions: allProjects.reduce((sum, project) => sum + project.scoutSessions.length, 0),
      nativeSessions: horizonNativeSessions.length,
      activeNativeSessions: horizonNativeSessions.filter((row) => row.status === "active").length,
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

  const statusOptions = useMemo(() => {
    const present = new Set(horizonRows.map((row) => row.status));
    return (["working", "ready", "not_ready"] as AgentInventoryStatus[])
      .filter((status) => present.has(status));
  }, [horizonRows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return horizonRows.filter((row) => {
      if (harnessFilter.size > 0 && !harnessFilter.has(row.harness)) return false;
      if (statusFilter.size > 0 && !statusFilter.has(row.status)) return false;
      return agentInventoryRowMatchesQuery(row, q);
    });
  }, [harnessFilter, horizonRows, query, statusFilter]);

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
  const visibleRows = useMemo(
    () => selectedProjectKey
      ? filteredRows.filter((row) => projectIdentityForAgentRow(row).key === selectedProjectKey)
      : filteredRows,
    [filteredRows, selectedProjectKey],
  );

  const secondarySort = useMemo(
    () => (sort.key === "status"
      ? undefined
      : (a: AgentInventoryRow, b: AgentInventoryRow) =>
        AGENT_STATUS_RANK[a.status] - AGENT_STATUS_RANK[b.status]),
    [sort.key],
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
    setViewMode("tree");
    navigate({ view: "agents", projectKey: project.key });
  };

  const clearProjectSelection = () => {
    navigate({ view: "agents" });
  };

  const toggleHarness = (harness: string) => {
    setHarnessFilter((prev) => {
      const next = new Set(prev);
      if (next.has(harness)) next.delete(harness);
      else next.add(harness);
      return next;
    });
  };

  const toggleStatus = (status: AgentInventoryStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  return (
    <div className="s-agents-library s-agents-library--inventory">
      <div className="s-agents-inventory">
        <div className="s-atop-fbar">
          <div className="s-atop-search">
            <span className="s-atop-search-prompt">▸</span>
            <input
              className="s-atop-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="filter projects · agents · sessions"
            />
            <span className="s-atop-search-kbd">/</span>
          </div>
          <div className="s-agents-library-view" role="group" aria-label="Agents view">
            <button
              type="button"
              className="s-agents-library-view-btn"
              data-active={viewMode === "cards"}
              onClick={() => setViewMode("cards")}
            >
              cards
            </button>
            <button
              type="button"
              className="s-agents-library-view-btn"
              data-active={viewMode === "tree"}
              onClick={() => setViewMode("tree")}
            >
              tree
            </button>
          </div>
          <span className="s-atop-fbar-label">time</span>
          {TIME_HORIZON_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`s-atop-pill s-atop-pill--time${timeHorizon === option.key ? " s-atop-pill--on" : ""}`}
              onClick={() => setTimeHorizon(option.key)}
            >
              {option.label}
            </button>
          ))}
          {selectedProjectKey && (
            <>
              <span className="s-atop-fbar-label">project</span>
              <button
                type="button"
                className="s-atop-pill s-atop-pill--on s-atop-pill--project"
                onClick={clearProjectSelection}
                title="Return to all project overviews"
              >
                <span className="s-atop-pill-main">
                  {selectedProject?.title ?? "selected project"}
                </span>
                <span className="s-atop-pill-ct">clear</span>
              </button>
            </>
          )}
          {harnessOptions.length > 0 && (
            <>
              <span className="s-atop-fbar-label">harness</span>
              {harnessOptions.map(([harness, count]) => {
                const on = harnessFilter.has(harness);
                return (
                  <button
                    key={harness}
                    type="button"
                    className={`s-atop-pill s-atop-pill--harness${on ? " s-atop-pill--on" : ""}`}
                    onClick={() => toggleHarness(harness)}
                  >
                    {harness}
                    <span className="s-atop-pill-ct">{count}</span>
                  </button>
                );
              })}
            </>
          )}
          {statusOptions.length > 0 && (
            <>
              <span className="s-atop-fbar-label">status</span>
              {statusOptions.map((status) => {
                const on = statusFilter.has(status);
                const count = horizonRows.filter((row) => row.status === status).length;
                return (
                  <button
                    key={status}
                    type="button"
                    className={`s-atop-pill s-agents-inventory-pill--status-${agentInventoryStatusClass(status)}${on ? " s-atop-pill--on" : ""}`}
                    onClick={() => toggleStatus(status)}
                  >
                    {agentInventoryStatusLabel(status)}
                    <span className="s-atop-pill-ct">{count}</span>
                  </button>
                );
              })}
            </>
          )}
          <div className="s-atop-fbar-spacer" />
          {(harnessFilter.size > 0 || statusFilter.size > 0 || query || selectedProjectKey || timeHorizon !== DEFAULT_TIME_HORIZON) && (
            <button
              type="button"
              className="s-atop-pill"
              onClick={() => {
                setQuery("");
                setHarnessFilter(new Set());
                setStatusFilter(new Set());
                setTimeHorizon(DEFAULT_TIME_HORIZON);
                if (selectedProjectKey) clearProjectSelection();
              }}
            >
              clear
            </button>
          )}
        </div>

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

        <ProjectBoard
          projects={visibleProjects}
          totalProjects={summary.projects}
          query={query}
          selectedProject={selectedProject}
          selectedProjectKey={selectedProjectKey}
          navigate={navigate}
          route={route}
          openAgent={openAgent}
          onSelectProject={selectProject}
          mode={viewMode}
        />

        <div className="s-atop-keys">
          <span className="s-atop-keys-count">
            {viewMode === "cards" ? (
              <>
                <strong>{visibleProjects.length}</strong> / {summary.projects} project{summary.projects === 1 ? "" : "s"}
                {selectedProjectKey ? " selected" : ""}
              </>
            ) : (
              <>
                <strong>{visibleProjects.length}</strong> / {summary.projects} project tree{summary.projects === 1 ? "" : "s"}
              </>
            )}
          </span>
          <span className="s-atop-keys-spacer" />
          <span>{timeHorizon === "all" ? "all time" : `last ${timeHorizon}`}</span>
          <span>{summary.notReady} not ready</span>
          <span>{summary.nativeSessions} harness session{summary.nativeSessions === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}

function ProjectBoard({
  projects,
  totalProjects,
  query,
  selectedProject,
  selectedProjectKey,
  navigate,
  route,
  openAgent,
  onSelectProject,
  mode,
}: {
  projects: ProjectSlice[];
  totalProjects: number;
  query: string;
  selectedProject: ProjectSlice | null;
  selectedProjectKey: string | undefined;
  navigate: (r: Route) => void;
  route: Route;
  openAgent: (row: AgentInventoryRow) => void;
  onSelectProject: (project: ProjectSlice) => void;
  mode: AgentsLibraryViewMode;
}) {
  if (projects.length === 0) {
    return (
      <div className="s-agent-projects s-agent-projects--empty">
        <div className="s-agent-project-empty">
          <div className="s-agent-project-empty-title">
            {selectedProjectKey
              ? selectedProject
                ? "selected project hidden"
                : "project no longer visible"
              : totalProjects === 0
                ? "no projects visible"
                : "no projects match"}
          </div>
          <div className="s-agent-project-empty-body">
            {selectedProjectKey && selectedProject
              ? "Adjust the current filters to bring this project overview back into view."
              : selectedProjectKey
                ? "Return to all projects or select another project from the current project set."
                : query.trim()
              ? "Adjust the current project, agent, or session filter."
              : "Projects appear when agents, Scout sessions, or harness sessions are discovered."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="s-agent-projects">
      {projects.map((project) => (
        <ProjectSection
          key={project.key}
          project={project}
          navigate={navigate}
          route={route}
          openAgent={openAgent}
          selected={project.key === selectedProjectKey}
          onSelectProject={onSelectProject}
          mode={mode}
        />
      ))}
    </div>
  );
}

function ProjectSection({
  project,
  navigate,
  route,
  openAgent,
  selected,
  onSelectProject,
  mode,
}: {
  project: ProjectSlice;
  navigate: (r: Route) => void;
  route: Route;
  openAgent: (row: AgentInventoryRow) => void;
  selected: boolean;
  onSelectProject: (project: ProjectSlice) => void;
  mode: AgentsLibraryViewMode;
}) {
  const onlineAgents = project.agents.filter((row) => row.status !== "not_ready").length;
  const activeWork = project.agents.reduce((count, row) => count + row.activeAskCount, 0);
  const sessionTotal = project.nativeSessions.length + project.scoutSessions.length;
  const workflowTotal = project.workflows.length;
  const summaryParts = [
    `${onlineAgents}/${project.agents.length} agents`,
    countLabel(sessionTotal, "session"),
    workflowTotal > 0 ? countLabel(workflowTotal, "workflow") : null,
    activeWork > 0 ? countLabel(activeWork, "active task") : null,
    project.lastActivityAt ? `last ${timeAgo(project.lastActivityAt)}` : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <section className={`s-agent-project s-agent-project--${agentInventoryStatusClass(project.status)}${selected ? " s-agent-project--selected" : ""}`}>
      <div className="s-agent-project-head">
        <button
          type="button"
          className="s-agent-project-select"
          data-selected={selected}
          onClick={() => onSelectProject(project)}
          aria-pressed={selected}
          title={`Open ${project.title} project overview`}
        >
          <span className="s-agent-project-title-block">
            <span className="s-agent-project-title">{project.title}</span>
            {project.root && (
              <span className="s-agent-project-root" title={project.root}>{project.root}</span>
            )}
          </span>
        </button>
        <div className="s-agent-project-summary" aria-label={`${project.title} project summary`}>
          {summaryParts.join(" · ")}
        </div>
      </div>

      {selected || mode === "tree" ? (
        <ProjectLabeledAgentTree
          project={project}
          navigate={navigate}
          route={route}
          openAgent={openAgent}
        />
      ) : (
        <ProjectLabeledAgentCards
          project={project}
          navigate={navigate}
          route={route}
          openAgent={openAgent}
          onOpenProject={() => onSelectProject(project)}
        />
      )}
    </section>
  );
}

function ProjectLabeledAgentCards({
  project,
  navigate,
  route,
  openAgent,
  onOpenProject,
}: {
  project: ProjectSlice;
  navigate: (r: Route) => void;
  route: Route;
  openAgent: (row: AgentInventoryRow) => void;
  onOpenProject: () => void;
}) {
  const tree = useMemo(() => buildProjectTree(project), [project]);
  const visibleAgentNodes = tree.agents.slice(0, PROJECT_OVERVIEW_AGENT_LIMIT);
  const hiddenAgentCount = tree.agents.length - visibleAgentNodes.length;
  const sessionNodes = useMemo(
    () => sortProjectTreeSessions([
      ...project.workflows.map(workflowSessionNode),
      ...tree.unassignedSessions,
    ].filter(showProjectLevelSessionInOverview)),
    [project.workflows, tree.unassignedSessions],
  );
  const workflowCount = project.workflows.length;
  const visibleSessionNodes = sessionNodes.slice(0, PROJECT_OVERVIEW_SESSION_LIMIT);
  const hiddenSessionCount = sessionNodes.length - visibleSessionNodes.length;

  if (project.agents.length === 0 && sessionNodes.length === 0) {
    return (
      <div className="s-agent-project-empty-inline">
        No agents or sessions.
      </div>
    );
  }

  return (
    <div className="s-agent-project-labeled-list">
      <section className={`s-agent-project-labeled s-agent-project-labeled--${agentInventoryStatusClass(project.status)}`}>
        <div className="s-agent-project-labeled-body">
          <div className="s-agent-project-labeled-pane">
            <div className="s-agent-project-section-head">
              <span>Agents</span>
              <strong>
                {hiddenAgentCount > 0 ? `${visibleAgentNodes.length}/${tree.agents.length}` : tree.agents.length}
              </strong>
            </div>
            {project.agents.length === 0 ? (
              <div className="s-agent-project-empty-inline">No agent cards registered.</div>
            ) : (
              <>
                <div className="s-agent-project-card-grid s-agent-project-card-grid--compact">
                  {visibleAgentNodes.map((node) => (
                    <ProjectAgentCard
                      key={node.row.agent.id}
                      row={node.row}
                      attachedSessionCount={node.sessions.length}
                      onOpen={() => openAgent(node.row)}
                    />
                  ))}
                </div>
                {hiddenAgentCount > 0 && (
                  <button
                    type="button"
                    className="s-agent-project-more"
                    onClick={onOpenProject}
                  >
                    show {hiddenAgentCount} more in tree
                  </button>
                )}
              </>
            )}
          </div>

          <div className="s-agent-project-labeled-pane">
            <div className="s-agent-project-section-head">
              <span>{workflowCount > 0 ? "Workflows + unattached" : "Unattached sessions"}</span>
              <strong>
                {hiddenSessionCount > 0 ? `${visibleSessionNodes.length}/${sessionNodes.length}` : sessionNodes.length}
              </strong>
            </div>
            <ProjectLabeledAgentSessionList
              sessions={visibleSessionNodes}
              navigate={navigate}
              route={route}
            />
            {hiddenSessionCount > 0 && (
              <button
                type="button"
                className="s-agent-project-more"
                onClick={onOpenProject}
              >
                show {hiddenSessionCount} more in tree
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ProjectLabeledAgentSessionList({
  sessions,
  navigate,
  route,
}: {
  sessions: ProjectTreeSessionNode[];
  navigate: (r: Route) => void;
  route: Route;
}) {
  if (sessions.length === 0) {
    return <div className="s-agent-project-empty-inline">No sessions.</div>;
  }

  return (
    <div className="s-agent-project-session-list">
      {sessions.map((session) => (
        <button
          key={session.key}
          type="button"
          className={`s-agent-project-session s-agent-project-session--${session.kind}`}
          disabled={!session.route}
          onClick={() => {
            if (!session.route) return;
            openContent(navigate, session.route, { returnTo: route });
          }}
          title={session.detail ?? session.label}
        >
          <span className="s-agent-project-session-status">{session.status}</span>
          <span className={harnessChipClass(session.harness)}>{session.harness}</span>
          <span className="s-agent-project-session-main">{session.label}</span>
          <span className="s-agent-project-session-sub">
            {session.subLabel ?? (session.lastActivityAt ? timeAgo(session.lastActivityAt) : session.kind)}
          </span>
        </button>
      ))}
    </div>
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
                        style={{ background: stateColor(row.agent.state) }}
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

        {projectLevelSessions.map((session) => (
          <ProjectTreeSessionRow
            key={session.key}
            session={session}
            compact
            onOpen={() => openSession(session)}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectTreeTable({
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
  const baseTree = useMemo(() => buildProjectTree(project), [project]);
  const collapsedStorageKey = collapsedProjectTreeStorageKey(project.key);
  const sortStorageKey = projectTreeSortStorageKey(project.key);
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    readCollapsedProjectTreeRows(collapsedStorageKey),
  );
  const [sort, setSort] = useState<ProjectTreeSort>(() => readProjectTreeSort(sortStorageKey));
  const tree = useMemo(() => sortedProjectTree(baseTree, sort), [baseTree, sort]);
  const totalSessions = project.nativeSessions.length + project.scoutSessions.length;

  useEffect(() => {
    writeCollapsedProjectTreeRows(collapsedStorageKey, collapsed);
  }, [collapsed, collapsedStorageKey]);
  useEffect(() => {
    writeProjectTreeSort(sortStorageKey, sort);
  }, [sort, sortStorageKey]);

  const toggle = (key: string) => {
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

  const toggleSort = (key: ProjectTreeSortKey) => {
    setSort((prev) => prev.key === key
      ? { key, dir: prev.dir === 1 ? -1 : 1 }
      : { key, dir: projectTreeDefaultDirection(key) });
  };

  const unassignedKey = `${project.key}:project-sessions`;
  const unassignedOpen = !collapsed.has(unassignedKey);

  return (
    <div className="s-agent-project-tree" role="treegrid" aria-label={`${project.title} agent and session tree`}>
      <div className="s-agent-project-tree-grid">
        <div className="s-agent-project-tree-head" role="row">
          {PROJECT_TREE_COLUMNS.map((column) => {
            const active = column.key === sort.key;
            return column.sortable ? (
              <button
                key={column.key}
                type="button"
                className="s-agent-project-tree-sort"
                data-active={active}
                aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                onClick={() => toggleSort(column.key as ProjectTreeSortKey)}
              >
                <span>{column.label}</span>
                <span className="s-agent-project-tree-sort-mark" aria-hidden>
                  {active ? sort.dir === 1 ? "↑" : "↓" : "↕"}
                </span>
              </button>
            ) : (
              <span key={column.key}>{column.label}</span>
            );
          })}
        </div>

        <div className="s-agent-project-tree-row s-agent-project-tree-row--root" role="row">
          <div className="s-agent-project-tree-target">
            <span className="s-agent-project-tree-gutter" aria-hidden />
            <span className="s-agent-project-tree-copy">
              <span className="s-agent-project-tree-primary">{project.title}</span>
              <span className="s-agent-project-tree-secondary">{project.root ?? "Project root unknown"}</span>
            </span>
          </div>
          <span className={`s-agent-project-tree-state s-agent-project-tree-state--${agentInventoryStatusClass(project.status)}`}>
            {agentInventoryStatusLabel(project.status)}
          </span>
          <span className="s-agent-project-tree-muted">mixed</span>
          <span className="s-agent-project-tree-mono">{basename(project.root) ?? "—"}</span>
          <span className="s-agent-project-tree-mono">{project.agents.length} / {totalSessions}</span>
          <span className="s-agent-project-tree-mono">{project.lastActivityAt ? timeAgo(project.lastActivityAt) : "—"}</span>
          <span className="s-agent-project-tree-actions" />
        </div>

        {tree.unassignedSessions.length > 0 && (
          <Fragment>
            <div className="s-agent-project-tree-row s-agent-project-tree-row--group" role="row">
              <div className="s-agent-project-tree-target">
                <button
                  type="button"
                  className="s-agent-project-tree-toggle"
                  aria-label={`${unassignedOpen ? "Collapse" : "Expand"} project sessions`}
                  aria-expanded={unassignedOpen}
                  onClick={() => toggle(unassignedKey)}
                >
                  {unassignedOpen ? "▾" : "▸"}
                </button>
                <span className="s-agent-project-tree-copy">
                  <span className="s-agent-project-tree-primary">Project sessions</span>
                  <span className="s-agent-project-tree-secondary">Not attached to a registered agent card</span>
                </span>
              </div>
              <span className="s-agent-project-tree-muted">observed</span>
              <span className="s-agent-project-tree-muted">mixed</span>
              <span className="s-agent-project-tree-mono">{basename(project.root) ?? "—"}</span>
              <span className="s-agent-project-tree-mono">{tree.unassignedSessions.length}</span>
              <span className="s-agent-project-tree-mono">
                {tree.unassignedSessions[0]?.lastActivityAt ? timeAgo(tree.unassignedSessions[0].lastActivityAt) : "—"}
              </span>
              <span className="s-agent-project-tree-actions" />
            </div>
            {unassignedOpen && tree.unassignedSessions.map((session) => (
              <ProjectTreeSessionRow
                key={session.key}
                session={session}
                onOpen={() => openSession(session)}
              />
            ))}
          </Fragment>
        )}

        {tree.agents.map((node) => {
          const expanded = !collapsed.has(node.key);
          const row = node.row;
          return (
            <Fragment key={node.key}>
              <div className={`s-agent-project-tree-row s-agent-project-tree-row--agent s-agent-project-tree-row--${agentInventoryStatusClass(row.status)}`} role="row">
                <div className="s-agent-project-tree-target">
                  <button
                    type="button"
                    className="s-agent-project-tree-toggle"
                    disabled={node.sessions.length === 0}
                    aria-label={`${expanded ? "Collapse" : "Expand"} ${row.agent.name} sessions`}
                    aria-expanded={expanded}
                    onClick={() => toggle(node.key)}
                  >
                    {node.sessions.length === 0 ? "•" : expanded ? "▾" : "▸"}
                  </button>
                  <button
                    type="button"
                    className="s-agent-project-tree-link"
                    onClick={() => openAgent(row)}
                    title={primaryAgentSelector(row.agent) ?? row.agent.id}
                  >
                    <span className="s-agent-project-tree-primary">
                      <span
                        className="s-agent-project-tree-dot"
                        style={{ background: stateColor(row.agent.state) }}
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
                <span className={harnessChipClass(row.harness)}>{row.harness}</span>
                <span className="s-agent-project-tree-mono" title={row.agent.cwd ?? row.agent.projectRoot ?? undefined}>
                  {row.branch !== "—" ? row.branch : basename(row.agent.cwd ?? row.agent.projectRoot) ?? "—"}
                </span>
                <span className="s-agent-project-tree-mono">{node.sessions.length}</span>
                <span className="s-agent-project-tree-mono">{row.lastActivityAt ? timeAgo(row.lastActivityAt) : "—"}</span>
                <span className="s-agent-project-tree-actions">
                  {row.session && (
                    <button
                      type="button"
                      className="s-agent-project-tree-action"
                      onClick={() =>
                        openContent(
                          navigate,
                          { view: "conversation", conversationId: row.session!.id },
                          { returnTo: route },
                        )
                      }
                    >
                      message
                    </button>
                  )}
                  <button
                    type="button"
                    className="s-agent-project-tree-action"
                    onClick={() => openAgent(row)}
                  >
                    open
                  </button>
                </span>
              </div>

              {expanded && node.sessions.map((session) => (
                <ProjectTreeSessionRow
                  key={session.key}
                  session={session}
                  onOpen={() => openSession(session)}
                />
              ))}
            </Fragment>
          );
        })}

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
    return (
      <div className={rowClass} role="row">
        {target}
        <span className={`s-agent-project-tree-state s-agent-project-tree-state--${classPart(session.status)}`}>
          {session.status}
        </span>
        <span className="s-agent-project-tree-muted">{session.kind}</span>
        <span className="s-agent-project-tree-muted">—</span>
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

function ProjectAgentCard({
  row,
  attachedSessionCount = 0,
  onOpen,
}: {
  row: AgentInventoryRow;
  attachedSessionCount?: number;
  onOpen: () => void;
}) {
  const selector = primaryAgentSelector(row.agent);
  const signal = row.activeTask ?? row.session?.preview ?? row.stateLabel;
  const quiet = !row.activeTask && !row.session?.preview;

  return (
    <button
      type="button"
      className="s-agent-project-card"
      data-state={agentInventoryStatusClass(row.status)}
      onClick={onOpen}
      title={selector ?? row.agent.id}
    >
      <span className="s-agent-project-card-top">
        <span
          className="s-agent-project-card-dot"
          style={{ background: stateColor(row.agent.state) }}
          aria-hidden="true"
        />
        <span className="s-agent-project-card-name">{row.agent.name}</span>
        {row.lastActivityAt && (
          <span className="s-agent-project-card-time">{timeAgo(row.lastActivityAt)}</span>
        )}
      </span>
      <span className={`s-agent-project-card-signal${quiet ? " s-agent-project-card-signal--quiet" : ""}`}>
        {signal}
      </span>
      <span className="s-agent-project-card-chips">
        <span className={`${harnessChipClass(row.harness)} s-agent-project-card-harness`}>{row.harness}</span>
        {row.branch !== "—" && <span className="s-agent-project-chip">{row.branch}</span>}
        {attachedSessionCount > 0 ? (
          <span className="s-agent-project-chip s-agent-project-chip--attached-session">{countLabel(attachedSessionCount, "session")}</span>
        ) : (row.session?.id || row.agent.harnessSessionId) && (
          <span className="s-agent-project-chip s-agent-project-chip--session">session {shortSessionId(row.session?.id ?? row.agent.harnessSessionId)}</span>
        )}
        {row.activeAskCount > 0 && (
          <span className="s-agent-project-chip s-agent-project-chip--active">{row.activeAskCount} active</span>
        )}
      </span>
    </button>
  );
}

function ProjectNativeSessionList({
  sessions,
  navigate,
  route,
}: {
  sessions: NativeSessionRow[];
  navigate: (r: Route) => void;
  route: Route;
}) {
  if (sessions.length === 0) {
    return <div className="s-agent-project-empty-inline">No harness sessions discovered.</div>;
  }

  return (
    <div className="s-agent-project-session-list">
      {sessions.map((session) => {
        const canOpen = Boolean(session.sessionId || session.transcriptPath);
        const label = shortSessionId(session.sessionId ?? session.refId);
        return (
          <button
            key={session.key}
            type="button"
            className={`s-agent-project-session s-agent-project-session--${session.status}`}
            disabled={!canOpen}
            onClick={() => {
              if (!canOpen) return;
              openContent(navigate, { view: "sessions", sessionId: session.refId }, { returnTo: route });
            }}
            title={session.transcriptPath ?? session.process?.command ?? session.refId}
          >
            <span className="s-agent-project-session-status">{session.status}</span>
            <span className={harnessChipClass(session.source)}>{session.source}</span>
            <span className="s-agent-project-session-main">{label}</span>
            <span className="s-agent-project-session-sub">
              {session.process ? session.process.etime : session.lastActivityAt ? timeAgo(session.lastActivityAt) : "live"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ProjectScoutSessionList({
  sessions,
  navigate,
  route,
}: {
  sessions: SessionEntry[];
  navigate: (r: Route) => void;
  route: Route;
}) {
  if (sessions.length === 0) {
    return <div className="s-agent-project-empty-inline">No Scout conversations yet.</div>;
  }

  return (
    <div className="s-agent-project-session-list">
      {sessions.map((session) => {
        const harness = formatLabel(session.harness) ?? "scout";
        return (
          <button
            key={session.id}
            type="button"
            className="s-agent-project-session s-agent-project-session--scout"
            onClick={() =>
              openContent(
                navigate,
                { view: "conversation", conversationId: session.id },
                { returnTo: route },
              )
            }
            title={session.preview ?? session.id}
          >
            <span className="s-agent-project-session-status">{session.kind}</span>
            <span className={harnessChipClass(harness)}>{harness}</span>
            <span className="s-agent-project-session-main">{session.title || session.id}</span>
            <span className="s-agent-project-session-sub">
              {session.lastMessageAt ? timeAgo(session.lastMessageAt) : shortSessionId(session.harnessSessionId)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
