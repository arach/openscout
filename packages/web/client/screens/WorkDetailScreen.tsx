import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { fullTimestamp, timeAgo } from "../lib/time.ts";
import { renderWithMentions } from "../lib/mentions.tsx";
import type { Route, WorkDetail, WorkTimelineItem } from "../lib/types.ts";

function pillVariant(work: WorkDetail): "updated" | "working" | "completed" | "failed" {
  if (work.attention === "interrupt") return "failed";
  if (work.state === "done") return "completed";
  if (work.attention === "badge" || work.state === "waiting" || work.state === "review") return "updated";
  return "working";
}

function stateLabel(state: string): string {
  switch (state) {
    case "review":
      return "In review";
    case "waiting":
      return "Waiting";
    case "working":
      return "Working";
    case "done":
      return "Done";
    default:
      return state.replace(/_/g, " ");
  }
}

function attentionLabel(attention: WorkDetail["attention"]): string | null {
  switch (attention) {
    case "badge":
      return "Needs attention";
    case "interrupt":
      return "Blocked";
    default:
      return null;
  }
}

function timelineKindLabel(item: WorkTimelineItem): string {
  switch (item.kind) {
    case "flight_started":
      return "flight started";
    case "flight_completed":
      return item.detailKind ? `flight ${item.detailKind}` : "flight ended";
    case "message":
      return "message";
    case "collaboration_event":
    default:
      return item.title ?? item.detailKind ?? "event";
  }
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="s-detail-row">
      <span className="s-detail-label">{label}</span>
      <span className="s-detail-value">{value}</span>
    </div>
  );
}

export function WorkDetailScreen({
  workId,
  navigate,
}: {
  workId: string;
  navigate: (r: Route) => void;
}) {
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await api<WorkDetail>(`/api/work/${encodeURIComponent(workId)}`);
      setDetail(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDetail(null);
    } finally {
      setLoaded(true);
    }
  }, [workId]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);
  useBrokerEvents(load);

  if (!loaded) {
    return (
      <div>
        <button type="button" className="s-back" onClick={() => navigate({ view: "inbox" })}>
          &larr; Back
        </button>
        <div className="s-empty"><p>Loading…</p></div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div>
        <button type="button" className="s-back" onClick={() => navigate({ view: "inbox" })}>
          &larr; Back
        </button>
        {error && <p className="s-error">{error}</p>}
        <div className="s-empty"><p>Work item not found</p></div>
      </div>
    );
  }

  const attention = attentionLabel(detail.attention);
  const ownerLabel = detail.ownerName ?? detail.ownerId ?? "Unassigned";
  const nextMoveLabel = detail.nextMoveOwnerName ?? detail.nextMoveOwnerId ?? "—";

  return (
    <div className="s-work-detail">
      <button type="button" className="s-back" onClick={() => navigate({ view: "inbox" })}>
        &larr; Back
      </button>

      {error && <p className="s-error">{error}</p>}

      <div className="s-home-section">
        <div className="s-work-row-header">
          <div className="s-work-row-title-wrap">
            <h2 style={{ margin: 0, fontSize: 16 }}>{detail.title}</h2>
            {detail.priority && <span className="s-badge">{detail.priority}</span>}
          </div>
          <span className={`s-pill s-pill-${pillVariant(detail)}`}>{detail.currentPhase}</span>
        </div>
        {detail.lastMeaningfulSummary && (
          <p className="s-work-row-summary" style={{ marginTop: 8 }}>
            {renderWithMentions(detail.lastMeaningfulSummary)}
          </p>
        )}
        <div className="s-work-row-meta" style={{ marginTop: 10 }}>
          <span>Updated {timeAgo(detail.updatedAt)}</span>
          {detail.activeChildWorkCount > 0 && (
            <span>{detail.activeChildWorkCount} child{detail.activeChildWorkCount === 1 ? "" : "ren"}</span>
          )}
          {detail.activeFlightCount > 0 && (
            <span>{detail.activeFlightCount} flight{detail.activeFlightCount === 1 ? "" : "s"}</span>
          )}
          {attention && <span>{attention}</span>}
        </div>
      </div>

      <div className="s-home-section">
        <div className="s-home-section-title">Coordination</div>
        <div className="s-home-card">
          <DetailRow label="State" value={stateLabel(detail.state)} />
          <DetailRow label="Acceptance" value={detail.acceptanceState.replace(/_/g, " ")} />
          <DetailRow label="Owner" value={ownerLabel} />
          <DetailRow label="Next move" value={nextMoveLabel} />
          <DetailRow label="Phase" value={detail.currentPhase} />
          {detail.priority && <DetailRow label="Priority" value={detail.priority} />}
          <DetailRow label="Created" value={fullTimestamp(detail.createdAt)} />
          {detail.conversationId && (
            <div
              className="s-detail-row s-home-card-row-clickable"
              onClick={() => navigate({ view: "conversation", conversationId: detail.conversationId! })}
            >
              <span className="s-detail-label">Conversation</span>
              <span className="s-detail-value" style={{ color: "var(--accent)" }}>Open</span>
            </div>
          )}
          {detail.parentId && detail.parentTitle && (
            <div
              className="s-detail-row s-home-card-row-clickable"
              onClick={() => navigate({ view: "work", workId: detail.parentId! })}
            >
              <span className="s-detail-label">Parent</span>
              <span className="s-detail-value" style={{ color: "var(--accent)" }}>{detail.parentTitle}</span>
            </div>
          )}
        </div>
      </div>

      {detail.activeFlights.length > 0 && (
        <div className="s-home-section">
          <div className="s-home-section-title">Active flights</div>
          <div className="s-home-card">
            {detail.activeFlights.map((flight) => (
              <div key={flight.id} className="s-detail-row">
                <span className="s-detail-label">{flight.agentName ?? flight.agentId}</span>
                <span className="s-detail-value">
                  {flight.state}
                  {flight.summary ? ` — ${flight.summary}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {detail.childWork.length > 0 && (
        <div className="s-home-section">
          <div className="s-home-section-title">Child work</div>
          <div className="s-work-list">
            {detail.childWork.map((child) => (
              <div
                key={child.id}
                className="s-work-row s-work-row-clickable"
                onClick={() => navigate({ view: "work", workId: child.id })}
              >
                <div className="s-work-row-header">
                  <div className="s-work-row-title-wrap">
                    <span className="s-work-row-title">{child.title}</span>
                  </div>
                  <span className="s-pill s-pill-updated">{child.currentPhase}</span>
                </div>
                <div className="s-work-row-meta">
                  <span>{child.ownerName ?? child.ownerId ?? "Unassigned"}</span>
                  <span>{stateLabel(child.state)}</span>
                  <span>{timeAgo(child.lastMeaningfulAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="s-home-section">
        <div className="s-home-section-title">Timeline</div>
        {detail.timeline.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--muted)" }}>No activity yet.</p>
        ) : (
          <div className="s-activity-stream">
            {detail.timeline.map((item) => (
              <div
                key={item.id}
                className={`s-activity-row${item.conversationId ? " s-activity-row-clickable" : ""}`}
                onClick={item.conversationId
                  ? () => navigate({ view: "conversation", conversationId: item.conversationId! })
                  : undefined}
              >
                <span className="s-activity-time">{timeAgo(item.at)}</span>
                <span className="s-activity-actor">{item.actorName ?? "system"}</span>
                <span className="s-activity-kind">{timelineKindLabel(item)}</span>
                {item.summary && (
                  <span className="s-activity-title">
                    {renderWithMentions(item.summary)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
