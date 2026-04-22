import { useScout } from "../Provider.tsx";
import { AgentsInspector } from "../inspector/AgentsInspector.tsx";
import { FleetInspector } from "../inspector/FleetInspector.tsx";
import { HomeAgentsInspector } from "../inspector/HomeAgentsInspector.tsx";
import { SessionsInspector } from "../inspector/SessionsInspector.tsx";
import { WorkInspector } from "../inspector/WorkInspector.tsx";

export function ScoutInspector() {
  const { route } = useScout();

  switch (route.view) {
    case "inbox":
      return <HomeAgentsInspector />;
    case "agents":
    case "agent-info":
      return <AgentsInspector />;
    case "fleet":
      return <FleetInspector />;
    case "sessions":
    case "conversation":
      return <SessionsInspector />;
    case "work":
      return <WorkInspector />;
    case "ops":
      return null;
    default:
      return null;
  }
}
