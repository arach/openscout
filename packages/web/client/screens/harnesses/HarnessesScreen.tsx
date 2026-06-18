import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../lib/api.ts";
import { normalizeAgentState, isAgentBusy } from "../../lib/agent-state.ts";
import { filterAgentsByMachineScope } from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import type {
  Agent,
  HarnessTopologyObservation,
  HarnessTopologySnapshot,
  Route,
} from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import type { ServiceGauge } from "../home/HomeHero.tsx";
import { OpsSubnav } from "../ops/OpsSubnav.tsx";
import "./harnesses-screen.css";

type QuotaGauge = Extract<ServiceGauge, { kind: "quota" }>;
type QuotaWindow = NonNullable<QuotaGauge["windows"]>[number];
type BudgetHistoryPoint = NonNullable<QuotaWindow["history"]>[number];

type HarnessRow = {
  id: string;
  label: string;
  agents: Agent[];
  gauge: ServiceGauge | null;
  observations: HarnessTopologyObservation[];
  transports: string[];
  models: string[];
  projects: string[];
  working: number;
  ready: number;
  notReady: number;
  latestSeen: number | null;
};

const KNOWN_HARNESSES = [
  "codex",
  "claude",
  "cursor",
  "native",
  "worker",
  "bridge",
  "http",
  "pi",
  "flue",
] as const;

const HARNESS_LABELS: Record<string, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  native: "Native",
  worker: "Worker",
  bridge: "Bridge",
  http: "HTTP",
  pi: "Pi",
  flue: "Flue",
  github: "GitHub",
  unknown: "Unknown",
};

