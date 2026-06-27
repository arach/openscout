import { HarnessMark } from "../../components/HarnessMark.tsx";
import { routePath } from "../../lib/router.ts";
import { timeAgo } from "../../lib/time.ts";
import type { Route } from "../../lib/types.ts";
import { isGroupLive } from "../agents/agents-project-model.ts";
import {
  agentPrecedence,
  displayProjectSessionPreview,
  groupProjectSessionsByHarness,
  harnessOf,
  projectSessionLastAt,
  projectSessionMeta,
  registryWorkLine,
  selectProjectAgent,
} from "./model.ts";
import type { ProjectSessionEntry, RegistryAgentEntry } from "./model.ts";
import "./projects.css";

type Navigate = (route: Route) => void;

export function ProjectActivityDetail({
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
  sessionEntries: ProjectSessionEntry[];
}) {
  const nowMs = Date.now();
  const liveCount = agentEntries.filter((entry) => isGroupLive(entry.group, nowMs)).length;
  const needsCount = agentEntries.filter((entry) => entry.group.needs).length;
  const lead =
    agentEntries.find((entry) => entry.group.needs)
    ?? agentEntries.find((entry) => isGroupLive(entry.group, nowMs))
    ?? agentEntries[0]
    ?? null;
  const sessionGroups = groupProjectSessionsByHarness(sessionEntries);

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
            onClick={() => navigate(selectProjectAgent(route, lead.leadAgent.id))}
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

      {sessionEntries.length > 0 ? (
        <section className="av2-section">
          <div className="av2-sectionHead">Recent sessions · {sessionEntries.length}</div>
          <div className="av2-sessionList">
            {sessionGroups.slice(0, 4).map((group) => (
              <div key={group.key} className="av2-sessionGroup">
                <div className="av2-sessionGroupHead">
                  {group.label} · {group.sessions.length}
                  {group.activeCount > 0 ? ` · ${group.activeCount} active` : ""}
                </div>
                {group.sessions.slice(0, 4).map((entry) => (
                  <SessionChip key={entry.session.key} entry={entry} route={route} />
                ))}
              </div>
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
}: {
  entry: ProjectSessionEntry;
  route: Extract<Route, { view: "agents-v2" }>;
}) {
  const handle = entry.mappedAgent?.handle?.trim() || entry.mappedAgent?.name || null;
  const sessionHref = routePath({
    ...route,
    projectSlug: entry.projectSlug,
    indexView: "sessions",
    sessionId: entry.session.refId,
    selectedAgentId: undefined,
  });
  const when = projectSessionLastAt(entry);

  return (
    <a className="av2-sessionItem" href={sessionHref}>
      <span className="av2-sessionTitle" title={entry.session.transcriptPath ?? displayProjectSessionPreview(entry)}>
        {displayProjectSessionPreview(entry)}
      </span>
      <span className="av2-sessionMeta">
        {handle ? `@${handle.replace(/^@+/, "")} · ` : ""}
        {projectSessionMeta(entry)}
        {when ? ` · ${timeAgo(when)}` : ""}
      </span>
    </a>
  );
}
