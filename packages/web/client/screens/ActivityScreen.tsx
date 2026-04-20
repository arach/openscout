import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { actorColor } from "../lib/colors.ts";
import { renderWithMentions } from "../lib/mentions.tsx";
import { fullTimestamp, timeAgo } from "../lib/time.ts";
import { useContextMenu, type MenuItem } from "../components/ContextMenu.tsx";
import type { ActivityItem, Route } from "../lib/types.ts";
import "./system-surfaces-redesign.css";

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
  ask_sent: "asked",
  ask_replied: "replied",
  ask_working: "working",
  flight_created: "started task",
  flight_updated: "updated task",
  message_sent: "sent",
  message_received: "received",
};

type AuditCategory = "presence" | "work" | "message" | "collaboration" | "system";

const AUDIT_CATEGORY_META: Record<AuditCategory, { label: string; tone: "notice" | "working" | "completed" | "failed" }> = {
  presence: { label: "Presence", tone: "notice" },
  work: { label: "Execution", tone: "working" },
  message: { label: "Delivery", tone: "completed" },
  collaboration: { label: "Coordination", tone: "working" },
  system: { label: "System", tone: "notice" },
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/[._]/g, " ");
}

function activityCategory(kind: string): AuditCategory {
  if (kind.startsWith("agent.") || kind.includes("registered") || kind.includes("online") || kind.includes("offline")) {
    return "presence";
  }
  if (kind.startsWith("flight") || kind.startsWith("ask_")) return "work";
  if (kind.startsWith("message")) return "message";
  if (kind.startsWith("collaboration")) return "collaboration";
  return "system";
}

function actorInitial(name: string | null): string {
  return (name ?? "system").charAt(0).toUpperCase();
}

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function pathLeaf(value: string | null): string | null {
  if (!value) return null;
  const segments = value.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? value;
}

function fallbackTitle(item: ActivityItem): string {
  const actor = item.actorName ?? "system";
  return `${actor} ${kindLabel(item.kind)}`;
}

function fallbackSummary(item: ActivityItem): string {
  if (item.workspaceRoot) {
    return `Recorded from ${item.workspaceRoot}.`;
  }
  if (item.conversationId) {
    return `Linked to thread ${shortId(item.conversationId)}.`;
  }
  return "No additional detail was captured for this event.";
}

