import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkList } from "../components/WorkList.tsx";
import { agentStateLabel, normalizeAgentState } from "../lib/agent-state.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { useScout } from "../scout/Provider.tsx";
import { useContextMenu, type MenuItem } from "../components/ContextMenu.tsx";
import type {
  Agent,
  FleetState,
  Message,
  Route,
  SessionEntry,
  WorkItem,
} from "../lib/types.ts";
import { ConversationScreen } from "./ConversationScreen.tsx";
import "./agents-screen.css";
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
                view: "conversation",
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
                view: "conversation",
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
}: {
  messages: Message[];
  navigate: (r: Route) => void;
  conversationId: string | null;
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
                    agentId: undefined,
                    conversationId,
                  } as Route & { view: "agents" });
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
}: {
  agent: Agent;
  allAgents: Agent[];
  session: SessionEntry | null;
  conversationId: string | null;
  navigate: (r: Route) => void;
}) {
  const { name, qualifier } = agentLabel(agent, allAgents);
  const [work, setWork] = useState<WorkItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [fleet, setFleet] = useState<FleetState | null>(null);
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

  useEffect(() => {
    void load();
    void loadMessages();
  }, [load, loadMessages]);

  useBrokerEvents(() => {
    void load();
    void loadMessages();
  });

  const currentWork = work.find(
    (w) => w.state === "working" || w.state === "review",
  );
  const activeWork = work.filter(
    (w) => w.state === "working" || w.state === "review" || w.state === "waiting",
  );
  const recentDone = work.filter((w) => w.state === "done").slice(0, 5);

  const teammates = allAgents.filter(
    (a) => a.id !== agent.id && a.project === agent.project,
  );

  const facets: Array<{
    label: string;
    value: string;
    sub?: string;
    subAccent?: string;
  }> = [];
  if (session?.workspaceRoot || agent.projectRoot) {
    facets.push({
      label: "Workspace",
      value: agent.project ?? "default",
      sub: `${teammates.length} teammate${teammates.length !== 1 ? "s" : ""}`,
    });
  }
  if (agent.branch || session?.currentBranch) {
    const branchName = session?.currentBranch ?? agent.branch ?? "";
    facets.push({
      label: "Repo / Branch",
      value: agent.project ?? "default",
      subAccent: "⎇",
      sub: branchName,
    });
  }
  if (agent.cwd) {
    facets.push({
      label: "Working dir",
      value: agent.cwd.length > 40 ? "..." + agent.cwd.slice(-37) : agent.cwd,
      sub: agent.updatedAt
        ? `updated ${timeAgo(agent.updatedAt)}`
        : undefined,
    });
  }

  const roleLabel = formatLabel(agent.role) ?? formatLabel(agent.agentClass);
  const harnessLabel = agent.harness;
  const eyebrowParts = [roleLabel, harnessLabel]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  const taskProgress = currentWork?.currentPhase === "review"
    ? 85
    : currentWork?.currentPhase === "working"
      ? 50
      : 20;

  return (
    <>
      <div className="s-profile-center">
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
            <div className="s-profile-identity-actions">
              <button
                type="button"
                className="s-profile-btn"
                onClick={() => {
                  if (conversationId) {
                    navigate({
                      view: "agents",
                      agentId: agent.id,
                      conversationId,
                    });
                  }
                }}
                disabled={!conversationId}
              >
                Observe
              </button>
              <button
                type="button"
                className="s-profile-btn"
                onClick={() => {
                  if (conversationId) {
                    navigate({
                      view: "agents",
                      agentId: agent.id,
                      conversationId,
                    });
                  }
                }}
                disabled={!conversationId}
              >
                Message
              </button>
              <button
                type="button"
                className="s-profile-btn s-profile-btn--primary"
                disabled={!conversationId}
              >
                Assist
              </button>
            </div>
          </div>
        </section>

        {facets.length > 0 && (
          <div className="s-profile-facets">
            {facets.map((f) => (
              <div key={f.label} className="s-profile-facet">
                <div className="s-profile-facet-label">{f.label}</div>
                <div className="s-profile-facet-value">{f.value}</div>
                {(f.sub || f.subAccent) && (
                  <div className="s-profile-facet-sub">
                    {f.subAccent && (
                      <span className="s-profile-facet-accent">
                        {f.subAccent}{" "}
                      </span>
                    )}
                    {f.sub}
                  </div>
                )}
              </div>
            ))}
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
        />
      </div>
    </>
  );
}

export function AgentsScreen({
  navigate,
  selectedAgentId,
  conversationId: activeConversationId,
}: {
  navigate: (r: Route) => void;
  selectedAgentId?: string;
  conversationId?: string;
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
  useBrokerEvents(load);

  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId) ?? null
    : null;

  const { conversationByAgentId, sessionByAgentId } =
    directSessionMaps(sessions);

  if (activeConversationId && selectedAgent) {
    return (
      <ConversationScreen
        conversationId={activeConversationId}
        navigate={navigate}
      />
    );
  }

  if (selectedAgent) {
    return (
      <AgentDetailWithRail
        agent={selectedAgent}
        allAgents={agents}
        session={sessionByAgentId.get(selectedAgent.id) ?? null}
        conversationId={
          conversationByAgentId.get(selectedAgent.id) ??
          selectedAgent.conversationId ??
          null
        }
        navigate={navigate}
      />
    );
  }

  return (
    <div className="s-profile-center" style={{ height: "100%" }}>
      <div className="s-profile-empty">
        <h2 className="s-profile-empty-title">Select an agent</h2>
        <p className="s-profile-empty-copy">
          Pick an agent from the sidebar to view its profile, current work,
          and session context.
        </p>
      </div>
    </div>
  );
}
