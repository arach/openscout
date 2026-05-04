import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { fullTimestamp, timeAgo } from "../lib/time.ts";
import type { Agent, Route, RunItem, RunsResponse } from "../lib/types.ts";

const RUN_LIMIT = 100;

const ACTIVE_RUN_STATES = new Set(["queued", "waking", "running", "waiting", "review", "unknown"]);

const RUN_REFRESH_EVENT_KINDS = new Set([
  "invocation.requested",
  "flight.updated",
  "collaboration.upserted",
  "collaboration.event.appended",
  "scout.dispatched",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringFromRecord(
  record: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeRunsResponse(payload: RunsResponse): RunItem[] {
  return Array.isArray(payload) ? payload : payload.runs ?? [];
}

function formatLabel(value: string | null | undefined): string {
  return value?.replace(/_/gu, " ") || "-";
}

function shortId(value: string | null | undefined): string {
  if (!value) return "-";
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-5)}`;
}

function timestampMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value < 1e12 ? value * 1000 : value;
}

function runTimestamp(run: RunItem): number | null {
  return timestampMs(run.updatedAt)
    ?? timestampMs(run.completedAt)
    ?? timestampMs(run.startedAt)
    ?? timestampMs(run.createdAt);
}

function isActiveRun(run: RunItem): boolean {
  return ACTIVE_RUN_STATES.has(String(run.state ?? "unknown"));
}

function primaryFlightId(run: RunItem): string | null {
  return run.flightIds?.find((id) => id.trim()) ?? null;
}

function snapshotDisplayName(run: RunItem): string | null {
  const snapshot = asRecord(run.agentRevisionSnapshot);
  return stringFromRecord(snapshot, ["displayName", "name"]);
}

function snapshotPermissionProfile(run: RunItem): string | null {
  const snapshot = asRecord(run.agentRevisionSnapshot);
  const permissions = asRecord(snapshot?.permissions);
  return stringFromRecord(permissions, ["permissionProfile"]);
}

function taskSummary(run: RunItem): string {
  const task = stringFromRecord(run.input, ["task", "summary", "title", "prompt"]);
  if (task) return task;
  const output = stringFromRecord(run.output, ["summary", "text", "error"]);
  if (output) return output;
  const metadata = stringFromRecord(run.metadata, ["summary", "task", "title"]);
  if (metadata) return metadata;
  return run.terminalReason?.trim() || "-";
}

function agentLabel(run: RunItem, agentsById: Map<string, Agent>): string {
  return run.agentName
    ?? agentsById.get(run.agentId)?.name
    ?? snapshotDisplayName(run)
    ?? run.agentId
    ?? "-";
}

function runHarnessLabel(run: RunItem): string {
  const snapshot = asRecord(run.agentRevisionSnapshot);
  const runtime = asRecord(snapshot?.runtime);
  return run.harness
    ?? stringFromRecord(runtime, ["harness"])
    ?? run.model
    ?? stringFromRecord(runtime, ["model"])
    ?? run.agentId;
}

function stateTone(state: string): string {
  switch (state) {
    case "running":
    case "waking":
      return "live";
    case "queued":
      return "queued";
    case "waiting":
    case "review":
      return "waiting";
    case "completed":
      return "done";
    case "failed":
    case "cancelled":
      return "bad";
    default:
      return "unknown";
  }
}

export function RunsView({
  navigate,
  agents,
}: {
  navigate: (r: Route) => void;
  agents: Agent[];
}) {
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [activeOnly, setActiveOnly] = useState(false);
  const [stateFilter, setStateFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const requestSeqRef = useRef(0);

  const agentsById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );

  const load = useCallback(async () => {
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;
    setLoading(true);
    try {
      const result = await api<RunsResponse>(
        `/api/runs?limit=${RUN_LIMIT}&active=${activeOnly ? "true" : "false"}`,
      );
      if (requestSeqRef.current !== seq) return;
      setRuns(normalizeRunsResponse(result));
      setError(null);
      setLoadedAt(Date.now());
    } catch (err) {
      if (requestSeqRef.current !== seq) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestSeqRef.current === seq) {
        setLoading(false);
      }
    }
  }, [activeOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  useBrokerEvents((event) => {
    if (RUN_REFRESH_EVENT_KINDS.has(event.kind)) {
      void load();
    }
  });

  const states = useMemo(
    () => [...new Set(runs.map((run) => String(run.state ?? "unknown")))].sort(),
    [runs],
  );

  const sources = useMemo(
    () => [...new Set(runs.map((run) => String(run.source ?? "unknown")))].sort(),
    [runs],
  );

  const filteredRuns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs
      .filter((run) => !activeOnly || isActiveRun(run))
      .filter((run) => stateFilter === "all" || String(run.state ?? "unknown") === stateFilter)
      .filter((run) => sourceFilter === "all" || String(run.source ?? "unknown") === sourceFilter)
      .filter((run) => {
        if (!q) return true;
        const haystack = [
          run.id,
          run.agentId,
          agentLabel(run, agentsById),
          run.workId,
          run.invocationId,
          primaryFlightId(run),
          run.permissionProfile,
          taskSummary(run),
          runHarnessLabel(run),
          run.state,
          run.source,
        ].join(" ").toLowerCase();
        return haystack.includes(q);
      })
      .sort((left, right) => (runTimestamp(right) ?? 0) - (runTimestamp(left) ?? 0));
  }, [activeOnly, agentsById, query, runs, sourceFilter, stateFilter]);

  const activeCount = runs.filter(isActiveRun).length;
  const failedCount = runs.filter((run) => run.state === "failed").length;
  const reviewCount = runs.filter((run) => run.state === "review" || run.reviewState === "needed" || run.reviewState === "blocked").length;

  const openWork = useCallback((workId: string) => {
    navigate({ view: "work", workId });
  }, [navigate]);

  const openFollow = useCallback((run: RunItem) => {
    const flightId = primaryFlightId(run);
    const route: Extract<Route, { view: "follow" }> = {
      view: "follow",
      ...(run.workId ? { workId: run.workId, preferredView: "work" } : {}),
    };
    if (flightId) {
      navigate({ ...route, flightId });
      return;
    }
    if (run.invocationId) {
      navigate({ ...route, invocationId: run.invocationId });
    }
  }, [navigate]);

  return (
    <div className="s-runs">
      <div className="s-runs-toolbar">
        <div className="s-runs-breadcrumb">Ops <span>/</span> Runs</div>
        <div className="s-runs-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search runs, agents, work, ids..."
          />
        </div>
        <div className="s-runs-toggle" aria-label="Run scope">
          <button
            type="button"
            className={!activeOnly ? "s-runs-toggle-btn s-runs-toggle-btn--active" : "s-runs-toggle-btn"}
            onClick={() => setActiveOnly(false)}
          >
            All
          </button>
          <button
            type="button"
            className={activeOnly ? "s-runs-toggle-btn s-runs-toggle-btn--active" : "s-runs-toggle-btn"}
            onClick={() => setActiveOnly(true)}
          >
            Active
          </button>
        </div>
        <label className="s-runs-filter">
          <span>State</span>
          <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
            <option value="all">All</option>
            {states.map((state) => (
              <option key={state} value={state}>{formatLabel(state)}</option>
            ))}
          </select>
        </label>
        <label className="s-runs-filter">
          <span>Source</span>
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
            <option value="all">All</option>
            {sources.map((source) => (
              <option key={source} value={source}>{formatLabel(source)}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`s-runs-icon-btn${loading ? " s-runs-icon-btn--loading" : ""}`}
          title="Refresh runs"
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="s-runs-summary">
        <Metric label="Loaded" value={String(runs.length)} />
        <Metric label="Active" value={String(activeCount)} />
        <Metric label="Review" value={String(reviewCount)} />
        <Metric label="Failed" value={String(failedCount)} tone={failedCount > 0 ? "bad" : "default"} />
        <Metric label="Updated" value={loadedAt ? timeAgo(loadedAt) : loading ? "loading" : "-"} />
      </div>

      {error && <div className="s-runs-error">{error}</div>}

      <div className="s-runs-table-wrap">
        <table className="s-runs-table">
          <thead>
            <tr>
              <th>State</th>
              <th>Source</th>
              <th>Agent</th>
              <th>Task / summary</th>
              <th>Work id</th>
              <th>Perms</th>
              <th>Updated</th>
              <th>Flight / run</th>
            </tr>
          </thead>
          <tbody>
            {filteredRuns.map((run) => {
              const state = String(run.state ?? "unknown");
              const updated = runTimestamp(run);
              const flightId = primaryFlightId(run);
              const workId = run.workId ?? null;
              const task = taskSummary(run);
              const agentName = agentLabel(run, agentsById);
              const harnessLabel = runHarnessLabel(run);
              const canFollow = Boolean(flightId || run.invocationId);
              const permissionProfile = run.permissionProfile
                ?? snapshotPermissionProfile(run)
                ?? "-";
              return (
                <tr key={run.id}>
                  <td>
                    <span className={`s-runs-state s-runs-state--${stateTone(state)}`}>
                      {formatLabel(state)}
                    </span>
                    {run.reviewState && run.reviewState !== "none" && (
                      <span className="s-runs-review">{formatLabel(run.reviewState)}</span>
                    )}
                  </td>
                  <td>{formatLabel(String(run.source ?? "unknown"))}</td>
                  <td>
                    <button
                      type="button"
                      className="s-runs-agent"
                      title={run.agentId}
                      onClick={() => navigate({ view: "agents", agentId: run.agentId })}
                    >
                      <strong>{agentName}</strong>
                      <small>{harnessLabel}</small>
                    </button>
                  </td>
                  <td>
                    <div className="s-runs-task" title={task}>
                      {task}
                    </div>
                  </td>
                  <td>
                    {workId ? (
                      <button
                        type="button"
                        className="s-runs-link"
                        title={workId}
                        onClick={() => openWork(workId)}
                      >
                        {shortId(workId)}
                      </button>
                    ) : (
                      <span className="s-runs-muted">-</span>
                    )}
                  </td>
                  <td title={permissionProfile}>{formatLabel(permissionProfile)}</td>
                  <td className="s-runs-time" title={updated ? fullTimestamp(updated) : ""}>
                    {updated ? timeAgo(updated) : "-"}
                  </td>
                  <td>
                    <div className="s-runs-ids">
                      {canFollow ? (
                        <button
                          type="button"
                          className="s-runs-link s-runs-id-primary"
                          title={flightId ?? run.invocationId ?? undefined}
                          onClick={() => openFollow(run)}
                        >
                          {flightId ? shortId(flightId) : `inv ${shortId(run.invocationId)}`}
                        </button>
                      ) : (
                        <span className="s-runs-muted">no flight</span>
                      )}
                      <span className="s-runs-id-secondary" title={run.id}>
                        run {shortId(run.id)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredRuns.length === 0 && (
              <tr>
                <td colSpan={8} className="s-runs-empty">
                  {loading ? "Loading runs..." : "No runs match the current filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "bad";
}) {
  return (
    <div className={`s-runs-metric s-runs-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
