import "./ops-screen.css";

import { useScout } from "../scout/Provider.tsx";
import { PageStatusBar } from "../components/PageStatusBar.tsx";
import { MissionControlView } from "./MissionControlView.tsx";
import { OpsAgentsView } from "./OpsAgentsView.tsx";
import { PlanView } from "./PlanView.tsx";
import { AtopView } from "./AtopView.tsx";
import { TailView } from "./TailView.tsx";
import type { OpsMode, Route } from "../lib/types.ts";

const TABS: { id: OpsMode; label: string }[] = [
  { id: "mission", label: "Control" },
  { id: "plan", label: "Plans" },
  { id: "issues", label: "Alerts" },
  { id: "tail", label: "Tail" },
  { id: "atop", label: "Atop" },
  { id: "agents", label: "Agents" },
];

export function OpsScreen({
  navigate,
  mode = "mission",
  tailQuery,
}: {
  navigate: (r: Route) => void;
  mode?: OpsMode;
  tailQuery?: string;
}) {
  const { agents, route } = useScout();
  const selectedPlanDocumentId = route.view === "ops" && route.mode === "plan"
    ? route.planDocumentId
    : undefined;

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
        {mode === "plan" && (
          <PlanView
            navigate={navigate}
            agents={agents}
            selectedPlanDocumentId={selectedPlanDocumentId}
          />
        )}
        {mode === "issues" && <TailView navigate={navigate} initialFilter={tailQuery} variant="issues" />}
        {mode === "tail" && <TailView navigate={navigate} initialFilter={tailQuery} />}
        {mode === "atop" && <AtopView />}
      </div>
      <PageStatusBar />
    </div>
  );
}
