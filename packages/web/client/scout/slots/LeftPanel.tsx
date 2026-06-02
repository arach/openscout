import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Pin } from "lucide-react";
import { useScout } from "../Provider.tsx";
import { normalizeAgentState, type AgentDisplayState } from "../../lib/agent-state.ts";
import { api } from "../../lib/api.ts";
import {
  filterAgentsByMachineScope,
  filterSessionsByMachineScope,
  machineScopedAgentIds,
} from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import { usePersistentString } from "../../lib/persistent-state.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { formatElapsedDuration, timeAgo } from "../../lib/time.ts";
import { observedSessionDisplay } from "../../lib/session-display.ts";
import { useFleetActiveAsks } from "../../lib/use-fleet-active-asks.ts";
import type {
  Agent,
  FleetAsk,
  ProjectLandscapeItem,
  ProjectLandscapeState,
  Route,
  SessionEntry,
  TailDiscoveredProcess,
  TailDiscoveredTranscript,
  TailDiscoverySnapshot,
} from "../../lib/types.ts";
import { BaseLeftRail } from "./BaseLeftRail.tsx";
import { GlobalJumpDock } from "./GlobalJumpDock.tsx";
import { MeshNavLeftPanel } from "./MeshNavLeftPanel.tsx";
import { ScoutMessagesLeftPanel } from "./MessagesLeftPanel.tsx";
import { ScoutMissionControlLeftPanel } from "./MissionControlLeftPanel.tsx";
import { ScoutOpsAgentsLeftPanel } from "./OpsAgentsLeftPanel.tsx";
import { ScoutOpsLeftPanel } from "./OpsLeftPanel.tsx";
import { ScoutPlanArchiveLeftPanel } from "./PlanArchiveLeftPanel.tsx";
import { RailRow } from "./RailRow.tsx";
import { FleetSearch } from "./FleetSearch.tsx";
import { FleetFilterPills, type FleetStateToken } from "./FleetFilterPills.tsx";
import { openAgent } from "./openAgent.ts";

const PINNED_PROJECTS_STORAGE_KEY = "openscout.home.pinnedProjects.v1";
const PROJECT_RAIL_LIMIT = 8;
const SESSION_ACTIVE_WINDOW_MS = 60_000;
const AGENTS_RAIL_REFRESH_EVENTS = new Set([
  "message.posted",
  "conversation.upserted",
  "agent.updated",
]);

type LeftRailSlot =
  | { mode: "takeover"; render: () => ReactNode }
  | { mode: "prepend"; render: () => ReactNode };

/**
 * Single registry mapping a route to how it customizes the left rail.
 * Anything not listed here falls through to the BaseLeftRail with no prepend.
 *   - takeover: page owns the entire rail (BaseLeftRail does not render)
 *   - prepend:  page block renders ABOVE the BaseLeftRail's four sections
 */
function resolveLeftRailSlot(route: Route): LeftRailSlot | null {
  if (route.view === "ops") {
    if (route.mode === "mission") return { mode: "takeover", render: () => <ScoutMissionControlLeftPanel /> };
    if (route.mode === "plan") return { mode: "takeover", render: () => <ScoutPlanArchiveLeftPanel /> };
    if (route.mode === "agents") return { mode: "takeover", render: () => <ScoutOpsAgentsLeftPanel /> };
    return { mode: "takeover", render: () => <ScoutOpsLeftPanel /> };
  }
  switch (route.view) {
    case "inbox":
    case "fleet":
      return { mode: "prepend", render: () => <FleetProjectsRail /> };
    case "agents":
    case "agent-info":
      return { mode: "takeover", render: () => <ScoutAgentsLeftPanel /> };
    case "messages":
    case "channels":
    case "conversation":
      return { mode: "takeover", render: () => <ScoutMessagesLeftPanel /> };
    case "mesh":
      return { mode: "takeover", render: () => <MeshNavLeftPanel /> };
    default:
      return null;
  }
}

type ParentGroup = {
  key: string;
  label: string;
  root: string | null;
  agents: Agent[];
  bestState: AgentDisplayState;
  latestUpdate: number;
};

type SessionRailStatus = "active" | "direct" | "idle";

type SessionRailRow = {
  key: string;
  projectKey: string;
  projectLabel: string;
  projectRoot: string | null;
  label: string;
  source: string;
  context: string | null;
  status: SessionRailStatus;
  lastActivityAt: number | null;
  meta: string | null;
  route: Route;
  title: string;
  scoutLinked: boolean;
  searchFields: string[];
};

type SessionRailGroup = {
  key: string;
  label: string;
  root: string | null;
  sessions: SessionRailRow[];
  bestState: AgentDisplayState;
  latestActivityAt: number;
};

const STATE_RANK: Record<string, number> = { working: 0, available: 1, offline: 2 };

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

function formatLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/_/g, " ");
  if (cleaned.toLowerCase() === "relay agent") return "agent";
  return cleaned;
}

