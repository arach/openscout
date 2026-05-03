import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { fullTimestamp, timeAgo } from "../lib/time.ts";
import type { BrokerDiagnostics, BrokerDialogueItem, BrokerRouteAttempt, Route } from "../lib/types.ts";
import { useScout } from "../scout/Provider.tsx";
import "./system-surfaces-redesign.css";

type BrokerTab = "attempts" | "dialogue" | "failed_queries" | "failed_deliveries";

const TAB_LABELS: Record<BrokerTab, string> = {
  attempts: "Dispatch",
  dialogue: "Dialogue",
  failed_queries: "Failed queries",
  failed_deliveries: "Failed deliveries",
};

function shortId(value: string | null): string {
  if (!value) return "none";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-5)}`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function attemptTone(kind: BrokerRouteAttempt["kind"], status: string): "success" | "failed" | "working" | "neutral" {
  if (kind === "success" || status === "sent" || status === "acknowledged" || status === "completed") return "success";
  if (kind === "failed_query" || kind === "failed_delivery" || status === "failed" || status === "cancelled") return "failed";
  if (status === "running" || status === "accepted" || status === "deferred" || status === "pending") return "working";
  return "neutral";
}

function attemptKindLabel(kind: BrokerRouteAttempt["kind"]): string {
  switch (kind) {
    case "success":
      return "sent";
    case "failed_query":
      return "query";
    case "failed_delivery":
      return "delivery";
    default:
      return "attempt";
  }
}

export function BrokerScreen({ navigate }: { navigate: (r: Route) => void }) {
  const { selectedBrokerAttempt, inspectBrokerAttempt } = useScout();
  const [broker, setBroker] = useState<BrokerDiagnostics | null>(null);
  const [activeTab, setActiveTab] = useState<BrokerTab>("attempts");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const brokerRef = useRef<BrokerDiagnostics | null>(null);
  const requestIdRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (mode: "initial" | "background" | "manual" = "initial") => {
    const requestId = ++requestIdRef.current;
    if (!brokerRef.current && mode !== "background") {
      setLoading(true);
      setError(null);
    } else {
      setRefreshing(true);
    }

    try {
      const next = await api<BrokerDiagnostics>("/api/broker?limit=160");
      if (requestId !== requestIdRef.current) return;
      brokerRef.current = next;
      setBroker(next);
      setError(null);
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
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [load]);

  useBrokerEvents((event) => {
    if (
      event.kind === "message.posted" ||
      event.kind === "delivery.planned" ||
      event.kind === "delivery.attempted" ||
      event.kind === "delivery.state.changed" ||
      event.kind === "scout.dispatched"
    ) {
      scheduleRefresh();
    }
  });

  const activeRows = useMemo(() => {
    if (!broker) return [];
    switch (activeTab) {
      case "failed_queries":
        return broker.failedQueries;
      case "failed_deliveries":
        return broker.failedDeliveries;
      case "dialogue":
        return broker.dialogue;
      default:
        return broker.attempts;
    }
  }, [activeTab, broker]);

  const selectedAttempt = useMemo(() => {
    if (!broker || !selectedBrokerAttempt) return null;
    return broker.attempts.find((attempt) => attempt.id === selectedBrokerAttempt.id)
      ?? broker.failedQueries.find((attempt) => attempt.id === selectedBrokerAttempt.id)
      ?? broker.failedDeliveries.find((attempt) => attempt.id === selectedBrokerAttempt.id)
      ?? null;
  }, [broker, selectedBrokerAttempt]);

  useEffect(() => {
    if (selectedAttempt && selectedAttempt !== selectedBrokerAttempt) {
      inspectBrokerAttempt(selectedAttempt);
    }
  }, [inspectBrokerAttempt, selectedAttempt, selectedBrokerAttempt]);

  const metrics = broker ? [
    {
      label: "Dispatch",
      value: String(broker.totals.successfulDispatches),
      detail: `${broker.rates.messagesPerHour}/hour chatter`,
    },
    {
      label: "Failed queries",
      value: String(broker.totals.failedQueries),
      detail: `${broker.rates.failedQueriesPerHour}/hour`,
    },
    {
      label: "Failed deliveries",
      value: String(broker.totals.failedDeliveries + broker.totals.failedDeliveryAttempts),
      detail: `${broker.rates.failedDeliveriesPerHour}/hour`,
    },
    {
      label: "Failure rate",
      value: percent(broker.rates.failureRate),
      detail: `${broker.totals.deliveryAttempts} delivery attempts`,
    },
  ] : [];

  return (
    <div className="sys-surface-page sys-surface-page-wide">
      <div className="sys-page-head">
        <div className="sys-page-title-group">
          <h2 className="sys-page-title">Broker</h2>
          <p className="sys-page-subtitle">
            Dispatch success, failed queries, delivery failures, and broker dialogue.
          </p>
        </div>
        <div className="sys-page-actions">
          <div className="sys-sync-note">
            {loading
              ? "Loading broker ledger..."
              : broker
                ? `Updated ${timeAgo(broker.generatedAt)}`
                : "Waiting for broker data"}
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

      {broker && (
        <div className="sys-stat-grid">
          {metrics.map((metric) => (
            <div key={metric.label} className="sys-stat-card">
              <span className="sys-stat-label">{metric.label}</span>
              <strong className="sys-stat-value">{metric.value}</strong>
              <span className="sys-stat-detail">{metric.detail}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="sys-banner sys-banner-warning">
          <strong>Refresh failed.</strong>
          <span>{error}</span>
        </div>
      )}

      {loading && !broker && (
        <div className="sys-panel sys-state-card">
          <h3 className="sys-state-title">Loading broker</h3>
          <p className="sys-state-body">Reading the broker database snapshot.</p>
        </div>
      )}

      {!loading && !broker && !error && (
        <div className="sys-panel sys-state-card">
          <h3 className="sys-state-title">No broker data</h3>
          <p className="sys-state-body">No broker records are available yet.</p>
        </div>
      )}

      {broker && (
        <>
          <div className="sys-tab-row" role="tablist" aria-label="Broker diagnostics">
            {(Object.keys(TAB_LABELS) as BrokerTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                className={`sys-tab${activeTab === tab ? " sys-tab-active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          {activeTab === "dialogue" ? (
            <BrokerDialogueList
              items={activeRows as BrokerDialogueItem[]}
              navigate={navigate}
            />
          ) : (
            <BrokerAttemptList
              attempts={activeRows as BrokerRouteAttempt[]}
              navigate={navigate}
              selectedAttemptId={selectedBrokerAttempt?.id ?? null}
              onInspect={inspectBrokerAttempt}
            />
          )}
        </>
      )}
    </div>
  );
}

