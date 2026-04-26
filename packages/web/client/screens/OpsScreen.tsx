import "./ops-screen.css";

import { useScout } from "../scout/Provider.tsx";
import { ConductorView } from "./ConductorView.tsx";
import { MissionControlView } from "./MissionControlView.tsx";
import { PlanView } from "./PlanView.tsx";
import { TailView } from "./TailView.tsx";
import { WarRoomView } from "./WarRoomView.tsx";
import type { OpsMode, Route } from "../lib/types.ts";

const TABS: { id: OpsMode; label: string }[] = [
  { id: "mission", label: "Mission Control" },
  { id: "plan", label: "Plan" },
  { id: "conductor", label: "Conductor" },
  { id: "warroom", label: "War Room" },
  { id: "tail", label: "Tail" },
];

export function OpsScreen({
  navigate,
  mode = "mission",
}: {
  navigate: (r: Route) => void;
  mode?: OpsMode;
}) {
  const { agents } = useScout();

  return (
    <div className="s-ops">
      <div className="s-ops-header">
        <span className="s-ops-header-title">Ops</span>
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
        {mode === "plan" && <PlanView navigate={navigate} agents={agents} />}
        {mode === "conductor" && <ConductorView navigate={navigate} agents={agents} />}
        {mode === "warroom" && <WarRoomView navigate={navigate} agents={agents} />}
        {mode === "tail" && <TailView />}
      </div>
    </div>
  );
}
