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
  type ComponentProps,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
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
import { usePersistentState } from "@hudsonkit";
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

type UnavailableTerminalTileModel = {
  id: string;
  kind: "unavailable";
  terminalSessionId: string;
  terminalSurfaceKey: string;
};

type TerminalWorkspaceTileModel =
  | FreshTerminalTileModel
  | RegisteredTerminalTileModel
  | UnavailableTerminalTileModel;
type TerminalGridPreset = {
  id: "solo" | "split" | "trio" | "quad";
  label: string;
  detail: string;
  columns: number;
  slots: number;
};

type TerminalWorkspaceCellDefinition =
  | { kind: "fresh"; backend: TerminalBackend; agent: TerminalAgentKind }
  | { kind: "registered"; terminalSessionId: string; terminalSurfaceKey: string };

type TerminalWorkspaceDefinition = {
  id: string;
  name: string;
  purpose: string;
  columns: number;
  cells: TerminalWorkspaceCellDefinition[];
  updatedAt: number;
};

type TerminalWorkspaceView = "library" | "builder" | "workspace";

const TERMINAL_WORKSPACES_STORAGE_KEY = "openscout.terminal.workspaces.v1";

const TERMINAL_GRID_PRESETS: readonly TerminalGridPreset[] = [
  { id: "solo", label: "Solo", detail: "1 terminal", columns: 1, slots: 1 },
  { id: "split", label: "Split", detail: "2 side by side", columns: 2, slots: 2 },
  { id: "trio", label: "Trio", detail: "3 across", columns: 3, slots: 3 },
  { id: "quad", label: "Quad", detail: "2 by 2", columns: 2, slots: 4 },
];

const TERMINAL_BACKEND_OPTIONS: readonly { value: TerminalBackend; label: string }[] = [
  { value: "pty", label: "Shell" },
  { value: "tmux", label: "Tmux" },
  { value: "zellij", label: "Zellij" },
];

const DEFAULT_TERMINAL_FONT_FAMILY = "'JetBrainsMono Nerd Font', 'JetBrainsMonoNL Nerd Font', 'MesloLGS Nerd Font Mono', 'Hack Nerd Font Mono', 'JetBrains Mono', monospace";
const ignoreReadOnlyTerminalInput = (_value: string) => {};
const ignoreReadOnlyTerminalRestart = () => {};

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
  return (
    <TerminalRelay
      {...props}
      renderer={props.renderer ?? "dom"}
      fontFamily={typography.fontFamily}
      fontSize={typography.fontSize}
    />
  );
}

type TerminalHomeListItem = ReturnType<typeof terminalListItems>[number];
type TerminalInventoryRow =
  | { id: string; kind: "session"; item: TerminalHomeListItem; matchingAgent: Agent | null; updatedAt: number }
  | { id: string; kind: "agent"; agent: Agent; updatedAt: number };

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
    // An observer reconnect must be a fresh tmux attach so tmux supplies an
    // authoritative full redraw. Replaying a raw ANSI byte tail is not a
    // valid terminal snapshot.
    ...(readOnly ? {} : { sessionKey: binding.relayStorageSessionKey }),
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
      sendInput: ignoreReadOnlyTerminalInput,
      sendLine: ignoreReadOnlyTerminalInput,
      restart: ignoreReadOnlyTerminalRestart,
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
        key={`${surfaceKey(target.surface)}:${mode}`}
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

