import "./dashboard-redesign.css";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { renderWithMentions } from "../lib/mentions.tsx";
import type { Agent, ActivityItem, Route } from "../lib/types.ts";

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
  navigate,
}: {
  agents: Agent[];
  messages: unknown[];
  navigate: (r: Route) => void;
}) {
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const load = useCallback(async () => {
    try {
      const next = await api<ActivityItem[]>("/api/activity");
      setActivity(next);
    } catch {
      // stay empty on error
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  const activityPreview = activity.slice(0, 20);

  return (
    <div className="s-home s-dashboard-screen">
      <div className="s-dashboard-body s-dashboard-body-solo">
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
      </div>
    </div>
  );
}
