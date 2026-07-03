import type { Route } from "../../lib/types.ts";
import { ProjectsInbox } from "./ProjectsInbox.tsx";
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
  const zeroPreview = !isProfile && projectsZeroPreviewEnabled();

  return (
    <div className="s-av2" data-view={isProfile ? "profile" : "index"}>
      <div key={stageKey} className="av2-stagePane">
        {isProfile ? (
          <ProjectAgentProfile route={route} navigate={navigate} />
        ) : (
          <ProjectsInbox route={route} navigate={navigate} zeroPreview={zeroPreview} />
        )}
      </div>
    </div>
  );
}

function projectsZeroPreviewEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return false;
  const value = new URLSearchParams(window.location.search).get("zero")?.trim().toLowerCase();
  return value === "projects" || value === "project" || value === "1" || value === "true";
}
