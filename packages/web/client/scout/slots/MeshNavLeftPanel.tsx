import { useMemo } from "react";
import {
  useMeshViewStore,
  setMeshQuery,
  toggleAgentStateFilter,
  toggleTreeFullMachine,
  setMeshSelection,
  requestScrollToMachine,
  type AgentStateToken,
} from "../../lib/mesh-view-store.ts";
import { useScout } from "../Provider.tsx";
import { bucketAgentsByMachine, type MachineBucket } from "../../lib/mesh-buckets.ts";
import { normalizeAgentState } from "../../lib/agent-state.ts";
import { useFleetActiveAsks } from "../../lib/use-fleet-active-asks.ts";
import { RailRow } from "./RailRow.tsx";
import { MeshCanvasMinimap } from "./MeshCanvasMinimap.tsx";
import { FleetSearch } from "./FleetSearch.tsx";
import { FleetFilterPills } from "./FleetFilterPills.tsx";
import { openAgent } from "./openAgent.ts";
import type { Agent } from "../../lib/types.ts";
import "./ctx-panel.css";
import "./mesh-nav-panel.css";

const COMPACT_LIMIT = 10;

function tokenForAgent(a: Agent): AgentStateToken {
  const s = normalizeAgentState(a.state);
  return s === "working" || s === "available" ? s : "offline";
}

function recencyKey(a: Agent): number {
  return a.updatedAt ?? a.createdAt ?? 0;
}

export function MeshNavLeftPanel() {
  const { agents, navigate } = useScout();
  const {
    meshSnapshot,
    selectedId,
    selectedType,
    query,
    agentStateFilters,
    hiddenMachineIds,
    treeFullMachineIds,
  } = useMeshViewStore();
  const activeAsks = useFleetActiveAsks();

  const buckets = useMemo<MachineBucket[]>(
    () => (meshSnapshot ? bucketAgentsByMachine(agents, meshSnapshot) : []),
    [agents, meshSnapshot],
  );

  const filteredBuckets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return buckets
      .filter((b) => !hiddenMachineIds.has(b.machineId))
      .map((b) => {
        const agentsHere = b.agents.filter((a) => {
          if (!agentStateFilters.has(tokenForAgent(a))) return false;
          if (!needle) return true;
          const hay = `${a.name ?? ""} ${a.project ?? ""} ${a.branch ?? ""} ${a.harness ?? ""}`.toLowerCase();
          return hay.includes(needle);
        });
        return { ...b, agents: agentsHere };
      });
  }, [buckets, query, agentStateFilters, hiddenMachineIds]);

  const groups = useMemo(() => {
    const map = new Map<string, MachineBucket[]>([
      ["this", []],
      ["peer", []],
      ["tailnet", []],
    ]);
    for (const b of filteredBuckets) {
      const key = b.reachability === "this" ? "this" : b.reachability === "peer" ? "peer" : "tailnet";
      map.get(key)?.push(b);
    }
    return map;
  }, [filteredBuckets]);

  if (!meshSnapshot) {
    return (
      <div className="ctx-panel ctx-panel--empty">
        <div className="ctx-panel-empty-state">
          <div className="ctx-panel-empty-hint">Loading mesh…</div>
        </div>
      </div>
    );
  }

  const focusMachine = (id: string) => {
    setMeshSelection(id, "node");
    requestScrollToMachine(id);
  };

  const selectAgent = (a: Agent) => {
    setMeshSelection(a.id, "agent");
    if (a.homeNodeId) requestScrollToMachine(a.homeNodeId);
    openAgent(navigate, a, { from: "mesh-tree", returnTo: { view: "mesh" } });
  };

  const renderGroup = (label: string, items: MachineBucket[]) => {
    if (items.length === 0) return null;
    return (
      <section key={label} className="mesh-nav-group">
        <div className="mesh-nav-group-label">{label}</div>
        {items.map((b) => {
          const full = treeFullMachineIds.has(b.machineId);
          const sorted = [...b.agents].sort((x, y) => recencyKey(y) - recencyKey(x));
          const visible = full ? sorted : sorted.slice(0, COMPACT_LIMIT);
          const overflow = sorted.length - visible.length;
          const machineActive = selectedId === b.machineId && selectedType === "node";
          const working = b.agents.filter((a) => normalizeAgentState(a.state) === "working").length;
          const meta =
            b.agents.length > 0
              ? `${working}/${b.agents.length}`
              : b.online
                ? "—"
                : "offline";
          return (
            <div key={b.machineId} className="mesh-nav-machine">
              <RailRow
                name={b.machineLabel}
                meta={meta}
                tone="neutral"
                active={machineActive}
                onClick={() => focusMachine(b.machineId)}
                title={`Focus ${b.machineLabel} on the map`}
              />
              {visible.map((a) => {
                const agentActive = selectedId === a.id && selectedType === "agent";
                const attention = activeAsks.has(a.id);
                return (
                  <RailRow
                    key={a.id}
                    name={a.name}
                    tone={normalizeAgentState(a.state)}
                    depth={1}
                    active={agentActive}
                    unread={attention}
                    onClick={() => selectAgent(a)}
                    title={a.name}
                  />
                );
              })}
              {!full && overflow > 0 && (
                <RailRow
                  name={`see ${overflow} more`}
                  depth={1}
                  tone="neutral"
                  onClick={() => toggleTreeFullMachine(b.machineId)}
                  title="Show all agents on this machine"
                />
              )}
              {full && sorted.length > COMPACT_LIMIT && (
                <RailRow
                  name="see less"
                  depth={1}
                  tone="neutral"
                  onClick={() => toggleTreeFullMachine(b.machineId)}
                  title="Show recent agents only"
                />
              )}
            </div>
          );
        })}
      </section>
    );
  };

  return (
    <div className="ctx-panel mesh-nav">
      <div className="mesh-nav-head">
        <FleetSearch
          value={query}
          onChange={setMeshQuery}
          placeholder="Find machines or agents…"
        />
        <FleetFilterPills active={agentStateFilters} onToggle={toggleAgentStateFilter} />
      </div>

      <div className="mesh-nav-tree">
        {renderGroup("this host", groups.get("this") ?? [])}
        {renderGroup("peers", groups.get("peer") ?? [])}
        {renderGroup("tailnet", groups.get("tailnet") ?? [])}
      </div>

      <div className="mesh-nav-minimap">
        <MeshCanvasMinimap />
      </div>
    </div>
  );
}
