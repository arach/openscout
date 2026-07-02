import "./terminal-screen.css";

import {
  ExternalLink,
  Eye,
  Grid2X2,
  LogIn,
  MoreHorizontal,
  Plus,
  Power,
  RefreshCw,
  Square,
  Terminal as TerminalIcon,
  X,
  Zap,
} from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useContextMenu } from "../../components/ContextMenu.tsx";
import { api } from "../../lib/api.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { actorColor } from "../../lib/colors.ts";
import {
  resolveScoutTerminalRelayHealthUrl,
  resolveScoutTerminalRelayUrl,
} from "../../lib/runtime-config.ts";
import {
  absoluteRouteUrl,
  buildTerminalRouteBase,
  clearTerminalRelayStorage,
  controlTerminalSurface,
  destroyTerminalRelaySession,
  resolveAgentTerminalSurface,
  resolveTerminalRelayBinding,
  SCOUT_TERMINAL_INITIAL_COLS,
  SCOUT_TERMINAL_INITIAL_ROWS,
  shouldBootstrapTakeover,
  withTerminalMode,
} from "../../lib/terminal-relay.ts";
import {
  fetchTerminalSessions,
  resolveRegisteredTerminalTarget,
  surfaceKey,
  terminalConditionLabel,
  terminalListItems,
  terminalSummaryDetailRows,
  terminalSurfaceDescriptorFromRegisteredSurface,
  type RegisteredTerminalTarget,
} from "../../lib/terminal-sessions.ts";
import { useTerminalRelay, TerminalRelay } from "hudsonkit/terminal";
import { queueTakeover } from "../../lib/terminal-takeover.ts";
import { createVantageHandoff, formatVantageLinkLabel } from "../../lib/vantage.ts";
import { agentStateLabel } from "../../lib/agent-state.ts";
import { useScout } from "../../scout/Provider.tsx";
import { BackToPicker } from "../../scout/slots/BackToPicker.tsx";
import { TmuxPeekPanel } from "../../scout/inspector/TmuxPeek.tsx";
import type { MenuItem } from "../../components/ContextMenu.tsx";
import type { Agent, Route, SessionCatalogWithResume, TerminalSurfaceDescriptor } from "../../lib/types.ts";
import type { useScout as UseScout } from "../../scout/Provider.tsx";

export type TerminalNavigate = ReturnType<typeof UseScout>["navigate"];
export type TerminalRoute = Extract<Route, { view: "terminal" }>;
type HudsonTerminalRelayOptions = Parameters<typeof useTerminalRelay>[0];
type ScoutTerminalRelayOptions = Omit<HudsonTerminalRelayOptions, "backend"> & {
  backend?: "pty" | "tmux" | "zellij";
  terminalSession?: string;
  zellijSession?: string;
  zellijSocketDir?: string;
};

export type TerminalContentProps = {
  route: TerminalRoute;
  navigate: TerminalNavigate;
};

/** @deprecated Prefer {@link TerminalContent} with a terminal route. */
export type TerminalScreenProps = {
  agentId?: string;
  mode?: "observe" | "takeover";
  terminalSessionId?: string;
  terminalSurfaceKey?: string;
  navigate: TerminalNavigate;
};

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type TerminalSessionsState =
  | { state: "loading"; sessions: Awaited<ReturnType<typeof fetchTerminalSessions>> }
  | { state: "ready"; sessions: Awaited<ReturnType<typeof fetchTerminalSessions>> }
  | { state: "failed"; sessions: Awaited<ReturnType<typeof fetchTerminalSessions>>; error: string };

type TerminalBackend = NonNullable<TerminalRoute["terminalBackend"]>;
type TerminalAgentKind = NonNullable<TerminalRoute["terminalAgent"]>;

type FreshTerminalTileModel = {
  id: string;
  kind: "fresh";
  backend: TerminalBackend;
  agent: TerminalAgentKind;
  sessionName?: string;
  zellijSocketDir?: string;
};

type RegisteredTerminalTileModel = {
  id: string;
  kind: "registered";
  target: RegisteredTerminalTarget;
};

type TerminalWorkspaceTileModel = FreshTerminalTileModel | RegisteredTerminalTileModel;

