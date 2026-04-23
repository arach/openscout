import "./dashboard-redesign.css";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { actorColor, kindLabel, stateColor } from "../lib/colors.ts";
import { agentStateLabel } from "../lib/agent-state.ts";
import { renderWithMentions } from "../lib/mentions.tsx";
import { timeAgo } from "../lib/time.ts";
import type {
  Flight,
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

function flightVariant(state: string): "working" | "updated" | "completed" | "failed" {
  switch (state) {
    case "completed":
      return "completed";
    case "failed":
    case "cancelled":
      return "failed";
    case "waiting":
      return "updated";
    default:
      return "working";
  }
}

function flightStateLabel(state: string): string {
  return state.replace(/[_-]/g, " ");
}

function flightDescription(flight: Flight, ask: FleetAsk | undefined): string {
  return flight.summary?.trim()
    || ask?.summary?.trim()
    || ask?.task?.trim()
    || "No flight summary yet.";
}

function elapsedLabel(since: number | null, nowMs: number): string {
  if (typeof since !== "number") return "duration unknown";
  const startMs = since < 1e12 ? since * 1000 : since;
  const elapsedMs = Math.max(0, nowMs - startMs);
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 5) return "just started";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function routeForAsk(ask: FleetAsk): Route {
  if (ask.conversationId) {
    return { view: "conversation", conversationId: ask.conversationId };
  }
  return { view: "agents", agentId: ask.agentId };
}

function routeForFlight(flight: Flight): Route {
  if (flight.collaborationRecordId) {
    return { view: "work", workId: flight.collaborationRecordId };
  }
  if (flight.conversationId) {
    return { view: "conversation", conversationId: flight.conversationId };
  }
  return { view: "agents", agentId: flight.agentId };
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

function FleetSectionHeader({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <>
      <div className="s-dashboard-panel-header">
        <div>
          <h3>{title}</h3>
        </div>
      </div>
      <p className="s-dashboard-panel-copy">{detail}</p>
    </>
  );
}

function AskRow({
  ask,
  navigate,
  section,
}: {
  ask: FleetAsk;
  navigate: (r: Route) => void;
  section: "active" | "finished";
}) {
  const nextRoute = routeForAsk(ask);
  const timingLabel = ask.completedAt
    ? `finished ${timeAgo(ask.completedAt)}`
    : ask.startedAt
      ? `started ${timeAgo(ask.startedAt)}`
      : `updated ${timeAgo(ask.updatedAt)}`;

  return (
    <div
      className={`s-work-row s-work-row-clickable s-dashboard-fleet-row s-dashboard-fleet-row-${section}`}
      data-status={ask.status}
      onClick={() => navigate(nextRoute)}
    >
      <div className="s-work-row-header">
        <div className="s-fleet-row-title-wrap">
          <div className="s-avatar s-avatar-sm" style={{ background: actorColor(ask.agentName ?? ask.agentId) }}>
            {(ask.agentName ?? ask.agentId)[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="s-fleet-row-title-copy">
            <div className="s-work-row-title-wrap">
              <span className="s-work-row-title">{ask.agentName ?? ask.agentId}</span>
              {ask.harness && <span className="s-badge">{ask.harness}</span>}
            </div>
            <div className="s-work-row-meta" style={{ marginTop: 2 }}>
              <span className="s-dot" style={{ background: stateColor(ask.agentState) }} />
              <span>{agentStateLabel(ask.agentState)}</span>
              <span>{timingLabel}</span>
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
      className={`s-work-row s-dashboard-fleet-row s-dashboard-fleet-attention-row${nextRoute ? " s-work-row-clickable" : ""}`}
      onClick={nextRoute ? () => navigate(nextRoute) : undefined}
    >
      <div className="s-work-row-header">
        <div className="s-work-row-title-wrap">
          <span className="s-work-row-title">{item.title}</span>
        </div>
      </div>
      <div className="s-work-row-meta">
        {item.kind === "work_item" && <span>work item</span>}
        {item.agentName && <span>{item.agentName}</span>}
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

function FlightRow({
  flight,
  navigate,
  nowMs,
  description,
}: {
  flight: Flight;
  navigate: (r: Route) => void;
  nowMs: number;
  description: string;
}) {
  const nextRoute = routeForFlight(flight);
  const agentLabel = flight.agentName ?? flight.agentId;
  const stateLabel = flightStateLabel(flight.state);
  const elapsed = elapsedLabel(flight.startedAt, nowMs);
  const runningLabel = typeof flight.startedAt === "number" && elapsed !== "just started"
    ? `in flight for ${elapsed}`
    : elapsed;

  return (
    <div
      className="s-work-row s-work-row-clickable s-dashboard-fleet-row s-dashboard-flight-row"
      data-status={flight.state}
      onClick={() => navigate(nextRoute)}
    >
      <div className="s-work-row-header">
        <div className="s-fleet-row-title-wrap">
          <div className="s-avatar s-avatar-sm" style={{ background: actorColor(agentLabel) }}>
            {agentLabel[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="s-fleet-row-title-copy">
            <div className="s-work-row-title-wrap">
              <span className="s-work-row-title">{agentLabel}</span>
            </div>
            <div className="s-work-row-meta" style={{ marginTop: 2 }}>
              <span>{runningLabel}</span>
              {flight.conversationId && <span>conversation linked</span>}
              {flight.collaborationRecordId && <span>work linked</span>}
            </div>
          </div>
        </div>
        <span className={`s-pill s-pill-${flightVariant(flight.state)}`}>{stateLabel}</span>
      </div>
      <p className="s-work-row-summary">
        {renderWithMentions(description)}
      </p>
    </div>
  );
}

function FleetActivityRow({
  item,
  navigate,
}: {
  item: FleetActivity;
  navigate: (r: Route) => void;
}) {
  const nextRoute = routeForActivity(item);

  return (
    <div
      className={`s-dashboard-activity-row${nextRoute ? " s-dashboard-activity-row-clickable" : ""}`}
      onClick={nextRoute ? () => navigate(nextRoute) : undefined}
    >
      <div
        className="s-avatar s-avatar-sm"
        style={{ background: actorColor(item.actorName ?? item.agentId ?? "system") }}
      >
        {(item.actorName ?? item.agentId ?? "S")[0]?.toUpperCase() ?? "S"}
      </div>
      <div className="s-dashboard-activity-body">
        <div className="s-dashboard-activity-header">
          <span className="s-dashboard-activity-actor">{item.actorName ?? "system"}</span>
          <span className="s-dashboard-activity-kind">{kindLabel(item.kind)}</span>
          <span className="s-time">{timeAgo(item.ts)}</span>
        </div>
        {(item.title || item.summary) && (
          <p className="s-dashboard-activity-summary">
            {renderWithMentions(item.title ?? item.summary ?? "")}
          </p>
        )}
        {item.title && item.summary && (
          <p className="s-dashboard-activity-note">{renderWithMentions(item.summary)}</p>
        )}
      </div>
    </div>
  );
}

export function FleetScreen({ navigate }: { navigate: (r: Route) => void }) {
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [activeFlights, setActiveFlights] = useState<Flight[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [fleetResult, flightsResult] = await Promise.allSettled([
      api<FleetState>("/api/fleet"),
      api<Flight[]>("/api/flights"),
    ]);

    if (fleetResult.status === "fulfilled") {
      setFleet(fleetResult.value);
    } else {
      setFleet(null);
    }

    if (flightsResult.status === "fulfilled") {
      setActiveFlights(flightsResult.value);
    } else {
      setActiveFlights([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const activeAsks = fleet?.activeAsks ?? [];
  const recentCompleted = fleet?.recentCompleted ?? [];
  const needsAttention = fleet?.needsAttention ?? [];
  const activity = fleet?.activity ?? [];
  const activeAskByInvocation = new Map(activeAsks.map((ask) => [ask.invocationId, ask]));
  const queueMessage = needsAttention.length > 0
    ? `${needsAttention.length} item${needsAttention.length === 1 ? " is" : "s are"} waiting on you. Clear ${needsAttention.length === 1 ? "it" : "those"} first, then monitor the rest of the queue.`
    : activeFlights.length > 0
      ? `${activeFlights.length} flight${activeFlights.length === 1 ? " is" : "s are"} active across the fleet. The queue is clear of interruptions.`
      : activeAsks.length > 0
        ? `${activeAsks.length} ask${activeAsks.length === 1 ? " is" : "s are"} currently in flight. The queue is clear of interruptions.`
        : recentCompleted.length > 0
          ? "Nothing is actively running right now. Recent finishes are ready for review."
          : "No asks have moved through the fleet yet. Start work and this becomes the operations board.";

  return (
    <div className="s-home s-dashboard-screen s-dashboard-fleet">
      <div className="s-dashboard-hero s-dashboard-hero-fleet">
        <div className="s-dashboard-hero-copy">
          <div className="s-dashboard-hero-head">
            <h2>Fleet</h2>
            {fleet && <span className="s-time">Updated {timeAgo(fleet.generatedAt)}</span>}
          </div>
          <p>{queueMessage}</p>
          <div className="s-dashboard-summary-grid">
            <div className={`s-dashboard-summary-card${(fleet?.totals.needsAttention ?? 0) > 0 ? " s-dashboard-summary-card-attention" : ""}`}>
              <div className="s-dashboard-summary-label">Needs input</div>
              <div className="s-dashboard-summary-value">{fleet?.totals.needsAttention ?? 0}</div>
              <div className="s-dashboard-summary-meta">Questions, reviews, or decisions waiting on you</div>
            </div>
            <div className="s-dashboard-summary-card">
              <div className="s-dashboard-summary-label">Active flights</div>
              <div className="s-dashboard-summary-value">{activeFlights.length}</div>
              <div className="s-dashboard-summary-meta">Tasks currently running or queued on agents</div>
            </div>
            <div className={`s-dashboard-summary-card${(fleet?.totals.recentCompleted ?? 0) > 0 ? " s-dashboard-summary-card-finished" : ""}`}>
              <div className="s-dashboard-summary-label">Finished</div>
              <div className="s-dashboard-summary-value">{fleet?.totals.recentCompleted ?? 0}</div>
              <div className="s-dashboard-summary-meta">Recent completions and failures to review</div>
            </div>
            <div className="s-dashboard-summary-card">
              <div className="s-dashboard-summary-label">Activity</div>
              <div className="s-dashboard-summary-value">{fleet?.totals.activity ?? 0}</div>
              <div className="s-dashboard-summary-meta">Recent events across the fleet</div>
            </div>
          </div>
        </div>
      </div>

      <div className="s-dashboard-fleet-stack">
        <section className={`s-dashboard-panel${needsAttention.length > 0 ? " s-dashboard-panel-attention" : ""}`}>
          <FleetSectionHeader
            title="Needs your input"
            detail="Handle interruptions, pending answers, and review requests first."
          />
          {needsAttention.length === 0 ? (
            <div className="s-empty">
              <p>Nothing is waiting on you</p>
              <p>When agents ask a question or a work item needs review, it will land here first.</p>
            </div>
          ) : (
            <div className="s-work-list">
              {needsAttention.map((item) => (
                <AttentionRow key={item.recordId} item={item} navigate={navigate} />
              ))}
            </div>
          )}
        </section>

        <section className="s-dashboard-panel s-dashboard-panel-flights">
          <FleetSectionHeader
            title="In-flight agents"
            detail="Agents with active flights right now, including how long each task has been in flight."
          />
          {activeFlights.length === 0 ? (
            <div className="s-empty">
              <p>No agents in flight</p>
              <p>Active flights will appear here as soon as an agent starts, queues, or waits on a task.</p>
            </div>
          ) : (
            <div className="s-work-list">
              {activeFlights.map((flight) => (
                <FlightRow
                  key={flight.id}
                  flight={flight}
                  navigate={navigate}
                  nowMs={nowMs}
                  description={flightDescription(flight, activeAskByInvocation.get(flight.invocationId))}
                />
              ))}
            </div>
          )}
        </section>

        <div className="s-dashboard-fleet-columns">
          <section className="s-dashboard-panel s-dashboard-panel-active">
            <FleetSectionHeader
              title="Active asks"
              detail="The asks still in flight across the fleet."
            />
            {activeAsks.length === 0 ? (
              <div className="s-empty">
                <p>No active asks</p>
                <p>New agent work will appear here while it is still in progress.</p>
              </div>
            ) : (
              <div className="s-work-list">
                {activeAsks.map((ask) => (
                  <AskRow key={ask.invocationId} ask={ask} navigate={navigate} section="active" />
                ))}
              </div>
            )}
          </section>

          <section className="s-dashboard-panel s-dashboard-panel-finished">
            <FleetSectionHeader
              title="Recent finishes"
              detail="Review completions and failures once the active queue is stable."
            />
            {recentCompleted.length === 0 ? (
              <div className="s-empty">
                <p>No recent finishes</p>
                <p>Completed asks and failures will show up here once they settle.</p>
              </div>
            ) : (
              <div className="s-work-list">
                {recentCompleted.map((ask) => (
                  <AskRow key={ask.invocationId} ask={ask} navigate={navigate} section="finished" />
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="s-dashboard-panel s-dashboard-panel-activity">
          <FleetSectionHeader
            title="Recent activity"
            detail="The broader event stream behind the queue."
          />
          {activity.length === 0 ? (
            <div className="s-empty">
              <p>No recent fleet activity</p>
              <p>Messages, asks, and other agent activity will stream here.</p>
            </div>
          ) : (
            <div className="s-dashboard-activity-feed">
              {activity.slice(0, 20).map((item) => (
                <FleetActivityRow key={item.id} item={item} navigate={navigate} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
