import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import "./ctx-panel.css";
import "./base-left-rail.css";
import { normalizeAgentState } from "../../lib/agent-state.ts";
import { api } from "../../lib/api.ts";
import {
  filterAgentsByMachineScope,
  filterFleetByMachineScope,
  machineScopedAgentIds,
} from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import { useScout } from "../Provider.tsx";
import { openAgent } from "./openAgent.ts";
import { RailRow } from "./RailRow.tsx";
import type {
  Agent,
  FleetActivity,
  FleetAttentionItem,
  FleetState,
  Route,
} from "../../lib/types.ts";

const FLEET_REFRESH_EVENTS = new Set([
  "message.posted",
  "flight.updated",
  "collaboration.event.appended",
  "agent.updated",
]);

const RECENT_AGENTS_LIMIT = 4;
const RECENT_ACTIVITY_LIMIT = 4;
const NEEDS_ATTENTION_LIMIT = 3;

type BaseLeftRailProps = {
  prepend?: ReactNode;
};

export function BaseLeftRail({ prepend }: BaseLeftRailProps) {
  const { agents, navigate, route } = useScout();
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const machineId = routeMachineId(route);
  const scopedAgentIds = useMemo(
    () => machineScopedAgentIds(agents, machineId),
    [agents, machineId],
  );
  const scopedAgents = useMemo(
    () => filterAgentsByMachineScope(agents, machineId),
    [agents, machineId],
  );
  const scopedFleet = useMemo(
    () => filterFleetByMachineScope(fleet, scopedAgentIds),
    [fleet, scopedAgentIds],
  );

  const load = useCallback(async () => {
    const data = await api<FleetState>("/api/fleet").catch(() => null);
    setFleet(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBrokerEvents((event) => {
    if (FLEET_REFRESH_EVENTS.has(event.kind)) {
      void load();
    }
  });

  const recentAgents = useMemo(() => sortRecentAgents(scopedAgents).slice(0, RECENT_AGENTS_LIMIT), [scopedAgents]);
  const recentActivity = useMemo(
    () => (scopedFleet?.activity ?? []).slice(0, RECENT_ACTIVITY_LIMIT),
    [scopedFleet],
  );
  const needsAttention = useMemo(
    () => (scopedFleet?.needsAttention ?? []).slice(0, NEEDS_ATTENTION_LIMIT),
    [scopedFleet],
  );

  return (
    <div className="ctx-panel base-rail">
      {prepend ? <div className="base-rail-prepend">{prepend}</div> : null}

      <RecentAgentsSection
        agents={recentAgents}
        totalCount={scopedAgents.length}
        activeCount={scopedAgents.filter((a) => normalizeAgentState(a.state) === "working").length}
        onSelect={(agent) => openAgent(navigate, agent, { from: "base-rail", returnTo: route })}
        onSeeAll={() => navigate({ view: "agents" })}
      />

      <RecentActivitySection
        items={recentActivity}
        onSelect={(item) => navigate(routeForActivity(item))}
        onSeeAll={() => navigate({ view: "activity" })}
      />

      <NeedsAttentionSection
        items={needsAttention}
        onSelect={(item) =>
          navigate(
            item.conversationId
              ? { view: "conversation", conversationId: item.conversationId }
              : { view: "ops", mode: "mission" },
          )
        }
      />
    </div>
  );
}

function RecentAgentsSection({
  agents,
  totalCount,
  activeCount,
  onSelect,
  onSeeAll,
}: {
  agents: Agent[];
  totalCount: number;
  activeCount: number;
  onSelect: (agent: Agent) => void;
  onSeeAll: () => void;
}) {
  const meta = totalCount > 0
    ? activeCount > 0
      ? `${activeCount} active · ${totalCount}`
      : `${totalCount}`
    : undefined;
  return (
    <section className="ctx-panel-section base-rail-section">
      <SectionLabel
        title="Recent agents"
        meta={meta}
        onSeeAll={totalCount > 0 ? onSeeAll : undefined}
      />
      {agents.length === 0 ? (
        <div className="ctx-panel-empty">No agents yet</div>
      ) : (
        agents.map((agent) => (
          <RailRow
            key={agent.id}
            name={agent.name || agent.id}
            meta={agent.updatedAt ? timeAgo(agent.updatedAt) : undefined}
            tone={normalizeAgentState(agent.state)}
            title={agentRowTooltip(agent)}
            onClick={() => onSelect(agent)}
          />
        ))
      )}
    </section>
  );
}

function agentRowTooltip(agent: Agent): string {
  const parts: string[] = [];
  if (agent.project) parts.push(`project: ${agent.project}`);
  if (agent.branch) parts.push(`branch: ${agent.branch}`);
  if (agent.harness) parts.push(`harness: ${agent.harness}`);
  return parts.join("\n");
}

function RecentActivitySection({
  items,
  onSelect,
  onSeeAll,
}: {
  items: FleetActivity[];
  onSelect: (item: FleetActivity) => void;
  onSeeAll: () => void;
}) {
  return (
    <section className="ctx-panel-section base-rail-section">
      <SectionLabel
        title="Recent activity"
        meta={items.length > 0 ? undefined : undefined}
        onSeeAll={items.length > 0 ? onSeeAll : undefined}
      />
      {items.length === 0 ? (
        <div className="ctx-panel-empty">Quiet so far</div>
      ) : (
        items.map((item) => {
          const label = item.actorName ?? item.agentName ?? item.agentId ?? "system";
          const headline = item.title ?? item.summary ?? activityKindLabel(item.kind);
          return (
            <RailRow
              key={item.id}
              name={headline}
              meta={item.ts ? timeAgo(item.ts) : undefined}
              tone="neutral"
              title={`${label} · ${activityKindLabel(item.kind)}`}
              onClick={() => onSelect(item)}
            />
          );
        })
      )}
    </section>
  );
}

function NeedsAttentionSection({
  items,
  onSelect,
}: {
  items: FleetAttentionItem[];
  onSelect: (item: FleetAttentionItem) => void;
}) {
  return (
    <section className="ctx-panel-section base-rail-section">
      <SectionLabel
        title="Needs attention"
        meta={items.length > 0 ? `${items.length}` : undefined}
      />
      {items.length === 0 ? (
        <div className="ctx-panel-empty">All clear</div>
      ) : (
        items.map((item) => {
          const label = item.agentName ?? item.agentId ?? "operator";
          return (
            <RailRow
              key={item.recordId}
              name={item.title}
              meta={timeAgo(item.updatedAt)}
              tone="working"
              unread
              title={`${label} · ${item.kind}`}
              onClick={() => onSelect(item)}
            />
          );
        })
      )}
    </section>
  );
}

function SectionLabel({
  title,
  meta,
  onSeeAll,
}: {
  title: string;
  meta?: string;
  onSeeAll?: () => void;
}) {
  return (
    <div className="ctx-panel-section-label base-rail-section-label">
      <span>{title}</span>
      <span className="base-rail-section-trailing">
        {meta ? <span className="ctx-panel-count">{meta}</span> : null}
        {onSeeAll ? (
          <button type="button" className="base-rail-see-all" onClick={onSeeAll}>
            all
          </button>
        ) : null}
      </span>
    </div>
  );
}

function sortRecentAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function activityKindLabel(kind: string): string {
  switch (kind) {
    case "message":
      return "Message";
    case "invocation":
      return "Invocation";
    case "flight":
      return "Flight update";
    case "collaboration":
      return "Collaboration";
    default:
      return kind.replace(/_/g, " ");
  }
}

function routeForActivity(item: FleetActivity): Route {
  if (item.conversationId) {
    return { view: "conversation", conversationId: item.conversationId };
  }
  if (item.agentId) {
    return { view: "agents", agentId: item.agentId };
  }
  return { view: "activity" };
}