function useTerminalSessionsTarget(
  terminalSessionId: string | undefined,
  terminalSurfaceKey: string | undefined,
) {
  const [state, setState] = useState<TerminalSessionsState>({ state: "loading", sessions: [] });

  const loadSessions = useCallback(() => {
    setState((current) => ({ state: "loading", sessions: current.sessions }));
    void fetchTerminalSessions({ includeDiscovered: true })
      .then((sessions) => {
        setState({ state: "ready", sessions });
      })
      .catch((error) => {
        setState((current) => ({
          state: "failed",
          sessions: current.sessions,
          error: error instanceof Error ? error.message : String(error),
        }));
      });
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const target = useMemo(
    () => resolveRegisteredTerminalTarget(state.sessions, terminalSessionId, terminalSurfaceKey),
    [state.sessions, terminalSessionId, terminalSurfaceKey],
  );

  return {
    target,
    loadState: state.state,
    loadSessions,
    hasSessionHint: Boolean(terminalSessionId),
  };
}

function useTerminalTakeoverBootstrap(
  agentId: string | undefined,
  agent: Agent | null,
  mode: "observe" | "takeover" | undefined,
) {
  const needsBootstrap = shouldBootstrapTakeover(agent, mode);
  const [state, setState] = useState<
    | { state: "ready" }
    | { state: "preparing" }
    | { state: "failed"; error: string }
  >(needsBootstrap ? { state: "preparing" } : { state: "ready" });
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!needsBootstrap || !agentId) {
      setState({ state: "ready" });
      return;
    }

    let cancelled = false;
    setState({ state: "preparing" });

    api<SessionCatalogWithResume>(`/api/agents/${encodeURIComponent(agentId)}/session-catalog`)
      .then((catalog) => {
        if (!catalog.resumeCommand) return;
        return queueTakeover({
          command: catalog.resumeCommand,
          cwd: catalog.resumeCwd,
          agentId,
        });
      })
      .then(() => {
        if (!cancelled) setState({ state: "ready" });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            state: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, needsBootstrap, retryNonce]);

  return {
    ready: state.state === "ready",
    label: state.state === "failed" ? "TAKEOVER FAILED" : "PREPARING TAKEOVER",
    status: state.state === "failed" ? state.error : "Resolving live session...",
    onRetry: state.state === "failed" ? () => setRetryNonce((value) => value + 1) : undefined,
  };
}

type HandoffState =
  | { state: "idle" }
  | { state: "opening" }
  | { state: "opened"; detail: string }
  | { state: "failed"; error: string };

function useTerminalRelaySession(params: {
  agentId?: string;
  agent: Agent | null;
  mode?: "observe" | "takeover";
  navigate: (route: Route) => void;
  registeredTarget?: RegisteredTerminalTarget;
  showContextMenu: (event: ReactMouseEvent, items: MenuItem[]) => void;
}) {
  const { agentId, agent, mode, navigate, registeredTarget, showContextMenu } = params;
  const color = agent ? actorColor(agent.name) : "var(--accent)";
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const terminalSurface: TerminalSurfaceDescriptor | null = registeredTarget
    ? terminalSurfaceDescriptorFromRegisteredSurface(registeredTarget.surface)
    : resolveAgentTerminalSurface(agent);
  const readOnly = mode === "observe";
  const cwd = registeredTarget?.session.cwd ?? agent?.cwd ?? agent?.projectRoot ?? undefined;
  const relayUrl = resolveScoutTerminalRelayUrl();
  const healthUrl = resolveScoutTerminalRelayHealthUrl();
  const binding = resolveTerminalRelayBinding({
    agentId,
    agent,
    registeredTarget,
    terminalSurface,
    relayUrl,
    harness: registeredTarget?.session.harness ?? agent?.harness,
    cwd,
  });
  const [handoffState, setHandoffState] = useState<HandoffState>({ state: "idle" });

  const relay = useTerminalRelay({
    url: binding.scopedRelayUrl,
    healthUrl,
    autoConnect: true,
    sessionKey: binding.relayStorageSessionKey,
    ...(binding.surfaceOptions ?? {}),
    ...(binding.orphanTTL ? { orphanTTL: binding.orphanTTL } : {}),
    ...(binding.cwd ? { cwd: binding.cwd } : {}),
    ...(binding.relayAgent ? { agent: binding.relayAgent } : {}),
  } as Parameters<typeof useTerminalRelay>[0]);

  useBrowserLayoutEffect(() => {
    relay.resize(SCOUT_TERMINAL_INITIAL_COLS, SCOUT_TERMINAL_INITIAL_ROWS);
  }, [relay.resize]);

  const terminalRelay = useMemo(() => {
    if (!readOnly) return relay;
    return {
      ...relay,
      sendInput: () => {},
      sendLine: () => {},
      restart: () => {},
    };
  }, [readOnly, relay]);

  const terminalRouteBase = buildTerminalRouteBase({ agentId, registeredTarget });
  const currentTerminalRoute = withTerminalMode(terminalRouteBase, mode);

  const focusTerminal = useCallback(() => {
    const root = terminalBodyRef.current;
    root?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")?.focus();
    root?.querySelector<HTMLElement>(".xterm")?.focus();
  }, []);

  const runSurfaceControl = useCallback((action: Parameters<typeof controlTerminalSurface>[1]) => {
    if (!terminalSurface) return null;
    return controlTerminalSurface(terminalSurface, action);
  }, [terminalSurface]);

  const copyTerminalLink = useCallback(() => {
    void copyTextToClipboard(absoluteRouteUrl(currentTerminalRoute));
  }, [currentTerminalRoute]);

  const pasteClipboard = useCallback(() => {
    if (readOnly || !navigator.clipboard?.readText) return;
    void navigator.clipboard.readText()
      .then((text) => {
        if (text) terminalRelay.sendInput(text);
      })
      .catch(() => {});
  }, [readOnly, terminalRelay]);

  const detachRelay = useCallback(() => {
    clearTerminalRelayStorage(binding.relayStorageSessionKey);
    const surfaceControl = runSurfaceControl("detach");
    if (surfaceControl) {
      void surfaceControl.finally(() => relay.disconnect());
      return;
    }
    relay.disconnect();
  }, [binding.relayStorageSessionKey, relay, runSurfaceControl]);

  const reconnectRelay = useCallback(() => {
    clearTerminalRelayStorage(binding.relayStorageSessionKey);
    const surfaceControl = runSurfaceControl("force-quit-bridge");
    if (surfaceControl) {
      void surfaceControl.finally(() => {
        relay.connect();
        window.setTimeout(focusTerminal, 250);
      });
      return;
    }
    relay.connect();
    window.setTimeout(focusTerminal, 250);
  }, [binding.relayStorageSessionKey, focusTerminal, relay, runSurfaceControl]);

  const interruptTerminal = useCallback(() => {
    if (readOnly) return;
    const surfaceControl = runSurfaceControl("interrupt");
    if (surfaceControl) {
      void surfaceControl.catch(() => terminalRelay.sendInput("\x03"));
    } else {
      terminalRelay.sendInput("\x03");
    }
    focusTerminal();
  }, [focusTerminal, readOnly, runSurfaceControl, terminalRelay]);

  const quitTerminal = useCallback(() => {
    if (readOnly) return;
    const surfaceControl = runSurfaceControl("quit");
    if (surfaceControl) {
      void surfaceControl.catch(() => terminalRelay.sendInput("\x04"));
    } else {
      terminalRelay.sendInput("\x04");
    }
    focusTerminal();
  }, [focusTerminal, readOnly, runSurfaceControl, terminalRelay]);

  const stopTerminalJob = useCallback(() => {
    if (readOnly) return;
    const surfaceControl = runSurfaceControl("stop-job");
    if (surfaceControl) {
      void surfaceControl.finally(focusTerminal);
      return;
    }
    focusTerminal();
  }, [focusTerminal, readOnly, runSurfaceControl]);

  const forceQuitClaudeInstance = useCallback(() => {
    clearTerminalRelayStorage(binding.relayStorageSessionKey);
    if (terminalSurface && !window.confirm(`Force quit Claude in ${terminalSurface.sessionName}?`)) {
      return;
    }
    const surfaceControl = runSurfaceControl("force-quit");
    if (surfaceControl) {
      void surfaceControl.finally(() => relay.disconnect());
      return;
    }
    const sessionId = relay.sessionId;
    if (!sessionId) {
      relay.disconnect();
      return;
    }
    void destroyTerminalRelaySession(sessionId)
      .catch(() => {})
      .finally(() => relay.disconnect());
  }, [binding.relayStorageSessionKey, relay, runSurfaceControl, terminalSurface]);

  const restartResumeClaudeInstance = useCallback(() => {
    if (!terminalSurface) return;
    if (!window.confirm(`Restart Claude in ${terminalSurface.sessionName} and resume its latest session?`)) {
      return;
    }
    clearTerminalRelayStorage(binding.relayStorageSessionKey);
    const surfaceControl = runSurfaceControl("restart-resume");
    if (surfaceControl) {
      void surfaceControl.finally(() => {
        relay.disconnect();
        window.setTimeout(() => {
          relay.connect();
          window.setTimeout(focusTerminal, 250);
        }, 600);
      });
    }
  }, [binding.relayStorageSessionKey, focusTerminal, relay, runSurfaceControl, terminalSurface]);

  const openMode = useCallback((nextMode: "observe" | "takeover") => {
    navigate(withTerminalMode(terminalRouteBase, nextMode));
  }, [navigate, terminalRouteBase]);

  const openSummary = useCallback(() => {
    navigate(terminalRouteBase);
  }, [navigate, terminalRouteBase]);

  const openInVantage = useCallback(() => {
    if (handoffState.state === "opening") return;
    setHandoffState({ state: "opening" });
    void createVantageHandoff({ agentId: agentId ?? null, launch: true })
      .then((handoff) => {
        const nodeCount = handoff.plan.manifest.nodes.length;
        const linkLabel = formatVantageLinkLabel(handoff);
        if (nodeCount === 0) {
          const diagnostic = handoff.plan.diagnostics.find((candidate) => candidate.severity === "warning")
            ?? handoff.plan.diagnostics[0];
          setHandoffState({
            state: "failed",
            error: diagnostic
              ? `${linkLabel} · no windows: ${diagnostic.message}`
              : `${linkLabel} · no Vantage windows.`,
          });
          return;
        }
        if (!handoff.launch.ok && handoff.launch.error) {
          setHandoffState({ state: "failed", error: handoff.launch.error });
          return;
        }
        const launchDetail = handoff.launch.ok ? "Vantage launch requested" : "Vantage handoff written";
        setHandoffState({
          state: "opened",
          detail: `${linkLabel} · ${nodeCount} node${nodeCount === 1 ? "" : "s"} · ${launchDetail}`,
        });
      })
      .catch((error) => {
        setHandoffState({
          state: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [agentId, handoffState.state]);

  const sessionMenuItems = useMemo<MenuItem[]>(() => {
    const items: MenuItem[] = [
      { kind: "action", label: "Detach Terminal Clients", onSelect: detachRelay },
      { kind: "action", label: "Reconnect Terminal Session", onSelect: reconnectRelay },
      { kind: "separator" },
      { kind: "action", label: "Restart Claude From Session", onSelect: restartResumeClaudeInstance },
      { kind: "action", label: "Force Quit Claude", onSelect: forceQuitClaudeInstance },
    ];
    if (agentId) {
      items.push(
        { kind: "separator" },
        {
          kind: "action",
          label: handoffState.state === "opening" ? "Opening in Vantage..." : "Open in Vantage",
          onSelect: openInVantage,
        },
      );
    }
    return items;
  }, [
    agentId,
    detachRelay,
    forceQuitClaudeInstance,
    handoffState.state,
    openInVantage,
    reconnectRelay,
    restartResumeClaudeInstance,
  ]);

  const handleSessionMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    showContextMenu(event, sessionMenuItems);
  }, [sessionMenuItems, showContextMenu]);

  const handleTerminalContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const selection = typeof window === "undefined" ? "" : window.getSelection()?.toString() ?? "";
    const items: MenuItem[] = [];
    if (selection.trim()) {
      items.push({
        kind: "action",
        label: "Copy Selection",
        shortcut: "⌘C",
        onSelect: () => void copyTextToClipboard(selection),
      });
    }
    if (!readOnly) {
      items.push(
        { kind: "action", label: "Paste", shortcut: "⌘V", onSelect: pasteClipboard },
        { kind: "action", label: "Send Ctrl-C", shortcut: "⌃C", onSelect: interruptTerminal },
        { kind: "action", label: "Quit With Ctrl-D", shortcut: "⌃D", onSelect: quitTerminal },
        { kind: "action", label: "Stop Running Job", onSelect: stopTerminalJob },
      );
    }
    if (items.length > 0) items.push({ kind: "separator" });
    items.push(
      { kind: "action", label: "Focus Terminal", onSelect: focusTerminal },
      ...sessionMenuItems,
      { kind: "separator" },
      {
        kind: "action",
        label: readOnly ? "Open Takeover" : "Open Observe",
        onSelect: () => openMode(readOnly ? "takeover" : "observe"),
      },
      { kind: "action", label: "Open Summary", onSelect: openSummary },
      { kind: "action", label: "Copy Terminal Link", onSelect: copyTerminalLink },
    );
    showContextMenu(event, items);
  }, [
    copyTerminalLink,
    focusTerminal,
    interruptTerminal,
    openMode,
    openSummary,
    pasteClipboard,
    quitTerminal,
    readOnly,
    sessionMenuItems,
    showContextMenu,
    stopTerminalJob,
  ]);

  return {
    color,
    terminalBodyRef,
    terminalSurface,
    readOnly,
    relay,
    terminalRelay,
    handoffState,
    healthUrl,
    scopedRelayUrl: binding.scopedRelayUrl,
    hasViewActions: Boolean(registeredTarget || terminalSurface),
    canSignalTerminal: !readOnly && Boolean(terminalSurface || relay.status === "connected"),
    canStopTerminalJob: !readOnly && Boolean(terminalSurface),
    handleSessionMenu,
    handleTerminalContextMenu,
    openMode,
    openSummary,
    interruptTerminal,
    quitTerminal,
    stopTerminalJob,
    terminalRouteBase: terminalRouteBase as TerminalRoute,
  };
}

function TerminalPlaceholder({
  agent,
  agentId,
  color,
  navigate,
  label,
  status,
  onRetry,
}: {
  agent: Agent | null;
  agentId?: string;
  color: string;
  navigate: (route: Route) => void;
  label: string;
  status: string;
  onRetry?: () => void;
}) {
  return (
    <div className="s-term">
      <div className="s-term-bar">
        <BackToPicker
          slot="terminal"
          fallback={{ view: "terminal" }}
          navigate={navigate}
          className="s-term-back"
        />
        {agent && (
          <div className="s-term-agent">
            <div
              className="s-ops-avatar"
              style={{ "--size": "18px", background: color } as CSSProperties}
            >
              {agent.name[0]?.toUpperCase()}
            </div>
            <span className="s-term-agent-name">{agent.name}</span>
            {agent.handle && (
              <span className="s-term-agent-handle">@{agent.handle}</span>
            )}
          </div>
        )}
        <span className="s-term-label">{label}</span>
        <div className="s-term-status">
          {onRetry ? "OFFLINE" : "CONNECTING"}
        </div>
      </div>
      <div className="s-term-body s-term-body--placeholder">
        <div className="s-term-placeholder">
          <span>{status}</span>
          {onRetry && (
            <button type="button" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TerminalSummary({
  target,
  navigate,
}: {
  target: RegisteredTerminalTarget;
  navigate: (route: Route) => void;
}) {
  const item = useMemo(
    () => terminalListItems([target.session]).find((candidate) => surfaceKey(candidate.surface) === surfaceKey(target.surface)),
    [target],
  );
  const routeBase = {
    view: "terminal" as const,
    terminalSessionId: target.session.id,
    terminalSurfaceKey: surfaceKey(target.surface),
  };
  const condition = terminalConditionLabel(target.session, target.surface);
  const detailRows = terminalSummaryDetailRows(target);

  return (
    <div className="s-term s-term--summary">
      <div className="s-term-summary">
        <div className="s-term-summary-main">
          <BackToPicker
            slot="terminal"
            fallback={{ view: "terminal" }}
            navigate={navigate}
            className="s-term-back"
          />
          <div className="s-term-summary-mark">
            <TerminalIcon size={18} strokeWidth={1.7} />
            <span>Terminal</span>
          </div>
          <div className="s-term-summary-heading">
            <h1>{item?.title ?? target.surface.sessionName}</h1>
            <p>{target.surface.backend} · {condition}</p>
          </div>
          <div className="s-term-summary-actions">
            <button
              type="button"
              className="s-term-summary-action s-term-summary-action--primary"
              onClick={() => navigate(withTerminalMode(routeBase, "takeover"))}
            >
              <LogIn size={14} strokeWidth={1.8} />
              <span>Enter</span>
            </button>
            <button
              type="button"
              className="s-term-summary-action"
              onClick={() => navigate(withTerminalMode(routeBase, "observe"))}
            >
              <Eye size={14} strokeWidth={1.8} />
              <span>Observe</span>
            </button>
          </div>
        </div>
        <div className="s-term-summary-preview">
          <TmuxPeekPanel
            surface={target.surface}
            lines={26}
            columns={112}
            pollMs={30_000}
            idlePollMs={30_000}
            className="s-term-preview-peek"
          />
        </div>
        <dl className="s-term-summary-details">
          {detailRows.map(([label, value]) => (
            <div key={label} className="s-term-summary-detail">
              <dt>{label}</dt>
              <dd title={value}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function TerminalRelayCanvas({
  agentId,
  agent,
  mode,
  navigate,
  registeredTarget,
  embedded = false,
  tileActions,
}: {
  agentId?: string;
  agent: Agent | null;
  mode?: "observe" | "takeover";
  navigate: (route: Route) => void;
  registeredTarget?: RegisteredTerminalTarget;
  embedded?: boolean;
  tileActions?: ReactNode;
}) {
  const showContextMenu = useContextMenu();
  const session = useTerminalRelaySession({
    agentId,
    agent,
    mode,
    navigate,
    registeredTarget,
    showContextMenu,
  });

  return (
    <div className={`s-term${embedded ? " s-term--embedded" : ""}`}>
      <div className="s-term-bar s-term-bar--takeover">
        <div className="s-term-bar-left">
          {!embedded && (
            <BackToPicker
              slot="terminal"
              fallback={{ view: "terminal" }}
              navigate={navigate}
              className="s-term-back"
            />
          )}
          {agent && (
            <div className="s-term-agent">
              <div
                className="s-ops-avatar"
                style={{ "--size": "18px", background: session.color } as CSSProperties}
              >
                {agent.name[0]?.toUpperCase()}
              </div>
              <span className="s-term-agent-name">{agent.name}</span>
              {agent.handle && (
                <span className="s-term-agent-handle">@{agent.handle}</span>
              )}
            </div>
          )}
          {registeredTarget && (
            <div className="s-term-registered-chip">
              <TerminalIcon size={14} strokeWidth={1.8} />
              <span>{registeredTarget.session.harness}</span>
              <span>{registeredTarget.session.sourceSessionId}</span>
            </div>
          )}
        </div>
        <div className="s-term-bar-meta">
          <span className="s-term-label">
            {session.terminalSurface ? (session.readOnly ? "TERMINAL OBSERVE" : "TERMINAL TAKEOVER") : "TAKEOVER"}
          </span>
          {session.terminalSurface && (
            <span className="s-term-session" title={session.terminalSurface.sessionName}>
              {session.terminalSurface.backend} · {session.terminalSurface.sessionName}
            </span>
          )}
        </div>
        <div className="s-term-bar-actions">
          {session.hasViewActions && (
            <div className="s-term-action-cluster s-term-action-cluster--view" aria-label="Terminal view actions">
              {registeredTarget && (
                <button
                  type="button"
                  className="s-term-vantage"
                  onClick={session.openSummary}
                  title="Leave the terminal canvas and show the session summary"
                >
                  Summary
                </button>
              )}
              {session.terminalSurface && (
                <button
                  type="button"
                  className="s-term-vantage"
                  onClick={() => session.openMode(session.readOnly ? "takeover" : "observe")}
                  title={session.readOnly ? "Switch to interactive takeover" : "Switch to read-only terminal observe"}
                >
                  {session.readOnly ? "Takeover" : "Observe"}
                </button>
              )}
            </div>
          )}
          {(session.canSignalTerminal || session.canStopTerminalJob) && (
            <div className="s-term-action-cluster s-term-action-cluster--signals" aria-label="Terminal signal actions">
              {session.canSignalTerminal && (
                <button
                  type="button"
                  className="s-term-vantage s-term-vantage--warn"
                  onClick={session.interruptTerminal}
                  title="Send Ctrl-C to the terminal"
                >
                  <Zap size={13} strokeWidth={1.8} />
                  <span>Ctrl-C</span>
                </button>
              )}
              {session.canSignalTerminal && (
                <button
                  type="button"
                  className="s-term-vantage s-term-vantage--warn"
                  onClick={session.quitTerminal}
                  title="Send Ctrl-D / EOF to the terminal"
                >
                  <Power size={13} strokeWidth={1.8} />
                  <span>Quit</span>
                </button>
              )}
              {session.canStopTerminalJob && (
                <button
                  type="button"
                  className="s-term-vantage s-term-vantage--warn"
                  onClick={session.stopTerminalJob}
                  title="Stop Claude's current shell/tool job without quitting Claude"
                >
                  <Square size={12} strokeWidth={2} />
                  <span>Stop Job</span>
                </button>
              )}
            </div>
          )}
          <button
            type="button"
            className="s-term-vantage s-term-session-menu"
            onClick={session.handleSessionMenu}
            title="Open session, recovery, and external handoff actions"
          >
            <MoreHorizontal size={14} strokeWidth={1.8} />
            <span>Session</span>
          </button>
          {session.handoffState.state === "opening" && (
            <span className="s-term-handoff">Opening Vantage...</span>
          )}
          {session.handoffState.state === "opened" && (
            <span className="s-term-handoff s-term-handoff--ok">{session.handoffState.detail}</span>
          )}
          {session.handoffState.state === "failed" && (
            <span className="s-term-handoff s-term-handoff--error">{session.handoffState.error}</span>
          )}
          <div className="s-term-status">
            {session.relay.status === "connected"
              ? "LIVE"
              : session.relay.status === "connecting"
                ? "CONNECTING"
                : "OFFLINE"}
          </div>
          {tileActions}
        </div>
      </div>
      <div
        ref={session.terminalBodyRef}
        className="s-term-body"
        onContextMenuCapture={session.handleTerminalContextMenu}
      >
        <TerminalRelay
          relay={session.terminalRelay}
          fontSize={13}
          quiet
          configItems={[
            ...(session.terminalSurface
              ? [
                  { label: "backend", value: session.terminalSurface.backend },
                  { label: "session", value: session.terminalSurface.sessionName },
                  ...(session.terminalSurface.paneId ? [{ label: "pane", value: session.terminalSurface.paneId }] : []),
                  ...(session.terminalSurface.socketDir ? [{ label: "socket", value: session.terminalSurface.socketDir }] : []),
                  { label: "mode", value: session.readOnly ? "read-only" : "takeover" },
                ]
              : []),
            { label: "ws", value: session.scopedRelayUrl },
            { label: "health", value: session.healthUrl },
          ]}
        />
      </div>
    </div>
  );
}

function RegisteredTerminalSessions({
  terminalSessionId,
  terminalSurfaceKey,
  mode,
  navigate,
}: {
  terminalSessionId?: string;
  terminalSurfaceKey?: string;
  mode?: "observe" | "takeover";
  navigate: (route: Route) => void;
}) {
  const { target, loadState, loadSessions, hasSessionHint } = useTerminalSessionsTarget(
    terminalSessionId,
    terminalSurfaceKey,
  );

  if (target && mode) {
    return (
      <TerminalRelayCanvas
        agent={null}
        mode={mode}
        navigate={navigate}
        registeredTarget={target}
      />
    );
  }

  if (target) {
    return <TerminalSummary target={target} navigate={navigate} />;
  }

  return (
    <div className="s-term s-term--empty-main">
      <div className="s-term-empty-main-mark">
        <TerminalIcon size={18} strokeWidth={1.6} />
        <span>
          {loadState === "loading"
            ? "Loading terminal"
            : loadState === "failed"
              ? "Terminal list unavailable"
              : hasSessionHint
                ? "Terminal unavailable"
                : "Select a terminal"}
        </span>
        {loadState === "failed" && (
          <button type="button" className="s-term-empty-action" onClick={loadSessions}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

function createTerminalTileId(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function createFreshTerminalTile(
  backend: TerminalBackend,
  agent: TerminalAgentKind = "shell",
): FreshTerminalTileModel {
  const id = createTerminalTileId(backend);
  return {
    id,
    kind: "fresh",
    backend,
    agent,
    ...(backend === "pty" ? {} : { sessionName: `scout-${backend}-${id}` }),
  };
}

function registeredTerminalTileId(target: RegisteredTerminalTarget): string {
  return `registered:${target.session.id}:${surfaceKey(target.surface)}`;
}

function registeredTargetFromListItem(
  item: ReturnType<typeof terminalListItems>[number],
): RegisteredTerminalTarget {
  return { session: item.session, surface: item.surface };
}

function freshTerminalRouteForTile(tile: FreshTerminalTileModel): TerminalRoute {
  return {
    view: "terminal",
    terminalBackend: tile.backend,
    terminalAgent: tile.agent,
    terminalTabId: tile.id,
    ...(tile.sessionName ? { terminalSessionName: tile.sessionName } : {}),
    ...(tile.zellijSocketDir ? { zellijSocketDir: tile.zellijSocketDir } : {}),
  };
}

function registeredTerminalRouteForTarget(
  target: RegisteredTerminalTarget,
  mode: "observe" | "takeover" = "takeover",
): TerminalRoute {
  return {
    view: "terminal",
    terminalSessionId: target.session.id,
    terminalSurfaceKey: surfaceKey(target.surface),
    mode,
  };
}

function openTerminalRouteExternally(route: TerminalRoute, navigate: TerminalNavigate): void {
  if (typeof window === "undefined") {
    navigate(route);
    return;
  }
  window.open(absoluteRouteUrl(route), "_blank", "noopener,noreferrer");
}

function TerminalHome({ navigate }: { navigate: TerminalNavigate }) {
  const { agents } = useScout();
  const [state, setState] = useState<TerminalSessionsState>({ state: "loading", sessions: [] });
  const [tiles, setTiles] = useState<TerminalWorkspaceTileModel[]>([]);
  const [workspaceReload, setWorkspaceReload] = useState(0);

  const loadSessions = useCallback((options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setState((current) => ({ state: "loading", sessions: current.sessions }));
    }
    void fetchTerminalSessions({ includeDiscovered: true })
      .then((sessions) => setState({ state: "ready", sessions }))
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
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") loadSessions({ silent: true });
    };
    const interval = window.setInterval(refreshIfVisible, 8_000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [loadSessions]);

  const terminalItems = useMemo(() => terminalListItems(state.sessions), [state.sessions]);
  const attachableItems = useMemo(
    () => terminalItems.filter((item) => item.surface.state !== "exited"),
    [terminalItems],
  );
  const terminalAgents = useMemo(() => sortTerminalAgents(agents), [agents]);
  const boundAgentCount = useMemo(
    () => terminalAgents.filter((agent) => resolveAgentTerminalSurface(agent)).length,
    [terminalAgents],
  );
  const liveTerminalCount = terminalItems.filter((item) => item.surface.state !== "exited").length;
  const sessionError = state.state === "failed" ? state.error : null;

  useEffect(() => {
    setTiles((current) => {
      let changed = false;
      const next = current.map((tile) => {
        if (tile.kind !== "registered") return tile;
        const nextTarget = resolveRegisteredTerminalTarget(
          state.sessions,
          tile.target.session.id,
          surfaceKey(tile.target.surface),
        );
        if (!nextTarget) return tile;
        if (nextTarget.session === tile.target.session && nextTarget.surface === tile.target.surface) {
          return tile;
        }
        changed = true;
        return { ...tile, target: nextTarget };
      });
      return changed ? next : current;
    });
  }, [state.sessions]);

  const addFreshTile = useCallback((backend: TerminalBackend, agent: TerminalAgentKind = "shell") => {
    setTiles((current) => [...current, createFreshTerminalTile(backend, agent)]);
  }, []);

  const attachRegisteredTarget = useCallback((target: RegisteredTerminalTarget) => {
    const id = registeredTerminalTileId(target);
    setTiles((current) => {
      if (current.some((tile) => tile.id === id)) return current;
      return [...current, { id, kind: "registered", target }];
    });
  }, []);

  const attachLiveTerminals = useCallback(() => {
    const targets = attachableItems.map(registeredTargetFromListItem);
    if (targets.length === 0) return;
    setTiles((current) => {
      const next = [...current];
      const seen = new Set(current.map((tile) => tile.id));
      for (const target of targets) {
        const id = registeredTerminalTileId(target);
        if (seen.has(id)) continue;
        seen.add(id);
        next.push({ id, kind: "registered", target });
      }
      return next;
    });
  }, [attachableItems]);

  const closeTile = useCallback((tileId: string) => {
    setTiles((current) => current.filter((tile) => tile.id !== tileId));
  }, []);

  const reloadWorkspace = useCallback(() => {
    loadSessions();
    setWorkspaceReload((current) => current + 1);
  }, [loadSessions]);

  return (
    <div className="s-term s-term--workspace">
      <div className="s-term-workspace">
        <header className="s-term-workspace-head">
          <div className="s-term-workspace-title">
            <span className="s-term-summary-mark">
              <Grid2X2 size={18} strokeWidth={1.7} />
              <span>Terminals</span>
            </span>
            <h1>Terminal Workspace</h1>
          </div>
          <div className="s-term-workspace-actions" aria-label="Terminal workspace actions">
            <button
              type="button"
              className="s-term-workspace-action s-term-workspace-action--primary"
              onClick={() => addFreshTile("pty")}
              title="New shell tile"
            >
              <Plus size={14} strokeWidth={1.9} />
              <span>Shell</span>
            </button>
            <button
              type="button"
              className="s-term-workspace-action"
              onClick={() => addFreshTile("tmux")}
              title="New tmux tile"
            >
              <TerminalIcon size={14} strokeWidth={1.8} />
              <span>Tmux</span>
            </button>
            <button
              type="button"
              className="s-term-workspace-action"
              onClick={() => addFreshTile("zellij")}
              title="New zellij tile"
            >
              <TerminalIcon size={14} strokeWidth={1.8} />
              <span>Zellij</span>
            </button>
            <button
              type="button"
              className="s-term-workspace-action"
              onClick={attachLiveTerminals}
              disabled={attachableItems.length === 0}
              title="Attach live registered terminals"
            >
              <LogIn size={14} strokeWidth={1.8} />
              <span>Attach</span>
            </button>
            <button
              type="button"
              className="s-term-icon-button"
              onClick={reloadWorkspace}
              disabled={state.state === "loading"}
              title="Reload all terminal tiles"
              aria-label="Reload all terminal tiles"
            >
              <RefreshCw size={14} strokeWidth={1.8} />
            </button>
          </div>
        </header>

        <div className="s-term-home-stats" aria-label="Terminal inventory">
          <Stat label="Tiles" value={tiles.length} />
          <Stat label="Live" value={liveTerminalCount} />
          <Stat label="Registered" value={terminalItems.length} />
          <Stat label="Bound" value={boundAgentCount} />
        </div>

        {sessionError && (
          <div className="s-term-home-error">
            <span>Terminal registry unavailable</span>
            <code>{sessionError}</code>
          </div>
        )}

        {tiles.length === 0 ? (
          <div className="s-term-workspace-empty">
            <Grid2X2 size={22} strokeWidth={1.55} />
            <strong>No terminal tiles</strong>
            <div className="s-term-workspace-empty-actions">
              <button
                type="button"
                className="s-term-workspace-action s-term-workspace-action--primary"
                onClick={() => addFreshTile("pty")}
              >
                <Plus size={14} strokeWidth={1.9} />
                <span>Shell</span>
              </button>
              <button
                type="button"
                className="s-term-workspace-action"
                onClick={attachLiveTerminals}
                disabled={attachableItems.length === 0}
              >
                <LogIn size={14} strokeWidth={1.8} />
                <span>Attach</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="s-term-workspace-grid" aria-label="Terminal tiles">
            {tiles.map((tile) => (
              <TerminalWorkspaceTile
                key={`${tile.id}:${workspaceReload}`}
                tile={tile}
                navigate={navigate}
                onClose={closeTile}
              />
            ))}
          </div>
        )}

        <div className="s-term-workspace-dock">
          <section className="s-term-home-section" aria-labelledby="terminal-workspace-sessions">
            <div className="s-term-home-section-head">
              <h2 id="terminal-workspace-sessions">Live Sessions</h2>
              <span>{state.state === "loading" ? "syncing" : `${terminalItems.length}`}</span>
            </div>
            <div className="s-term-home-list">
              {terminalItems.length === 0 && state.state !== "loading" ? (
                <div className="s-term-home-empty">No registered terminals</div>
              ) : (
                terminalItems.map((item) => (
                  <TerminalHomeSessionRow
                    key={item.id}
                    item={item}
                    navigate={navigate}
                    onAttach={attachRegisteredTarget}
                  />
                ))
              )}
            </div>
          </section>

          <section className="s-term-home-section" aria-labelledby="terminal-workspace-agents">
            <div className="s-term-home-section-head">
              <h2 id="terminal-workspace-agents">Agents</h2>
              <span>{terminalAgents.length}</span>
            </div>
            <div className="s-term-home-list">
              {terminalAgents.length === 0 ? (
                <div className="s-term-home-empty">No known agents</div>
              ) : (
                terminalAgents.map((agent) => (
                  <TerminalHomeAgentRow key={agent.id} agent={agent} navigate={navigate} />
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function TerminalWorkspaceTile({
  tile,
  navigate,
  onClose,
}: {
  tile: TerminalWorkspaceTileModel;
  navigate: TerminalNavigate;
  onClose: (tileId: string) => void;
}) {
  if (tile.kind === "registered") {
    return (
      <RegisteredTerminalWorkspaceTile
        tile={tile}
        navigate={navigate}
        onClose={onClose}
      />
    );
  }
  return (
    <FreshTerminalWorkspaceTile
      tile={tile}
      navigate={navigate}
      onClose={onClose}
    />
  );
}

function FreshTerminalWorkspaceTile({
  tile,
  navigate,
  onClose,
}: {
  tile: FreshTerminalTileModel;
  navigate: TerminalNavigate;
  onClose: (tileId: string) => void;
}) {
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const relayUrl = resolveScoutTerminalRelayUrl();
  const healthUrl = resolveScoutTerminalRelayHealthUrl();
  const label = freshTerminalLabel(tile.backend, tile.agent);
  const route = freshTerminalRouteForTile(tile);
  const sessionKey = [
    "scout-terminal-workspace",
    tile.id,
    tile.backend,
    tile.agent,
    tile.sessionName ?? "pty",
  ].join("-");

  const relay = useTerminalRelay({
    url: relayUrl,
    healthUrl,
    autoConnect: true,
    sessionKey,
    backend: tile.backend,
    ...(tile.sessionName ? { terminalSession: tile.sessionName } : {}),
    ...(tile.backend === "tmux" && tile.sessionName ? { tmuxSession: tile.sessionName } : {}),
    ...(tile.backend === "zellij" && tile.sessionName ? { zellijSession: tile.sessionName } : {}),
    ...(tile.backend === "zellij" && tile.zellijSocketDir ? { zellijSocketDir: tile.zellijSocketDir } : {}),
    agent: tile.agent,
  } as ScoutTerminalRelayOptions as HudsonTerminalRelayOptions);

  useBrowserLayoutEffect(() => {
    relay.resize(SCOUT_TERMINAL_INITIAL_COLS, SCOUT_TERMINAL_INITIAL_ROWS);
  }, [relay.resize]);

  const openStandalone = useCallback(() => {
    openTerminalRouteExternally(route, navigate);
  }, [navigate, route]);

  return (
    <section className="s-term-workspace-tile" aria-label={label.title}>
      <div className="s-term s-term--embedded">
        <div className="s-term-bar s-term-bar--fresh">
          <div className="s-term-bar-left">
            <span className="s-term-workspace-tile-mark">
              <TerminalIcon size={14} strokeWidth={1.8} />
            </span>
            <span className="s-term-workspace-tile-name">{label.title}</span>
          </div>
          <div className="s-term-bar-meta">
            <span className="s-term-label">{tile.backend}</span>
            <span className="s-term-session">{label.detail}</span>
          </div>
          <div className="s-term-bar-actions">
            <button
              type="button"
              className="s-term-icon-button"
              onClick={() => relay.restart()}
              title="Restart terminal"
              aria-label="Restart terminal"
            >
              <RefreshCw size={14} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="s-term-icon-button"
              onClick={openStandalone}
              title="Open terminal in a new window"
              aria-label="Open terminal in a new window"
            >
              <ExternalLink size={14} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="s-term-icon-button s-term-icon-button--danger"
              onClick={() => onClose(tile.id)}
              title="Close tile"
              aria-label="Close tile"
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>
        <div
          ref={terminalBodyRef}
          className="s-term-body"
          onMouseDown={() => {
            terminalBodyRef.current?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")?.focus();
            terminalBodyRef.current?.querySelector<HTMLElement>(".xterm")?.focus();
          }}
        >
          <TerminalRelay
            relay={relay}
            fontSize={13}
            quiet
            configItems={[
              { label: "backend", value: tile.backend },
              { label: "agent", value: tile.agent },
              ...(tile.sessionName ? [{ label: "session", value: tile.sessionName }] : []),
              ...(tile.zellijSocketDir ? [{ label: "socket", value: tile.zellijSocketDir }] : []),
              { label: "ws", value: relayUrl },
              { label: "health", value: healthUrl },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function RegisteredTerminalWorkspaceTile({
  tile,
  navigate,
  onClose,
}: {
  tile: RegisteredTerminalTileModel;
  navigate: TerminalNavigate;
  onClose: (tileId: string) => void;
}) {
  const openStandalone = useCallback(() => {
    openTerminalRouteExternally(registeredTerminalRouteForTarget(tile.target), navigate);
  }, [navigate, tile.target]);

  return (
    <section className="s-term-workspace-tile" aria-label={tile.target.surface.sessionName}>
      <TerminalRelayCanvas
        agent={null}
        mode="takeover"
        navigate={navigate}
        registeredTarget={tile.target}
        embedded
        tileActions={(
          <>
            <button
              type="button"
              className="s-term-icon-button"
              onClick={openStandalone}
              title="Open terminal in a new window"
              aria-label="Open terminal in a new window"
            >
              <ExternalLink size={14} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="s-term-icon-button s-term-icon-button--danger"
              onClick={() => onClose(tile.id)}
              title="Close tile"
              aria-label="Close tile"
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          </>
        )}
      />
    </section>
  );
}

function TerminalHomeSessionRow({
  item,
  navigate,
  onAttach,
}: {
  item: ReturnType<typeof terminalListItems>[number];
  navigate: TerminalNavigate;
  onAttach?: (target: RegisteredTerminalTarget) => void;
}) {
  const routeBase = {
    view: "terminal" as const,
    terminalSessionId: item.session.id,
    terminalSurfaceKey: surfaceKey(item.surface),
  };

  return (
    <div className="s-term-home-row">
      <button
        type="button"
        className="s-term-home-row-main"
        onClick={() => navigate(routeBase)}
      >
        <span className="s-term-home-row-icon">
          <TerminalIcon size={15} strokeWidth={1.8} />
        </span>
        <span className="s-term-home-row-copy">
          <span className="s-term-home-row-title">{item.title}</span>
          <span className="s-term-home-row-detail" title={item.detail}>{item.detail || item.session.sourceSessionId}</span>
        </span>
        <span className="s-term-home-row-badges">
          <span>{item.surface.backend}</span>
          <span>{item.condition}</span>
        </span>
      </button>
      <div className="s-term-home-row-actions">
        {onAttach && (
          <button
            type="button"
            className="s-term-summary-action"
            onClick={() => onAttach(registeredTargetFromListItem(item))}
          >
            <Plus size={13} strokeWidth={1.8} />
            <span>Tile</span>
          </button>
        )}
        <button
          type="button"
          className="s-term-summary-action s-term-summary-action--primary"
          onClick={() => navigate(withTerminalMode(routeBase, "takeover"))}
        >
          <LogIn size={13} strokeWidth={1.8} />
          <span>Enter</span>
        </button>
        <button
          type="button"
          className="s-term-summary-action"
          onClick={() => navigate(withTerminalMode(routeBase, "observe"))}
        >
          <Eye size={13} strokeWidth={1.8} />
          <span>Observe</span>
        </button>
      </div>
    </div>
  );
}

function TerminalHomeAgentRow({
  agent,
  navigate,
}: {
  agent: Agent;
  navigate: TerminalNavigate;
}) {
  const terminalSurface = resolveAgentTerminalSurface(agent);
  const routeBase = { view: "terminal" as const, agentId: agent.id };
  const detail = terminalAgentDetail(agent);

  return (
    <div className="s-term-home-row">
      <button
        type="button"
        className="s-term-home-row-main"
        onClick={() => navigate(withTerminalMode(routeBase, "takeover"))}
      >
        <span className={`s-term-agent-dot${terminalSurface ? " s-term-agent-dot--bound" : ""}`} aria-hidden />
        <span className="s-term-home-row-copy">
          <span className="s-term-home-row-title">{agent.name}</span>
          <span className="s-term-home-row-detail" title={detail}>{detail}</span>
        </span>
        <span className="s-term-home-row-badges">
          <span>{terminalSurface?.backend ?? agent.harness ?? "agent"}</span>
          <span>{terminalSurface ? "bound" : agentStateLabel(agent.state)}</span>
        </span>
      </button>
      <div className="s-term-home-row-actions">
        <button
          type="button"
          className="s-term-summary-action s-term-summary-action--primary"
          onClick={() => navigate(withTerminalMode(routeBase, "takeover"))}
        >
          <LogIn size={13} strokeWidth={1.8} />
          <span>Enter</span>
        </button>
        {terminalSurface && (
          <button
            type="button"
            className="s-term-summary-action"
            onClick={() => navigate(withTerminalMode(routeBase, "observe"))}
          >
            <Eye size={13} strokeWidth={1.8} />
            <span>Observe</span>
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="s-term-home-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function sortTerminalAgents(agents: Agent[]): Agent[] {
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
  const parts = [
    agent.handle ? `@${agent.handle}` : null,
    agent.harness,
    workspace,
    agent.branch,
  ].filter(Boolean);
  return parts.join(" · ");
}

function basename(path: string | null | undefined): string | null {
  const trimmed = path?.trim().replace(/\/+$/u, "");
  if (!trimmed) return null;
  return trimmed.split("/").pop() || trimmed;
}

function NewTerminalSession({
  route,
  navigate,
}: {
  route: TerminalRoute;
  navigate: TerminalNavigate;
}) {
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const backend = route.terminalBackend ?? "pty";
  const agent = route.terminalAgent ?? "shell";
  const tabId = route.terminalTabId ?? "adhoc";
  const generatedSessionName = backend === "pty" ? undefined : `scout-${backend}-${tabId}`;
  const sessionName = route.terminalSessionName ?? generatedSessionName;
  const relayUrl = resolveScoutTerminalRelayUrl();
  const healthUrl = resolveScoutTerminalRelayHealthUrl();
  const label = freshTerminalLabel(backend, agent);
  const sessionKey = [
    "scout-terminal-new",
    backend,
    agent,
    sessionName ?? tabId,
  ].join("-");

  const relay = useTerminalRelay({
    url: relayUrl,
    healthUrl,
    autoConnect: true,
    sessionKey,
    backend,
    ...(sessionName ? { terminalSession: sessionName } : {}),
    ...(backend === "tmux" && sessionName ? { tmuxSession: sessionName } : {}),
    ...(backend === "zellij" && sessionName ? { zellijSession: sessionName } : {}),
    ...(backend === "zellij" && route.zellijSocketDir ? { zellijSocketDir: route.zellijSocketDir } : {}),
    agent,
  } as ScoutTerminalRelayOptions as HudsonTerminalRelayOptions);

  useBrowserLayoutEffect(() => {
    relay.resize(SCOUT_TERMINAL_INITIAL_COLS, SCOUT_TERMINAL_INITIAL_ROWS);
  }, [relay.resize]);

  return (
    <div className="s-term">
      <div className="s-term-bar">
        <BackToPicker
          slot="terminal"
          fallback={{ view: "terminal" }}
          navigate={navigate}
          className="s-term-back"
        />
        <span className="s-term-label">{label.title}</span>
        <div className="s-term-status">{label.detail}</div>
        <div className="s-term-actions">
          <button
            type="button"
            className="s-term-icon-button"
            onClick={() => relay.restart()}
            title="Restart terminal"
            aria-label="Restart terminal"
          >
            <RefreshCw size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <div
        ref={terminalBodyRef}
        className="s-term-body"
        onMouseDown={() => {
          terminalBodyRef.current?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")?.focus();
          terminalBodyRef.current?.querySelector<HTMLElement>(".xterm")?.focus();
        }}
      >
        <TerminalRelay
          relay={relay}
          fontSize={13}
          quiet
          configItems={[
            { label: "backend", value: backend },
            { label: "agent", value: agent },
            ...(sessionName ? [{ label: "session", value: sessionName }] : []),
            ...(route.zellijSocketDir ? [{ label: "socket", value: route.zellijSocketDir }] : []),
            { label: "ws", value: relayUrl },
            { label: "health", value: healthUrl },
          ]}
        />
      </div>
    </div>
  );
}

function freshTerminalLabel(
  backend: NonNullable<TerminalRoute["terminalBackend"]>,
  agent: NonNullable<TerminalRoute["terminalAgent"]>,
): { title: string; detail: string } {
  const agentLabel = agent === "shell" ? "Shell" : agent === "pi" ? "Pi" : "Claude";
  if (backend === "pty") {
    return { title: agentLabel, detail: "fresh PTY tab" };
  }
  return { title: `${agentLabel} ${backend}`, detail: `fresh ${backend} backed tab` };
}

function TerminalTakeoverGate({
  agentId,
  agent,
  mode,
  navigate,
  children,
}: {
  agentId: string;
  agent: Agent;
  mode?: "observe" | "takeover";
  navigate: TerminalNavigate;
  children: ReactNode;
}) {
  const bootstrap = useTerminalTakeoverBootstrap(agentId, agent, mode);
  if (!bootstrap.ready) {
    return (
      <TerminalPlaceholder
        agent={agent}
        agentId={agentId}
        color={actorColor(agent.name)}
        navigate={navigate}
        label={bootstrap.label}
        status={bootstrap.status}
        onRetry={bootstrap.onRetry}
      />
    );
  }
  return <>{children}</>;
}

function ResolvingAgent({ navigate }: { navigate: TerminalNavigate }) {
  return (
    <div className="s-term">
      <div className="s-term-bar">
        <BackToPicker
          slot="terminal"
          fallback={{ view: "terminal" }}
          navigate={navigate}
          className="s-term-back"
        />
        <span className="s-term-label">Terminal</span>
        <div className="s-term-status">Resolving agent...</div>
      </div>
    </div>
  );
}

export function TerminalContent({ route, navigate }: TerminalContentProps) {
  const { agentId, mode, terminalSessionId, terminalSurfaceKey } = route;
  const { agents } = useScout();

  if (route.terminalBackend) {
    return <NewTerminalSession route={route} navigate={navigate} />;
  }

  if (!agentId) {
    if (!terminalSessionId && !terminalSurfaceKey) {
      return <TerminalHome navigate={navigate} />;
    }
    return (
      <RegisteredTerminalSessions
        terminalSessionId={terminalSessionId}
        terminalSurfaceKey={terminalSurfaceKey}
        mode={mode}
        navigate={navigate}
      />
    );
  }

  const agent = agents.find((candidate) => candidate.id === agentId) ?? null;
  if (!agent) {
    return <ResolvingAgent navigate={navigate} />;
  }

  const terminalSurface = resolveAgentTerminalSurface(agent);
  const relayKey = terminalSurface
    ? `${terminalSurface.backend}:${agent.id}:${terminalSurface.sessionName}`
    : `takeover:${agentId}`;

  return (
    <TerminalTakeoverGate
      key={relayKey}
      agentId={agentId}
      agent={agent}
      mode={mode}
      navigate={navigate}
    >
      <TerminalRelayCanvas
        agentId={agentId}
        agent={agent}
        mode={mode}
        navigate={navigate}
      />
    </TerminalTakeoverGate>
  );
}

/** @deprecated Use {@link TerminalContent} with a terminal route. */
export function TerminalScreen({
  agentId,
  mode,
  terminalSessionId,
  terminalSurfaceKey,
  navigate,
}: TerminalScreenProps) {
  const route: TerminalRoute = {
    view: "terminal",
    agentId,
    mode,
    terminalSessionId,
    terminalSurfaceKey,
  };
  return <TerminalContent route={route} navigate={navigate} />;
}
