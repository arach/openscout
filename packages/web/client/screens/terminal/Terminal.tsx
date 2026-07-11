import "./terminal-screen.css";

import {
  ArrowLeftRight,
  ChevronDown,
  ExternalLink,
  Eye,
  GripVertical,
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
  type ComponentProps,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
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
  compactTerminalName,
  compactTerminalPath,
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
import {
  moveTerminalWorkspaceItem,
  resolveTerminalProjectDestinations,
  terminalProjectCdCommand,
  terminalWorkspaceDropPlacement,
  type TerminalProjectDestination,
  type TerminalTileDropEdge,
} from "../../lib/terminal-workspace.ts";
import { createVantageHandoff, formatVantageLinkLabel } from "../../lib/vantage.ts";
import { agentStateLabel } from "../../lib/agent-state.ts";
import { useScout } from "../../scout/Provider.tsx";
import { BackToPicker } from "../../scout/slots/BackToPicker.tsx";
import { TmuxPeekPanel } from "../../scout/inspector/TmuxPeek.tsx";
import type { MenuItem } from "../../components/ContextMenu.tsx";
import type {
  Agent,
  AgentConfigurationProject,
  AgentConfigurationState,
  Route,
  SessionCatalogWithResume,
  TerminalSurfaceDescriptor,
} from "../../lib/types.ts";
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
type TerminalHomeListItem = ReturnType<typeof terminalListItems>[number];
type TerminalInventoryRow =
  | { id: string; kind: "session"; item: TerminalHomeListItem; matchingAgent: Agent | null; updatedAt: number }
  | { id: string; kind: "agent"; agent: Agent; updatedAt: number };

const TERMINAL_ATTACH_DRAG_TYPE = "application/x-openscout-terminal-target";
const TERMINAL_TILE_DRAG_TYPE = "application/x-openscout-terminal-tile";
const DEFAULT_TERMINAL_FONT_FAMILY = "'JetBrainsMono Nerd Font', 'JetBrainsMonoNL Nerd Font', 'MesloLGS Nerd Font Mono', 'Hack Nerd Font Mono', 'JetBrains Mono', monospace";

function terminalTypography(): { fontFamily: string; fontSize: number } {
  if (typeof window === "undefined") {
    return { fontFamily: DEFAULT_TERMINAL_FONT_FAMILY, fontSize: 13 };
  }
  const params = new URLSearchParams(window.location.search);
  const configuredFamily = params.get("terminalFontFamily")?.trim();
  const configuredSize = Number(params.get("terminalFontSize"));
  return {
    fontFamily: configuredFamily
      ? `'${configuredFamily.replaceAll("'", "\\'")}', ${DEFAULT_TERMINAL_FONT_FAMILY}`
      : DEFAULT_TERMINAL_FONT_FAMILY,
    fontSize: Number.isFinite(configuredSize) && configuredSize >= 9 && configuredSize <= 32
      ? configuredSize
      : 13,
  };
}

function ScoutTerminalRelay(props: ComponentProps<typeof TerminalRelay>) {
  const typography = terminalTypography();
  return <TerminalRelay {...props} fontFamily={typography.fontFamily} fontSize={typography.fontSize} />;
}

function useTerminalProjectDestinations(agents: Agent[]): TerminalProjectDestination[] {
  const [configuredProjects, setConfiguredProjects] = useState<AgentConfigurationProject[]>([]);
  const [currentDirectory, setCurrentDirectory] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<AgentConfigurationState>("/api/agent-config/snapshot")
      .then((snapshot) => {
        if (!cancelled) {
          setConfiguredProjects(snapshot.projects);
          setCurrentDirectory(snapshot.context.currentDirectory);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () => resolveTerminalProjectDestinations(configuredProjects, [
      ...(currentDirectory ? [{
        id: "scout-current-directory",
        name: "Current project",
        project: null,
        projectRoot: currentDirectory,
        cwd: currentDirectory,
        updatedAt: Number.MAX_SAFE_INTEGER,
      }] : []),
      ...agents,
    ]),
    [agents, configuredProjects, currentDirectory],
  );
}

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
    mode,
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
    controlMode: binding.controlMode,
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
  tileDrag,
}: {
  agentId?: string;
  agent: Agent | null;
  mode?: "observe" | "takeover";
  navigate: (route: Route) => void;
  registeredTarget?: RegisteredTerminalTarget;
  embedded?: boolean;
  tileActions?: ReactNode;
  tileDrag?: {
    id: string;
    onStart: (event: ReactDragEvent<HTMLElement>, tileId: string) => void;
    onEnd: () => void;
  };
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
      <div
        className={`s-term-bar s-term-bar--takeover${tileDrag ? " s-term-bar--draggable" : ""}`}
        draggable={Boolean(tileDrag)}
        onDragStart={tileDrag ? (event) => tileDrag.onStart(event, tileDrag.id) : undefined}
        onDragEnd={tileDrag?.onEnd}
      >
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
        <ScoutTerminalRelay
          relay={session.terminalRelay}
          readOnly={session.readOnly}
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

function registeredTerminalTargetId(target: RegisteredTerminalTarget): string {
  return `registered:${target.session.id}:${surfaceKey(target.surface)}`;
}

function createRegisteredTerminalTile(target: RegisteredTerminalTarget): RegisteredTerminalTileModel {
  return {
    id: createTerminalTileId("registered"),
    kind: "registered",
    target,
  };
}

function registeredTargetFromListItem(
  item: ReturnType<typeof terminalListItems>[number],
): RegisteredTerminalTarget {
  return { session: item.session, surface: item.surface };
}

function registeredTerminalDragId(target: RegisteredTerminalTarget): string {
  return registeredTerminalTargetId(target);
}

function hasRegisteredTerminalDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes(TERMINAL_ATTACH_DRAG_TYPE);
}

function readRegisteredTerminalDrag(dataTransfer: DataTransfer | null): string | null {
  if (!dataTransfer) return null;
  return dataTransfer.getData(TERMINAL_ATTACH_DRAG_TYPE)
    || dataTransfer.getData("text/plain")
    || null;
}

function hasTerminalTileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes(TERMINAL_TILE_DRAG_TYPE);
}

function readTerminalTileDrag(dataTransfer: DataTransfer | null): string | null {
  return dataTransfer?.getData(TERMINAL_TILE_DRAG_TYPE) || null;
}

function setTerminalTileDragPreview(dataTransfer: DataTransfer, tile: HTMLElement): void {
  const preview = document.createElement("div");
  preview.className = "s-term-tile-drag-preview";
  preview.setAttribute("aria-hidden", "true");

  const header = document.createElement("div");
  header.className = "s-term-tile-drag-preview-head";

  const title = document.createElement("span");
  title.textContent = tile.getAttribute("aria-label") || "Terminal";
  header.append(title);

  const backend = document.createElement("span");
  backend.textContent = tile.querySelector<HTMLElement>(".s-term-label")?.textContent || "PTY";
  header.append(backend);

  const body = document.createElement("div");
  body.className = "s-term-tile-drag-preview-body";
  for (const width of [42, 68, 54]) {
    const line = document.createElement("i");
    line.style.width = `${width}%`;
    body.append(line);
  }

  preview.append(header, body);
  document.body.append(preview);
  dataTransfer.setDragImage(preview, 24, 18);
  requestAnimationFrame(() => preview.remove());
}

function terminalWorkspaceGridColumnCount(slot: HTMLElement): number {
  const grid = slot.parentElement;
  if (!grid) return 1;
  return getComputedStyle(grid).gridTemplateColumns
    .split(/\s+/)
    .filter((column) => column && column !== "none")
    .length || 1;
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
  const projectDestinations = useTerminalProjectDestinations(agents);
  const showContextMenu = useContextMenu();
  const [state, setState] = useState<TerminalSessionsState>({ state: "loading", sessions: [] });
  const [tiles, setTiles] = useState<TerminalWorkspaceTileModel[]>([]);
  const [workspaceReload, setWorkspaceReload] = useState(0);
  const [dropTargetActive, setDropTargetActive] = useState(false);
  const [showAttachPanel, setShowAttachPanel] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [draggedTileId, setDraggedTileId] = useState<string | null>(null);
  const [tileDropTarget, setTileDropTarget] = useState<{
    id: string;
    edge: TerminalTileDropEdge;
    axis: "horizontal" | "vertical";
  } | null>(null);

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
  const liveTerminalItems = useMemo(
    () => terminalItems.filter((item) => item.surface.state !== "exited"),
    [terminalItems],
  );
  const attachableItems = useMemo(
    () => liveTerminalItems,
    [liveTerminalItems],
  );
  const tiledRegisteredIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tile of tiles) {
      if (tile.kind === "registered") ids.add(registeredTerminalTargetId(tile.target));
    }
    return ids;
  }, [tiles]);
  const terminalAgents = useMemo(() => sortTerminalAgents(agents), [agents]);
  const inventoryRows = useMemo(
    () => buildTerminalInventoryRows(liveTerminalItems, terminalAgents),
    [liveTerminalItems, terminalAgents],
  );
  const boundAgentCount = useMemo(
    () => terminalAgents.filter((agent) => resolveAgentTerminalSurface(agent)).length,
    [terminalAgents],
  );
  const liveTerminalCount = liveTerminalItems.length;
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
    const targetId = registeredTerminalTargetId(target);
    setTiles((current) => {
      if (current.some((tile) => tile.kind === "registered" && registeredTerminalTargetId(tile.target) === targetId)) {
        return current;
      }
      return [...current, createRegisteredTerminalTile(target)];
    });
  }, []);

  const attachableTargetsById = useMemo(() => {
    const targets = new Map<string, RegisteredTerminalTarget>();
    for (const item of attachableItems) {
      const target = registeredTargetFromListItem(item);
      targets.set(registeredTerminalDragId(target), target);
    }
    return targets;
  }, [attachableItems]);

  const attachRegisteredTargetById = useCallback((targetId: string | null) => {
    if (!targetId) return false;
    const target = attachableTargetsById.get(targetId);
    if (!target) return false;
    attachRegisteredTarget(target);
    return true;
  }, [attachRegisteredTarget, attachableTargetsById]);

  const handleAttachDragStart = useCallback((
    event: ReactDragEvent<HTMLElement>,
    target: RegisteredTerminalTarget,
  ) => {
    const id = registeredTerminalDragId(target);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(TERMINAL_ATTACH_DRAG_TYPE, id);
    event.dataTransfer.setData("text/plain", id);
  }, []);

  const handleAttachDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!hasRegisteredTerminalDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropTargetActive(true);
  }, []);

  const handleAttachDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setDropTargetActive(false);
  }, []);

  const handleAttachDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!hasRegisteredTerminalDrag(event.dataTransfer)) return;
    event.preventDefault();
    const targetId = readRegisteredTerminalDrag(event.dataTransfer);
    attachRegisteredTargetById(targetId);
    setDropTargetActive(false);
  }, [attachRegisteredTargetById]);

  const attachLiveTerminals = useCallback(() => {
    const targets = attachableItems.map(registeredTargetFromListItem);
    if (targets.length === 0) return;
    setTiles((current) => {
      const next = [...current];
      const seen = new Set(
        current.flatMap((tile) => tile.kind === "registered" ? [registeredTerminalTargetId(tile.target)] : []),
      );
      for (const target of targets) {
        const targetId = registeredTerminalTargetId(target);
        if (seen.has(targetId)) continue;
        seen.add(targetId);
        next.push(createRegisteredTerminalTile(target));
      }
      return next;
    });
  }, [attachableItems]);

  const closeTile = useCallback((tileId: string) => {
    setTiles((current) => current.filter((tile) => tile.id !== tileId));
  }, []);

  const retargetTile = useCallback((tileId: string, target: RegisteredTerminalTarget) => {
    const targetId = registeredTerminalTargetId(target);
    setTiles((current) => {
      if (current.some((tile) => (
        tile.id !== tileId
        && tile.kind === "registered"
        && registeredTerminalTargetId(tile.target) === targetId
      ))) {
        return current;
      }
      return current.map((tile) => tile.id === tileId
        ? { id: tile.id, kind: "registered", target }
        : tile);
    });
  }, []);

  const handleTileDragStart = useCallback((event: ReactDragEvent<HTMLElement>, tileId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TERMINAL_TILE_DRAG_TYPE, tileId);
    const tile = event.currentTarget.closest<HTMLElement>(".s-term-workspace-tile");
    if (tile) {
      setTerminalTileDragPreview(event.dataTransfer, tile);
    }
    setDraggedTileId(tileId);
  }, []);

  const handleTileDragEnd = useCallback(() => {
    setDraggedTileId(null);
    setTileDropTarget(null);
  }, []);

  const handleTileDragOver = useCallback((event: ReactDragEvent<HTMLElement>, destinationId: string) => {
    if (!hasTerminalTileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const placement = terminalWorkspaceDropPlacement(
      { x: event.clientX, y: event.clientY },
      rect,
      terminalWorkspaceGridColumnCount(event.currentTarget),
    );
    setTileDropTarget({ id: destinationId, ...placement });
  }, []);

  const handleTileDrop = useCallback((event: ReactDragEvent<HTMLElement>, destinationId: string) => {
    if (!hasTerminalTileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceId = readTerminalTileDrag(event.dataTransfer);
    const rect = event.currentTarget.getBoundingClientRect();
    const { edge } = terminalWorkspaceDropPlacement(
      { x: event.clientX, y: event.clientY },
      rect,
      terminalWorkspaceGridColumnCount(event.currentTarget),
    );
    if (sourceId) {
      setTiles((current) => moveTerminalWorkspaceItem(current, sourceId, destinationId, edge));
    }
    setDraggedTileId(null);
    setTileDropTarget(null);
  }, []);

  const reloadWorkspace = useCallback(() => {
    loadSessions();
    setWorkspaceReload((current) => current + 1);
  }, [loadSessions]);

  const showTileRetargetMenu = useCallback((
    event: ReactMouseEvent<HTMLButtonElement>,
    tile: TerminalWorkspaceTileModel,
  ) => {
    const occupiedTargetIds = new Set(
      tiles.flatMap((candidate) => (
        candidate.id !== tile.id && candidate.kind === "registered"
          ? [registeredTerminalTargetId(candidate.target)]
          : []
      )),
    );
    const currentTargetId = tile.kind === "registered"
      ? registeredTerminalTargetId(tile.target)
      : null;
    const targets = attachableItems
      .map((item) => ({ item, target: registeredTargetFromListItem(item) }))
      .filter(({ target }) => {
        const id = registeredTerminalTargetId(target);
        return id !== currentTargetId && !occupiedTargetIds.has(id);
      });

    const items: MenuItem[] = [];
    for (const backend of ["tmux", "zellij"]) {
      const group = targets.filter(({ target }) => target.surface.backend === backend);
      if (group.length === 0) continue;
      if (items.length > 0) items.push({ kind: "separator" });
      for (const { item, target } of group) {
        items.push({
          kind: "action",
          label: `${backend.toUpperCase()} · ${item.title}`,
          onSelect: () => retargetTile(tile.id, target),
        });
      }
    }
    if (items.length > 0) items.push({ kind: "separator" });
    items.push({ kind: "action", label: "Refresh sessions", onSelect: () => loadSessions() });
    showContextMenu(event, items);
  }, [attachableItems, loadSessions, retargetTile, showContextMenu, tiles]);

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
              className={`s-term-workspace-action${showAttachPanel ? " s-term-workspace-action--active" : ""}`}
              onClick={() => setShowAttachPanel((current) => !current)}
              disabled={attachableItems.length === 0}
              title="Choose a registered terminal to attach"
            >
              <LogIn size={14} strokeWidth={1.8} />
              <span>Attach</span>
              <ChevronDown size={12} strokeWidth={1.8} />
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

        {showAttachPanel && (
          <TerminalAttachGrid
            items={attachableItems}
            tiledRegisteredIds={tiledRegisteredIds}
            loadState={state.state}
            onAttach={(target) => {
              attachRegisteredTarget(target);
              setShowAttachPanel(false);
            }}
            onAttachAll={() => {
              attachLiveTerminals();
              setShowAttachPanel(false);
            }}
            onClose={() => setShowAttachPanel(false)}
            onDragStart={handleAttachDragStart}
          />
        )}

        {tiles.length === 0 ? (
          <div
            className={`s-term-workspace-empty${dropTargetActive ? " s-term-workspace-empty--drop" : ""}`}
            onDragEnter={handleAttachDragOver}
            onDragOver={handleAttachDragOver}
            onDragLeave={handleAttachDragLeave}
            onDrop={handleAttachDrop}
          >
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
          <div
            className={`s-term-workspace-grid${dropTargetActive ? " s-term-workspace-grid--drop" : ""}`}
            aria-label="Terminal tiles"
            onDragEnter={handleAttachDragOver}
            onDragOver={handleAttachDragOver}
            onDragLeave={handleAttachDragLeave}
            onDrop={handleAttachDrop}
          >
            {tiles.map((tile) => {
              const drop = tileDropTarget?.id === tile.id ? tileDropTarget : null;
              return (
                <div
                  key={`${tile.id}:${workspaceReload}`}
                  className={[
                    "s-term-workspace-tile-slot",
                    draggedTileId === tile.id ? "s-term-workspace-tile-slot--dragging" : "",
                    drop ? `s-term-workspace-tile-slot--drop-${drop.edge}-${drop.axis}` : "",
                  ].filter(Boolean).join(" ")}
                  onDragOver={(event) => handleTileDragOver(event, tile.id)}
                  onDrop={(event) => handleTileDrop(event, tile.id)}
                >
                  <TerminalWorkspaceTile
                    tile={tile}
                    navigate={navigate}
                    projectDestinations={projectDestinations}
                    onClose={closeTile}
                    onDragStart={handleTileDragStart}
                    onDragEnd={handleTileDragEnd}
                    onRetarget={showTileRetargetMenu}
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="s-term-workspace-dock">
          <button
            type="button"
            className="s-term-workspace-inventory-toggle"
            aria-expanded={showInventory}
            onClick={() => setShowInventory((current) => !current)}
          >
            <span>Terminal inventory</span>
            <span>{state.state === "loading" ? "syncing" : inventoryRows.length}</span>
            <ChevronDown size={13} strokeWidth={1.8} />
          </button>
          {showInventory && (
            <section className="s-term-home-section" aria-labelledby="terminal-workspace-inventory">
              <div className="s-term-home-section-head">
                <h2 id="terminal-workspace-inventory">Terminals</h2>
                <span>{state.state === "loading" ? "syncing" : `${inventoryRows.length}`}</span>
              </div>
              <div className="s-term-data-table s-term-data-table--inventory" role="table">
                <div className="s-term-data-header" role="row">
                  <span role="columnheader">Terminal</span>
                  <span role="columnheader">Agent</span>
                  <span role="columnheader">Project</span>
                  <span role="columnheader">Context</span>
                  <span role="columnheader">Running</span>
                  <span role="columnheader">Updated</span>
                  <span role="columnheader">Actions</span>
                </div>
                {inventoryRows.length === 0 && state.state !== "loading" ? (
                  <div className="s-term-home-empty">No registered terminals</div>
                ) : (
                  inventoryRows.map((row) =>
                    row.kind === "session" ? (
                      <TerminalHomeSessionRow
                        key={row.id}
                        item={row.item}
                        matchingAgent={row.matchingAgent}
                        navigate={navigate}
                        showContextMenu={showContextMenu}
                        onAttach={attachRegisteredTarget}
                      />
                    ) : (
                      <TerminalHomeAgentRow
                        key={row.id}
                        agent={row.agent}
                        navigate={navigate}
                        showContextMenu={showContextMenu}
                      />
                    )
                  )
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function TerminalAttachGrid({
  items,
  tiledRegisteredIds,
  loadState,
  onAttach,
  onAttachAll,
  onClose,
  onDragStart,
}: {
  items: TerminalHomeListItem[];
  tiledRegisteredIds: Set<string>;
  loadState: TerminalSessionsState["state"];
  onAttach: (target: RegisteredTerminalTarget) => void;
  onAttachAll: () => void;
  onClose: () => void;
  onDragStart: (event: ReactDragEvent<HTMLElement>, target: RegisteredTerminalTarget) => void;
}) {
  if (items.length === 0 && loadState !== "loading") {
    return null;
  }

  return (
    <section className="s-term-attach" aria-labelledby="terminal-attach-grid">
      <div className="s-term-home-section-head">
        <h2 id="terminal-attach-grid">Attachable sessions</h2>
        <div className="s-term-attach-actions">
          <span>{loadState === "loading" ? "syncing" : `${items.length}`}</span>
          <button type="button" className="s-term-attach-all" onClick={onAttachAll} disabled={items.length === 0}>
            Attach all
          </button>
          <button type="button" className="s-term-icon-button" onClick={onClose} title="Close attach picker" aria-label="Close attach picker">
            <X size={13} strokeWidth={1.9} />
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="s-term-attach-empty">Syncing terminals</div>
      ) : (
        <div className="s-term-attach-grid">
          {items.map((item) => {
            const target = registeredTargetFromListItem(item);
            const dragId = registeredTerminalDragId(target);
            const alreadyTiled = tiledRegisteredIds.has(dragId);
            return (
              <TerminalAttachCard
                key={item.id}
                item={item}
                target={target}
                alreadyTiled={alreadyTiled}
                onAttach={onAttach}
                onDragStart={onDragStart}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function TerminalAttachCard({
  item,
  target,
  alreadyTiled,
  onAttach,
  onDragStart,
}: {
  item: TerminalHomeListItem;
  target: RegisteredTerminalTarget;
  alreadyTiled: boolean;
  onAttach: (target: RegisteredTerminalTarget) => void;
  onDragStart: (event: ReactDragEvent<HTMLElement>, target: RegisteredTerminalTarget) => void;
}) {
  const handleAttach = useCallback(() => {
    if (!alreadyTiled) onAttach(target);
  }, [alreadyTiled, onAttach, target]);
  const detail = [
    item.session.harness,
    item.project,
    item.cwdLabel,
  ].filter(Boolean).join(" · ");

  return (
    <article
      className={`s-term-attach-card${alreadyTiled ? " s-term-attach-card--active" : ""}`}
      draggable={!alreadyTiled}
      tabIndex={0}
      onDoubleClick={handleAttach}
      onDragStart={(event) => onDragStart(event, target)}
      onKeyDown={(event) => {
        if (event.key === "Enter") handleAttach();
      }}
      title={item.surface.sessionName}
      aria-label={`${item.title} terminal`}
    >
      <span className="s-term-attach-card-icon" aria-hidden>
        <TerminalIcon size={15} strokeWidth={1.8} />
      </span>
      <span className="s-term-attach-card-copy">
        <span className="s-term-attach-card-title">{item.title}</span>
        <span className="s-term-attach-card-detail">{detail || item.surface.sessionName}</span>
      </span>
      <span className="s-term-attach-card-badges">
        <span>{item.surface.backend}</span>
        <span>{alreadyTiled ? "tiled" : item.condition}</span>
      </span>
      <button
        type="button"
        className="s-term-icon-button"
        onClick={handleAttach}
        disabled={alreadyTiled}
        title={alreadyTiled ? "Terminal is already tiled" : "Add terminal tile"}
        aria-label={alreadyTiled ? "Terminal is already tiled" : "Add terminal tile"}
      >
        <Plus size={14} strokeWidth={1.9} />
      </button>
    </article>
  );
}

function TerminalWorkspaceTile({
  tile,
  navigate,
  projectDestinations,
  onClose,
  onDragStart,
  onDragEnd,
  onRetarget,
}: {
  tile: TerminalWorkspaceTileModel;
  navigate: TerminalNavigate;
  projectDestinations: TerminalProjectDestination[];
  onClose: (tileId: string) => void;
  onDragStart: (event: ReactDragEvent<HTMLElement>, tileId: string) => void;
  onDragEnd: () => void;
  onRetarget: (event: ReactMouseEvent<HTMLButtonElement>, tile: TerminalWorkspaceTileModel) => void;
}) {
  if (tile.kind === "registered") {
    return (
      <RegisteredTerminalWorkspaceTile
        tile={tile}
        navigate={navigate}
        onClose={onClose}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onRetarget={onRetarget}
      />
    );
  }
  return (
    <FreshTerminalWorkspaceTile
      tile={tile}
      navigate={navigate}
      projectDestinations={projectDestinations}
      onClose={onClose}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onRetarget={onRetarget}
    />
  );
}

function FreshTerminalWorkspaceTile({
  tile,
  navigate,
  projectDestinations,
  onClose,
  onDragStart,
  onDragEnd,
  onRetarget,
}: {
  tile: FreshTerminalTileModel;
  navigate: TerminalNavigate;
  projectDestinations: TerminalProjectDestination[];
  onClose: (tileId: string) => void;
  onDragStart: (event: ReactDragEvent<HTMLElement>, tileId: string) => void;
  onDragEnd: () => void;
  onRetarget: (event: ReactMouseEvent<HTMLButtonElement>, tile: TerminalWorkspaceTileModel) => void;
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
    controlMode: "takeover",
  } as ScoutTerminalRelayOptions as HudsonTerminalRelayOptions);

  useBrowserLayoutEffect(() => {
    relay.resize(SCOUT_TERMINAL_INITIAL_COLS, SCOUT_TERMINAL_INITIAL_ROWS);
  }, [relay.resize]);

  const openStandalone = useCallback(() => {
    openTerminalRouteExternally(route, navigate);
  }, [navigate, route]);

  const focusTerminal = useCallback(() => {
    terminalBodyRef.current?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")?.focus();
    terminalBodyRef.current?.querySelector<HTMLElement>(".xterm")?.focus();
  }, []);

  const openProject = useCallback((destination: TerminalProjectDestination) => {
    relay.sendLine(terminalProjectCdCommand(destination.path));
    window.requestAnimationFrame(focusTerminal);
  }, [focusTerminal, relay]);

  return (
    <section className="s-term-workspace-tile" aria-label={label.title}>
      <div className="s-term s-term--embedded">
        <div
          className="s-term-bar s-term-bar--fresh s-term-bar--draggable"
          draggable
          onDragStart={(event) => onDragStart(event, tile.id)}
          onDragEnd={onDragEnd}
        >
          <div className="s-term-bar-left">
            <span
              className="s-term-tile-drag-handle"
              title="Drag the title bar to move tile"
              aria-hidden="true"
            >
              <GripVertical size={14} strokeWidth={1.8} />
            </span>
            <span className="s-term-workspace-tile-mark">
              <TerminalIcon size={14} strokeWidth={1.8} />
            </span>
            <span className="s-term-workspace-tile-name">{label.title}</span>
          </div>
          <div className="s-term-bar-meta">
            {tile.agent === "shell" && projectDestinations.length > 0 ? (
              <FreshTerminalProjectHints
                destinations={projectDestinations}
                disabled={relay.status !== "connected"}
                compact
                onSelect={openProject}
              />
            ) : (
              <>
                <span className="s-term-label">{tile.backend}</span>
                <span className="s-term-session">{label.detail}</span>
              </>
            )}
          </div>
          <div className="s-term-bar-actions">
            <button
              type="button"
              className="s-term-icon-button"
              onClick={(event) => onRetarget(event, tile)}
              title="Change attached session"
              aria-label="Change attached session"
            >
              <ArrowLeftRight size={14} strokeWidth={1.8} />
            </button>
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
            focusTerminal();
          }}
        >
          <ScoutTerminalRelay
            relay={relay}
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
  onDragStart,
  onDragEnd,
  onRetarget,
}: {
  tile: RegisteredTerminalTileModel;
  navigate: TerminalNavigate;
  onClose: (tileId: string) => void;
  onDragStart: (event: ReactDragEvent<HTMLElement>, tileId: string) => void;
  onDragEnd: () => void;
  onRetarget: (event: ReactMouseEvent<HTMLButtonElement>, tile: TerminalWorkspaceTileModel) => void;
}) {
  const openStandalone = useCallback(() => {
    openTerminalRouteExternally(registeredTerminalRouteForTarget(tile.target), navigate);
  }, [navigate, tile.target]);

  return (
    <section className="s-term-workspace-tile" aria-label={tile.target.surface.sessionName}>
      <TerminalRelayCanvas
        key={registeredTerminalTargetId(tile.target)}
        agent={null}
        mode="takeover"
        navigate={navigate}
        registeredTarget={tile.target}
        embedded
        tileDrag={{ id: tile.id, onStart: onDragStart, onEnd: onDragEnd }}
        tileActions={(
          <>
            <span
              className="s-term-tile-drag-handle"
              title="Drag the title bar to move tile"
              aria-hidden="true"
            >
              <GripVertical size={14} strokeWidth={1.8} />
            </span>
            <button
              type="button"
              className="s-term-icon-button"
              onClick={(event) => onRetarget(event, tile)}
              title="Change attached session"
              aria-label="Change attached session"
            >
              <ArrowLeftRight size={14} strokeWidth={1.8} />
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
          </>
        )}
      />
    </section>
  );
}

function TerminalHomeSessionRow({
  item,
  matchingAgent,
  navigate,
  showContextMenu,
  onAttach,
}: {
  item: TerminalHomeListItem;
  matchingAgent: Agent | null;
  navigate: TerminalNavigate;
  showContextMenu: (event: ReactMouseEvent, items: MenuItem[]) => void;
  onAttach?: (target: RegisteredTerminalTarget) => void;
}) {
  const routeBase: TerminalRoute = {
    view: "terminal" as const,
    terminalSessionId: item.session.id,
    terminalSurfaceKey: surfaceKey(item.surface),
  };
  const project = matchingAgent ? terminalAgentProject(matchingAgent) : item.project;
  const projectDetail = matchingAgent
    ? matchingAgent.branch ?? (compactTerminalPath(matchingAgent.cwd ?? matchingAgent.projectRoot) || "no workspace path")
    : item.cwdLabel || (item.origin === "backend" ? "no cwd reported" : "no workspace path");
  const context = matchingAgent
    ? terminalAgentContext(matchingAgent)
    : { kind: item.contextKind, value: item.contextValue };
  const contextTitle = `${context.kind}: ${context.value}`;
  const runningDetail = terminalItemRunningDetail(item, matchingAgent);
  const ownerName = matchingAgent?.name ?? (item.origin === "backend" ? "Standalone" : item.session.harness ?? "Scout");
  const ownerSub = matchingAgent?.handle
    ? `@${matchingAgent.handle}`
    : matchingAgent?.id ?? (item.origin === "backend" ? `${item.surface.backend} session` : item.origin);
  const ownerTitle = matchingAgent
    ? `${matchingAgent.name}${matchingAgent.handle ? ` @${matchingAgent.handle}` : ""}`
    : item.origin === "backend"
      ? "Backend discovery"
      : item.session.harness ?? "Scout session";
  const updatedAt = maxTimestamp(item.session.updatedAt, matchingAgent?.updatedAt);
  const updated = formatTableTime(updatedAt);
  const actionItems: MenuItem[] = [
    ...(onAttach
      ? [
          {
            kind: "action" as const,
            label: "Add Tile",
            onSelect: () => onAttach(registeredTargetFromListItem(item)),
          },
          { kind: "separator" as const },
        ]
      : []),
    {
      kind: "action",
      label: "Observe Read-only",
      onSelect: () => navigate(withTerminalMode(routeBase, "observe")),
    },
    {
      kind: "action",
      label: "Open Summary",
      onSelect: () => navigate(routeBase),
    },
    {
      kind: "action",
      label: "Open In New Window",
      onSelect: () => openTerminalRouteExternally({ ...routeBase, mode: "takeover" }, navigate),
    },
  ];

  return (
    <div className="s-term-data-row" role="row">
      <button
        type="button"
        className="s-term-data-cell s-term-data-primary"
        role="cell"
        onClick={() => navigate(routeBase)}
      >
        <span className="s-term-home-row-icon" aria-hidden>
          <TerminalIcon size={15} strokeWidth={1.8} />
        </span>
        <span className="s-term-home-row-copy">
          <span className="s-term-home-row-title">{item.title}</span>
          <span className="s-term-home-row-detail" title={item.surface.sessionName}>{item.surface.sessionName}</span>
        </span>
      </button>
      <div className="s-term-data-cell" role="cell">
        <span className="s-term-data-main" title={ownerTitle}>{ownerName}</span>
        <span className="s-term-data-sub" title={matchingAgent?.id ?? ownerSub}>{ownerSub}</span>
      </div>
      <div className="s-term-data-cell" role="cell">
        <span className="s-term-data-main" title={project}>{project}</span>
        <span className="s-term-data-sub" title={projectDetail}>{projectDetail}</span>
      </div>
      <div className="s-term-data-cell" role="cell">
        <span className="s-term-data-kicker">{context.kind}</span>
        <span className="s-term-data-main" title={contextTitle}>{compactReference(context.value)}</span>
      </div>
      <div className="s-term-data-cell" role="cell">
        <span className="s-term-home-row-badges">
          <span>{item.surface.backend}</span>
          <span>{item.condition}</span>
        </span>
        <span className="s-term-data-sub" title={runningDetail}>{runningDetail}</span>
      </div>
      <div className="s-term-data-cell" role="cell">
        <span className="s-term-data-main" title={formatTableDate(updatedAt)}>{updated}</span>
      </div>
      <div className="s-term-home-row-actions" role="cell">
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
          className="s-term-summary-action s-term-row-more"
          onClick={(event) => showContextMenu(event, actionItems)}
          title="More terminal actions"
          aria-label="More terminal actions"
        >
          <MoreHorizontal size={14} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

function TerminalHomeAgentRow({
  agent,
  navigate,
  showContextMenu,
}: {
  agent: Agent;
  navigate: TerminalNavigate;
  showContextMenu: (event: ReactMouseEvent, items: MenuItem[]) => void;
}) {
  const terminalSurface = resolveAgentTerminalSurface(agent);
  if (!terminalSurface) return null;

  const routeBase: TerminalRoute = { view: "terminal" as const, agentId: agent.id };
  const takeoverRoute: TerminalRoute = { ...routeBase, mode: "takeover" };
  const observeRoute: TerminalRoute = { ...routeBase, mode: "observe" };
  const project = terminalAgentProject(agent);
  const projectDetail = agent.branch ?? (compactTerminalPath(agent.cwd ?? agent.projectRoot) || "no workspace path");
  const context = terminalAgentContext(agent);
  const terminalTitle = compactTerminalName(terminalSurface.sessionName);
  const runtimeDetail = [agent.harness, agent.model ?? agent.transport].filter(Boolean).join(" · ")
    || agentStateLabel(agent.state);
  const updated = formatTableTime(agent.updatedAt);
  const actionItems: MenuItem[] = [
    {
      kind: "action",
      label: "Observe Read-only",
      onSelect: () => navigate(observeRoute),
    },
    {
      kind: "action",
      label: "Open In New Window",
      onSelect: () => openTerminalRouteExternally(takeoverRoute, navigate),
    },
  ];

  return (
    <div className="s-term-data-row" role="row">
      <button
        type="button"
        className="s-term-data-cell s-term-data-primary"
        role="cell"
        onClick={() => navigate(takeoverRoute)}
      >
        <span className="s-term-home-row-icon" aria-hidden>
          <TerminalIcon size={15} strokeWidth={1.8} />
        </span>
        <span className="s-term-home-row-copy">
          <span className="s-term-home-row-title" title={terminalSurface.sessionName}>{terminalTitle}</span>
          <span className="s-term-home-row-detail" title={terminalSurface.sessionName}>{terminalSurface.sessionName}</span>
        </span>
      </button>
      <div className="s-term-data-cell" role="cell">
        <span className="s-term-data-main" title={agent.name}>{agent.name}</span>
        <span className="s-term-data-sub" title={agent.id}>{agent.handle ? `@${agent.handle}` : agent.id}</span>
      </div>
      <div className="s-term-data-cell" role="cell">
        <span className="s-term-data-main" title={project}>{project}</span>
        <span className="s-term-data-sub" title={projectDetail}>{projectDetail}</span>
      </div>
      <div className="s-term-data-cell" role="cell">
        <span className="s-term-data-kicker">{context.kind}</span>
        <span className="s-term-data-main" title={context.value}>{compactReference(context.value)}</span>
      </div>
      <div className="s-term-data-cell" role="cell">
        <span className="s-term-home-row-badges">
          <span>{terminalSurface.backend}</span>
          <span>bound</span>
        </span>
        <span className="s-term-data-sub" title={runtimeDetail}>{runtimeDetail}</span>
      </div>
      <div className="s-term-data-cell" role="cell">
        <span className="s-term-data-main" title={formatTableDate(agent.updatedAt)}>{updated}</span>
        <span className="s-term-data-sub">{agentStateLabel(agent.state)}</span>
      </div>
      <div className="s-term-home-row-actions" role="cell">
        <button
          type="button"
          className="s-term-summary-action s-term-summary-action--primary"
          onClick={() => navigate(takeoverRoute)}
        >
          <LogIn size={13} strokeWidth={1.8} />
          <span>Enter</span>
        </button>
        <button
          type="button"
          className="s-term-summary-action s-term-row-more"
          onClick={(event) => showContextMenu(event, actionItems)}
          title="More terminal actions"
          aria-label="More terminal actions"
        >
          <MoreHorizontal size={14} strokeWidth={1.8} />
        </button>
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

function buildTerminalInventoryRows(items: TerminalHomeListItem[], agents: Agent[]): TerminalInventoryRow[] {
  const representedAgentIds = new Set<string>();
  const rows: TerminalInventoryRow[] = items.map((item) => {
    const matchingAgent = findTerminalItemAgent(item, agents);
    if (matchingAgent) representedAgentIds.add(matchingAgent.id);
    return {
      id: `session:${item.id}`,
      kind: "session",
      item,
      matchingAgent,
      updatedAt: maxTimestamp(item.session.updatedAt, matchingAgent?.updatedAt),
    };
  });

  for (const agent of agents) {
    if (representedAgentIds.has(agent.id)) continue;
    const terminalSurface = resolveAgentTerminalSurface(agent);
    if (!terminalSurface) continue;
    rows.push({
      id: `agent:${agent.id}:${terminalSurface.backend}:${terminalSurface.sessionName}`,
      kind: "agent",
      agent,
      updatedAt: maxTimestamp(agent.updatedAt),
    });
  }

  return rows.sort((a, b) => {
    const updatedRank = b.updatedAt - a.updatedAt;
    if (updatedRank !== 0) return updatedRank;
    return terminalInventorySortLabel(a).localeCompare(terminalInventorySortLabel(b));
  });
}

function terminalInventorySortLabel(row: TerminalInventoryRow): string {
  if (row.kind === "session") return `${row.item.title} ${row.matchingAgent?.name ?? ""}`;
  const surface = resolveAgentTerminalSurface(row.agent);
  return `${surface?.sessionName ?? ""} ${row.agent.name}`;
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

function findTerminalItemAgent(item: TerminalHomeListItem, agents: Agent[]): Agent | null {
  const itemSurfaceKey = surfaceKey(item.surface);
  const bySurface = agents.find((agent) => {
    const surface = resolveAgentTerminalSurface(agent);
    return surface ? `${surface.backend}:${surface.sessionName}` === itemSurfaceKey : false;
  });
  if (bySurface) return bySurface;

  const aliases = new Set([
    item.session.id,
    item.session.sourceSessionId,
    item.surface.sessionName,
  ].map((value) => value.trim()).filter(Boolean));
  return agents.find((agent) =>
    [
      agent.harnessSessionId,
      agent.conversationId,
      agent.terminalSurface?.sessionName,
    ].some((value) => value && aliases.has(value))
  ) ?? null;
}

function terminalItemRunningDetail(item: TerminalHomeListItem, matchingAgent: Agent | null): string {
  const command = terminalMetadataString(item.session.metadata, "currentCommand");
  const path = compactTerminalPath(terminalMetadataString(item.session.metadata, "currentPath"));
  if (command && path) return `${command} in ${path}`;
  if (command) return `running ${command}`;
  if (matchingAgent?.handle) return `owned by @${matchingAgent.handle}`;
  if (matchingAgent) return `owned by ${matchingAgent.name}`;
  if (item.surface.paneId) return `pane ${item.surface.paneId}`;
  const windows = terminalMetadataNumber(item.session.metadata, "windows");
  if (windows !== null) return `${windows} window${windows === 1 ? "" : "s"}`;
  return `${item.surface.backend} surface`;
}

function maxTimestamp(...values: Array<number | null | undefined>): number {
  return values.reduce<number>((current, value) => {
    return typeof value === "number" && Number.isFinite(value) && value > current ? value : current;
  }, 0);
}

function terminalMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function terminalMetadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | null {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function terminalAgentProject(agent: Agent): string {
  return agent.project
    ?? basename(agent.projectRoot)
    ?? basename(agent.cwd)
    ?? agent.workspaceQualifier
    ?? agent.definitionId;
}

function terminalAgentContext(agent: Agent): { kind: string; value: string } {
  if (agent.conversationId) return { kind: "conversation", value: agent.conversationId };
  if (agent.harnessSessionId) return { kind: "session", value: agent.harnessSessionId };
  if (agent.terminalSurface?.sessionName) return { kind: "terminal", value: agent.terminalSurface.sessionName };
  if (agent.nodeQualifier) return { kind: "node", value: agent.nodeQualifier };
  return { kind: "agent", value: agent.id };
}

function compactReference(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "n/a";
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(trimmed)) return trimmed.slice(0, 8);
  if (trimmed.length <= 34) return trimmed;
  return `${trimmed.slice(0, 22)}...${trimmed.slice(-8)}`;
}

function formatTableTime(ts: number | null | undefined): string {
  if (!ts) return "unknown";
  const deltaMs = Date.now() - ts;
  const absDeltaMs = Math.abs(deltaMs);
  if (absDeltaMs < 60_000) return "now";
  if (deltaMs > 0 && deltaMs < 60 * 60_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  if (deltaMs > 0 && deltaMs < 24 * 60 * 60_000) return `${Math.floor(deltaMs / (60 * 60_000))}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(ts));
}

function formatTableDate(ts: number | null | undefined): string {
  if (!ts) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ts));
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
  const { agents } = useScout();
  const projectDestinations = useTerminalProjectDestinations(agents);
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
    controlMode: "takeover",
  } as ScoutTerminalRelayOptions as HudsonTerminalRelayOptions);

  useBrowserLayoutEffect(() => {
    relay.resize(SCOUT_TERMINAL_INITIAL_COLS, SCOUT_TERMINAL_INITIAL_ROWS);
  }, [relay.resize]);

  const focusTerminal = useCallback(() => {
    terminalBodyRef.current?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")?.focus();
    terminalBodyRef.current?.querySelector<HTMLElement>(".xterm")?.focus();
  }, []);

  const openProject = useCallback((destination: TerminalProjectDestination) => {
    relay.sendLine(terminalProjectCdCommand(destination.path));
    window.requestAnimationFrame(focusTerminal);
  }, [focusTerminal, relay]);

  useEffect(() => {
    const sendLineFromNative = (event: Event) => {
      const line = (event as CustomEvent<{ line?: unknown }>).detail?.line;
      if (typeof line !== "string" || !line) return;
      relay.sendLine(line);
      window.requestAnimationFrame(focusTerminal);
    };
    window.addEventListener("scout:terminal-send-line", sendLineFromNative);
    return () => window.removeEventListener("scout:terminal-send-line", sendLineFromNative);
  }, [focusTerminal, relay]);

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
          {agent === "shell" && (
            <FreshTerminalProjectHints
              destinations={projectDestinations}
              disabled={relay.status !== "connected"}
              onSelect={openProject}
            />
          )}
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
          focusTerminal();
        }}
      >
        <ScoutTerminalRelay
          relay={relay}
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

function FreshTerminalProjectHints({
  destinations,
  disabled,
  compact = false,
  onSelect,
}: {
  destinations: TerminalProjectDestination[];
  disabled: boolean;
  compact?: boolean;
  onSelect: (destination: TerminalProjectDestination) => void;
}) {
  const showContextMenu = useContextMenu();
  const [used, setUsed] = useState(false);
  if (used || destinations.length === 0) return null;

  const visibleCount = compact ? 1 : 3;
  const visible = destinations.slice(0, visibleCount);
  const overflow = destinations.slice(visibleCount);
  const choose = (destination: TerminalProjectDestination) => {
    onSelect(destination);
    setUsed(true);
  };

  return (
    <div className={`s-term-project-hints${compact ? " s-term-project-hints--compact" : ""}`} aria-label="Project destinations">
      <span className="s-term-project-hints-label" aria-hidden>cd</span>
      {visible.map((destination) => (
        <button
          key={destination.id}
          type="button"
          className="s-term-project-hint"
          disabled={disabled}
          draggable={false}
          title={`cd ${destination.path}`}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => choose(destination)}
        >
          {destination.label}
        </button>
      ))}
      {overflow.length > 0 && (
        <button
          type="button"
          className="s-term-project-hint s-term-project-hint--more"
          disabled={disabled}
          draggable={false}
          title="More project destinations"
          aria-label={`${overflow.length} more project destinations`}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => showContextMenu(event, overflow.map((destination) => ({
            kind: "action",
            label: `${destination.label} · ${compactTerminalPath(destination.path)}`,
            onSelect: () => choose(destination),
          })))}
        >
          +{overflow.length}
        </button>
      )}
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
