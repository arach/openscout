import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { WorkList } from "../components/WorkList.tsx";
import type { Agent, ActivityItem, Route, WorkItem } from "../lib/types.ts";

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
  const [work, setWork] = useState<WorkItem[]>([]);

  const load = useCallback(async () => {
    try {
      const [nextShell, nextActivity, nextWork] = await Promise.all([
        api<ShellState>("/api/shell-state"),
        api<ActivityItem[]>("/api/activity"),
        api<WorkItem[]>("/api/work"),
      ]);
      setShell(nextShell);
      setActivity(nextActivity);
      setWork(nextWork);
    } catch {
      // stay empty on error
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  const rt = shell?.runtime;
  const brokerRunning = rt?.brokerReachable ?? false;
  const activeAgents = agents.filter((a) => a.state === "active");
  const hasAgents = agents.length > 0;

  return (
    <div className="s-home">
      <div className="s-home-header">
        <h2>Home</h2>
        <p>
          {hasAgents
            ? `${activeAgents.length} active, ${agents.length - activeAgents.length} offline`
            : "No agents connected yet"}
        </p>
      </div>

      {/* Status card */}
      <div className="s-home-section">
        <div className="s-home-section-title">Status</div>
        <div className="s-home-card">
          <div className="s-home-card-row">
            <span className="s-home-card-row-label">Broker</span>
            <span className="s-dot" style={{ background: brokerRunning ? "var(--green)" : "var(--red)" }} />
            <span className="s-home-card-row-value">{rt?.brokerLabel ?? (brokerRunning ? "Running" : "Stopped")}</span>
          </div>
          {rt?.nodeId && (
            <div className="s-home-card-row">
              <span className="s-home-card-row-label">Node</span>
              <span className="s-home-card-row-value">{rt.nodeId}</span>
            </div>
          )}
          <div className="s-home-card-row">
            <span className="s-home-card-row-label">Agents</span>
            <span className="s-home-card-row-value">{rt?.agentCount ?? agents.length}</span>
          </div>
        </div>
      </div>

      {/* Active agents */}
      {activeAgents.length > 0 && (
        <div className="s-home-section">
          <div className="s-home-section-title">Active</div>
          <div className="s-home-card">
            {activeAgents.map((agent) => (
              <div
                key={agent.id}
                className="s-home-card-row s-home-card-row-clickable"
                onClick={() => navigate({ view: "agents", agentId: agent.id })}
              >
                <div className="s-avatar s-avatar-sm" style={{ background: actorColor(agent.name) }}>
                  {agent.name[0].toUpperCase()}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", flex: 1 }}>
                  {agent.name}
                </span>
                <span className="s-dot" style={{ background: stateColor(agent.state) }} />
                {agent.harness && <span className="s-badge">{agent.harness}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="s-home-section">
        <div className="s-home-section-title">Active work</div>
        <WorkList
          items={work}
          navigate={navigate}
          emptyTitle="No active work"
          emptyDetail={hasAgents ? "Open work items will appear here as agents pick them up." : undefined}
        />
      </div>

      {/* Activity stream */}
      <div className="s-home-section">
        <div className="s-home-section-title">Activity</div>
        {activity.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--muted)" }}>No activity yet</p>
        ) : (
          <div className="s-activity-stream">
            {activity.slice(0, 30).map((item) => (
              <div
                key={item.id}
                className={`s-activity-row${item.conversationId ? " s-activity-row-clickable" : ""}`}
                onClick={item.conversationId ? () => navigate({ view: "conversation", conversationId: item.conversationId! }) : undefined}
              >
                <span className="s-activity-time">{timeAgo(item.ts)}</span>
                <span className="s-activity-actor">{item.actorName ?? "system"}</span>
                <span className="s-activity-kind">{kindLabel(item.kind)}</span>
                {item.title && <span className="s-activity-title">{item.title}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Getting started — only when no agents */}
      {!hasAgents && (
        <div className="s-home-section">
          <div className="s-home-section-title">Getting started</div>
          <ol className="s-home-steps">
            <li data-step="1">Install the CLI: <code>bun install -g @openscout/scout</code></li>
            <li data-step="2">Start the broker: <code>scout broker</code></li>
            <li data-step="3">Link a project: <code>scout setup</code></li>
            <li data-step="4">Agents appear here as they connect</li>
          </ol>
        </div>
      )}
    </div>
  );
}
