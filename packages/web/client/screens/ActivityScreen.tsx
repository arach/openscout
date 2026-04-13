import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor } from "../lib/colors.ts";
import type { ActivityItem, Route } from "../lib/types.ts";

const KIND_LABELS: Record<string, string> = {
  "agent.registered": "registered",
  "agent.online": "came online",
  "agent.offline": "went offline",
  "flight.started": "started task",
  "flight.completed": "completed task",
  "flight.updated": "updated task",
  "message.sent": "sent message",
  "message.received": "received message",
  "collaboration.ask": "asked a question",
  "collaboration.answer": "answered",
  "ask_sent": "asked",
  "ask_replied": "replied",
  "ask_working": "working",
  "flight_created": "started task",
  "flight_updated": "updated task",
  "message_sent": "sent",
  "message_received": "received",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/[._]/g, " ");
}

export function ActivityScreen({ navigate }: { navigate: (r: Route) => void }) {
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const load = useCallback(async () => {
    try {
      setActivity(await api<ActivityItem[]>("/api/activity"));
    } catch {
      // stay empty
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  return (
    <div>
      <h2 className="s-section-title">Activity</h2>

      {activity.length === 0 ? (
        <div className="s-empty">
          <p>No activity yet</p>
          <p>Events appear here as agents connect and work</p>
        </div>
      ) : (
        <div className="s-activity-list">
          {activity.map((item) => (
            <div
              key={item.id}
              className={`s-activity-list-row${item.conversationId ? " s-activity-list-row-clickable" : ""}`}
              onClick={item.conversationId ? () => navigate({ view: "conversation", conversationId: item.conversationId! }) : undefined}
            >
              <div
                className="s-avatar s-avatar-sm"
                style={{ background: actorColor(item.actorName ?? "system") }}
              >
                {(item.actorName ?? "S")[0].toUpperCase()}
              </div>
              <div className="s-activity-list-body">
                <div className="s-activity-list-header">
                  <span className="s-activity-list-actor">{item.actorName ?? "system"}</span>
                  <span className="s-activity-list-kind">{kindLabel(item.kind)}</span>
                  <span className="s-time">{timeAgo(item.ts)}</span>
                </div>
                {item.title && (
                  <p className="s-activity-list-title">{item.title}</p>
                )}
                {item.summary && (
                  <p className="s-activity-list-summary">{item.summary}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
