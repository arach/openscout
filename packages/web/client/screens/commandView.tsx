import "./command-view.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { agentStateLabel, normalizeAgentState } from "../lib/agent-state.ts";
import { api } from "../lib/api.ts";
import { actorColor } from "../lib/colors.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import type {
  Agent,
  FleetActivity,
  FleetAsk,
  FleetAttentionItem,
  FleetState,
  Route,
} from "../lib/types.ts";

type WindowOption = { label: string; value: number };

const WINDOWS: WindowOption[] = [
  { label: "30m", value: 30 * 60_000 },
  { label: "6h", value: 6 * 60 * 60_000 },
  { label: "24h", value: 24 * 60 * 60_000 },
];
const DEFAULT_WINDOW_MS = WINDOWS[1].value;

function formatAge(timestamp: number | null | undefined, nowMs: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function summarize(text: string | null | undefined, max = 140): string {
  const compact = (text ?? "").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function activityVerb(kind: string): string {
  const map: Record<string, string> = {
    handoff_sent: "handed off",
    handoff_received: "received handoff",
    flight_updated: "replied",
    ask_sent: "asked",
    ask_replied: "answered",
    message_sent: "said",
    message_received: "received",
  };
  return map[kind] ?? kind.replace(/[._]/g, " ");
}

function askRoute(ask: FleetAsk): Route | null {
  if (ask.conversationId) return { view: "conversation", conversationId: ask.conversationId };
  if (ask.collaborationRecordId) return { view: "work", workId: ask.collaborationRecordId };
  return { view: "agents", agentId: ask.agentId };
}

function attentionRoute(item: FleetAttentionItem): Route | null {
  if (item.kind === "question" && item.conversationId) {
    return { view: "conversation", conversationId: item.conversationId };
  }
  if (item.recordId) return { view: "work", workId: item.recordId };
  if (item.conversationId) return { view: "conversation", conversationId: item.conversationId };
  if (item.agentId) return { view: "agents", agentId: item.agentId };
  return null;
}

function activityRoute(item: FleetActivity): Route | null {
  if (item.conversationId) return { view: "conversation", conversationId: item.conversationId };
  if (item.recordId) return { view: "work", workId: item.recordId };
  if (item.agentId) return { view: "agents", agentId: item.agentId };
  return null;
}

export function CommandView({
  navigate,
  agents,
}: {
  navigate: (r: Route) => void;
  agents: Agent[];
}) {
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [windowMs, setWindowMs] = useState<number>(DEFAULT_WINDOW_MS);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<FleetState>("/api/fleet");
      setFleet(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setNowMs(Date.now());
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(() => { void load(); });

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const sinceMs = nowMs - windowMs;

  const awaiting = useMemo<FleetAttentionItem[]>(() => {
    const items = fleet?.needsAttention ?? [];
    return items
      .filter((it) => it.updatedAt >= sinceMs)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [fleet?.needsAttention, sinceMs]);

  const inFlight = useMemo<FleetAsk[]>(() => {
    const items = fleet?.activeAsks ?? [];
    return items
      .filter((ask) => ask.updatedAt >= sinceMs)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [fleet?.activeAsks, sinceMs]);

  const justFinished = useMemo<FleetAsk[]>(() => {
    const items = fleet?.recentCompleted ?? [];
    return items
      .filter((ask) => (ask.completedAt ?? ask.updatedAt) >= sinceMs)
      .sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt));
  }, [fleet?.recentCompleted, sinceMs]);

  const activityInWindow = useMemo<FleetActivity[]>(() => {
    const items = fleet?.activity ?? [];
    return items.filter((item) => item.ts >= sinceMs);
  }, [fleet?.activity, sinceMs]);

  const onlineCount = useMemo(
    () => agents.filter((a) => normalizeAgentState(a.state) !== "offline").length,
    [agents],
  );

  const fleetPulse = useMemo(() => {
    return [...agents].sort((a, b) => {
      const aOn = normalizeAgentState(a.state) !== "offline" ? 0 : 1;
      const bOn = normalizeAgentState(b.state) !== "offline" ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
  }, [agents]);

  const freshness = fleet ? formatAge(fleet.generatedAt, nowMs) : "—";

  return (
    <div className="s-mc">
      <header className="s-mc-header">
        <div className="s-mc-headline">
          <div className="s-mc-eyebrow">Mission Control</div>
          <div className="s-mc-clock">
            <span>{formatClock(nowMs)}</span>
            <span className="s-mc-sep">·</span>
            <span>data {freshness} old</span>
            {error && <span className="s-mc-error"> · {error}</span>}
          </div>
        </div>
        <WindowPicker value={windowMs} onChange={setWindowMs} />
        <div className="s-mc-kpis">
          <Kpi label="Online" value={`${onlineCount}/${agents.length}`} tone="info" />
          <Kpi label="Awaiting" value={String(awaiting.length)} tone={awaiting.length > 0 ? "hot" : "info"} />
          <Kpi label="In flight" value={String(inFlight.length)} tone={inFlight.length > 0 ? "active" : "info"} />
          <Kpi label="Done" value={String(justFinished.length)} tone="info" />
          <Kpi label="Events" value={String(activityInWindow.length)} tone="info" />
        </div>
      </header>

      <div className="s-mc-body">
        <main className="s-mc-main">
          <Section title="Awaiting you" count={awaiting.length} empty="All clear — nothing waiting on you.">
            {awaiting.map((item) => (
              <AwaitingRow
                key={item.recordId}
                item={item}
                nowMs={nowMs}
                onOpen={() => {
                  const route = attentionRoute(item);
                  if (route) navigate(route);
                }}
              />
            ))}
          </Section>

          <Section title="In flight" count={inFlight.length} empty={`No active asks in the last ${formatWindow(windowMs)}.`}>
            {inFlight.map((ask) => (
              <AskRow
                key={ask.invocationId}
                ask={ask}
                nowMs={nowMs}
                lane="active"
                onOpen={() => {
                  const route = askRoute(ask);
                  if (route) navigate(route);
                }}
              />
            ))}
          </Section>

          <Section title="Just finished" count={justFinished.length} empty={`No completed asks in the last ${formatWindow(windowMs)}.`}>
            {justFinished.map((ask) => (
              <AskRow
                key={ask.invocationId}
                ask={ask}
                nowMs={nowMs}
                lane="done"
                onOpen={() => {
                  const route = askRoute(ask);
                  if (route) navigate(route);
                }}
              />
            ))}
          </Section>
        </main>

        <aside className="s-mc-side">
          <Section title="Fleet pulse" count={agents.length} dense>
            <div className="s-mc-fleet">
              {fleetPulse.map((agent) => (
                <FleetRow
                  key={agent.id}
                  agent={agent}
                  nowMs={nowMs}
                  onOpen={() => navigate({ view: "agents", agentId: agent.id })}
                />
              ))}
              {fleetPulse.length === 0 && (
                <div className="s-mc-empty">No agents registered.</div>
              )}
            </div>
          </Section>

          <Section title="Live activity" count={activityInWindow.length} dense>
            <div className="s-mc-stream">
              {activityInWindow.length === 0 ? (
                <div className="s-mc-empty">Quiet — no activity in the last {formatWindow(windowMs)}.</div>
              ) : (
                activityInWindow.slice(0, 30).map((item) => (
                  <ActivityRow
                    key={item.id}
                    item={item}
                    nowMs={nowMs}
                    onOpen={() => {
                      const route = activityRoute(item);
                      if (route) navigate(route);
                    }}
                  />
                ))
              )}
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}

function formatWindow(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function WindowPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="s-mc-window" role="group" aria-label="Lookback window">
      <span className="s-mc-window-label">Lookback</span>
      <div className="s-mc-window-tabs">
        {WINDOWS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`s-mc-window-tab${opt.value === value ? " is-active" : ""}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "info" | "active" | "hot";
}) {
  return (
    <div className={`s-mc-kpi s-mc-kpi--${tone}`}>
      <div className="s-mc-kpi-value">{value}</div>
      <div className="s-mc-kpi-label">{label}</div>
    </div>
  );
}

function Section({
  title,
  count,
  empty,
  dense = false,
  children,
}: {
  title: string;
  count: number;
  empty?: string;
  dense?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`s-mc-section${dense ? " s-mc-section--dense" : ""}`}>
      <div className="s-mc-section-head">
        <div className="s-mc-section-title">{title}</div>
        <div className="s-mc-section-count">{count}</div>
      </div>
      {count === 0 && empty ? (
        <div className="s-mc-empty">{empty}</div>
      ) : (
        <div className="s-mc-section-body">{children}</div>
      )}
    </section>
  );
}

function AwaitingRow({
  item,
  nowMs,
  onOpen,
}: {
  item: FleetAttentionItem;
  nowMs: number;
  onOpen: () => void;
}) {
  const isQuestion = item.kind === "question";
  const pill = isQuestion ? "Question" : "Needs review";
  const summary = summarize(item.summary, 160);

  return (
    <button type="button" className="s-mc-row s-mc-row--awaiting" onClick={onOpen}>
      <div className="s-mc-row-left">
        <span className={`s-mc-pill s-mc-pill--${isQuestion ? "hot" : "warn"}`}>{pill}</span>
        <span className="s-mc-row-actor">{item.agentName ?? "—"}</span>
      </div>
      <div className="s-mc-row-main">
        <div className="s-mc-row-title">{item.title || "Unresolved"}</div>
        {summary && <div className="s-mc-row-summary">{summary}</div>}
      </div>
      <div className="s-mc-row-right">
        <span className="s-mc-row-age">{formatAge(item.updatedAt, nowMs)}</span>
      </div>
    </button>
  );
}

function AskRow({
  ask,
  nowMs,
  lane,
  onOpen,
}: {
  ask: FleetAsk;
  nowMs: number;
  lane: "active" | "done";
  onOpen: () => void;
}) {
  const summary = summarize(ask.summary ?? ask.task, 160);
  const ageStamp = lane === "done" ? (ask.completedAt ?? ask.updatedAt) : ask.updatedAt;
  const isFailed = ask.status === "failed";
  const tone = isFailed ? "hot" : lane === "active" ? "active" : "ok";
  const glyph = isFailed ? "⚠" : lane === "active" ? "•" : "✓";

  return (
    <button type="button" className="s-mc-row" onClick={onOpen}>
      <div className="s-mc-row-left">
        <span className="s-mc-row-actor">{ask.agentName ?? ask.agentId}</span>
      </div>
      <div className="s-mc-row-main">
        <div className="s-mc-row-title">{ask.task || "(no task text)"}</div>
        {summary && summary !== ask.task && <div className="s-mc-row-summary">{summary}</div>}
      </div>
      <div className="s-mc-row-right">
        <span
          className={`s-mc-row-glyph s-mc-row-glyph--${tone}`}
          aria-label={ask.statusLabel}
          title={ask.statusLabel}
        >
          {glyph}
        </span>
        <span className="s-mc-row-age">{formatAge(ageStamp, nowMs)}</span>
      </div>
    </button>
  );
}

function FleetRow({
  agent,
  nowMs,
  onOpen,
}: {
  agent: Agent;
  nowMs: number;
  onOpen: () => void;
}) {
  const state = normalizeAgentState(agent.state);
  const dotClass = `s-mc-dot s-mc-dot--${state}`;
  return (
    <button type="button" className="s-mc-fleet-row" onClick={onOpen}>
      <span className={dotClass} aria-hidden="true" />
      <span className="s-mc-fleet-name">{agent.name}</span>
      <span className="s-mc-fleet-meta">{agent.project ?? agent.role ?? agent.agentClass ?? ""}</span>
      <span className="s-mc-fleet-age">
        {state === "offline" ? "offline" : agentStateLabel(agent.state)}
        {agent.updatedAt ? ` · ${formatAge(agent.updatedAt, nowMs)}` : ""}
      </span>
    </button>
  );
}

function ActivityRow({
  item,
  nowMs,
  onOpen,
}: {
  item: FleetActivity;
  nowMs: number;
  onOpen: () => void;
}) {
  const actor = item.actorName ?? "—";
  const verb = activityVerb(item.kind);
  const text = summarize(item.title ?? item.summary, 110);
  return (
    <button type="button" className="s-mc-stream-row" onClick={onOpen}>
      <span className="s-mc-stream-time">{formatAge(item.ts, nowMs)}</span>
      <span className="s-mc-stream-actor" style={{ color: actorColor(actor) }}>{actor}</span>
      <span className="s-mc-stream-verb">{verb}</span>
      <span className="s-mc-stream-text">{text}</span>
    </button>
  );
}