function BrokerAttemptList({
  attempts,
  navigate,
  selectedAttemptId,
  onInspect,
}: {
  attempts: BrokerRouteAttempt[];
  navigate: (r: Route) => void;
  selectedAttemptId: string | null;
  onInspect: (attempt: BrokerRouteAttempt) => void;
}) {
  if (attempts.length === 0) {
    return (
      <div className="sys-panel sys-state-card">
        <h3 className="sys-state-title">No records</h3>
        <p className="sys-state-body">This broker slice is empty for the selected window.</p>
      </div>
    );
  }

  return (
    <div className="sys-audit-list">
      {attempts.map((attempt) => {
        const tone = attemptTone(attempt.kind, attempt.status);
        const inspect = () => {
          onInspect(attempt);
          window.dispatchEvent(new CustomEvent("scout:set-inspector-width", {
            detail: { width: 420 },
          }));
        };
        return (
          <article
            key={attempt.id}
            className={`sys-broker-row${selectedAttemptId === attempt.id ? " sys-broker-row-selected" : ""}`}
            tabIndex={0}
            aria-label={`Inspect ${attempt.detail}`}
            onClick={inspect}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                inspect();
              }
            }}
          >
            <div className="sys-broker-row-main">
              <div className="sys-broker-row-head">
                <span className={`sys-chip sys-chip-${tone}`}>{attemptKindLabel(attempt.kind)}</span>
                <span className="sys-broker-status">{attempt.status}</span>
                <span className="sys-broker-time">{timeAgo(attempt.ts)}</span>
              </div>
              <h3 className="sys-broker-title">{attempt.detail}</h3>
              <div className="sys-broker-meta">
                <span>from {attempt.actorName ?? "unknown"}</span>
                <span>to {attempt.target ?? "none"}</span>
                <span>route {attempt.route ?? "none"}</span>
              </div>
            </div>
            <div className="sys-broker-row-side">
              <code>{shortId(attempt.messageId ?? attempt.deliveryId ?? attempt.invocationId ?? attempt.id)}</code>
              {attempt.conversationId && (
                <button
                  type="button"
                  className="s-btn s-btn-sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate({ view: "conversation", conversationId: attempt.conversationId! });
                  }}
                >
                  Open thread
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function brokerInspectorRows(attempt: BrokerRouteAttempt): Array<{ label: string; value: string | null }> {
  return [
    { label: "Status", value: attempt.status },
    { label: "Kind", value: attemptKindLabel(attempt.kind) },
    { label: "Time", value: fullTimestamp(attempt.ts) },
    { label: "Actor", value: attempt.actorName },
    { label: "Target", value: attempt.target },
    { label: "Route", value: attempt.route },
    { label: "Conversation", value: attempt.conversationId },
    { label: "Message", value: attempt.messageId },
    { label: "Delivery", value: attempt.deliveryId },
    { label: "Invocation", value: attempt.invocationId },
  ].filter((row) => row.value);
}

function metadataJson(value: Record<string, unknown> | null | undefined): string {
  if (!value || Object.keys(value).length === 0) {
    return "{}";
  }
  return JSON.stringify(value, null, 2);
}

export function BrokerAttemptInspector({
  attempt,
  navigate,
  onClose,
}: {
  attempt: BrokerRouteAttempt;
  navigate: (r: Route) => void;
  onClose: () => void;
}) {
  const rows = brokerInspectorRows(attempt);
  return (
    <aside className="sys-panel sys-broker-inspector" aria-label="Broker route inspector">
      <div className="sys-broker-inspector-head">
        <div>
          <div className="sys-kicker">Inspector</div>
          <h3 className="sys-state-title">{attempt.detail}</h3>
        </div>
        <div className="sys-inline-actions">
          {attempt.conversationId && (
            <button
              type="button"
              className="s-btn s-btn-sm"
              onClick={() => navigate({ view: "conversation", conversationId: attempt.conversationId! })}
            >
              Open thread
            </button>
          )}
          <button type="button" className="s-btn s-btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div className="sys-detail-grid sys-broker-inspector-grid">
        {rows.map((row) => (
          <div key={row.label} className="sys-detail-card">
            <span className="sys-detail-label">{row.label}</span>
            <code className="sys-detail-value">{row.value}</code>
          </div>
        ))}
      </div>
      <div className="sys-broker-metadata">
        <span className="sys-detail-label">Metadata</span>
        <pre>{metadataJson(attempt.metadata)}</pre>
      </div>
    </aside>
  );
}

function BrokerDialogueList({
  items,
  navigate,
}: {
  items: BrokerDialogueItem[];
  navigate: (r: Route) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="sys-panel sys-state-card">
        <h3 className="sys-state-title">No dialogue</h3>
        <p className="sys-state-body">No messages were recorded in the selected window.</p>
      </div>
    );
  }

  return (
    <div className="sys-audit-list">
      {items.map((item) => (
        <article key={item.id} className="sys-broker-row">
          <div className="sys-broker-row-main">
            <div className="sys-broker-row-head">
              <span className="sys-chip sys-chip-neutral">{item.class}</span>
              <span className="sys-broker-status">{item.actorName ?? "unknown"}</span>
              <span className="sys-broker-time">{fullTimestamp(item.ts)}</span>
            </div>
            <h3 className="sys-broker-title">{item.body}</h3>
            <div className="sys-broker-meta">
              <span>thread {shortId(item.conversationId)}</span>
            </div>
          </div>
          <div className="sys-broker-row-side">
            <code>{shortId(item.id)}</code>
            <button
              type="button"
              className="s-btn s-btn-sm"
              onClick={() => navigate({ view: "conversation", conversationId: item.conversationId })}
            >
              Open thread
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
