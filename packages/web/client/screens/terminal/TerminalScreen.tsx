import "./terminal-screen.css";

import { useTerminalRelay, TerminalRelay } from "@hudsonkit";
import { Eye, LogIn, MoreHorizontal, Power, Square, Terminal as TerminalIcon, Zap } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useScout } from "../../scout/Provider.tsx";
import { api } from "../../lib/api.ts";
import { actorColor } from "../../lib/colors.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { routePath } from "../../lib/router.ts";
import {
  resolveScoutTerminalRelayHealthUrl,
  resolveScoutTerminalRelayUrl,
} from "../../lib/runtime-config.ts";
import { queueTakeover } from "../../lib/terminal-takeover.ts";
import { createVantageHandoff, formatVantageLinkLabel } from "../../lib/vantage.ts";
import type { Agent, Route, SessionCatalogWithResume, TerminalSurfaceDescriptor } from "../../lib/types.ts";
import {
  fetchTerminalSessions,
  resolveRegisteredTerminalTarget,
  surfaceKey,
  terminalConditionLabel,
  terminalListItems,
  terminalSurfaceDescriptorFromRegisteredSurface,
  type RegisteredTerminalTarget,
} from "../../lib/terminal-sessions.ts";
import { TmuxPeekPanel } from "../../scout/inspector/TmuxPeek.tsx";
import { BackToPicker } from "../../scout/slots/BackToPicker.tsx";
import { useContextMenu, type MenuItem } from "../../components/ContextMenu.tsx";

function relayAgentForHarness(harness: string | null | undefined): "claude" | "pi" | undefined {
  return harness === "pi" ? "pi" : undefined;
}

function agentTmuxTerminalSessionKey(agentId: string, tmuxSession: string): string {
  return `scout-tmux-${agentId}-${tmuxSession}`;
}

function agentTerminalSurface(agent: Agent | null): TerminalSurfaceDescriptor | null {
  if (!agent) return null;
  if (agent.terminalSurface) return agent.terminalSurface;
  if (agent.transport === "tmux" && agent.harnessSessionId) {
    return {
      backend: "tmux",
      sessionName: agent.harnessSessionId,
      paneId: null,
      socketDir: null,
    };
  }
  return null;
}

