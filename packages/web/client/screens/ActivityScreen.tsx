import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor } from "../lib/colors.ts";
import { renderWithMentions } from "../lib/mentions.tsx";
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

function kindPillVariant(kind: string): "updated" | "working" | "completed" | "failed" {
  if (kind.includes("fail") || kind.includes("offline")) return "failed";
  if (kind.includes("complet") || kind.includes("replied") || kind.includes("online")) return "completed";
  if (kind.includes("work") || kind.includes("start") || kind.includes("sent")) return "working";
  return "updated";
}

function fullTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

export function ActivityScreen({ navigate }: { navigate: (r: Route) => void }) {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
          {activity.map((item) => {
            const isExpanded = expandedId === item.id;
            return (
              <div key={item.id} className="s-activity-list-item">
                <div
                  className="s-activity-list-row s-activity-list-row-clickable"
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
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
                      <span className={`s-pill s-pill-${kindPillVariant(item.kind)}`}>{kindLabel(item.kind)}</span>
                      <span className="s-time">{timeAgo(item.ts)}</span>
                    </div>
                    {item.title && (
                      <p className="s-activity-list-title">{renderWithMentions(item.title)}</p>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="s-activity-expanded">
                    {item.summary && (
                      <p className="s-activity-expanded-summary">{renderWithMentions(item.summary)}</p>
                    )}
                    <div className="s-activity-expanded-meta">
                      <span className="s-activity-meta-label">Event</span>
                      <span className="s-activity-meta-value">{item.kind}</span>
                    </div>
                    <div className="s-activity-expanded-meta">
                      <span className="s-activity-meta-label">Time</span>
                      <span className="s-activity-meta-value">{fullTimestamp(item.ts)}</span>
                    </div>
                    {item.actorName && (
                      <div className="s-activity-expanded-meta">
                        <span className="s-activity-meta-label">Actor</span>
                        <span className="s-activity-meta-value">{item.actorName}</span>
                      </div>
                    )}
                    {item.conversationId && (
                      <div className="s-activity-expanded-meta">
                        <span className="s-activity-meta-label">Thread</span>
                        <span className="s-activity-meta-value">{item.conversationId}</span>
                      </div>
                    )}
                    {item.conversationId && (
                      <div className="s-activity-expanded-actions">
                        <button
                          type="button"
                          className="s-btn s-btn-sm"
                          onClick={() => navigate({ view: "conversation", conversationId: item.conversationId! })}
                        >
                          See thread
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
