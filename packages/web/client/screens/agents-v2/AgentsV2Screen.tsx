import type { Route } from "../../lib/types.ts";
import { AgentsV2Index } from "./AgentsV2Index.tsx";
import { AgentsV2Profile } from "./AgentsV2Profile.tsx";
import { isAgentsV2ProfileRoute } from "./model.ts";
import "./agents-v2.css";

export function AgentsV2Screen({
  route,
  navigate,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: (route: Route) => void;
}) {
  const isProfile = isAgentsV2ProfileRoute(route);
  const stageKey = isProfile ? `profile:${route.agentId}` : "index";

  return (
    <div className="s-av2" data-view={isProfile ? "profile" : "index"}>
      <div key={stageKey} className="av2-stagePane">
        {isProfile ? (
          <AgentsV2Profile route={route} navigate={navigate} />
        ) : (
          <AgentsV2Index route={route} navigate={navigate} />
        )}
      </div>
    </div>
  );
}