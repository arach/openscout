import "./ops-screen.css";

import { useScout } from "../scout/Provider.tsx";
import { PageStatusBar } from "../components/PageStatusBar.tsx";
import { ConductorView } from "./ConductorView.tsx";
import { MissionControlView } from "./MissionControlView.tsx";
import { OpsAgentsView } from "./OpsAgentsView.tsx";
import { PlanArchiveView } from "./PlanArchiveView.tsx";
import { RunsView } from "./RunsView.tsx";
import { AtopView } from "./AtopView.tsx";
import { TailView } from "./TailView.tsx";
import { CommandView } from "./commandView.tsx";
import type { OpsMode, Route } from "../lib/types.ts";

const TABS: { id: OpsMode; label: string }[] = [
  { id: "command", label: "Command" },
  { id: "mission", label: "Control" },
  { id: "plan", label: "Plan" },
  { id: "conductor", label: "Conduct" },
  { id: "tail", label: "Tail" },
  { id: "atop", label: "Atop" },
  { id: "agents", label: "Agents" },
  { id: "runs", label: "Runs" },
];

export function OpsScreen({
  navigate,
  mode = "command",
  tailQuery,
}: {
  navigate: (r: Route) => void;
  mode?: OpsMode;
  tailQuery?: string;
}) {
  const { agents } = useScout();

  return (
    <div className="s-ops">
      <div className="s-ops-header">
        <div className="s-ops-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`s-ops-tab${mode === tab.id ? " s-ops-tab--active" : ""}`}
              onClick={() => navigate({ view: "ops", mode: tab.id })}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="s-ops-body">
        {mode === "mission" && <MissionControlView navigate={navigate} agents={agents} />}
        {mode === "agents" && <OpsAgentsView navigate={navigate} agents={agents} />}
        {mode === "plan" && <PlanArchiveView navigate={navigate} agents={agents} />}
        {mode === "conductor" && <ConductorView navigate={navigate} agents={agents} />}
        {mode === "command" && <CommandView navigate={navigate} agents={agents} />}
        {mode === "tail" && <TailView navigate={navigate} initialFilter={tailQuery} />}
        {mode === "atop" && <AtopView />}
        {mode === "runs" && <RunsView navigate={navigate} agents={agents} />}
      </div>
      <PageStatusBar />
    </div>
  );
}
