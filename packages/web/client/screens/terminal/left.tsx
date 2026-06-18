import { Eye, LogIn, RefreshCw, Terminal as TerminalIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchTerminalSessions, surfaceKey, terminalListItems } from "../../lib/terminal-sessions.ts";
import type { TerminalSessionRecord } from "@openscout/protocol";
import { makeSearchHandoff, rovingTabIndex, useListArrowNav, useSlashToFocus } from "../../lib/keyboard-nav.ts";
import { useScout } from "../../scout/Provider.tsx";
import "../../scout/slots/ctx-panel.css";
import "../../scout/slots/terminal-left-panel.css";

const TERMINAL_NAV_REFRESH_MS = 8_000;

export function TerminalLeft() {
  const { route, navigate } = useScout();
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
    void fetchTerminalSessions()
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
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = normalizedQuery
    ? items.filter((item) => item.searchable.includes(normalizedQuery))
    : items;
  const activeKey = route.view === "terminal" && route.terminalSurfaceKey
    ? route.terminalSessionId
      ? `${route.terminalSessionId}:${route.terminalSurfaceKey}`
      : route.terminalSurfaceKey
    : null;
  const hasAnyActive = activeKey != null && visibleItems.some((item) =>
    item.id === activeKey || item.key === activeKey
  );
  const firstItemId = visibleItems[0]?.id;
  const summary = state.state === "loading"
    ? "Syncing"
    : normalizedQuery
      ? `${visibleItems.length}/${items.length}`
      : `${items.length} available`;
  const terminalRouteFor = (
    item: ReturnType<typeof terminalListItems>[number],
    mode?: "takeover" | "observe",
  ) => ({
    view: "terminal" as const,
    terminalSessionId: item.session.id,
    terminalSurfaceKey: surfaceKey(item.surface),
    ...(mode ? { mode } : {}),
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
        {visibleItems.length === 0 && state.state !== "loading" ? (
          <div className="ctx-panel-empty">{items.length === 0 ? "No terminals" : "No matches"}</div>
        ) : (
          visibleItems.map((item) => {
            const active = item.id === activeKey || item.key === activeKey;
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
                  tabIndex={rovingTabIndex(active, hasAnyActive, item.id === firstItemId)}
                  onClick={() => navigate(terminalRouteFor(item))}
                >
                  <TerminalIcon className="terminal-nav-row-icon" size={14} strokeWidth={1.7} />
                  <span className="terminal-nav-row-main">
                    <span className="terminal-nav-row-title">
                      <span>{item.title}</span>
                    </span>
                    <span className="terminal-nav-row-detail">{item.detail}</span>
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
          })
        )}
      </div>
    </div>
  );
}