function projectKeyFrom(root: string | null, title: string): string {
  const normalizedTitle = title.trim().toLowerCase();
  if (normalizedTitle && normalizedTitle !== "unscoped" && normalizedTitle !== "unknown") {
    return `project:${normalizedTitle}`;
  }
  return root ? `root:${root}` : `project:${normalizedTitle || "unscoped"}`;
}

function agentProjectIdentity(agent: Agent): { key: string; label: string; root: string | null } {
  const root = normalizeProjectRoot(agent.projectRoot ?? agent.cwd);
  const label = agent.project?.trim() || basename(root) || "Unscoped";
  return {
    key: projectKeyFrom(root, label),
    label,
    root,
  };
}

function projectIdentity(title: string | null | undefined, root: string | null | undefined): { key: string; label: string; root: string | null } {
  const normalizedRoot = normalizeProjectRoot(root);
  const label = title?.trim() || basename(normalizedRoot) || "Unscoped";
  return {
    key: projectKeyFrom(normalizedRoot, label),
    label,
    root: normalizedRoot,
  };
}

function normalizeSessionRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const leaf = basename(trimmed) ?? trimmed;
  return leaf.endsWith(".jsonl") ? leaf.slice(0, -".jsonl".length) : leaf;
}

function addSessionRef(map: Map<string, string>, rowKey: string, value: string | null | undefined): void {
  const raw = value?.trim();
  if (raw) map.set(raw.toLowerCase(), rowKey);
  const normalized = normalizeSessionRef(raw);
  if (normalized) map.set(normalized.toLowerCase(), rowKey);
}

function findSessionRef(map: Map<string, string>, value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (raw) {
    const match = map.get(raw.toLowerCase());
    if (match) return match;
  }
  const normalized = normalizeSessionRef(raw);
  return normalized ? map.get(normalized.toLowerCase()) ?? null : null;
}

function tailProcessKey(source: string, cwd: string | null): string {
  return `${source}\0${cwd ?? ""}`;
}

function parsePinnedProjectKeys(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  } catch {
    return [];
  }
}

function encodePinnedProjectKeys(keys: readonly string[]): string {
  return JSON.stringify([...new Set(keys)].slice(0, 12));
}

function compactProjectPath(path: string | null | undefined): string {
  if (!path) return "no root";
  if (path.startsWith("/Users/")) return `~/${path.split("/").slice(3).join("/")}`;
  return path;
}

function projectDiffLabel(project: ProjectLandscapeItem): string {
  const diff = project.diff;
  if (!diff) return "diff unknown";
  if (diff.error) return "diff unavailable";
  if (diff.changedFiles === 0) return "clean";
  return `${diff.changedFiles} changed`;
}

function projectMeta(project: ProjectLandscapeItem): string {
  if (project.openJobs > 0) return `${project.openJobs} jobs`;
  if (project.workingAgents > 0) return `${project.workingAgents} active`;
  return project.lastActivityAt ? timeAgo(project.lastActivityAt) : `${project.agentCount} agents`;
}

function sortProjectsForRail(
  projects: ProjectLandscapeItem[],
  pinnedKeys: ReadonlySet<string>,
): ProjectLandscapeItem[] {
  return [...projects].sort((a, b) => {
    const aPinned = pinnedKeys.has(a.key);
    const bPinned = pinnedKeys.has(b.key);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (a.workingAgents !== b.workingAgents) return b.workingAgents - a.workingAgents;
    if (a.openJobs !== b.openJobs) return b.openJobs - a.openJobs;
    if ((a.diff?.changedFiles ?? 0) !== (b.diff?.changedFiles ?? 0)) {
      return (b.diff?.changedFiles ?? 0) - (a.diff?.changedFiles ?? 0);
    }
    return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) || a.title.localeCompare(b.title);
  });
}

function buildGroups(agents: Agent[]): ParentGroup[] {
  const map = new Map<string, ParentGroup>();
  for (const agent of agents) {
    const identity = agentProjectIdentity(agent);
    const group = map.get(identity.key) ?? {
      key: identity.key,
      label: identity.label,
      root: identity.root,
      agents: [],
      bestState: "offline" as AgentDisplayState,
      latestUpdate: 0,
    };
    group.agents.push(agent);
    map.set(identity.key, group);
  }

  const groups: ParentGroup[] = [];
  for (const group of map.values()) {
    const list = group.agents;
    list.sort((a, b) => {
      const sd = (STATE_RANK[normalizeAgentState(a.state)] ?? 9) -
                 (STATE_RANK[normalizeAgentState(b.state)] ?? 9);
      if (sd !== 0) return sd;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });

    const bestState = list.reduce<AgentDisplayState>((best, a) => {
      const s = normalizeAgentState(a.state);
      return (STATE_RANK[s] ?? 9) < (STATE_RANK[best] ?? 9) ? s : best;
    }, "offline");

    const latestUpdate = Math.max(...list.map((a) => a.updatedAt ?? 0));

    groups.push({
      ...group,
      agents: list,
      bestState,
      latestUpdate,
    });
  }

  groups.sort((a, b) => {
    const sd = (STATE_RANK[a.bestState] ?? 9) - (STATE_RANK[b.bestState] ?? 9);
    if (sd !== 0) return sd;
    return b.latestUpdate - a.latestUpdate;
  });

  return groups;
}

