import "./dashboard-redesign.css";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { agentStateLabel, isAgentOnline } from "../lib/agent-state.ts";
import { renderWithMentions } from "../lib/mentions.tsx";
import type { Agent, ActivityItem, Route } from "../lib/types.ts";

type ShellState = {
  runtime?: {
    brokerReachable?: boolean;
    brokerHealthy?: boolean;
    brokerLabel?: string;
    agentCount?: number;
    messageCount?: number;
    nodeId?: string;
  };
};

const KIND_LABELS: Record<string, string> = {
  "agent.registered": "registered",
  "agent.online": "came online",
  "agent.offline": "went offline",
  "flight.started": "started task",
  "flight.completed": "completed task",
  "message.sent": "sent message",
  "message.received": "received message",
  "collaboration.ask": "asked a question",
  "collaboration.answer": "answered",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/[._]/g, " ");
}

function HomeAgentRow({
  agent,
  navigate,
}: {
  agent: Agent;
  navigate: (route: Route) => void;
}) {
  return (
    <button
      type="button"
      className="s-dashboard-agent-row"
      onClick={() => navigate({ view: "agents", agentId: agent.id })}
    >
      <div className="s-avatar s-avatar-xs" style={{ background: actorColor(agent.name) }}>
        {agent.name[0]?.toUpperCase() ?? "?"}
      </div>
      <div className="s-dashboard-agent-copy">
        <span className="s-dashboard-agent-name">{agent.name}</span>
        <span className="s-dashboard-agent-meta">
          <span className="s-dot" style={{ background: stateColor(agent.state) }} />
          {agentStateLabel(agent.state)}
        </span>
      </div>
    </button>
  );
}

function HomeActivityRow({
  item,
  navigate,
}: {
  item: ActivityItem;
  navigate: (route: Route) => void;
}) {
  const nextRoute: Route | null = item.conversationId
    ? { view: "conversation", conversationId: item.conversationId }
    : null;

  return (
    <div
      className={`s-dashboard-activity-row${nextRoute ? " s-dashboard-activity-row-clickable" : ""}`}
      onClick={nextRoute ? () => navigate(nextRoute) : undefined}
    >
      <div className="s-dashboard-activity-time">{timeAgo(item.ts)}</div>
      <div className="s-dashboard-activity-body">
        <div className="s-dashboard-activity-header">
          <span className="s-dashboard-activity-actor">{item.actorName ?? "system"}</span>
          <span className="s-dashboard-activity-kind">{kindLabel(item.kind)}</span>
        </div>
        {(item.title || item.summary) && (
          <p className="s-dashboard-activity-summary">
            {renderWithMentions(item.title ?? item.summary ?? "")}
          </p>
        )}
      </div>
    </div>
  );
}

export function HomeScreen({
  agents,
  navigate,
}: {
  agents: Agent[];
  messages: unknown[];
  navigate: (r: Route) => void;
}) {
  const [shell, setShell] = useState<ShellState | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const load = useCallback(async () => {
    try {
      const [nextShell, nextActivity] = await Promise.all([
        api<ShellState>("/api/shell-state"),
        api<ActivityItem[]>("/api/activity"),
      ]);
      setShell(nextShell);
      setActivity(nextActivity);
    } catch {
      // stay empty on error
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  const rt = shell?.runtime;
  const brokerRunning = rt?.brokerReachable ?? false;
  const onlineAgents = agents.filter((a) => isAgentOnline(a.state));
  const offlineAgents = agents.filter((a) => !isAgentOnline(a.state));
  const hasAgents = agents.length > 0;
  const activityPreview = activity.slice(0, 20);

  return (
    <div className="s-home s-dashboard-screen">
      <div className="s-dashboard-body">
        <main className="s-dashboard-main">
          <div className="s-dashboard-section-head">
            <h3>Activity</h3>
            {activity.length > 0 && (
              <span className="s-dashboard-count">{activity.length}</span>
            )}
          </div>
          {activityPreview.length === 0 ? (
            <div className="s-empty">
              <p>No activity yet</p>
              <p>Events appear here as agents connect and work.</p>
            </div>
          ) : (
            <div className="s-dashboard-activity-feed">
              {activityPreview.map((item) => (
                <HomeActivityRow key={item.id} item={item} navigate={navigate} />
              ))}
            </div>
          )}
          {activity.length > 20 && (
            <button
              type="button"
              className="s-dashboard-see-all"
              onClick={() => navigate({ view: "activity" })}
            >
              See all activity
            </button>
          )}
        </main>

        <aside className="s-dashboard-rail">
          <div className="s-dashboard-section-head">
            <h3>Agents</h3>
            {agents.length > 0 && (
              <span className="s-dashboard-count">{agents.length}</span>
            )}
          </div>
          {onlineAgents.length > 0 ? (
            <div className="s-dashboard-roster-block">
              <div className="s-dashboard-roster-label">Online</div>
              <div className="s-dashboard-agent-list">
                {onlineAgents.map((agent) => (
                  <HomeAgentRow key={agent.id} agent={agent} navigate={navigate} />
                ))}
              </div>
            </div>
          ) : (
            <div className="s-empty">
              <p>{hasAgents ? "All agents offline" : "No agents connected"}</p>
              <p>
                {hasAgents
                  ? "Agents appear here when they reconnect."
                  : "Connect an agent to see your roster."}
              </p>
            </div>
          )}
          {offlineAgents.length > 0 && (
            <div className="s-dashboard-roster-block">
              <div className="s-dashboard-roster-label">Standby</div>
              <div className="s-dashboard-chip-row">
                {offlineAgents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    className="s-dashboard-chip"
                    onClick={() => navigate({ view: "agents", agentId: agent.id })}
                  >
                    {agent.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      <footer className="s-dashboard-statusbar">
        <span className="s-dashboard-statusbar-item">
          <span
            className="s-dot"
            style={{ background: brokerRunning ? "var(--green)" : "var(--red)" }}
          />
          {rt?.brokerLabel ?? (brokerRunning ? "Broker healthy" : "Broker offline")}
        </span>
        {rt?.nodeId && (
          <span className="s-dashboard-statusbar-item s-dashboard-statusbar-mono">
            {rt.nodeId.length > 14 ? `${rt.nodeId.slice(0, 10)}…` : rt.nodeId}
          </span>
        )}
        <span className="s-dashboard-statusbar-item">
          {rt?.agentCount ?? agents.length} agent{(rt?.agentCount ?? agents.length) === 1 ? "" : "s"}
        </span>
        <span className="s-dashboard-statusbar-item">
          {rt?.messageCount ?? 0} msg{(rt?.messageCount ?? 0) === 1 ? "" : "s"}
        </span>
      </footer>
    </div>
  );
}