export function ActivityScreen({ navigate }: { navigate: (r: Route) => void }) {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  const activityRef = useRef<ActivityItem[]>([]);
  const requestIdRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showContextMenu = useContextMenu();

  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  const load = useCallback(async (mode: "initial" | "background" | "manual" = "initial") => {
    const requestId = ++requestIdRef.current;
    const hasSnapshot = activityRef.current.length > 0;

    if (!hasSnapshot && mode !== "background") {
      setLoading(true);
      setError(null);
    } else {
      setRefreshing(true);
    }

    try {
      const nextActivity = await api<ActivityItem[]>("/api/activity");
      if (requestId !== requestIdRef.current) return;
      setActivity(nextActivity);
      setError(null);
      setLastLoadedAt(Date.now());
      setExpandedId((current) => (nextActivity.some((item) => item.id === current) ? current : null));
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void load("background");
    }, 250);
  }, [load]);

  useEffect(() => {
    void load("initial");
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [load]);

  useBrokerEvents(scheduleRefresh);

  const metrics = useMemo(() => {
    const actors = new Set(activity.map((item) => item.actorName ?? "system"));
    const threads = new Set(activity.map((item) => item.conversationId).filter((value): value is string => Boolean(value)));
    return [
      {
        label: "Events",
        value: `${activity.length}`,
        detail: activity.length > 0 ? `Latest ${timeAgo(activity[0]!.ts)}` : "Waiting for records",
      },
      {
        label: "Actors",
        value: `${actors.size}`,
        detail: actors.size > 0 ? "Distinct event owners" : "No actors yet",
      },
      {
        label: "Threads",
        value: `${threads.size}`,
        detail: threads.size > 0 ? "Conversation-linked records" : "No linked threads",
      },
    ];
  }, [activity]);

  const showInitialError = !loading && activity.length === 0 && Boolean(error);
  const showEmpty = !loading && activity.length === 0 && !error;

  return (
    <div className="sys-surface-page">
      <div className="sys-page-head">
        <div className="sys-page-title-group">
          <h2 className="sys-page-title">Activity</h2>
          <p className="sys-page-subtitle">
            Broker events, task execution, and collaboration handoffs.
          </p>
        </div>
        <div className="sys-page-actions">
          <div className="sys-sync-note">
            {loading
              ? "Loading audit ledger..."
              : error && activity.length > 0
                ? `Showing last confirmed snapshot from ${lastLoadedAt ? timeAgo(lastLoadedAt) : "earlier"}`
                : lastLoadedAt
                  ? `Updated ${timeAgo(lastLoadedAt)}`
                  : "Waiting for first snapshot"}
          </div>
          <button
            type="button"
            className="s-btn"
            disabled={loading || refreshing}
            onClick={() => void load("manual")}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="sys-stat-grid">
        {metrics.map((metric) => (
          <div key={metric.label} className="sys-stat-card">
            <span className="sys-stat-label">{metric.label}</span>
            <strong className="sys-stat-value">{metric.value}</strong>
            <span className="sys-stat-detail">{metric.detail}</span>
          </div>
        ))}
      </div>

      {error && activity.length > 0 && (
        <div className="sys-banner sys-banner-warning">
          <strong>Refresh failed.</strong>
          <span>{error}</span>
        </div>
      )}

      {loading && activity.length === 0 && (
        <div className="sys-panel sys-state-card">
          <h3 className="sys-state-title">Loading activity</h3>
          <p className="sys-state-body">
            Pulling the latest records from the broker database.
          </p>
        </div>
      )}

      {showInitialError && (
        <div className="sys-panel sys-state-card sys-state-card-error">
          <h3 className="sys-state-title">Activity is unavailable</h3>
          <p className="sys-state-body">{error}</p>
          <div className="sys-inline-actions">
            <button type="button" className="s-btn" onClick={() => void load("manual")}>
              Try again
            </button>
          </div>
        </div>
      )}

      {showEmpty && (
        <div className="sys-panel sys-state-card">
          <h3 className="sys-state-title">No activity yet</h3>
          <p className="sys-state-body">
            Events appear here after agents register, send messages, or advance work.
          </p>
        </div>
      )}

      {activity.length > 0 && (
        <div className="sys-audit-list">
          {activity.map((item) => {
            const isExpanded = expandedId === item.id;
            const category = activityCategory(item.kind);
            const categoryMeta = AUDIT_CATEGORY_META[category];
            const workspaceLabel = pathLeaf(item.workspaceRoot);
            const summary = item.summary && item.summary !== item.title
              ? item.summary
              : fallbackSummary(item);

            return (
              <article
                key={item.id}
                className={`sys-audit-entry${isExpanded ? " sys-audit-entry-expanded" : ""}`}
                onContextMenu={(e) => {
                  const sel = window.getSelection()?.toString().trim();
                  const items: MenuItem[] = [];
                  if (sel) {
                    items.push({ kind: "action", label: "Copy Selection", shortcut: "⌘C", onSelect: () => navigator.clipboard.writeText(sel) });
                    items.push({ kind: "separator" });
                  }
                  const text = item.title ?? item.summary ?? "";
                  if (text) items.push({ kind: "action", label: "Copy Details", onSelect: () => navigator.clipboard.writeText(text) });
                  if (item.actorName) items.push({ kind: "action", label: "Copy Actor", onSelect: () => navigator.clipboard.writeText(item.actorName!) });
                  items.push({ kind: "action", label: "Copy Event ID", onSelect: () => navigator.clipboard.writeText(item.id) });
                  if (item.conversationId) {
                    items.push({ kind: "separator" });
                    items.push({ kind: "action", label: "Open Thread", onSelect: () => navigate({ view: "conversation", conversationId: item.conversationId! }) });
                  }
                  showContextMenu(e, items);
                }}
              >
                <button
                  type="button"
                  className="sys-audit-toggle"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  <div className="sys-audit-stamp">
                    <span className="sys-audit-time">{timeAgo(item.ts)}</span>
                    <span className="sys-audit-date">{fullTimestamp(item.ts)}</span>
                  </div>

                  <div className={`sys-audit-marker sys-audit-marker-${categoryMeta.tone}`}>
                    <span />
                  </div>

                  <div className="sys-audit-body">
                    <div className="sys-audit-topline">
                      <span className="sys-audit-category">{categoryMeta.label}</span>
                      <span className="sys-audit-kind">{kindLabel(item.kind)}</span>
                    </div>
                    <h3 className="sys-audit-title">
                      {renderWithMentions(item.title ?? fallbackTitle(item))}
                    </h3>
                    <p className="sys-audit-summary">{renderWithMentions(summary)}</p>
                    <div className="sys-audit-meta">
                      <span className="sys-audit-meta-item">
                        <span
                          className="sys-audit-avatar"
                          style={{ background: actorColor(item.actorName ?? "system") }}
                        >
                          {actorInitial(item.actorName)}
                        </span>
                        {item.actorName ?? "system"}
                      </span>
                      {workspaceLabel && (
                        <span className="sys-audit-meta-item">
                          Workspace {workspaceLabel}
                        </span>
                      )}
                      {item.conversationId && (
                        <span className="sys-audit-meta-item">
                          Thread {shortId(item.conversationId)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="sys-audit-expand">
                    {isExpanded ? "Close" : "Details"}
                  </div>
                </button>

                {isExpanded && (
                  <div className="sys-audit-details">
                    <div className="sys-detail-grid">
                      <div className="sys-detail-card">
                        <span className="sys-detail-label">Event</span>
                        <code className="sys-detail-value">{item.kind}</code>
                      </div>
                      <div className="sys-detail-card">
                        <span className="sys-detail-label">Recorded</span>
                        <span className="sys-detail-value">{fullTimestamp(item.ts)}</span>
                      </div>
                      <div className="sys-detail-card">
                        <span className="sys-detail-label">Actor</span>
                        <span className="sys-detail-value">{item.actorName ?? "system"}</span>
                      </div>
                      <div className="sys-detail-card">
                        <span className="sys-detail-label">Workspace</span>
                        <span className="sys-detail-value">{item.workspaceRoot ?? "Not attached"}</span>
                      </div>
                      <div className="sys-detail-card">
                        <span className="sys-detail-label">Thread</span>
                        <span className="sys-detail-value">{item.conversationId ?? "Not attached"}</span>
                      </div>
                      <div className="sys-detail-card">
                        <span className="sys-detail-label">Record id</span>
                        <code className="sys-detail-value">{item.id}</code>
                      </div>
                    </div>

                    {item.conversationId && (
                      <div className="sys-inline-actions">
                        <button
                          type="button"
                          className="s-btn s-btn-sm"
                          onClick={() => navigate({ view: "conversation", conversationId: item.conversationId! })}
                        >
                          Open thread
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
