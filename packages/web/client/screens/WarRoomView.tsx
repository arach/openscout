import "./warroom-view.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { agentStateLabel, normalizeAgentState } from "../lib/agent-state.ts";
import { api } from "../lib/api.ts";
import { actorColor } from "../lib/colors.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import type {
  ActivityItem,
  Agent,
  FleetActivity,
  FleetAsk,
  FleetAttentionItem,
  FleetState,
  Route,
} from "../lib/types.ts";

type WarRoomSeverity = "critical" | "warning" | "info";
type WarRoomLane = "attention" | "running" | "failed" | "done";

type WarRoomAction = {
  label: string;
  route: Route;
};

type WarRoomItemBase = {
  key: string;
  lane: WarRoomLane;
  severity: WarRoomSeverity;
  pill: string;
  title: string;
  summary: string;
  agentId: string | null;
  agentName: string | null;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  actions: WarRoomAction[];
  meta: string[];
};

type AttentionWarRoomItem = WarRoomItemBase & {
  source: "attention";
  item: FleetAttentionItem;
};

type AskWarRoomItem = WarRoomItemBase & {
  source: "ask";
  item: FleetAsk;
};

type AgentWarRoomItem = WarRoomItemBase & {
  source: "agent";
  item: Agent;
  health: "offline" | "stale";
};

type WarRoomItem = AttentionWarRoomItem | AskWarRoomItem | AgentWarRoomItem;

type AgentHealthRow = {
  key: string;
  name: string;
  state: string;
  detail: string;
  route: Route;
  severity: WarRoomSeverity;
  rank: number;
  updatedAt: number | null;
};

type ActivityLike = ActivityItem | FleetActivity;

type NetworkNodeKind = "operator" | "broker" | "agent" | "external";

type NetworkNode = {
  id: string;
  label: string;
  detail: string;
  kind: NetworkNodeKind;
  x: number;
  y: number;
  state: string;
  weight: number;
  route: Route | null;
};

type NetworkEdge = {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  label: string;
  ts: number;
  route: Route | null;
};

type NetworkModel = {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  visibleEdges: Array<NetworkEdge & { from: NetworkNode; to: NetworkNode }>;
  projects: Array<{ name: string; count: number }>;
  messageRate: number;
};

const AGENT_STALE_MS = 15 * 60_000;
const AGENT_HEALTH_ACTION_WINDOW_MS = 24 * 60 * 60_000;
const MIN_FLOW_WINDOW_MS = 30 * 60_000;
const MAX_FLOW_WINDOW_MS = 24 * 60 * 60_000;
const DEFAULT_FLOW_WINDOW_MS = MIN_FLOW_WINDOW_MS;
const FLOW_WINDOW_OPTIONS = [
  { label: "30m", value: MIN_FLOW_WINDOW_MS },
  { label: "4h", value: 4 * 60 * 60_000 },
  { label: "24h", value: MAX_FLOW_WINDOW_MS },
] as const;
const OPERATOR_NODE_ID = "operator";
const BROKER_NODE_ID = "broker";

function hasRecentAgentUpdate(agent: Agent, nowMs: number): boolean {
  return (
    typeof agent.updatedAt === "number" &&
    Number.isFinite(agent.updatedAt) &&
    agent.updatedAt > 0 &&
    agent.updatedAt <= nowMs &&
    nowMs - agent.updatedAt <= AGENT_HEALTH_ACTION_WINDOW_MS
  );
}

function isAgentStale(agent: Agent, nowMs: number): boolean {
  return (
    normalizeAgentState(agent.state) !== "offline" &&
    hasRecentAgentUpdate(agent, nowMs) &&
    nowMs - (agent.updatedAt ?? nowMs) > AGENT_STALE_MS
  );
}

function kindLabel(kind: string): string {
  return kind.replace(/[._]/g, " ");
}

