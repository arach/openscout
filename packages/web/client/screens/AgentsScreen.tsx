import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { WorkList } from "../components/WorkList.tsx";
import { agentStateLabel, normalizeAgentState } from "../lib/agent-state.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import type { Agent, Route, SessionEntry, WorkItem } from "../lib/types.ts";
import { ConversationScreen } from "./ConversationScreen.tsx";
import "./agents-detail-redesign.css";

type AgentField = {
  label: string;
  value: ReactNode;
};

type AgentSection = {
  key: "working" | "available" | "offline";
  title: string;
  agents: Agent[];
};

/** Build a display label that disambiguates agents sharing the same name. */
function agentLabel(agent: Agent, allAgents: Agent[]): { name: string; qualifier: string | null } {
  const siblings = allAgents.filter((candidate) => candidate.name === agent.name);
  if (siblings.length <= 1) {
    return { name: agent.name, qualifier: null };
  }
  const qualifier =
    agent.project ??
    agent.branch ??
    agent.id.replace(/^.*\./, "");
  return { name: agent.name, qualifier };
}

function formatLabel(value: string | null | undefined): string | null {
  return value ? value.replace(/_/g, " ") : null;
}

function formatUpdatedAt(updatedAt: number | null): string {
  return updatedAt ? timeAgo(updatedAt) : "—";
}

function directSessionMaps(sessions: SessionEntry[]): {
  conversationByAgentId: Map<string, string>;
  sessionByAgentId: Map<string, SessionEntry>;
} {
  const directSessions = [...sessions]
    .filter((session): session is SessionEntry & { agentId: string } => session.kind === "direct" && Boolean(session.agentId))
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

  const conversationByAgentId = new Map<string, string>();
  const sessionByAgentId = new Map<string, SessionEntry>();
  for (const session of directSessions) {
    const agentId = session.agentId;
    if (!conversationByAgentId.has(agentId)) {
      conversationByAgentId.set(agentId, session.id);
      sessionByAgentId.set(agentId, session);
    }
  }

  return { conversationByAgentId, sessionByAgentId };
}

function AgentMetadataRow({ label, value }: AgentField) {
  return (
    <div className="s-agent-meta-row">
      <span className="s-agent-meta-label">{label}</span>
      <span className="s-agent-meta-value">{value}</span>
    </div>
  );
}

function CapabilityTokens({ values }: { values: string[] }) {
  return (
    <span className="s-agent-token-list">
      {values.map((value) => (
        <span key={value} className="s-agent-token">
          {value}
        </span>
      ))}
    </span>
  );
}

function AgentRosterSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="s-agent-roster-section">
      <div className="s-agent-roster-section-header">
        <div className="s-agent-roster-section-title">{title}</div>
        <span className="s-agent-roster-section-count">{count}</span>
      </div>
      <div className="s-agent-roster-stack">{children}</div>
    </section>
  );
}

function AgentsOverviewPanel({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) {
    return null;
  }

  return (
    <div className="s-agent-overview-empty">
      <h2 className="s-agent-overview-empty-title">Select an agent</h2>
      <p className="s-agent-overview-empty-copy">
        Pick an agent from the roster to view its profile, current work, and session context.
      </p>
    </div>
  );
}