function buildSessionRailRows(
  discovery: TailDiscoverySnapshot | null,
  conversations: SessionEntry[],
  now: number,
): SessionRailRow[] {
  const rows: SessionRailRow[] = [];
  const rowByKey = new Map<string, SessionRailRow>();
  const rowKeyByRef = new Map<string, string>();
  const processByKey = new Map<string, TailDiscoveredProcess>();

  for (const process of discovery?.processes ?? []) {
    const source = process.source || "unknown";
    const key = tailProcessKey(source, normalizeProjectRoot(process.cwd));
    const current = processByKey.get(key);
    if (!current || process.pid < current.pid) {
      processByKey.set(key, process);
    }
  }

  const usedProcessKeys = new Set<string>();
  for (const transcript of discovery?.transcripts ?? []) {
    const row = sessionRailRowFromTranscript(transcript, processByKey, usedProcessKeys, now);
    if (!row) continue;
    rows.push(row);
    rowByKey.set(row.key, row);
    addSessionRef(rowKeyByRef, row.key, row.label);
    addSessionRef(rowKeyByRef, row.key, transcript.sessionId);
    addSessionRef(rowKeyByRef, row.key, transcript.transcriptPath);
  }

  for (const process of discovery?.processes ?? []) {
    const source = process.source || "unknown";
    const key = tailProcessKey(source, normalizeProjectRoot(process.cwd));
    if (usedProcessKeys.has(key)) continue;
    const row = sessionRailRowFromProcess(process);
    rows.push(row);
    rowByKey.set(row.key, row);
    addSessionRef(rowKeyByRef, row.key, row.label);
  }

  for (const conversation of conversations) {
    const matchedRowKey = findSessionRef(rowKeyByRef, conversation.id)
      ?? findSessionRef(rowKeyByRef, conversation.harnessSessionId)
      ?? findSessionRef(rowKeyByRef, conversation.harnessLogPath);
    if (matchedRowKey) {
      const row = rowByKey.get(matchedRowKey);
      if (row) {
        const preview = conversation.preview?.replace(/\s+/g, " ").trim();
        if (preview) {
          row.label = preview.length > 96 ? `${preview.slice(0, 93)}...` : preview;
        }
        if (conversation.currentBranch) {
          row.context = row.context
            ? `${conversation.currentBranch} · ${row.context}`
            : conversation.currentBranch;
        }
        row.scoutLinked = true;
        row.lastActivityAt = Math.max(row.lastActivityAt ?? 0, conversation.lastMessageAt ?? 0) || row.lastActivityAt;
        row.searchFields.push(
          "scout",
          conversation.id,
          conversation.title,
          conversation.agentName ?? "",
          conversation.preview ?? "",
        );
      }
      continue;
    }

    const row = sessionRailRowFromConversation(conversation);
    if (row) {
      rows.push(row);
      rowByKey.set(row.key, row);
    }
  }

  return rows.sort(compareSessionRailRows);
}

function sessionRailRowFromTranscript(
  transcript: TailDiscoveredTranscript,
  processByKey: Map<string, TailDiscoveredProcess>,
  usedProcessKeys: Set<string>,
  now: number,
): SessionRailRow | null {
  const source = transcript.source || "unknown";
  const cwd = normalizeProjectRoot(transcript.cwd);
  const processKey = tailProcessKey(source, cwd);
  const process = processByKey.get(processKey) ?? null;
  if (process) usedProcessKeys.add(processKey);

  const refId = normalizeSessionRef(transcript.sessionId)
    ?? normalizeSessionRef(transcript.transcriptPath);
  if (!refId) return null;

  const identity = projectIdentity(transcript.project, cwd);
  const active = Boolean(process) || now - transcript.mtimeMs <= SESSION_ACTIVE_WINDOW_MS;
  const display = observedSessionDisplay({
    source,
    project: identity.label,
    cwd,
    branch: transcript.branch,
    sessionId: transcript.sessionId,
    refId,
    transcriptPath: transcript.transcriptPath,
    processCommand: process?.command,
    summary: transcript.summary,
  });
  return {
    key: `transcript:${transcript.transcriptPath}`,
    projectKey: identity.key,
    projectLabel: identity.label,
    projectRoot: identity.root,
    label: display.label,
    source,
    context: display.context,
    status: active ? "active" : "idle",
    lastActivityAt: transcript.mtimeMs || null,
    meta: formatElapsedDuration(process?.etime),
    route: { view: "sessions", sessionId: refId },
    title: display.title,
    scoutLinked: false,
    searchFields: [
      refId,
      transcript.sessionId ?? "",
      transcript.transcriptPath,
      transcript.branch ?? "",
      transcript.summary ?? "",
      source,
      identity.label,
      identity.root ?? "",
      active ? "active" : "idle",
      "session",
    ],
  };
}

