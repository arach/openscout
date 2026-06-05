import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useScout } from "../Provider.tsx";
import { openAgent } from "./openAgent.ts";
import { openContent } from "./openContent.ts";
import { agentStateLabel, normalizeAgentState } from "../../lib/agent-state.ts";
import { api } from "../../lib/api.ts";
import { actorColor } from "../../lib/colors.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import { AgentsInspector } from "../inspector/AgentsInspector.tsx";
import { ConversationInspector } from "../inspector/ConversationInspector.tsx";
import { HomeAgentsInspector } from "../inspector/HomeAgentsInspector.tsx";
import { SessionsInspector } from "../inspector/SessionsInspector.tsx";
import { TerminalInspector } from "../inspector/TerminalInspector.tsx";
import { WorkInspector } from "../inspector/WorkInspector.tsx";
import { MeshInspectorPanel } from "../inspector/MeshInspector.tsx";
import { ScoutbotPanel } from "../scoutbot/ScoutbotPanel.tsx";
import { BrokerAttemptInspector } from "../../screens/BrokerScreen.tsx";
import { usePersistentBoolean, usePersistentNumber } from "../../lib/persistent-state.ts";
import { VerticalResizeHandle } from "./VerticalResizeHandle.tsx";
import type {
  Agent,
  AgentRun,
  FleetAsk,
  FleetAttentionItem,
  FleetState,
  OpsMode,
  PlanDocument,
  PlanDocumentStepStatus,
  PlanDocumentsResponse,
  Route,
  SessionEntry,
  WorkItem,
} from "../../lib/types.ts";

const SCOUTBOT_MIN_HEIGHT = 180;
const SCOUTBOT_MAX_HEIGHT_RATIO = 0.7;
const SCOUTBOT_DEFAULT_HEIGHT = 260;

function clampScoutbotHeight(value: number, inspectorHeight: number) {
  const max = Math.max(SCOUTBOT_MIN_HEIGHT, Math.floor(inspectorHeight * SCOUTBOT_MAX_HEIGHT_RATIO));
  return Math.min(max, Math.max(SCOUTBOT_MIN_HEIGHT, Math.round(value)));
}

export function ScoutInspector() {
  const { route, navigate, agents, selectedBrokerAttempt, clearBrokerAttempt } = useScout();
  const [scoutbotCollapsed] = usePersistentBoolean("openscout.scoutbot.collapsed", true);
  const [scoutbotHeight, setScoutbotHeight] = usePersistentNumber("openscout.scoutbot.height", SCOUTBOT_DEFAULT_HEIGHT);
  const containerRef = useRef<HTMLDivElement>(null);
  const [inspectorHeight, setInspectorHeight] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setInspectorHeight(el.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setInspectorHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (inspectorHeight <= 0) return;
    const next = clampScoutbotHeight(scoutbotHeight, inspectorHeight);
    if (next !== scoutbotHeight) {
      setScoutbotHeight(next);
    }
  }, [inspectorHeight, scoutbotHeight, setScoutbotHeight]);

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const startY = event.clientY;
      const startHeight = scoutbotHeight;
      const containerHeight = containerRef.current?.getBoundingClientRect().height ?? inspectorHeight;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        setScoutbotHeight(clampScoutbotHeight(startHeight - delta, containerHeight));
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };

      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [inspectorHeight, scoutbotHeight, setScoutbotHeight],
  );

  let content: ReactNode = null;

  switch (route.view) {
    case "inbox":
    case "fleet":
      content = <HomeAgentsInspector />;
      break;
    case "agents":
    case "agent-info":
      content = <AgentsInspector />;
      break;
    case "sessions":
      content = <SessionsInspector />;
      break;
    case "conversation":
      content = <ConversationInspector />;
      break;
    case "terminal":
      content = <TerminalInspector />;
      break;
    case "channels":
      content = <ChannelInspectorPanel channelId={route.channelId} agents={agents} navigate={navigate} returnRoute={route} />;
      break;
    case "work":
      content = <WorkInspector />;
      break;
    case "mesh":
      content = <MeshInspectorPanel />;
      break;
    case "ops":
      content = <OpsInspectorPanel mode={route.mode ?? "mission"} agents={agents} navigate={navigate} returnRoute={route} />;
      break;
    case "broker":
      content = selectedBrokerAttempt
        ? (
          <BrokerAttemptInspector
            attempt={selectedBrokerAttempt}
            navigate={navigate}
            onClose={clearBrokerAttempt}
          />
        )
        : <BrokerInspectorEmpty />;
      break;
    default:
      content = null;
  }

  const clampedScoutbotHeight = inspectorHeight > 0
    ? clampScoutbotHeight(scoutbotHeight, inspectorHeight)
    : scoutbotHeight;

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        {content}
      </div>
      {!scoutbotCollapsed && <VerticalResizeHandle onResizeStart={handleResizeStart} />}
      <ScoutbotPanel height={scoutbotCollapsed ? undefined : clampedScoutbotHeight} />
    </div>
  );
}

