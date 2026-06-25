import { useMemo } from "react";
import { useScout } from "../../scout/Provider.tsx";
import { AgentLanesView } from "./AgentLanesView.tsx";

function readEmbedParam(name: string): string | null {
  const value = new URLSearchParams(window.location.search).get(name)?.trim();
  return value || null;
}

export function AgentLanesEmbedScreen() {
  const { agents, navigate } = useScout();
  const filters = useMemo(
    () => ({
      harnessFilter: readEmbedParam("harness"),
      projectFilter: readEmbedParam("project"),
    }),
    [],
  );

  return (
    <div className="s-agent-lanes-embed" data-scout-theme>
      <AgentLanesView
        navigate={navigate}
        agents={agents}
        embedded
        harnessFilter={filters.harnessFilter}
        projectFilter={filters.projectFilter}
      />
    </div>
  );
}
