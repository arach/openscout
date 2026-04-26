import "./ops-agents.css";

import { Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { agentStateLabel, normalizeAgentState } from "../lib/agent-state.ts";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import {
  estimateAdapterCost,
  type AdapterCostEstimate,
  type AdapterTokenBreakdown,
} from "../../../agent-sessions/src/protocol/cost.ts";
import type {
  ActivityItem,
  Agent,
  AgentObservePayload,
  FleetAsk,
  FleetState,
  Route,
  SessionEntry,
} from "../lib/types.ts";

type AgentOpsRow = {
  agent: Agent;
  team: string;
  machine: string;
  model: string | null;
  provider: string | null;
  state: ReturnType<typeof normalizeAgentState>;
  activeFlights: number;
  sessions24h: number;
  throughput: number[];
  avgLatencyMs: number | null;
  usage: AdapterTokenBreakdown;
  cost: AdapterCostEstimate;
  errors: number;
  lastActiveAt: number | null;
};

const DAY_MS = 24 * 60 * 60_000;
const LATENCY_WINDOW_MS = 90 * 60_000;

function basename(path: string | null | undefined): string | null {
  if (!path) return null;
  const cleaned = path.replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

function compactNumber(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatCost(value: number | null): string {
  if (value == null) return "$—";
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

function averageLatencyMs(payload: AgentObservePayload | undefined, now: number): number | null {
  if (!payload) return null;
  const events = payload.data.events
    .filter((event) => event.kind === "message" || event.kind === "tool")
    .filter((event) => now - event.t <= LATENCY_WINDOW_MS)
    .sort((left, right) => left.t - right.t);
  if (events.length < 2) return null;
  const gaps: number[] = [];
  for (let idx = 1; idx < events.length; idx += 1) {
    const gap = events[idx].t - events[idx - 1].t;
    if (gap > 0 && gap < 120_000) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  return Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);
}

function makeThroughput(activity: ActivityItem[], now: number): number[] {
  const buckets = new Array<number>(24).fill(0);
  const start = now - DAY_MS;
  for (const item of activity) {
    if (item.ts < start || item.ts > now) continue;
    const bucket = Math.min(23, Math.max(0, Math.floor(((item.ts - start) / DAY_MS) * buckets.length)));
    buckets[bucket] += 1;
  }
  return buckets;
}

function Sparkline({ values, warn = false }: { values: number[]; warn?: boolean }) {
  const width = 92;
  const height = 22;
  const peak = Math.max(1, ...values);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - (value / peak) * (height - 3) - 1.5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className={`s-ops-agents-spark${warn ? " s-ops-agents-spark--warn" : ""}`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function machineLabel(agent: Agent): string {
  return agent.transport ?? basename(agent.cwd) ?? basename(agent.projectRoot) ?? "local";
}

function teamLabel(agent: Agent): string {
  return agent.project ?? agent.role ?? agent.agentClass ?? "Unassigned";
}

function rowForAgent(
  agent: Agent,
  sessions: SessionEntry[],
  activity: ActivityItem[],
  activeAsks: FleetAsk[],
  observe: Map<string, AgentObservePayload>,
  now: number,
): AgentOpsRow {
  const agentSessions = sessions.filter((session) => session.agentId === agent.id);
  const recentSessions = agentSessions.filter((session) => {
    const lastAt = session.lastMessageAt ?? 0;
    return lastAt > 0 && now - lastAt <= DAY_MS;
  });
  const agentActivity = activity.filter((item) => item.actorName === agent.name || item.conversationId === agent.conversationId);
  const payload = observe.get(agent.id);
  const model = payload?.data.metadata?.session?.model ?? null;
  const provider = payload?.data.metadata?.session?.modelProvider ?? null;
  const cost = estimateAdapterCost({
    adapterType: payload?.data.metadata?.session?.adapterType,
    capturedAt: payload?.updatedAt ?? now,
    model,
    provider,
    usage: payload?.data.metadata?.usage,
  });
  return {
    agent,
    team: teamLabel(agent),
    machine: machineLabel(agent),
    model,
    provider,
    state: normalizeAgentState(agent.state),
    activeFlights: activeAsks.filter((ask) => ask.agentId === agent.id).length,
    sessions24h: recentSessions.length,
    throughput: makeThroughput(agentActivity, now),
    avgLatencyMs: averageLatencyMs(payload, now),
    usage: cost.usage,
    cost,
    errors: activeAsks.filter((ask) => ask.agentId === agent.id && (ask.status === "failed" || ask.status === "needs_attention")).length,
    lastActiveAt: Math.max(
      0,
      ...agentSessions.map((session) => session.lastMessageAt ?? 0),
      ...agentActivity.map((item) => item.ts),
      agent.updatedAt ?? 0,
    ) || null,
  };
}

export function OpsAgentsView({
  navigate,
  agents,
}: {
  navigate: (r: Route) => void;
  agents: Agent[];
}) {
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [observePayloads, setObservePayloads] = useState<AgentObservePayload[]>([]);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const ids = agents.map((agent) => agent.id).join(",");
    const [fleetResult, sessionsResult, activityResult, observeResult] = await Promise.allSettled([
      api<FleetState>("/api/fleet"),
      api<SessionEntry[]>("/api/sessions"),
      api<ActivityItem[]>("/api/activity"),
      ids ? api<AgentObservePayload[]>(`/api/observe/agents?ids=${encodeURIComponent(ids)}`) : Promise.resolve([]),
    ]);

    if (fleetResult.status === "fulfilled") setFleet(fleetResult.value);
    if (sessionsResult.status === "fulfilled") setSessions(sessionsResult.value);
    if (activityResult.status === "fulfilled") setActivity(activityResult.value);
    if (observeResult.status === "fulfilled") setObservePayloads(observeResult.value);
    setNow(Date.now());
  }, [agents]);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerEvents(() => {
    void load();
  });
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const observeByAgent = useMemo(
    () => new Map(observePayloads.map((payload) => [payload.agentId, payload])),
    [observePayloads],
  );

  const rows = useMemo(() => {
    const activeAsks = fleet?.activeAsks ?? [];
    return agents
      .map((agent) => rowForAgent(agent, sessions, activity, activeAsks, observeByAgent, now))
      .sort((left, right) => {
        const stateRank = { working: 0, available: 1, offline: 2 };
        const byState = stateRank[left.state] - stateRank[right.state];
        if (byState !== 0) return byState;
        return (right.lastActiveAt ?? 0) - (left.lastActiveAt ?? 0);
      });
  }, [activity, agents, fleet?.activeAsks, now, observeByAgent, sessions]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      `${row.agent.name} ${row.team} ${row.machine} ${row.agent.handle ?? ""} ${row.agent.harness ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [query, rows]);

  const running = rows.filter((row) => row.state === "working").length;
  const online = rows.filter((row) => row.state !== "offline").length;
  const tokens = rows.reduce((sum, row) => sum + (row.usage.total ?? 0), 0);
  const apiCost = rows.some((row) => row.cost.totalUsd != null)
    ? rows.reduce((sum, row) => sum + (row.cost.totalUsd ?? 0), 0)
    : null;
  const billedCost = rows.some((row) => row.cost.billedTotalUsd != null)
    ? rows.reduce((sum, row) => sum + (row.cost.billedTotalUsd ?? 0), 0)
    : null;
  const avgLatency = (() => {
    const values = rows.map((row) => row.avgLatencyMs).filter((value): value is number => value != null);
    return values.length === 0 ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  })();
  const errored = rows.reduce((sum, row) => sum + row.errors, 0);

  const teams = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.team, (counts.get(row.team) ?? 0) + 1);
    return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6);
  }, [rows]);

  const machines = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.machine, (counts.get(row.machine) ?? 0) + 1);
    return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 7);
  }, [rows]);

  return (
    <div className="s-ops-agents">
      <aside className="s-ops-agents-rail">
        <div className="s-ops-agents-brand">
          <div className="s-ops-agents-mark">sc</div>
          <div>
            <div className="s-ops-agents-brand-name">agentctl</div>
            <div className="s-ops-agents-brand-sub">ops console</div>
          </div>
        </div>
        <div className="s-ops-agents-rail-group">
          <div className="s-ops-agents-rail-heading">Fleet</div>
          <button className="s-ops-agents-rail-row" type="button">Overview <span>{agents.length}</span></button>
          <button className="s-ops-agents-rail-row s-ops-agents-rail-row--active" type="button">Agents <span>{online}</span></button>
          <button className="s-ops-agents-rail-row" type="button">Sessions <span>{sessions.length}</span></button>
          <button className="s-ops-agents-rail-row" type="button">Alerts <span>{errored}</span></button>
        </div>
        <div className="s-ops-agents-rail-group">
          <div className="s-ops-agents-rail-heading">Teams</div>
          {teams.map(([team, count]) => (
            <button className="s-ops-agents-rail-row" type="button" key={team}>
              {team}<span>{count}</span>
            </button>
          ))}
        </div>
        <div className="s-ops-agents-rail-group">
          <div className="s-ops-agents-rail-heading">Machines</div>
          {machines.map(([machine, count]) => (
            <button className="s-ops-agents-rail-row" type="button" key={machine}>
              {machine}<span>{count}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="s-ops-agents-main">
        <div className="s-ops-agents-toolbar">
          <div className="s-ops-agents-breadcrumb">Fleet <span>/</span> Agents</div>
          <div className="s-ops-agents-live">
            <span className="s-ops-agents-live-dot" />
            {online} active
          </div>
          <div className="s-ops-agents-search">
            <Search size={13} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents, teams, machines..." />
          </div>
          <button className="s-ops-agents-icon-btn" type="button" title="Filters">
            <SlidersHorizontal size={14} />
          </button>
        </div>

        <section className="s-ops-agents-hero">
          <div>
            <div className="s-ops-agents-kicker">Agents</div>
            <h1>All agents</h1>
            <p>Every registered agent across the local fleet, sorted by live status.</p>
          </div>
        </section>

        <section className="s-ops-agents-stats">
          <Metric label="Running" value={String(running)} sub={`of ${agents.length} total`} />
          <Metric label="Tokens" value={compactNumber(tokens || null)} sub={apiCost == null ? "usage metadata pending" : `${formatCost(apiCost)} API equiv`} />
          <Metric label="Avg latency" value={formatLatency(avgLatency)} sub="recent observe events" />
          <Metric label="Billed" value={formatCost(billedCost)} sub="subscription usage can mark this down" />
        </section>

        <section className="s-ops-agents-table-panel">
          <div className="s-ops-agents-table-title">Agents <span>{filteredRows.length}</span></div>
          <div className="s-ops-agents-table-wrap">
            <table className="s-ops-agents-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Team</th>
                  <th>Machine</th>
                  <th>Active</th>
                  <th>24h sessions</th>
                  <th>Throughput</th>
                  <th>Avg latency</th>
                  <th>Input</th>
                  <th>Cache read</th>
                  <th>Cache write</th>
                  <th>Output</th>
                  <th>API equiv</th>
                  <th>Billed</th>
                  <th>Errors</th>
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.agent.id} onClick={() => navigate({ view: "agents", agentId: row.agent.id })}>
                    <td>
                      <div className="s-ops-agents-agent-cell">
                        <span className={`s-ops-agents-status s-ops-agents-status--${row.state}`} />
                        <span>
                          <strong>{row.agent.name}</strong>
                          <small>{agentStateLabel(row.agent.state)}</small>
                        </span>
                      </div>
                    </td>
                    <td>{row.team}</td>
                    <td>{row.machine}</td>
                    <td className="s-ops-agents-num">{row.activeFlights}</td>
                    <td className="s-ops-agents-num">{row.sessions24h}</td>
                    <td><Sparkline values={row.throughput} warn={row.errors > 0} /></td>
                    <td className="s-ops-agents-num">{formatLatency(row.avgLatencyMs)}</td>
                    <td className="s-ops-agents-num">{compactNumber(row.usage.uncachedInput ?? row.usage.input)}</td>
                    <td className="s-ops-agents-num">{compactNumber(row.usage.cachedInput)}</td>
                    <td className="s-ops-agents-num">{compactNumber(row.usage.cacheWrite)}</td>
                    <td className="s-ops-agents-num">{compactNumber(row.usage.output)}</td>
                    <td className={`s-ops-agents-num${row.cost.rateCardSource === "unknown" ? " s-ops-agents-num--dim" : ""}`}>
                      {formatCost(row.cost.totalUsd)}
                    </td>
                    <td className={`s-ops-agents-num${row.cost.billingMode === "subscription" ? " s-ops-agents-num--covered" : ""}`}>
                      {formatCost(row.cost.billedTotalUsd)}
                    </td>
                    <td className={`s-ops-agents-num${row.errors > 0 ? " s-ops-agents-num--warn" : ""}`}>{row.errors}</td>
                    <td className="s-ops-agents-last">{row.lastActiveAt ? timeAgo(row.lastActiveAt) : "—"}</td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={15} className="s-ops-agents-empty">No agents match the current search.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "warn";
}) {
  return (
    <div className={`s-ops-agents-metric s-ops-agents-metric--${tone}`}>
      <div className="s-ops-agents-metric-label">{label}</div>
      <div className="s-ops-agents-metric-value">{value}</div>
      <div className="s-ops-agents-metric-sub">{sub}</div>
    </div>
  );
}
