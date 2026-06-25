import type { Route } from "../../lib/types.ts";
import { ProjectsIndex } from "./ProjectsIndex.tsx";
import { ProjectAgentProfile } from "./ProjectAgentProfile.tsx";
import { isProjectAgentProfileRoute } from "./model.ts";
import "./projects.css";

export function ProjectsScreen({
  route,
  navigate,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: (route: Route) => void;
}) {
  const isProfile = isProjectAgentProfileRoute(route);
  const stageKey = isProfile ? `profile:${route.agentId}` : "index";

  return (
    <div className="s-av2" data-view={isProfile ? "profile" : "index"}>
      <div key={stageKey} className="av2-stagePane">
        {isProfile ? (
          <ProjectAgentProfile route={route} navigate={navigate} />
        ) : (
          <ProjectsIndex route={route} navigate={navigate} />
        )}
      </div>
    </div>
  );
}