function sessionRailRowFromProcess(process: TailDiscoveredProcess): SessionRailRow {
  const source = process.source || "unknown";
  const cwd = normalizeProjectRoot(process.cwd);
  const identity = projectIdentity(basename(cwd), cwd);
  const label = `pid-${process.pid}`;
  const display = observedSessionDisplay({
    source,
    project: identity.label,
    cwd,
    branch: process.branch,
    refId: label,
    processCommand: process.command,
  });
  return {
    key: `process:${source}:${process.pid}`,
    projectKey: identity.key,
    projectLabel: identity.label,
    projectRoot: identity.root,
    label: display.label,
    source,
    context: display.context,
    status: "active",
    lastActivityAt: null,
    meta: formatElapsedDuration(process.etime),
    route: { view: "sessions" },
    title: display.title,
    scoutLinked: false,
    searchFields: [
      label,
      source,
      process.branch ?? "",
      identity.label,
      identity.root ?? "",
      process.command,
      "active",
      "session",
    ],
  };
}

function sessionRailRowFromConversation(conversation: SessionEntry): SessionRailRow | null {
  if (!conversation.workspaceRoot) return null;
  const identity = projectIdentity(conversation.agentName ?? conversation.title, conversation.workspaceRoot);
  const source = formatLabel(conversation.harness) ?? "session";
  return {
    key: `conversation:${conversation.id}`,
    projectKey: identity.key,
    projectLabel: identity.label,
    projectRoot: identity.root,
    label: conversation.title || conversation.agentName || conversation.id,
    source,
    context: conversation.currentBranch ?? basename(conversation.workspaceRoot),
    status: "direct",
    lastActivityAt: conversation.lastMessageAt,
    meta: null,
    route: { view: "conversation", conversationId: conversation.id },
    title: conversation.preview ?? conversation.id,
    scoutLinked: true,
    searchFields: [
      "scout",
      "session",
      conversation.id,
      conversation.kind,
      conversation.title,
      conversation.agentName ?? "",
      conversation.preview ?? "",
      conversation.workspaceRoot ?? "",
      source,
    ],
  };
}

function compareSessionRailRows(left: SessionRailRow, right: SessionRailRow): number {
  const stateDelta = sessionRailStateRank(left) - sessionRailStateRank(right);
  if (stateDelta !== 0) return stateDelta;
  return (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0)
    || left.projectLabel.localeCompare(right.projectLabel)
    || left.label.localeCompare(right.label);
}

function buildSessionRailGroups(rows: SessionRailRow[]): SessionRailGroup[] {
  const map = new Map<string, SessionRailGroup>();
  for (const row of rows) {
    const group = map.get(row.projectKey) ?? {
      key: row.projectKey,
      label: row.projectLabel,
      root: row.projectRoot,
      sessions: [],
      bestState: "offline" as AgentDisplayState,
      latestActivityAt: 0,
    };
    group.sessions.push(row);
    group.latestActivityAt = Math.max(group.latestActivityAt, row.lastActivityAt ?? 0);
    const rowState = sessionRailTone(row);
    if ((STATE_RANK[rowState] ?? 9) < (STATE_RANK[group.bestState] ?? 9)) {
      group.bestState = rowState;
    }
    map.set(row.projectKey, group);
  }

  return [...map.values()]
    .map((group) => ({
      ...group,
      sessions: [...group.sessions].sort(compareSessionRailRows),
    }))
    .sort((left, right) => {
      const stateDelta = (STATE_RANK[left.bestState] ?? 9) - (STATE_RANK[right.bestState] ?? 9);
      if (stateDelta !== 0) return stateDelta;
      return right.latestActivityAt - left.latestActivityAt
        || left.label.localeCompare(right.label);
    });
}

function sessionRailStateRank(row: SessionRailRow): number {
  if (row.status === "active") return 0;
  if (row.status === "direct") return 1;
  return 2;
}

