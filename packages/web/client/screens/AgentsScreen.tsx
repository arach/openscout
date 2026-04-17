import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { agentStateLabel, isAgentOnline } from "../lib/agent-state.ts";
import { WorkList } from "../components/WorkList.tsx";
import type { Agent, Message, Route, SessionEntry, WorkItem } from "../lib/types.ts";

/** Build a display label that disambiguates agents sharing the same name. */
function agentLabel(agent: Agent, allAgents: Agent[]): { name: string; qualifier: string | null } {
  const siblings = allAgents.filter((a) => a.name === agent.name);
  if (siblings.length <= 1) {
    return { name: agent.name, qualifier: null };
  }
  // Use project, branch, or id suffix to disambiguate
  const qualifier =
    agent.project ??
    agent.branch ??
    agent.id.replace(/^.*\./, "");
  return { name: agent.name, qualifier };
}

function AgentDetail({
  agent,
  allAgents,
  messages,
  conversationId,
  navigate,
}: {
  agent: Agent;
  allAgents: Agent[];
  messages: Message[];
  conversationId: string | null;
  navigate: (r: Route) => void;
}) {
  const { name, qualifier } = agentLabel(agent, allAgents);
  const agentMessages = messages.filter((m) =>
    m.actorName === agent.name ||
    m.conversationId.includes(agent.id) ||
    m.body.includes(`@${agent.name}`)
  );
  agentMessages.sort((a, b) => b.createdAt - a.createdAt);
  const [work, setWork] = useState<WorkItem[]>([]);

  const load = useCallback(async () => {
    try {
      setWork(await api<WorkItem[]>(`/api/work?agentId=${encodeURIComponent(agent.id)}`));
    } catch {
      setWork([]);
    }
  }, [agent.id]);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  return (
    <div className="s-agent-detail">
      <div className="s-agent-detail-header">
        <div className="s-avatar s-avatar-lg" style={{ background: actorColor(agent.name) }}>
          {agent.name[0].toUpperCase()}
        </div>
        <div>
          <div className="s-agent-detail-name">
            {name}
            {qualifier && <span className="s-agent-detail-qualifier">{qualifier}</span>}
          </div>
          <div className="s-agent-detail-state">
            <span className="s-dot" style={{ background: stateColor(agent.state) }} />
            <span>{agentStateLabel(agent.state)}</span>
            {agent.harness && <span className="s-badge">{agent.harness}</span>}
          </div>
        </div>
      </div>

      <div className="s-agent-detail-meta">
        <DetailRow label="Agent ID" value={agent.id} />
        {agent.project && <DetailRow label="Project" value={agent.project} />}
        {agent.branch && <DetailRow label="Branch" value={agent.branch} />}
        {agent.projectRoot && <DetailRow label="Path" value={agent.projectRoot} />}
        {agent.transport && <DetailRow label="Transport" value={agent.transport.replace(/_/g, " ")} />}
        {agent.harnessSessionId && <DetailRow label="Harness Session" value={agent.harnessSessionId} />}
        {agent.harnessLogPath && <DetailRow label="Harness Log" value={agent.harnessLogPath} />}
        {agent.role && <DetailRow label="Role" value={agent.role} />}
        {agent.capabilities?.length > 0 && <DetailRow label="Capabilities" value={agent.capabilities.join(", ")} />}
      </div>

      <div className="s-agent-detail-section">
        <div className="s-home-section-title">Current work</div>
        <WorkList
          items={work}
          navigate={navigate}
          emptyTitle="No active work"
          emptyDetail="Owned or next-move work for this agent will show up here."
        />
      </div>

      {agentMessages.length > 0 && (
        <div className="s-agent-detail-section">
          <div className="s-home-section-title">Recent messages</div>
          <div className="s-agent-detail-messages">
            {agentMessages.slice(0, 10).map((msg) => (
              <div
                key={msg.id}
                className="s-agent-detail-msg s-agent-detail-msg-clickable"
                onClick={() => navigate({ view: "conversation", conversationId: msg.conversationId })}
              >
                <span className="s-agent-detail-msg-actor">{msg.actorName === "operator" || msg.class === "operator" ? "You" : msg.actorName}</span>
                <span className="s-agent-detail-msg-body">{msg.body.slice(0, 200)}</span>
                <span className="s-time">{timeAgo(msg.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        className="s-btn"
        style={{ marginTop: 16 }}
        onClick={() => conversationId && navigate({ view: "conversation", conversationId })}
        disabled={!conversationId}
      >
        {conversationId ? "Open conversation" : "Conversation unavailable"}
      </button>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="s-detail-row">
      <span className="s-detail-label">{label}</span>
      <span className="s-detail-value">{value}</span>
    </div>
  );
}

export function AgentsScreen({
  navigate,
  selectedAgentId,
}: {
  navigate: (r: Route) => void;
  selectedAgentId?: string;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);

  const load = useCallback(async () => {
    const [agentsResult, messagesResult, sessionsResult] = await Promise.allSettled([
      api<Agent[]>("/api/agents"),
      api<Message[]>("/api/messages"),
      api<SessionEntry[]>("/api/sessions"),
    ]);

    if (agentsResult.status === "fulfilled") {
      setAgents(agentsResult.value);
    }
    if (messagesResult.status === "fulfilled") {
      setMessages(messagesResult.value);
    }
    if (sessionsResult.status === "fulfilled") {
      setSessions(sessionsResult.value);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  const online = agents.filter((a) => isAgentOnline(a.state));
  const offline = agents.filter((a) => !isAgentOnline(a.state));
  const selectedAgent = selectedAgentId ? agents.find((a) => a.id === selectedAgentId) : null;
  const directConversationByAgentId = new Map(
    sessions
      .filter((session) => session.kind === "direct" && session.agentId)
      .map((session) => [session.agentId!, session.id]),
  );

  return (
    <div className={`s-agents-layout${selectedAgent ? " s-agents-layout-split" : ""}`}>
      {/* Agent list panel */}
      <div className="s-agents-list-panel">
        <h2 className="s-section-title" style={{ padding: "0 8px" }}>Agents</h2>

        {agents.length === 0 ? (
          <div className="s-empty">
            <p>No agents</p>
            <p>Agents appear here when they connect to the broker</p>
          </div>
        ) : (
          <>
            {online.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div className="s-home-section-title" style={{ padding: "0 8px" }}>Online ({online.length})</div>
                {online.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    allAgents={agents}
                    selected={agent.id === selectedAgentId}
                    onClick={() => navigate({ view: "agents", agentId: agent.id })}
                  />
                ))}
              </div>
            )}
            {offline.length > 0 && (
              <div>
                <div className="s-home-section-title" style={{ padding: "0 8px" }}>Offline ({offline.length})</div>
                {offline.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    allAgents={agents}
                    selected={agent.id === selectedAgentId}
                    onClick={() => navigate({ view: "agents", agentId: agent.id })}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail panel */}
      {selectedAgent && (
        <div className="s-agents-detail-panel">
          <AgentDetail
            agent={selectedAgent}
            allAgents={agents}
            messages={messages}
            conversationId={directConversationByAgentId.get(selectedAgent.id) ?? selectedAgent.conversationId ?? null}
            navigate={navigate}
          />
        </div>
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
  return (
    <div
      className={`s-agent-list-row${selected ? " s-agent-list-row-active" : ""}`}
      onClick={onClick}
    >
      <div className="s-avatar s-avatar-sm" style={{ background: actorColor(agent.name) }}>
        {agent.name[0].toUpperCase()}
      </div>
      <div className="s-agent-list-body">
        <div className="s-agent-list-header">
          <span className="s-agent-list-name">{name}</span>
          {qualifier && <span className="s-agent-list-qualifier">{qualifier}</span>}
          <span className="s-dot" style={{ background: stateColor(agent.state) }} />
        </div>
        <div className="s-agent-list-meta">
          <span>{agentStateLabel(agent.state)}</span>
          {agent.harness && <span>{agent.harness}</span>}
          {agent.updatedAt && <span>{timeAgo(agent.updatedAt)}</span>}
        </div>
      </div>
    </div>
  );
}
