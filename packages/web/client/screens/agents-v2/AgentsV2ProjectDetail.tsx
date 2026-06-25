import { HarnessMark } from "../../components/HarnessMark.tsx";
import { timeAgo } from "../../lib/time.ts";
import type { Route } from "../../lib/types.ts";
import { isGroupLive } from "../agents/agents-project-model.ts";
import {
  agentPrecedence,
  displaySessionPreview,
  harnessOf,
  registryWorkLine,
  selectAgentsV2Agent,
} from "./model.ts";
import type { RegistryAgentEntry, RegistrySessionEntry } from "./model.ts";
import "./agents-v2.css";

type Navigate = (route: Route) => void;

export function AgentsV2ProjectDetail({
  route,
  navigate,
  projectTitle,
  agentEntries,
  sessionEntries,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
  projectTitle: string;
  agentEntries: RegistryAgentEntry[];
  sessionEntries: RegistrySessionEntry[];
}) {
  const nowMs = Date.now();
  const liveCount = agentEntries.filter((entry) => isGroupLive(entry.group, nowMs)).length;
  const needsCount = agentEntries.filter((entry) => entry.group.needs).length;
  const lead =
    agentEntries.find((entry) => entry.group.needs)
    ?? agentEntries.find((entry) => isGroupLive(entry.group, nowMs))
    ?? agentEntries[0]
    ?? null;
  const recentSessions = sessionEntries.slice(0, 6);

  const leadNeedsAttention =
    lead != null
    && (agentPrecedence(lead, nowMs) !== "idle" || lead.group.needs);

  return (
    <div className="s-av2-detail" data-kind="activity">
      <header className="av2-detailHead">
        <div>
          <h2 className="av2-detailTitle">Activity</h2>
          <div className="av2-detailSub">
            /{projectTitle}
            {liveCount > 0 ? ` · ${liveCount} live` : ""}
            {needsCount > 0 ? ` · ${needsCount} need you` : ""}
          </div>
        </div>
      </header>

      {leadNeedsAttention && lead ? (
        <section className="av2-section">
          <div className="av2-sectionHead">Needs attention</div>
          <button
            type="button"
            className="av2-projectLead"
            onClick={() => navigate(selectAgentsV2Agent(route, lead.leadAgent.id))}
          >
            <span className="av2-projectLeadTop">
              <span className="av2-projectLeadName">
                @{lead.leadAgent.handle?.trim() || lead.group.name}
              </span>
              {lead.leadAgent.harness ? (
                <HarnessMark harness={harnessOf(lead.leadAgent.harness)} size={11} />
              ) : null}
            </span>
            <span className="av2-projectLeadWork">
              {registryWorkLine(lead, agentPrecedence(lead, nowMs))}
            </span>
            <span className="av2-projectLeadCta">Open profile ↗</span>
          </button>
        </section>
      ) : null}

      {recentSessions.length > 0 ? (
        <section className="av2-section">
          <div className="av2-sectionHead">Recent sessions · {sessionEntries.length}</div>
          <div className="av2-sessionList">
            {recentSessions.map((entry) => (
              <SessionChip key={entry.session.id} entry={entry} route={route} navigate={navigate} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="av2-links">
        {agentEntries.length > 1 ? (
          <button
            type="button"
            className="av2-link"
            data-primary
            onClick={() => navigate({ ...route, indexView: "sessions", agentId: undefined, sessionId: undefined })}
          >
            All sessions ↗
          </button>
        ) : null}
        <button type="button" className="av2-link" onClick={() => navigate({ view: "search" })}>
          Search ↗
        </button>
      </div>
    </div>
  );
}

function SessionChip({
  entry,
  route,
  navigate,
}: {
  entry: RegistrySessionEntry;
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
}) {
  const handle = entry.agent?.handle?.trim() || entry.session.agentName || "—";
  const open = () => {
    navigate({ ...route, sessionId: entry.session.id, selectedAgentId: undefined });
  };

  return (
    <button type="button" className="av2-sessionItem" onClick={open}>
      <span className="av2-sessionTitle" title={displaySessionPreview(entry.session)}>
        {displaySessionPreview(entry.session)}
      </span>
      <span className="av2-sessionMeta">
        @{handle}
        {entry.session.lastMessageAt ? ` · ${timeAgo(entry.session.lastMessageAt)}` : ""}
      </span>
    </button>
  );
}