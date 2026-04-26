import type { ReactNode } from "react";
import { useScout } from "../Provider.tsx";
import { AgentsInspector } from "../inspector/AgentsInspector.tsx";
import { FleetInspector } from "../inspector/FleetInspector.tsx";
import { HomeAgentsInspector } from "../inspector/HomeAgentsInspector.tsx";
import { SessionsInspector } from "../inspector/SessionsInspector.tsx";
import { WorkInspector } from "../inspector/WorkInspector.tsx";
import { RangerPanel } from "../ranger/RangerPanel.tsx";

export function ScoutInspector() {
  const { route } = useScout();

  let content: ReactNode = null;

  switch (route.view) {
    case "inbox":
      content = <HomeAgentsInspector />;
      break;
    case "agents":
    case "agent-info":
      content = <AgentsInspector />;
      break;
    case "fleet":
      content = <FleetInspector />;
      break;
    case "sessions":
    case "conversation":
      content = <SessionsInspector />;
      break;
    case "work":
      content = <WorkInspector />;
      break;
    case "ops":
      content = null;
      break;
    default:
      content = null;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <RangerPanel />
      <div className="min-h-0 flex-1 overflow-hidden">
        {content}
      </div>
    </div>
  );
}
