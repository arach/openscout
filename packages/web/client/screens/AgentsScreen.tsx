import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkList } from "../components/WorkList.tsx";
import { agentStateLabel, normalizeAgentState } from "../lib/agent-state.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { api } from "../lib/api.ts";
import { dismissOperatorAttention } from "../lib/operator-attention.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { queueTakeover } from "../lib/terminal-takeover.ts";
import { conversationForAgent } from "../lib/router.ts";
import { BackToPicker } from "../scout/slots/BackToPicker.tsx";
import { openContent } from "../scout/slots/openContent.ts";
import { useScout } from "../scout/Provider.tsx";
import { useContextMenu, type MenuItem } from "../components/ContextMenu.tsx";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable.tsx";
import { VantageHandoffButton } from "../components/VantageHandoffButton.tsx";
import type {
  AgentTab,
  Agent,
  AgentObservePayload,
  FleetAsk,
  FleetState,
  LocalAgentContextState,
  Message,
  Route,
  SessionEntry,
  SessionCatalogWithResume,
  WorkItem,
} from "../lib/types.ts";
import { ConversationScreen } from "./ConversationScreen.tsx";
import { SessionObserve } from "./SessionObserve.tsx";
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
    if (!conversationByAgentId.has(session.agentId)) {
      conversationByAgentId.set(session.agentId, session.id);
      sessionByAgentId.set(session.agentId, session);
    }
  }
  return { conversationByAgentId, sessionByAgentId };
}

type AgentInventoryStatus = "working" | "available" | "offline";

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

const AGENT_STATUS_RANK: Record<AgentInventoryStatus, number> = {
  working: 0,
  available: 1,
  offline: 2,
};