function terminalRelayUrlForAgent(url: string, agentId: string | undefined): string {
  if (!agentId) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("agentId", agentId);
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}agentId=${encodeURIComponent(agentId)}`;
  }
}

function shouldBootstrapTakeover(agent: Agent | null, mode: "observe" | "takeover" | undefined): agent is Agent {
  return mode === "takeover" && Boolean(agent) && !agentTerminalSurface(agent);
}

const SCOUT_TERMINAL_INITIAL_COLS = 132;
const SCOUT_TERMINAL_INITIAL_ROWS = 44;
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function absoluteRouteUrl(route: Route): string {
  const path = routePath(route);
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.href).toString();
}

export function TerminalScreen({
  agentId,
  mode,
  terminalSessionId,
  terminalSurfaceKey,
  navigate,
}: {
  agentId?: string;
  mode?: "observe" | "takeover";
  terminalSessionId?: string;
  terminalSurfaceKey?: string;
  navigate: (r: Route) => void;
}) {
  const { agents } = useScout();
  if (!agentId) {
    return (
      <RegisteredTerminalSessionsScreen
        terminalSessionId={terminalSessionId}
        terminalSurfaceKey={terminalSurfaceKey}
        mode={mode}
        navigate={navigate}
      />
    );
  }

  const agent = agentId ? agents.find((a) => a.id === agentId) ?? null : null;
  if (agentId && !agent) {
    return (
      <div className="s-term">
        <div className="s-term-bar">
          <BackToPicker
            slot="terminal"
            fallback={{ view: "agents" }}
            navigate={navigate}
            className="s-term-back"
          />
          <span className="s-term-label">Terminal</span>
          <div className="s-term-status">Resolving agent...</div>
        </div>
      </div>
    );
  }

  const terminalSurface = agentTerminalSurface(agent);
  const relayKey = agent && terminalSurface
    ? `${terminalSurface.backend}:${agent.id}:${terminalSurface.sessionName}`
    : agentId
      ? `takeover:${agentId}`
      : "takeover";

  return (
    <TerminalTakeoverBootstrap
      key={relayKey}
      agentId={agentId}
      agent={agent}
      mode={mode}
      navigate={navigate}
    >
      <TerminalRelayScreen
        agentId={agentId}
        agent={agent}
        mode={mode}
        navigate={navigate}
      />
    </TerminalTakeoverBootstrap>
  );
}

function RegisteredTerminalSessionsScreen({
  terminalSessionId,
  terminalSurfaceKey,
  mode,
  navigate,
}: {
  terminalSessionId?: string;
  terminalSurfaceKey?: string;
  mode?: "observe" | "takeover";
  navigate: (r: Route) => void;
}) {
  const [state, setState] = useState<
    | { state: "loading"; sessions: Awaited<ReturnType<typeof fetchTerminalSessions>> }
    | { state: "ready"; sessions: Awaited<ReturnType<typeof fetchTerminalSessions>> }
    | { state: "failed"; sessions: Awaited<ReturnType<typeof fetchTerminalSessions>>; error: string }
  >({ state: "loading", sessions: [] });

  const loadSessions = useCallback(() => {
    setState((current) => ({ state: "loading", sessions: current.sessions }));
    void fetchTerminalSessions()
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

  if (target && mode) {
    return (
      <TerminalRelayScreen
        agent={null}
        mode={mode}
        navigate={navigate}
        registeredTarget={target}
      />
    );
  }

  if (target) {
    return (
      <TerminalSummaryScreen
        target={target}
        navigate={navigate}
      />
    );
  }

  return (
    <div className="s-term s-term--empty-main">
      <div className="s-term-empty-main-mark">
        <TerminalIcon size={18} strokeWidth={1.6} />
        <span>
          {state.state === "loading"
            ? "Loading terminal"
            : state.state === "failed"
              ? "Terminal list unavailable"
              : terminalSessionId
                ? "Terminal unavailable"
                : "Select a terminal"}
        </span>
        {state.state === "failed" && (
          <button type="button" className="s-term-empty-action" onClick={loadSessions}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

function TerminalSummaryScreen({
  target,
  navigate,
}: {
  target: RegisteredTerminalTarget;
  navigate: (r: Route) => void;
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
  const origin = target.session.metadata?.registryState === "discovered" ? "Backend" : "Scout";
  const backendState = typeof target.session.metadata?.backendState === "string"
    ? target.session.metadata.backendState
    : target.surface.state;
  const condition = terminalConditionLabel(target.session, target.surface);
  const detailRows = [
    ["Backend", target.surface.backend],
    ["Session", target.surface.sessionName],
    ["Origin", origin],
    ["Condition", condition],
    ["State", backendState],
    ["Harness", target.session.harness],
    ["Working Dir", target.session.cwd],
    ["Source Id", target.session.sourceSessionId],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <div className="s-term s-term--summary">
      <div className="s-term-summary">
        <div className="s-term-summary-main">
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
              onClick={() => navigate({ ...routeBase, mode: "takeover" })}
            >
              <LogIn size={14} strokeWidth={1.8} />
              <span>Enter</span>
            </button>
            <button
              type="button"
              className="s-term-summary-action"
              onClick={() => navigate({ ...routeBase, mode: "observe" })}
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

function TerminalTakeoverBootstrap({
  agentId,
  agent,
  mode,
  navigate,
  children,
}: {
  agentId?: string;
  agent: Agent | null;
  mode?: "observe" | "takeover";
  navigate: (r: Route) => void;
  children: ReactNode;
}) {
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

  if (state.state === "ready") return <>{children}</>;

  return (
    <TerminalPlaceholder
      agent={agent}
      agentId={agentId}
      navigate={navigate}
      label={state.state === "failed" ? "TAKEOVER FAILED" : "PREPARING TAKEOVER"}
      status={state.state === "failed" ? state.error : "Resolving live session..."}
      onRetry={state.state === "failed" ? () => setRetryNonce((value) => value + 1) : undefined}
    />
  );
}

function TerminalPlaceholder({
  agent,
  agentId,
  navigate,
  label,
  status,
  onRetry,
}: {
  agent: Agent | null;
  agentId?: string;
  navigate: (r: Route) => void;
  label: string;
  status: string;
  onRetry?: () => void;
}) {
  const color = agent ? actorColor(agent.name) : "var(--accent)";
  return (
    <div className="s-term">
      <div className="s-term-bar">
        <BackToPicker
          slot="terminal"
          fallback={agentId ? { view: "agents", agentId } : { view: "inbox" }}
          navigate={navigate}
          className="s-term-back"
        />
        {agent && (
          <div className="s-term-agent">
            <div
              className="s-ops-avatar"
              style={{ "--size": "18px", background: color } as React.CSSProperties}
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

function TerminalRelayScreen({
  agentId,
  agent,
  mode,
  navigate,
  registeredTarget,
}: {
  agentId?: string;
  agent: Agent | null;
  mode?: "observe" | "takeover";
  navigate: (r: Route) => void;
  registeredTarget?: RegisteredTerminalTarget;
}) {
  const color = agent ? actorColor(agent.name) : "var(--accent)";
  const showContextMenu = useContextMenu();
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const terminalSurface = registeredTarget
    ? terminalSurfaceDescriptorFromRegisteredSurface(registeredTarget.surface)
    : agentTerminalSurface(agent);
  const readOnly = mode === "observe";
  const cwd = registeredTarget?.session.cwd ?? agent?.cwd ?? agent?.projectRoot ?? undefined;
  const relayAgent = relayAgentForHarness(registeredTarget?.session.harness ?? agent?.harness);
  const [handoffState, setHandoffState] = useState<
    | { state: "idle" }
    | { state: "opening" }
    | { state: "opened"; detail: string }
    | { state: "failed"; error: string }
  >({ state: "idle" });
  const relayUrl = resolveScoutTerminalRelayUrl();
  const healthUrl = resolveScoutTerminalRelayHealthUrl();
  const scopedRelayUrl = terminalRelayUrlForAgent(relayUrl, agentId);
  const terminalSessionKey = terminalSurface && agent
    ? `scout-terminal-${terminalSurface.backend}-${agent.id}-${terminalSurface.sessionName}`
    : registeredTarget && terminalSurface
      ? `scout-terminal-registry-${registeredTarget.session.id}-${terminalSurface.backend}-${terminalSurface.sessionName}`
      : agentId
      ? `scout-takeover-${agentId}`
      : "scout-takeover";
  const relayStorageSessionKey = terminalSurface?.backend === "tmux" && agent
    ? agentTmuxTerminalSessionKey(agent.id, terminalSurface.sessionName)
    : terminalSessionKey;
  const terminalRelaySurfaceOptions = terminalSurface
    ? {
        backend: terminalSurface.backend,
        terminalSession: terminalSurface.sessionName,
        ...(terminalSurface.backend === "tmux" ? { tmuxSession: terminalSurface.sessionName } : {}),
        ...(terminalSurface.backend === "zellij"
          ? {
              zellijSession: terminalSurface.sessionName,
              ...(terminalSurface.socketDir ? { zellijSocketDir: terminalSurface.socketDir } : {}),
            }
          : {}),
      }
    : {};

  const relay = useTerminalRelay({
    url: scopedRelayUrl,
    healthUrl,
    autoConnect: true,
    sessionKey: relayStorageSessionKey,
    ...terminalRelaySurfaceOptions,
    ...(terminalSurface ? { orphanTTL: 1_000 } : {}),
    ...(cwd ? { cwd } : {}),
    ...(relayAgent ? { agent: relayAgent } : {}),
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
  const terminalRouteBase: Route = registeredTarget
    ? {
        view: "terminal",
        terminalSessionId: registeredTarget.session.id,
        terminalSurfaceKey: surfaceKey(registeredTarget.surface),
      }
    : agentId
    ? { view: "terminal", agentId }
    : { view: "terminal" };
  const currentTerminalRoute: Route = mode
    ? { ...terminalRouteBase, mode }
    : terminalRouteBase;
  const copyTerminalLink = useCallback(() => {
    void copyTextToClipboard(absoluteRouteUrl(currentTerminalRoute));
  }, [currentTerminalRoute]);
  const focusTerminal = useCallback(() => {
    const root = terminalBodyRef.current;
    const helper = root?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
    const terminal = root?.querySelector<HTMLElement>(".xterm");
    helper?.focus();
    terminal?.focus();
  }, []);
  const pasteClipboard = useCallback(() => {
    if (readOnly || !navigator.clipboard?.readText) return;
    void navigator.clipboard.readText()
      .then((text) => {
        if (text) terminalRelay.sendInput(text);
      })
      .catch(() => {});
  }, [readOnly, terminalRelay]);
  const clearRelayStorage = useCallback(() => {
    try {
      window.localStorage.removeItem(`hudson.relay.${relayStorageSessionKey}`);
    } catch {
      // localStorage can be unavailable in hardened browser contexts.
    }
  }, [relayStorageSessionKey]);
  const controlTerminalSurface = useCallback((action: "interrupt" | "quit" | "stop-job" | "restart-resume" | "detach" | "force-quit" | "force-quit-bridge") => {
    if (!terminalSurface) return null;
    return api<{
      ok: true;
      action: string;
      backend: string;
      sessionName: string;
      delivered: boolean;
      destroyed: number;
      resumeSessionId?: string | null;
      resumeTranscriptPath?: string | null;
    }>("/api/terminal-sessions/control", {
      method: "POST",
      body: JSON.stringify({
        backend: terminalSurface.backend,
        sessionName: terminalSurface.sessionName,
        action,
      }),
    });
  }, [terminalSurface]);
  const detachRelay = useCallback(() => {
    clearRelayStorage();
    const surfaceControl = controlTerminalSurface("detach");
    if (surfaceControl) {
      void surfaceControl.finally(() => relay.disconnect());
      return;
    }
    relay.disconnect();
  }, [clearRelayStorage, controlTerminalSurface, relay]);
  const reconnectRelay = useCallback(() => {
    clearRelayStorage();
    const surfaceControl = controlTerminalSurface("force-quit-bridge");
    if (surfaceControl) {
      void surfaceControl.finally(() => {
        relay.connect();
        window.setTimeout(focusTerminal, 250);
      });
      return;
    }
    relay.connect();
    window.setTimeout(focusTerminal, 250);
  }, [clearRelayStorage, controlTerminalSurface, focusTerminal, relay]);
  const interruptTerminal = useCallback(() => {
    if (readOnly) return;
    const surfaceControl = controlTerminalSurface("interrupt");
    if (surfaceControl) {
      void surfaceControl.catch(() => {
        terminalRelay.sendInput("\x03");
      });
    } else {
      terminalRelay.sendInput("\x03");
    }
    focusTerminal();
  }, [controlTerminalSurface, focusTerminal, readOnly, terminalRelay]);
  const quitTerminal = useCallback(() => {
    if (readOnly) return;
    const surfaceControl = controlTerminalSurface("quit");
    if (surfaceControl) {
      void surfaceControl.catch(() => {
        terminalRelay.sendInput("\x04");
      });
    } else {
      terminalRelay.sendInput("\x04");
    }
    focusTerminal();
  }, [controlTerminalSurface, focusTerminal, readOnly, terminalRelay]);
  const stopTerminalJob = useCallback(() => {
    if (readOnly) return;
    const surfaceControl = controlTerminalSurface("stop-job");
    if (surfaceControl) {
      void surfaceControl.finally(focusTerminal);
      return;
    }
    focusTerminal();
  }, [controlTerminalSurface, focusTerminal, readOnly]);
  const forceQuitClaudeInstance = useCallback(() => {
    clearRelayStorage();
    if (terminalSurface && !window.confirm(`Force quit Claude in ${terminalSurface.sessionName}?`)) {
      return;
    }
    const surfaceControl = controlTerminalSurface("force-quit");
    if (surfaceControl) {
      void surfaceControl.finally(() => {
        relay.disconnect();
      });
      return;
    }
    const sessionId = relay.sessionId;
    if (!sessionId) {
      relay.disconnect();
      return;
    }
    void api<{ ok: true; destroyed: boolean }>("/api/terminal-relay/session/destroy", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    })
      .catch(() => {})
      .finally(() => {
        relay.disconnect();
      });
  }, [clearRelayStorage, controlTerminalSurface, relay, terminalSurface]);
  const restartResumeClaudeInstance = useCallback(() => {
    if (!terminalSurface) return;
    if (!window.confirm(`Restart Claude in ${terminalSurface.sessionName} and resume its latest session?`)) {
      return;
    }
    clearRelayStorage();
    const surfaceControl = controlTerminalSurface("restart-resume");
    if (surfaceControl) {
      void surfaceControl.finally(() => {
        relay.disconnect();
        window.setTimeout(() => {
          relay.connect();
          window.setTimeout(focusTerminal, 250);
        }, 600);
      });
    }
  }, [clearRelayStorage, controlTerminalSurface, focusTerminal, relay, terminalSurface]);
  const openMode = useCallback((nextMode: "observe" | "takeover") => {
    navigate({ ...terminalRouteBase, mode: nextMode });
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
          setHandoffState({
            state: "failed",
            error: handoff.launch.error,
          });
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
        onSelect: () => {
          void copyTextToClipboard(selection);
        },
      });
    }
    if (!readOnly) {
      items.push({
        kind: "action",
        label: "Paste",
        shortcut: "⌘V",
        onSelect: pasteClipboard,
      });
      items.push({
        kind: "action",
        label: "Send Ctrl-C",
        shortcut: "⌃C",
        onSelect: interruptTerminal,
      });
      items.push({
        kind: "action",
        label: "Quit With Ctrl-D",
        shortcut: "⌃D",
        onSelect: quitTerminal,
      });
      items.push({
        kind: "action",
        label: "Stop Running Job",
        onSelect: stopTerminalJob,
      });
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

  const hasViewActions = Boolean(registeredTarget || terminalSurface);
  const canSignalTerminal = !readOnly && Boolean(terminalSurface || relay.status === "connected");
  const canStopTerminalJob = !readOnly && Boolean(terminalSurface);

  return (
    <div className="s-term">
      <div className="s-term-bar s-term-bar--takeover">
        <div className="s-term-bar-left">
          {!registeredTarget && (
            <BackToPicker
              slot="terminal"
              fallback={agentId ? { view: "agents", agentId } : { view: "terminal" }}
              navigate={navigate}
              className="s-term-back"
            />
          )}
          {agent && (
            <div className="s-term-agent">
              <div
                className="s-ops-avatar"
                style={{ "--size": "18px", background: color } as React.CSSProperties}
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
            {terminalSurface ? (readOnly ? "TERMINAL OBSERVE" : "TERMINAL TAKEOVER") : "TAKEOVER"}
          </span>
          {terminalSurface && (
            <span className="s-term-session" title={terminalSurface.sessionName}>
              {terminalSurface.backend} · {terminalSurface.sessionName}
            </span>
          )}
        </div>
        <div className="s-term-bar-actions">
          {hasViewActions && (
            <div className="s-term-action-cluster s-term-action-cluster--view" aria-label="Terminal view actions">
              {registeredTarget && (
                <button
                  type="button"
                  className="s-term-vantage"
                  onClick={openSummary}
                  title="Leave the terminal canvas and show the session summary"
                >
                  Summary
                </button>
              )}
              {terminalSurface && (
                <button
                  type="button"
                  className="s-term-vantage"
                  onClick={() =>
                    openMode(readOnly ? "takeover" : "observe")
                  }
                  title={readOnly ? "Switch to interactive takeover" : "Switch to read-only terminal observe"}
                >
                  {readOnly ? "Takeover" : "Observe"}
                </button>
              )}
            </div>
          )}
          {(canSignalTerminal || canStopTerminalJob) && (
            <div className="s-term-action-cluster s-term-action-cluster--signals" aria-label="Terminal signal actions">
              {canSignalTerminal && (
                <button
                  type="button"
                  className="s-term-vantage s-term-vantage--warn"
                  onClick={interruptTerminal}
                  title="Send Ctrl-C to the terminal"
                >
                  <Zap size={13} strokeWidth={1.8} />
                  <span>Ctrl-C</span>
                </button>
              )}
              {canSignalTerminal && (
                <button
                  type="button"
                  className="s-term-vantage s-term-vantage--warn"
                  onClick={quitTerminal}
                  title="Send Ctrl-D / EOF to the terminal"
                >
                  <Power size={13} strokeWidth={1.8} />
                  <span>Quit</span>
                </button>
              )}
              {canStopTerminalJob && (
                <button
                  type="button"
                  className="s-term-vantage s-term-vantage--warn"
                  onClick={stopTerminalJob}
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
            onClick={handleSessionMenu}
            title="Open session, recovery, and external handoff actions"
          >
            <MoreHorizontal size={14} strokeWidth={1.8} />
            <span>Session</span>
          </button>
          {handoffState.state === "opening" && (
            <span className="s-term-handoff">Opening Vantage...</span>
          )}
          {handoffState.state === "opened" && (
            <span className="s-term-handoff s-term-handoff--ok">{handoffState.detail}</span>
          )}
          {handoffState.state === "failed" && (
            <span className="s-term-handoff s-term-handoff--error">{handoffState.error}</span>
          )}
          <div className="s-term-status">
            {relay.status === "connected"
              ? "LIVE"
              : relay.status === "connecting"
                ? "CONNECTING"
                : "OFFLINE"}
          </div>
        </div>
      </div>
      <div
        ref={terminalBodyRef}
        className="s-term-body"
        onContextMenuCapture={handleTerminalContextMenu}
      >
        <TerminalRelay
          relay={terminalRelay}
          fontSize={13}
          quiet
          configItems={[
            ...(terminalSurface
              ? [
                  { label: "backend", value: terminalSurface.backend },
                  { label: "session", value: terminalSurface.sessionName },
                  ...(terminalSurface.paneId ? [{ label: "pane", value: terminalSurface.paneId }] : []),
                  ...(terminalSurface.socketDir ? [{ label: "socket", value: terminalSurface.socketDir }] : []),
                  { label: "mode", value: readOnly ? "read-only" : "takeover" },
                ]
              : []),
            { label: "ws", value: scopedRelayUrl },
            { label: "health", value: healthUrl },
          ]}
        />
      </div>
    </div>
  );
}
