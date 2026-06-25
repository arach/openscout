import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import { timeAgo } from "../../lib/time.ts";
import type { AgentsV2StateFilter, Route } from "../../lib/types.ts";
import "./agents-v2.css";
import {
  agentPrecedence,
  displaySessionPreview,
  filterRegistryAgents,
  filterRegistrySessions,
  indexViewOf,
  openAgentsV2Profile,
  partitionRegistryAgents,
  registryAgentSubline,
  registryWorkLine,
  scopeLabel,
  scopeMetaLabel,
  selectAgentsV2Agent,
  shortSessionRef,
} from "./model.ts";
import { AgentsV2ProjectOverview, useProjectOverviewContext } from "./AgentsV2ProjectOverview.tsx";
import { useAgentsV2Data } from "./useAgentsV2Data.ts";

type Navigate = (route: Route) => void;

type AgentRowEntry = ReturnType<typeof filterRegistryAgents>[number];

function AgentIndexRow({
  entry,
  idx,
  cursor,
  route,
  navigate,
  nowMs,
  rowRefs,
  showProject,
}: {
  entry: AgentRowEntry;
  idx: number;
  cursor: number;
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
  nowMs: number;
  rowRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  showProject: boolean;
}) {
  const tone = agentPrecedence(entry, nowMs);
  const handle = entry.leadAgent.handle?.trim() || entry.group.name;
  const work = registryWorkLine(entry, tone);
  const subline = registryAgentSubline(entry);
  const branch =
    entry.group.branches.length > 1
      ? `${entry.group.branches.length} branches`
      : entry.group.branches[0] ?? "main";
  const selectAgent = () => navigate(selectAgentsV2Agent(route, entry.leadAgent.id));
  const openProfile = () => navigate(openAgentsV2Profile(route, entry.leadAgent.id));
  const selected = route.selectedAgentId === entry.leadAgent.id;

  return (
    <div
      key={`${entry.projectSlug}:${entry.group.name}`}
      ref={(el) => {
        if (el) rowRefs.current.set(entry.leadAgent.id, el);
        else rowRefs.current.delete(entry.leadAgent.id);
      }}
      className="av2-row"
      data-cursor={cursor === idx || undefined}
      data-selected={selected || undefined}
      data-tone={tone === "idle" ? undefined : tone}
    >
      <button type="button" className="av2-rowMain" onClick={selectAgent}>
        <span className="av2-dot" data-tone={tone === "idle" ? undefined : tone} aria-hidden />
        <span className="av2-agentCell">
          <span className="av2-agentName" data-idle={tone === "idle" || undefined}>
            @{handle}
          </span>
          <span className="av2-agentSub" title={subline}>
            {showProject ? `/${entry.projectTitle} · ` : null}
            {subline}
          </span>
        </span>
        <span className="av2-workCell" title={work}>
          {work}
        </span>
        <span className="av2-metaCell" title={branch}>
          {branch}
          {entry.group.sessionCount > 0 ? ` · ${entry.group.sessionCount} sess` : ""}
        </span>
      </button>
      <div className="av2-rowTail">
        <span className="av2-tailWhen">
          {entry.group.lastActivityAt ? timeAgo(entry.group.lastActivityAt) : "—"}
        </span>
        <button type="button" className="av2-openAct" onClick={openProfile}>
          Profile ↗
        </button>
      </div>
    </div>
  );
}

const STATE_FILTERS: Array<{ id: AgentsV2StateFilter | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "needs", label: "Needs you" },
  { id: "live", label: "Live" },
  { id: "idle", label: "Idle" },
];

function selectionRoute(
  base: Extract<Route, { view: "agents-v2" }>,
  patch: { selectedAgentId?: string; sessionId?: string },
): Extract<Route, { view: "agents-v2" }> {
  return { ...base, ...patch, view: "agents-v2", agentId: undefined };
}

function IndexViewToggle({
  route,
  navigate,
  indexView,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
  indexView: ReturnType<typeof indexViewOf>;
}) {
  return (
    <div className="av2-viewToggle" role="group" aria-label="Index view">
      <button
        type="button"
        className="av2-viewBtn"
        data-on={indexView === "agents" || undefined}
        onClick={() => navigate({ ...route, indexView: undefined })}
      >
        Agents
      </button>
      <button
        type="button"
        className="av2-viewBtn"
        data-on={indexView === "sessions" || undefined}
        onClick={() => navigate({ ...route, indexView: "sessions" })}
      >
        Sessions
      </button>
    </div>
  );
}

