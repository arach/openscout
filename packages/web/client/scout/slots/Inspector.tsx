import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Check, Copy, X } from "lucide-react";
import { useOptionalFlag } from "hudsonkit/flags";
import { useScout } from "../Provider.tsx";
import { openAgent } from "./openAgent.ts";
import { openContent } from "./openContent.ts";
import { agentStateCssToken, agentStateLabel, normalizeAgentState } from "../../lib/agent-state.ts";
import { api } from "../../lib/api.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
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
import { KnowledgeSearchInspector } from "../../screens/KnowledgeSearchInspector.tsx";
import { usePersistentBoolean, usePersistentNumber } from "../../lib/persistent-state.ts";
import { VerticalResizeHandle } from "./VerticalResizeHandle.tsx";
import type {
  Agent,
  AgentRun,
  BrokerDiagnostics,
  BrokerRouteAttempt,
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
  const scoutbotEnabled = useOptionalFlag("surface.scoutbot", true);
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
    case "search":
      content = <KnowledgeSearchInspector />;
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
        : <BrokerContextPanel />;
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
      {scoutbotEnabled && !scoutbotCollapsed && <VerticalResizeHandle onResizeStart={handleResizeStart} />}
      {scoutbotEnabled && <ScoutbotPanel height={scoutbotCollapsed ? undefined : clampedScoutbotHeight} />}
    </div>
  );
}

function brokerContextPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function brokerContextKindLabel(kind: BrokerRouteAttempt["kind"]): string {
  switch (kind) {
    case "success":
      return "sent";
    case "failed_query":
      return "query";
    case "failed_delivery":
      return "delivery";
    default:
      return "attempt";
  }
}

function brokerContextRouteLabel(route: string | null): string {
  switch (route) {
    case "dm":
      return "direct";
    case "channel":
      return "channel";
    case "broadcast":
      return "broadcast";
    case null:
      return "no route";
    default:
      return route;
  }
}

function brokerContextCounts(rows: BrokerRouteAttempt[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = brokerContextRouteLabel(row.route);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 5);
}

function BrokerContextPanel() {
  const { inspectBrokerAttempt } = useScout();
  const [broker, setBroker] = useState<BrokerDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<BrokerDiagnostics>("/api/broker?limit=160");
      setBroker(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBrokerEvents((event) => {
    if (
      event.kind === "message.posted" ||
      event.kind === "delivery.planned" ||
      event.kind === "delivery.attempted" ||
      event.kind === "delivery.state.changed" ||
      event.kind === "scout.dispatched"
    ) {
      void load();
    }
  });

  const attentionRows = useMemo(
    () => broker
      ? [...broker.failedQueries, ...broker.failedDeliveries]
        .sort((left, right) => right.ts - left.ts)
        .slice(0, 4)
      : [],
    [broker],
  );
  const recentRows = useMemo(
    () => broker
      ? broker.attempts
        .slice()
        .sort((left, right) => right.ts - left.ts)
        .slice(0, 5)
      : [],
    [broker],
  );
  const routeMix = useMemo(
    () => broker
      ? brokerContextCounts([...broker.attempts, ...broker.failedQueries, ...broker.failedDeliveries])
      : [],
    [broker],
  );

  const openAttempt = useCallback((attempt: BrokerRouteAttempt) => {
    inspectBrokerAttempt(attempt);
    window.dispatchEvent(new CustomEvent("scout:set-inspector-width", {
      detail: { width: 420 },
    }));
  }, [inspectBrokerAttempt]);

  if (!broker && !error) {
    return (
      <div className="flex h-full flex-col overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
        <BrokerContextSummaryCard title="Dispatch context" status="Loading broker ledger..." />
      </div>
    );
  }

  if (!broker) {
    return (
      <div className="flex h-full flex-col overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
        <BrokerContextSummaryCard title="Dispatch context" status="Broker diagnostics unavailable" />
        <div className="rounded border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] p-2.5 text-[11px] leading-relaxed text-[var(--scout-chrome-ink-soft)]">
          {error}
        </div>
      </div>
    );
  }

  const failedDeliveries = broker.totals.failedDeliveries + broker.totals.failedDeliveryAttempts;
  const routeTotal = broker.totals.successfulDispatches + broker.totals.failedQueries + failedDeliveries;

  return (
    <div className="flex h-full flex-col overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
      <BrokerContextSummaryCard
        title="Dispatch context"
        status={`${routeTotal} routes in window`}
      >
        <div className="mt-2 grid grid-cols-3 gap-1">
          <BrokerMiniStat label="Sent" value={`${broker.totals.successfulDispatches}`} />
          <BrokerMiniStat label="Query" value={`${broker.totals.failedQueries}`} />
          <BrokerMiniStat label="Delivery" value={`${failedDeliveries}`} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--scout-chrome-border-soft)] pt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-ghost)]">
          <span>{brokerContextPercent(broker.rates.failureRate)} failed</span>
          <span>{timeAgo(broker.generatedAt)}</span>
        </div>
      </BrokerContextSummaryCard>

      <BrokerContextSection label="Route mix">
        <BrokerPillList items={routeMix} empty="No route records visible" />
      </BrokerContextSection>

      <BrokerContextSection label="Needs attention">
        {attentionRows.length === 0 ? (
          <BrokerEmptyLine>No failed routes in this window.</BrokerEmptyLine>
        ) : (
          <div className="flex flex-col gap-1.5">
            {attentionRows.map((attempt) => (
              <BrokerContextAttemptButton
                key={attempt.id}
                attempt={attempt}
                onOpen={openAttempt}
              />
            ))}
          </div>
        )}
      </BrokerContextSection>

      <BrokerContextSection label="Recent dispatch">
        {recentRows.length === 0 ? (
          <BrokerEmptyLine>No recent dispatch rows.</BrokerEmptyLine>
        ) : (
          <div className="flex flex-col gap-1">
            {recentRows.map((attempt) => (
              <BrokerContextAttemptButton
                key={attempt.id}
                attempt={attempt}
                onOpen={openAttempt}
                compact
              />
            ))}
          </div>
        )}
      </BrokerContextSection>
    </div>
  );
}

