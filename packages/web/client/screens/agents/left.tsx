import { useMemo, useState } from "react";
import "../../scout/slots/ctx-panel.css";
import "./agents-rail.css";
import { normalizeAgentState } from "../../lib/agent-state.ts";
import { filterAgentsByMachineScope } from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import { timeAgo } from "../../lib/time.ts";
import { useScout } from "../../scout/Provider.tsx";
import { openAgent } from "../../scout/slots/openAgent.ts";
import { RailRow } from "../../scout/slots/RailRow.tsx";
import { NewChatComposer } from "./NewChatComposer.tsx";
import type { Agent } from "../../lib/types.ts";

const RECENT_LIMIT = 8;

/**
 * Agents rail — an actions column. The list (projects/agents) is the main pane's
 * job now, so the rail stops re-listing the roster and instead launches things:
 * Search opens the lookup view, New chat opens the composer, and the agents you
 * last touched sit below for quick re-entry. Settings rides the foot.
 */
export function AgentsLeft() {
  const { agents, route, navigate } = useScout();
  const [composerOpen, setComposerOpen] = useState(false);
  const machineId = routeMachineId(route);
  const scopedAgents = useMemo(
    () => filterAgentsByMachineScope(agents, machineId),
    [agents, machineId],
  );
  const recent = useMemo(
    () =>
      [...scopedAgents]
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, RECENT_LIMIT),
    [scopedAgents],
  );
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

      <div className="s-agents-recent">
        <div className="ctx-panel-section-label">
          <span>Recent</span>
          {scopedAgents.length > 0 && (
            <button
              type="button"
              className="s-rail-see-all"
              onClick={() => navigate({ view: "agents" })}
            >
              all
            </button>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="ctx-panel-empty">No agents yet</div>
        ) : (
          recent.map((agent) => (
            <RailRow
              key={agent.id}
              name={agent.name || agent.id}
              meta={agent.updatedAt ? timeAgo(agent.updatedAt) : undefined}
              tone={normalizeAgentState(agent.state)}
              avatarName={agent.name}
              active={agent.id === selectedAgentId}
              title={agentRowTooltip(agent)}
              onClick={() =>
                openAgent(navigate, agent, { from: "agents-rail", returnTo: { view: "agents" } })
              }
            />
          ))
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

function agentRowTooltip(agent: Agent): string | undefined {
  const parts: string[] = [];
  if (agent.project) parts.push(`project: ${agent.project}`);
  if (agent.branch) parts.push(`branch: ${agent.branch}`);
  if (agent.harness) parts.push(`harness: ${agent.harness}`);
  return parts.length > 0 ? parts.join("\n") : undefined;
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
