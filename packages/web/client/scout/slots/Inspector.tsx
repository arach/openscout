import { useScout } from "../Provider.tsx";
import { HomeAgentsInspector } from "../inspector/HomeAgentsInspector.tsx";

export function ScoutInspector() {
  const { route } = useScout();

  switch (route.view) {
    case "inbox":
      return <HomeAgentsInspector />;
    // More inspector panels wire in here as we port each screen:
    //   "agents"   → selected agent info
    //   "sessions" → selected session metadata
    //   "fleet"    → 4-metric summary
    //   "work"     → work item meta
    //   …
    default:
      return null;
  }
}