function basename(path: string | null | undefined): string | null {
  if (!path) return null;
  const cleaned = path.replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
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

function AgentInventoryStatusCell({ row }: { row: AgentInventoryRow }) {
  return (
    <span className={`s-agents-inventory-status s-agents-inventory-status--${row.status}`}>
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

function resolveSelectedAgent(agents: Agent[], selectedAgentId?: string): Agent | null {
  if (!selectedAgentId) return null;

  const exact = agents.find((a) => a.id === selectedAgentId);
  if (exact) return exact;

  const handle = selectedAgentId.split(".")[0];
  if (!handle) return null;

  return [...agents]
    .filter((a) => a.handle === handle || a.id.startsWith(`${handle}.`))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null;
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
  const ageRatio = context.sessionAgeMs !== null && context.policy.maxAgeMs > 0
    ? context.sessionAgeMs / context.policy.maxAgeMs
    : 0;
  return Math.max(0, Math.min(100, Math.round(Math.max(turnRatio, ageRatio) * 100)));
}

function contextStateLabel(state: LocalAgentContextState["state"]): string {
  switch (state) {
    case "stale":
      return "Stale";
    case "aging":
      return "Aging";
    default:
      return "Fresh";
  }
}

function ContextFacet({
  context,
  resetting,
  onReset,
}: {
  context: LocalAgentContextState;
  resetting: boolean;
  onReset: () => void;
}) {
  const percent = contextLoadPercent(context);
  const resetDisabled = resetting || context.currentTurnActive;
  return (
    <div className={`s-profile-facet s-profile-context s-profile-context--${context.state}`}>
      <div className="s-profile-facet-label">Context</div>
      <div className="s-profile-context-head">
        <span className="s-profile-context-state">{contextStateLabel(context.state)}</span>
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
      <div className="s-profile-facet-detail" title={context.reason ?? undefined}>
        {context.turnCount}/{context.policy.maxTurns} turns / {formatContextAge(context.sessionAgeMs)}
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
      ? `stale · ${timeAgo(currentWork.lastMeaningfulAt)}`
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
                onSelect: () => navigator.clipboard.writeText(sel),
              });
              items.push({ kind: "separator" });
            }
            items.push({
              kind: "action",
              label: "Copy Agent Name",
              onSelect: () => navigator.clipboard.writeText(name),
            });
            items.push({
              kind: "action",
              label: "Copy Agent ID",
              onSelect: () => navigator.clipboard.writeText(agent.id),
            });
            if (agent.handle) {
              items.push({
                kind: "action",
                label: `Copy @${agent.handle}`,
                onSelect: () =>
                  navigator.clipboard.writeText(`@${agent.handle}`),
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
                className={`s-profile-identity-pulse s-profile-identity-pulse--${state}`}
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
                </span>
              </div>
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
          {(agent.project || agent.branch || agent.cwd || sessionCatalog?.activeSessionId || contextState) && (
            <div className="s-profile-facets">
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
}: {
  navigate: (r: Route) => void;
  selectedAgentId?: string;
  conversationId?: string;
  tab?: AgentTab;
}) {
  const { agents } = useScout();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [fleet, setFleet] = useState<FleetState | null>(null);

  const load = useCallback(async () => {
    const [sessionsResult, fleetResult] = await Promise.allSettled([
      api<SessionEntry[]>("/api/conversations"),
      api<FleetState>("/api/fleet"),
    ]);
    if (sessionsResult.status === "fulfilled") setSessions(sessionsResult.value);
    if (fleetResult.status === "fulfilled") setFleet(fleetResult.value);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerEvents(() => {
    void load();
  });

  const selectedAgent = resolveSelectedAgent(agents, selectedAgentId);
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
      <AgentDetailWithRail
        agent={selectedAgent}
        allAgents={agents}
        session={sessionByAgentId.get(selectedAgent.id) ?? null}
        conversationId={resolvedConversationId}
        navigate={navigate}
        activeTab={resolvedTab}
      />
    );
  }

  return (
    <AgentsLibrary
      agents={agents}
      fleet={fleet}
      sessionByAgentId={sessionByAgentId}
      conversationByAgentId={conversationByAgentId}
      navigate={navigate}
    />
  );
}

function AgentsLibrary({
  agents,
  fleet,
  sessionByAgentId,
  conversationByAgentId,
  navigate,
}: {
  agents: Agent[];
  fleet: FleetState | null;
  sessionByAgentId: Map<string, SessionEntry>;
  conversationByAgentId: Map<string, string>;
  navigate: (r: Route) => void;
}) {
  const [query, setQuery] = useState("");
  const [harnessFilter, setHarnessFilter] = useState<Set<string>>(() => new Set());
  const [statusFilter, setStatusFilter] = useState<Set<AgentInventoryStatus>>(() => new Set());
  const [sort, setSort] = useState<{ key: AgentInventoryColumnKey; dir: 1 | -1 }>({
    key: "status",
    dir: 1,
  });

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

  const summary = useMemo(() => {
    const projects = new Set(rows.map((row) => row.project));
    return {
      total: rows.length,
      online: rows.filter((row) => row.status !== "offline").length,
      working: rows.filter((row) => row.status === "working").length,
      available: rows.filter((row) => row.status === "available").length,
      offline: rows.filter((row) => row.status === "offline").length,
      projects: projects.size,
    };
  }, [rows]);

  const harnessOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.harness, (counts.get(row.harness) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);

  const statusOptions = useMemo(() => {
    const present = new Set(rows.map((row) => row.status));
    return (["working", "available", "offline"] as AgentInventoryStatus[])
      .filter((status) => present.has(status));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (harnessFilter.size > 0 && !harnessFilter.has(row.harness)) return false;
      if (statusFilter.size > 0 && !statusFilter.has(row.status)) return false;
      if (!q) return true;
      const hay = [
        row.agent.name,
        row.agent.handle,
        row.agent.id,
        row.project,
        row.branch,
        row.harness,
        row.activeTask,
        row.session?.preview,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [harnessFilter, query, rows, statusFilter]);

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
        <div className="s-atop-summary">
          <div className="s-atop-summary-cell s-atop-summary-cell--primary">
            <div className="s-atop-summary-num">
              <strong>{summary.online}</strong>
              <span className="s-atop-summary-of">/ {summary.total}</span>
            </div>
            <span className="s-atop-summary-lbl">active</span>
          </div>
          <div className="s-atop-summary-cell">
            <div className="s-atop-summary-num">
              <strong>{summary.working}</strong>
            </div>
            <span className="s-atop-summary-lbl">working</span>
          </div>
          <div className="s-atop-summary-cell">
            <div className="s-atop-summary-num">
              <strong>{summary.available}</strong>
            </div>
            <span className="s-atop-summary-lbl">available</span>
          </div>
          <div className="s-atop-summary-cell s-atop-summary-cell--breakdown">
            <span className="s-atop-summary-lbl">harness</span>
            <div className="s-atop-summary-row">
              {harnessOptions.length === 0 ? (
                <span className="s-atop-chip s-atop-chip--mute">none</span>
              ) : harnessOptions.slice(0, 6).map(([harness, count]) => (
                <span key={harness} className={harnessChipClass(harness)}>
                  {harness} {count}
                </span>
              ))}
            </div>
          </div>
          <div className="s-atop-summary-spacer" />
          <div className="s-atop-summary-cell s-atop-summary-cell--rate">
            <div className="s-atop-summary-num">
              <strong>{summary.projects}</strong>
            </div>
            <span className="s-atop-summary-lbl">projects</span>
          </div>
        </div>

        <div className="s-atop-fbar">
          <div className="s-atop-search">
            <span className="s-atop-search-prompt">▸</span>
            <input
              className="s-atop-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="filter agents · project · branch · task"
            />
            <span className="s-atop-search-kbd">/</span>
          </div>
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
                const count = rows.filter((row) => row.status === status).length;
                return (
                  <button
                    key={status}
                    type="button"
                    className={`s-atop-pill s-agents-inventory-pill--status-${status}${on ? " s-atop-pill--on" : ""}`}
                    onClick={() => toggleStatus(status)}
                  >
                    {status}
                    <span className="s-atop-pill-ct">{count}</span>
                  </button>
                );
              })}
            </>
          )}
          <div className="s-atop-fbar-spacer" />
          {(harnessFilter.size > 0 || statusFilter.size > 0 || query) && (
            <button
              type="button"
              className="s-atop-pill"
              onClick={() => {
                setQuery("");
                setHarnessFilter(new Set());
                setStatusFilter(new Set());
              }}
            >
              clear
            </button>
          )}
        </div>

        <DataTable
          rows={filteredRows}
          columns={AGENT_INVENTORY_COLUMNS}
          rowId={(row) => row.agent.id}
          storageKey="openscout.agents.inventory.cols"
          sort={sort}
          onSortChange={setSort}
          secondarySort={secondarySort}
          onRowClick={openAgent}
          rowClassName={(row) => `s-agents-inventory-row s-agents-inventory-row--${row.status}`}
          empty={{
            title: agents.length === 0 ? "no agents registered" : "no agents match",
            body: agents.length === 0
              ? "Start or register an agent to populate the inventory."
              : "Adjust filters to widen the current slice.",
          }}
          density="compact"
          className="s-atop-data-table s-agents-inventory-table"
          ariaLabel="Agents inventory"
        />

        <div className="s-atop-keys">
          <span className="s-atop-keys-count">
            <strong>{filteredRows.length}</strong> / {rows.length} agents
          </span>
          <span className="s-atop-keys-spacer" />
          <span>{summary.offline} offline</span>
          <span>{summary.projects} project{summary.projects === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}