function BrokerInspectorEmpty() {
  return (
    <div className="sys-broker-right-empty">
      <div className="sys-kicker">Broker</div>
      <p>Select any broker ledger row to inspect route metadata here.</p>
    </div>
  );
}

const TERMINAL_CHANNEL_RUN_STATES = new Set(["completed", "failed", "cancelled"]);

type ChannelActivityItem = {
  id: string;
  kind: "work" | "run";
  actorId: string | null;
  actorName: string;
  status: string;
  title: string;
  detail: string | null;
  updatedAt: number;
  active: boolean;
  route: Route | null;
};

function channelRouteLabel(channelId: string): string {
  if (channelId.startsWith("channel.")) {
    return `#${channelId.slice("channel.".length)}`;
  }
  if (channelId.startsWith("dm.")) {
    return "Direct message";
  }
  return channelId;
}

function objectField(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function stringField(value: unknown, key: string): string | null {
  const field = objectField(value, key);
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function agentNameFor(id: string | null | undefined, fallback: string | null | undefined, agents: Agent[]): string {
  if (fallback?.trim()) return fallback.trim();
  const agent = id ? agents.find((candidate) => candidate.id === id) : null;
  return agent?.name ?? id ?? "Unassigned";
}

function runTask(run: AgentRun): string | null {
  return stringField(run.input, "task") ?? stringField(run.input, "action");
}

function runOutputSummary(run: AgentRun): string | null {
  return stringField(run.output, "summary") ?? stringField(run.output, "text");
}

function isActiveChannelRun(run: AgentRun): boolean {
  return !TERMINAL_CHANNEL_RUN_STATES.has(run.state);
}

function runUpdatedAt(run: AgentRun): number {
  return run.updatedAt ?? run.completedAt ?? run.startedAt ?? run.createdAt ?? Date.now();
}

function runStatusLabel(state: string): string {
  return state.replace(/_/g, " ");
}

function routeForRun(run: AgentRun): Route | null {
  if (run.workId) return { view: "work", workId: run.workId };
  const flightId = run.flightIds?.[0] ?? null;
  if (flightId) return { view: "follow", flightId, preferredView: "chat" };
  if (run.invocationId) return { view: "follow", invocationId: run.invocationId, preferredView: "chat" };
  return null;
}

function workActivityItem(work: WorkItem, agents: Agent[]): ChannelActivityItem {
  const actorId = work.nextMoveOwnerId ?? work.ownerId;
  const actorName = agentNameFor(actorId, work.nextMoveOwnerName ?? work.ownerName, agents);
  const activeFlights = work.activeFlightCount > 0
    ? `${work.activeFlightCount} active flight${work.activeFlightCount === 1 ? "" : "s"}`
    : null;
  return {
    id: `work:${work.id}`,
    kind: "work",
    actorId,
    actorName,
    status: activeFlights ?? work.currentPhase,
    title: work.title,
    detail: work.lastMeaningfulSummary ?? work.summary,
    updatedAt: work.lastMeaningfulAt || work.updatedAt,
    active: true,
    route: { view: "work", workId: work.id },
  };
}

function runActivityItem(run: AgentRun, agents: Agent[]): ChannelActivityItem {
  const active = isActiveChannelRun(run);
  const outputSummary = runOutputSummary(run);
  return {
    id: `run:${run.id}`,
    kind: "run",
    actorId: run.agentId,
    actorName: agentNameFor(run.agentId, run.agentName, agents),
    status: runStatusLabel(run.state),
    title: runTask(run) ?? outputSummary ?? "Agent run",
    detail: active ? outputSummary : null,
    updatedAt: runUpdatedAt(run),
    active,
    route: routeForRun(run),
  };
}

function buildChannelActivityItems(workItems: WorkItem[], runs: AgentRun[], agents: Agent[]): ChannelActivityItem[] {
  const visibleWorkIds = new Set(workItems.map((work) => work.id));
  const workItemsForChannel = workItems.map((work) => workActivityItem(work, agents));
  const activeRuns = runs.filter((run) => isActiveChannelRun(run));
  const recentRuns = runs.filter((run) => !isActiveChannelRun(run)).slice(0, 6);
  const runItems = [...activeRuns, ...recentRuns]
    .filter((run) => !run.workId || !visibleWorkIds.has(run.workId))
    .map((run) => runActivityItem(run, agents));

  return [...workItemsForChannel, ...runItems]
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1;
      return right.updatedAt - left.updatedAt;
    })
    .slice(0, 12);
}

