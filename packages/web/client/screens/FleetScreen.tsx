import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { actorColor, kindLabel, stateColor } from "../lib/colors.ts";
import { agentStateLabel } from "../lib/agent-state.ts";
import { renderWithMentions } from "../lib/mentions.tsx";
import { timeAgo } from "../lib/time.ts";
import type {
  FleetActivity,
  FleetAsk,
  FleetAttentionItem,
  FleetState,
  Route,
} from "../lib/types.ts";

function askVariant(status: FleetAsk["status"]): "working" | "updated" | "completed" | "failed" {
  switch (status) {
    case "queued":
    case "working":
      return "working";
    case "needs_attention":
      return "updated";
    case "failed":
      return "failed";
    default:
      return "completed";
  }
}

function routeForAsk(ask: FleetAsk): Route {
  if (ask.conversationId) {
    return { view: "conversation", conversationId: ask.conversationId };
  }
  return { view: "agents", agentId: ask.agentId };
}

function routeForAttention(item: FleetAttentionItem): Route | null {
  if (item.kind === "work_item" && item.recordId) {
    return { view: "work", workId: item.recordId };
  }
  if (item.conversationId) {
    return { view: "conversation", conversationId: item.conversationId };
  }
  if (item.agentId) {
    return { view: "agents", agentId: item.agentId };
  }
  return null;
}

function routeForActivity(item: FleetActivity): Route | null {
  if (item.recordId) {
    return { view: "work", workId: item.recordId };
  }
  if (item.conversationId) {
    return { view: "conversation", conversationId: item.conversationId };
  }
  if (item.agentId) {
    return { view: "agents", agentId: item.agentId };
  }
  return null;
}

