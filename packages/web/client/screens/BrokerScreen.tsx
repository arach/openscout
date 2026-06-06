import { Check, Copy, ExternalLink, Hash, Megaphone, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../components/EmptyState.tsx";
import { StatusPill } from "../components/StatusPill.tsx";
import { api } from "../lib/api.ts";
import { copyTextToClipboard } from "../lib/clipboard.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { brokerAttemptTone } from "../lib/status-tone.ts";
import { fullTimestamp, timeAgo } from "../lib/time.ts";
import type { BrokerDiagnostics, BrokerDialogueItem, BrokerRouteAttempt, Route } from "../lib/types.ts";
import { useScout } from "../scout/Provider.tsx";
import { openContent } from "../scout/slots/openContent.ts";
import { OpsSubnav } from "./OpsSubnav.tsx";
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

const BROKER_DETAIL_SNIPPET_CHARS = 92;

function clippedText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
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

function brokerAttemptReference(attempt: BrokerRouteAttempt): string {
  return attempt.messageId ?? attempt.deliveryId ?? attempt.invocationId ?? attempt.id;
}

function routeKindLabel(route: string | null): string {
  switch (route) {
    case "dm":
      return "Direct message";
    case "channel":
      return "Channel";
    case "broadcast":
      return "Broadcast";
    case null:
      return "No route";
    default:
      return route;
  }
}

function RouteGlyph({ route }: { route: string | null }) {
  const label = routeKindLabel(route);
  if (route === "dm") {
    return (
      <span className="sys-route-glyph sys-route-glyph-dm" title={label} aria-label={label}>
        <MessageCircle size={13} aria-hidden="true" />
      </span>
    );
  }
  if (route === "channel") {
    return (
      <span className="sys-route-glyph sys-route-glyph-channel" title={label} aria-label={label}>
        <Hash size={13} aria-hidden="true" />
      </span>
    );
  }
  if (route === "broadcast") {
    return (
      <span className="sys-route-glyph sys-route-glyph-broadcast" title={label} aria-label={label}>
        <Megaphone size={13} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="sys-route-glyph sys-route-glyph-none" title={label} aria-label={label}>
      {route ?? "none"}
    </span>
  );
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

  return (
    <div className="s-ops">
      <div className="s-ops-header">
        <OpsSubnav activeRoute={{ view: "broker" }} navigate={navigate} />
      </div>

      <div className="s-ops-body">
        <div className="sys-surface-page sys-surface-page-wide sys-surface-page-fluid sys-broker-page">
          <div className="sys-ledger-toolbar" aria-label="Dispatch controls">
            {broker ? (
              <div className="sys-tab-row sys-tab-row--toolbar" role="tablist" aria-label="Dispatch diagnostics">
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
            ) : (
              <div className="sys-ledger-kicker">Dispatch ledger</div>
            )}
            <div className="sys-page-actions sys-ledger-actions">
              <div className="sys-sync-note">
                {loading
                  ? "Loading dispatch ledger..."
                  : broker
                    ? `Updated ${timeAgo(broker.generatedAt)}`
                    : "Waiting for dispatch data"}
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

          {error && (
            <div className="sys-banner sys-banner-warning">
              <strong>Refresh failed.</strong>
              <span>{error}</span>
            </div>
          )}

          {loading && !broker && (
            <EmptyState
              title="Loading dispatch"
              body="Reading the dispatch database snapshot."
            />
          )}

          {!loading && !broker && !error && (
            <EmptyState
              title="No dispatch data"
              body="No dispatch records are available yet."
            />
          )}

          {broker && (
            <>
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
      </div>
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
  const { route } = useScout();
  if (attempts.length === 0) {
    return (
      <EmptyState
        title="No records"
        body="This dispatch slice is empty for the selected window."
      />
    );
  }

  return (
    <div className="sys-broker-table" role="table" aria-label="Dispatch ledger">
      <div className="sys-broker-table-head" role="row">
        <span role="columnheader">State</span>
        <span role="columnheader">Age</span>
        <span role="columnheader">Detail</span>
        <span role="columnheader">From</span>
        <span role="columnheader">To</span>
        <span role="columnheader">Route</span>
        <span role="columnheader">Action</span>
      </div>
      <div className="sys-broker-table-body" role="rowgroup">
        {attempts.map((attempt) => {
          const tone = brokerAttemptTone(attempt.kind, attempt.status);
          const kindLabel = attemptKindLabel(attempt.kind);
          const detailSnippet = clippedText(attempt.detail, BROKER_DETAIL_SNIPPET_CHARS);
          const inspect = () => {
            onInspect(attempt);
            window.dispatchEvent(new CustomEvent("scout:set-inspector-width", {
              detail: { width: 420 },
            }));
          };
          return (
            <article
              key={attempt.id}
              role="row"
              className={`sys-broker-row sys-broker-row--ledger${selectedAttemptId === attempt.id ? " sys-broker-row-selected" : ""}`}
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
              <div className="sys-broker-cell sys-broker-cell-state" role="cell">
                <StatusPill tone={tone}>{kindLabel}</StatusPill>
                {attempt.status !== kindLabel && (
                  <span className="sys-broker-status">{attempt.status}</span>
                )}
              </div>
              <div className="sys-broker-cell sys-broker-cell-time" role="cell">
                <span title={fullTimestamp(attempt.ts)}>{timeAgo(attempt.ts)}</span>
              </div>
              <div className="sys-broker-cell sys-broker-cell-detail" role="cell">
                <h3 className="sys-broker-title" title={attempt.detail}>{detailSnippet}</h3>
              </div>
              <div className="sys-broker-cell sys-broker-cell-party" role="cell">
                <span title={attempt.actorName ?? "unknown"}>{attempt.actorName ?? "unknown"}</span>
              </div>
              <div className="sys-broker-cell sys-broker-cell-party" role="cell">
                <span title={attempt.target ?? "none"}>{attempt.target ?? "none"}</span>
              </div>
              <div className="sys-broker-cell sys-broker-cell-route" role="cell">
                <RouteGlyph route={attempt.route} />
              </div>
              <div className="sys-broker-cell sys-broker-cell-action" role="cell">
                {attempt.conversationId && (
                  <button
                    type="button"
                    className="s-btn s-btn-sm sys-broker-thread-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openContent(navigate, { view: "conversation", conversationId: attempt.conversationId! }, { returnTo: route });
                    }}
                  >
                    <ExternalLink size={12} aria-hidden="true" />
                    Thread
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function brokerInspectorRows(attempt: BrokerRouteAttempt): Array<{ label: string; value: string | null }> {
  const reference = brokerAttemptReference(attempt);
  return [
    { label: "Status", value: attempt.status },
    { label: "Kind", value: attemptKindLabel(attempt.kind) },
    { label: "Time", value: fullTimestamp(attempt.ts) },
    { label: "Actor", value: attempt.actorName },
    { label: "Target", value: attempt.target },
    { label: "Route", value: attempt.route },
    { label: "Conversation", value: attempt.conversationId },
    { label: "Reference", value: reference },
    { label: "Message", value: attempt.messageId === reference ? null : attempt.messageId },
    { label: "Delivery", value: attempt.deliveryId === reference ? null : attempt.deliveryId },
    { label: "Invocation", value: attempt.invocationId === reference ? null : attempt.invocationId },
  ].filter((row) => row.value);
}

function metadataJson(value: Record<string, unknown> | null | undefined): string {
  if (!value || Object.keys(value).length === 0) {
    return "{}";
  }
  return JSON.stringify(value, null, 2);
}

function MetadataCopyButton({ value }: { value: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setStatus("idle");
  }, [value]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const copyMetadata = useCallback(async () => {
    const copied = await copyTextToClipboard(value);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setStatus(copied ? "copied" : "failed");
    resetTimerRef.current = setTimeout(() => {
      setStatus("idle");
      resetTimerRef.current = null;
    }, 1500);
  }, [value]);

  const copied = status === "copied";
  const failed = status === "failed";

  return (
    <button
      type="button"
      className={`sys-copy-btn sys-broker-metadata-copy${copied ? " sys-copy-btn--copied" : ""}${failed ? " sys-copy-btn--failed" : ""}`}
      onClick={() => void copyMetadata()}
      title={copied ? "Copied metadata" : failed ? "Copy failed" : "Copy metadata"}
      aria-label={copied ? "Copied metadata" : failed ? "Copy metadata failed" : "Copy metadata"}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
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
  const { route } = useScout();
  const rows = brokerInspectorRows(attempt);
  const metadata = metadataJson(attempt.metadata);
  return (
    <aside className="sys-panel sys-broker-inspector" aria-label="Dispatch route inspector">
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
              onClick={() => openContent(navigate, { view: "conversation", conversationId: attempt.conversationId! }, { returnTo: route })}
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
        <div className="sys-broker-metadata-head">
          <span className="sys-detail-label">Metadata</span>
          <MetadataCopyButton value={metadata} />
        </div>
        <pre>{metadata}</pre>
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
  const { route } = useScout();
  if (items.length === 0) {
    return (
      <EmptyState
        title="No dialogue"
        body="No messages were recorded in the selected window."
      />
    );
  }

  return (
    <div className="sys-audit-list">
      {items.map((item) => (
        <article key={item.id} className="sys-broker-row">
          <div className="sys-broker-row-main">
            <div className="sys-broker-row-head">
              <StatusPill tone="neutral">{item.class}</StatusPill>
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
              onClick={() => openContent(navigate, { view: "conversation", conversationId: item.conversationId }, { returnTo: route })}
            >
              Open thread
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
