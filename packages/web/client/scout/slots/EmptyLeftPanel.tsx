import { useMemo } from "react";
import "./ctx-panel.css";
import { isAgentOnline } from "../../lib/agent-state.ts";
import { useScout } from "../Provider.tsx";

const VIEW_HINTS: Record<string, string> = {
  mesh: "Mesh nodes will appear here",
  activity: "Filters will appear here",
  ops: "Ops modes will appear here",
  work: "Work tree will appear here",
  settings: "Sections will appear here",
  terminal: "Terminal sessions will appear here",
  sessions: "Use the screen to browse",
};

export function ScoutEmptyLeftPanel() {
  const { agents, route, navigate } = useScout();
  const onlineCount = useMemo(
    () => agents.filter((a) => isAgentOnline(a.state)).length,
    [agents],
  );

  const hint = VIEW_HINTS[route.view] ?? "Nothing to navigate here";

  return (
    <div className="ctx-panel ctx-panel--empty">
      <div className="ctx-panel-empty-state">
        <div className="ctx-panel-empty-hint">{hint}</div>
      </div>

      <button
        type="button"
        className="ctx-panel-roster-button"
        onClick={() => navigate({ view: "agents" })}
      >
        <span className="ctx-panel-roster-label">Agents</span>
        <span className="ctx-panel-roster-count">
          <span className="ctx-panel-roster-online-dot" />
          {onlineCount} online · {agents.length} total
        </span>
      </button>
    </div>
  );
}