function AskRow({ ask, navigate }: { ask: FleetAsk; navigate: (r: Route) => void }) {
  const nextRoute = routeForAsk(ask);
  return (
    <div className="s-work-row s-work-row-clickable" onClick={() => navigate(nextRoute)}>
      <div className="s-work-row-header">
        <div className="s-fleet-row-title-wrap">
          <div className="s-avatar s-avatar-sm" style={{ background: actorColor(ask.agentName ?? ask.agentId) }}>
            {(ask.agentName ?? ask.agentId)[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="s-fleet-row-title-copy">
            <div className="s-work-row-title-wrap">
              <span className="s-work-row-title">{ask.agentName ?? ask.agentId}</span>
              {ask.harness && <span className="s-badge">{ask.harness}</span>}
              {ask.transport && <span className="s-badge">{ask.transport.replace(/_/g, " ")}</span>}
            </div>
            <div className="s-work-row-meta" style={{ marginTop: 2 }}>
              <span className="s-dot" style={{ background: stateColor(ask.agentState) }} />
              <span>{agentStateLabel(ask.agentState)}</span>
              <span>{ask.completedAt ? `finished ${timeAgo(ask.completedAt)}` : `updated ${timeAgo(ask.updatedAt)}`}</span>
            </div>
          </div>
        </div>
        <span className={`s-pill s-pill-${askVariant(ask.status)}`}>{ask.statusLabel}</span>
      </div>
      <p className="s-work-row-summary">{renderWithMentions(ask.task)}</p>
      {ask.summary && (
        <p className="s-work-row-summary" style={{ marginTop: 8 }}>{renderWithMentions(ask.summary)}</p>
      )}
    </div>
  );
}

function AttentionRow({ item, navigate }: { item: FleetAttentionItem; navigate: (r: Route) => void }) {
  const nextRoute = routeForAttention(item);
  const stateLabel = item.kind === "question" ? "question" : item.state.replace(/_/g, " ");
  const responseLabel = item.acceptanceState !== "none"
    ? item.acceptanceState.replace(/_/g, " ")
    : item.kind === "question"
      ? "awaiting answer"
      : "your move";
  return (
    <div
      className={`s-work-row${nextRoute ? " s-work-row-clickable" : ""}`}
      onClick={nextRoute ? () => navigate(nextRoute) : undefined}
    >
      <div className="s-work-row-header">
        <div className="s-work-row-title-wrap">
          <span className="s-work-row-title">{item.title}</span>
          {item.agentName && <span className="s-badge">{item.agentName}</span>}
        </div>
        <span className="s-pill s-pill-updated">Needs your input</span>
      </div>
      <div className="s-work-row-meta">
        <span>{stateLabel}</span>
        <span>{responseLabel}</span>
        <span>{timeAgo(item.updatedAt)}</span>
      </div>
      {item.summary && (
        <p className="s-work-row-summary">{renderWithMentions(item.summary)}</p>
      )}
    </div>
  );
}

export function FleetScreen({ navigate }: { navigate: (r: Route) => void }) {
  const [fleet, setFleet] = useState<FleetState | null>(null);

  const load = useCallback(async () => {
    try {
      setFleet(await api<FleetState>("/api/fleet"));
    } catch {
      setFleet(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  const activeAsks = fleet?.activeAsks ?? [];
  const recentCompleted = fleet?.recentCompleted ?? [];
  const needsAttention = fleet?.needsAttention ?? [];
  const activity = fleet?.activity ?? [];

  return (
    <div>
      <div className="s-home-header">
        <h2>Fleet</h2>
        <p>Track what you started first, then what needs your input, then what just finished, then the broader activity.</p>
      </div>

      {fleet && (
        <div className="s-fleet-summary-grid">
          <div className="s-fleet-summary-card">
            <div className="s-fleet-summary-label">Active asks</div>
            <div className="s-fleet-summary-value">{fleet.totals.active}</div>
            <div className="s-fleet-summary-meta">Currently in flight</div>
          </div>
          <div className="s-fleet-summary-card">
            <div className="s-fleet-summary-label">Needs your input</div>
            <div className="s-fleet-summary-value">{fleet.totals.needsAttention}</div>
            <div className="s-fleet-summary-meta">Awaiting an answer, review, or decision</div>
          </div>
          <div className="s-fleet-summary-card">
            <div className="s-fleet-summary-label">Recently finished</div>
            <div className="s-fleet-summary-value">{fleet.totals.recentCompleted}</div>
            <div className="s-fleet-summary-meta">Recent completed or failed asks</div>
          </div>
          <div className="s-fleet-summary-card">
            <div className="s-fleet-summary-label">Activity</div>
            <div className="s-fleet-summary-value">{fleet.totals.activity}</div>
            <div className="s-fleet-summary-meta">Updated {timeAgo(fleet.generatedAt)}</div>
          </div>
        </div>
      )}

      <div className="s-home-section">
        <div className="s-home-section-title">Active asks</div>
        {activeAsks.length === 0 ? (
          <div className="s-empty">
            <p>No active asks</p>
            <p>New agent work will appear here while it is still in progress.</p>
          </div>
        ) : (
          <div className="s-work-list">
            {activeAsks.map((ask) => (
              <AskRow key={ask.invocationId} ask={ask} navigate={navigate} />
            ))}
          </div>
        )}
      </div>

      {needsAttention.length > 0 && (
        <div className="s-home-section">
          <div className="s-home-section-title">Needs Your Input</div>
          <div className="s-work-list">
            {needsAttention.map((item) => (
              <AttentionRow key={item.recordId} item={item} navigate={navigate} />
            ))}
          </div>
        </div>
      )}

      <div className="s-home-section">
        <div className="s-home-section-title">Recently Finished</div>
        {recentCompleted.length === 0 ? (
          <div className="s-empty">
            <p>No recent finishes</p>
            <p>Completed asks and failures will show up here once they settle.</p>
          </div>
        ) : (
          <div className="s-work-list">
            {recentCompleted.map((ask) => (
              <AskRow key={ask.invocationId} ask={ask} navigate={navigate} />
            ))}
          </div>
        )}
      </div>

      <div className="s-home-section">
        <div className="s-home-section-title">Overall Activity</div>
        {activity.length === 0 ? (
          <div className="s-empty">
            <p>No recent fleet activity</p>
            <p>Messages, asks, and other agent activity will stream here.</p>
          </div>
        ) : (
          <div className="s-activity-list">
            {activity.slice(0, 20).map((item) => {
              const nextRoute = routeForActivity(item);
              return (
                <div key={item.id} className="s-activity-list-item">
                  <div
                    className={`s-activity-list-row${nextRoute ? " s-activity-list-row-clickable" : ""}`}
                    onClick={nextRoute ? () => navigate(nextRoute) : undefined}
                  >
                    <div
                      className="s-avatar s-avatar-sm"
                      style={{ background: actorColor(item.actorName ?? item.agentId ?? "system") }}
                    >
                      {(item.actorName ?? item.agentId ?? "S")[0]?.toUpperCase() ?? "S"}
                    </div>
                    <div className="s-activity-list-body">
                      <div className="s-activity-list-header">
                        <span className="s-activity-list-actor">{item.actorName ?? "system"}</span>
                        <span className="s-pill s-pill-updated">{kindLabel(item.kind)}</span>
                        <span className="s-time">{timeAgo(item.ts)}</span>
                      </div>
                      {item.title && (
                        <p className="s-activity-list-title">{renderWithMentions(item.title)}</p>
                      )}
                      {item.summary && (
                        <p className="s-work-row-summary">{renderWithMentions(item.summary)}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
