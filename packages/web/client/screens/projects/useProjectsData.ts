import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.ts";
import { filterAgentsByMachineScope } from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { useScout } from "../../scout/Provider.tsx";
import type { Agent, FleetAsk, FleetState, SessionEntry, TailDiscoverySnapshot } from "../../lib/types.ts";
import {
  buildDirProjects,
  buildNativeSessionRows,
  directSessionMaps,
  rowForAgentInventory,
} from "../agents/model.ts";
import {
  buildBrowseHarnesses,
  buildBrowseNodes,
  buildBrowseProjects,
  buildProjectSessions,
  buildBrowseSets,
  buildRegistryAgents,
  buildRegistrySessions,
  type ProjectSessionEntry,
  type RegistryAgentEntry,
  type RegistrySessionEntry,
} from "./model.ts";

export function useProjectsData(showEphemeral: boolean) {
  const { agents, route } = useScout();
  const machineId = routeMachineId(route);
  const scopedAgents = useMemo(
    () => filterAgentsByMachineScope(agents, machineId),
    [agents, machineId],
  );

  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [discovery, setDiscovery] = useState<TailDiscoverySnapshot | null>(null);

  const load = useCallback(async () => {
    const [sessionsResult, fleetResult, discoveryResult] = await Promise.allSettled([
      api<SessionEntry[]>("/api/conversations"),
      api<FleetState>("/api/fleet"),
      api<TailDiscoverySnapshot>("/api/tail/discover"),
    ]);
    if (sessionsResult.status === "fulfilled") setSessions(sessionsResult.value);
    if (fleetResult.status === "fulfilled") setFleet(fleetResult.value);
    if (discoveryResult.status === "fulfilled") setDiscovery(discoveryResult.value);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const id = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(id);
  }, [load]);
  useBrokerEvents(() => {
    void load();
  });

  const asksByAgent = useMemo(() => {
    const map = new Map<string, FleetAsk[]>();
    for (const ask of fleet?.activeAsks ?? []) {
      const list = map.get(ask.agentId) ?? [];
      list.push(ask);
      map.set(ask.agentId, list);
    }
    return map;
  }, [fleet?.activeAsks]);

  const projects = useMemo(() => {
    const { sessionByAgentId } = directSessionMaps(sessions);
    const rows = scopedAgents.map((agent) =>
      rowForAgentInventory(
        agent,
        sessionByAgentId.get(agent.id) ?? null,
        asksByAgent.get(agent.id) ?? [],
      ),
    );
    const native = buildNativeSessionRows(discovery, Date.now());
    return buildDirProjects(rows, sessions, native);
  }, [scopedAgents, sessions, asksByAgent, discovery]);

  const agentsById = useMemo(() => new Map(scopedAgents.map((agent) => [agent.id, agent])), [scopedAgents]);

  const registryAgents = useMemo(
    () => buildRegistryAgents(projects, showEphemeral),
    [projects, showEphemeral],
  );

  const registrySessions = useMemo(
    () => buildRegistrySessions(projects, sessions, agentsById),
    [projects, sessions, agentsById],
  );

  const projectSessions = useMemo(
    () => buildProjectSessions(projects),
    [projects],
  );

  const nowMs = Date.now();
  const browseProjects = useMemo(() => buildBrowseProjects(projects, nowMs), [projects, nowMs]);
  const browseHarnesses = useMemo(() => buildBrowseHarnesses(registryAgents), [registryAgents]);
  const browseNodes = useMemo(() => buildBrowseNodes(registryAgents), [registryAgents]);
  const browseSets = useMemo(() => buildBrowseSets(registryAgents, nowMs), [registryAgents, nowMs]);

  const sessionsByAgentId = useMemo(() => {
    const map = new Map<string, SessionEntry[]>();
    for (const session of sessions) {
      if (!session.agentId) continue;
      const list = map.get(session.agentId) ?? [];
      list.push(session);
      map.set(session.agentId, list);
    }
    for (const [agentId, list] of map) {
      list.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
      map.set(agentId, list);
    }
    return map;
  }, [sessions]);

  return {
    agents: scopedAgents,
    agentsById,
    projects,
    sessions,
    sessionsByAgentId,
    registryAgents,
    registrySessions,
    projectSessions,
    browseProjects,
    browseHarnesses,
    browseNodes,
    browseSets,
  };
}

export type ProjectsData = {
  agents: Agent[];
  agentsById: Map<string, Agent>;
  registryAgents: RegistryAgentEntry[];
  registrySessions: RegistrySessionEntry[];
  projectSessions: ProjectSessionEntry[];
  sessionsByAgentId: Map<string, SessionEntry[]>;
};