function BrokerContextSummaryCard({
  title,
  status,
  children,
}: {
  title: string;
  status: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] p-2.5">
      <div className="text-[9px] font-mono uppercase tracking-[0.15em] text-[var(--scout-chrome-ink-faint)]">
        {title}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-soft)]">
        {status}
      </div>
      {children}
    </div>
  );
}

function BrokerMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-sm border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-bg)] px-1.5 py-1">
      <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--scout-chrome-ink-faint)]">
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-[13px] text-[var(--scout-chrome-ink-strong)]">
        {value}
      </div>
    </div>
  );
}

function BrokerContextSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="mb-1.5 text-[9px] font-mono uppercase tracking-[0.15em] text-[var(--scout-chrome-ink-faint)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function BrokerPillList({
  items,
  empty,
}: {
  items: Array<{ label: string; count: number }>;
  empty: string;
}) {
  if (items.length === 0) return <BrokerEmptyLine>{empty}</BrokerEmptyLine>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item.label}
          className="rounded-sm border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--scout-chrome-ink-soft)]"
          title={`${item.count} ${item.label}`}
        >
          {item.label} {item.count}
        </span>
      ))}
    </div>
  );
}

function BrokerEmptyLine({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-ghost)]">
      {children}
    </div>
  );
}

function BrokerContextAttemptButton({
  attempt,
  onOpen,
  compact = false,
}: {
  attempt: BrokerRouteAttempt;
  onOpen: (attempt: BrokerRouteAttempt) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className="rounded border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] px-2 py-1.5 text-left transition-colors hover:border-[var(--scout-chrome-border)]"
      onClick={() => onOpen(attempt)}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-sm bg-[var(--scout-chrome-bg)] px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-[var(--scout-chrome-ink-faint)]">
          {brokerContextKindLabel(attempt.kind)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--scout-chrome-ink)]">
          {attempt.detail}
        </span>
        <span className="shrink-0 font-mono text-[9px] text-[var(--scout-chrome-ink-faint)]">
          {timeAgo(attempt.ts)}
        </span>
      </div>
      {!compact && (
        <div className="mt-0.5 flex items-center gap-2 font-mono text-[9px] text-[var(--scout-chrome-ink-ghost)]">
          <span className="truncate">{attempt.actorName ?? "unknown"}</span>
          <span className="shrink-0">-&gt;</span>
          <span className="truncate">{attempt.target ?? "none"}</span>
        </div>
      )}
    </button>
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
  atop: "Runtime",
  agents: "Agents",
};

