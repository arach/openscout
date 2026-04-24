import "./warroom-view.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { actorColor } from "../lib/colors.ts";
import { normalizeAgentState } from "../lib/agent-state.ts";
import type {
  ActivityItem,
  Agent,
  FleetAsk,
  FleetAttentionItem,
  FleetState,
  Route,
  SessionEntry,
} from "../lib/types.ts";

type ToolStreamItem = {
  key: string;
  agent: string;
  tool: string;
  result: string;
  route: Route | null;
};

function formatHMS(totalSec: number): string {
  const h = Math.floor(totalSec / 3600).toString().padStart(2, "0");
  const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function kindLabel(kind: string): string {
  return kind.replace(/[._]/g, " ");
}

function summarize(text: string | null | undefined, max = 56): string {
  const compact = (text ?? "").replace(/\s+/g, " ").trim();
  if (!compact) return "live event";
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function routeForAttention(item: FleetAttentionItem): Route | null {
  if (item.recordId) return { view: "work", workId: item.recordId };
  if (item.conversationId) return { view: "conversation", conversationId: item.conversationId };
  if (item.agentId) return { view: "agents", agentId: item.agentId };
  return null;
}

function routeForAsk(ask: FleetAsk): Route | null {
  if (ask.conversationId) return { view: "conversation", conversationId: ask.conversationId };
  if (ask.collaborationRecordId) return { view: "work", workId: ask.collaborationRecordId };
  return { view: "agents", agentId: ask.agentId };
}

function routeForActivity(item: ActivityItem): Route | null {
  if (item.conversationId) return { view: "conversation", conversationId: item.conversationId };
  return null;
}

function histogram(activity: ActivityItem[], nowMs: number, buckets = 60): { normalized: number[]; raw: number[] } {
  const raw = new Array<number>(buckets).fill(0);
  const windowMs = 60 * 60_000;
  const start = nowMs - windowMs;
  for (const item of activity) {
    if (item.ts < start || item.ts > nowMs) continue;
    const offset = item.ts - start;
    const idx = Math.min(
      buckets - 1,
      Math.max(0, Math.floor((offset / windowMs) * buckets)),
    );
    raw[idx] += 1;
  }
  const peak = Math.max(1, ...raw);
  return {
    raw,
    normalized: raw.map((value) => value / peak),
  };
}

export function WarRoomView({
  navigate,
  agents,
}: {
  navigate: (r: Route) => void;
  agents: Agent[];
}) {
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [fleetResult, activityResult, sessionsResult] = await Promise.allSettled([
      api<FleetState>("/api/fleet"),
      api<ActivityItem[]>("/api/activity"),
      api<SessionEntry[]>("/api/sessions"),
    ]);

    if (fleetResult.status === "fulfilled") {
      setFleet(fleetResult.value);
    }
    if (activityResult.status === "fulfilled") {
      setActivity(activityResult.value);
    }
    if (sessionsResult.status === "fulfilled") {
      setSessions(sessionsResult.value);
    }
    setNowMs(Date.now());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerEvents(() => {
    void load();
  });

  useEffect(() => {
    const intervalId = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  const onlineCount = agents.filter((agent) => normalizeAgentState(agent.state) !== "offline").length;
  const needsAttention = fleet?.needsAttention ?? [];
  const activeAsks = fleet?.activeAsks ?? [];
  const threadCount = sessions.length > 0
    ? sessions.length
    : new Set(activity.map((item) => item.conversationId).filter((value): value is string => Boolean(value))).size;

  const unresolvedTimestamps = [
    ...needsAttention.map((item) => item.updatedAt),
    ...activeAsks.map((ask) => ask.updatedAt),
  ].filter((value) => typeof value === "number" && Number.isFinite(value));
  const oldestUnresolvedAt = unresolvedTimestamps.length > 0
    ? Math.min(...unresolvedTimestamps)
    : null;
  const breachSec = oldestUnresolvedAt
    ? Math.max(0, Math.floor((nowMs - oldestUnresolvedAt) / 1000))
    : 0;

  const activityWindow = useMemo(() => histogram(activity, nowMs), [activity, nowMs]);
  const eventsLastHour = activityWindow.raw.reduce((sum, value) => sum + value, 0);
  const activityPeak = Math.max(0, ...activityWindow.raw);
  const activityNow = activityWindow.raw[activityWindow.raw.length - 1] ?? 0;

  const toolTicker = useMemo<ToolStreamItem[]>(
    () =>
      activity.slice(0, 8).map((item) => ({
        key: item.id,
        agent: item.actorName ?? "system",
        tool: kindLabel(item.kind),
        result: summarize(item.title ?? item.summary),
        route: routeForActivity(item),
      })),
    [activity],
  );

  const blockerRows = useMemo(() => {
    const rows: Array<{ key: string; label: string; route: Route | null; tone: "high" | "med" }> = [];
    for (const item of needsAttention) {
      rows.push({
        key: item.recordId,
        label: item.title || "Unresolved item",
        route: routeForAttention(item),
        tone: item.kind === "question" ? "high" : "med",
      });
    }
    for (const ask of activeAsks) {
      if (ask.status === "failed" || ask.status === "needs_attention") {
        rows.push({
          key: ask.invocationId,
          label: ask.summary ?? ask.task,
          route: routeForAsk(ask),
          tone: ask.status === "failed" ? "high" : "med",
        });
      }
    }
    return rows.slice(0, 6);
  }, [activeAsks, needsAttention]);

  const awaitingRows = needsAttention.length > 0 ? needsAttention : [];
  const fallbackAsks = awaitingRows.length === 0 ? activeAsks.slice(0, 3) : [];

  return (
    <div className="s-warroom">
      <div className="s-warroom-topstrip">
        <div className="s-warroom-topstrip-left">
          <span className="s-ops-label">▸ War Room</span>
        </div>
        <div className="s-warroom-topstrip-center">
          OPERATIONS · {new Date(nowMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </div>
        <div className="s-warroom-topstrip-right">
          <Telemetry label="Agents" value={`${onlineCount}/${agents.length}`} />
          <Telemetry label="Threads" value={String(threadCount)} />
          <Telemetry label="Attention" value={String(needsAttention.length)} warn={needsAttention.length > 0} />
          <Telemetry label="Events/h" value={String(eventsLastHour)} />
        </div>
      </div>

      <div className="s-warroom-grid">
        <div className="s-warroom-panel">
          <div className="s-ops-label" style={{ marginBottom: 12 }}>◌ Asks · Awaiting</div>
          <div className="s-warroom-breach">
            <div className="s-warroom-breach-clock">{formatHMS(breachSec)}</div>
            <div className="s-warroom-breach-sub">
              Oldest unresolved · {needsAttention[0]?.agentName ?? activeAsks[0]?.agentName ?? "clear"}
            </div>
          </div>

          {awaitingRows.length > 0 ? (
            awaitingRows.slice(0, 3).map((item) => {
              const route = routeForAttention(item);
              return (
                <button
                  key={item.recordId}
                  type="button"
                  className="s-warroom-ask-card"
                  style={{ textAlign: "left", cursor: route ? "pointer" : "default" }}
                  onClick={route ? () => navigate(route) : undefined}
                >
                  <div className="s-warroom-ask-header">
                    <div
                      className="s-ops-avatar"
                      style={{ "--size": "18px", background: actorColor(item.agentName ?? "?") } as React.CSSProperties}
                    >
                      {(item.agentName ?? "?")[0]?.toUpperCase()}
                    </div>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
                      {item.agentName ?? "unknown"}
                    </span>
                  </div>
                  <div className="s-warroom-ask-body">
                    {summarize(item.title ?? item.summary, 110)}
                  </div>
                </button>
              );
            })
          ) : fallbackAsks.length > 0 ? (
            fallbackAsks.map((ask) => {
              const route = routeForAsk(ask);
              return (
                <button
                  key={ask.invocationId}
                  type="button"
                  className="s-warroom-ask-card"
                  style={{ textAlign: "left", cursor: route ? "pointer" : "default" }}
                  onClick={route ? () => navigate(route) : undefined}
                >
                  <div className="s-warroom-ask-header">
                    <div
                      className="s-ops-avatar"
                      style={{ "--size": "18px", background: actorColor(ask.agentName ?? ask.agentId) } as React.CSSProperties}
                    >
                      {(ask.agentName ?? ask.agentId)[0]?.toUpperCase()}
                    </div>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
                      {ask.agentName ?? ask.agentId}
                    </span>
                  </div>
                  <div className="s-warroom-ask-body">
                    {summarize(ask.summary ?? ask.task, 110)}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="s-warroom-ask-card" style={{ color: "var(--dim)" }}>
              No unresolved asks right now.
            </div>
          )}

          <div className="s-ops-label" style={{ marginTop: 16 }}>○ Blockers</div>
          <div className="s-warroom-blockers">
            {blockerRows.length === 0 ? (
              <div style={{ color: "var(--dim)" }}>No blockers</div>
            ) : (
              blockerRows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  className={row.tone === "high" ? "s-warroom-blockers-item--high" : "s-warroom-blockers-item--med"}
                  style={{ textAlign: "left", cursor: row.route ? "pointer" : "default" }}
                  onClick={row.route ? () => navigate(row.route!) : undefined}
                >
                  {row.tone === "high" ? "▲" : "•"} {row.label}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="s-warroom-panel s-warroom-mesh">
          <div className="s-warroom-mesh-label">
            <span className="s-ops-label">◉ Mesh · Live</span>
          </div>
          <WarMesh agents={agents} />
        </div>

        <div className="s-warroom-panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="s-ops-label">›_ Live stream</div>
          <ToolStream items={toolTicker} navigate={navigate} />
          <div className="s-ops-label">Fleet load</div>
          <div className="s-warroom-burn-grid">
            <BurnTile num={String(eventsLastHour)} label="events/h" />
            <BurnTile num={String(activeAsks.length)} label="active asks" />
            <BurnTile num={String(needsAttention.length)} label="waiting" />
            <BurnTile num={String(onlineCount)} label="online" />
          </div>
        </div>

        <div className="s-warroom-waveform-panel">
          <div className="s-warroom-waveform-header">
            <span className="s-ops-label">⌇ Fleet activity · Last 60m</span>
            <span className="s-warroom-waveform-meta">events/min · live</span>
            <span style={{ flex: 1 }} />
            <span className="s-warroom-waveform-meta">peak {activityPeak} · now {activityNow}</span>
          </div>
          <Waveform values={activityWindow.normalized} />
        </div>
      </div>
    </div>
  );
}

function Telemetry({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="s-warroom-telemetry">
      <div className="s-warroom-telemetry-label">{label}</div>
      <div className={`s-warroom-telemetry-value${warn ? " s-warroom-telemetry-value--warn" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function ToolStream({
  items,
  navigate,
}: {
  items: ToolStreamItem[];
  navigate: (route: Route) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="s-warroom-ticker">
        <div className="s-warroom-ticker-line" style={{ opacity: 0.5 }}>
          <span className="s-warroom-ticker-agent">system</span>
          <span className="s-warroom-ticker-sep">›</span>
          <span className="s-warroom-ticker-tool">waiting</span>
          <span className="s-warroom-ticker-result">no recent fleet activity</span>
        </div>
      </div>
    );
  }

  return (
    <div className="s-warroom-ticker">
      {items.map((item, index) => (
        <button
          key={item.key}
          type="button"
          className="s-warroom-ticker-line"
          style={{ opacity: 1 - index * 0.06, textAlign: "left", cursor: item.route ? "pointer" : "default" }}
          onClick={item.route ? () => navigate(item.route!) : undefined}
        >
          <span className="s-warroom-ticker-agent">{item.agent}</span>
          <span className="s-warroom-ticker-sep">›</span>
          <span className="s-warroom-ticker-tool">{item.tool}</span>
          <span className="s-warroom-ticker-result">{item.result}</span>
        </button>
      ))}
    </div>
  );
}

function BurnTile({ num, label }: { num: string; label: string }) {
  return (
    <div className="s-warroom-burn-tile">
      <div className="s-warroom-burn-num">{num}</div>
      <div className="s-warroom-burn-label">{label}</div>
    </div>
  );
}

function WarMesh({ agents }: { agents: Agent[] }) {
  const W = 800;
  const H = 480;

  const positions = useMemo(() => {
    if (agents.length === 0) return {};
    const cx = 0.5;
    const cy = 0.5;
    const r = 0.3;
    const map: Record<string, { x: number; y: number }> = {};
    agents.forEach((agent, index) => {
      const angle = (index / agents.length) * Math.PI * 2 - Math.PI / 2;
      map[agent.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
    return map;
  }, [agents]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%" }}>
      <defs>
        <pattern id="warGrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.4" />
        </pattern>
        <radialGradient id="warGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.1" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#warGrid)" />
      <circle cx={W / 2} cy={H / 2} r={200} fill="url(#warGlow)" />

      {agents.flatMap((agent, index) =>
        agents.slice(index + 1).map((other) => {
          const from = positions[agent.id];
          const to = positions[other.id];
          if (!from || !to) return null;
          return (
            <line
              key={`${agent.id}-${other.id}`}
              x1={from.x * W}
              y1={from.y * H}
              x2={to.x * W}
              y2={to.y * H}
              stroke="var(--dim)"
              strokeWidth="0.8"
              opacity="0.3"
            />
          );
        }),
      )}

      {agents.map((agent) => {
        const point = positions[agent.id];
        if (!point) return null;
        const x = point.x * W;
        const y = point.y * H;
        const color = actorColor(agent.name);
        const isActive = normalizeAgentState(agent.state) === "working";
        return (
          <g key={agent.id} transform={`translate(${x}, ${y})`}>
            {isActive && (
              <circle r="18" fill="none" stroke={color} strokeWidth="1" opacity="0.5">
                <animate attributeName="r" values="18;30;18" dur="2.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="2.5s" repeatCount="indefinite" />
              </circle>
            )}
            <circle r="18" fill={color} stroke="var(--bg)" strokeWidth="2" />
            <text
              textAnchor="middle"
              dy="0.35em"
              fontFamily="var(--font-mono)"
              fontSize="14"
              fontWeight="600"
              fill="rgba(0,0,0,0.7)"
            >
              {agent.name[0]?.toUpperCase()}
            </text>
            <text
              textAnchor="middle"
              y={36}
              fontFamily="var(--font-mono)"
              fontSize="10"
              fill="var(--muted)"
              letterSpacing="0.1em"
            >
              {agent.name.toUpperCase()}
            </text>
            <text
              textAnchor="middle"
              y={48}
              fontFamily="var(--font-mono)"
              fontSize="8.5"
              fill="var(--dim)"
              letterSpacing="0.08em"
            >
              {normalizeAgentState(agent.state).toUpperCase()} · {agent.project ?? "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Waveform({ values }: { values: number[] }) {
  const W = 1000;
  const H = 80;
  const safeValues = values.length > 1 ? values : [0, 0];
  const pts = safeValues
    .map((value, index) => `${(index / (safeValues.length - 1)) * W},${H - value * (H - 8) - 4}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 80, display: "block" }}>
      <defs>
        <linearGradient id="waveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,${H} ${pts} ${W},${H}`} fill="url(#waveFill)" />
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.2" />
    </svg>
  );
}
