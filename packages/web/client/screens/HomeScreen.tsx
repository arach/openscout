import "./fleet-home.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Settings, X } from "lucide-react";
import HomeHero from "./HomeHero.tsx";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { isOpsEnabled } from "../lib/feature-flags.ts";
import { isAgentOnline, normalizeAgentState } from "../lib/agent-state.ts";
import { useScout } from "../scout/Provider.tsx";
import { conversationForAgent } from "../lib/router.ts";
import { dismissOperatorAttention } from "../lib/operator-attention.ts";
import type {
  ActivityItem,
  Agent,
  FleetAsk,
  FleetAttentionItem,
  FleetState,
  OperatorAttentionItem,
  OperatorAttentionState,
  Route,
  SessionEntry,
} from "../lib/types.ts";

type HeartrateBucketView = {
  ts: number;
  count: number;
  value: number;
};

type LoadMode = "initial" | "background" | "manual";

function greetingFor(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function settledError(result: PromiseSettledResult<unknown>): string | null {
  if (result.status === "fulfilled") return null;
  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

function activitySignalRank(item: ActivityItem): number {
  if (item.kind === "flight_updated" && /\breplied\.?$/i.test(item.title ?? "")) {
    return 0;
  }

  const text = (item.title ?? item.summary ?? "").trim().toLowerCase();
  if (/^(kk|k|ok|okay|ping|pong|thanks|thank you)\.?$/.test(text)) {
    return 0;
  }

  switch (item.kind) {
    case "ask_failed":
      return 110;
    case "handoff_sent":
      return 100;
    case "collaboration_event":
      return 95;
    case "agent_message":
      return 90;
    case "status_message":
      return 85;
    case "ask_working":
      return 75;
    case "ask_opened":
      return 70;
    case "message_posted":
      return 60;
    case "invocation_recorded":
      return 30;
    case "flight_updated":
      return 20;
    default:
      return 50;
  }
}

function activitySignalKey(item: ActivityItem): string {
  const text = (item.title ?? item.summary ?? "").trim().toLowerCase();
  return `${item.conversationId ?? "global"}:${text}`;
}

function activityKindLabel(kind: string): string {
  switch (kind) {
    case "ask_opened":
      return "ask";
    case "handoff_sent":
      return "handoff";
    case "collaboration_event":
      return "work";
    case "agent_message":
      return "message";
    case "status_message":
      return "status";
    case "ask_failed":
      return "failed";
    case "ask_working":
      return "working";
    case "invocation_recorded":
      return "recorded";
    case "flight_updated":
      return "flight";
    default:
      return kind.replace(/_/g, " ");
  }
}

function homeActivitySignals(items: ActivityItem[], limit = 12): ActivityItem[] {
  const ranked = items
    .map((item) => ({ item, rank: activitySignalRank(item) }))
    .filter(({ rank }) => rank > 0)
    .sort((left, right) => {
      const recency = right.item.ts - left.item.ts;
      if (Math.abs(recency) > 30_000) return recency;
      return right.rank - left.rank;
    });

  const selected: ActivityItem[] = [];
  const seen = new Set<string>();
  for (const { item } of ranked) {
    const key = activitySignalKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(item);
    if (selected.length >= limit) break;
  }

  return selected.sort((left, right) => right.ts - left.ts);
}

export function HomeScreen({
  navigate,
}: {
  navigate: (r: Route) => void;
}) {
  const { agents, onboarding, reload } = useScout();
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [attention, setAttention] = useState<OperatorAttentionState | null>(null);
  const [heartrate, setHeartrate] = useState<HeartrateBucketView[]>([]);
  const [heartrateWindow, setHeartrateWindow] = useState("trailing 7d");
  const [heartrateBucketLabel, setHeartrateBucketLabel] = useState("3h buckets");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const lastForegroundRefreshAtRef = useRef(0);
  const fleetRef = useRef<FleetState | null>(null);

  useEffect(() => {
    fleetRef.current = fleet;
  }, [fleet]);

  const load = useCallback(async (mode: LoadMode = "initial") => {
    const requestId = ++requestIdRef.current;
    const hasSnapshot = fleetRef.current !== null;

    if (!hasSnapshot && mode !== "background") {
      setLoading(true);
      setError(null);
    } else {
      setRefreshing(true);
    }

    const [activityResult, sessionsResult, fleetResult, attentionResult, heartrateResult, agentsResult] =
      await Promise.allSettled([
        api<ActivityItem[]>("/api/activity"),
        api<SessionEntry[]>("/api/conversations"),
        api<FleetState>("/api/fleet"),
        api<OperatorAttentionState>("/api/operator-attention"),
        api<{
          windowLabel: string;
          bucketLabel?: string;
          buckets: HeartrateBucketView[];
        }>("/api/heartrate"),
        reload(),
      ]);

    if (requestId !== requestIdRef.current) return;

    if (activityResult.status === "fulfilled")
      setActivity(activityResult.value);
    if (sessionsResult.status === "fulfilled")
      setSessions(
        [...sessionsResult.value].sort(
          (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0),
        ),
      );
    if (fleetResult.status === "fulfilled") {
      fleetRef.current = fleetResult.value;
      setFleet(fleetResult.value);
    }
    if (attentionResult.status === "fulfilled") {
      setAttention(attentionResult.value);
    }
    if (heartrateResult.status === "fulfilled") {
      setHeartrate(heartrateResult.value.buckets);
      setHeartrateWindow(heartrateResult.value.windowLabel);
      setHeartrateBucketLabel(heartrateResult.value.bucketLabel ?? "");
    }

    const errors = [
      settledError(activityResult),
      settledError(sessionsResult),
      settledError(fleetResult),
      settledError(attentionResult),
      settledError(heartrateResult),
      settledError(agentsResult),
    ].filter((message): message is string => Boolean(message));
    setError(errors[0] ?? null);
    if (errors.length < 5) {
      setLastLoadedAt(Date.now());
    }
    setLoading(false);
    setRefreshing(false);
  }, [reload]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void load("background");
    }, 250);
  }, [load]);

  useEffect(() => {
    void load();
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [load]);
  useBrokerEvents(scheduleRefresh);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void load("background");
      }
    }, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      const now = Date.now();
      if (now - lastForegroundRefreshAtRef.current < 1000) {
        return;
      }
      lastForegroundRefreshAtRef.current = now;
      void load("background");
    };

    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [load]);

  const active = useMemo(
    () => agents.filter((a) => normalizeAgentState(a.state) === "working"),
    [agents],
  );
  const waiting = useMemo(
    () =>
      agents.filter((a) => {
        const s = normalizeAgentState(a.state);
        return s === "available";
      }),
    [agents],
  );
  const offline = useMemo(
    () => agents.filter((a) => normalizeAgentState(a.state) === "offline"),
    [agents],
  );

  const needsYouAsks = useMemo(
    () =>
      [...(fleet?.activeAsks ?? []), ...(fleet?.recentCompleted ?? [])].filter(
        (a) => a.status === "needs_attention" || a.status === "failed",
      ),
    [fleet],
  );
  const movingAsks = useMemo(
    () =>
      (fleet?.activeAsks ?? []).filter(
        (a) => a.status === "queued" || a.status === "working",
      ),
    [fleet],
  );
  const needsYouItems = useMemo(() => fleet?.needsAttention ?? [], [fleet]);
  const activeAskByAgent = useMemo(() => {
    const byAgent = new Map<string, FleetAsk>();
    for (const ask of movingAsks) {
      const current = byAgent.get(ask.agentId);
      if (!current || ask.updatedAt > current.updatedAt) {
        byAgent.set(ask.agentId, ask);
      }
    }
    return byAgent;
  }, [movingAsks]);
  const movingAsksWithoutActiveAgent = useMemo(
    () =>
      movingAsks.filter(
        (ask) => !active.some((agent) => agent.id === ask.agentId),
      ),
    [active, movingAsks],
  );

  const totalNeedsYou = needsYouAsks.length + needsYouItems.length;
  const attentionItems = attention?.items ?? [];
  const totalOperatorQueue = attention?.totals.all ?? totalNeedsYou;
  const oldestNeedsTs = useMemo(() => {
    const stamps = [
      ...needsYouAsks.map((a) => a.updatedAt),
      ...needsYouItems.map((w) => w.updatedAt),
      ...attentionItems.map((item) => item.updatedAt),
    ];
    return stamps.length > 0 ? Math.min(...stamps) : null;
  }, [attentionItems, needsYouAsks, needsYouItems]);

  const activityPreview = useMemo(() => homeActivitySignals(activity), [activity]);
  const activityPreviewLabel = activityPreview.length === 0
    ? "quiet"
    : `latest ${activityPreview.length} signal${activityPreview.length === 1 ? "" : "s"}`;
  const now = new Date();
  const greeting = greetingFor(now.getHours());
  const opsEnabled = isOpsEnabled();
  const operatorName =
    onboarding?.operatorName?.trim()
    || onboarding?.operatorNameSuggestion?.trim()
    || "operator";

  const narrativeParts = useMemo(() => {
    const parts: string[] = [];
    if (active.length > 0)
      parts.push(`${active.length} agent${active.length === 1 ? " is" : "s are"} working now`);
    if (waiting.length > 0)
      parts.push(`${waiting.length} agent${waiting.length === 1 ? " is" : "s are"} available`);
    if (totalOperatorQueue > 0)
      parts.push(`${totalOperatorQueue} thing${totalOperatorQueue === 1 ? "" : "s"} need${totalOperatorQueue === 1 ? "s" : ""} you`);
    if (parts.length === 0 && agents.length > 0)
      parts.push(`${agents.length} agent${agents.length === 1 ? " is" : "s are"} registered`);
    if (parts.length === 0)
      parts.push("no agents are connected yet");
    return parts;
  }, [active, waiting, totalOperatorQueue, agents]);
  const syncLabel = loading
    ? "syncing"
    : error
      ? `sync issue · ${lastLoadedAt ? timeAgo(lastLoadedAt) : "waiting"}`
      : lastLoadedAt
        ? `updated ${timeAgo(lastLoadedAt)}`
        : "waiting";

  const heroProps = {
    now,
    greeting,
    operatorName,
    syncLabel,
    error,
    loading,
    refreshing,
    onRefresh: () => void load("manual"),
    activeCount: active.length,
    waitingCount: waiting.length,
    offlineCount: offline.length,
    totalAgents: agents.length,
    totalOperatorQueue,
    narrativeParts,
    navigate,
    opsEnabled,
    onReviewQueue: () => {
      const target = document.getElementById("home-needs-you");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    heartrate,
    heartrateWindow,
    heartrateBucketLabel,
  };

  return (
    <div className="s-fleet-home">
      <div className="s-fleet-home-inner">
        {/* ── Hero briefing ──────────────────────────────────────── */}
        <HomeHero {...heroProps} />

        {/* ── Network signals ─────────────────────────────────────── */}
        <div className="s-fleet-section" id="home-needs-you">
          <SectionRule
            label={`Network signals · ${totalOperatorQueue}`}
            right={
              totalOperatorQueue > 0 && oldestNeedsTs !== null ? (
                <span style={{ color: "var(--amber)" }}>
                  oldest {timeAgo(oldestNeedsTs)}
                </span>
              ) : (
                "quiet"
              )
            }
          />

          {attentionItems.length > 0 ? (
            <OperatorAttentionQueue
              items={attentionItems}
              navigate={navigate}
              onResolved={(next) => setAttention(next)}
            />
          ) : needsYouAsks.length > 0 && (
            <div className="s-ask-grid">
              {needsYouAsks.slice(0, 4).map((ask) => (
                <AskBlock
                  key={ask.invocationId}
                  ask={ask}
                  agents={agents}
                  navigate={navigate}
                  operatorName={operatorName}
                  pending
                />
              ))}
            </div>
          )}

          {attentionItems.length === 0 && needsYouItems.length > 0 && (
            <div className="s-attention-list">
              {needsYouItems.map((item) => (
                <AttentionRow
                  key={item.recordId}
                  item={item}
                  navigate={navigate}
                />
              ))}
            </div>
          )}

          {totalOperatorQueue === 0 && (
            <FleetClearState
              agents={agents}
              activeCount={active.length}
              waitingCount={waiting.length}
              offlineCount={offline.length}
              navigate={navigate}
            />
          )}
        </div>

        {/* ── What's moving ──────────────────────────────────────── */}
        {(active.length > 0 || movingAsksWithoutActiveAgent.length > 0) && (
          <div className="s-fleet-section">
            <SectionRule
              label={`What's moving · ${active.length + movingAsksWithoutActiveAgent.length}`}
              right={
                <button
                  className="s-link-btn"
                  onClick={() => navigate({ view: "mesh" })}
                >
                  open mesh ↗
                </button>
              }
            />
            {active.length > 0 && (
              <div
                className="s-now-grid"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(active.length, 3)}, 1fr)`,
                }}
              >
                {active.map((agent) => (
                  <NowCard
                    key={agent.id}
                    agent={agent}
                    ask={activeAskByAgent.get(agent.id) ?? null}
                    navigate={navigate}
                  />
                ))}
              </div>
            )}
            {movingAsksWithoutActiveAgent.length > 0 && (
              <div className="s-moving-ask-list">
                {movingAsksWithoutActiveAgent.map((ask) => (
                  <MovingAskRow
                    key={ask.invocationId}
                    ask={ask}
                    navigate={navigate}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Since you were away ────────────────────────────────── */}
        {activityPreview.length > 0 && (
          <div className="s-fleet-section">
            <SectionRule
              label="Since you were away"
              right={activityPreviewLabel}
            />
            <SinceTimeline
              items={activityPreview}
              agents={agents}
              navigate={navigate}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────────── */

function SectionRule({
  label,
  right,
}: {
  label: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="s-section-rule">
      <span className="s-eyebrow">{label}</span>
      <span className="s-section-rule-line" />
      {right && <span className="s-section-rule-right">{right}</span>}
    </div>
  );
}

function FleetClearState({
  agents,
  activeCount,
  waitingCount,
  offlineCount,
  navigate,
}: {
  agents: Agent[];
  activeCount: number;
  waitingCount: number;
  offlineCount: number;
  navigate: (r: Route) => void;
}) {
  const roster = useMemo(() => {
    const stateRank = (agent: Agent) => {
      switch (normalizeAgentState(agent.state)) {
        case "working":
          return 0;
        case "available":
          return 1;
        default:
          return 2;
      }
    };

    return [...agents]
      .sort((left, right) => {
        const byState = stateRank(left) - stateRank(right);
        if (byState !== 0) return byState;
        return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
      })
      .slice(0, 8);
  }, [agents]);

  return (
    <div className="s-fleet-clear">
      <div className="s-fleet-clear-head">
        <div>
          <span className="s-eyebrow">Fleet overview</span>
          <div className="s-fleet-clear-title">
            {agents.length === 0
              ? "No agents registered"
              : `${agents.length} agent${agents.length === 1 ? "" : "s"} registered`}
          </div>
        </div>
        <button
          className="s-link-btn"
          onClick={() => navigate({ view: "agents" })}
        >
          open agents
        </button>
      </div>

      <div className="s-fleet-clear-metrics">
        <FleetMetric label="Working" value={activeCount} color="var(--green)" />
        <FleetMetric label="Available" value={waitingCount} color="var(--accent)" />
        <FleetMetric label="Offline" value={offlineCount} color="var(--dim)" />
      </div>

      {roster.length > 0 ? (
        <div className="s-fleet-roster">
          {roster.map((agent) => {
            const displayState = normalizeAgentState(agent.state);
            const handle = agent.handle ? `@${agent.handle}` : agent.selector ?? agent.id;
            const role = agent.role ?? agent.agentClass;
            const route: Route = {
              view: "agents",
              agentId: agent.id,
              conversationId: agent.conversationId || conversationForAgent(agent.id),
              tab: displayState === "offline" ? "profile" : "observe",
            };

            return (
              <button
                key={agent.id}
                className="s-fleet-roster-row"
                onClick={() => navigate(route)}
              >
                <span
                  className="s-fleet-roster-dot"
                  style={{ background: stateColor(agent.state) }}
                />
                <span className="s-fleet-roster-name">{agent.name}</span>
                <span className="s-fleet-roster-meta">{handle} · {role}</span>
                <span className="s-fleet-roster-state">{displayState}</span>
                <span className="s-fleet-roster-time">
                  {agent.updatedAt ? timeAgo(agent.updatedAt) : "no heartbeat"}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="s-fleet-clear-empty">No roster entries.</div>
      )}
    </div>
  );
}

function FleetMetric({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="s-fleet-metric">
      <span className="s-fleet-metric-dot" style={{ background: color }} />
      <span className="s-eyebrow">{label}</span>
      <span className="s-fleet-metric-value">{value}</span>
    </div>
  );
}

function OperatorAttentionQueue({
  items,
  navigate,
  onResolved,
}: {
  items: OperatorAttentionItem[];
  navigate: (r: Route) => void;
  onResolved: (next: OperatorAttentionState) => void;
}) {
  return (
    <div className="s-operator-queue">
      <div className="s-operator-queue-head">
        <div>
          <div className="s-operator-queue-title">Operator queue</div>
          <div className="s-operator-queue-subtitle">
            Permissions, questions, and setup blockers in one place.
          </div>
        </div>
        <div className="s-operator-queue-count">{items.length}</div>
      </div>
      <div className="s-operator-queue-list">
        {items.map((item) => (
          <OperatorAttentionCard
            key={item.id}
            item={item}
            navigate={navigate}
            onResolved={onResolved}
          />
        ))}
      </div>
    </div>
  );
}

function severityLabel(severity: OperatorAttentionItem["severity"]): string {
  switch (severity) {
    case "critical":
      return "blocked";
    case "warning":
      return "needs input";
    default:
      return "review";
  }
}

function routeFromAttention(item: OperatorAttentionItem): Route | null {
  const routedAction = item.actions.find((action) => action.route)?.route;
  if (routedAction) return routedAction;
  if (item.conversationId) return { view: "conversation", conversationId: item.conversationId };
  if (item.agentId) return { view: "agents", agentId: item.agentId };
  return null;
}

function OperatorAttentionCard({
  item,
  navigate,
  onResolved,
}: {
  item: OperatorAttentionItem;
  navigate: (r: Route) => void;
  onResolved: (next: OperatorAttentionState) => void;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | "dismiss" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const route = routeFromAttention(item);
  const copyAction = item.actions.find((action) => action.kind === "copy" && action.value);
  const approve = item.actions.find((action) => action.kind === "approve");
  const deny = item.actions.find((action) => action.kind === "deny");
  const dismiss = item.actions.find((action) => action.kind === "dismiss");

  const decide = async (decision: "approve" | "deny") => {
    if (!item.approval && !item.permissionRequest) return;
    setBusy(decision);
    setError(null);
    try {
      const next = item.permissionRequest
        ? await api<OperatorAttentionState>("/api/operator-attention/permissions/decide", {
            method: "POST",
            body: JSON.stringify({
              id: item.permissionRequest.id,
              decision: decision === "approve" ? "allow" : "deny",
            }),
          })
        : await api<OperatorAttentionState>("/api/operator-attention/approvals/decide", {
            method: "POST",
            body: JSON.stringify({
              sessionId: item.approval?.sessionId,
              turnId: item.approval?.turnId,
              blockId: item.approval?.blockId,
              version: item.approval?.version,
              decision,
            }),
          });
      onResolved(next);
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : String(decisionError));
    } finally {
      setBusy(null);
    }
  };

  const copyFix = () => {
    if (!copyAction?.value) return;
    void navigator.clipboard.writeText(copyAction.value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  const dismissItem = async () => {
    if (!dismiss?.unblockRequestId && !dismiss?.flightId && (!dismiss?.recordKind || !dismiss.recordId)) {
      setError("This queue item cannot be dismissed from here yet.");
      return;
    }
    setBusy("dismiss");
    setError(null);
    try {
      if (dismiss.unblockRequestId) {
        await dismissOperatorAttention({
          unblockRequestId: dismiss.unblockRequestId,
          itemUpdatedAt: item.updatedAt,
        });
      } else if (dismiss.flightId) {
        await dismissOperatorAttention({ flightId: dismiss.flightId, itemUpdatedAt: item.updatedAt });
      } else {
        const recordKind = dismiss.recordKind;
        const recordId = dismiss.recordId;
        if (!recordKind || !recordId) {
          throw new Error("This queue item cannot be dismissed from here yet.");
        }
        await dismissOperatorAttention({
          recordKind,
          recordId,
          itemUpdatedAt: item.updatedAt,
        });
      }
      const next = await api<OperatorAttentionState>("/api/operator-attention");
      onResolved(next);
    } catch (dismissError) {
      setError(dismissError instanceof Error ? dismissError.message : String(dismissError));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`s-operator-card s-operator-card--${item.severity}`}>
      <div className="s-operator-card-main">
        <div className="s-operator-card-top">
          <span className="s-eyebrow">{item.sourceLabel}</span>
          <span className="s-operator-card-severity">{severityLabel(item.severity)}</span>
          <span className="s-operator-card-age">{timeAgo(item.updatedAt)}</span>
        </div>
        <div className="s-operator-card-title">{item.title}</div>
        {item.summary && <div className="s-operator-card-summary">{item.summary}</div>}
        {item.detail && <div className="s-operator-card-detail">{item.detail}</div>}
        {item.agentName && (
          <div className="s-operator-card-meta">{item.agentName}</div>
        )}
        {error && <div className="s-operator-card-error">{error}</div>}
      </div>
      <div className="s-operator-card-actions">
        {approve && (
          <button
            type="button"
            className="s-icon-btn s-icon-btn--primary"
            disabled={Boolean(busy)}
            title="Approve"
            onClick={() => void decide("approve")}
          >
            <Check size={14} aria-hidden="true" />
            <span>{busy === "approve" ? "Approving" : approve.label}</span>
          </button>
        )}
        {deny && (
          <button
            type="button"
            className="s-icon-btn"
            disabled={Boolean(busy)}
            title="Deny"
            onClick={() => void decide("deny")}
          >
            <X size={14} aria-hidden="true" />
            <span>{busy === "deny" ? "Denying" : deny.label}</span>
          </button>
        )}
        {copyAction && (
          <button
            type="button"
            className="s-icon-btn"
            title="Copy fix"
            onClick={copyFix}
          >
            <Copy size={14} aria-hidden="true" />
            <span>{copied ? "Copied" : copyAction.label}</span>
          </button>
        )}
        {item.actions.some((action) => action.kind === "configure") && (
          <button
            type="button"
            className="s-icon-btn"
            title="Open settings"
            onClick={() => navigate({ view: "settings" })}
          >
            <Settings size={14} aria-hidden="true" />
            <span>Settings</span>
          </button>
        )}
        {route && (
          <button
            type="button"
            className="s-icon-btn"
            title="Open source"
            onClick={() => navigate(route)}
          >
            <ExternalLink size={14} aria-hidden="true" />
            <span>Open</span>
          </button>
        )}
        {dismiss && (
          <button
            type="button"
            className="s-icon-btn"
            disabled={Boolean(busy)}
            title="Dismiss from queue"
            onClick={() => void dismissItem()}
          >
            <X size={14} aria-hidden="true" />
            <span>{busy === "dismiss" ? "Dismissing" : dismiss.label}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function AskBlock({
  ask,
  agents,
  navigate,
  operatorName,
  pending,
}: {
  ask: FleetAsk;
  agents: Agent[];
  navigate: (r: Route) => void;
  operatorName: string;
  pending: boolean;
}) {
  const fromAgent = agents.find((a) => a.id === ask.agentId);
  const fromName = fromAgent?.name ?? ask.agentName ?? ask.agentId;
  const route: Route = ask.conversationId
    ? { view: "conversation", conversationId: ask.conversationId }
    : { view: "agents", agentId: ask.agentId };

  return (
    <div
      className={`s-ask-block${pending ? " s-ask-block--pending" : ""}`}
      style={{ cursor: "pointer" }}
      onClick={() => navigate(route)}
    >
      <div className="s-ask-header">
        <span className="s-eyebrow s-ask-label">
          {pending ? "◌ ASK — ATTENTION" : "● ASK"}
        </span>
        <span style={{ flex: 1 }} />
        <span className="s-eyebrow">{timeAgo(ask.updatedAt)}</span>
      </div>
      <div className="s-ask-body">
        <div
          className="s-avatar s-avatar-sm"
          style={{ background: actorColor(fromName) }}
        >
          {fromName[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="s-ask-body-copy">
          <div className="s-ask-route">
            <span className="s-ask-route-name">{fromName}</span>
            <span> → </span>
            <span style={{ color: "var(--accent)" }}>{operatorName}</span>
          </div>
          <div className="s-ask-text">
            "{ask.summary ?? ask.task}"
          </div>
        </div>
      </div>
      {pending && (
        <div className="s-ask-actions">
          <button className="s-btn-fleet s-btn-fleet--primary">Answer</button>
          <button className="s-btn-fleet">Defer</button>
          <button className="s-btn-fleet">Route…</button>
          <span className="s-ask-thinking">
            <span className="s-thinking-strip" />
          </span>
        </div>
      )}
    </div>
  );
}

function AttentionRow({
  item,
  navigate,
}: {
  item: FleetAttentionItem;
  navigate: (r: Route) => void;
}) {
  const route: Route | null =
    item.kind === "work_item" && item.recordId
      ? { view: "work", workId: item.recordId }
      : item.conversationId
        ? { view: "conversation", conversationId: item.conversationId }
        : item.agentId
          ? { view: "agents", agentId: item.agentId }
          : null;

  const stateLabel =
    item.kind === "question" ? "question" : item.state.replace(/_/g, " ");
  const responseLabel =
    item.acceptanceState !== "none"
      ? item.kind === "question"
        ? item.acceptanceState.replace(/_/g, " ")
        : "agent-owned"
      : item.kind === "question"
        ? "awaiting answer"
        : "surfaced";
  const actionLabel =
    item.kind === "question"
      ? "answer"
      : item.state === "review"
        ? "view plan"
        : item.acceptanceState === "pending"
          ? "view signal"
          : "open work";

  return (
    <div
      className={`s-attention-row${route ? " s-attention-row--clickable" : ""}`}
      onClick={route ? () => navigate(route) : undefined}
    >
      <div className="s-attention-row-title">{item.title}</div>
      <div className="s-attention-row-meta">
        <span className="s-eyebrow">
          {item.kind === "work_item" ? "WORK ITEM" : "QUESTION"}
        </span>
        {item.agentName && <span>{item.agentName}</span>}
        <span>{stateLabel}</span>
        <span style={{ color: "var(--amber)" }}>{responseLabel}</span>
        <span style={{ marginLeft: "auto" }}>{timeAgo(item.updatedAt)}</span>
        {route && <span className="s-attention-row-action">{actionLabel} ↗</span>}
      </div>
      {item.summary && (
        <p className="s-attention-row-summary">{item.summary}</p>
      )}
    </div>
  );
}

function NowCard({
  agent,
  ask,
  navigate,
}: {
  agent: Agent;
  ask?: FleetAsk | null;
  navigate: (r: Route) => void;
}) {
  const handle = agent.handle ? `@${agent.handle}` : agent.id;
  const role = agent.role ?? agent.agentClass;
  const branch = agent.branch ?? "main";
  const conversationId = conversationForAgent(agent.id);
  const taskText = ask?.summary ?? ask?.task ?? agent.cwd ?? `Working in ${agent.project ?? "workspace"}`;

  return (
    <div
      className="s-now-card"
      onClick={() =>
        navigate({
          view: "agents",
          agentId: agent.id,
          conversationId,
          tab: "observe",
        })
      }
    >
      <div className="s-now-card-head">
        <div
          className="s-avatar s-avatar-sm"
          style={{ background: actorColor(agent.name) }}
        >
          {agent.name[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="s-now-card-copy">
          <div className="s-now-card-name">{agent.name}</div>
          <div className="s-now-card-meta">
            {handle} · {role}
          </div>
        </div>
        <span className="s-now-card-live">● live</span>
      </div>

      <div className="s-now-card-task">
        {taskText}
      </div>

      <div className="s-now-card-ticker">
        <span className="s-now-card-ticker-prompt">›</span>
        <span className="s-now-card-ticker-text">
          {ask ? `${ask.statusLabel} · ${ask.harness ?? agent.harness ?? "agent"}` : "working"}
        </span>
        <span className="s-now-card-cursor" />
      </div>

      <div className="s-now-card-footer">
        <span>{agent.updatedAt ? `updated ${timeAgo(agent.updatedAt)}` : "active"}</span>
        <span>{branch}</span>
      </div>
    </div>
  );
}

function MovingAskRow({
  ask,
  navigate,
}: {
  ask: FleetAsk;
  navigate: (r: Route) => void;
}) {
  const route: Route = ask.conversationId
    ? { view: "conversation", conversationId: ask.conversationId }
    : ask.collaborationRecordId
      ? { view: "work", workId: ask.collaborationRecordId }
      : { view: "agents", agentId: ask.agentId };

  return (
    <button
      className="s-moving-ask-row"
      onClick={() => navigate(route)}
    >
      <span className="s-moving-ask-agent">
        {ask.agentName ?? ask.agentId}
      </span>
      <span className="s-moving-ask-title">
        {ask.summary ?? ask.task}
      </span>
      <span className="s-moving-ask-state">
        {ask.statusLabel}
      </span>
      <span className="s-moving-ask-time">
        {timeAgo(ask.updatedAt)}
      </span>
    </button>
  );
}

function SinceTimeline({
  items,
  agents,
  navigate,
}: {
  items: ActivityItem[];
  agents: Agent[];
  navigate: (r: Route) => void;
}) {
  const sorted = [...items].sort(
    (a, b) => b.ts - a.ts,
  );

  const kindMark: Record<string, string> = {
    ask_opened: "?",
    ask_failed: "!",
    ask_working: "…",
    handoff_sent: "→",
    collaboration_event: "◆",
    agent_message: "·",
    status_message: "·",
    message_posted: "·",
    invocation_recorded: "⌘",
    flight_updated: "⌘",
    "collaboration.ask": "?",
    "message.sent": "·",
    "message.received": "·",
    "flight.started": "⌘",
    "flight.completed": "⌘",
    "agent.online": "→",
    "agent.offline": "→",
    "agent.registered": "→",
    "collaboration.answer": "↳",
  };

  const kindColor: Record<string, string> = {
    ask_opened: "var(--amber)",
    ask_failed: "var(--red)",
    ask_working: "var(--amber)",
    handoff_sent: "var(--accent)",
    collaboration_event: "var(--green)",
    agent_message: "var(--dim)",
    status_message: "var(--muted)",
    message_posted: "var(--dim)",
    invocation_recorded: "var(--muted)",
    flight_updated: "var(--green)",
    "collaboration.ask": "var(--amber)",
    "collaboration.answer": "var(--accent)",
    "message.sent": "var(--dim)",
    "message.received": "var(--dim)",
    "flight.started": "var(--muted)",
    "flight.completed": "var(--green)",
    "agent.online": "var(--accent)",
    "agent.offline": "var(--dim)",
    "agent.registered": "var(--accent)",
  };

  return (
    <div className="s-timeline">
      <div className="s-timeline-spine" />
      {sorted.map((item) => {
        const actor = item.actorName ?? "system";
        const color = kindColor[item.kind] ?? "var(--dim)";
        const mark = kindMark[item.kind] ?? "·";
        const kindLabel = activityKindLabel(item.kind);
        const route: Route | null = item.conversationId
          ? { view: "conversation", conversationId: item.conversationId }
          : null;

        return (
          <div
            key={item.id}
            className="s-timeline-row"
            style={{ cursor: route ? "pointer" : undefined }}
            onClick={route ? () => navigate(route) : undefined}
          >
            <div
              className="s-timeline-bead"
              style={{ background: color }}
            />
            <span className="s-timeline-time">{timeAgo(item.ts)}</span>
            <div className="s-timeline-actors">
              <span
                className="s-timeline-kind-mark"
                style={{ color }}
              >
                {mark}
              </span>
              <div
                className="s-avatar"
                style={{
                  width: 18,
                  height: 18,
                  fontSize: 9,
                  background: actorColor(actor),
                }}
              >
                {actor[0]?.toUpperCase() ?? "?"}
              </div>
              <span className="s-timeline-handle">{actor}</span>
            </div>
            <span className="s-timeline-text">
              {item.title ?? item.summary ?? ""}
            </span>
            <span className="s-timeline-kind">{kindLabel}</span>
          </div>
        );
      })}
    </div>
  );
}
