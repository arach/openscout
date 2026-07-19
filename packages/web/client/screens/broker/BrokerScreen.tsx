import { ArrowRight, Bot, Check, CheckCircle2, Copy, ExternalLink, LoaderCircle, Sparkles, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../../components/EmptyState.tsx";
import { StatusPill } from "../../components/StatusPill.tsx";
import { api } from "../../lib/api.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { brokerAttemptTone } from "../../lib/status-tone.ts";
import { fullTimestamp, normalizeTimestampMs, timeAgo } from "../../lib/time.ts";
import type { BrokerDiagnostics, BrokerHistoryKey, BrokerRouteAttempt, Route } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import { OpsSubnav } from "../ops/OpsSubnav.tsx";
import {
  brokerAttemptDetailLimit,
  brokerAttemptErrorSummary,
  brokerAttemptIsFailure,
  brokerAttemptContextText,
  brokerScoutbotTriageRequest,
  brokerMessageFeedRows,
  brokerMetadataJson,
  clippedText,
} from "./broker-display.ts";
import { BrokerMetadataPanel } from "./BrokerMetadataPanel.tsx";
import { brokerDiagnosticsUrl } from "./broker-query.ts";
import { useBrokerLedgerKeyboard } from "./useBrokerLedgerKeyboard.ts";
import { defineSurface } from "../../surfaces/types.ts";
import "../system-surfaces-redesign.css";

type BrokerTab = "all" | "successful" | "failed";

const BROKER_TABS: BrokerTab[] = ["all", "successful", "failed"];

const TAB_LABELS: Record<BrokerTab, string> = {
  all: "All",
  successful: "Successful",
  failed: "Failed",
};

function attemptKindLabel(kind: BrokerRouteAttempt["kind"]): string {
  switch (kind) {
    case "success":
      return "Success";
    case "failed_query":
      return "Query failure";
    case "failed_delivery":
      return "Delivery failure";
    default:
      return "Delivery attempt";
  }
}

function attemptOutcomeLabel(attempt: BrokerRouteAttempt): string {
  if (attempt.kind === "success") return attempt.status || "sent";
  if (attempt.kind === "failed_delivery" && attempt.status === "cancelled") return "cancelled";
  if (brokerAttemptIsFailure(attempt)) return "failed";
  return attempt.status || "unknown";
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

function dispatchDayKey(ts: number): string {
  const timestamp = normalizeTimestampMs(ts) ?? 0;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dispatchDayLabel(ts: number, nowMs = Date.now()): string {
  const timestamp = normalizeTimestampMs(ts) ?? 0;
  const date = new Date(timestamp);
  const today = new Date(nowMs);
  const yesterday = new Date(nowMs);
  yesterday.setDate(yesterday.getDate() - 1);

  if (dispatchDayKey(ts) === dispatchDayKey(today.getTime())) return "Today";
  if (dispatchDayKey(ts) === dispatchDayKey(yesterday.getTime())) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function mergeBrokerPage(
  current: BrokerDiagnostics,
  next: BrokerDiagnostics,
  key: BrokerHistoryKey,
): BrokerDiagnostics {
  return {
    ...next,
    source: current.source,
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
  const [activeTab, setActiveTab] = useState<BrokerTab>("all");
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
    const key: BrokerHistoryKey = "attempts";
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
  }, [loadingOlder]);

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

  const feedRows = useMemo(() => {
    if (!broker) return [];
    return brokerMessageFeedRows(broker.attempts);
  }, [broker]);

  const activeRows = useMemo(() => {
    switch (activeTab) {
      case "successful":
        return feedRows.filter((attempt) => !brokerAttemptIsFailure(attempt));
      case "failed":
        return feedRows.filter(brokerAttemptIsFailure);
      default:
        return feedRows;
    }
  }, [activeTab, feedRows]);
  const activeHasMore = broker?.ledger.hasMore.attempts ?? false;
  const tabCounts = useMemo<Record<BrokerTab, number>>(() => ({
    all: feedRows.length,
    successful: feedRows.filter((attempt) => !brokerAttemptIsFailure(attempt)).length,
    failed: feedRows.filter(brokerAttemptIsFailure).length,
  }), [feedRows]);

  const selectedAttempt = useMemo(() => {
    if (!broker || !selectedBrokerAttempt) return null;
    return feedRows.find((attempt) => attempt.id === selectedBrokerAttempt.id)
      ?? broker.attempts.find((attempt) => attempt.id === selectedBrokerAttempt.id)
      ?? broker.failedQueries.find((attempt) => attempt.id === selectedBrokerAttempt.id)
      ?? broker.failedDeliveries.find((attempt) => attempt.id === selectedBrokerAttempt.id)
      ?? null;
  }, [broker, feedRows, selectedBrokerAttempt]);

  useEffect(() => {
    if (selectedAttempt && selectedAttempt !== selectedBrokerAttempt) {
      inspectBrokerAttempt(selectedAttempt);
    }
  }, [inspectBrokerAttempt, selectedAttempt, selectedBrokerAttempt]);

  const activateLedgerRow = useCallback((index: number) => {
    const attempt = activeRows[index];
    if (!attempt) return;
    inspectBrokerAttempt(attempt);
    window.dispatchEvent(new CustomEvent("scout:set-inspector-width", {
      detail: { width: 420 },
    }));
  }, [activeRows, inspectBrokerAttempt]);

  const { getRowFocusProps, setFocusedIndex } = useBrokerLedgerKeyboard({
    enabled: Boolean(broker) && activeRows.length > 0,
    rowCount: activeRows.length,
    onActivateRow: activateLedgerRow,
    onClearSelection: clearBrokerAttempt,
  });

  useEffect(() => {
    if (!selectedBrokerAttempt) return;
    const index = activeRows.findIndex((row) => row.id === selectedBrokerAttempt.id);
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
                aria-label="Dispatch message filters"
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
                    <span>{TAB_LABELS[tab]}</span>
                    <span className="sys-tab-count">{tabCounts[tab]}</span>
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
                    ? `Updated ${timeAgo(broker.generatedAt)}${broker.source?.latestMessageAt ? ` · latest message ${timeAgo(broker.source.latestMessageAt)}` : ""}`
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

          {refreshing && broker && (
            <div
              className="sys-broker-source-note"
              role="status"
              aria-live="polite"
            >
              <LoaderCircle className="sys-broker-source-spinner" size={12} aria-hidden="true" />
              <strong>Updating dispatches…</strong>
            </div>
          )}

          {!refreshing
            && broker?.source?.mode === "sqlite_projection"
            && broker.source.status === "degraded"
            && broker.source.detail && (
            <div
              className="sys-broker-source-note sys-broker-source-note--warning"
              role="status"
              aria-label={broker.source.detail}
              title={broker.source.detail}
            >
              <span className="sys-broker-source-dot" aria-hidden="true" />
              <strong>Dispatch may be out of date</strong>
              <span>Live broker unavailable; showing saved dispatch history.</span>
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
              <BrokerAttemptList
                attempts={activeRows}
                navigate={navigate}
                selectedAttemptId={selectedBrokerAttempt?.id ?? null}
                onInspect={inspectBrokerAttempt}
                getRowFocusProps={getRowFocusProps}
              />
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

  const groups = attempts.reduce<Array<{
    key: string;
    label: string;
    attempts: Array<{ attempt: BrokerRouteAttempt; index: number }>;
  }>>((result, attempt, index) => {
    const key = dispatchDayKey(attempt.ts);
    const current = result[result.length - 1];
    if (current?.key === key) {
      current.attempts.push({ attempt, index });
    } else {
      result.push({ key, label: dispatchDayLabel(attempt.ts), attempts: [{ attempt, index }] });
    }
    return result;
  }, []);

  return (
    <div className="sys-broker-table" aria-label="Dispatch ledger">
      {groups.map((group) => (
        <section className="sys-broker-day" key={group.key} aria-labelledby={`dispatch-day-${group.key}`}>
          <header className="sys-broker-day-head">
            <h2 id={`dispatch-day-${group.key}`}>{group.label}</h2>
            <span>{group.attempts.length} {group.attempts.length === 1 ? "dispatch" : "dispatches"}</span>
          </header>
          <div className="sys-broker-table-body" role="list">
            {group.attempts.map(({ attempt, index }) => {
              const tone = brokerAttemptTone(attempt.kind, attempt.status);
              const outcomeLabel = attemptOutcomeLabel(attempt);
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
                  role="listitem"
                  className={`sys-broker-row sys-broker-row--ledger${isFailure ? " sys-broker-row--failure" : ""}${selectedAttemptId === attempt.id ? " sys-broker-row-selected" : ""}`}
                  aria-label={`Inspect ${attempt.detail}`}
                  onClick={inspect}
                  {...getRowFocusProps(index)}
                >
                  <div className="sys-broker-event-rail" aria-hidden="true">
                    <span className="sys-broker-event-icon">
                      {isFailure ? <TriangleAlert size={12} /> : <CheckCircle2 size={12} />}
                    </span>
                  </div>
                  <div className="sys-broker-cell sys-broker-cell-detail">
                    <div className="sys-broker-route-line">
                      <div className="sys-broker-route-parties">
                        <span className="sys-broker-actor" title={attempt.actorName ?? "unknown"}>
                          {attempt.actorName ?? "Unknown sender"}
                        </span>
                        <ArrowRight size={13} aria-hidden="true" />
                        <span className="sys-broker-target" title={attempt.target ?? "none"}>
                          {attempt.target ?? "No target"}
                        </span>
                      </div>
                      <time title={fullTimestamp(attempt.ts)}>{timeAgo(attempt.ts)}</time>
                    </div>
                    <h3 className="sys-broker-title" title={attempt.detail}>{detailSnippet}</h3>
                    {errorSummary && (
                      <p className="sys-broker-error-detail" title={errorSummary}>{errorSummary}</p>
                    )}
                    <div className="sys-broker-dispatch-footer">
                      <StatusPill tone={tone} className="sys-broker-outcome">{outcomeLabel}</StatusPill>
                      <span className="sys-broker-route-kind">{routeKindLabel(attempt.route)}</span>
                      {attempt.status !== outcomeLabel && (
                        <span className={`sys-broker-status${isFailure ? " sys-broker-status--error" : ""}`}>
                          {attempt.status}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="sys-broker-cell sys-broker-cell-action">
                    {attempt.conversationId && (
                      <button
                        type="button"
                        className="sys-broker-thread-button"
                        title="Open thread"
                        aria-label="Open thread"
                        onClick={(event) => {
                          event.stopPropagation();
                          openContent(navigate, { view: "conversation", conversationId: attempt.conversationId! }, { returnTo: route });
                        }}
                      >
                        <ExternalLink size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
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

  const sendToScout = useCallback(() => {
    const request = brokerScoutbotTriageRequest(attempt);
    window.dispatchEvent(new CustomEvent(request.eventName, {
      detail: { body: request.body },
    }));
  }, [attempt]);

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
                  onClick={sendToScout}
                  title="Send this failed dispatch to Scout for triage"
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

export const scoutSurface = defineSurface({
  id: "dispatch",
  label: "Dispatch",
  route: { view: "broker" },
  webPath: "/dispatch",
  screen: "BrokerScreen",
  embed: {
    path: "/embed/dispatch",
    profile: "macos.dispatch",
    rootClassName: "s-broker-embed",
    chrome: { showSecondaryNav: false, showPageStatusBar: false },
    hosts: { macos: true },
  },
});