function terminalWorkspaceCellFromTile(tile: TerminalWorkspaceTileModel): TerminalWorkspaceCellDefinition {
  if (tile.kind === "fresh") {
    return { kind: "fresh", backend: tile.backend, agent: tile.agent };
  }
  if (tile.kind === "unavailable") {
    return {
      kind: "registered",
      terminalSessionId: tile.terminalSessionId,
      terminalSurfaceKey: tile.terminalSurfaceKey,
    };
  }
  return {
    kind: "registered",
    terminalSessionId: tile.target.session.id,
    terminalSurfaceKey: surfaceKey(tile.target.surface),
  };
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
  const showContextMenu = useContextMenu();
  const [workspaceDefinitions, setWorkspaceDefinitions] = usePersistentState<TerminalWorkspaceDefinition[]>(
    TERMINAL_WORKSPACES_STORAGE_KEY,
    [],
  );
  const [workspaceView, setWorkspaceView] = useState<TerminalWorkspaceView>("library");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [workspaceDraftName, setWorkspaceDraftName] = useState("");
  const [workspaceDraftPurpose, setWorkspaceDraftPurpose] = useState("");
  const [workspaceDraftPresetId, setWorkspaceDraftPresetId] = useState<TerminalGridPreset["id"]>("quad");
  const [workspaceDraftCells, setWorkspaceDraftCells] = useState<TerminalWorkspaceCellDefinition[]>(
    Array.from({ length: 4 }, () => ({ kind: "fresh", backend: "pty", agent: "shell" })),
  );
  const [workspaceDraftSlot, setWorkspaceDraftSlot] = useState(0);
  const [state, setState] = useState<TerminalSessionsState>({ state: "loading", sessions: [] });
  const [tiles, setTiles] = useState<TerminalWorkspaceTileModel[]>([]);
  const [workspaceReload, setWorkspaceReload] = useState(0);
  const [gridColumns, setGridColumns] = useState(2);
  const [pickerVisible, setPickerVisible] = useState(true);
  const [pickerDraggedTargetId, setPickerDraggedTargetId] = useState<string | null>(null);
  const [pickerDropTileId, setPickerDropTileId] = useState<string | null>(null);
  const [pickerDropNewSlot, setPickerDropNewSlot] = useState(false);
  const [draggedTileId, setDraggedTileId] = useState<string | null>(null);
  const [dropTargetTileId, setDropTargetTileId] = useState<string | null>(null);
  const tileDragRef = useRef<{ pointerId: number; tileId: string; startX: number; startY: number } | null>(null);
  const dropTargetTileIdRef = useRef<string | null>(null);
  const pickerDragRef = useRef<{
    pointerId: number;
    target: RegisteredTerminalTarget;
    targetId: string;
    startX: number;
    startY: number;
  } | null>(null);
  const pickerDropTileIdRef = useRef<string | null>(null);
  const pickerDropNewSlotRef = useRef(false);

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
  const terminalAgents = useMemo(() => sortTerminalAgents(agents), [agents]);
  const sessionError = state.state === "failed" ? state.error : null;
  const activeWorkspace = workspaceDefinitions.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

  const enterWorkspace = useCallback((workspace: TerminalWorkspaceDefinition) => {
    const nextTiles = workspace.cells.map<TerminalWorkspaceTileModel>((cell) => {
      if (cell.kind === "fresh") return createFreshTerminalTile(cell.backend, cell.agent);
      const target = resolveRegisteredTerminalTarget(
        state.sessions,
        cell.terminalSessionId,
        cell.terminalSurfaceKey,
      );
      if (!target) {
        return {
          id: `unavailable:${cell.terminalSessionId}:${cell.terminalSurfaceKey}`,
          kind: "unavailable",
          terminalSessionId: cell.terminalSessionId,
          terminalSurfaceKey: cell.terminalSurfaceKey,
        };
      }
      return { id: registeredTerminalTileId(target), kind: "registered", target };
    });
    setTiles(nextTiles);
    setGridColumns(workspace.columns);
    setPickerVisible(false);
    setActiveWorkspaceId(workspace.id);
    setWorkspaceView("workspace");
  }, [state.sessions]);

  const persistActiveWorkspace = useCallback(() => {
    if (!activeWorkspaceId) return;
    setWorkspaceDefinitions((current) => current.map((workspace) => workspace.id === activeWorkspaceId
      ? {
          ...workspace,
          columns: gridColumns,
          cells: tiles.map(terminalWorkspaceCellFromTile),
          updatedAt: Date.now(),
        }
      : workspace));
  }, [activeWorkspaceId, gridColumns, setWorkspaceDefinitions, tiles]);

  const showWorkspaceLibrary = useCallback(() => {
    persistActiveWorkspace();
    setActiveWorkspaceId(null);
    setWorkspaceView("library");
  }, [persistActiveWorkspace]);

  const startWorkspaceBuilder = useCallback((workspace?: TerminalWorkspaceDefinition) => {
    if (activeWorkspaceId) persistActiveWorkspace();
    setEditingWorkspaceId(workspace?.id ?? null);
    setWorkspaceDraftName(workspace?.name ?? "");
    setWorkspaceDraftPurpose(workspace?.purpose ?? "");
    const matchingPreset = TERMINAL_GRID_PRESETS.find((preset) =>
      preset.columns === workspace?.columns && preset.slots === workspace.cells.length
    ) ?? TERMINAL_GRID_PRESETS[3];
    setWorkspaceDraftPresetId(matchingPreset.id);
    setWorkspaceDraftCells(workspace?.cells ?? Array.from(
      { length: matchingPreset.slots },
      () => ({ kind: "fresh" as const, backend: "pty" as const, agent: "shell" as const }),
    ));
    setWorkspaceDraftSlot(0);
    setWorkspaceView("builder");
  }, [activeWorkspaceId, persistActiveWorkspace]);

  const selectWorkspaceDraftPreset = useCallback((preset: TerminalGridPreset) => {
    setWorkspaceDraftPresetId(preset.id);
    setWorkspaceDraftCells((current) => Array.from(
      { length: preset.slots },
      (_, index) => current[index] ?? { kind: "fresh", backend: "pty", agent: "shell" },
    ));
    setWorkspaceDraftSlot((current) => Math.min(current, preset.slots - 1));
  }, []);

  const saveWorkspaceDraft = useCallback(() => {
    const name = workspaceDraftName.trim();
    if (!name) return;
    const preset = TERMINAL_GRID_PRESETS.find((candidate) => candidate.id === workspaceDraftPresetId)
      ?? TERMINAL_GRID_PRESETS[0];
    const definition: TerminalWorkspaceDefinition = {
      id: editingWorkspaceId ?? createTerminalTileId("workspace"),
      name,
      purpose: workspaceDraftPurpose.trim(),
      columns: preset.columns,
      cells: workspaceDraftCells.slice(0, preset.slots),
      updatedAt: Date.now(),
    };
    setWorkspaceDefinitions((current) => {
      const existingIndex = current.findIndex((workspace) => workspace.id === definition.id);
      if (existingIndex < 0) return [definition, ...current];
      const next = [...current];
      next[existingIndex] = definition;
      return next;
    });
    enterWorkspace(definition);
  }, [editingWorkspaceId, enterWorkspace, setWorkspaceDefinitions, workspaceDraftCells, workspaceDraftName, workspaceDraftPresetId, workspaceDraftPurpose]);

  const deleteWorkspace = useCallback((workspaceId: string) => {
    setWorkspaceDefinitions((current) => current.filter((workspace) => workspace.id !== workspaceId));
  }, [setWorkspaceDefinitions]);

  useEffect(() => {
    setTiles((current) => {
      let changed = false;
      const next = current.map((tile) => {
        if (tile.kind === "unavailable") {
          const nextTarget = resolveRegisteredTerminalTarget(
            state.sessions,
            tile.terminalSessionId,
            tile.terminalSurfaceKey,
          );
          if (!nextTarget) return tile;
          changed = true;
          return { id: registeredTerminalTileId(nextTarget), kind: "registered" as const, target: nextTarget };
        }
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

  useEffect(() => {
    if (workspaceView !== "workspace" || !activeWorkspaceId) return;
    setWorkspaceDefinitions((current) => current.map((workspace) => workspace.id === activeWorkspaceId
      ? {
          ...workspace,
          columns: gridColumns,
          cells: tiles.map(terminalWorkspaceCellFromTile),
          updatedAt: Date.now(),
        }
      : workspace));
  }, [activeWorkspaceId, gridColumns, setWorkspaceDefinitions, tiles, workspaceView]);

  const addFreshTile = useCallback((backend: TerminalBackend, agent: TerminalAgentKind = "shell") => {
    setTiles((current) => [...current, createFreshTerminalTile(backend, agent)]);
  }, []);

  const placeRegisteredTarget = useCallback((target: RegisteredTerminalTarget, destinationTileId?: string) => {
    const id = registeredTerminalTileId(target);
    setTiles((current) => {
      const sourceIndex = current.findIndex((tile) => tile.id === id);
      if (!destinationTileId) {
        if (sourceIndex >= 0) return current;
        return [...current, { id, kind: "registered", target }];
      }
      const destinationIndex = current.findIndex((tile) => tile.id === destinationTileId);
      if (destinationIndex < 0 || sourceIndex === destinationIndex) return current;
      const next = [...current];
      if (sourceIndex >= 0) {
        [next[sourceIndex], next[destinationIndex]] = [next[destinationIndex], next[sourceIndex]];
        return next;
      }
      next[destinationIndex] = { id, kind: "registered", target };
      return next;
    });
  }, []);

  const attachRegisteredTarget = useCallback((target: RegisteredTerminalTarget) => {
    placeRegisteredTarget(target);
  }, [placeRegisteredTarget]);

  const attachedTargetIds = useMemo(
    () => new Set(tiles.filter((tile) => tile.kind === "registered").map((tile) => tile.id)),
    [tiles],
  );

  const clearPickerDrag = useCallback((event?: ReactPointerEvent<HTMLElement>) => {
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pickerDragRef.current = null;
    pickerDropTileIdRef.current = null;
    pickerDropNewSlotRef.current = false;
    setPickerDraggedTargetId(null);
    setPickerDropTileId(null);
    setPickerDropNewSlot(false);
  }, []);

  const startPickerDrag = useCallback((event: ReactPointerEvent<HTMLElement>, item: TerminalHomeListItem) => {
    const target = event.target;
    if (event.button !== 0 || (target instanceof Element && target.closest("button, a"))) return;
    pickerDragRef.current = {
      pointerId: event.pointerId,
      target: registeredTargetFromListItem(item),
      targetId: registeredTerminalTileId(registeredTargetFromListItem(item)),
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const updatePickerDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = pickerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (distance < 6 && !pickerDraggedTargetId) return;
    if (!pickerDraggedTargetId) setPickerDraggedTargetId(drag.targetId);
    const workspace = document.querySelector<HTMLElement>(".s-term--workspace");
    if (workspace) {
      const workspaceRect = workspace.getBoundingClientRect();
      if (event.clientY < workspaceRect.top + 72) workspace.scrollTop -= 28;
      if (event.clientY > workspaceRect.bottom - 72) workspace.scrollTop += 28;
    }
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const cell = element?.closest<HTMLElement>(".s-term-workspace-cell");
    const isNewSlot = Boolean(
      element?.closest(".s-term-workspace-add-cell")
      || (!cell && element?.closest(".s-term--workspace") && !element?.closest(".s-term-picker")),
    );
    const nextTileId = isNewSlot ? null : cell?.dataset.terminalTileId ?? null;
    pickerDropTileIdRef.current = nextTileId;
    pickerDropNewSlotRef.current = isNewSlot;
    setPickerDropTileId(nextTileId);
    setPickerDropNewSlot(isNewSlot);
  }, [pickerDraggedTargetId]);

  const finishPickerDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = pickerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (pickerDropNewSlotRef.current) {
      placeRegisteredTarget(drag.target);
    } else if (pickerDropTileIdRef.current) {
      placeRegisteredTarget(drag.target, pickerDropTileIdRef.current);
    }
    clearPickerDrag(event);
  }, [clearPickerDrag, placeRegisteredTarget]);

  const cancelPickerDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    clearPickerDrag(event);
  }, [clearPickerDrag]);

  const attachAllLiveTerminals = useCallback(() => {
    const targets = liveTerminalItems.map(registeredTargetFromListItem);
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
  }, [liveTerminalItems]);

  const closeTile = useCallback((tileId: string) => {
    setTiles((current) => current.filter((tile) => tile.id !== tileId));
  }, []);

  const swapTiles = useCallback((firstTileId: string, secondTileId: string) => {
    if (firstTileId === secondTileId) return;
    setTiles((current) => {
      const firstIndex = current.findIndex((tile) => tile.id === firstTileId);
      const secondIndex = current.findIndex((tile) => tile.id === secondTileId);
      if (firstIndex < 0 || secondIndex < 0) return current;
      const next = [...current];
      [next[firstIndex], next[secondIndex]] = [next[secondIndex], next[firstIndex]];
      return next;
    });
  }, []);

  const moveTile = useCallback((tileId: string, offset: -1 | 1) => {
    setTiles((current) => {
      const currentIndex = current.findIndex((tile) => tile.id === tileId);
      const nextIndex = currentIndex + offset;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
      return next;
    });
  }, []);

  const replaceTile = useCallback((tileId: string, backend: TerminalBackend) => {
    setTiles((current) => current.map((tile) => tile.id === tileId ? createFreshTerminalTile(backend) : tile));
  }, []);

  const gridMenuItems = useCallback((): MenuItem[] => [
    { kind: "action", label: "One column", onSelect: () => setGridColumns(1) },
    { kind: "action", label: "Two columns", onSelect: () => setGridColumns(2) },
    { kind: "action", label: "Three columns", onSelect: () => setGridColumns(3) },
    { kind: "separator" },
    {
      kind: "action",
      label: "Edit workspace…",
      onSelect: () => activeWorkspace && startWorkspaceBuilder({
        ...activeWorkspace,
        columns: gridColumns,
        cells: tiles.map(terminalWorkspaceCellFromTile),
      }),
    },
  ], [activeWorkspace, gridColumns, startWorkspaceBuilder, tiles]);

  const showGridMenu = useCallback((event: ReactMouseEvent) => {
    showContextMenu(event, gridMenuItems());
  }, [gridMenuItems, showContextMenu]);

  const showTileMenu = useCallback((event: ReactMouseEvent, tile: TerminalWorkspaceTileModel) => {
    const tileIndex = tiles.findIndex((candidate) => candidate.id === tile.id);
    const items: MenuItem[] = [];
    if (tileIndex > 0) {
      items.push({ kind: "action", label: "Move left", onSelect: () => moveTile(tile.id, -1) });
    }
    if (tileIndex >= 0 && tileIndex < tiles.length - 1) {
      items.push({ kind: "action", label: "Move right", onSelect: () => moveTile(tile.id, 1) });
    }
    if (items.length > 0) items.push({ kind: "separator" });
    items.push(
      { kind: "action", label: "Replace with Shell", onSelect: () => replaceTile(tile.id, "pty") },
      { kind: "action", label: "Replace with Tmux", onSelect: () => replaceTile(tile.id, "tmux") },
      { kind: "action", label: "Replace with Zellij", onSelect: () => replaceTile(tile.id, "zellij") },
      { kind: "separator" },
      { kind: "action", label: "Remove cell", onSelect: () => closeTile(tile.id) },
      { kind: "separator" },
      ...gridMenuItems(),
    );
    showContextMenu(event, items);
  }, [closeTile, gridMenuItems, moveTile, replaceTile, showContextMenu, tiles]);

  const startTileDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, tileId: string) => {
    const target = event.target;
    const isDragHandle = event.button === 0
      && target instanceof Element
      && Boolean(target.closest(".s-term-bar"))
      && !target.closest("button, a");
    if (!isDragHandle) return;
    tileDragRef.current = {
      pointerId: event.pointerId,
      tileId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const updateTileDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = tileDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (distance < 6 && !draggedTileId) return;
    if (!draggedTileId) setDraggedTileId(drag.tileId);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".s-term-workspace-cell");
    const targetTileId = target?.dataset.terminalTileId ?? null;
    const nextDropTarget = targetTileId && targetTileId !== drag.tileId ? targetTileId : null;
    dropTargetTileIdRef.current = nextDropTarget;
    setDropTargetTileId(nextDropTarget);
  }, [draggedTileId]);

  const finishTileDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = tileDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const targetTileId = dropTargetTileIdRef.current;
    if (targetTileId) swapTiles(drag.tileId, targetTileId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    tileDragRef.current = null;
    dropTargetTileIdRef.current = null;
    setDraggedTileId(null);
    setDropTargetTileId(null);
  }, [swapTiles]);

  const reloadWorkspace = useCallback(() => {
    loadSessions();
    setWorkspaceReload((current) => current + 1);
  }, [loadSessions]);

  if (workspaceView === "library") {
    return (
      <TerminalWorkspaceLibrary
        workspaces={workspaceDefinitions}
        sessionsReady={state.state !== "loading"}
        onOpen={enterWorkspace}
        onCreate={() => startWorkspaceBuilder()}
        onEdit={startWorkspaceBuilder}
        onDelete={deleteWorkspace}
      />
    );
  }

  if (workspaceView === "builder") {
    const draftPreset = TERMINAL_GRID_PRESETS.find((preset) => preset.id === workspaceDraftPresetId)
      ?? TERMINAL_GRID_PRESETS[0];
    return (
      <TerminalWorkspaceBuilder
        editing={Boolean(editingWorkspaceId)}
        name={workspaceDraftName}
        purpose={workspaceDraftPurpose}
        presets={TERMINAL_GRID_PRESETS}
        selectedPreset={draftPreset}
        cells={workspaceDraftCells}
        selectedSlot={workspaceDraftSlot}
        terminalItems={liveTerminalItems}
        onNameChange={setWorkspaceDraftName}
        onPurposeChange={setWorkspaceDraftPurpose}
        onSelectPreset={selectWorkspaceDraftPreset}
        onSelectSlot={setWorkspaceDraftSlot}
        onAssignFresh={(backend) => setWorkspaceDraftCells((current) => current.map((cell, index) =>
          index === workspaceDraftSlot ? { kind: "fresh", backend, agent: "shell" } : cell
        ))}
        onAssignRegistered={(item) => setWorkspaceDraftCells((current) => current.map((cell, index) =>
          index === workspaceDraftSlot
            ? {
                kind: "registered",
                terminalSessionId: item.session.id,
                terminalSurfaceKey: surfaceKey(item.surface),
              }
            : cell
        ))}
        onCancel={() => {
          if (activeWorkspace) {
            setWorkspaceView("workspace");
          } else {
            setWorkspaceView("library");
          }
        }}
        onSave={saveWorkspaceDraft}
      />
    );
  }

  return (
    <div className="s-term s-term--workspace">
      <div className="s-term-workspace">
        <header className="s-term-workspace-head">
          <div className="s-term-workspace-title">
            <span className="s-term-summary-mark">
              <Grid2X2 size={18} strokeWidth={1.7} />
              <span>Workspaces / {activeWorkspace?.name ?? "Workspace"}</span>
            </span>
            <h1>{activeWorkspace?.name ?? "Workspace"}</h1>
            {activeWorkspace?.purpose && <p>{activeWorkspace.purpose}</p>}
          </div>
          <div className="s-term-workspace-actions" aria-label="Terminal workspace actions">
            <button
              type="button"
              className="s-term-workspace-action"
              onClick={showWorkspaceLibrary}
            >
              <span>All workspaces</span>
            </button>
            <button
              type="button"
              className="s-term-workspace-action s-term-workspace-action--primary"
              onClick={() => activeWorkspace && startWorkspaceBuilder({
                ...activeWorkspace,
                columns: gridColumns,
                cells: tiles.map(terminalWorkspaceCellFromTile),
              })}
            >
              <Grid2X2 size={14} strokeWidth={1.8} />
              <span>Edit workspace</span>
            </button>
            <button
              type="button"
              className="s-term-workspace-action"
              onClick={() => addFreshTile("pty")}
              title="Add a shell tile"
            >
              <Plus size={14} strokeWidth={1.9} />
              <span>Shell</span>
            </button>
            <button
              type="button"
              className="s-term-workspace-action"
              onClick={() => setPickerVisible((current) => !current)}
              title={pickerVisible ? "Hide terminal picker" : "Show terminal picker"}
              aria-pressed={pickerVisible}
            >
              <TerminalIcon size={14} strokeWidth={1.8} />
              <span>{pickerVisible ? "Hide picker" : "Show picker"}</span>
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

        {sessionError && (
          <div className="s-term-home-error">
            <span>Terminal registry unavailable</span>
            <code>{sessionError}</code>
          </div>
        )}

        {(tiles.length > 0 || pickerVisible) && (
          <div
            className="s-term-workspace-grid"
            aria-label="Terminal tiles"
            style={{ "--terminal-grid-columns": gridColumns } as CSSProperties}
            onContextMenu={showGridMenu}
          >
            {tiles.map((tile) => (
              <div
                key={`${tile.id}:${workspaceReload}`}
                className={`s-term-workspace-cell${draggedTileId === tile.id ? " s-term-workspace-cell--dragging" : ""}${dropTargetTileId === tile.id || pickerDropTileId === tile.id ? " s-term-workspace-cell--drop-target" : ""}`}
                data-terminal-tile-id={tile.id}
                onPointerDownCapture={(event) => startTileDrag(event, tile.id)}
                onPointerMove={updateTileDrag}
                onPointerUp={finishTileDrag}
                onPointerCancel={finishTileDrag}
                onContextMenu={(event) => showTileMenu(event, tile)}
              >
                <TerminalWorkspaceTile
                  tile={tile}
                  navigate={navigate}
                  onClose={closeTile}
                />
              </div>
            ))}
            {pickerVisible && (
              <button
                type="button"
                className={`s-term-workspace-add-cell${pickerDropNewSlot ? " s-term-workspace-add-cell--target" : ""}`}
                onClick={() => setPickerVisible(true)}
              >
                <Plus size={20} strokeWidth={1.7} />
                <strong>New slot</strong>
                <span>{pickerDraggedTargetId ? "Drop to add" : "Drag a terminal here"}</span>
              </button>
            )}
          </div>
        )}

        <section
          className={`s-term-picker${pickerVisible ? "" : " s-term-picker--collapsed"}`}
          aria-labelledby="terminal-picker-title"
          onPointerDownCapture={(event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const itemId = target.closest<HTMLElement>("[data-picker-item-id]")?.dataset.pickerItemId;
            const item = liveTerminalItems.find((candidate) => candidate.id === itemId);
            if (item) startPickerDrag(event, item);
          }}
          onPointerMove={updatePickerDrag}
          onPointerUp={finishPickerDrag}
          onPointerCancel={cancelPickerDrag}
        >
          <header className="s-term-picker-head">
            <div className="s-term-picker-title">
              <TerminalIcon size={14} strokeWidth={1.8} />
              <h2 id="terminal-picker-title">Terminal picker</h2>
              <span>{state.state === "loading" ? "syncing" : liveTerminalItems.length}</span>
            </div>
            <div className="s-term-picker-actions">
              {pickerVisible && (
                <button
                  type="button"
                  className="s-term-workspace-action"
                  onClick={attachAllLiveTerminals}
                  disabled={liveTerminalItems.length === 0}
                >
                  <LogIn size={13} strokeWidth={1.8} />
                  <span>Attach all</span>
                </button>
              )}
              <button
                type="button"
                className="s-term-picker-toggle"
                onClick={() => setPickerVisible((current) => !current)}
                aria-expanded={pickerVisible}
              >
                <span>{pickerVisible ? "Hide" : "Show terminal picker"}</span>
                <span aria-hidden="true">{pickerVisible ? "⌄" : "⌃"}</span>
              </button>
            </div>
          </header>
          {pickerVisible && (
            <>
              <p className="s-term-picker-hint">Drag a terminal onto a cell to place it, or onto New slot to grow the grid.</p>
              <div
                className="s-term-picker-list"
                aria-label="Available terminals"
              >
                {liveTerminalItems.length === 0 && state.state !== "loading" ? (
                  <div className="s-term-picker-empty">No live terminals</div>
                ) : (
                  liveTerminalItems.map((item) => {
                    const targetId = registeredTerminalTileId(registeredTargetFromListItem(item));
                    return (
                      <TerminalPickerItem
                        key={item.id}
                        item={item}
                        attached={attachedTargetIds.has(targetId)}
                        dragging={pickerDraggedTargetId === targetId}
                        onAttach={attachRegisteredTarget}
                      />
                    );
                  })
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function TerminalWorkspaceLibrary({
  workspaces,
  sessionsReady,
  onOpen,
  onCreate,
  onEdit,
  onDelete,
}: {
  workspaces: TerminalWorkspaceDefinition[];
  sessionsReady: boolean;
  onOpen: (workspace: TerminalWorkspaceDefinition) => void;
  onCreate: () => void;
  onEdit: (workspace: TerminalWorkspaceDefinition) => void;
  onDelete: (workspaceId: string) => void;
}) {
  return (
    <div className="s-term s-term--workspace-library">
      <main className="s-term-workspace-library">
        <header className="s-term-workspace-library-head">
          <div>
            <span className="s-term-summary-mark">
              <Grid2X2 size={18} strokeWidth={1.7} />
              <span>Terminals</span>
            </span>
            <h1>Workspaces</h1>
            <p>Saved terminal layouts for projects, roles, and cross-project operations.</p>
          </div>
          <button type="button" className="s-term-workspace-action s-term-workspace-action--primary" onClick={onCreate}>
            <Plus size={14} strokeWidth={1.9} />
            <span>New workspace</span>
          </button>
        </header>

        {workspaces.length === 0 ? (
          <section className="s-term-workspace-library-empty">
            <Grid2X2 size={24} strokeWidth={1.5} />
            <h2>Create your first terminal workspace</h2>
            <p>Choose a layout, give it a purpose, place sessions, then enter the grid.</p>
            <button type="button" className="s-term-workspace-action s-term-workspace-action--primary" onClick={onCreate}>
              <Plus size={14} strokeWidth={1.9} />
              <span>Create workspace</span>
            </button>
          </section>
        ) : (
          <div className="s-term-workspace-library-grid">
            {workspaces.map((workspace) => (
              <article className="s-term-workspace-card" key={workspace.id}>
                <div className="s-term-workspace-card-preview" style={{ "--terminal-grid-columns": workspace.columns } as CSSProperties}>
                  {workspace.cells.map((cell, index) => (
                    <span key={index} className={cell.kind === "registered" ? "is-session" : "is-shell"} />
                  ))}
                </div>
                <div className="s-term-workspace-card-copy">
                  <span>{workspace.columns} column{workspace.columns === 1 ? "" : "s"} · {workspace.cells.length} cells</span>
                  <h2>{workspace.name}</h2>
                  <p>{workspace.purpose || "No purpose added yet."}</p>
                </div>
                <div className="s-term-workspace-card-actions">
                  <button type="button" className="s-term-workspace-action" onClick={() => onEdit(workspace)}>Edit</button>
                  <button type="button" className="s-term-workspace-action" onClick={() => onDelete(workspace.id)}>Delete</button>
                  <button
                    type="button"
                    className="s-term-workspace-action s-term-workspace-action--primary"
                    onClick={() => onOpen(workspace)}
                    disabled={!sessionsReady}
                  >
                    Enter workspace
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function TerminalWorkspaceBuilder({
  editing,
  name,
  purpose,
  presets,
  selectedPreset,
  cells,
  selectedSlot,
  terminalItems,
  onNameChange,
  onPurposeChange,
  onSelectPreset,
  onSelectSlot,
  onAssignFresh,
  onAssignRegistered,
  onCancel,
  onSave,
}: {
  editing: boolean;
  name: string;
  purpose: string;
  presets: readonly TerminalGridPreset[];
  selectedPreset: TerminalGridPreset;
  cells: TerminalWorkspaceCellDefinition[];
  selectedSlot: number;
  terminalItems: TerminalHomeListItem[];
  onNameChange: (value: string) => void;
  onPurposeChange: (value: string) => void;
  onSelectPreset: (preset: TerminalGridPreset) => void;
  onSelectSlot: (slot: number) => void;
  onAssignFresh: (backend: TerminalBackend) => void;
  onAssignRegistered: (item: TerminalHomeListItem) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="s-term s-term--workspace-builder">
      <main className="s-term-workspace-builder">
        <header className="s-term-workspace-builder-head">
          <div>
            <span className="s-term-summary-mark">
              <Grid2X2 size={18} strokeWidth={1.7} />
              <span>Workspace builder</span>
            </span>
            <h1>{editing ? "Edit workspace" : "Create a workspace"}</h1>
            <p>Define the job, choose the grid, and place the sessions before entering.</p>
          </div>
          <div className="s-term-workspace-builder-actions">
            <button type="button" className="s-term-workspace-action" onClick={onCancel}>Cancel</button>
            <button
              type="button"
              className="s-term-workspace-action s-term-workspace-action--primary"
              onClick={onSave}
              disabled={!name.trim()}
            >
              {editing ? "Save and enter" : "Create and enter"}
            </button>
          </div>
        </header>

        <section className="s-term-workspace-builder-identity" aria-label="Workspace identity">
          <label>
            <span>Name</span>
            <input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="Release desk" autoFocus />
          </label>
          <label>
            <span>Purpose</span>
            <input value={purpose} onChange={(event) => onPurposeChange(event.target.value)} placeholder="Cross-project release monitoring" />
          </label>
        </section>

        <section className="s-term-workspace-builder-layout" aria-labelledby="workspace-layout-title">
          <div className="s-term-workspace-builder-section-head">
            <div>
              <span>Step 1</span>
              <h2 id="workspace-layout-title">Choose the layout</h2>
            </div>
            <p>{selectedPreset.label} · {selectedPreset.detail}</p>
          </div>
          <div className="s-term-grid-presets" aria-label="Workspace grid layout">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`s-term-grid-preset${preset.id === selectedPreset.id ? " s-term-grid-preset--selected" : ""}`}
                onClick={() => onSelectPreset(preset)}
                aria-pressed={preset.id === selectedPreset.id}
              >
                <span className="s-term-grid-preset-map" style={{ "--terminal-preset-columns": preset.columns } as CSSProperties} aria-hidden="true">
                  {Array.from({ length: preset.slots }, (_, index) => <i key={index} />)}
                </span>
                <span className="s-term-grid-preset-label">{preset.label}</span>
                <span className="s-term-grid-preset-detail">{preset.detail}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="s-term-workspace-builder-placement" aria-labelledby="workspace-placement-title">
          <div className="s-term-workspace-builder-section-head">
            <div>
              <span>Step 2</span>
              <h2 id="workspace-placement-title">Place terminals</h2>
            </div>
            <p>Select a cell, then choose a session or shell.</p>
          </div>
          <div className="s-term-workspace-builder-canvas">
            <div className="s-term-workspace-builder-grid" style={{ "--terminal-grid-columns": selectedPreset.columns } as CSSProperties}>
              {cells.slice(0, selectedPreset.slots).map((cell, index) => {
                const registeredItem = cell.kind === "registered"
                  ? terminalItems.find((item) => item.session.id === cell.terminalSessionId && surfaceKey(item.surface) === cell.terminalSurfaceKey)
                  : null;
                return (
                  <button
                    type="button"
                    key={index}
                    className={`s-term-workspace-builder-cell${selectedSlot === index ? " is-selected" : ""}`}
                    onClick={() => onSelectSlot(index)}
                    aria-pressed={selectedSlot === index}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <TerminalIcon size={17} strokeWidth={1.7} />
                    <strong>{cell.kind === "registered" ? registeredItem?.title ?? "Unavailable session" : freshTerminalLabel(cell.backend, cell.agent).title}</strong>
                    <small>{cell.kind === "registered" ? registeredItem?.cwdLabel || registeredItem?.detail : cell.backend}</small>
                  </button>
                );
              })}
            </div>
            <aside className="s-term-workspace-builder-source">
              <span>Cell {String(selectedSlot + 1).padStart(2, "0")}</span>
              <h3>Start something new</h3>
              <div className="s-term-workspace-builder-source-actions">
                {TERMINAL_BACKEND_OPTIONS.map((option) => (
                  <button type="button" key={option.value} onClick={() => onAssignFresh(option.value)}>{option.label}</button>
                ))}
              </div>
              <h3>Or use a live session</h3>
              <div className="s-term-workspace-builder-sessions">
                {terminalItems.length === 0 ? (
                  <span className="s-term-workspace-builder-no-sessions">No live sessions</span>
                ) : terminalItems.map((item) => (
                  <button type="button" key={item.id} onClick={() => onAssignRegistered(item)}>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.cwdLabel || item.detail}</small>
                    </span>
                    <em>{item.surface.backend}</em>
                  </button>
                ))}
              </div>
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}

function TerminalPickerItem({
  item,
  attached,
  dragging,
  onAttach,
}: {
  item: TerminalHomeListItem;
  attached: boolean;
  dragging: boolean;
  onAttach: (target: RegisteredTerminalTarget) => void;
}) {
  return (
    <article
      className={`s-term-picker-item${attached ? " s-term-picker-item--attached" : ""}${dragging ? " s-term-picker-item--dragging" : ""}`}
      data-picker-item-id={item.id}
    >
      <span className="s-term-picker-grip" aria-hidden="true">⠿</span>
      <div className="s-term-picker-item-main">
        <strong title={item.surface.sessionName}>{item.title}</strong>
        <span title={item.session.cwd ?? item.detail}>{item.cwdLabel || item.detail}</span>
      </div>
      <div className="s-term-picker-item-meta">
        <span>{item.surface.backend}</span>
        <span>{item.condition}</span>
      </div>
      <button
        type="button"
        className="s-term-picker-add"
        onClick={() => onAttach(registeredTargetFromListItem(item))}
        disabled={attached}
      >
        {attached ? "In grid" : "Add"}
      </button>
    </article>
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
  if (tile.kind === "unavailable") {
    return (
      <section className="s-term-workspace-tile s-term-workspace-tile--unavailable" aria-label="Unavailable terminal session">
        <div className="s-term-bar">
          <div className="s-term-bar-left">
            <span className="s-term-workspace-tile-mark"><TerminalIcon size={14} strokeWidth={1.8} /></span>
            <span className="s-term-workspace-tile-name">Session unavailable</span>
          </div>
          <div className="s-term-bar-actions">
            <button
              type="button"
              className="s-term-icon-button s-term-icon-button--danger"
              onClick={() => onClose(tile.id)}
              title="Remove cell"
              aria-label="Remove cell"
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>
        <div className="s-term-workspace-unavailable-body">
          <TerminalIcon size={22} strokeWidth={1.5} />
          <strong>This saved session is not currently live.</strong>
          <span>Show the terminal picker to replace it, or wait for the session to reconnect.</span>
        </div>
      </section>
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
    controlMode: "takeover",
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
    ? `${terminalSurface.backend}:${agent.id}:${terminalSurface.sessionName}:${mode ?? "takeover"}`
    : `takeover:${agentId}:${mode ?? "takeover"}`;

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
