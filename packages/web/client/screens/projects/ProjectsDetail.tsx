import { useMemo } from "react";
import { agentStateLabel } from "../../lib/agent-state.ts";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { timeAgo } from "../../lib/time.ts";
import type { Agent, Route, SessionEntry } from "../../lib/types.ts";
import "./projects.css";
import {
  agentNodeLabel,
  harnessOf,
  openProjectAgentProfile,
  registryAgentsForProject,
  sessionPreview,
  shortSessionRef,
} from "./model.ts";
import { ProjectAgentPeek } from "./ProjectAgentPeek.tsx";
import { ProjectActivityDetail } from "./ProjectActivityDetail.tsx";
import { useProjectsData } from "./useProjectsData.ts";
import { isGroupLive } from "../agents/agents-project-model.ts";

type Navigate = (route: Route) => void;

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value?.trim()) return null;
  return (
    <>
      <span className="av2-factLabel">{label}</span>
      <span className="av2-factValue" title={value}>
        {value}
      </span>
    </>
  );
}

function AgentDetail({
  agent,
  sessions,
  related,
  route,
  navigate,
}: {
  agent: Agent;
  sessions: SessionEntry[];
  related: Agent[];
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
}) {
  const handle = agent.handle?.trim() || agent.name;
  const selectedSessionId = route.sessionId;

  return (
    <div className="s-av2-detail">
      <header className="av2-detailHead">
        <div>
          <h2 className="av2-detailTitle">@{handle}</h2>
          <div className="av2-detailSub">
            {agentStateLabel(agent.state, agent)}
            {agent.updatedAt ? ` · ${timeAgo(agent.updatedAt)}` : ""}
            {agent.harness ? (
              <>
                {" "}
                · <HarnessMark harness={harnessOf(agent.harness)} size={11} />
              </>
            ) : null}
          </div>
        </div>
      </header>

      <section className="av2-section">
        <div className="av2-sectionHead">Identity</div>
        <div className="av2-factGrid">
          <Fact label="ID" value={agent.id} />
          <Fact label="Name" value={agent.name} />
          <Fact label="Handle" value={agent.handle ? `@${agent.handle}` : null} />
          <Fact label="Harness" value={agent.harness} />
          <Fact label="Model" value={agent.model} />
          <Fact label="Class" value={agent.agentClass} />
        </div>
      </section>

      <section className="av2-section">
        <div className="av2-sectionHead">Placement</div>
        <div className="av2-factGrid">
          <Fact label="Project" value={agent.project} />
          <Fact label="Root" value={agent.projectRoot} />
          <Fact label="CWD" value={agent.cwd} />
          <Fact label="Branch" value={agent.branch} />
          <Fact label="Machine" value={agentNodeLabel(agent)} />
          <Fact label="Transport" value={agent.transport} />
        </div>
      </section>

      <section className="av2-section">
        <div className="av2-sectionHead">Sessions · {sessions.length}</div>
        {sessions.length === 0 ? (
          <div className="av2-detailSub">No sessions recorded for this agent.</div>
        ) : (
          <div className="av2-sessionList">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className="av2-sessionItem"
                data-selected={selectedSessionId === session.id || undefined}
                onClick={() =>
                  navigate({
                    ...route,
                    agentId: agent.id,
                    sessionId: session.id,
                  })
                }
              >
                <span className="av2-sessionTitle">{sessionPreview(session)}</span>
                <span className="av2-sessionMeta">
                  {shortSessionRef(session.id)}
                  {session.currentBranch ? ` · ${session.currentBranch}` : ""}
                  {session.lastMessageAt ? ` · ${timeAgo(session.lastMessageAt)}` : ""}
                  {session.messageCount > 0 ? ` · ${session.messageCount} msgs` : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {related.length > 0 ? (
        <section className="av2-section">
          <div className="av2-sectionHead">Related identities · {related.length}</div>
          <div className="av2-relatedList">
            {related.map((sibling) => (
              <button
                key={sibling.id}
                type="button"
                className="av2-relatedItem"
                onClick={() => navigate({ ...route, agentId: sibling.id, sessionId: undefined })}
              >
                <span>@{sibling.handle?.trim() || sibling.name}</span>
                <span className="av2-sessionMeta">{sibling.branch ?? "—"}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="av2-links">
        <button
          type="button"
          className="av2-link"
          data-primary
          onClick={() =>
            navigate({
              ...openProjectAgentProfile(route, agent.id),
              ...(selectedSessionId ? { sessionId: selectedSessionId } : {}),
            })
          }
        >
          Open profile ↗
        </button>
        <button
          type="button"
          className="av2-link"
          onClick={() =>
            navigate({
              ...openProjectAgentProfile(route, agent.id),
              ...(selectedSessionId ? { sessionId: selectedSessionId } : {}),
              tab: "observe",
            })
          }
        >
          Observe ↗
        </button>
        {agent.conversationId ? (
          <button
            type="button"
            className="av2-link"
            onClick={() => navigate({ view: "conversation", conversationId: agent.conversationId! })}
          >
            Conversation ↗
          </button>
        ) : null}
        <button
          type="button"
          className="av2-link"
          onClick={() => navigate({ view: "terminal", agentId: agent.id })}
        >
          Terminal ↗
        </button>
        <button
          type="button"
          className="av2-link"
          onClick={() => navigate({ ...route, view: "agents-v2", agentId: agent.id, tab: "config" })}
        >
          Configure ↗
        </button>
      </div>
    </div>
  );
}

function SessionDetail({
  session,
  agent,
  route,
  navigate,
}: {
  session: SessionEntry;
  agent: Agent | null;
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
}) {
  return (
    <div className="s-av2-detail">
      <header className="av2-detailHead">
        <div>
          <h2 className="av2-detailTitle">{shortSessionRef(session.id)}</h2>
          <div className="av2-detailSub">{sessionPreview(session)}</div>
        </div>
      </header>

      <section className="av2-section">
        <div className="av2-sectionHead">Session</div>
        <div className="av2-factGrid">
          <Fact label="Ref" value={session.id} />
          <Fact label="Title" value={session.title} />
          <Fact label="Kind" value={session.kind} />
          <Fact label="Branch" value={session.currentBranch} />
          <Fact label="Harness" value={session.harness} />
          <Fact label="H. sess" value={session.harnessSessionId} />
          <Fact label="Messages" value={session.messageCount > 0 ? `${session.messageCount}` : null} />
          <Fact
            label="Last"
            value={session.lastMessageAt ? timeAgo(session.lastMessageAt) : null}
          />
          <Fact label="Workspace" value={session.workspaceRoot} />
        </div>
      </section>

      {agent ? (
        <section className="av2-section">
          <div className="av2-sectionHead">Parent agent</div>
          <div className="av2-factGrid">
            <Fact label="Handle" value={`@${agent.handle?.trim() || agent.name}`} />
            <Fact label="ID" value={agent.id} />
            <Fact label="Project" value={agent.project} />
            <Fact label="Branch" value={agent.branch} />
          </div>
          <button
            type="button"
            className="av2-relatedItem"
            style={{ marginTop: 8 }}
            onClick={() => navigate({ ...route, agentId: agent.id, sessionId: undefined })}
          >
            ← Agent overview
          </button>
        </section>
      ) : null}

      <div className="av2-links">
        {session.agentId ? (
          <button
            type="button"
            className="av2-link"
            data-primary
            onClick={() =>
              navigate({
                view: "sessions",
                agentId: session.agentId!,
                sessionId: session.harnessSessionId ?? session.id,
              })
            }
          >
            Open observe ↗
          </button>
        ) : null}
        <button
          type="button"
          className="av2-link"
          onClick={() => navigate({ view: "conversation", conversationId: session.id })}
        >
          Conversation ↗
        </button>
        {agent ? (
          <button
            type="button"
            className="av2-link"
            onClick={() =>
              navigate({
                ...openProjectAgentProfile(route, agent.id),
                sessionId: route.sessionId ?? session.id,
              })
            }
          >
            Agent profile ↗
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SetDetail({
  route,
  navigate,
  agentCount,
  sessionCount,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
  agentCount: number;
  sessionCount: number;
}) {
  const label =
    route.set === "live"
      ? "Live agents"
      : route.set === "ephemeral"
        ? "Ephemeral agents"
        : route.set === "archived"
          ? "Archived agents"
          : "Set";

  return (
    <div className="s-av2-detail">
      <header className="av2-detailHead">
        <div>
          <h2 className="av2-detailTitle">{label}</h2>
          <div className="av2-detailSub">Smart collection · scoped members in the index</div>
        </div>
      </header>
      <section className="av2-section">
        <div className="av2-sectionHead">Aggregate</div>
        <div className="av2-factGrid">
          <Fact label="Agents" value={`${agentCount}`} />
          <Fact label="Sessions" value={`${sessionCount}`} />
          <Fact label="Rule" value={route.set ?? null} />
        </div>
      </section>
      <div className="av2-links">
        <button type="button" className="av2-link" onClick={() => navigate({ ...route, agentId: undefined, sessionId: undefined })}>
          Clear selection
        </button>
      </div>
    </div>
  );
}

export function ProjectsDetail({
  route,
  navigate,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
}) {
  const showEphemeral = Boolean(route.showEphemeral);
  const { agentsById, sessionsByAgentId, registryAgents, registrySessions } =
    useProjectsData(showEphemeral);

  const peekAgent = route.selectedAgentId ? agentsById.get(route.selectedAgentId) ?? null : null;
  const selectedSession = route.sessionId
    ? registrySessions.find((entry) => entry.session.id === route.sessionId)?.session
      ?? [...sessionsByAgentId.values()]
        .flat()
        .find((session) => session.id === route.sessionId)
      ?? null
    : null;

  const scopedSessionCount = useMemo(() => {
    const nowMs = Date.now();
    return registrySessions.filter((entry) => {
      if (route.projectSlug && entry.projectSlug !== route.projectSlug) return false;
      if (route.set === "live") {
        const lastAt = Math.max(entry.session.lastMessageAt ?? 0, entry.agent?.updatedAt ?? 0);
        return nowMs - lastAt < 30 * 60_000;
      }
      if (route.set === "ephemeral" && entry.agent) {
        return /\bcard\b/i.test(entry.agent.name) || /\b\d{3,}\b/i.test(entry.agent.name);
      }
      if (route.set === "archived") return Boolean(entry.agent?.retiredFromFleet);
      return true;
    }).length;
  }, [registrySessions, route.projectSlug, route.set]);

  const scopedAgentCount = useMemo(() => {
    const nowMs = Date.now();
    return registryAgents.filter((entry) => {
      if (route.projectSlug && entry.projectSlug !== route.projectSlug) return false;
      if (route.set === "live") return isGroupLive(entry.group, nowMs);
      if (route.set === "ephemeral") return entry.group.ephemeral;
      if (route.set === "archived") return entry.leadAgent.retiredFromFleet;
      return true;
    }).length;
  }, [registryAgents, route.projectSlug, route.set]);

  const peekRegistryEntry = useMemo(() => {
    if (!route.selectedAgentId) return null;
    return registryAgents.find((entry) => entry.leadAgent.id === route.selectedAgentId) ?? null;
  }, [registryAgents, route.selectedAgentId]);

  if (selectedSession && !route.selectedAgentId) {
    const parent =
      peekAgent
      ?? (selectedSession.agentId ? agentsById.get(selectedSession.agentId) ?? null : null);
    return <SessionDetail session={selectedSession} agent={parent} route={route} navigate={navigate} />;
  }

  if (peekAgent) {
    const conversations = sessionsByAgentId.get(peekAgent.id) ?? [];
    return (
      <ProjectAgentPeek
        agent={peekAgent}
        route={route}
        navigate={navigate}
        registryEntry={peekRegistryEntry}
        conversations={conversations}
      />
    );
  }

  if (route.set && !route.agentId && !route.sessionId) {
    return (
      <SetDetail
        route={route}
        navigate={navigate}
        agentCount={scopedAgentCount}
        sessionCount={scopedSessionCount}
      />
    );
  }

  if (route.projectSlug && !route.selectedAgentId && !route.sessionId) {
    const projectAgents = registryAgentsForProject(registryAgents, route.projectSlug, showEphemeral);
    const projectSessions = registrySessions.filter(
      (entry) => entry.projectSlug === route.projectSlug,
    );
    const projectTitle = projectAgents[0]?.projectTitle ?? route.projectSlug;
    return (
      <ProjectActivityDetail
        route={route}
        navigate={navigate}
        projectTitle={projectTitle}
        agentEntries={projectAgents}
        sessionEntries={projectSessions}
      />
    );
  }

  return (
    <div className="s-av2-detail">
      <div className="av2-detailEmpty">
        Select an agent or session in the index to read canonical details.
        <br />
        Use Browse to change scope · use Search for retrieval elsewhere.
      </div>
    </div>
  );
}
