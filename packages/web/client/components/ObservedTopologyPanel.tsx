import { useEffect, useMemo, useState } from "react";

import { api } from "../lib/api.ts";
import type {
  HarnessTopologyObservation,
  HarnessTopologySnapshot,
  ObservedHarnessAgent,
  ObservedHarnessRelationship,
  ObservedHarnessTask,
  ObservedHarnessTopology,
} from "../lib/types.ts";

import "./observed-topology-panel.css";

type TopologyPanelSize = "full" | "compact" | "rail";

type ObservedTopologyPanelProps = {
  topology?: ObservedHarnessTopology | null;
  size?: TopologyPanelSize;
  title?: string;
  maxAgents?: number;
  maxTasks?: number;
  showEmpty?: boolean;
};

type TopologySourceModel = {
  source: string;
  observedAt: number | null;
  topology: ObservedHarnessTopology;
};

function observedAtMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shortId(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 12) return value;
  return value.slice(0, 12);
}

function timeAgo(ts: number | null): string | null {
  if (!ts) return null;
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function sourceLabel(source: string): string {
  if (source.includes("workflow")) return "Claude Workflows";
  if (source.includes("codex")) return "Codex";
  if (source.includes("claude")) return "Claude Code";
  return source.replace(/[-_]/g, " ");
}

function displayAgentName(agent: ObservedHarnessAgent): string {
  return agent.name ?? shortId(agent.externalSessionId) ?? agent.id.replace(/^.*:/, "");
}

function agentStatus(agent: ObservedHarnessAgent): string {
  return agent.status ?? agent.role ?? agent.type ?? "observed";
}

function findSpawnParents(
  agent: ObservedHarnessAgent,
  relationships: ObservedHarnessRelationship[],
  agentById: Map<string, ObservedHarnessAgent>,
): string[] {
  return relationships
    .filter((rel) => rel.kind === "spawned" && rel.toId === agent.id)
    .map((rel) => agentById.get(rel.fromId))
    .filter((parent): parent is ObservedHarnessAgent => Boolean(parent))
    .map(displayAgentName);
}

function taskForAgent(
  agent: ObservedHarnessAgent,
  tasks: ObservedHarnessTask[],
): ObservedHarnessTask | null {
  return tasks.find((task) => task.assigneeId === agent.id) ?? null;
}

function statusRank(status: string | undefined): number {
  if (status === "running" || status === "in_progress" || status === "working") return 0;
  if (status === "queued" || status === "pending" || status === "materialized") return 1;
  if (status === "failed" || status === "error") return 2;
  if (status === "completed" || status === "done") return 3;
  return 4;
}

function flattenSnapshot(snapshot: HarnessTopologySnapshot | null): TopologySourceModel[] {
  if (!snapshot) return [];
  return snapshot.observations.map((observation: HarnessTopologyObservation) => ({
    source: observation.source,
    observedAt: observedAtMs(observation.observedAt),
    topology: observation.topology,
  }));
}

export function ObservedTopologyPanel({
  topology,
  size = "full",
  title = "Internal topology",
  maxAgents = size === "rail" ? 5 : 8,
  maxTasks = size === "rail" ? 3 : 5,
  showEmpty = false,
}: ObservedTopologyPanelProps) {
  const [snapshot, setSnapshot] = useState<HarnessTopologySnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (topology) return;
    let cancelled = false;
    api<HarnessTopologySnapshot>("/api/topology/snapshot")
      .then((result) => {
        if (!cancelled) {
          setSnapshot(result);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [topology]);

  const sources = useMemo<TopologySourceModel[]>(() => {
    if (topology) {
      return [{
        source: topology.source,
        observedAt: observedAtMs(topology.observedAt),
        topology,
      }];
    }
    return flattenSnapshot(snapshot);
  }, [snapshot, topology]);

  const totals = useMemo(() => {
    return sources.reduce(
      (acc, source) => {
        acc.sources += 1;
        acc.workflows += source.topology.groups.filter((group) => group.kind === "workflow").length;
        acc.agents += source.topology.agents.length;
        acc.subagents += source.topology.agents.filter((agent) => agent.role === "subagent").length;
        acc.tasks += source.topology.tasks.length;
        acc.activeTasks += source.topology.tasks.filter((task) => task.state !== "completed").length;
        acc.spawned += source.topology.relationships.filter((rel) => rel.kind === "spawned").length;
        return acc;
      },
      { sources: 0, workflows: 0, agents: 0, subagents: 0, tasks: 0, activeTasks: 0, spawned: 0 },
    );
  }, [sources]);

  if (sources.length === 0) {
    if (!showEmpty && !failed) return null;
    return (
      <section className={`s-observed-topology s-observed-topology--${size}`}>
        <header className="s-observed-topology-head">
          <div>
            <div className="s-observed-topology-kicker">Harness observed</div>
            <h3>{title}</h3>
          </div>
        </header>
        <div className="s-observed-topology-empty">
          {failed ? "Topology is unavailable right now." : "No Codex or Claude Code internal agent family observed yet."}
        </div>
      </section>
    );
  }

  return (
    <section className={`s-observed-topology s-observed-topology--${size}`}>
      <header className="s-observed-topology-head">
        <div>
          <div className="s-observed-topology-kicker">Harness observed</div>
          <h3>{title}</h3>
        </div>
        <div className="s-observed-topology-counts">
          {totals.workflows > 0 && <span>{totals.workflows} workflows</span>}
          <span>{totals.subagents} workers</span>
          <span>{totals.tasks} tasks</span>
          {totals.activeTasks > 0
            ? <span>{totals.activeTasks} active</span>
            : <span>{totals.spawned} spawn links</span>}
        </div>
      </header>

      <div className="s-observed-topology-sources">
        {sources.map((source) => (
          <TopologySource
            key={`${source.source}:${source.topology.observedAt}`}
            source={source}
            maxAgents={maxAgents}
            maxTasks={maxTasks}
          />
        ))}
      </div>
    </section>
  );
}

function TopologySource({
  source,
  maxAgents,
  maxTasks,
}: {
  source: TopologySourceModel;
  maxAgents: number;
  maxTasks: number;
}) {
  const { topology } = source;
  const agentById = new Map(topology.agents.map((agent) => [agent.id, agent]));
  const byStatus = (left: ObservedHarnessAgent, right: ObservedHarnessAgent) =>
    statusRank(left.status) - statusRank(right.status) || displayAgentName(left).localeCompare(displayAgentName(right));
  const subagents = topology.agents.filter((agent) => agent.role === "subagent").sort(byStatus);
  const leadAgents = topology.agents.filter((agent) => agent.role === "lead").sort(byStatus);
  const otherAgents = topology.agents.filter((agent) => agent.role !== "subagent" && agent.role !== "lead").sort(byStatus);
  const visibleAgents = [...leadAgents, ...subagents, ...otherAgents].slice(0, maxAgents);
  const activeTasks = topology.tasks
    .filter((task) => task.state !== "completed")
    .sort((left, right) => statusRank(left.state) - statusRank(right.state) || (left.title ?? left.id).localeCompare(right.title ?? right.id))
    .slice(0, maxTasks);

  return (
    <div className="s-observed-topology-source">
      <div className="s-observed-topology-source-head">
        <span>{sourceLabel(source.source)}</span>
        <span>{timeAgo(source.observedAt) ?? "observed"}</span>
      </div>

      <div className="s-observed-topology-agent-list">
        {visibleAgents.map((agent) => {
          const parents = findSpawnParents(agent, topology.relationships, agentById);
          const task = taskForAgent(agent, topology.tasks);
          return (
            <div key={agent.id} className="s-observed-topology-agent">
              <div className="s-observed-topology-agent-main">
                <span className={`s-observed-topology-agent-role s-observed-topology-agent-role--${agent.role ?? "observed"}`}>
                  {agent.role ?? "observed"}
                </span>
                <span className="s-observed-topology-agent-name">{displayAgentName(agent)}</span>
                <span className="s-observed-topology-agent-status">{agentStatus(agent)}</span>
              </div>
              {(parents.length > 0 || task?.title) && (
                <div className="s-observed-topology-agent-detail">
                  {parents.length > 0 && <span>spawned by {parents.join(", ")}</span>}
                  {task?.title && <span>{task.title}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {activeTasks.length > 0 && (
        <div className="s-observed-topology-task-list">
          {activeTasks.map((task) => (
            <div key={task.id} className="s-observed-topology-task">
              <span>{task.state ?? "task"}</span>
              <strong>{task.title ?? task.id.replace(/^.*:/, "")}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
