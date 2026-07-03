import type { Route } from "../../lib/types.ts";
import { ProjectsInbox } from "./ProjectsInbox.tsx";
import { ProjectsRail } from "./ProjectsRail.tsx";
import { ProjectsThreadAside } from "./ProjectsThreadAside.tsx";
import { ProjectAgentProfile } from "./ProjectAgentProfile.tsx";
import { isProjectAgentProfileRoute } from "./model.ts";
import "./projects.css";
import "./projects-inbox.css";

export function ProjectsScreen({
  route,
  navigate,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: (route: Route) => void;
}) {
  const isProfile = isProjectAgentProfileRoute(route);
  const stageKey = isProfile ? `profile:${route.agentId}` : "index";
  const asideEngaged = Boolean(route.selectedAgentId && !route.sessionId);

  return (
    <div className="s-av2" data-view={isProfile ? "profile" : "index"}>
      <div key={stageKey} className="av2-stagePane">
        {isProfile ? (
          <ProjectAgentProfile route={route} navigate={navigate} />
        ) : (
          <div className="pi-shell" data-aside={asideEngaged || undefined}>
            <ProjectsRail route={route} navigate={navigate} />
            <ProjectsInbox route={route} navigate={navigate} />
            {asideEngaged ? <ProjectsThreadAside route={route} navigate={navigate} /> : null}
          </div>
        )}
      </div>
    </div>
  );
}
