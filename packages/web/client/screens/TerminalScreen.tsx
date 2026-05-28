import "./terminal-screen.css";

import { useTerminalRelay, TerminalRelay } from "@hudsonkit";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useScout } from "../scout/Provider.tsx";
import { api } from "../lib/api.ts";
import { actorColor } from "../lib/colors.ts";
import {
  resolveScoutTerminalRelayHealthUrl,
  resolveScoutTerminalRelayUrl,
} from "../lib/runtime-config.ts";
import { queueTakeover } from "../lib/terminal-takeover.ts";
import { createVantageHandoff, formatVantageLinkLabel } from "../lib/vantage.ts";
import type { Agent, Route, SessionCatalogWithResume } from "../lib/types.ts";
import { BackToPicker } from "../scout/slots/BackToPicker.tsx";

function relayAgentForHarness(harness: string | null | undefined): "claude" | "pi" | undefined {
  return harness === "pi" ? "pi" : undefined;
}

function agentTmuxTerminalSessionKey(agentId: string, tmuxSession: string): string {
  return `scout-tmux-${agentId}-${tmuxSession}`;
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
  return mode === "takeover" && Boolean(agent) && agent?.transport !== "tmux";
}

export function TerminalScreen({
  agentId,
  mode,
  navigate,
}: {
  agentId?: string;
  mode?: "observe" | "takeover";
  navigate: (r: Route) => void;
}) {
  const { agents } = useScout();
  const agent = agentId ? agents.find((a) => a.id === agentId) : null;
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

  const tmuxSession = agent?.transport === "tmux" ? agent.harnessSessionId : null;
  const relayKey = agent && tmuxSession
    ? `tmux:${agent.id}:${tmuxSession}`
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
          <span className="s-term-dot s-term-dot--connecting" />
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
}: {
  agentId?: string;
  agent: Agent | null;
  mode?: "observe" | "takeover";
  navigate: (r: Route) => void;
}) {
  const color = agent ? actorColor(agent.name) : "var(--accent)";
  const tmuxSession = agent?.transport === "tmux" ? agent.harnessSessionId : null;
  const readOnly = mode === "observe";
  const cwd = agent?.cwd ?? agent?.projectRoot ?? undefined;
  const relayAgent = relayAgentForHarness(agent?.harness);
  const [handoffState, setHandoffState] = useState<
    | { state: "idle" }
    | { state: "opening" }
    | { state: "opened"; detail: string }
    | { state: "failed"; error: string }
  >({ state: "idle" });
  const relayUrl = resolveScoutTerminalRelayUrl();
  const healthUrl = resolveScoutTerminalRelayHealthUrl();
  const scopedRelayUrl = terminalRelayUrlForAgent(relayUrl, agentId);

  const relay = useTerminalRelay({
    url: scopedRelayUrl,
    healthUrl,
    autoConnect: true,
    sessionKey: agent && tmuxSession
      ? agentTmuxTerminalSessionKey(agent.id, tmuxSession)
      : agentId
        ? `scout-takeover-${agentId}`
        : "scout-takeover",
    ...(tmuxSession ? { backend: "tmux" as const, tmuxSession } : {}),
    ...(cwd ? { cwd } : {}),
    ...(relayAgent ? { agent: relayAgent } : {}),
  });
  const terminalRelay = useMemo(() => {
    if (!readOnly) return relay;
    return {
      ...relay,
      sendInput: () => {},
      sendLine: () => {},
      restart: () => {},
    };
  }, [readOnly, relay]);

  const openInVantage = () => {
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
  };

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
        <span className="s-term-label">
          {tmuxSession ? (readOnly ? "TMUX OBSERVE" : "TMUX TAKEOVER") : "TAKEOVER"}
        </span>
        {tmuxSession && (
          <span className="s-term-session" title={tmuxSession}>
            {tmuxSession}
          </span>
        )}
        {tmuxSession && (
          <button
            type="button"
            className="s-term-vantage"
            onClick={() =>
              navigate({
                view: "terminal",
                agentId,
                mode: readOnly ? "takeover" : "observe",
              })
            }
            title={readOnly ? "Switch to interactive takeover" : "Switch to read-only terminal observe"}
          >
            {readOnly ? "Takeover" : "Observe"}
          </button>
        )}
        <button
          type="button"
          className="s-term-vantage"
          onClick={openInVantage}
          disabled={handoffState.state === "opening"}
          title="Open this terminal context in the native Vantage canvas"
        >
          {handoffState.state === "opening" ? "Opening..." : "Open in Vantage"}
        </button>
        {handoffState.state === "opened" && (
          <span className="s-term-handoff s-term-handoff--ok">{handoffState.detail}</span>
        )}
        {handoffState.state === "failed" && (
          <span className="s-term-handoff s-term-handoff--error">{handoffState.error}</span>
        )}
        <div className="s-term-status">
          <span
            className={`s-term-dot${relay.status === "connected" ? " s-term-dot--live" : relay.status === "connecting" ? " s-term-dot--connecting" : ""}`}
          />
          {relay.status === "connected"
            ? "LIVE"
            : relay.status === "connecting"
              ? "CONNECTING"
              : "OFFLINE"}
        </div>
      </div>
      <div className="s-term-body">
        <TerminalRelay
          relay={terminalRelay}
          fontSize={13}
          quiet
          configItems={[
            ...(tmuxSession
              ? [
                  { label: "backend", value: "tmux" },
                  { label: "session", value: tmuxSession },
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
