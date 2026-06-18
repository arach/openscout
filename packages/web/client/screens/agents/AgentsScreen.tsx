import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../lib/api.ts";
import { filterAgentsByMachineScope } from "../../lib/machine-scope.ts";
import { conversationForAgent, routeMachineId } from "../../lib/router.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { useScout } from "../../scout/Provider.tsx";
import { AgentDirectoryStudioInjection } from "../../studio/AgentDirectoryStudioInjection.tsx";
import type {
  AgentTab,
  FleetState,
  HarnessTopologySnapshot,
  Route,
  SessionEntry,
  TailDiscoverySnapshot,
} from "../../lib/types.ts";
import { AgentsSubnav } from "./AgentsSubnav.tsx";
import { AgentsLibrary } from "./library.tsx";
import { directSessionMaps, resolveSelectedAgent } from "./model.ts";
import { AgentDetailWithRail, AgentProfileBar } from "./profile.tsx";
import "./agents-screen.css";
import "../ops/ops-atop.css";
import "../ops/ops-screen.css";

export function AgentsScreen({
  navigate,
  selectedAgentId,
  conversationId: activeConversationId,
  tab: activeTab,
  activeRoute,
}: {
  navigate: (r: Route) => void;
  selectedAgentId?: string;
  conversationId?: string;
  tab?: AgentTab;
  activeRoute?: Route;
}) {
  const { agents, route } = useScout();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [discovery, setDiscovery] = useState<TailDiscoverySnapshot | null>(null);
  const [topologySnapshot, setTopologySnapshot] = useState<HarnessTopologySnapshot | null>(null);
  const machineId = routeMachineId(route);
  const scopedAgents = useMemo(
    () => filterAgentsByMachineScope(agents, machineId),
    [agents, machineId],
  );

  const load = useCallback(async () => {
    const [sessionsResult, fleetResult, discoveryResult, topologyResult] = await Promise.allSettled([
      api<SessionEntry[]>("/api/conversations"),
      api<FleetState>("/api/fleet"),
      api<TailDiscoverySnapshot>("/api/tail/discover"),
      api<HarnessTopologySnapshot>("/api/topology/snapshot?force=1"),
    ]);
    if (sessionsResult.status === "fulfilled") setSessions(sessionsResult.value);
    if (fleetResult.status === "fulfilled") setFleet(fleetResult.value);
    if (discoveryResult.status === "fulfilled") setDiscovery(discoveryResult.value);
    if (topologyResult.status === "fulfilled") setTopologySnapshot(topologyResult.value);
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

  const selectedAgent = resolveSelectedAgent(scopedAgents, selectedAgentId);
  const selectedAgentWasAliased = Boolean(
    selectedAgentId && selectedAgent && selectedAgent.id !== selectedAgentId,
  );

  const { conversationByAgentId, sessionByAgentId } =
    directSessionMaps(sessions);

  useEffect(() => {
    if (!selectedAgentId || !selectedAgent || !selectedAgentWasAliased) return;
    const staleDirectConversationId = conversationForAgent(selectedAgentId);
    const canonicalConversationId =
      activeConversationId === staleDirectConversationId
        ? selectedAgent.conversationId
        : activeConversationId;
    navigate({
      view: "agents",
      agentId: selectedAgent.id,
      ...(canonicalConversationId ? { conversationId: canonicalConversationId } : {}),
      ...(activeTab ? { tab: activeTab } : {}),
    });
  }, [activeConversationId, activeTab, navigate, selectedAgent, selectedAgentId, selectedAgentWasAliased]);

  if (selectedAgent) {
    const staleDirectConversationId =
      selectedAgentWasAliased && selectedAgentId
        ? conversationForAgent(selectedAgentId)
        : null;
    const resolvedConversationId =
      activeConversationId === staleDirectConversationId
        ? selectedAgent.conversationId
        : (
          activeConversationId ??
          conversationByAgentId.get(selectedAgent.id) ??
          selectedAgent.conversationId ??
          null
        );
    const resolvedTab = activeTab
      ?? (activeConversationId ? "message" : "profile");
    return (
      <AgentsRouteFrame activeRoute={activeRoute ?? route} navigate={navigate}>
        <AgentDetailWithRail
          agent={selectedAgent}
          allAgents={scopedAgents}
          conversationId={resolvedConversationId}
          navigate={navigate}
          activeTab={resolvedTab}
        />
      </AgentsRouteFrame>
    );
  }

  return (
    <AgentsRouteFrame activeRoute={activeRoute ?? route} navigate={navigate}>
      <AgentDirectoryStudioInjection>
        <AgentsLibrary
          agents={scopedAgents}
          fleet={fleet}
          sessionByAgentId={sessionByAgentId}
          conversationByAgentId={conversationByAgentId}
          sessions={sessions}
          discovery={discovery}
          topologySnapshot={topologySnapshot}
          navigate={navigate}
        />
      </AgentDirectoryStudioInjection>
    </AgentsRouteFrame>
  );
}

function AgentsRouteFrame({
  activeRoute,
  children,
  navigate,
}: {
  activeRoute: Route;
  children: ReactNode;
  navigate: (r: Route) => void;
}) {
  return (
    <div className="s-secondary-nav-shell">
      <div className="s-secondary-nav-bar">
        <AgentsSubnav activeRoute={activeRoute} navigate={navigate} />
      </div>
      <div className="s-secondary-nav-body">{children}</div>
    </div>
  );
}
