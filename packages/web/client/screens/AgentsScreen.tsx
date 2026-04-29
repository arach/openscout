import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkList } from "../components/WorkList.tsx";
import { agentStateLabel, normalizeAgentState } from "../lib/agent-state.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { resolveScoutRoutePath } from "../lib/runtime-config.ts";
import { useScout } from "../scout/Provider.tsx";
import { useContextMenu, type MenuItem } from "../components/ContextMenu.tsx";
import type {
  AgentTab,
  Agent,
  AgentObservePayload,
  FleetState,
  Message,
  Route,
  SessionEntry,
  SessionCatalogWithResume,
  WorkItem,
} from "../lib/types.ts";
import { ConversationScreen } from "./ConversationScreen.tsx";
import { SessionObserve } from "./SessionObserve.tsx";
import "./agents-screen.css";
import "./ops-screen.css";

async function queueTakeover(command: string) {
  await fetch(resolveScoutRoutePath("terminalRunPath"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
}


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


function SessionFacet({ catalog, agentId }: { catalog: SessionCatalogWithResume; agentId: string }) {
  const { navigate } = useScout();
  const [sent, setSent] = useState(false);
  const shortId = catalog.activeSessionId?.slice(0, 8) ?? null;
  const active = catalog.sessions.find((s) => s.id === catalog.activeSessionId);

  const runTakeover = () => {
    if (!catalog.resumeCommand) return;
    void queueTakeover(catalog.resumeCommand).then(() =>
      navigate({ view: "terminal", agentId }),
    );
    setSent(true);
  };

  return (
    <div className="s-profile-facet">
      <div className="s-profile-facet-label">Session</div>
      <div className="s-profile-facet-value s-profile-facet-value--mono" title={catalog.activeSessionId ?? undefined}>
        {shortId}
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
      </div>
      {active && (
        <div className="s-profile-facet-detail">
          {catalog.sessions.length} session{catalog.sessions.length !== 1 ? "s" : ""} · started {timeAgo(active.startedAt)}
        </div>
      )}
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
    return (
      <div className="s-profile-activity-empty">
        <div className="s-profile-activity-empty-title">Quiet for now</div>
        <div className="s-profile-activity-empty-detail">
          Activity will appear here as this agent works, receives asks, and
          completes tasks.
        </div>
      </div>
    );
  }

  return (
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
  const state = normalizeAgentState(agent.state);
  const showContextMenu = useContextMenu();

  const load = useCallback(async () => {
    const [workResult, fleetResult] = await Promise.allSettled([
      api<WorkItem[]>(`/api/work?agentId=${encodeURIComponent(agent.id)}`),
      api<FleetState>("/api/fleet"),
    ]);
    if (workResult.status === "fulfilled") setWork(workResult.value);
    if (fleetResult.status === "fulfilled") setFleet(fleetResult.value);
  }, [agent.id]);

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

  useEffect(() => {
    void load();
    void loadMessages();
    api<SessionCatalogWithResume>(`/api/agents/${encodeURIComponent(agent.id)}/session-catalog`)
      .then(setSessionCatalog)
      .catch(() => {});
  }, [load, loadMessages, agent.id]);

  useEffect(() => {
    setObserve(null);
    setObserveLoading(false);
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
    (w) => w.state === "working" || w.state === "review" || w.state === "waiting",
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

  return (
    <div className={`s-profile-center${activeTab !== "profile" ? " s-profile-center--tabbed" : ""}`}>
      <button
        type="button"
        className="s-back s-profile-mobile-back"
        onClick={() => navigate({ view: "agents" })}
      >
        &larr; All agents
      </button>

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
          <nav className="s-profile-tabs">
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
        </div>
      </section>

      {activeTab === "profile" && (
        <div className="s-profile-tab-content">
          {(agent.project || agent.branch || agent.cwd || sessionCatalog?.activeSessionId) && (
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
            </div>
          )}
          {currentWork && state === "working" && (
            <>
              <SectionRule
                label="Current task"
                right={`${taskProgress}% · live`}
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

          <SectionRule label="Activity" />
          <div className="s-profile-work">
            <AgentActivityFeed
              agent={agent}
              fleet={fleet}
              navigate={navigate}
            />
          </div>

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
            <SessionObserve data={observe?.data} agentId={agent.id} sessionId={observe?.sessionId} />
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

  const load = useCallback(async () => {
    const result = await api<SessionEntry[]>("/api/sessions").catch(() => null);
    if (result) setSessions(result);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerEvents(() => {
    void load();
  });

  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId) ?? null
    : null;

  const { conversationByAgentId, sessionByAgentId } =
    directSessionMaps(sessions);

  if (selectedAgent) {
    const resolvedConversationId =
      activeConversationId ??
      conversationByAgentId.get(selectedAgent.id) ??
      selectedAgent.conversationId ??
      null;
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
      sessionByAgentId={sessionByAgentId}
      conversationByAgentId={conversationByAgentId}
      navigate={navigate}
    />
  );
}

type BranchTab = {
  name: string;
  agents: Agent[];
  online: number;
  kind: "active" | "idle" | "unmonitored";
};

type RepoCard = {
  key: string;
  name: string;
  path: string | null;
  branches: BranchTab[];
  totalAgents: number;
  totalOnline: number;
  lastActivityAt: number | null;
};

const NO_BRANCH_KEY = "—";

function buildRepoCards(agents: Agent[]): RepoCard[] {
  const byProject = new Map<string, Agent[]>();
  for (const agent of agents) {
    const key = agent.project ?? "Unscoped";
    const list = byProject.get(key) ?? [];
    list.push(agent);
    byProject.set(key, list);
  }

  const cards: RepoCard[] = [];
  for (const [name, repoAgents] of byProject) {
    const path = repoAgents.find((a) => a.projectRoot)?.projectRoot ?? null;

    const byBranch = new Map<string, Agent[]>();
    for (const agent of repoAgents) {
      const branchKey = agent.branch ?? NO_BRANCH_KEY;
      const list = byBranch.get(branchKey) ?? [];
      list.push(agent);
      byBranch.set(branchKey, list);
    }

    const branches: BranchTab[] = Array.from(byBranch.entries()).map(
      ([branchName, list]) => {
        const online = list.filter(isOnline).length;
        return {
          name: branchName,
          agents: list,
          online,
          kind: online > 0 ? "active" : "idle",
        };
      },
    );

    const PRIMARY_BRANCHES = new Set(["main", "master", "trunk"]);
    branches.sort((a, b) => {
      const aPrimary = PRIMARY_BRANCHES.has(a.name);
      const bPrimary = PRIMARY_BRANCHES.has(b.name);
      if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const tab of branches) {
      tab.agents.sort((a, b) => a.name.localeCompare(b.name));
    }

    const lastActivityAt = repoAgents.reduce<number | null>((acc, agent) => {
      const t = agent.updatedAt;
      if (!t) return acc;
      return acc === null || t > acc ? t : acc;
    }, null);

    cards.push({
      key: name,
      name,
      path,
      branches,
      totalAgents: repoAgents.length,
      totalOnline: repoAgents.filter(isOnline).length,
      lastActivityAt,
    });
  }

  cards.sort((a, b) => a.name.localeCompare(b.name));

  return cards;
}

function AgentsLibrary({
  agents,
  sessionByAgentId,
  conversationByAgentId,
  navigate,
}: {
  agents: Agent[];
  sessionByAgentId: Map<string, SessionEntry>;
  conversationByAgentId: Map<string, string>;
  navigate: (r: Route) => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="s-profile-center" style={{ height: "100%" }}>
        <div className="s-profile-empty">
          <h2 className="s-profile-empty-title">No agents yet</h2>
          <p className="s-profile-empty-copy">
            Spawn an agent from a workspace, harness, branch, and model to see
            it land here.
          </p>
        </div>
      </div>
    );
  }

  const repos = useMemo(() => buildRepoCards(agents), [agents]);
  const onlineTotal = agents.filter(isOnline).length;
  const [viewMode, setViewMode] = useState<AgentViewMode>("cards");

  return (
    <div className="s-agents-library">
      <header className="s-agents-library-head">
        <div className="s-agents-library-title-row">
          <h2 className="s-agents-library-title">Agents</h2>
          <span className="s-agents-library-count">
            {onlineTotal} online · {agents.length} total · {repos.length}{" "}
            {repos.length === 1 ? "repo" : "repos"}
          </span>
        </div>
        <div className="s-agents-library-view" role="tablist" aria-label="Agent view">
          {(["pills", "rows", "cards"] as AgentViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={viewMode === mode}
              className="s-agents-library-view-btn"
              data-active={viewMode === mode ? "true" : undefined}
              onClick={() => setViewMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </header>

      <div className="s-agents-library-repos">
        {repos.map((repo) => (
          <RepoCardView
            key={repo.key}
            repo={repo}
            sessionByAgentId={sessionByAgentId}
            conversationByAgentId={conversationByAgentId}
            navigate={navigate}
            viewMode={viewMode}
          />
        ))}
      </div>
    </div>
  );
}

type AgentViewMode = "log" | "rows" | "cards";

function RepoCardView({
  repo,
  sessionByAgentId,
  conversationByAgentId,
  navigate,
  viewMode,
}: {
  repo: RepoCard;
  sessionByAgentId: Map<string, SessionEntry>;
  conversationByAgentId: Map<string, string>;
  navigate: (r: Route) => void;
  viewMode: AgentViewMode;
}) {
  const [selected, setSelected] = useState<string>(
    () => repo.branches[0]?.name ?? NO_BRANCH_KEY,
  );

  const activeTab =
    repo.branches.find((b) => b.name === selected) ?? repo.branches[0];

  return (
    <section className="s-repo-card">
      <header className="s-repo-card-head">
        <div className="s-repo-card-identity">
          <h3 className="s-repo-card-name">{repo.name}</h3>
          {repo.path && <span className="s-repo-card-path">{repo.path}</span>}
        </div>
        <div className="s-repo-card-meta">
          {repo.lastActivityAt && (
            <span>{timeAgo(repo.lastActivityAt)}</span>
          )}
        </div>
      </header>

      <div className="s-repo-card-tabs" role="tablist" aria-label="Branches">
        {repo.branches.map((tab) => (
          <button
            key={tab.name}
            type="button"
            role="tab"
            aria-selected={activeTab?.name === tab.name}
            className="s-repo-card-tab"
            data-kind={tab.kind}
            data-active={activeTab?.name === tab.name ? "true" : undefined}
            onClick={() => setSelected(tab.name)}
          >
            <span className="s-repo-card-tab-name">{tab.name}</span>
            {tab.kind === "unmonitored" ? (
              <span className="s-repo-card-tab-glyph" aria-hidden="true">
                +
              </span>
            ) : (
              <span className="s-repo-card-tab-count">
                {tab.online > 0
                  ? `${tab.online}/${tab.agents.length}`
                  : `${tab.agents.length}`}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="s-repo-card-body">
        {activeTab && activeTab.agents.length > 0 ? (
          <AgentList
            agents={activeTab.agents}
            sessionByAgentId={sessionByAgentId}
            conversationByAgentId={conversationByAgentId}
            navigate={navigate}
            viewMode={viewMode}
          />
        ) : (
          <div className="s-repo-card-empty">
            No agent on <strong>{activeTab?.name}</strong>. Spawn one to start.
          </div>
        )}
      </div>
    </section>
  );
}

function isOnline(agent: Agent): boolean {
  return normalizeAgentState(agent.state) !== "offline";
}

function AgentList({
  agents,
  sessionByAgentId,
  conversationByAgentId,
  navigate,
  viewMode,
}: {
  agents: Agent[];
  sessionByAgentId: Map<string, SessionEntry>;
  conversationByAgentId: Map<string, string>;
  navigate: (r: Route) => void;
  viewMode: AgentViewMode;
}) {
  const onClickFor = (agent: Agent) => () => {
    const conversationId = conversationByAgentId.get(agent.id);
    navigate({
      view: "agents",
      agentId: agent.id,
      ...(conversationId ? { conversationId } : {}),
    });
  };

  if (viewMode === "rows") {
    return (
      <div className="s-agent-rows">
        {agents.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            session={sessionByAgentId.get(agent.id) ?? null}
            onClick={onClickFor(agent)}
          />
        ))}
      </div>
    );
  }

  if (viewMode === "cards") {
    return (
      <div className="s-agent-grid">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            session={sessionByAgentId.get(agent.id) ?? null}
            onClick={onClickFor(agent)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="s-agent-log">
      {agents.map((agent) => (
        <AgentLogLine
          key={agent.id}
          agent={agent}
          session={sessionByAgentId.get(agent.id) ?? null}
          onClick={onClickFor(agent)}
        />
      ))}
    </div>
  );
}

function AgentRow({
  agent,
  session,
  onClick,
}: {
  agent: Agent;
  session: SessionEntry | null;
  onClick: () => void;
}) {
  const display = normalizeAgentState(agent.state);
  const stateLabel = agentStateLabel(agent.state);
  const lastActivityAt =
    session?.lastMessageAt ?? agent.updatedAt ?? null;
  const preview = session?.preview ?? null;
  const harness = formatLabel(agent.harness);

  return (
    <button
      type="button"
      className="s-agent-row"
      data-state={display}
      onClick={onClick}
      title={stateLabel}
    >
      <span className="s-agent-row-name">{agent.name}</span>
      <span className="s-agent-row-preview">
        {preview ?? <span className="s-agent-row-preview-quiet">{stateLabel.toLowerCase()}</span>}
      </span>
      {harness && <span className="s-agent-row-harness">{harness}</span>}
      {lastActivityAt && (
        <span className="s-agent-row-time">{timeAgo(lastActivityAt)}</span>
      )}
    </button>
  );
}

function AgentCard({
  agent,
  session,
  onClick,
}: {
  agent: Agent;
  session: SessionEntry | null;
  onClick: () => void;
}) {
  const display = normalizeAgentState(agent.state);
  const stateLabel = agentStateLabel(agent.state);
  const lastActivityAt =
    session?.lastMessageAt ?? agent.updatedAt ?? null;
  const preview = session?.preview ?? null;
  const topology = [agent.harness, agent.branch, agent.agentClass]
    .map(formatLabel)
    .filter((part): part is string => Boolean(part));

  return (
    <button
      type="button"
      className="s-agent-card"
      data-state={display}
      onClick={onClick}
      title={stateLabel}
    >
      <div className="s-agent-card-row">
        <span className="s-agent-card-name">{agent.name}</span>
        {lastActivityAt && (
          <span className="s-agent-card-time">{timeAgo(lastActivityAt)}</span>
        )}
      </div>
      <div className="s-agent-card-preview">
        {preview ?? (
          <span className="s-agent-card-preview-quiet">{stateLabel}</span>
        )}
      </div>
      {topology.length > 0 && (
        <div className="s-agent-card-topo">
          {topology.map((part, idx) => (
            <span key={`${part}-${idx}`} className="s-agent-card-topo-chip">
              {part}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function AgentLogLine({
  agent,
  session,
  onClick,
}: {
  agent: Agent;
  session: SessionEntry | null;
  onClick: () => void;
}) {
  const display = normalizeAgentState(agent.state);
  const stateLabel = agentStateLabel(agent.state);
  const lastActivityAt =
    session?.lastMessageAt ?? agent.updatedAt ?? null;
  const preview = session?.preview ?? null;
  const harness = formatLabel(agent.harness);
  const tooltipParts = [
    `${agent.name} · ${stateLabel}`,
    harness ? `harness: ${harness}` : null,
    preview ? `preview: ${preview}` : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      className="s-agent-log-row"
      data-state={display}
      onClick={onClick}
      title={tooltipParts.join("\n")}
    >
      <span className="s-agent-log-time">
        {lastActivityAt ? timeAgo(lastActivityAt) : "—"}
      </span>
      <span className="s-agent-log-name">{agent.name}</span>
      <span className="s-agent-log-msg">
        {preview ?? <span className="s-agent-log-msg-quiet">{stateLabel.toLowerCase()}</span>}
      </span>
    </button>
  );
}