export function AgentsV2Index({
  route,
  navigate,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
}) {
  const showEphemeral = Boolean(route.showEphemeral);
  const { registryAgents, registrySessions, agentsById, projects } = useAgentsV2Data(showEphemeral);
  const projectContext = useProjectOverviewContext(route, registryAgents, projects, showEphemeral);
  const indexView = indexViewOf(route);
  const nowMs = Date.now();
  const scope = {
    projectSlug: route.projectSlug,
    harness: route.harness,
    node: route.node,
    set: route.set,
  };

  const agentRows = useMemo(
    () => filterRegistryAgents(registryAgents, scope, route.stateFilter, nowMs),
    [registryAgents, scope, route.stateFilter, nowMs],
  );

  const sessionRows = useMemo(
    () => filterRegistrySessions(registrySessions, scope, agentsById, nowMs),
    [registrySessions, scope, agentsById, nowMs],
  );

  const rows = indexView === "sessions" ? sessionRows : agentRows;
  const projectAgentGroups = useMemo(() => {
    if (!route.projectSlug || indexView !== "agents" || agentRows.length < 2) {
      return null;
    }
    return partitionRegistryAgents(agentRows, nowMs);
  }, [agentRows, indexView, nowMs, route.projectSlug]);
  const flatAgentRows = projectAgentGroups
    ? [...projectAgentGroups.active, ...projectAgentGroups.registered]
    : agentRows;
  const [cursor, setCursor] = useState(-1);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    setCursor(-1);
  }, [route.projectSlug, route.harness, route.node, route.set, route.stateFilter, indexView]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;

      const max = rows.length;
      if (!max) return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setCursor((c) => (c < 0 ? 0 : Math.min(max - 1, c + 1)));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setCursor((c) => (c < 0 ? 0 : Math.max(0, c - 1)));
      } else if (e.key === "Enter") {
        const i = cursor < 0 ? 0 : cursor;
        e.preventDefault();
        if (indexView === "sessions") {
          const entry = sessionRows[i];
          if (!entry) return;
          navigate(
            selectionRoute(route, {
              sessionId: entry.session.id,
              selectedAgentId: undefined,
            }),
          );
        } else {
          const entry = flatAgentRows[i];
          if (!entry) return;
          navigate(selectAgentsV2Agent(route, entry.leadAgent.id));
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cursor, flatAgentRows, indexView, navigate, route, rows.length, sessionRows]);

  useEffect(() => {
    if (cursor < 0) return;
    const key =
      indexView === "sessions"
        ? sessionRows[cursor]?.session.id
        : flatAgentRows[cursor]?.leadAgent.id;
    rowRefs.current.get(key ?? "")?.scrollIntoView({ block: "nearest" });
  }, [cursor, flatAgentRows, indexView, sessionRows]);

  const toggleState = (id: AgentsV2StateFilter | "all") => {
    navigate({
      ...route,
      stateFilter: id === "all" ? undefined : id,
    });
  };

  const toggleEphemeral = () => {
    navigate({ ...route, showEphemeral: !route.showEphemeral });
  };

  const indexViewToggle = <IndexViewToggle route={route} navigate={navigate} indexView={indexView} />;
  const projectSessionCount = route.projectSlug ? sessionRows.length : 0;
  const projectSessions = useMemo(
    () =>
      route.projectSlug
        ? registrySessions.filter((entry) => entry.projectSlug === route.projectSlug)
        : [],
    [registrySessions, route.projectSlug],
  );

  return (
    <div className="s-av2-index" data-project={route.projectSlug || undefined}>
      {route.projectSlug ? (
        <AgentsV2ProjectOverview
          route={route}
          navigate={navigate}
          projectTitle={projectContext.projectTitle}
          projectRoot={projectContext.projectRoot}
          dirProject={projectContext.dirProject}
          agentEntries={projectContext.agentEntries}
          agentIdsKey={projectContext.agentIdsKey}
          projectSessions={projectSessions}
          sessionCount={projectSessionCount}
          indexViewToggle={indexViewToggle}
        />
      ) : (
        <header className="av2-indexHead">
          <h1 className="av2-indexTitle">{scopeLabel(route)}</h1>
          <span className="av2-indexMeta">
            {indexView === "sessions"
              ? `${sessionRows.length} sessions`
              : scopeMetaLabel(route, agentRows.length, sessionRows.length)
                || `${agentRows.length} agents`}
          </span>
          <span className="av2-indexSpacer" />
          {indexViewToggle}
        </header>
      )}

      {indexView === "agents" ? (
        <div className="av2-narrow">
          {STATE_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className="av2-filter"
              data-on={
                (filter.id === "all" && !route.stateFilter) || route.stateFilter === filter.id || undefined
              }
              onClick={() => toggleState(filter.id)}
            >
              {filter.label}
            </button>
          ))}
          <button
            type="button"
            className="av2-filter"
            data-on={route.showEphemeral || undefined}
            onClick={toggleEphemeral}
          >
            + Ephemeral
          </button>
        </div>
      ) : null}

      <div className="av2-sectionHead">
        <span className="av2-sectionTitle">{indexView === "sessions" ? "Sessions" : "Agents"}</span>
        <span className="av2-sectionMeta">
          {rows.length} shown
        </span>
        <span className="av2-kbdHint" aria-hidden>
          {indexView === "agents" ? "↑↓ move · ↵ select · profile ↗ to open" : "↑↓ move · ↵ select"}
        </span>
      </div>

      {indexView === "agents" ? (
        <div className="av2-colhead" aria-hidden>
          <div className="av2-colheadMain">
            <span />
            <span>Agent</span>
            <span>Work</span>
            <span>Context</span>
          </div>
          <span className="av2-colOpen">Profile</span>
        </div>
      ) : indexView === "sessions" ? (
        <div className="av2-colhead" aria-hidden>
          <div className="av2-colheadMain">
            <span />
            <span>Session</span>
            <span>Preview</span>
            <span>Agent</span>
          </div>
          <span className="av2-colOpen">Open</span>
        </div>
      ) : null}

      <div className="av2-indexList">
        {indexView === "agents" ? (
          projectAgentGroups ? (
            <>
              {projectAgentGroups.active.length > 0 ? (
                <>
                  <div className="av2-groupHead">
                    <span className="av2-groupTitle">In flight</span>
                    <span className="av2-groupMeta">{projectAgentGroups.active.length}</span>
                  </div>
                  {projectAgentGroups.active.map((entry, offset) => (
                    <AgentIndexRow
                      key={`${entry.projectSlug}:${entry.group.name}`}
                      entry={entry}
                      idx={offset}
                      cursor={cursor}
                      route={route}
                      navigate={navigate}
                      nowMs={nowMs}
                      rowRefs={rowRefs}
                      showProject={false}
                    />
                  ))}
                </>
              ) : null}
              {projectAgentGroups.registered.length > 0 ? (
                <>
                  <div className="av2-groupHead">
                    <span className="av2-groupTitle">Also registered</span>
                    <span className="av2-groupMeta">{projectAgentGroups.registered.length}</span>
                  </div>
                  {projectAgentGroups.registered.map((entry, offset) => (
                    <AgentIndexRow
                      key={`${entry.projectSlug}:${entry.group.name}`}
                      entry={entry}
                      idx={projectAgentGroups.active.length + offset}
                      cursor={cursor}
                      route={route}
                      navigate={navigate}
                      nowMs={nowMs}
                      rowRefs={rowRefs}
                      showProject={false}
                    />
                  ))}
                </>
              ) : null}
            </>
          ) : (
            flatAgentRows.map((entry, idx) => (
              <AgentIndexRow
                key={`${entry.projectSlug}:${entry.group.name}`}
                entry={entry}
                idx={idx}
                cursor={cursor}
                route={route}
                navigate={navigate}
                nowMs={nowMs}
                rowRefs={rowRefs}
                showProject={!route.projectSlug}
              />
            ))
          )
        ) : (
          sessionRows.map((entry, idx) => {
              const handle = entry.agent?.handle?.trim() || entry.session.agentName || "—";
              const openSession = () => {
                navigate(
                  selectionRoute(route, {
                    sessionId: entry.session.id,
                    selectedAgentId: undefined,
                  }),
                );
              };
              return (
                <div
                  key={entry.session.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(entry.session.id, el);
                    else rowRefs.current.delete(entry.session.id);
                  }}
                  className="av2-row"
                  data-cursor={cursor === idx || undefined}
                >
                  <button type="button" className="av2-rowMain" onClick={openSession}>
                    <span className="av2-dot" aria-hidden />
                    <span className="av2-agentCell">
                      <span className="av2-agentName">{shortSessionRef(entry.session.id)}</span>
                      <span className="av2-agentSub">
                        {entry.projectTitle ? `/${entry.projectTitle}` : "—"}
                      </span>
                    </span>
                    <span className="av2-workCell" title={displaySessionPreview(entry.session)}>
                      {displaySessionPreview(entry.session)}
                    </span>
                    <span className="av2-metaCell">@{handle}</span>
                  </button>
                  <div className="av2-rowTail">
                    <span className="av2-tailWhen">
                      {entry.session.lastMessageAt ? timeAgo(entry.session.lastMessageAt) : "—"}
                    </span>
                    <button type="button" className="av2-openAct" onClick={openSession}>
                      Select
                    </button>
                  </div>
                </div>
              );
            })
        )}

        {rows.length === 0 ? (
          <div className="av2-empty">
            {indexView === "sessions"
              ? "No sessions in this scope."
              : "No agents in this scope."}
          </div>
        ) : null}
      </div>
    </div>
  );
}