function canonicalHarnessId(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("claude")) return "claude";
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("cursor")) return "cursor";
  if (normalized.includes("github")) return "github";
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function harnessLabel(id: string): string {
  return HARNESS_LABELS[id] ?? id.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function pathLeaf(path: string | null | undefined): string | null {
  const value = path?.trim();
  if (!value) return null;
  return value.split("/").filter(Boolean).pop() ?? value;
}

function compactList(values: string[], max = 3): string {
  if (values.length === 0) return "-";
  const shown = values.slice(0, max);
  const suffix = values.length > shown.length ? ` +${values.length - shown.length}` : "";
  return `${shown.join(", ")}${suffix}`;
}

function formatLegacyQuotaLabel(label: string): string {
  switch (label) {
    case "weekly":
      return "7d";
    case "req/h":
      return "1h";
    default:
      return label || "quota";
  }
}

function quotaWindows(gauge: QuotaGauge): QuotaWindow[] {
  return gauge.windows && gauge.windows.length > 0
    ? gauge.windows
    : [{
        label: formatLegacyQuotaLabel(gauge.unitLabel),
        fill: gauge.fill,
        usedLabel: gauge.usedLabel,
        capLabel: gauge.capLabel,
        unitLabel: gauge.unitLabel,
        resetAt: gauge.resetAt,
      }];
}

function usageLabel(window: QuotaWindow): string {
  if (window.capLabel === "100%" && window.usedLabel.endsWith("%")) return window.usedLabel;
  return `${window.usedLabel}/${window.capLabel}`;
}

function gaugeTone(fill: number): "ok" | "warn" | "err" {
  if (fill >= 0.9) return "err";
  if (fill >= 0.75) return "warn";
  return "ok";
}

function sampleHistory(points: BudgetHistoryPoint[] | undefined, limit = 30): BudgetHistoryPoint[] {
  const source = points ?? [];
  if (source.length <= limit) return source;
  if (limit <= 1) return [source[source.length - 1]!];
  const step = (source.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => source[Math.round(index * step)]!);
}

function formatResetRelative(resetAt: number): string {
  const diffSec = Math.max(0, Math.floor((resetAt - Date.now()) / 1000));
  if (diffSec >= 86400) {
    const days = Math.floor(diffSec / 86400);
    const hours = Math.floor((diffSec % 86400) / 3600);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (diffSec >= 3600) {
    const hours = Math.floor(diffSec / 3600);
    const minutes = Math.floor((diffSec % 3600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${Math.max(1, Math.floor(diffSec / 60))}m`;
}

function timeAgo(ts: number | null): string {
  if (!ts) return "-";
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function budgetLatestAt(gauge: ServiceGauge | null): number | null {
  if (!gauge || gauge.kind !== "quota") return null;
  return quotaWindows(gauge)
    .flatMap((window) => window.history ?? [])
    .reduce<number | null>((latest, point) => Math.max(latest ?? 0, point.capturedAt), null);
}

function observationHarnessId(observation: HarnessTopologyObservation): string {
  return canonicalHarnessId(observation.source || observation.topology.source);
}

function observationSeenAt(observation: HarnessTopologyObservation): number | null {
  const observedAt = Date.parse(observation.observedAt);
  const fromObserved = Number.isFinite(observedAt) ? observedAt : 0;
  return Math.max(fromObserved, observation.changedAt ?? 0) || null;
}

function sourceLabel(source: string): string {
  if (source.includes("workflow")) return "Claude workflow";
  return harnessLabel(canonicalHarnessId(source));
}

function buildHarnessRows(
  agents: Agent[],
  gauges: ServiceGauge[],
  snapshot: HarnessTopologySnapshot | null,
): HarnessRow[] {
  const ids = new Set<string>(KNOWN_HARNESSES);
  for (const agent of agents) ids.add(canonicalHarnessId(agent.harness));
  for (const gauge of gauges) ids.add(canonicalHarnessId(gauge.id));
  for (const observation of snapshot?.observations ?? []) ids.add(observationHarnessId(observation));

  const gaugesById = new Map(gauges.map((gauge) => [canonicalHarnessId(gauge.id), gauge]));
  const observationsById = new Map<string, HarnessTopologyObservation[]>();
  for (const observation of snapshot?.observations ?? []) {
    const id = observationHarnessId(observation);
    const list = observationsById.get(id) ?? [];
    list.push(observation);
    observationsById.set(id, list);
  }

  return [...ids].map((id): HarnessRow => {
    const rowAgents = agents.filter((agent) => canonicalHarnessId(agent.harness) === id);
    const observations = observationsById.get(id) ?? [];
    const stateCounts = rowAgents.reduce(
      (acc, agent) => {
        acc[normalizeAgentState(agent.state)] += 1;
        return acc;
      },
      { in_turn: 0, in_flight: 0, callable: 0, blocked: 0 },
    );
    const latestAgentAt = rowAgents.reduce<number | null>(
      (latest, agent) => Math.max(latest ?? 0, agent.updatedAt ?? agent.createdAt ?? 0) || latest,
      null,
    );
    const latestObservationAt = observations.reduce<number | null>(
      (latest, observation) => Math.max(latest ?? 0, observationSeenAt(observation) ?? 0) || latest,
      null,
    );
    const gauge = gaugesById.get(id) ?? null;
    const latestBudgetAt = budgetLatestAt(gauge);

    return {
      id,
      label: harnessLabel(id),
      agents: rowAgents,
      gauge,
      observations,
      transports: uniqueValues(rowAgents.map((agent) => agent.transport)),
      models: uniqueValues(rowAgents.map((agent) => agent.model)),
      projects: uniqueValues(rowAgents.map((agent) => pathLeaf(agent.projectRoot) ?? agent.project ?? pathLeaf(agent.cwd))),
      working: stateCounts.in_turn + stateCounts.in_flight,
      ready: stateCounts.callable,
      notReady: stateCounts.blocked,
      latestSeen: Math.max(latestAgentAt ?? 0, latestObservationAt ?? 0, latestBudgetAt ?? 0) || null,
    };
  }).sort((left, right) => {
    const leftRank = left.agents.length > 0 ? 0 : left.gauge ? 1 : left.observations.length > 0 ? 2 : 3;
    const rightRank = right.agents.length > 0 ? 0 : right.gauge ? 1 : right.observations.length > 0 ? 2 : 3;
    return leftRank - rightRank
      || right.working - left.working
      || right.ready - left.ready
      || (right.latestSeen ?? 0) - (left.latestSeen ?? 0)
      || left.label.localeCompare(right.label);
  });
}

function MiniHistory({ points }: { points?: BudgetHistoryPoint[] }) {
  const sampled = sampleHistory(points);
  if (sampled.length === 0) return <span className="hs-history hs-history-empty">live</span>;
  return (
    <span className="hs-history" aria-label={`${sampled.length} budget samples`}>
      {sampled.map((point, index) => {
        const fill = Math.max(0.06, Math.min(1, point.fill));
        return (
          <span
            key={`${point.capturedAt}:${index}`}
            className={`hs-history-bar hs-history-bar--${gaugeTone(point.fill)}`}
            style={{ height: `${Math.round(fill * 100)}%` }}
            title={`${new Date(point.capturedAt).toLocaleString()} ${point.usedLabel}`}
          />
        );
      })}
    </span>
  );
}

function BudgetCell({ gauge }: { gauge: ServiceGauge | null }) {
  if (!gauge) return <span className="hs-muted">-</span>;
  if (gauge.kind === "status") {
    return (
      <div className="hs-budget-status">
        <span>{gauge.windowLabel ?? "usage"}</span>
        <strong>{gauge.statusLabel}</strong>
        <span>{gauge.detailLabel ?? "quota n/a"}</span>
      </div>
    );
  }
  return (
    <div className="hs-budget-windows">
      {quotaWindows(gauge).map((window) => {
        const pct = Math.round(window.fill * 100);
        const tone = gaugeTone(window.fill);
        return (
          <div key={`${gauge.id}:${window.label}`} className="hs-budget-window">
            <div className="hs-budget-window-top">
              <span className="hs-budget-label">{window.label}</span>
              <strong className={`hs-budget-value hs-budget-value--${tone}`}>{usageLabel(window)}</strong>
              <span className="hs-budget-reset">{formatResetRelative(window.resetAt)}</span>
            </div>
            <div className="hs-budget-meter" aria-hidden="true">
              <span className={`hs-budget-meter-fill hs-budget-meter-fill--${tone}`} style={{ width: `${pct}%` }} />
            </div>
            <MiniHistory points={window.history} />
          </div>
        );
      })}
    </div>
  );
}

function HarnessLedger({ rows }: { rows: HarnessRow[] }) {
  return (
    <div className="hs-ledger" role="table" aria-label="Provider ledger">
      <div className="hs-ledger-head" role="row">
        <span>provider</span>
        <span>agents</span>
        <span>runtime</span>
        <span>budget</span>
        <span>topology</span>
        <span>projects</span>
        <span>seen</span>
      </div>
      <div className="hs-ledger-rows">
        {rows.map((row) => {
          const active = row.working + row.ready;
          const topologyTotals = row.observations.reduce(
            (acc, observation) => {
              acc.groups += observation.summary.groups;
              acc.agents += observation.summary.agents;
              acc.tasks += observation.summary.tasks;
              return acc;
            },
            { groups: 0, agents: 0, tasks: 0 },
          );
          return (
            <div key={row.id} className="hs-ledger-row" role="row">
              <div className="hs-harness-cell">
                <span className={`hs-harness-mark${active > 0 ? " hs-harness-mark--live" : ""}`} aria-hidden="true" />
                <span className="hs-harness-main">
                  <strong>{row.label}</strong>
                  <span>{row.gauge ? "budget feed" : row.observations.length > 0 ? "observed" : "catalog"}</span>
                </span>
              </div>
              <div className="hs-agent-cell">
                <strong>{row.agents.length}</strong>
                <span>{row.working} working / {row.ready} ready</span>
              </div>
              <div className="hs-runtime-cell">
                <span title={row.transports.join(", ")}>{compactList(row.transports)}</span>
                <span title={row.models.join(", ")}>{compactList(row.models, 2)}</span>
              </div>
              <BudgetCell gauge={row.gauge} />
              <div className="hs-topology-cell">
                {row.observations.length > 0 ? (
                  <>
                    <strong>{row.observations.length} sources</strong>
                    <span>{topologyTotals.agents} agents / {topologyTotals.tasks} tasks</span>
                    <span>{topologyTotals.groups} groups</span>
                  </>
                ) : (
                  <span className="hs-muted">-</span>
                )}
              </div>
              <div className="hs-project-cell" title={row.projects.join(", ")}>
                {compactList(row.projects, 3)}
              </div>
              <div className="hs-seen-cell">{timeAgo(row.latestSeen)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopologySection({ snapshot }: { snapshot: HarnessTopologySnapshot | null }) {
  const observations = snapshot?.observations ?? [];
  return (
    <section className="hs-section">
      <div className="hs-section-head">
        <div>
          <h3>Observed topology</h3>
          <p>{observations.length} sources / {snapshot?.totals.agents ?? 0} observed agents / {snapshot?.totals.tasks ?? 0} tasks</p>
        </div>
        <span className="hs-section-meta">{snapshot ? timeAgo(snapshot.generatedAt) : "-"}</span>
      </div>
      {observations.length === 0 ? (
        <div className="hs-empty">No observed topology snapshot.</div>
      ) : (
        <div className="hs-topology-grid">
          {observations.map((observation) => {
            const topology = observation.topology;
            const workflows = topology.groups.filter((group) => group.kind === "workflow").length;
            const activeTasks = topology.tasks.filter((task) => task.state !== "completed" && task.state !== "done").length;
            const sampleAgents = topology.agents.slice(0, 4);
            return (
              <article key={observation.id} className="hs-topology-card">
                <div className="hs-topology-card-head">
                  <strong>{sourceLabel(observation.source)}</strong>
                  <span>{timeAgo(observationSeenAt(observation))}</span>
                </div>
                <div className="hs-topology-counts">
                  <span><strong>{topology.groups.length}</strong> groups</span>
                  <span><strong>{topology.agents.length}</strong> agents</span>
                  <span><strong>{topology.tasks.length}</strong> tasks</span>
                  <span><strong>{topology.relationships.length}</strong> edges</span>
                </div>
                <div className="hs-topology-card-detail">
                  <span>{workflows} workflows</span>
                  <span>{activeTasks} active tasks</span>
                </div>
                <div className="hs-topology-agent-strip">
                  {sampleAgents.length > 0 ? sampleAgents.map((agent) => (
                    <span key={agent.id} title={agent.id}>
                      {agent.name ?? agent.role ?? agent.type ?? "agent"}
                    </span>
                  )) : <span className="hs-muted">-</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function HarnessesScreen({ navigate }: { navigate: (r: Route) => void }) {
  const { agents, route } = useScout();
  const machineId = routeMachineId(route);
  const scopedAgents = useMemo(() => filterAgentsByMachineScope(agents, machineId), [agents, machineId]);
  const [serviceGauges, setServiceGauges] = useState<ServiceGauge[]>([]);
  const [topologySnapshot, setTopologySnapshot] = useState<HarnessTopologySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (force = false, initial = false) => {
    const requestId = ++requestIdRef.current;
    if (initial) setLoading(true);
    setRefreshing(true);
    setError(null);

    try {
      const [budgetResult, topologyResult] = await Promise.allSettled([
        api<{ gauges: ServiceGauge[] }>(`/api/service-budgets${force ? "?refresh=1" : ""}`),
        api<HarnessTopologySnapshot>(`/api/topology/snapshot${force ? "?force=1" : ""}`),
      ]);
      if (requestId !== requestIdRef.current) return;
      if (budgetResult.status === "fulfilled") setServiceGauges(budgetResult.value.gauges ?? []);
      if (topologyResult.status === "fulfilled") setTopologySnapshot(topologyResult.value);
      const errors = [budgetResult, topologyResult]
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
      setError(errors.length > 0 ? errors.join(" / ") : null);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(true, true);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(false), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const rows = useMemo(
    () => buildHarnessRows(scopedAgents, serviceGauges, topologySnapshot),
    [scopedAgents, serviceGauges, topologySnapshot],
  );
  const activeHarnesses = rows.filter((row) => row.agents.length > 0 || row.gauge || row.observations.length > 0).length;
  const workingAgents = scopedAgents.filter((agent) => isAgentBusy(agent.state)).length;

  return (
    <div className="s-ops">
      <div className="s-ops-header">
        <OpsSubnav activeRoute={{ view: "harnesses", ...(machineId ? { machineId } : {}) }} navigate={navigate} />
      </div>
      <div className="s-ops-body hs-body">
        <div className="hs-page">
          <header className="hs-page-head">
            <div className="hs-title-group">
              <span className="hs-kicker">ops / provider central</span>
              <h2>Providers</h2>
              <p>{activeHarnesses} active providers / {scopedAgents.length} registered agents / {serviceGauges.length} budget feeds</p>
            </div>
            <button
              type="button"
              className="hs-refresh"
              disabled={refreshing}
              onClick={() => void load(true)}
            >
              <RefreshCw size={14} className={refreshing ? "hs-refresh-icon-spinning" : ""} aria-hidden="true" />
              <span>{refreshing ? "Refreshing" : "Refresh"}</span>
            </button>
          </header>

          <div className="hs-stat-grid" aria-label="Provider summary">
            <div className="hs-stat">
              <span>Providers</span>
              <strong>{rows.length}</strong>
              <em>{activeHarnesses} active</em>
            </div>
            <div className="hs-stat">
              <span>Agents</span>
              <strong>{scopedAgents.length}</strong>
              <em>{workingAgents} working</em>
            </div>
            <div className="hs-stat">
              <span>Topology</span>
              <strong>{topologySnapshot?.totals.sources ?? 0}</strong>
              <em>{topologySnapshot?.totals.relationships ?? 0} edges</em>
            </div>
            <div className="hs-stat">
              <span>Budgets</span>
              <strong>{serviceGauges.length}</strong>
              <em>{serviceGauges.filter((gauge) => gauge.kind === "quota").length} quota feeds</em>
            </div>
          </div>

          {error && <div className="hs-error">refresh: {error}</div>}
          {loading ? <div className="hs-empty">Loading providers.</div> : <HarnessLedger rows={rows} />}
          <TopologySection snapshot={topologySnapshot} />
        </div>
      </div>
    </div>
  );
}