function ChannelInspectorPanel({
  channelId,
  agents,
  navigate,
  returnRoute,
}: {
  channelId: string | undefined;
  agents: Agent[];
  navigate: (route: Route) => void;
  returnRoute: Route;
}) {
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!channelId) {
      setLoaded(true);
      setWorkItems([]);
      setRuns([]);
      return;
    }
    try {
      const [work, channelRuns] = await Promise.all([
        api<WorkItem[]>(
          `/api/work?conversationId=${encodeURIComponent(channelId)}&active=true&limit=12`,
        ),
        api<AgentRun[]>(
          `/api/runs?conversationId=${encodeURIComponent(channelId)}&active=false&limit=24`,
        ),
      ]);
      setWorkItems(work);
      setRuns(channelRuns);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, [channelId]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  useBrokerEvents((event) => {
    if (!channelId) return;
    if (event.kind === "message.posted") {
      const payload = event.payload as { message?: { conversationId?: string } } | undefined;
      if (payload?.message?.conversationId === channelId) void load();
      return;
    }
    if (
      event.kind === "invocation.requested" ||
      event.kind === "flight.updated" ||
      event.kind === "collaboration.event.appended"
    ) {
      void load();
    }
  });

  const items = useMemo(
    () => buildChannelActivityItems(workItems, runs, agents),
    [workItems, runs, agents],
  );
  const activeItems = items.filter((item) => item.active);
  const recentItems = items.filter((item) => !item.active);

  if (!channelId) {
    return (
      <div className="ctx-panel ctx-panel--empty">
        <div className="ctx-panel-empty-state">
          <div className="ctx-panel-empty-hint">Select a channel to see related work.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ctx-panel ctx-panel--channel">
      <section className="ctx-panel-section ctx-panel-channel-summary">
        <div className="ctx-panel-section-label">Channel</div>
        <div className="ctx-panel-channel-card">
          <span className="ctx-panel-hash">#</span>
          <div className="ctx-panel-body">
            <span className="ctx-panel-name">{channelRouteLabel(channelId)}</span>
            <span className="ctx-panel-preview">
              {loaded ? `${items.length} related item${items.length === 1 ? "" : "s"}` : "Loading context"}
            </span>
          </div>
        </div>
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Doing
          <span className="ctx-panel-count">{activeItems.length}</span>
        </div>
        {activeItems.length === 0 ? (
          <div className="ctx-panel-empty">No active channel work</div>
        ) : (
          <div className="ctx-panel-list">
            {activeItems.map((item) => (
              <ChannelActivityButton
                key={item.id}
                item={item}
                navigate={navigate}
                returnRoute={returnRoute}
              />
            ))}
          </div>
        )}
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Recent
          <span className="ctx-panel-count">{recentItems.length}</span>
        </div>
        {recentItems.length === 0 ? (
          <div className="ctx-panel-empty">{loaded ? "No recent channel runs" : "Loading context"}</div>
        ) : (
          <div className="ctx-panel-list ctx-panel-list--scroll">
            {recentItems.map((item) => (
              <ChannelActivityButton
                key={item.id}
                item={item}
                navigate={navigate}
                returnRoute={returnRoute}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ChannelActivityButton({
  item,
  navigate,
  returnRoute,
}: {
  item: ChannelActivityItem;
  navigate: (route: Route) => void;
  returnRoute: Route;
}) {
  const content = (
    <>
      <div className="ctx-panel-avatar" style={{ background: actorColor(item.actorName) }}>
        {item.actorName[0]?.toUpperCase() ?? "?"}
      </div>
      <div className="ctx-panel-body">
        <span className="ctx-panel-name">{item.actorName}</span>
        <span className="ctx-panel-sub">
          {item.kind} · {item.status}
        </span>
        <span className="ctx-panel-preview">{item.title}</span>
        {item.detail && <span className="ctx-panel-preview">{item.detail}</span>}
      </div>
      <div className="ctx-panel-trailing">
        <span className="ctx-panel-time">{timeAgo(item.updatedAt)}</span>
        {item.active && <span className="ctx-panel-dot" />}
      </div>
    </>
  );

  if (!item.route) {
    return <div className="ctx-panel-item ctx-panel-channel-item">{content}</div>;
  }

  return (
    <button
      type="button"
      className={[
        "ctx-panel-item",
        "ctx-panel-channel-item",
        item.active && "ctx-panel-item--active",
      ].filter(Boolean).join(" ")}
      onClick={() => openContent(navigate, item.route!, { returnTo: returnRoute })}
    >
      {content}
    </button>
  );
}

const OPS_MODE_LABELS: Record<OpsMode, string> = {
  mission: "Control",
  plan: "Plans",
  issues: "Alerts",
  tail: "Tail",
  atop: "Atop",
  agents: "Agents",
};

type OpsDetailSnapshot = {
  focus: "flow" | "item";
  title: string;
  meta: string;
  body: string;
  action: { label: string; route: Route } | null;
};

type PlanInspectorRelated = {
  asks: FleetAsk[];
  runs: AgentRun[];
  sessions: SessionEntry[];
  workItems: WorkItem[];
  attention: FleetAttentionItem[];
};

const PLAN_STEP_LABELS: Record<PlanDocumentStepStatus, string> = {
  blocked: "blocked",
  completed: "done",
  in_progress: "active",
  pending: "todo",
  unknown: "step",
};

const PLAN_STEP_MARKERS: Record<PlanDocumentStepStatus, string> = {
  blocked: "!",
  completed: "x",
  in_progress: ">",
  pending: " ",
  unknown: "-",
};

function planBasename(value: string): string {
  const clean = value.replace(/\\/g, "/").replace(/\/+$/g, "");
  const idx = clean.lastIndexOf("/");
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

function compactPlanText(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function planSignificantTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token) => !["plan", "plans", "todo", "work", "task", "docs", "markdown"].includes(token))
    .slice(0, 8);
}

function planRelatedScore(document: PlanDocument, haystackInput: Array<string | null | undefined>): number {
  const haystack = haystackInput.filter(Boolean).join(" ").toLowerCase();
  if (!haystack) return 0;

  const path = document.path.toLowerCase();
  const file = planBasename(path).toLowerCase();
  const title = document.title.toLowerCase();
  let score = 0;

  if (path && haystack.includes(path)) score += 8;
  if (file && haystack.includes(file)) score += 6;
  if (title.length > 8 && haystack.includes(title)) score += 6;

  for (const tag of document.tags) {
    if (tag.length >= 3 && haystack.includes(tag.toLowerCase())) score += 2;
  }
  for (const token of planSignificantTokens(document.title)) {
    if (haystack.includes(token)) score += 1;
  }
  for (const step of document.steps.slice(0, 8)) {
    for (const token of planSignificantTokens(step.text).slice(0, 3)) {
      if (haystack.includes(token)) score += 1;
    }
  }

  return score;
}

function planRelatedSessionScore(document: PlanDocument, session: SessionEntry): number {
  let score = planRelatedScore(document, [
    session.id,
    session.title,
    session.preview,
    session.agentName,
    session.harness,
    session.harnessSessionId,
    session.harnessLogPath,
    session.currentBranch,
    session.workspaceRoot,
    session.participantIds.join(" "),
  ]);

  if (document.agentId && session.agentId === document.agentId) score += 4;
  if (document.agentName && session.agentName && document.agentName === session.agentName) score += 2;
  if (
    document.workspaceName
    && session.workspaceRoot
    && planBasename(session.workspaceRoot).toLowerCase() === document.workspaceName.toLowerCase()
  ) {
    score += 3;
  }

  return score;
}

function mergeInspectorWorkItems(results: Array<PromiseSettledResult<WorkItem[]>>): WorkItem[] {
  const byId = new Map<string, WorkItem>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function relatedPlanContext(
  document: PlanDocument | null,
  input: {
    fleet: FleetState | null;
    runs: AgentRun[];
    sessions: SessionEntry[];
    workItems: WorkItem[];
  },
): PlanInspectorRelated {
  if (!document) return { asks: [], runs: [], sessions: [], workItems: [], attention: [] };

  const minimumRelatedScore = 6;
  const asks = [...(input.fleet?.activeAsks ?? []), ...(input.fleet?.recentCompleted ?? [])]
    .filter((ask) => planRelatedScore(document, [
      ask.task,
      ask.summary,
      ask.agentName,
      ask.collaborationRecordId,
    ]) >= minimumRelatedScore)
    .slice(0, 8);

  const runs = input.runs
    .filter((run) => planRelatedScore(document, [
      runTask(run),
      runOutputSummary(run),
      run.agentName,
      run.workId,
      run.collaborationRecordId,
    ]) >= minimumRelatedScore)
    .slice(0, 8);

  const workItems = input.workItems
    .filter((work) => planRelatedScore(document, [
      work.title,
      work.summary,
      work.lastMeaningfulSummary,
      work.parentTitle,
      work.ownerName,
      work.nextMoveOwnerName,
    ]) >= minimumRelatedScore)
    .slice(0, 8);

  const attention = (input.fleet?.needsAttention ?? [])
    .filter((item) => planRelatedScore(document, [
      item.title,
      item.summary,
      item.agentName,
    ]) >= minimumRelatedScore)
    .slice(0, 6);

  const relatedConversationIds = new Set<string>();
  const relatedHarnessSessionIds = new Set<string>();
  for (const ask of asks) if (ask.conversationId) relatedConversationIds.add(ask.conversationId);
  for (const run of runs) {
    if (run.conversationId) relatedConversationIds.add(run.conversationId);
    for (const sessionId of run.traceSessionIds ?? []) relatedHarnessSessionIds.add(sessionId);
  }
  for (const work of workItems) if (work.conversationId) relatedConversationIds.add(work.conversationId);
  for (const item of attention) if (item.conversationId) relatedConversationIds.add(item.conversationId);

  const sessions = input.sessions
    .filter((session) => (
      relatedConversationIds.has(session.id)
      || (session.harnessSessionId ? relatedHarnessSessionIds.has(session.harnessSessionId) : false)
      || planRelatedSessionScore(document, session) >= minimumRelatedScore
    ))
    .slice(0, 8);

  return { asks, runs, sessions, workItems, attention };
}

function OpsInspectorPanel({
  mode,
  agents,
  navigate,
  returnRoute,
}: {
  mode: OpsMode;
  agents: Agent[];
  navigate: (route: Route) => void;
  returnRoute: Route;
}) {
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [detail, setDetail] = useState<OpsDetailSnapshot | null>(() => {
    if (typeof window === "undefined") return null;
    const target = window as typeof window & { scoutOpsDetailSnapshot?: unknown };
    return parseOpsDetailSnapshot(target.scoutOpsDetailSnapshot);
  });

  const load = useCallback(async () => {
    const data = await api<FleetState>("/api/fleet").catch(() => null);
    setFleet(data);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onDetail = (event: Event) => {
      setDetail(parseOpsDetailSnapshot((event as CustomEvent<unknown>).detail));
    };
    window.addEventListener("scout:ops-detail", onDetail);
    return () => window.removeEventListener("scout:ops-detail", onDetail);
  }, []);

  useBrokerEvents((event) => {
    if (
      event.kind === "message.posted" ||
      event.kind === "flight.updated" ||
      event.kind === "collaboration.event.appended"
    ) {
      void load();
    }
  });

  if (mode === "plan") {
    return <PlanContextInspectorPanel navigate={navigate} returnRoute={returnRoute} />;
  }

  const activeAsks = (fleet?.activeAsks ?? []).filter((ask) => ask.status !== "needs_attention");
  const needsAttention = fleet?.needsAttention ?? [];
  const workingAgents = agents.filter((agent) => normalizeAgentState(agent.state) === "working");
  const onlineAgents = agents.filter((agent) => normalizeAgentState(agent.state) !== "offline");
  const recentAgents = [...agents]
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    .slice(0, 7);

  return (
    <div className="ctx-panel ctx-panel--ops-inspector">
      {detail && (
        <section className="ctx-panel-section ctx-panel-selected-detail">
          <div className="ctx-panel-section-label">
            {detail.focus === "flow" ? "Message" : "Selection"}
          </div>
          <div className="ctx-panel-selected-card">
            <div className="ctx-panel-selected-title">{detail.title}</div>
            <div className="ctx-panel-selected-meta">{detail.meta}</div>
            <div className="ctx-panel-selected-body">{detail.body}</div>
            {detail.action && (
              <button
                type="button"
                className="ctx-panel-selected-action"
                onClick={() => navigate(detail.action!.route)}
              >
                {detail.action.label}
              </button>
            )}
          </div>
        </section>
      )}

      <section className="ctx-panel-section ctx-panel-ops-summary">
        <div className="ctx-panel-section-label">Ops Context</div>
        <div className="ctx-panel-ops-mode-card">
          <span>Current</span>
          <strong>{OPS_MODE_LABELS[mode]}</strong>
          <small>{fleet ? `${timeAgo(fleet.generatedAt)} refresh` : "loading"}</small>
        </div>
        <div className="ctx-panel-stat-grid">
          <OpsStat label="Needs" value={needsAttention.length} tone={needsAttention.length > 0 ? "warn" : "ok"} />
          <OpsStat label="Active" value={activeAsks.length} />
          <OpsStat label="Online" value={`${onlineAgents.length}/${agents.length}`} />
          <OpsStat label="Working" value={workingAgents.length} />
        </div>
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Queue
          {needsAttention.length > 0 && <span className="ctx-panel-count">{needsAttention.length}</span>}
        </div>
        {needsAttention.length === 0 ? (
          <div className="ctx-panel-empty">No operator cues</div>
        ) : (
          <div className="ctx-panel-list">
            {needsAttention.slice(0, 5).map((item) => (
              <OpsAttentionButton key={item.recordId} item={item} navigate={navigate} />
            ))}
          </div>
        )}
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Runs
          {activeAsks.length > 0 && <span className="ctx-panel-count">{activeAsks.length}</span>}
        </div>
        {activeAsks.length === 0 ? (
          <div className="ctx-panel-empty">No active asks</div>
        ) : (
          <div className="ctx-panel-list">
            {activeAsks.slice(0, 5).map((ask) => (
              <OpsAskButton key={ask.invocationId} ask={ask} navigate={navigate} />
            ))}
          </div>
        )}
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">Agent Pulse</div>
        <div className="ctx-panel-pulse-list">
          {recentAgents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className="ctx-panel-pulse-row"
              onClick={() => openAgent(navigate, agent, { from: "inspector", returnTo: returnRoute })}
            >
              <span className={`ctx-panel-pulse-dot ctx-panel-pulse-dot--${normalizeAgentState(agent.state)}`} />
              <span>{agent.name}</span>
              <small>{agentStateLabel(agent.state)} · {agent.updatedAt ? timeAgo(agent.updatedAt) : "unknown"}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function PlanContextInspectorPanel({
  navigate,
  returnRoute,
}: {
  navigate: (route: Route) => void;
  returnRoute: Route;
}) {
  const [inventory, setInventory] = useState<PlanDocumentsResponse | null>(null);
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const selectedId = returnRoute.view === "ops" && returnRoute.mode === "plan"
    ? returnRoute.planDocumentId
    : undefined;

  const load = useCallback(async () => {
    const [documentsResult, fleetResult, activeWorkResult, recentWorkResult, runsResult, sessionsResult] = await Promise.allSettled([
      api<PlanDocumentsResponse>("/api/plan-documents"),
      api<FleetState>("/api/fleet"),
      api<WorkItem[]>("/api/work?limit=250"),
      api<WorkItem[]>("/api/work?active=false&limit=250"),
      api<AgentRun[]>("/api/runs?active=false&limit=500"),
      api<SessionEntry[]>("/api/conversations?limit=250"),
    ]);
    if (documentsResult.status === "fulfilled") setInventory(documentsResult.value);
    if (fleetResult.status === "fulfilled") setFleet(fleetResult.value);
    if (activeWorkResult.status === "fulfilled" || recentWorkResult.status === "fulfilled") {
      setWorkItems(mergeInspectorWorkItems([activeWorkResult, recentWorkResult]));
    }
    if (runsResult.status === "fulfilled") setRuns(runsResult.value);
    if (sessionsResult.status === "fulfilled") setSessions(sessionsResult.value);
    setLoaded(true);
  }, []);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  useBrokerEvents((event) => {
    if (
      event.kind === "message.posted" ||
      event.kind === "flight.updated" ||
      event.kind === "collaboration.event.appended"
    ) {
      void load();
    }
  });

  const documents = inventory?.documents ?? [];
  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedId) ?? documents[0] ?? null,
    [documents, selectedId],
  );
  const related = useMemo(
    () => relatedPlanContext(selectedDocument, { fleet, runs, sessions, workItems }),
    [fleet, runs, selectedDocument, sessions, workItems],
  );
  const contextCount = related.attention.length
    + related.workItems.length
    + related.asks.length
    + related.runs.length
    + related.sessions.length;

  if (!selectedDocument) {
    return (
      <div className="ctx-panel ctx-panel--ops-inspector ctx-panel--plan-inspector">
        <section className="ctx-panel-section ctx-panel-ops-summary">
          <div className="ctx-panel-section-label">Plan Context</div>
          <div className="ctx-panel-empty">{loaded ? "No plan document selected" : "Indexing plan documents"}</div>
        </section>
      </div>
    );
  }

  return (
    <div className="ctx-panel ctx-panel--ops-inspector ctx-panel--plan-inspector">
      <section className="ctx-panel-section ctx-panel-plan-summary">
        <div className="ctx-panel-section-label">Plan Context</div>
        <div className="ctx-panel-plan-card">
          <span>Current</span>
          <strong>{selectedDocument.title}</strong>
          <small>{selectedDocument.path} · {timeAgo(selectedDocument.updatedAt)}</small>
          {selectedDocument.summary && <p>{selectedDocument.summary}</p>}
        </div>
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Steps
          <span className="ctx-panel-count">{selectedDocument.steps.length}</span>
        </div>
        {selectedDocument.steps.length === 0 ? (
          <div className="ctx-panel-empty">No checklist steps parsed</div>
        ) : (
          <div className="ctx-panel-plan-step-list">
            {selectedDocument.steps.map((step) => (
              <div key={step.id} className={`ctx-panel-plan-step ctx-panel-plan-step--${step.status}`}>
                <span className="ctx-panel-plan-step-marker">{PLAN_STEP_MARKERS[step.status]}</span>
                <span className="ctx-panel-plan-step-text">{step.text}</span>
                <span className="ctx-panel-plan-step-state">{PLAN_STEP_LABELS[step.status]}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Around This Plan
          <span className="ctx-panel-count">{contextCount}</span>
        </div>
        {contextCount === 0 ? (
          <div className="ctx-panel-empty">No nearby activity matched yet</div>
        ) : null}
      </section>

      <PlanContextSection title="Sessions" count={related.sessions.length}>
        {related.sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            className="ctx-panel-item ctx-panel-plan-context-item"
            onClick={() => openContent(navigate, { view: "conversation", conversationId: session.id }, { returnTo: returnRoute })}
          >
            <div className="ctx-panel-body">
              <span className="ctx-panel-name">{session.title || session.agentName || session.id}</span>
              <span className="ctx-panel-sub">
                {session.kind} · {session.agentName ?? session.harness ?? "session"} · {session.messageCount} msg
              </span>
              <span className="ctx-panel-preview">{session.preview?.trim() || session.workspaceRoot || session.id}</span>
            </div>
          </button>
        ))}
      </PlanContextSection>

      <PlanContextSection title="Work Items" count={related.workItems.length}>
        {related.workItems.map((work) => (
          <button
            key={work.id}
            type="button"
            className="ctx-panel-item ctx-panel-plan-context-item"
            onClick={() => openContent(navigate, { view: "work", workId: work.id }, { returnTo: returnRoute })}
          >
            <div className="ctx-panel-body">
              <span className="ctx-panel-name">{work.title}</span>
              <span className="ctx-panel-sub">{work.currentPhase || work.state} · {timeAgo(work.lastMeaningfulAt || work.updatedAt)}</span>
              {(work.summary || work.lastMeaningfulSummary) && (
                <span className="ctx-panel-preview">{work.summary ?? work.lastMeaningfulSummary}</span>
              )}
            </div>
          </button>
        ))}
      </PlanContextSection>

      <PlanContextSection title="Runs" count={related.runs.length}>
        {related.runs.map((run) => (
          <button
            key={run.id}
            type="button"
            className="ctx-panel-item ctx-panel-plan-context-item"
            onClick={() => navigate(planRouteForRun(run))}
          >
            <div className="ctx-panel-body">
              <span className="ctx-panel-name">{compactPlanText(runTask(run) ?? run.agentName ?? run.id, 120)}</span>
              <span className="ctx-panel-sub">{run.agentName ?? run.agentId} · {run.state} · {timeAgo(run.updatedAt)}</span>
              {runOutputSummary(run) && <span className="ctx-panel-preview">{runOutputSummary(run)}</span>}
            </div>
          </button>
        ))}
      </PlanContextSection>

      <PlanContextSection title="Asks" count={related.asks.length}>
        {related.asks.map((ask) => (
          <button
            key={ask.invocationId}
            type="button"
            className="ctx-panel-item ctx-panel-plan-context-item"
            onClick={() => navigate(planRouteForAsk(ask))}
          >
            <div className="ctx-panel-body">
              <span className="ctx-panel-name">{ask.task}</span>
              <span className="ctx-panel-sub">{ask.agentName ?? ask.agentId} · {ask.statusLabel} · {timeAgo(ask.updatedAt)}</span>
              {ask.summary && <span className="ctx-panel-preview">{ask.summary}</span>}
            </div>
          </button>
        ))}
      </PlanContextSection>

      <PlanContextSection title="Attention" count={related.attention.length}>
        {related.attention.map((item) => {
          const route = planRouteForAttention(item);
          return (
            <button
              key={item.recordId}
              type="button"
              className="ctx-panel-item ctx-panel-item--attention ctx-panel-plan-context-item"
              onClick={() => route && navigate(route)}
              disabled={!route}
            >
              <div className="ctx-panel-body">
                <span className="ctx-panel-name">{item.title}</span>
                <span className="ctx-panel-sub">{item.kind} · {timeAgo(item.updatedAt)}</span>
                {item.summary && <span className="ctx-panel-preview">{item.summary}</span>}
              </div>
            </button>
          );
        })}
      </PlanContextSection>
    </div>
  );
}

function PlanContextSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="ctx-panel-section">
      <div className="ctx-panel-section-label">
        {title}
        <span className="ctx-panel-count">{count}</span>
      </div>
      {count === 0 ? <div className="ctx-panel-empty">None matched</div> : <div className="ctx-panel-list">{children}</div>}
    </section>
  );
}

function planRouteForAsk(ask: FleetAsk): Route {
  if (ask.conversationId) return { view: "conversation", conversationId: ask.conversationId };
  if (ask.collaborationRecordId) return { view: "work", workId: ask.collaborationRecordId };
  return { view: "agents", agentId: ask.agentId };
}

function planRouteForRun(run: AgentRun): Route {
  if (run.conversationId) return { view: "conversation", conversationId: run.conversationId };
  if (run.workId) return { view: "work", workId: run.workId };
  return { view: "agents", agentId: run.agentId };
}

function planRouteForAttention(item: FleetAttentionItem): Route | null {
  if (item.recordId) return { view: "work", workId: item.recordId };
  if (item.conversationId) return { view: "conversation", conversationId: item.conversationId };
  if (item.agentId) return { view: "agents", agentId: item.agentId };
  return null;
}

function OpsStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "ok" | "warn";
}) {
  return (
    <div className={`ctx-panel-stat${tone ? ` ctx-panel-stat--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function parseOpsDetailSnapshot(value: unknown): OpsDetailSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<OpsDetailSnapshot>;
  if (
    (record.focus !== "flow" && record.focus !== "item") ||
    typeof record.title !== "string" ||
    typeof record.meta !== "string" ||
    typeof record.body !== "string"
  ) {
    return null;
  }
  return {
    focus: record.focus,
    title: record.title,
    meta: record.meta,
    body: record.body,
    action: record.action && typeof record.action === "object" ? record.action : null,
  };
}

function OpsAttentionButton({
  item,
  navigate,
}: {
  item: FleetAttentionItem;
  navigate: (route: Route) => void;
}) {
  const { route } = useScout();
  return (
    <button
      type="button"
      className="ctx-panel-item ctx-panel-item--attention"
      onClick={() => {
        if (item.conversationId) {
          openContent(navigate, { view: "conversation", conversationId: item.conversationId }, { returnTo: route });
        } else {
          navigate({ view: "ops", mode: "mission" });
        }
      }}
    >
      <div className="ctx-panel-body">
        <span className="ctx-panel-name">{item.title}</span>
        <span className="ctx-panel-sub">{item.agentName ?? item.agentId ?? "operator"} · {timeAgo(item.updatedAt)}</span>
      </div>
    </button>
  );
}

function OpsAskButton({
  ask,
  navigate,
}: {
  ask: FleetAsk;
  navigate: (route: Route) => void;
}) {
  const { route } = useScout();
  return (
    <button
      type="button"
      className="ctx-panel-item"
      onClick={() => {
        if (ask.conversationId) {
          openContent(navigate, { view: "conversation", conversationId: ask.conversationId }, { returnTo: route });
        } else {
          navigate({ view: "ops", mode: "mission" });
        }
      }}
    >
      <div className="ctx-panel-body">
        <span className="ctx-panel-name">{ask.task}</span>
        <span className="ctx-panel-sub">{ask.agentName ?? ask.agentId} · {ask.statusLabel}</span>
      </div>
    </button>
  );
}
