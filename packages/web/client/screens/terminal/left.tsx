import { Eye, LogIn, RefreshCw, Terminal as TerminalIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchTerminalSessions, surfaceKey, terminalListItems } from "../../lib/terminal-sessions.ts";
import type { TerminalSessionRecord } from "@openscout/protocol";
import { makeSearchHandoff, rovingTabIndex, useListArrowNav, useSlashToFocus } from "../../lib/keyboard-nav.ts";
import { useScout } from "../../scout/Provider.tsx";
import { agentStateLabel } from "../../lib/agent-state.ts";
import { resolveAgentTerminalSurface } from "../../lib/terminal-relay.ts";
import type { Agent } from "../../lib/types.ts";
import "../../scout/slots/ctx-panel.css";
import "../../scout/slots/terminal-left-panel.css";

const TERMINAL_NAV_REFRESH_MS = 8_000;

export function TerminalLeft() {
  const { route, navigate, agents } = useScout();
  const [state, setState] = useState<
    | { state: "loading"; sessions: TerminalSessionRecord[] }
    | { state: "ready"; sessions: TerminalSessionRecord[] }
    | { state: "failed"; sessions: TerminalSessionRecord[]; error: string }
  >({ state: "loading", sessions: [] });
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const onListKeyDown = useListArrowNav();
  const onSearchKeyDown = makeSearchHandoff(() => listRef.current);
  useSlashToFocus(useCallback(() => inputRef.current, []));

  const load = useCallback((options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setState((current) => ({ state: "loading", sessions: current.sessions }));
    }
    void fetchTerminalSessions({ includeDiscovered: true })
      .then((sessions) => {
        setState({ state: "ready", sessions });
      })
      .catch((error) => {
        if (options.silent) return;
        setState((current) => ({
          state: "failed",
          sessions: current.sessions,
          error: error instanceof Error ? error.message : String(error),
        }));
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        load({ silent: true });
      }
    };
    const interval = window.setInterval(refreshIfVisible, TERMINAL_NAV_REFRESH_MS);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [load]);

  const items = useMemo(() => terminalListItems(state.sessions), [state.sessions]);
  const agentTargets = useMemo(() => sortTerminalAgentsForNav(agents), [agents]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = normalizedQuery
    ? items.filter((item) => item.searchable.includes(normalizedQuery))
    : items;
  const visibleAgents = normalizedQuery
    ? agentTargets.filter((agent) => terminalAgentSearchable(agent).includes(normalizedQuery))
    : agentTargets;
  const activeTerminalKey = route.view === "terminal" && route.terminalSurfaceKey
    ? route.terminalSessionId
      ? `${route.terminalSessionId}:${route.terminalSurfaceKey}`
      : route.terminalSurfaceKey
    : null;
  const activeAgentKey = route.view === "terminal" && route.agentId ? `agent:${route.agentId}` : null;
  const hasAnyActive = Boolean(
    (activeTerminalKey != null && visibleItems.some((item) =>
      item.id === activeTerminalKey || item.key === activeTerminalKey
    ))
    || (activeAgentKey != null && visibleAgents.some((agent) => `agent:${agent.id}` === activeAgentKey)),
  );
  const firstRowId = visibleItems[0]?.id ?? (visibleAgents[0] ? `agent:${visibleAgents[0].id}` : undefined);
  const summary = state.state === "loading"
    ? "Syncing"
    : normalizedQuery
      ? `${visibleItems.length + visibleAgents.length}/${items.length + agentTargets.length}`
      : `${items.length + agentTargets.length} targets`;
  const terminalRouteFor = (
    item: ReturnType<typeof terminalListItems>[number],
    mode?: "takeover" | "observe",
  ) => ({
    view: "terminal" as const,
    terminalSessionId: item.session.id,
    terminalSurfaceKey: surfaceKey(item.surface),
    ...(mode ? { mode } : {}),
  });
  const terminalRouteForAgent = (agent: Agent, mode: "takeover" | "observe" = "takeover") => ({
    view: "terminal" as const,
    agentId: agent.id,
    mode,
  });

  return (
    <div className="ctx-panel terminal-nav">
      <div className="terminal-nav-head">
        <div>
          <div className="terminal-nav-title">Terminals</div>
          <div className="terminal-nav-summary">{summary}</div>
        </div>
        <button
          type="button"
          className="terminal-nav-refresh"
          onClick={() => load()}
          disabled={state.state === "loading"}
          title="Refresh terminals"
          aria-label="Refresh terminals"
        >
          <RefreshCw size={14} strokeWidth={1.8} />
        </button>
      </div>
      <div className="ctx-panel-toolbar terminal-nav-toolbar">
        <input
          ref={inputRef}
          type="text"
          className="ctx-panel-search-input"
          placeholder="Search terminals"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
        />
      </div>
      {state.state === "failed" && (
        <div className="terminal-nav-error">{state.error}</div>
      )}
      <div
        ref={listRef}
        className="terminal-nav-list"
        onKeyDown={onListKeyDown}
      >
        {visibleItems.length === 0 && visibleAgents.length === 0 && state.state !== "loading" ? (
          <div className="ctx-panel-empty">{items.length + agentTargets.length === 0 ? "No terminal targets" : "No matches"}</div>
        ) : (
          <>
            <div className="terminal-nav-section">
              <div className="terminal-nav-section-title">
                <span>Sessions</span>
                <span>{visibleItems.length}</span>
              </div>
              {visibleItems.map((item) => {
                const active = item.id === activeTerminalKey || item.key === activeTerminalKey;
                return (
                  <div
                    key={item.id}
                    className={`terminal-nav-row${active ? " terminal-nav-row--active" : ""}`}
                    title={item.surface.sessionName}
                  >
                    <button
                      type="button"
                      data-list-primary
                      className="terminal-nav-row-select"
                      tabIndex={rovingTabIndex(active, hasAnyActive, item.id === firstRowId)}
                      onClick={() => navigate(terminalRouteFor(item))}
                    >
                      <TerminalIcon className="terminal-nav-row-icon" size={14} strokeWidth={1.7} />
                      <span className="terminal-nav-row-main">
                        <span className="terminal-nav-row-title">
                          <span>{item.title}</span>
                        </span>
                        <span className="terminal-nav-row-detail">{item.detail || item.session.sourceSessionId}</span>
                      </span>
                      <span className="terminal-nav-badges">
                        <span className="terminal-nav-badge terminal-nav-badge--backend">{item.surface.backend}</span>
                        <span className="terminal-nav-badge">{item.condition}</span>
                      </span>
                    </button>
                    <div className="terminal-nav-row-actions">
                      <button
                        type="button"
                        className={`terminal-nav-action${route.view === "terminal" && active && route.mode === "takeover" ? " terminal-nav-action--selected" : ""}`}
                        onClick={() => navigate(terminalRouteFor(item, "takeover"))}
                        title="Enter this terminal"
                        aria-label="Enter this terminal"
                      >
                        <LogIn size={12} strokeWidth={1.8} />
                        <span>Enter</span>
                      </button>
                      <button
                        type="button"
                        className={`terminal-nav-action${route.view === "terminal" && active && route.mode === "observe" ? " terminal-nav-action--selected" : ""}`}
                        onClick={() => navigate(terminalRouteFor(item, "observe"))}
                        title="Observe this terminal read-only"
                        aria-label="Observe this terminal read-only"
                      >
                        <Eye size={12} strokeWidth={1.8} />
                        <span>Observe</span>
                      </button>
                    </div>
                  </div>
                );
              })}
              {visibleItems.length === 0 && state.state !== "loading" && (
                <div className="terminal-nav-empty">No sessions</div>
              )}
            </div>

            <div className="terminal-nav-section">
              <div className="terminal-nav-section-title">
                <span>Agents</span>
                <span>{visibleAgents.length}</span>
              </div>
              {visibleAgents.map((agent) => {
                const key = `agent:${agent.id}`;
                const active = key === activeAgentKey;
                const terminalSurface = resolveAgentTerminalSurface(agent);
                return (
                  <div
                    key={agent.id}
                    className={`terminal-nav-row terminal-nav-row--agent${active ? " terminal-nav-row--active" : ""}`}
                    title={agent.name}
                  >
                    <button
                      type="button"
                      data-list-primary
                      className="terminal-nav-row-select"
                      tabIndex={rovingTabIndex(active, hasAnyActive, key === firstRowId)}
                      onClick={() => navigate(terminalRouteForAgent(agent))}
                    >
                      <span className={`terminal-nav-agent-dot${terminalSurface ? " terminal-nav-agent-dot--bound" : ""}`} aria-hidden />
                      <span className="terminal-nav-row-main">
                        <span className="terminal-nav-row-title">
                          <span>{agent.name}</span>
                        </span>
                        <span className="terminal-nav-row-detail">{terminalAgentDetail(agent)}</span>
                      </span>
                      <span className="terminal-nav-badges">
                        <span className="terminal-nav-badge terminal-nav-badge--backend">{terminalSurface?.backend ?? agent.harness ?? "agent"}</span>
                        <span className="terminal-nav-badge">{terminalSurface ? "bound" : agentStateLabel(agent.state)}</span>
                      </span>
                    </button>
                    <div className="terminal-nav-row-actions">
                      <button
                        type="button"
                        className={`terminal-nav-action${route.view === "terminal" && active && route.mode === "takeover" ? " terminal-nav-action--selected" : ""}`}
                        onClick={() => navigate(terminalRouteForAgent(agent, "takeover"))}
                        title="Enter this agent terminal"
                        aria-label="Enter this agent terminal"
                      >
                        <LogIn size={12} strokeWidth={1.8} />
                        <span>Enter</span>
                      </button>
                      {terminalSurface && (
                        <button
                          type="button"
                          className={`terminal-nav-action${route.view === "terminal" && active && route.mode === "observe" ? " terminal-nav-action--selected" : ""}`}
                          onClick={() => navigate(terminalRouteForAgent(agent, "observe"))}
                          title="Observe this agent terminal read-only"
                          aria-label="Observe this agent terminal read-only"
                        >
                          <Eye size={12} strokeWidth={1.8} />
                          <span>Observe</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {visibleAgents.length === 0 && (
                <div className="terminal-nav-empty">No agents</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function sortTerminalAgentsForNav(agents: Agent[]): Agent[] {
  return [...agents]
    .filter((agent) => !agent.retiredFromFleet)
    .sort((a, b) => {
      const surfaceRank = Number(Boolean(resolveAgentTerminalSurface(b))) - Number(Boolean(resolveAgentTerminalSurface(a)));
      if (surfaceRank !== 0) return surfaceRank;
      const updatedRank = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
      if (updatedRank !== 0) return updatedRank;
      return a.name.localeCompare(b.name);
    });
}

function terminalAgentDetail(agent: Agent): string {
  const workspace = agent.project
    ?? basename(agent.cwd)
    ?? basename(agent.projectRoot)
    ?? agent.definitionId;
  return [
    agent.handle ? `@${agent.handle}` : null,
    agent.harness,
    workspace,
    agent.branch,
  ].filter(Boolean).join(" · ");
}

function terminalAgentSearchable(agent: Agent): string {
  return [
    agent.name,
    agent.handle,
    agent.harness,
    agent.state,
    agent.project,
    agent.branch,
    agent.cwd,
    agent.projectRoot,
    agent.definitionId,
  ].filter(Boolean).join(" ").toLowerCase();
}

function basename(path: string | null | undefined): string | null {
  const trimmed = path?.trim().replace(/\/+$/u, "");
  if (!trimmed) return null;
  return trimmed.split("/").pop() || trimmed;
}
