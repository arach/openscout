import { Bot, Bug, PanelRightClose, PanelRightOpen } from "lucide-react";
import { SCOUTBOT_COMPOSE_EVENT } from "../../lib/scoutbot.ts";
import type { Route } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { ScoutbotPanel } from "../../scout/scoutbot/ScoutbotPanel.tsx";
import { ProjectsThreadAside } from "./ProjectsThreadAside.tsx";

type Navigate = (route: Route) => void;

export function ProjectsEmbedActionsRail({
  route,
  navigate,
  onClose,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
  onClose: () => void;
}) {
  const { applyScoutbotUiAction } = useScout();
  const hasSelection = Boolean(route.agentId || route.selectedAgentId || route.sessionId);

  const reportIssue = () => {
    const context = [
      route.projectSlug ? `Project: ${route.projectSlug}` : "Project: current Projects board",
      route.agentId ? `Agent: ${route.agentId}` : route.selectedAgentId ? `Selected agent: ${route.selectedAgentId}` : null,
      route.sessionId ? `Session: ${route.sessionId}` : null,
    ].filter(Boolean).join("\n");
    const body = [
      "Please investigate an issue I found while reviewing the native macOS Projects view.",
      "",
      context,
      "",
      "What I observed:\n",
    ].join("\n");

    applyScoutbotUiAction({
      type: "open-scoutbot",
      mode: "ask",
      reason: "Prepare an issue report from the native Projects view",
    });
    window.dispatchEvent(new CustomEvent(SCOUTBOT_COMPOSE_EVENT, { detail: { body } }));
  };

  return (
    <aside className="pi-projectsEmbedActions" aria-label="Projects actions">
      <header className="pi-projectsEmbedActionsHead">
        <div className="pi-projectsEmbedActionsTitle">
          <PanelRightOpen size={14} strokeWidth={1.8} aria-hidden />
          <span>Actions</span>
        </div>
        <button
          type="button"
          className="pi-projectsEmbedActionsClose"
          aria-label="Hide Projects actions"
          title="Hide actions"
          onClick={onClose}
        >
          <PanelRightClose size={14} strokeWidth={1.8} aria-hidden />
        </button>
      </header>

      <div className="pi-projectsEmbedActionsBody">
        <section className="pi-projectsEmbedActionCard" aria-labelledby="projects-report-issue-title">
          <div className="pi-projectsEmbedActionKicker">
            <Bug size={13} strokeWidth={1.8} aria-hidden />
            <span id="projects-report-issue-title">Found a problem?</span>
          </div>
          <p>Give Scoutbot the current board context and start an investigation.</p>
          <button type="button" className="pi-projectsEmbedActionButton" onClick={reportIssue}>
            <Bot size={14} strokeWidth={1.8} aria-hidden />
            <span>Report to Scoutbot</span>
          </button>
        </section>

        <div className="pi-projectsEmbedContext">
          {hasSelection ? (
            <ProjectsThreadAside route={route} navigate={navigate} />
          ) : (
            <div className="pi-projectsEmbedContextEmpty">
              <span>Select a project or session to see its context here.</span>
              <small>The board stays available while you investigate.</small>
            </div>
          )}
        </div>

        <div className="pi-projectsEmbedScoutbot">
          <ScoutbotPanel forceExpanded fill />
        </div>
      </div>
    </aside>
  );
}

export function ProjectsEmbedActionsToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="pi-projectsEmbedActionsToggle"
      aria-label="Show Projects actions"
      title="Show actions"
      onClick={onOpen}
    >
      <PanelRightOpen size={15} strokeWidth={1.8} aria-hidden />
      <span>Actions</span>
    </button>
  );
}