function summarize(text: string | null | undefined, max = 84): string {
  const compact = (text ?? "").replace(/\s+/g, " ").trim();
  if (!compact) return "No summary available";
  return compact.length > max ? `${compact.slice(0, max - 1)}...` : compact;
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatAge(timestamp: number | null | undefined, nowMs: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "unknown";
  const seconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatWindow(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function clampFlowWindowMs(ms: number): number {
  const roundedMinutes = Math.max(1, Math.round(ms / 60_000));
  return Math.min(MAX_FLOW_WINDOW_MS, Math.max(MIN_FLOW_WINDOW_MS, roundedMinutes * 60_000));
}

function parseFlowWindowInput(value: string): number | null {
  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2] ?? "m";
  const multiplier = unit.startsWith("d")
    ? 24 * 60 * 60_000
    : unit.startsWith("h")
      ? 60 * 60_000
      : 60_000;
  return clampFlowWindowMs(amount * multiplier);
}

function severityRank(severity: WarRoomSeverity): number {
  switch (severity) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    default:
      return 2;
  }
}

function itemSort(left: WarRoomItem, right: WarRoomItem): number {
  const bySeverity = severityRank(left.severity) - severityRank(right.severity);
  if (bySeverity !== 0) return bySeverity;
  return left.updatedAt - right.updatedAt;
}

function recentSort(left: WarRoomItem, right: WarRoomItem): number {
  const bySeverity = severityRank(left.severity) - severityRank(right.severity);
  if (bySeverity !== 0) return bySeverity;
  return right.updatedAt - left.updatedAt;
}

function routeForActivity(item: ActivityItem): Route | null {
  if (item.conversationId) return { view: "conversation", conversationId: item.conversationId };
  return null;
}

function activityActorId(item: ActivityLike): string | null {
  return "actorId" in item ? item.actorId : null;
}

function activityAgentId(item: ActivityLike): string | null {
  return "agentId" in item ? item.agentId : null;
}

function nodeLabelForId(id: string, agentsById: Map<string, Agent>): string {
  if (id === OPERATOR_NODE_ID) return "Operator";
  if (id === BROKER_NODE_ID) return "Broker";
  const agent = agentsById.get(id);
  if (agent) return agent.name;
  return id
    .replace(/\.mini$/, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeMention(value: string): string {
  return value.replace(/^@/, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function mentionedAgentId(text: string | null | undefined, agents: Agent[]): string | null {
  if (!text) return null;
  const mention = text.match(/@([a-zA-Z0-9][a-zA-Z0-9._-]+)/)?.[1];
  if (!mention) return null;
  const normalized = normalizeMention(mention);
  const match = agents.find((agent) => {
    return [
      agent.id,
      agent.name,
      agent.handle ?? "",
      agent.selector ?? "",
    ].some((candidate) => normalizeMention(candidate) === normalized);
  });
  return match?.id ?? null;
}

function targetFromConversation(item: ActivityLike, actorId: string | null): string | null {
  const conversationId = item.conversationId;
  if (!conversationId || !conversationId.startsWith("dm.")) return null;
  if (conversationId.startsWith("dm.operator.")) return OPERATOR_NODE_ID;
  if (actorId && conversationId.startsWith(`dm.${actorId}.`)) {
    return conversationId.slice(`dm.${actorId}.`.length) || null;
  }
  if (actorId && conversationId.endsWith(`.${actorId}`)) {
    return conversationId.slice(3, -(`.${actorId}`.length)) || null;
  }
  return null;
}

function activityTargetId(item: ActivityLike, agents: Agent[]): string {
  const actorId = activityActorId(item);
  const kind = item.kind;
  const mentioned = mentionedAgentId(item.title ?? item.summary, agents);
  const conversationTarget = targetFromConversation(item, actorId);

  if (kind === "ask_replied" || kind === "flight_updated") {
    return OPERATOR_NODE_ID;
  }
  if (mentioned && mentioned !== actorId) return mentioned;
  if (conversationTarget && conversationTarget !== actorId) return conversationTarget;
  const agentId = activityAgentId(item);
  if (agentId && agentId !== actorId) return agentId;
  return BROKER_NODE_ID;
}

function activitySourceId(item: ActivityLike): string {
  return activityActorId(item) ?? activityAgentId(item) ?? BROKER_NODE_ID;
}

function buildNetworkModel(activity: ActivityLike[], agents: Agent[]): NetworkModel {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const nodeWeights = new Map<string, number>();
  const edges = activity.slice(0, 48).map((item, index): NetworkEdge => {
    const fromId = activitySourceId(item);
    const toId = activityTargetId(item, agents);
    nodeWeights.set(fromId, (nodeWeights.get(fromId) ?? 0) + 1);
    nodeWeights.set(toId, (nodeWeights.get(toId) ?? 0) + 1);
    return {
      id: item.id,
      fromId,
      toId,
      kind: item.kind,
      label: summarize(item.title ?? item.summary, 92),
      ts: item.ts,
      route: routeForActivity(item),
    };
  });

  const activeIds = [...nodeWeights.entries()]
    .filter(([id]) => id !== OPERATOR_NODE_ID && id !== BROKER_NODE_ID)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 18)
    .map(([id]) => id);

  const visibleIds = new Set([OPERATOR_NODE_ID, BROKER_NODE_ID, ...activeIds]);
  const width = 1000;
  const height = 620;
  const nodes: NetworkNode[] = [
    {
      id: OPERATOR_NODE_ID,
      label: "Operator",
      detail: "command",
      kind: "operator",
      x: 118,
      y: height / 2,
      state: "online",
      weight: nodeWeights.get(OPERATOR_NODE_ID) ?? 0,
      route: null,
    },
    {
      id: BROKER_NODE_ID,
      label: "Broker",
      detail: "message fabric",
      kind: "broker",
      x: 492,
      y: height / 2,
      state: "mesh",
      weight: nodeWeights.get(BROKER_NODE_ID) ?? 0,
      route: { view: "fleet" },
    },
  ];

  activeIds.forEach((id, index) => {
    const agent = agentsById.get(id);
    const total = Math.max(1, activeIds.length);
    const angle = -Math.PI * 0.62 + (index / Math.max(1, total - 1)) * Math.PI * 1.24;
    const ring = index % 2 === 0 ? 250 : 315;
    const x = 630 + Math.cos(angle) * ring;
    const y = height / 2 + Math.sin(angle) * 235;
    nodes.push({
      id,
      label: nodeLabelForId(id, agentsById),
      detail: agent?.project ?? agent?.role ?? agent?.agentClass ?? "agent endpoint",
      kind: agent ? "agent" : "external",
      x: Math.max(250, Math.min(width - 70, x)),
      y: Math.max(70, Math.min(height - 70, y)),
      state: agent ? agentStateLabel(agent.state) : "External",
      weight: nodeWeights.get(id) ?? 0,
      route: agent ? { view: "agents", agentId: agent.id } : null,
    });
  });

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const visibleEdges = edges
    .filter((edge) => visibleIds.has(edge.fromId) || visibleIds.has(edge.toId))
    .slice(0, 26)
    .map((edge) => {
      const from = nodeMap.get(edge.fromId) ?? nodeMap.get(BROKER_NODE_ID)!;
      const to = nodeMap.get(edge.toId) ?? nodeMap.get(BROKER_NODE_ID)!;
      return { ...edge, from, to };
    });

  const projects = [...agents.reduce((map, agent) => {
    const key = agent.project ?? agent.role ?? agent.agentClass ?? "unassigned";
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>())]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));

  return {
    nodes,
    edges,
    visibleEdges,
    projects,
    messageRate: activity.length,
  };
}

function actionsForAttention(item: FleetAttentionItem): WarRoomAction[] {
  const actions: WarRoomAction[] = [];
  if (item.recordId) actions.push({ label: "Open work", route: { view: "work", workId: item.recordId } });
  if (item.conversationId) {
    actions.push({ label: "Open conversation", route: { view: "conversation", conversationId: item.conversationId } });
  }
  if (item.agentId) actions.push({ label: "Open agent", route: { view: "agents", agentId: item.agentId } });
  return actions;
}

function actionsForAsk(ask: FleetAsk): WarRoomAction[] {
  const actions: WarRoomAction[] = [];
  if (ask.collaborationRecordId) {
    actions.push({ label: "Open work", route: { view: "work", workId: ask.collaborationRecordId } });
  }
  if (ask.conversationId) {
    actions.push({ label: "Open conversation", route: { view: "conversation", conversationId: ask.conversationId } });
  }
  actions.push({ label: "Open agent", route: { view: "agents", agentId: ask.agentId } });
  return actions;
}

function actionForAgent(agent: Agent): WarRoomAction[] {
  return [{ label: "Open agent", route: { view: "agents", agentId: agent.id } }];
}

function attentionItem(item: FleetAttentionItem): WarRoomItem {
  const isQuestion = item.kind === "question";
  return {
    source: "attention",
    item,
    key: `attention:${item.recordId}`,
    lane: "attention",
    severity: isQuestion ? "critical" : "warning",
    pill: isQuestion ? "Needs answer" : "Needs input",
    title: item.title || "Unresolved work",
    summary: summarize(item.summary, 140),
    agentId: item.agentId,
    agentName: item.agentName,
    updatedAt: item.updatedAt,
    startedAt: null,
    completedAt: null,
    actions: actionsForAttention(item),
    meta: [
      item.agentName ?? "Unassigned",
      kindLabel(item.kind),
      item.state,
      item.acceptanceState,
    ],
  };
}

function askLane(ask: FleetAsk): WarRoomLane {
  if (ask.status === "failed") return "failed";
  if (ask.status === "completed") return "done";
  return "running";
}

function askSeverity(ask: FleetAsk): WarRoomSeverity {
  if (ask.status === "failed") return "critical";
  if (ask.attention === "interrupt") return "critical";
  if (ask.attention === "badge" || ask.status === "needs_attention") return "warning";
  return "info";
}

function askItem(ask: FleetAsk): WarRoomItem {
  return {
    source: "ask",
    item: ask,
    key: `ask:${ask.invocationId}`,
    lane: askLane(ask),
    severity: askSeverity(ask),
    pill: ask.statusLabel,
    title: ask.task || "Delegated ask",
    summary: summarize(ask.summary, 140),
    agentId: ask.agentId,
    agentName: ask.agentName ?? ask.agentId,
    updatedAt: ask.updatedAt,
    startedAt: ask.startedAt,
    completedAt: ask.completedAt,
    actions: actionsForAsk(ask),
    meta: [
      ask.agentName ?? ask.agentId,
      ask.harness ?? "unknown harness",
      ask.transport ?? "unknown transport",
    ],
  };
}

function agentHealthItem(agent: Agent, nowMs: number): WarRoomItem | null {
  const state = normalizeAgentState(agent.state);
  const stale = isAgentStale(agent, nowMs);
  const recentlyOffline = state === "offline" && hasRecentAgentUpdate(agent, nowMs);
  if (!recentlyOffline && !stale) return null;

  const health = state === "offline" ? "offline" : "stale";
  return {
    source: "agent",
    item: agent,
    health,
    key: `agent:${health}:${agent.id}`,
    lane: "attention",
    severity: "warning",
    pill: state === "offline" ? "Offline" : "Stale",
    title: agent.name,
    summary: state === "offline"
      ? "Agent endpoint is offline."
      : `No endpoint update for ${formatAge(agent.updatedAt, nowMs)}.`,
    agentId: agent.id,
    agentName: agent.name,
    updatedAt: agent.updatedAt ?? nowMs,
    startedAt: null,
    completedAt: null,
    actions: actionForAgent(agent),
    meta: [
      agentStateLabel(agent.state),
      agent.project ?? agent.role ?? agent.agentClass,
      agent.harness ?? "unknown harness",
    ],
  };
}

function deriveWarRoomItems(fleet: FleetState | null, agents: Agent[], nowMs: number): WarRoomItem[] {
  const attention = (fleet?.needsAttention ?? []).map(attentionItem);
  const active = (fleet?.activeAsks ?? []).map(askItem);
  const recent = (fleet?.recentCompleted ?? []).map(askItem);
  const health = agents
    .map((agent) => agentHealthItem(agent, nowMs))
    .filter((item): item is WarRoomItem => Boolean(item));

  return [...attention, ...active, ...recent, ...health];
}

function deriveHealthRows(agents: Agent[], nowMs: number): AgentHealthRow[] {
  return agents
    .map((agent): AgentHealthRow => {
      const state = normalizeAgentState(agent.state);
      const stale = isAgentStale(agent, nowMs);
      const recent = hasRecentAgentUpdate(agent, nowMs);
      const severity: WarRoomSeverity = stale || (state === "offline" && recent) ? "warning" : "info";
      const label = stale && state !== "offline" ? "Stale" : agentStateLabel(agent.state);
      const rank = stale
        ? 0
        : state === "working"
          ? 1
          : state === "available"
            ? 2
            : recent
              ? 3
              : 4;
      return {
        key: agent.id,
        name: agent.name,
        state: label,
        detail: `${agent.project ?? agent.role ?? agent.agentClass} / updated ${formatAge(agent.updatedAt, nowMs)} ago`,
        route: { view: "agents", agentId: agent.id },
        severity,
        rank,
        updatedAt: agent.updatedAt,
      };
    })
    .sort((left, right) => {
      return left.rank - right.rank || (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.name.localeCompare(right.name);
    });
}

function classForDecision(item: WarRoomItem, selected: boolean): string {
  const classes = [
    "s-warroom-decision",
    `s-warroom-decision--${item.severity}`,
  ];
  if (selected) classes.push("s-warroom-decision--selected");
  return classes.join(" ");
}

function kpiClass(warn: boolean, hot = false): string {
  const classes = ["s-warroom-kpi"];
  if (warn) classes.push("s-warroom-kpi--warn");
  if (hot) classes.push("s-warroom-kpi--hot");
  return classes.join(" ");
}

export function WarRoomView({
  navigate,
  agents,
}: {
  navigate: (r: Route) => void;
  agents: Agent[];
}) {
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [fallbackActivity, setFallbackActivity] = useState<ActivityItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [inspectorFocus, setInspectorFocus] = useState<"flow" | "item">("flow");
  const [flowWindowMs, setFlowWindowMs] = useState<number>(DEFAULT_FLOW_WINDOW_MS);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const nextFleet = await api<FleetState>("/api/fleet");
      setFleet(nextFleet);
      if (nextFleet.activity.length > 0) {
        setFallbackActivity([]);
      } else {
        setFallbackActivity(await api<ActivityItem[]>("/api/activity"));
      }
    } catch {
      const activityResult = await Promise.allSettled([
        api<ActivityItem[]>("/api/activity"),
      ]);
      if (activityResult[0].status === "fulfilled") {
        setFallbackActivity(activityResult[0].value);
      }
    }
    setNowMs(Date.now());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBrokerEvents(() => {
    void load();
  });

  useEffect(() => {
    const intervalId = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  const activityFeed = useMemo<Array<ActivityItem | FleetActivity>>(
    () => (fleet?.activity.length ? fleet.activity : fallbackActivity),
    [fallbackActivity, fleet?.activity],
  );

  const flowActivity = useMemo<Array<ActivityItem | FleetActivity>>(() => {
    const startMs = nowMs - flowWindowMs;
    return activityFeed.filter((item) => item.ts >= startMs && item.ts <= nowMs);
  }, [activityFeed, flowWindowMs, nowMs]);

  const networkModel = useMemo(
    () => buildNetworkModel(flowActivity, agents),
    [flowActivity, agents],
  );
  const eventsInWindow = networkModel.messageRate;

  const items = useMemo(
    () => deriveWarRoomItems(fleet, agents, nowMs),
    [agents, fleet, nowMs],
  );

  const queueItems = useMemo(
    () =>
      items
        .filter((item) => item.lane === "attention" || item.lane === "failed")
        .sort(itemSort),
    [items],
  );

  const lanes = useMemo<Record<WarRoomLane, WarRoomItem[]>>(() => ({
    attention: items.filter((item) => item.lane === "attention").sort(itemSort),
    running: items.filter((item) => item.lane === "running").sort(recentSort),
    failed: items.filter((item) => item.lane === "failed").sort(itemSort),
    done: items.filter((item) => item.lane === "done").sort(recentSort).slice(0, 8),
  }), [items]);

  useEffect(() => {
    const nextKey = queueItems[0]?.key ?? lanes.running[0]?.key ?? lanes.done[0]?.key ?? null;
    if (!nextKey) {
      if (selectedKey !== null) setSelectedKey(null);
      return;
    }
    if (!selectedKey || !items.some((item) => item.key === selectedKey)) {
      setSelectedKey(nextKey);
    }
  }, [items, lanes.done, lanes.running, queueItems, selectedKey]);

  const selectedItem = useMemo(
    () => items.find((item) => item.key === selectedKey) ?? queueItems[0] ?? lanes.running[0] ?? lanes.done[0] ?? null,
    [items, lanes.done, lanes.running, queueItems, selectedKey],
  );

  const failedCount = lanes.failed.length;
  const onlineCount = agents.filter((agent) => normalizeAgentState(agent.state) !== "offline").length;
  const actionNeededCount = queueItems.filter((item) => item.severity !== "info").length;
  const healthRows = useMemo(() => deriveHealthRows(agents, nowMs), [agents, nowMs]);
  const flowNodeLabels = useMemo(
    () => new Map(networkModel.nodes.map((node) => [node.id, node.label])),
    [networkModel.nodes],
  );
  const selectedFlow = useMemo(
    () => networkModel.edges.find((edge) => edge.id === selectedFlowId) ?? null,
    [networkModel.edges, selectedFlowId],
  );
  const freshness = fleet ? `${formatAge(fleet.generatedAt, nowMs)} ago` : "loading";
  const inspectorMeta = inspectorFocus === "flow"
    ? selectedFlow ? kindLabel(selectedFlow.kind) : "No selection"
    : selectedItem ? selectedItem.pill : "No selection";

  return (
    <div className="s-warroom">
      <header className="s-warroom-command">
        <div className="s-warroom-command-main">
          <div className="s-warroom-title">Command</div>
          <div className="s-warroom-subtitle">Live fleet decisions, message flow, and handoffs.</div>
          <div className="s-warroom-statusline">
            Freshness {freshness} / Local time {formatClock(nowMs)}
          </div>
        </div>
        <div className="s-warroom-kpis">
          <Kpi label="Action needed" value={String(actionNeededCount)} detail={`${queueItems.length} queued`} warn={actionNeededCount > 0} hot={failedCount > 0} />
          <Kpi label="Online" value={`${onlineCount}/${agents.length}`} detail="agents" warn={onlineCount < agents.length} />
          <Kpi label="Messages" value={String(eventsInWindow)} detail={`last ${formatWindow(flowWindowMs)}`} />
        </div>
      </header>

      <div className="s-warroom-layout">
        <aside className="s-warroom-queue">
          <SectionHead title="State" meta={queueItems.length === 0 ? "clear" : `${queueItems.length} priority`} />
          <CommandStack
            queueItems={queueItems}
            selectedKey={selectedItem?.key ?? null}
            nowMs={nowMs}
            onSelect={(key) => {
              setSelectedKey(key);
              setInspectorFocus("item");
            }}
          />
        </aside>

        <main className="s-warroom-board">
          <SectionHead title="Message Topology" meta={`${networkModel.visibleEdges.length} visible flows / ${formatWindow(flowWindowMs)}`} />
          <MessageTopology
            network={networkModel}
            nowMs={nowMs}
            flowWindowMs={flowWindowMs}
            selectedFlowId={inspectorFocus === "flow" ? selectedFlow?.id ?? null : null}
            onFlowWindowChange={setFlowWindowMs}
            onSelectFlow={(flowId) => {
              setSelectedFlowId(flowId);
              setInspectorFocus("flow");
            }}
          />
        </main>

        <aside className="s-warroom-inspector">
          <SectionHead title="Inspector" meta={inspectorMeta} />
          {inspectorFocus === "flow" ? (
            selectedFlow ? (
              <FlowInspector
                edge={selectedFlow}
                nodeLabels={flowNodeLabels}
                nowMs={nowMs}
                navigate={navigate}
              />
            ) : (
              <div className="s-warroom-empty">Select a message flow to inspect.</div>
            )
          ) : selectedItem ? (
            <Inspector item={selectedItem} nowMs={nowMs} navigate={navigate} />
          ) : (
            <div className="s-warroom-empty">Select an item to inspect.</div>
          )}

          <section className="s-warroom-inspector-card">
            <div className="s-warroom-inspector-title">Agent health</div>
            <div className="s-warroom-health">
              {healthRows.slice(0, 8).map((row) => (
                <button
                  key={row.key}
                  type="button"
                  className="s-warroom-health-row"
                  onClick={() => navigate(row.route)}
                >
                  <span className="s-warroom-dot" />
                  <span>{row.name}</span>
                  <span>{row.state}</span>
                  <span>{row.detail}</span>
                </button>
              ))}
            </div>
          </section>

        </aside>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  detail,
  warn = false,
  hot = false,
}: {
  label: string;
  value: string;
  detail: string;
  warn?: boolean;
  hot?: boolean;
}) {
  return (
    <div className={kpiClass(warn, hot)}>
      <div className="s-warroom-kpi-label">{label}</div>
      <div className="s-warroom-kpi-value">{value}</div>
      <div className="s-warroom-kpi-detail">{detail}</div>
    </div>
  );
}

function SectionHead({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="s-warroom-section-head">
      <div className="s-warroom-section-title">{title}</div>
      <div className="s-warroom-section-meta">{meta}</div>
    </div>
  );
}

function CommandStack({
  queueItems,
  selectedKey,
  nowMs,
  onSelect,
}: {
  queueItems: WarRoomItem[];
  selectedKey: string | null;
  nowMs: number;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="s-warroom-command-stack">
      <div className="s-warroom-readiness">
        <div className="s-warroom-readiness-mark">{queueItems.length === 0 ? "CLEAR" : "ACTION"}</div>
        <div className="s-warroom-readiness-body">
          {queueItems.length === 0
            ? "No operator decisions are blocking the fleet. The topology remains the primary signal."
            : "Operator input is needed before the fleet can fully drain."}
        </div>
      </div>

      {queueItems.length > 0 && (
        <>
          <div className="s-warroom-section-head s-warroom-section-head--tight">
            <div className="s-warroom-section-title">Decision Queue</div>
            <div className="s-warroom-section-meta">{queueItems.length} priority</div>
          </div>
          <div className="s-warroom-queue-list">
            {queueItems.slice(0, 4).map((item) => (
              <DecisionButton
                key={item.key}
                item={item}
                nowMs={nowMs}
                selected={item.key === selectedKey}
                onSelect={() => onSelect(item.key)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DecisionButton({
  item,
  nowMs,
  selected,
  onSelect,
}: {
  item: WarRoomItem;
  nowMs: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={classForDecision(item, selected)}
      onClick={onSelect}
    >
      <div className="s-warroom-decision-top">
        <span className="s-warroom-pill">{item.pill}</span>
        <span className="s-warroom-age">{formatAge(item.updatedAt, nowMs)} ago</span>
      </div>
      <div className="s-warroom-decision-title">{item.title}</div>
      <div className="s-warroom-decision-summary">{item.summary}</div>
      <div className="s-warroom-decision-meta">
        {item.meta.filter(Boolean).map((part, index) => (
          <span key={`${item.key}:meta:${index}`}>{part}</span>
        ))}
      </div>
    </button>
  );
}

function MessageTopology({
  network,
  nowMs,
  flowWindowMs,
  selectedFlowId,
  onFlowWindowChange,
  onSelectFlow,
}: {
  network: NetworkModel;
  nowMs: number;
  flowWindowMs: number;
  selectedFlowId: string | null;
  onFlowWindowChange: (windowMs: number) => void;
  onSelectFlow: (flowId: string) => void;
}) {
  const visibleEdgeSet = new Set(network.visibleEdges.map((edge) => edge.id));
  const nodeLabels = new Map(network.nodes.map((node) => [node.id, node.label]));
  const visibleNodes = network.nodes;
  const latestEdge = network.visibleEdges[0] ?? null;
  const [draftFlowWindow, setDraftFlowWindow] = useState(formatWindow(flowWindowMs));

  useEffect(() => {
    setDraftFlowWindow(formatWindow(flowWindowMs));
  }, [flowWindowMs]);

  const commitFlowWindowDraft = (value = draftFlowWindow) => {
    const nextWindowMs = parseFlowWindowInput(value);
    if (!nextWindowMs) {
      setDraftFlowWindow(formatWindow(flowWindowMs));
      return;
    }
    onFlowWindowChange(nextWindowMs);
  };

  return (
    <div className="s-warroom-topology">
      <div className="s-warroom-windowbar">
        <div className="s-warroom-windowbar-copy">
          <span>Flow window</span>
          <strong>Last {formatWindow(flowWindowMs)}</strong>
        </div>
        <div className="s-warroom-window-controls">
          <div className="s-warroom-window-tabs" aria-label="Message flow window presets">
            {FLOW_WINDOW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`s-warroom-window-tab${option.value === flowWindowMs ? " s-warroom-window-tab--active" : ""}`}
                onClick={() => onFlowWindowChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <form
            className="s-warroom-window-custom"
            onSubmit={(event) => {
              event.preventDefault();
              commitFlowWindowDraft();
            }}
          >
            <label htmlFor="s-warroom-window-custom-input">Custom</label>
            <input
              id="s-warroom-window-custom-input"
              aria-label="Custom message flow window"
              value={draftFlowWindow}
              onChange={(event) => setDraftFlowWindow(event.currentTarget.value)}
              onBlur={(event) => commitFlowWindowDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitFlowWindowDraft(event.currentTarget.value);
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDraftFlowWindow(formatWindow(flowWindowMs));
                  event.currentTarget.blur();
                }
              }}
              spellCheck={false}
            />
          </form>
        </div>
      </div>
      <div className="s-warroom-map">
        <svg className="s-warroom-map-svg" viewBox="0 0 1000 620" role="img" aria-label="Live message topology">
          <defs>
            <radialGradient id="warroomNodeGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
            <filter id="warroomPacketGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g className="s-warroom-map-grid" aria-hidden="true">
            {Array.from({ length: 13 }).map((_, index) => (
              <line key={`v-${index}`} x1={index * 84} y1="0" x2={index * 84} y2="620" />
            ))}
            {Array.from({ length: 8 }).map((_, index) => (
              <line key={`h-${index}`} x1="0" y1={index * 88} x2="1000" y2={index * 88} />
            ))}
          </g>

          <g className="s-warroom-map-projects">
            {network.projects.map((project, index) => (
              <g key={project.name} transform={`translate(${760 + (index % 2) * 100}, ${72 + Math.floor(index / 2) * 38})`}>
                <rect width="86" height="22" rx="4" />
                <text x="8" y="14">{project.name.slice(0, 12)}</text>
                <text x="72" y="14" textAnchor="end">{project.count}</text>
              </g>
            ))}
          </g>

          <g className="s-warroom-map-links">
            {network.visibleEdges.map((edge, index) => (
              <line
                key={`${edge.id}:line:${index}`}
                x1={edge.from.x}
                y1={edge.from.y}
                x2={edge.to.x}
                y2={edge.to.y}
                opacity={Math.max(0.18, 0.72 - index * 0.02)}
              />
            ))}
          </g>

          <g className="s-warroom-map-packets" filter="url(#warroomPacketGlow)">
            {network.visibleEdges.slice(0, 18).map((edge, index) => {
              const path = `M ${edge.from.x} ${edge.from.y} L ${edge.to.x} ${edge.to.y}`;
              return (
                <g key={`${edge.id}:packet:${index}`}>
                  <circle className="s-warroom-packet" r={index < 5 ? 4.2 : 3.2}>
                    <animateMotion
                      dur={`${4.2 + (index % 5) * 0.42}s`}
                      begin={`${-(index * 0.33)}s`}
                      repeatCount="indefinite"
                      path={path}
                    />
                  </circle>
                  {index < 7 && (
                    <circle className="s-warroom-packet s-warroom-packet--ghost" r="8">
                      <animateMotion
                        dur={`${4.2 + (index % 5) * 0.42}s`}
                        begin={`${-(index * 0.33)}s`}
                        repeatCount="indefinite"
                        path={path}
                      />
                    </circle>
                  )}
                </g>
              );
            })}
          </g>

          <g className="s-warroom-map-nodes">
            {visibleNodes.map((node) => (
              <g key={node.id} className={`s-warroom-map-node s-warroom-map-node--${node.kind}`} transform={`translate(${node.x}, ${node.y})`}>
                <circle className="s-warroom-map-node-glow" r={22 + Math.min(16, node.weight * 2)} />
                <circle className="s-warroom-map-node-core" r={node.kind === "operator" || node.kind === "broker" ? 20 : 15} fill={actorColor(node.label)} />
                <text className="s-warroom-map-node-initial" y="4" textAnchor="middle">{node.label[0]?.toUpperCase()}</text>
                <text className="s-warroom-map-node-label" y={node.kind === "agent" || node.kind === "external" ? 33 : 40} textAnchor="middle">{node.label}</text>
                <text className="s-warroom-map-node-detail" y={node.kind === "agent" || node.kind === "external" ? 47 : 54} textAnchor="middle">{node.detail}</text>
              </g>
            ))}
          </g>
        </svg>

        <div className="s-warroom-map-caption">
          <span>{network.nodes.length} nodes</span>
          <span>{network.edges.length} messages / {formatWindow(flowWindowMs)}</span>
          <span>latest {latestEdge ? formatAge(latestEdge.ts, nowMs) : "none"} ago</span>
        </div>
      </div>

      <div className="s-warroom-flow-ledger">
        <div className="s-warroom-flow-ledger-head">
          <span>Window message flow</span>
          <span>{network.visibleEdges.length} routes</span>
        </div>
        <div className="s-warroom-flow-list">
          {network.edges.length === 0 ? (
            <div className="s-warroom-empty">No messages in the last {formatWindow(flowWindowMs)}.</div>
          ) : (
            network.edges.slice(0, 10).map((edge) => (
              <FlowRow
              key={edge.id}
              edge={edge}
              active={visibleEdgeSet.has(edge.id)}
              selected={edge.id === selectedFlowId}
              nodeLabels={nodeLabels}
              onSelect={() => onSelectFlow(edge.id)}
            />
          ))
          )}
        </div>
      </div>
    </div>
  );
}

function FlowRow({
  edge,
  active,
  selected,
  nodeLabels,
  onSelect,
}: {
  edge: NetworkEdge;
  active: boolean;
  selected: boolean;
  nodeLabels: Map<string, string>;
  onSelect: () => void;
}) {
  const content = (
    <>
      <span className="s-warroom-flow-route">
        {nodeLabels.get(edge.fromId) ?? nodeLabelForId(edge.fromId, new Map())} <span>→</span> {nodeLabels.get(edge.toId) ?? nodeLabelForId(edge.toId, new Map())}
      </span>
      <span className="s-warroom-flow-kind">{kindLabel(edge.kind)}</span>
      <span className="s-warroom-flow-title">{edge.label}</span>
    </>
  );

  return (
    <button
      type="button"
      className={`s-warroom-flow-row${active ? " s-warroom-flow-row--active" : ""}${selected ? " s-warroom-flow-row--selected" : ""}`}
      onClick={onSelect}
    >
      {content}
    </button>
  );
}

function FlowInspector({
  edge,
  nodeLabels,
  nowMs,
  navigate,
}: {
  edge: NetworkEdge;
  nodeLabels: Map<string, string>;
  nowMs: number;
  navigate: (route: Route) => void;
}) {
  const from = nodeLabels.get(edge.fromId) ?? nodeLabelForId(edge.fromId, new Map());
  const to = nodeLabels.get(edge.toId) ?? nodeLabelForId(edge.toId, new Map());

  return (
    <section className="s-warroom-inspector-card">
      <div className="s-warroom-inspector-title">{from} {"->"} {to}</div>
      <div className="s-warroom-inspector-meta">
        <span>{kindLabel(edge.kind)}</span>
        <span>{formatAge(edge.ts, nowMs)} ago</span>
      </div>
      <div className="s-warroom-inspector-body">{edge.label}</div>
      <div className="s-warroom-actions">
        {edge.route ? (
          <button
            type="button"
            className="s-warroom-action"
            onClick={() => navigate(edge.route!)}
          >
            Open conversation
          </button>
        ) : (
          <span className="s-warroom-empty">No route available.</span>
        )}
      </div>
    </section>
  );
}

function Inspector({
  item,
  nowMs,
  navigate,
}: {
  item: WarRoomItem;
  nowMs: number;
  navigate: (route: Route) => void;
}) {
  return (
    <section className="s-warroom-inspector-card">
      <div className="s-warroom-inspector-title">{item.title}</div>
      <div className="s-warroom-inspector-meta">
        {item.pill} / updated {formatAge(item.updatedAt, nowMs)} ago
      </div>
      <div className="s-warroom-inspector-body">{item.summary}</div>
      <div className="s-warroom-inspector-meta">
        {item.meta.filter(Boolean).map((part, index) => (
          <span key={`${item.key}:inspector-meta:${index}`}>{part}</span>
        ))}
      </div>
      <div className="s-warroom-actions">
        {item.actions.length === 0 ? (
          <span className="s-warroom-empty">No route available.</span>
        ) : (
          item.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="s-warroom-action"
              onClick={() => navigate(action.route)}
            >
              {action.label}
            </button>
          ))
        )}
      </div>
    </section>
  );
}