function sessionRailTone(row: SessionRailRow): AgentDisplayState {
  if (row.status === "active") return "working";
  if (row.status === "direct") return "available";
  return "offline";
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function agentSearchFields(agent: Agent): string[] {
  return [
    agent.id,
    agent.name,
    agent.handle ?? "",
    agent.selector ?? "",
    agent.project ?? "",
    agent.branch ?? "",
    agent.role ?? "",
    agent.harness ?? "",
    agent.harnessSessionId ?? "",
    agent.conversationId,
    agent.harnessLogPath ?? "",
  ];
}

function agentMatchesQuery(agent: Agent, query: string): boolean {
  if (!query) {
    return true;
  }
  return agentSearchFields(agent).some((field) => field.toLowerCase().includes(query));
}

function sessionMatchesQuery(row: SessionRailRow, query: string): boolean {
  if (!query) return true;
  return row.searchFields.some((field) => field.toLowerCase().includes(query));
}

function sessionMatchesStateFilters(row: SessionRailRow, stateFilters: ReadonlySet<FleetStateToken>): boolean {
  const token: FleetStateToken = row.status === "active"
    ? "working"
    : row.status === "direct"
      ? "available"
      : "offline";
  return stateFilters.has(token);
}

function matchedSessionIdentifier(agent: Agent, query: string): string | null {
  if (!query) {
    return null;
  }
  const candidates = [
    agent.harnessSessionId,
    agent.conversationId,
  ];
  return candidates.find((value) => value?.toLowerCase().includes(query)) ?? null;
}

function navigateToAgent(
  navigate: ReturnType<typeof useScout>["navigate"],
  agent: Agent,
  options: { observe?: boolean } = {},
): void {
  openAgent(navigate, agent, {
    ...options,
    from: "agents-tree",
    returnTo: { view: "agents" },
  });
}

function FleetProjectsRail() {
  const { homeContextSelection, setHomeContextSelection } = useScout();
  const [landscape, setLandscape] = useState<ProjectLandscapeState | null>(null);
  const [pinnedRaw, setPinnedRaw] = usePersistentString(PINNED_PROJECTS_STORAGE_KEY, "[]");
  const pinnedKeys = useMemo(() => parsePinnedProjectKeys(pinnedRaw), [pinnedRaw]);
  const pinnedKeySet = useMemo(() => new Set(pinnedKeys), [pinnedKeys]);

  const load = useCallback(async () => {
    const data = await api<ProjectLandscapeState>(`/api/project-landscape?limit=${PROJECT_RAIL_LIMIT}`).catch(() => null);
    setLandscape(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshProjects = useCallback(() => {
    void load();
  }, [load]);
  useBrokerEvents(refreshProjects);

  const projects = useMemo(
    () => sortProjectsForRail(landscape?.projects ?? [], pinnedKeySet).slice(0, 6),
    [landscape?.projects, pinnedKeySet],
  );

  const togglePin = (projectKey: string) => {
    const current = parsePinnedProjectKeys(pinnedRaw);
    const next = current.includes(projectKey)
      ? current.filter((key) => key !== projectKey)
      : [projectKey, ...current];
    setPinnedRaw(encodePinnedProjectKeys(next));
  };

  const changedFiles = landscape?.totals.changedFiles ?? 0;
  const dirtyProjects = landscape?.totals.dirtyProjects ?? 0;

  return (
    <section className="ctx-panel-section base-rail-section base-projects">
      <div className="ctx-panel-section-label base-rail-section-label">
        <span>Projects</span>
        <span className="base-rail-section-trailing">
          {landscape ? (
            <span className="ctx-panel-count">
              {dirtyProjects > 0 ? `${dirtyProjects} dirty` : "clean"}
            </span>
          ) : null}
          <button type="button" className="base-rail-see-all" onClick={() => setHomeContextSelection({ kind: "projects" })}>
            all
          </button>
        </span>
      </div>
      {projects.length === 0 ? (
        <div className="ctx-panel-empty">No projects yet</div>
      ) : (
        <div className="base-project-list">
          {projects.map((project) => (
            <ProjectRailRow
              key={project.key}
              project={project}
              pinned={pinnedKeySet.has(project.key)}
              active={homeContextSelection.kind === "project" && homeContextSelection.projectKey === project.key}
              currentFallback={homeContextSelection.kind !== "project" && project.isCurrent}
              onOpen={() => setHomeContextSelection({ kind: "project", projectKey: project.key })}
              onTogglePin={() => togglePin(project.key)}
            />
          ))}
        </div>
      )}
      {landscape && changedFiles > 0 && (
        <div className="base-project-total">{changedFiles} changed files across visible projects</div>
      )}
    </section>
  );
}

function ProjectRailRow({
  project,
  pinned,
  active,
  currentFallback,
  onOpen,
  onTogglePin,
}: {
  project: ProjectLandscapeItem;
  pinned: boolean;
  active: boolean;
  currentFallback: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
}) {
  const diffTone = project.diff?.status === "dirty"
    ? "dirty"
    : project.diff?.status === "clean"
      ? "clean"
      : "unknown";
  const subParts = [
    projectDiffLabel(project),
    compactProjectPath(project.root),
  ].filter(Boolean);
  const pinLabel = pinned ? "Unpin project" : "Pin project";
  return (
    <div className={`base-project-row base-project-row--${diffTone}${project.isCurrent ? " base-project-row--current" : ""}`}>
      <RailRow
        name={project.title}
        sub={subParts.join(" · ")}
        meta={projectMeta(project)}
        leadingIcon={<span className={`base-project-marker base-project-marker--${diffTone}`} />}
        unread={project.isCurrent || pinned || project.workingAgents > 0}
        active={active || currentFallback}
        onClick={onOpen}
        title={project.root ?? project.title}
        action={
          <button
            type="button"
            className={`base-project-pin${pinned ? " is-pinned" : ""}`}
            aria-label={pinLabel}
            aria-pressed={pinned}
            title={pinLabel}
            onClick={onTogglePin}
          >
            <Pin size={11} aria-hidden="true" />
          </button>
        }
      />
    </div>
  );
}

export function ScoutLeftPanel() {
  const { route } = useScout();
  const slot = resolveLeftRailSlot(route);
  const rail = slot?.mode === "takeover"
    ? slot.render()
    : <BaseLeftRail prepend={slot?.mode === "prepend" ? slot.render() : undefined} />;
  return (
    <div className="scout-left-shell">
      <div className="scout-left-shell-rail">{rail}</div>
      <GlobalJumpDock />
    </div>
  );
}

const DEFAULT_STATE_FILTERS: ReadonlySet<FleetStateToken> = new Set([
  "working",
  "available",
  "offline",
]);

function ScoutAgentsLeftPanel() {
  const { agents, route, navigate } = useScout();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [stateFilters, setStateFilters] = useState<ReadonlySet<FleetStateToken>>(
    DEFAULT_STATE_FILTERS,
  );
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [discovery, setDiscovery] = useState<TailDiscoverySnapshot | null>(null);
  const [now, setNow] = useState(Date.now());
  const asksByAgent = useFleetActiveAsks();
  const machineId = routeMachineId(route);
  const scopedAgentIds = useMemo(
    () => machineScopedAgentIds(agents, machineId),
    [agents, machineId],
  );
  const scopedAgents = useMemo(
    () => filterAgentsByMachineScope(agents, machineId),
    [agents, machineId],
  );
  const scopedConversations = useMemo(
    () => filterSessionsByMachineScope(sessions, scopedAgentIds, machineId),
    [machineId, scopedAgentIds, sessions],
  );

  const loadSessionRoster = useCallback(async () => {
    const [sessionsResult, discoveryResult] = await Promise.allSettled([
      api<SessionEntry[]>("/api/conversations"),
      api<TailDiscoverySnapshot>("/api/tail/discover"),
    ]);
    if (sessionsResult.status === "fulfilled") setSessions(sessionsResult.value);
    if (discoveryResult.status === "fulfilled") setDiscovery(discoveryResult.value);
  }, []);

  useEffect(() => {
    void loadSessionRoster();
    const id = window.setInterval(() => void loadSessionRoster(), 10_000);
    return () => window.clearInterval(id);
  }, [loadSessionRoster]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useBrokerEvents((event) => {
    if (AGENTS_RAIL_REFRESH_EVENTS.has(event.kind)) {
      void loadSessionRoster();
    }
  });

  const normalizedQuery = normalizeQuery(query);
  const searchActive = normalizedQuery.length > 0;

  const toggleStateFilter = (token: FleetStateToken) => {
    setStateFilters((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  };

  const filteredAgents = useMemo(
    () =>
      scopedAgents.filter((agent) => {
        const s = normalizeAgentState(agent.state);
        const token: FleetStateToken =
          s === "working" || s === "available" ? s : "offline";
        if (!stateFilters.has(token)) return false;
        return agentMatchesQuery(agent, normalizedQuery);
      }),
    [normalizedQuery, scopedAgents, stateFilters],
  );

  const sessionRows = useMemo(
    () => buildSessionRailRows(discovery, scopedConversations, now),
    [discovery, now, scopedConversations],
  );
  const filteredSessionRows = useMemo(
    () =>
      sessionRows.filter((row) =>
        sessionMatchesStateFilters(row, stateFilters)
        && sessionMatchesQuery(row, normalizedQuery)
      ),
    [normalizedQuery, sessionRows, stateFilters],
  );
  const groups = useMemo(() => buildGroups(filteredAgents), [filteredAgents]);
  const sessionGroups = useMemo(() => buildSessionRailGroups(filteredSessionRows), [filteredSessionRows]);
  const firstMatch = filteredAgents[0] ?? null;
  const firstSessionMatch = filteredSessionRows[0] ?? null;

  const selectedAgentId = route.view === "agents" ? route.agentId : undefined;
  const selectedProjectKey = route.view === "agents" && !route.agentId ? route.projectKey : undefined;
  const selectedSessionId =
    route.view === "sessions" ? route.sessionId :
    route.view === "agents" ? route.sessionId :
    undefined;
  const selectedConversationId =
    route.view === "conversation" ? route.conversationId :
    route.view === "messages" ? route.conversationId :
    route.view === "agents" ? route.conversationId :
    undefined;
  const showSessionFallback = (scopedAgents.length === 0 || filteredAgents.length === 0)
    && filteredSessionRows.length > 0;

  const toggleProjectGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openSessionRow = useCallback((row: SessionRailRow) => {
    const next: Extract<Route, { view: "agents" }> = {
      view: "agents",
      projectKey: row.projectKey,
    };
    if (row.route.view === "sessions" && row.route.sessionId) {
      next.sessionId = row.route.sessionId;
    }
    if (row.route.view === "conversation") {
      next.conversationId = row.route.conversationId;
    }
    navigate(next);
  }, [navigate]);

  return (
    <div className="s-left-roster">
      <div className="s-left-roster-search">
        <FleetSearch
          value={query}
          onChange={setQuery}
          placeholder="Search agents or session IDs…"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (query) {
                setQuery("");
              } else {
                (event.target as HTMLInputElement).blur();
              }
            }
            if (event.key === "Enter" && firstMatch) {
              navigateToAgent(navigate, firstMatch, {
                observe: Boolean(matchedSessionIdentifier(firstMatch, normalizedQuery)),
              });
            } else if (event.key === "Enter" && firstSessionMatch) {
              openSessionRow(firstSessionMatch);
            }
          }}
        />
        <FleetFilterPills active={stateFilters} onToggle={toggleStateFilter} />
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>

      {showSessionFallback ? (
        <SessionRailGroupList
          groups={sessionGroups}
          expanded={expanded}
          searchActive={searchActive}
          selectedProjectKey={selectedProjectKey}
          selectedSessionId={selectedSessionId}
          selectedConversationId={selectedConversationId}
          navigate={navigate}
          onToggleProjectGroup={toggleProjectGroup}
          onOpenSession={openSessionRow}
        />
      ) : scopedAgents.length === 0 ? (
        <div className="s-left-roster-empty">
          {machineId ? "No agents on this machine" : "No agents registered"}
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="s-left-roster-empty">
          No agent cards or sessions match this search.
        </div>
      ) : (
        groups.map((group) => {
          const isSingle = group.agents.length === 1;
          const isOpen = searchActive || expanded.has(group.key);
          const only = isSingle ? group.agents[0] : null;
          const anySelected = group.agents.some((a) => a.id === selectedAgentId);
          const onlySessionMatch = only ? matchedSessionIdentifier(only, normalizedQuery) : null;
          const projectRouteKey = group.key;
          const projectSelected = selectedProjectKey === projectRouteKey;

          if (isSingle && only) {
            const ask = asksByAgent.get(only.id);
            return (
              <RailRow
                key={group.key}
                name={group.label}
                meta={only.updatedAt ? timeAgo(only.updatedAt) : undefined}
                sub={singleAgentSub(only, ask, onlySessionMatch)}
                tone={normalizeAgentState(only.state)}
                avatarName={only.name}
                active={only.id === selectedAgentId || projectSelected}
                title={agentRowTooltip(only, ask, onlySessionMatch)}
                onClick={() =>
                  navigateToAgent(navigate, only, { observe: Boolean(onlySessionMatch) })
                }
              />
            );
          }

          const collisions = collidingAgentIds(group.agents);
          return (
            <div key={group.key}>
              <RailRow
                name={group.label}
                meta={groupRollup(group.agents)}
                sub={`${group.agents.length} agents`}
                tone={group.bestState}
                caret={isOpen ? "open" : "closed"}
                active={projectSelected || (anySelected && !isOpen)}
                selected={anySelected && !projectSelected}
                onClick={() => {
                  toggleProjectGroup(group.key);
                  navigate({ view: "agents", projectKey: projectRouteKey });
                }}
              />
              {isOpen &&
                group.agents.map((agent) => {
                  const ask = asksByAgent.get(agent.id);
                  const sessionMatch = matchedSessionIdentifier(agent, normalizedQuery);
                  const collides = collisions.has(agent.id);
                  return (
                    <RailRow
                      key={agent.id}
                      depth={1}
                      name={agent.name}
                      meta={agent.updatedAt ? timeAgo(agent.updatedAt) : undefined}
                      sub={instanceAgentSub(agent, ask, sessionMatch, collides)}
                      tone={normalizeAgentState(agent.state)}
                      avatarName={agent.name}
                      active={agent.id === selectedAgentId}
                      title={agentRowTooltip(agent, ask, sessionMatch)}
                      onClick={() =>
                        navigateToAgent(navigate, agent, {
                          observe: Boolean(sessionMatch),
                        })
                      }
                    />
                  );
                })}
            </div>
          );
        })
      )}
      </div>
    </div>
  );
}

function SessionRailGroupList({
  groups,
  expanded,
  searchActive,
  selectedProjectKey,
  selectedSessionId,
  selectedConversationId,
  navigate,
  onToggleProjectGroup,
  onOpenSession,
}: {
  groups: SessionRailGroup[];
  expanded: ReadonlySet<string>;
  searchActive: boolean;
  selectedProjectKey: string | undefined;
  selectedSessionId: string | undefined;
  selectedConversationId: string | undefined;
  navigate: (route: Route) => void;
  onToggleProjectGroup: (key: string) => void;
  onOpenSession: (row: SessionRailRow) => void;
}) {
  return (
    <>
      <div className="ctx-panel-section-label base-rail-section-label">
        <span>Agents</span>
        <span className="base-rail-section-trailing">
          <span className="ctx-panel-count">{groups.length}</span>
        </span>
      </div>
      {groups.map((group) => {
        const projectSelected = selectedProjectKey === group.key;
        const anySelected = group.sessions.some((row) =>
          sessionRailRowActive(row, selectedSessionId, selectedConversationId),
        );
        const isOpen = searchActive || expanded.has(group.key);

        return (
          <div key={group.key}>
            <RailRow
              name={group.label}
              meta={sessionRailGroupRollup(group)}
              sub={`default card · ${group.sessions.length} session${group.sessions.length === 1 ? "" : "s"}`}
              tone={group.bestState}
              caret={isOpen ? "open" : "closed"}
              active={projectSelected || (anySelected && !isOpen)}
              selected={anySelected && !projectSelected}
              unread={group.sessions.some((row) => row.status === "active" || row.scoutLinked)}
              title={sessionRailGroupTooltip(group)}
              onClick={() => {
                onToggleProjectGroup(group.key);
                navigate({ view: "agents", projectKey: group.key });
              }}
            />
            {isOpen && group.sessions.map((row) => (
              <RailRow
                key={row.key}
                depth={1}
                name={row.label}
                meta={sessionRailMeta(row)}
                sub={sessionRailSub(row)}
                tone={sessionRailTone(row)}
                unread={row.status === "active" || row.scoutLinked}
                active={sessionRailRowActive(row, selectedSessionId, selectedConversationId)}
                title={sessionRailTooltip(row)}
                onClick={() => onOpenSession(row)}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

function sessionRailRowActive(
  row: SessionRailRow,
  selectedSessionId: string | undefined,
  selectedConversationId: string | undefined,
): boolean {
  if (row.route.view === "sessions") {
    return Boolean(row.route.sessionId && row.route.sessionId === selectedSessionId);
  }
  if (row.route.view === "conversation") {
    return row.route.conversationId === selectedConversationId;
  }
  return false;
}

function sessionRailMeta(row: SessionRailRow): string | undefined {
  return row.meta ?? (row.lastActivityAt ? timeAgo(row.lastActivityAt) : undefined);
}

function sessionRailSub(row: SessionRailRow): string {
  return [
    row.source,
    row.context,
    row.scoutLinked ? "scout" : null,
    row.status === "direct" ? "conversation" : row.status,
  ].filter(Boolean).join(" · ");
}

function sessionRailTooltip(row: SessionRailRow): string {
  return [
    row.title,
    row.context,
    row.projectRoot ? `project: ${row.projectRoot}` : null,
    row.scoutLinked ? "scout: recent interaction" : null,
  ].filter(Boolean).join("\n");
}

function sessionRailGroupTooltip(group: SessionRailGroup): string {
  return [
    `${group.label} default agent card`,
    group.root ? `project: ${group.root}` : null,
    `${group.sessions.length} session${group.sessions.length === 1 ? "" : "s"}`,
  ].filter(Boolean).join("\n");
}

function sessionRailGroupRollup(group: SessionRailGroup): string {
  const active = group.sessions.filter((row) => row.status === "active").length;
  if (active > 0) return `${active}/${group.sessions.length}`;
  return group.latestActivityAt ? timeAgo(group.latestActivityAt) : `${group.sessions.length}`;
}

const BRANCH_GLYPH = "⎇";

function sessionTail(agent: Agent): string {
  const id = agent.conversationId ?? agent.harnessSessionId ?? "";
  return id.slice(-5);
}

function branchChip(agent: Agent): string | null {
  if (!agent.branch) return null;
  return `${BRANCH_GLYPH} ${agent.branch}`;
}

function singleAgentSub(
  agent: Agent,
  ask: FleetAsk | undefined,
  sessionMatch: string | null,
): string | undefined {
  if (sessionMatch) return `session · ${sessionMatch}`;
  if (ask) return ask.task;
  const branch = branchChip(agent);
  if (branch) return branch;
  return undefined;
}

function instanceAgentSub(
  agent: Agent,
  ask: FleetAsk | undefined,
  sessionMatch: string | null,
  collides: boolean,
): string | undefined {
  if (sessionMatch) return `session · ${sessionMatch}`;
  if (ask) return ask.task;
  const parts: string[] = [];
  const branch = branchChip(agent);
  if (branch) parts.push(branch);
  if (collides) {
    const tail = sessionTail(agent);
    if (tail) parts.push(`#${tail}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function collidingAgentIds(agents: Agent[]): Set<string> {
  const counts = new Map<string, number>();
  for (const a of agents) {
    const key = `${a.name}::${a.branch ?? ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ids = new Set<string>();
  for (const a of agents) {
    const key = `${a.name}::${a.branch ?? ""}`;
    if ((counts.get(key) ?? 0) > 1) ids.add(a.id);
  }
  return ids;
}

function agentRowTooltip(
  agent: Agent,
  ask: FleetAsk | undefined,
  sessionMatch: string | null,
): string | undefined {
  const parts: string[] = [];
  if (ask) parts.push(`task: ${ask.task}`);
  if (agent.branch) parts.push(`branch: ${agent.branch}`);
  if (agent.harness) parts.push(`harness: ${agent.harness}`);
  if (sessionMatch) parts.push(`session: ${sessionMatch}`);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function groupRollup(agents: Agent[]): string {
  let working = 0;
  let available = 0;
  let offline = 0;
  for (const agent of agents) {
    const s = normalizeAgentState(agent.state);
    if (s === "working") working += 1;
    else if (s === "available") available += 1;
    else offline += 1;
  }
  const parts: string[] = [];
  if (working) parts.push(`${working}w`);
  if (available) parts.push(`${available}a`);
  if (offline && !working && !available) parts.push(`${offline}o`);
  if (parts.length === 0) return `${agents.length}`;
  return parts.join(" · ");
}