function AgentDetail({
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
  const state = normalizeAgentState(agent.state);

  const load = useCallback(async () => {
    try {
      setWork(await api<WorkItem[]>(`/api/work?agentId=${encodeURIComponent(agent.id)}`));
    } catch {
      setWork([]);
    }
  }, [agent.id]);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerEvents(load);

  const contextItems: AgentField[] = [
    ...(agent.project ? [{ label: "Project", value: agent.project }] : []),
    ...(agent.branch ? [{ label: "Branch", value: agent.branch }] : []),
    ...(agent.harness ? [{ label: "Harness", value: agent.harness }] : []),
    ...(agent.transport ? [{ label: "Transport", value: formatLabel(agent.transport) ?? agent.transport }] : []),
    ...(agent.projectRoot ? [{ label: "Path", value: agent.projectRoot }] : []),
    ...(session?.workspaceRoot ? [{ label: "Workspace", value: session.workspaceRoot }] : []),
    ...(session?.currentBranch ? [{ label: "Session branch", value: session.currentBranch }] : []),
  ];

  return (
    <div className="s-agent-casefile">
      <button
        type="button"
        className="s-back s-agent-mobile-back"
        onClick={() => navigate({ view: "agents" })}
      >
        &larr; All agents
      </button>

      {/* -- Identity card -- */}
      <section className="s-agent-detail-identity">
        <div className="s-avatar s-agent-casefile-avatar" style={{ background: actorColor(agent.name) }}>
          {agent.name[0].toUpperCase()}
        </div>
        <div className="s-agent-detail-identity-copy">
          <h2 className="s-agent-detail-identity-name">
            {name}
            {qualifier && <span className="s-agent-casefile-title-qualifier">{qualifier}</span>}
          </h2>
          <div className="s-agent-detail-identity-meta">
            {agent.handle && <span className="s-agent-detail-handle">@{agent.handle}</span>}
            <span className={`s-agent-state-chip s-agent-state-chip-${state}`}>
              <span className="s-dot" style={{ background: stateColor(agent.state) }} />
              {agentStateLabel(agent.state)}
            </span>
            {agent.updatedAt && <span className="s-agent-detail-updated">{timeAgo(agent.updatedAt)}</span>}
          </div>
          <p className="s-agent-detail-identity-desc">
            {[formatLabel(agent.role) ?? formatLabel(agent.agentClass), agent.project]
              .filter(Boolean)
              .join(" \u00b7 ")}
          </p>
          <div className="s-agent-detail-actions">
            <button
              type="button"
              className="s-btn s-btn-primary"
              onClick={() => conversationId && navigate({ view: "agents", agentId: agent.id, conversationId })}
              disabled={!conversationId}
            >
              {conversationId ? "Open conversation" : "No conversation"}
            </button>
            {agent.capabilities.length > 0 && (
              <div className="s-agent-detail-capabilities">
                <CapabilityTokens values={agent.capabilities} />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* -- Context metadata -- */}
      {contextItems.length > 0 && (
        <section className="s-agent-detail-context">
          <h3 className="s-agent-detail-section-title">Context</h3>
          <div className="s-agent-meta-card-body">
            {contextItems.map((item) => (
              <AgentMetadataRow key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        </section>
      )}

      {/* -- Active work -- */}
      <section className="s-agent-detail-work">
        <h3 className="s-agent-detail-section-title">Active work</h3>
        <WorkList
          items={work}
          navigate={navigate}
          emptyTitle="Nothing in flight"
          emptyDetail="New asks, handoffs, and follow-ups will stack here once this agent picks up work."
        />
      </section>
    </div>
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
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);

  const load = useCallback(async () => {
    const [agentsResult, sessionsResult] = await Promise.allSettled([
      api<Agent[]>("/api/agents"),
      api<SessionEntry[]>("/api/sessions"),
    ]);

    if (agentsResult.status === "fulfilled") {
      setAgents(agentsResult.value);
    }
    if (sessionsResult.status === "fulfilled") {
      setSessions(sessionsResult.value);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerEvents(load);

  const sortedAgents = [...agents].sort((a, b) => {
    const stateOrder = { working: 0, available: 1, offline: 2 } as const;
    const stateDelta = stateOrder[normalizeAgentState(a.state)] - stateOrder[normalizeAgentState(b.state)];
    if (stateDelta !== 0) {
      return stateDelta;
    }
    const updatedDelta = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    if (updatedDelta !== 0) {
      return updatedDelta;
    }
    return a.name.localeCompare(b.name);
  });

  const sections: AgentSection[] = [
    {
      key: "working",
      title: "Working",
      agents: sortedAgents.filter((agent) => normalizeAgentState(agent.state) === "working"),
    },
    {
      key: "available",
      title: "Available",
      agents: sortedAgents.filter((agent) => normalizeAgentState(agent.state) === "available"),
    },
    {
      key: "offline",
      title: "Offline",
      agents: sortedAgents.filter((agent) => normalizeAgentState(agent.state) === "offline"),
    },
  ];

  const selectedAgent = selectedAgentId ? agents.find((agent) => agent.id === selectedAgentId) ?? null : null;
  const { conversationByAgentId, sessionByAgentId } = directSessionMaps(sessions);
  const hasDetailPane = agents.length > 0;

  const ROSTER_MIN = 200;
  const ROSTER_MAX = 440;
  const ROSTER_KEY = "scout-agents-roster-w";
  const [rosterWidth, setRosterWidth] = useState(() => {
    try {
      const v = localStorage.getItem(ROSTER_KEY);
      if (v) { const n = Number(v); if (n >= ROSTER_MIN && n <= ROSTER_MAX) return n; }
    } catch { /* ignore */ }
    return 280;
  });
  const rosterDragging = useRef(false);
  const rosterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(ROSTER_KEY, String(rosterWidth)); } catch { /* ignore */ }
  }, [rosterWidth]);

  const onRosterResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    rosterDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const panelLeft = rosterRef.current?.getBoundingClientRect().left ?? 0;
    const onMove = (ev: MouseEvent) => {
      if (!rosterDragging.current) return;
      setRosterWidth(Math.min(ROSTER_MAX, Math.max(ROSTER_MIN, ev.clientX - panelLeft)));
    };
    const onUp = () => {
      rosterDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div
      className={[
        "s-agents-layout",
        "s-agents-browser",
        hasDetailPane ? "s-agents-layout-split" : "",
        selectedAgent ? "s-agents-browser-selected" : "",
      ].filter(Boolean).join(" ")}
      style={{ "--agents-roster-w": `${rosterWidth}px` } as React.CSSProperties}
    >
      <div ref={rosterRef} className="s-agents-list-panel s-agents-browser-list">
        <div className="s-agent-roster">
          <div className="s-agent-roster-header">
            <div>
              <h2 className="s-section-title s-agent-roster-title">Agents</h2>
              <p className="s-agent-roster-copy">
                {agents.length} total · {sections[0].agents.length} working · {sections[1].agents.length} available
              </p>
            </div>
          </div>

          {agents.length === 0 ? (
            <div className="s-empty s-agent-roster-empty">
              <p>No agents</p>
              <p>Agents appear here when they connect to the broker.</p>
            </div>
          ) : (
            sections
              .filter((section) => section.agents.length > 0)
              .map((section) => (
                <AgentRosterSection
                  key={section.key}
                  title={section.title}
                  count={section.agents.length}
                >
                  {section.agents.map((agent) => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      allAgents={agents}
                      selected={agent.id === selectedAgentId}
                      onClick={() => navigate({ view: "agents", agentId: agent.id })}
                    />
                  ))}
                </AgentRosterSection>
              ))
          )}
        </div>
      </div>

      {hasDetailPane && (
        <>
        <div
          className="s-agents-roster-resize"
          onMouseDown={onRosterResizeStart}
          role="separator"
          aria-orientation="vertical"
        />
        <div className="s-agents-detail-panel s-agents-browser-detail">
          {activeConversationId && selectedAgent ? (
            <ConversationScreen conversationId={activeConversationId} navigate={navigate} />
          ) : selectedAgent ? (
            <AgentDetail
              agent={selectedAgent}
              allAgents={agents}
              session={sessionByAgentId.get(selectedAgent.id) ?? null}
              conversationId={conversationByAgentId.get(selectedAgent.id) ?? selectedAgent.conversationId ?? null}
              navigate={navigate}
            />
          ) : (
            <AgentsOverviewPanel agents={agents} />
          )}
        </div>
        </>
      )}
    </div>
  );
}

function AgentRow({
  agent,
  allAgents,
  selected,
  onClick,
}: {
  agent: Agent;
  allAgents: Agent[];
  selected: boolean;
  onClick: () => void;
}) {
  const { name, qualifier } = agentLabel(agent, allAgents);
  const state = normalizeAgentState(agent.state);

  return (
    <div
      className={`s-agent-list-row s-agent-roster-row${selected ? " s-agent-list-row-active" : ""}`}
      onClick={onClick}
    >
      <div className="s-agent-roster-avatar-wrap">
        <div className="s-avatar s-avatar-sm" style={{ background: actorColor(agent.name) }}>
          {agent.name[0].toUpperCase()}
        </div>
        <span
          className={`s-agent-roster-avatar-status s-agent-roster-avatar-status-${state}`}
          style={{ background: stateColor(agent.state) }}
        />
      </div>

      <div className="s-agent-list-body s-agent-roster-row-body">
        <div className="s-agent-roster-row-top">
          <div className="s-agent-list-header">
            <span className="s-agent-list-name">{name}</span>
            {qualifier && <span className="s-agent-list-qualifier">{qualifier}</span>}
          </div>
          <span className="s-agent-roster-row-time">{formatUpdatedAt(agent.updatedAt)}</span>
        </div>
      </div>
    </div>
  );
}