type OpsDetailSnapshot = {
  source?: "tail" | "generic";
  focus: "flow" | "item";
  title: string;
  meta: string;
  body: string;
  metadata?: Array<{ label: string; value: string }>;
  copy?: Array<{ label: string; value: string }>;
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

  if (mode === "tail" || mode === "issues") {
    return (
      <OpsTailInspectorPanel
        detail={detail?.source === "tail" ? detail : null}
        mode={mode}
        navigate={navigate}
      />
    );
  }

  const activeAsks = (fleet?.activeAsks ?? []).filter((ask) => ask.status !== "needs_attention");
  const needsAttention = fleet?.needsAttention ?? [];
  const workingAgents = agents.filter((agent) => normalizeAgentState(agent.state) === "working");
  const onlineAgents = agents.filter((agent) => normalizeAgentState(agent.state) !== "not_ready");
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
              <span className={`ctx-panel-pulse-dot ctx-panel-pulse-dot--${agentStateCssToken(agent.state)}`} />
              <span>{agent.name}</span>
              <small>{agentStateLabel(agent.state)} · {agent.updatedAt ? timeAgo(agent.updatedAt) : "unknown"}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function clearOpsDetailSnapshot() {
  if (typeof window === "undefined") return;
  const target = window as typeof window & { scoutOpsDetailSnapshot?: unknown };
  target.scoutOpsDetailSnapshot = null;
  window.dispatchEvent(new CustomEvent("scout:ops-detail", { detail: null }));
}

function OpsTailInspectorPanel({
  detail,
  mode,
  navigate,
}: {
  detail: OpsDetailSnapshot | null;
  mode: OpsMode;
  navigate: (route: Route) => void;
}) {
  const label = mode === "issues" ? "Alert detail" : "Tail detail";
  const messageCopy = detail?.copy?.find((action) => action.label === "Copy message")?.value ?? detail?.body ?? "";
  const metadataCopy = detail?.copy?.find((action) => action.label === "Copy metadata")?.value
    ?? detail?.metadata?.map((row) => `${row.label}: ${row.value}`).join("\n")
    ?? "";

  return (
    <div className="ctx-panel ctx-panel--ops-inspector ctx-panel--tail-inspector">
      <section className="ctx-panel-section ctx-panel-tail-detail">
        <div className="ctx-panel-section-label ctx-panel-tail-detail-label">
          <span>{label}</span>
          {detail && (
            <button
              type="button"
              className="ctx-panel-tail-icon-button"
              onClick={clearOpsDetailSnapshot}
              aria-label="Clear Tail detail"
              title="Clear"
            >
              <X size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>

        {detail ? (
          <div className="ctx-panel-tail-card">
            <div className="ctx-panel-tail-card-head">
              <div className="ctx-panel-tail-card-title">{detail.title}</div>
              <div className="ctx-panel-tail-card-meta">{detail.meta}</div>
            </div>

            {detail.metadata && detail.metadata.length > 0 && (
              <div className="ctx-panel-tail-copy-scope">
                <dl className="ctx-panel-tail-metadata">
                  {detail.metadata.map((row) => (
                    <div key={row.label} className="ctx-panel-tail-metadata-row">
                      <dt>{row.label}</dt>
                      <dd title={row.value}>{row.value}</dd>
                    </div>
                  ))}
                </dl>
                {metadataCopy && <OpsHoverCopyButton label="Copy metadata" value={metadataCopy} />}
              </div>
            )}

            {(detail.action || (detail.copy && detail.copy.length > 0)) && (
              <div className="ctx-panel-tail-actions">
                {detail.action && (
                  <button
                    type="button"
                    className="ctx-panel-tail-action-button"
                    onClick={() => navigate(detail.action!.route)}
                  >
                    {detail.action.label}
                  </button>
                )}
                {detail.copy?.map((copy) => (
                  <button
                    key={copy.label}
                    type="button"
                    className="ctx-panel-tail-action-button"
                    onClick={() => void navigator.clipboard?.writeText(copy.value)}
                  >
                    {copy.label}
                  </button>
                ))}
              </div>
            )}

            <div className="ctx-panel-tail-copy-scope ctx-panel-tail-copy-scope--message">
              <div className="ctx-panel-tail-message">{detail.body}</div>
              {messageCopy && <OpsHoverCopyButton label="Copy message" value={messageCopy} />}
            </div>
          </div>
        ) : (
          <div className="ctx-panel-tail-empty-card">
            <span>Tail</span>
            <strong>No log selected</strong>
          </div>
        )}
      </section>
    </div>
  );
}

function OpsHoverCopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  const onCopy = useCallback(async () => {
    const ok = await copyTextToClipboard(value);
    if (!ok) return;
    setCopied(true);
    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setCopied(false), 1200);
  }, [value]);

  return (
    <button
      type="button"
      className={`ctx-panel-tail-hover-copy${copied ? " ctx-panel-tail-hover-copy--copied" : ""}`}
      onClick={() => void onCopy()}
      title={label}
    >
      {copied ? (
        <Check size={13} strokeWidth={2} aria-hidden="true" />
      ) : (
        <Copy size={13} strokeWidth={1.9} aria-hidden="true" />
      )}
      <span>{copied ? "Copied" : label}</span>
    </button>
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
  const metadata = Array.isArray(record.metadata)
    ? record.metadata.filter((item): item is { label: string; value: string } => (
        item != null &&
        typeof item === "object" &&
        typeof (item as { label?: unknown }).label === "string" &&
        typeof (item as { value?: unknown }).value === "string"
      ))
    : undefined;
  const copy = Array.isArray(record.copy)
    ? record.copy.filter((item): item is { label: string; value: string } => (
        item != null &&
        typeof item === "object" &&
        typeof (item as { label?: unknown }).label === "string" &&
        typeof (item as { value?: unknown }).value === "string"
      ))
    : undefined;
  return {
    source: record.source === "tail" ? "tail" : "generic",
    focus: record.focus,
    title: record.title,
    meta: record.meta,
    body: record.body,
    metadata,
    copy,
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
