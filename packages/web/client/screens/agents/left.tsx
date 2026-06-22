import { useMemo, useState } from "react";
import "../../scout/slots/ctx-panel.css";
import "./agents-rail.css";
import { filterAgentsByMachineScope } from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import { timeAgo } from "../../lib/time.ts";
import { useScout } from "../../scout/Provider.tsx";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { NewChatComposer } from "./NewChatComposer.tsx";
import { useAgentDirectory } from "./useAgentDirectory.ts";
import {
  dirProjectHarnesses,
  dirProjectNeeds,
  dirProjectSessionCount,
  dirProjectWorking,
} from "./model.ts";

const HARNESS_HUE: Record<string, number> = {
  claude: 28,
  codex: 210,
  grok: 280,
  gemini: 150,
  cursor: 330,
  openai: 200,
};
const hueDot = (harness: string) => `hsl(${HARNESS_HUE[harness.toLowerCase()] ?? 220} 52% 60%)`;

/**
 * Agents rail — the project navigator. Search / New chat sit on top as actions,
 * then the projects list (live-first): a pip, harness-hue dots, and a working /
 * needs / count readout. Selecting a project drives the detail via the route's
 * `projectSlug`. The roster lives inside a project now, not in this lane.
 */
export function AgentsLeft() {
  const { agents, route, navigate } = useScout();
  const [composerOpen, setComposerOpen] = useState(false);
  const machineId = routeMachineId(route);
  const scopedAgents = useMemo(
    () => filterAgentsByMachineScope(agents, machineId),
    [agents, machineId],
  );
  const { projects } = useAgentDirectory();
  const selectedProjectSlug = route.view === "agents" ? route.projectSlug : undefined;
  const selectedAgentId = route.view === "agents" ? route.agentId : undefined;

  return (
    <div className="ctx-panel s-agents-rail">
      <div className="s-agents-actions">
        <button type="button" className="s-rail-action" onClick={() => navigate({ view: "search" })}>
          <span className="s-rail-action-icon">
            <IcoSearch />
          </span>
          <span className="s-rail-action-label">Search</span>
        </button>
        <button
          type="button"
          className="s-rail-action s-rail-action--primary"
          onClick={() => setComposerOpen(true)}
        >
          <span className="s-rail-action-icon">
            <IcoPlus />
          </span>
          <span className="s-rail-action-label">New chat</span>
        </button>
      </div>

      <div className="s-agents-recent s-rail-projects">
        <div className="ctx-panel-section-label">
          <span>Projects</span>
          {projects.length > 0 ? <span className="s-rail-proj-total">{projects.length}</span> : null}
        </div>
        {projects.length === 0 ? (
          <div className="ctx-panel-empty">No projects yet</div>
        ) : (
          projects.map((project) => {
            const working = dirProjectWorking(project);
            const needs = dirProjectNeeds(project);
            const harnesses = dirProjectHarnesses(project);
            const selected =
              project.slice.slug === selectedProjectSlug && !selectedAgentId;
            const sessionCount = dirProjectSessionCount(project);
            return (
              <button
                key={project.slice.key}
                type="button"
                className="s-rail-proj"
                data-selected={selected || undefined}
                data-live={working > 0 || undefined}
                title={project.slice.root ?? undefined}
                onClick={() => navigate({ view: "agents", projectSlug: project.slice.slug })}
              >
                <AgentAvatar name={project.slice.title} size={28} tile presence={false} />
                <span className="s-rail-proj-text">
                  <span className="s-rail-proj-top">
                    <span className="s-rail-proj-name">{project.slice.title}</span>
                    {needs ? (
                      <span className="s-rail-proj-needs">needs you</span>
                    ) : working > 0 ? (
                      <span className="s-rail-proj-live">
                        <span className="s-rail-proj-livepip" aria-hidden /> {working}
                      </span>
                    ) : null}
                  </span>
                  <span className="s-rail-proj-sub">
                    <span className="s-rail-proj-dots" aria-hidden>
                      {harnesses.slice(0, 4).map((h, i) => (
                        <span key={i} style={{ background: hueDot(h) }} />
                      ))}
                    </span>
                    <span className="s-rail-proj-meta">
                      {harnesses.length} agent{harnesses.length === 1 ? "" : "s"} · {sessionCount} session
                      {sessionCount === 1 ? "" : "s"}
                    </span>
                    <span className="s-rail-proj-ago">
                      {project.lastActivityAt ? timeAgo(project.lastActivityAt) : "—"}
                    </span>
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="s-agents-foot">
        <button type="button" className="s-rail-action" onClick={() => navigate({ view: "settings" })}>
          <span className="s-rail-action-icon">
            <IcoGear />
          </span>
          <span className="s-rail-action-label">Settings</span>
        </button>
      </div>

      {composerOpen && (
        <NewChatComposer
          agents={scopedAgents}
          navigate={navigate}
          onClose={() => setComposerOpen(false)}
          initialAgentId={selectedAgentId}
        />
      )}
    </div>
  );
}

function IcoSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IcoPlus() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IcoGear() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="2.25" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
