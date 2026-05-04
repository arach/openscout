import "./fleet-home.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { isOpsEnabled } from "../lib/feature-flags.ts";
import { isAgentOnline, normalizeAgentState } from "../lib/agent-state.ts";
import { useScout } from "../scout/Provider.tsx";
import { conversationForAgent } from "../lib/router.ts";
import type {
  ActivityItem,
  Agent,
  FleetAsk,
  FleetAttentionItem,
  FleetState,
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

    const [activityResult, sessionsResult, fleetResult, heartrateResult, agentsResult] =
      await Promise.allSettled([
        api<ActivityItem[]>("/api/activity"),
        api<SessionEntry[]>("/api/conversations"),
        api<FleetState>("/api/fleet"),
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
    if (heartrateResult.status === "fulfilled") {
      setHeartrate(heartrateResult.value.buckets);
      setHeartrateWindow(heartrateResult.value.windowLabel);
      setHeartrateBucketLabel(heartrateResult.value.bucketLabel ?? "");
    }

    const errors = [
      settledError(activityResult),
      settledError(sessionsResult),
      settledError(fleetResult),
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
      (fleet?.activeAsks ?? []).filter(
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
  const oldestNeedsTs = useMemo(() => {
    const stamps = [
      ...needsYouAsks.map((a) => a.updatedAt),
      ...needsYouItems.map((w) => w.updatedAt),
    ];
    return stamps.length > 0 ? Math.min(...stamps) : null;
  }, [needsYouAsks, needsYouItems]);

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
    if (totalNeedsYou > 0)
      parts.push(`${totalNeedsYou} thing${totalNeedsYou === 1 ? "" : "s"} need${totalNeedsYou === 1 ? "s" : ""} you`);
    if (parts.length === 0 && agents.length > 0)
      parts.push(`${agents.length} agent${agents.length === 1 ? " is" : "s are"} registered`);
    if (parts.length === 0)
      parts.push("no agents are connected yet");
    return parts;
  }, [active, waiting, totalNeedsYou, agents]);
  const syncLabel = loading
    ? "syncing"
    : error
      ? `sync issue · ${lastLoadedAt ? timeAgo(lastLoadedAt) : "waiting"}`
      : lastLoadedAt
        ? `updated ${timeAgo(lastLoadedAt)}`
        : "waiting";

  return (
    <div className="s-fleet-home">
      <div className="s-fleet-home-inner">
        {/* ── Hero briefing ──────────────────────────────────────── */}
        <div className="s-hero">
          <div>
            <div className="s-eyebrow" style={{ marginBottom: 12 }}>
              Fleet briefing ·{" "}
              {now.toLocaleDateString([], {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
              <span
                className={`s-fleet-sync-note${error ? " s-fleet-sync-note--error" : ""}`}
              >
                {syncLabel}
              </span>
            </div>
            <h1 className="s-hero-greeting">
              {greeting}, <em>{operatorName}.</em>
            </h1>
            <p className="s-hero-narrative">
              {narrativeParts.map((part, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  {part.includes("need") ? (
                    <span className="s-hero-warn">{part}</span>
                  ) : (
                    <strong>{part}</strong>
                  )}
                </span>
              ))}
              .
            </p>
            <div className="s-hero-actions">
              {totalNeedsYou > 0 && (
                <button
                  className="s-btn-fleet s-btn-fleet--primary"
                  onClick={() => {
                    const target = document.getElementById("home-needs-you");
                    target?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  Clear queue · {totalNeedsYou}
                </button>
              )}
              {opsEnabled && (
                <button
                  className="s-btn-fleet"
                  onClick={() => navigate({ view: "ops" })}
                >
                  Open ops center
                </button>
              )}
              <button
                className="s-btn-fleet"
                onClick={() => navigate({ view: "sessions" })}
              >
                Jump to thread
              </button>
              <button
                type="button"
                className="s-btn-fleet s-btn-fleet--icon"
                disabled={loading || refreshing}
                onClick={() => void load("manual")}
              >
                <RefreshCw
                  aria-hidden="true"
                  size={12}
                  strokeWidth={2}
                  className={refreshing ? "s-refresh-spin" : undefined}
                />
                <span>{refreshing ? "Refreshing" : "Refresh"}</span>
              </button>
            </div>
          </div>

          <div className="s-heartrate-card">
            <div className="s-heartrate-header">
              <span className="s-eyebrow">Fleet heart-rate</span>
              <span style={{ flex: 1 }} />
              <span className="s-heartrate-live">
                ● {heartrateWindow}{heartrateBucketLabel ? ` · ${heartrateBucketLabel}` : ""}
              </span>
            </div>
            <HeartrateGraph buckets={heartrate} />
            <div className="s-heartrate-stats">
              <StatCell label="Active" value={active.length} color="var(--green)" />
              <StatCell label="Waiting" value={waiting.length} color="var(--amber)" />
              <StatCell label="Offline" value={offline.length} color="var(--dim)" />
            </div>
          </div>
        </div>

        {/* ── Needs you ──────────────────────────────────────────── */}
        <div className="s-fleet-section" id="home-needs-you">
          <SectionRule
            label={`Needs you · ${totalNeedsYou}`}
            right={
              totalNeedsYou > 0 && oldestNeedsTs !== null ? (
                <span style={{ color: "var(--amber)" }}>
                  oldest {timeAgo(oldestNeedsTs)}
                </span>
              ) : (
                "clear"
              )
            }
          />

          {needsYouAsks.length > 0 && (
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

          {needsYouItems.length > 0 && (
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

          {totalNeedsYou === 0 && (
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

function buildSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  const commands = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1 = {
      x: p1.x + (p2.x - p0.x) / 6,
      y: p1.y + (p2.y - p0.y) / 6,
    };
    const cp2 = {
      x: p2.x - (p3.x - p1.x) / 6,
      y: p2.y - (p3.y - p1.y) / 6,
    };
    commands.push(
      `C ${cp1.x.toFixed(1)} ${cp1.y.toFixed(1)}, ${cp2.x.toFixed(1)} ${cp2.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
    );
  }
  return commands.join(" ");
}

function HeartrateGraph({ buckets }: { buckets: HeartrateBucketView[] }) {
  const W = 372;
  const H = 82;
  const chartTop = 6;
  const chartBottom = 60;
  const labelY = 77;
  const N = buckets.length;
  const allZero = N < 2 || buckets.every((bucket) => bucket.count === 0);

  if (allZero) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
        <line x1="0" y1={chartBottom} x2={W} y2={chartBottom} stroke="var(--border)" />
        <text
          x={W / 2}
          y={H / 2 - 4}
          textAnchor="middle"
          fill="var(--dim)"
          fontSize="14"
          letterSpacing="0.3em"
        >
          zzz
        </text>
        <text
          x={W / 2}
          y={H / 2 + 12}
          textAnchor="middle"
          fill="var(--dim)"
          fontSize="10"
          fontFamily="var(--hud-font-mono)"
          opacity="0.7"
        >
          nothing to report
        </text>
      </svg>
    );
  }

  const stepX = W / (N - 1);
  const points = buckets.map((bucket, i) => ({
    x: i * stepX,
    y: chartBottom - Math.max(0, Math.min(1, bucket.value)) * (chartBottom - chartTop),
  }));
  const path = buildSmoothPath(points);
  const areaPath = `${path} L ${W} ${chartBottom} L 0 ${chartBottom} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: H, display: "block" }}
    >
      <defs>
        <linearGradient id="hrFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1={chartTop} x2={W} y2={chartTop} stroke="var(--border)" opacity="0.18" />
      <line x1="0" y1={(chartTop + chartBottom) / 2} x2={W} y2={(chartTop + chartBottom) / 2} stroke="var(--border)" opacity="0.25" />
      <line
        x1="0"
        y1={chartBottom}
        x2={W}
        y2={chartBottom}
        stroke="var(--border)"
      />
      <path d={areaPath} fill="url(#hrFill)" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      <circle
        cx={points[N - 1].x}
        cy={points[N - 1].y}
        r="3.5"
        fill="var(--accent)"
      />
      <text x="0" y={labelY} fill="var(--dim)" fontSize="9" fontFamily="var(--font-mono)">
        7d ago
      </text>
      <text x={W / 2} y={labelY} textAnchor="middle" fill="var(--dim)" fontSize="9" fontFamily="var(--font-mono)">
        3d
      </text>
      <text x={W} y={labelY} textAnchor="end" fill="var(--dim)" fontSize="9" fontFamily="var(--font-mono)">
        now
      </text>
    </svg>
  );
}

function StatCell({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="s-stat">
      <div className="s-stat-label">
        <span className="s-stat-dot" style={{ background: color }} />
        <span className="s-eyebrow">{label}</span>
      </div>
      <span className="s-stat-value">{value}</span>
    </div>
  );
}

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
      ? item.acceptanceState.replace(/_/g, " ")
      : item.kind === "question"
        ? "awaiting answer"
        : "your move";
  const actionLabel =
    item.kind === "question"
      ? "answer"
      : item.state === "review"
        ? "review"
        : item.acceptanceState === "pending"
          ? "acknowledge"
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
