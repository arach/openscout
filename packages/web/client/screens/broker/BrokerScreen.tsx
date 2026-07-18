import { Bot, Check, Copy, ExternalLink, Hash, Megaphone, MessageCircle, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../../components/EmptyState.tsx";
import { StatusPill } from "../../components/StatusPill.tsx";
import { api } from "../../lib/api.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { brokerAttemptTone } from "../../lib/status-tone.ts";
import { fullTimestamp, timeAgo } from "../../lib/time.ts";
import type { BrokerDiagnostics, BrokerDialogueItem, BrokerHistoryKey, BrokerRouteAttempt, Route } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import { OpsSubnav } from "../ops/OpsSubnav.tsx";
import {
  brokerAttemptDetailLimit,
  brokerAttemptErrorSummary,
  brokerAttemptIsFailure,
  brokerAttemptContextText,
  brokerMetadataJson,
  clippedText,
} from "./broker-display.ts";
import { BrokerMetadataPanel } from "./BrokerMetadataPanel.tsx";
import { brokerDiagnosticsUrl } from "./broker-query.ts";
import { useBrokerLedgerKeyboard } from "./useBrokerLedgerKeyboard.ts";
import { defineSurface } from "../../surfaces/types.ts";
import "../system-surfaces-redesign.css";

type BrokerTab = "attempts" | "dialogue" | "failed_queries" | "failed_deliveries";

const BROKER_TABS: BrokerTab[] = ["attempts", "dialogue", "failed_queries", "failed_deliveries"];

const TAB_LABELS: Record<BrokerTab, string> = {
  attempts: "Dispatch",
  dialogue: "Dialogue",
  failed_queries: "Failed queries",
  failed_deliveries: "Failed deliveries",
};

const TAB_HISTORY_KEY: Record<BrokerTab, BrokerHistoryKey> = {
  attempts: "attempts",
  dialogue: "dialogue",
  failed_queries: "failedQueries",
  failed_deliveries: "failedDeliveries",
};

function shortId(value: string | null): string {
  if (!value) return "none";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-5)}`;
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

function mergeBrokerPage(
  current: BrokerDiagnostics,
  next: BrokerDiagnostics,
  key: BrokerHistoryKey,
): BrokerDiagnostics {
  return {
    ...next,
    attempts: key === "attempts" ? [...current.attempts, ...next.attempts] : current.attempts,
    failedQueries: key === "failedQueries" ? [...current.failedQueries, ...next.failedQueries] : current.failedQueries,
    failedDeliveries: key === "failedDeliveries" ? [...current.failedDeliveries, ...next.failedDeliveries] : current.failedDeliveries,
    dialogue: key === "dialogue" ? [...current.dialogue, ...next.dialogue] : current.dialogue,
    ledger: {
      ...next.ledger,
      cursors: {
        ...current.ledger.cursors,
        [key]: next.ledger.cursors[key],
      },
      hasMore: {
        ...current.ledger.hasMore,
        [key]: next.ledger.hasMore[key],
      },
    },
  };
}

export function BrokerScreen({
  navigate,
  embedded = false,
}: {
  navigate: (r: Route) => void;
  embedded?: boolean;
}) {
  const { selectedBrokerAttempt, inspectBrokerAttempt, clearBrokerAttempt } = useScout();
  const [broker, setBroker] = useState<BrokerDiagnostics | null>(null);
  const [activeTab, setActiveTab] = useState<BrokerTab>("attempts");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
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
      const next = await api<BrokerDiagnostics>(brokerDiagnosticsUrl());
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

  const loadOlder = useCallback(async () => {
    const current = brokerRef.current;
    if (!current || loadingOlder) return;
    const key = TAB_HISTORY_KEY[activeTab];
    const cursor = current.ledger.cursors[key];
    if (!cursor || !current.ledger.hasMore[key]) return;

    const requestId = ++requestIdRef.current;
    setLoadingOlder(true);
    setError(null);

    try {
      const next = await api<BrokerDiagnostics>(brokerDiagnosticsUrl(cursor));
      if (requestId !== requestIdRef.current) return;
      const latest = brokerRef.current;
      const merged = latest ? mergeBrokerPage(latest, next, key) : next;
      brokerRef.current = merged;
      setBroker(merged);
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoadingOlder(false);
      }
    }
  }, [activeTab, loadingOlder]);

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
  const activeHistoryKey = TAB_HISTORY_KEY[activeTab];
  const activeHasMore = broker?.ledger.hasMore[activeHistoryKey] ?? false;

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

  const activateLedgerRow = useCallback((index: number) => {
    const row = activeRows[index];
    if (!row) return;
    if (activeTab === "dialogue") {
      const item = row as BrokerDialogueItem;
      openContent(navigate, { view: "conversation", conversationId: item.conversationId }, { returnTo: { view: "broker" } });
      return;
    }
    const attempt = row as BrokerRouteAttempt;
    inspectBrokerAttempt(attempt);
    window.dispatchEvent(new CustomEvent("scout:set-inspector-width", {
      detail: { width: 420 },
    }));
  }, [activeRows, activeTab, inspectBrokerAttempt, navigate]);

  const { getRowFocusProps, setFocusedIndex } = useBrokerLedgerKeyboard({
    enabled: Boolean(broker) && activeRows.length > 0,
    rowCount: activeRows.length,
    onActivateRow: activateLedgerRow,
    onClearSelection: clearBrokerAttempt,
  });

  useEffect(() => {
    if (!selectedBrokerAttempt || activeTab === "dialogue") return;
    const index = (activeRows as BrokerRouteAttempt[]).findIndex((row) => row.id === selectedBrokerAttempt.id);
    if (index >= 0) setFocusedIndex(index);
  }, [activeRows, activeTab, selectedBrokerAttempt, setFocusedIndex]);

  const cycleBrokerTab = useCallback((delta: number) => {
    const current = BROKER_TABS.indexOf(activeTab);
    const next = (current + delta + BROKER_TABS.length) % BROKER_TABS.length;
    setActiveTab(BROKER_TABS[next]!);
  }, [activeTab]);

  return (
    <div className={`s-ops${embedded ? " s-ops--embedded" : ""}`}>
      {!embedded && (
        <div className="s-ops-header">
          <OpsSubnav activeRoute={{ view: "broker" }} navigate={navigate} />
        </div>
      )}

      <div className="s-ops-body">
        <div className="sys-surface-page sys-surface-page-wide sys-surface-page-fluid sys-broker-page">
          <div className="sys-ledger-toolbar" aria-label="Dispatch controls">
            {broker ? (
              <div
                className="sys-tab-row sys-tab-row--toolbar"
                role="tablist"
                aria-label="Dispatch diagnostics"
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    cycleBrokerTab(1);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    cycleBrokerTab(-1);
                  }
                }}
              >
                {BROKER_TABS.map((tab) => (
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
              body="No dispatch rows are available yet."
            />
          )}

          {broker && (
            <>
              {activeTab === "dialogue" ? (
                <BrokerDialogueList
                  items={activeRows as BrokerDialogueItem[]}
                  navigate={navigate}
                  getRowFocusProps={getRowFocusProps}
                />
              ) : (
                <BrokerAttemptList
                  attempts={activeRows as BrokerRouteAttempt[]}
                  navigate={navigate}
                  selectedAttemptId={selectedBrokerAttempt?.id ?? null}
                  onInspect={inspectBrokerAttempt}
                  getRowFocusProps={getRowFocusProps}
                />
              )}
              {activeRows.length > 0 && activeHasMore && (
                <div className="sys-ledger-footer">
                  <button
                    type="button"
                    className="s-btn"
                    disabled={loadingOlder}
                    onClick={() => void loadOlder()}
                  >
                    {loadingOlder ? "Loading older..." : "Load older"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type BrokerRowFocusProps = ReturnType<typeof useBrokerLedgerKeyboard>["getRowFocusProps"];

function BrokerAttemptList({
  attempts,
  navigate,
  selectedAttemptId,
  onInspect,
  getRowFocusProps,
}: {
  attempts: BrokerRouteAttempt[];
  navigate: (r: Route) => void;
  selectedAttemptId: string | null;
  onInspect: (attempt: BrokerRouteAttempt) => void;
  getRowFocusProps: BrokerRowFocusProps;
}) {
  const { route } = useScout();
  if (attempts.length === 0) {
    return (
      <EmptyState
        title="No dispatch rows"
        body="No dispatch rows are available yet."
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
        {attempts.map((attempt, index) => {
          const tone = brokerAttemptTone(attempt.kind, attempt.status);
          const kindLabel = attemptKindLabel(attempt.kind);
          const isFailure = brokerAttemptIsFailure(attempt);
          const errorSummary = brokerAttemptErrorSummary(attempt);
          const detailSnippet = clippedText(attempt.detail, brokerAttemptDetailLimit(attempt));
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
              className={`sys-broker-row sys-broker-row--ledger${isFailure ? " sys-broker-row--failure" : ""}${selectedAttemptId === attempt.id ? " sys-broker-row-selected" : ""}`}
              aria-label={`Inspect ${attempt.detail}`}
              onClick={inspect}
              {...getRowFocusProps(index)}
            >
              <div className="sys-broker-cell sys-broker-cell-state" role="cell">
                <StatusPill tone={tone}>{kindLabel}</StatusPill>
                {(isFailure || attempt.status !== kindLabel) && (
                  <span className={`sys-broker-status${isFailure ? " sys-broker-status--error" : ""}`}>
                    {attempt.status}
                  </span>
                )}
              </div>
              <div className="sys-broker-cell sys-broker-cell-time" role="cell">
                <span title={fullTimestamp(attempt.ts)}>{timeAgo(attempt.ts)}</span>
              </div>
              <div className="sys-broker-cell sys-broker-cell-detail" role="cell">
                <h3 className="sys-broker-title" title={attempt.detail}>{detailSnippet}</h3>
                {errorSummary && (
                  <p className="sys-broker-error-detail" title={errorSummary}>{errorSummary}</p>
                )}
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

function brokerInspectorRows(attempt: BrokerRouteAttempt): Array<{ label: string; value: string }> {
  const reference = brokerAttemptReference(attempt);
  return [
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
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));
}

function CopyIconButton({ value, subject, className }: { value: string; subject: string; className?: string }) {
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

  const copyValue = useCallback(async () => {
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
      className={`sys-copy-btn${className ? ` ${className}` : ""}${copied ? " sys-copy-btn--copied" : ""}${failed ? " sys-copy-btn--failed" : ""}`}
      onClick={() => void copyValue()}
      title={copied ? `Copied ${subject}` : failed ? "Copy failed" : `Copy ${subject}`}
      aria-label={copied ? `Copied ${subject}` : failed ? `Copy ${subject} failed` : `Copy ${subject}`}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}

type DispatchReviewResponse = {
  ok: true;
  conversationId: string | null;
  messageId: string | null;
  flightId: string | null;
  targetAgentId: string | null;
  targetLabel: string | null;
  dedupeFingerprint: string;
  rootCauseFingerprint: string;
};

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
  const metadata = brokerMetadataJson(attempt.metadata);
  const isFailure = brokerAttemptIsFailure(attempt);
  const errorSummary = brokerAttemptErrorSummary(attempt);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [reviewStatus, setReviewStatus] = useState<"idle" | "running" | "sent" | "failed">("idle");
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const contextText = useMemo(() => brokerAttemptContextText(attempt), [attempt]);

  useEffect(() => {
    setCopyStatus("idle");
    setReviewStatus("idle");
    setReviewMessage(null);
  }, [attempt.id]);

  const copyEverything = useCallback(async () => {
    const copied = await copyTextToClipboard(contextText);
    setCopyStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyStatus("idle"), 1500);
  }, [contextText]);

  const askScout = useCallback(() => {
    window.dispatchEvent(new CustomEvent("scout:scoutbot-compose", {
      detail: {
        body: `Look into this failed dispatch — what went wrong and how do I fix it?\n\n${contextText}`,
      },
    }));
  }, [contextText]);

  const invokeCodex = useCallback(async () => {
    setReviewStatus("running");
    setReviewMessage(null);
    try {
      const result = await api<DispatchReviewResponse>("/api/broker/dispatch-review", {
        method: "POST",
        body: JSON.stringify({ attemptId: attempt.id }),
      });
      setReviewStatus("sent");
      setReviewMessage(
        `Codex asked${result.flightId ? ` · ${result.flightId}` : ""}${result.targetLabel ? ` · ${result.targetLabel}` : ""}`,
      );
    } catch (error) {
      setReviewStatus("failed");
      setReviewMessage(error instanceof Error ? error.message : String(error));
    }
  }, [attempt]);

  return (
    <aside className="sys-panel sys-broker-inspector" aria-label="Dispatch route inspector">
      <header className="sys-broker-inspector-head">
        <div className="sys-broker-inspector-topline">
          <div className="sys-kicker">Inspector</div>
          <StatusPill tone={brokerAttemptTone(attempt.kind, attempt.status)}>{attempt.status}</StatusPill>
          <button
            type="button"
            className="sys-copy-btn sys-broker-inspector-close"
            onClick={onClose}
            title="Close inspector"
            aria-label="Close inspector"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <h3 className="sys-broker-inspector-title">{attempt.detail}</h3>
        {isFailure && errorSummary && (
          <div className="sys-broker-inspector-error" role="status">
            <span className="sys-broker-inspector-error-label">Error</span>
            <p>{errorSummary}</p>
          </div>
        )}
        {(isFailure || attempt.conversationId) && (
          <div className="sys-broker-inspector-actions">
            {isFailure && (
              <>
                <button
                  type="button"
                  className="s-btn s-btn-sm s-btn-primary"
                  onClick={askScout}
                  title="Send this failed dispatch to Scout in the chat below"
                >
                  <Sparkles size={12} aria-hidden="true" />
                  Send to Scout
                </button>
                <button
                  type="button"
                  className="s-btn s-btn-sm"
                  disabled={reviewStatus === "running"}
                  onClick={() => void invokeCodex()}
                  title="Send this failed dispatch to an OpenScout Codex agent for review"
                >
                  <Bot size={12} aria-hidden="true" />
                  {reviewStatus === "running" ? "Invoking..." : "Invoke Codex"}
                </button>
                <button
                  type="button"
                  className="s-btn s-btn-sm"
                  onClick={() => void copyEverything()}
                  title="Copy the full dispatch failure context"
                >
                  {copyStatus === "copied" ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                  {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : "Copy context"}
                </button>
              </>
            )}
            {attempt.conversationId && (
              <button
                type="button"
                className="s-btn s-btn-sm"
                onClick={() => openContent(navigate, { view: "conversation", conversationId: attempt.conversationId! }, { returnTo: route })}
              >
                <ExternalLink size={12} aria-hidden="true" />
                Open thread
              </button>
            )}
          </div>
        )}
      </header>
      {reviewMessage && (
        <div className={`sys-broker-review-status sys-broker-review-status--${reviewStatus}`} role="status">
          {reviewMessage}
        </div>
      )}
      <div className="sys-broker-inspector-rows">
        {rows.map((row) => (
          <div key={row.label} className="sys-broker-inspector-row">
            <span className="sys-detail-label">{row.label}</span>
            <code className="sys-detail-value">{row.value}</code>
            <CopyIconButton value={row.value} subject={row.label.toLowerCase()} />
          </div>
        ))}
      </div>
      <div className="sys-broker-metadata">
        <div className="sys-broker-metadata-head">
          <span className="sys-detail-label">Metadata</span>
          <CopyIconButton value={metadata} subject="metadata" className="sys-broker-metadata-copy" />
        </div>
        <BrokerMetadataPanel metadata={attempt.metadata} rawJson={metadata} />
      </div>
    </aside>
  );
}

function BrokerDialogueList({
  items,
  navigate,
  getRowFocusProps,
}: {
  items: BrokerDialogueItem[];
  navigate: (r: Route) => void;
  getRowFocusProps: BrokerRowFocusProps;
}) {
  const { route } = useScout();
  if (items.length === 0) {
    return (
      <EmptyState
        title="No dialogue"
        body="No dialogue messages are available in broker history."
      />
    );
  }

  return (
    <div className="sys-audit-list">
      {items.map((item, index) => (
        <article
          key={item.id}
          className="sys-broker-row"
          role="button"
          aria-label={`Open dialogue thread for ${item.actorName ?? "unknown"}`}
          onClick={() => openContent(navigate, { view: "conversation", conversationId: item.conversationId }, { returnTo: route })}
          {...getRowFocusProps(index)}
        >
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
              onClick={(event) => {
                event.stopPropagation();
                openContent(navigate, { view: "conversation", conversationId: item.conversationId }, { returnTo: route });
              }}
            >
              Open thread
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export const scoutSurface = defineSurface({
  id: "dispatch",
  label: "Dispatch",
  route: { view: "broker" },
  webPath: "/broker",
  screen: "BrokerScreen",
  embed: {
    path: "/embed/dispatch",
    profile: "macos.dispatch",
    rootClassName: "s-broker-embed",
    chrome: { showSecondaryNav: false, showPageStatusBar: false },
    hosts: { macos: true },
  },
});
