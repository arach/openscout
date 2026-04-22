import "./fleet-home.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  FleetState,
  Route,
  SessionEntry,
} from "../lib/types.ts";

function greetingFor(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function operatorName(): string {
  return "operator";
}

export function HomeScreen({
  navigate,
}: {
  navigate: (r: Route) => void;
}) {
  const { agents, messages, onlineCount } = useScout();
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const [activityResult, sessionsResult, fleetResult] =
      await Promise.allSettled([
        api<ActivityItem[]>("/api/activity"),
        api<SessionEntry[]>("/api/sessions"),
        api<FleetState>("/api/fleet"),
      ]);
    if (activityResult.status === "fulfilled")
      setActivity(activityResult.value);
    if (sessionsResult.status === "fulfilled")
      setSessions(
        [...sessionsResult.value].sort(
          (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0),
        ),
      );
    if (fleetResult.status === "fulfilled") setFleet(fleetResult.value);
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void load();
    }, 250);
  }, [load]);

  useEffect(() => {
    void load();
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [load]);
  useBrokerEvents(scheduleRefresh);

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
  const done = useMemo(
    () => agents.filter((a) => normalizeAgentState(a.state) === "offline"),
    [agents],
  );

  const pendingAsks = useMemo(
    () =>
      (fleet?.activeAsks ?? []).filter(
        (a) => a.status === "needs_attention" || a.status === "queued",
      ),
    [fleet],
  );
  const answeredAsks = useMemo(
    () => (fleet?.recentCompleted ?? []).slice(0, 3),
    [fleet],
  );

  const activityPreview = useMemo(() => activity.slice(0, 8), [activity]);
  const now = new Date();
  const greeting = greetingFor(now.getHours());
  const opsEnabled = isOpsEnabled();

  const heartrate = useMemo(() => {
    const N = 96;
    return Array.from({ length: N }, (_, i) => {
      const t = i / N;
      const base = 0.4 + 0.35 * Math.sin(t * 9 + 1.3) * Math.cos(t * 2.1);
      const spike = i > 55 && i < 62 ? 0.3 : 0;
      return Math.max(
        0.05,
        Math.min(1, base + spike + (Math.random() - 0.5) * 0.06),
      );
    });
  }, []);

  const narrativeParts = useMemo(() => {
    const parts: string[] = [];
    if (active.length > 0)
      parts.push(`${active.length} agent${active.length === 1 ? " is" : "s are"} working now`);
    if (pendingAsks.length > 0)
      parts.push(`${pendingAsks.length} thing${pendingAsks.length === 1 ? "" : "s"} need${pendingAsks.length === 1 ? "s" : ""} you`);
    if (answeredAsks.length > 0)
      parts.push(`${answeredAsks.length} ask${answeredAsks.length === 1 ? " was" : "s were"} resolved recently`);
    if (parts.length === 0 && agents.length > 0)
      parts.push(`${agents.length} agent${agents.length === 1 ? " is" : "s are"} registered`);
    if (parts.length === 0)
      parts.push("no agents are connected yet");
    return parts;
  }, [active, pendingAsks, answeredAsks, agents]);

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
            </div>
            <h1 className="s-hero-greeting">
              {greeting}, <em>{operatorName()}.</em>
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
              {pendingAsks.length > 0 && (
                <button
                  className="s-btn-fleet s-btn-fleet--primary"
                  onClick={() => navigate({ view: "fleet" })}
                >
                  Answer asks · {pendingAsks.length}
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
            </div>
          </div>

          <div className="s-heartrate-card">
            <div className="s-heartrate-header">
              <span className="s-eyebrow">Fleet heart-rate</span>
              <span style={{ flex: 1 }} />
              <span className="s-heartrate-live">● live · 30m</span>
            </div>
            <HeartrateGraph data={heartrate} />
            <div className="s-heartrate-stats">
              <StatCell label="Active" value={active.length} color="var(--green)" />
              <StatCell label="Waiting" value={waiting.length} color="var(--amber)" />
              <StatCell label="Done" value={done.length} color="var(--dim)" />
            </div>
          </div>
        </div>

        {/* ── Needs you ──────────────────────────────────────────── */}
        <div className="s-fleet-section">
          <SectionRule
            label={`Needs you · ${pendingAsks.length}`}
            right={
              pendingAsks.length > 0 ? (
                <span style={{ color: "var(--amber)" }}>
                  oldest{" "}
                  {timeAgo(
                    Math.min(...pendingAsks.map((a) => a.updatedAt)),
                  )}
                </span>
              ) : (
                "clear"
              )
            }
          />
          <div className="s-ask-grid">
            {pendingAsks.slice(0, 4).map((ask) => (
              <AskBlock
                key={ask.invocationId}
                ask={ask}
                agents={agents}
                navigate={navigate}
                pending
              />
            ))}
            {answeredAsks.slice(0, Math.max(0, 2 - pendingAsks.length)).map((ask) => (
              <AskBlock
                key={ask.invocationId}
                ask={ask}
                agents={agents}
                navigate={navigate}
                pending={false}
              />
            ))}
            {pendingAsks.length < 2 && answeredAsks.length === 0 && (
              <div className="s-ask-empty">
                <span className="s-eyebrow">No more asks</span>
                <span className="s-ask-empty-detail">
                  Fleet is unblocked on you.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── What's moving ──────────────────────────────────────── */}
        {active.length > 0 && (
          <div className="s-fleet-section">
            <SectionRule
              label={`What's moving · ${active.length} active`}
              right={
                <button
                  className="s-link-btn"
                  onClick={() => navigate({ view: "mesh" })}
                >
                  open mesh ↗
                </button>
              }
            />
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
                  navigate={navigate}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Since you were away ────────────────────────────────── */}
        {activityPreview.length > 0 && (
          <div className="s-fleet-section">
            <SectionRule
              label="Since you were away"
              right={`last hour · ${activityPreview.length} events`}
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

function HeartrateGraph({ data }: { data: number[] }) {
  const W = 372;
  const H = 56;
  const N = data.length;
  const stepX = W / (N - 1);
  const path = data
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(1)} ${((1 - v) * H).toFixed(1)}`,
    )
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: H, display: "block" }}
    >
      <defs>
        <linearGradient id="hrFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line
        x1="0"
        y1={H - 0.5}
        x2={W}
        y2={H - 0.5}
        stroke="var(--border)"
      />
      <path d={`${path} L ${W} ${H} L 0 ${H} Z`} fill="url(#hrFill)" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.2" />
      <circle
        cx={(N - 1) * stepX}
        cy={(1 - data[N - 1]) * H}
        r="3"
        fill="var(--accent)"
      />
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

function AskBlock({
  ask,
  agents,
  navigate,
  pending,
}: {
  ask: FleetAsk;
  agents: Agent[];
  navigate: (r: Route) => void;
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
          {pending ? "◌ ASK — AWAITING" : "● ASK — RESOLVED"}
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
            <span style={{ color: "var(--accent)" }}>operator</span>
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

function NowCard({
  agent,
  navigate,
}: {
  agent: Agent;
  navigate: (r: Route) => void;
}) {
  const handle = agent.handle ? `@${agent.handle}` : agent.id;
  const role = agent.role ?? agent.agentClass;
  const branch = agent.branch ?? "main";
  const conversationId = conversationForAgent(agent.id);

  return (
    <div
      className="s-now-card"
      onClick={() =>
        navigate({ view: "agents", agentId: agent.id, conversationId })
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
        {agent.cwd ?? `Working in ${agent.project ?? "workspace"}`}
      </div>

      <div className="s-now-card-ticker">
        <span className="s-now-card-ticker-prompt">›</span>
        <span className="s-now-card-ticker-text">
          {agent.cwd ?? "working…"}
        </span>
        <span className="s-now-card-cursor" />
      </div>

      <div className="s-now-card-progress">
        <div className="s-now-card-progress-fill" style={{ width: "50%" }} />
      </div>
      <div className="s-now-card-footer">
        <span>{agent.updatedAt ? `updated ${timeAgo(agent.updatedAt)}` : "active"}</span>
        <span>{branch}</span>
      </div>
    </div>
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
        const kindLabel = item.kind.split(".").pop() ?? item.kind;
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
