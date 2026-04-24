import { useCallback, useEffect, useState, type ReactNode } from "react";
import { renderWithMentions } from "../lib/mentions.tsx";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { fullTimestamp, timeAgo } from "../lib/time.ts";
import type { Route, WorkDetail, WorkTimelineItem } from "../lib/types.ts";

type Fact = {
  label: string;
  value: ReactNode;
};

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

function timelineTone(item: WorkTimelineItem): "message" | "flight" | "done" | "alert" | "system" {
  if (item.kind === "message") {
    return "message";
  }
  if (item.kind === "flight_started") {
    return "flight";
  }
  if (item.kind === "flight_completed") {
    return item.detailKind?.includes("fail") ? "alert" : "done";
  }
  if (item.detailKind?.includes("interrupt") || item.detailKind?.includes("block")) {
    return "alert";
  }
  return "system";
}

function FactCard({
  title,
  items,
}: {
  title: string;
  items: Fact[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="s-work-fact-card">
      <div className="s-work-fact-card-header">
        <div className="s-work-fact-card-title">{title}</div>
      </div>
      <div className="s-work-fact-card-body">
        {items.map((item) => (
          <div key={item.label} className="s-work-fact-row">
            <span className="s-work-fact-label">{item.label}</span>
            <span className="s-work-fact-value">{item.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActionRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="s-work-action-row" onClick={onClick}>
      <span className="s-work-action-row-label">{label}</span>
      <span className="s-work-action-row-value">{value}</span>
    </button>
  );
}

function compactId(id: string): string {
  const parts = id.split(".");
  return parts[parts.length - 1] || id;
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
  useBrokerEvents(() => {
    void load();
  });

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
  const statusFacts: Fact[] = [
    { label: "State", value: stateLabel(detail.state) },
    { label: "Acceptance", value: detail.acceptanceState.replace(/_/g, " ") },
    { label: "Phase", value: detail.currentPhase },
    ...(attention ? [{ label: "Attention", value: attention }] : []),
  ];
  const assignmentFacts: Fact[] = [
    { label: "Owner", value: ownerLabel },
    { label: "Next move", value: nextMoveLabel },
    ...(detail.priority ? [{ label: "Priority", value: detail.priority }] : []),
    { label: "Conversation", value: detail.conversationId ? "Attached" : "None" },
  ];
  const recordFacts: Fact[] = [
    { label: "Case ID", value: detail.id },
    { label: "Created", value: fullTimestamp(detail.createdAt) },
    { label: "Updated", value: fullTimestamp(detail.updatedAt) },
    { label: "Last activity", value: fullTimestamp(detail.lastMeaningfulAt) },
  ];

  return (
    <div className="s-work-detail s-work-casefile">
      <div className="s-work-casefile-topbar">
        <button type="button" className="s-back" onClick={() => navigate({ view: "inbox" })}>
          &larr; Back
        </button>
        <span className="s-work-casefile-record">Case {compactId(detail.id)}</span>
      </div>

      {error && <p className="s-error">{error}</p>}

      <section className="s-work-casefile-hero">
        <div className="s-work-casefile-hero-main">
          <div className="s-work-casefile-title-row">
            <h1 className="s-work-casefile-title">{detail.title}</h1>
            <span className={`s-pill s-pill-${pillVariant(detail)}`}>{detail.currentPhase}</span>
          </div>
          {detail.lastMeaningfulSummary && (
            <div className="s-work-casefile-summary">
              {renderWithMentions(detail.lastMeaningfulSummary)}
            </div>
          )}
          <div className="s-work-casefile-meta">
            <span>Updated {timeAgo(detail.updatedAt)}</span>
            <span>{ownerLabel}</span>
            <span>{stateLabel(detail.state)}</span>
            {attention && <span>{attention}</span>}
            {detail.priority && <span>Priority {detail.priority}</span>}
          </div>
        </div>
      </section>

      <div className="s-work-casefile-layout">
        <div className="s-work-casefile-main">
          <section className="s-work-casefile-section">
            <div className="s-agent-section-heading">
              <h2 className="s-agent-section-title">Case facts</h2>
            </div>
            <div className="s-work-fact-grid">
              <FactCard
                title="Status"
                items={statusFacts}
              />
              <FactCard
                title="Assignment"
                items={assignmentFacts}
              />
            </div>
          </section>

          {detail.activeFlights.length > 0 && (
            <section className="s-work-casefile-section">
              <div className="s-agent-section-heading">
                <h2 className="s-agent-section-title">Flights</h2>
              </div>
              <div className="s-work-flight-list">
                {detail.activeFlights.map((flight) => (
                  <button
                    key={flight.id}
                    type="button"
                    className="s-work-flight-card"
                    onClick={
                      flight.conversationId
                        ? () => navigate({ view: "conversation", conversationId: flight.conversationId! })
                        : undefined
                    }
                    disabled={!flight.conversationId}
                  >
                    <div className="s-work-flight-card-header">
                      <span className="s-work-flight-card-title">{flight.agentName ?? flight.agentId}</span>
                      <span className="s-pill s-pill-working">{flight.state}</span>
                    </div>
                    <div className="s-work-flight-card-meta">
                      <span>{flight.startedAt ? `Started ${timeAgo(flight.startedAt)}` : "Start time unavailable"}</span>
                      {flight.completedAt && <span>Completed {timeAgo(flight.completedAt)}</span>}
                    </div>
                    {flight.summary && <div className="s-work-flight-card-copy">{flight.summary}</div>}
                  </button>
                ))}
              </div>
            </section>
          )}

          {detail.childWork.length > 0 && (
            <section className="s-work-casefile-section">
              <div className="s-agent-section-heading">
                <h2 className="s-agent-section-title">Child work</h2>
              </div>
              <div className="s-work-related-list">
                {detail.childWork.map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    className="s-work-related-card"
                    onClick={() => navigate({ view: "work", workId: child.id })}
                  >
                    <div className="s-work-related-card-header">
                      <span className="s-work-related-card-title">{child.title}</span>
                      <span className={`s-pill s-pill-${child.attention === "interrupt" ? "failed" : "updated"}`}>
                        {child.currentPhase}
                      </span>
                    </div>
                    <div className="s-work-related-card-meta">
                      <span>{child.ownerName ?? child.ownerId ?? "Unassigned"}</span>
                      <span>{stateLabel(child.state)}</span>
                      <span>{timeAgo(child.lastMeaningfulAt)}</span>
                    </div>
                    {child.lastMeaningfulSummary && (
                      <div className="s-work-related-card-copy">
                        {renderWithMentions(child.lastMeaningfulSummary)}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="s-work-casefile-section">
            <div className="s-agent-section-heading">
              <h2 className="s-agent-section-title">Timeline</h2>
            </div>
            {detail.timeline.length === 0 ? (
              <div className="s-empty">
                <p>No activity yet.</p>
                <p>Timeline events will appear once the case receives messages or coordination updates.</p>
              </div>
            ) : (
              <div className="s-work-timeline">
                {detail.timeline.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`s-work-timeline-entry${item.conversationId ? " s-work-timeline-entry-clickable" : ""}`}
                    onClick={
                      item.conversationId
                        ? () => navigate({ view: "conversation", conversationId: item.conversationId! })
                        : undefined
                    }
                    disabled={!item.conversationId}
                  >
                    <span className={`s-work-timeline-marker s-work-timeline-marker-${timelineTone(item)}`} />
                    <div className="s-work-timeline-content">
                      <div className="s-work-timeline-header">
                        <span className="s-work-timeline-time">{timeAgo(item.at)}</span>
                        <span className={`s-work-timeline-kind s-work-timeline-kind-${timelineTone(item)}`}>
                          {timelineKindLabel(item)}
                        </span>
                      </div>
                      <div className="s-work-timeline-actor">{item.actorName ?? "system"}</div>
                      {item.title && <div className="s-work-timeline-title">{item.title}</div>}
                      {item.summary && (
                        <div className="s-work-timeline-summary">{renderWithMentions(item.summary)}</div>
                      )}
                      <div className="s-work-timeline-stamp">{fullTimestamp(item.at)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="s-work-casefile-side">
          <FactCard
            title="Record"
            items={recordFacts}
          />

          <section className="s-work-fact-card">
            <div className="s-work-fact-card-header">
              <div className="s-work-fact-card-title">Links</div>
            </div>
            <div className="s-work-action-list">
              {detail.conversationId ? (
                <ActionRow
                  label="Conversation"
                  value="Open thread"
                  onClick={() => navigate({ view: "conversation", conversationId: detail.conversationId! })}
                />
              ) : (
                <div className="s-work-action-list-empty">No conversation attached.</div>
              )}
              {detail.parentId && detail.parentTitle ? (
                <ActionRow
                  label="Parent"
                  value={detail.parentTitle}
                  onClick={() => navigate({ view: "work", workId: detail.parentId! })}
                />
              ) : (
                <div className="s-work-action-list-empty">No parent work item.</div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
