import { useMemo } from "react";
import { ensureAgentChat } from "../../lib/agent-chat.ts";
import { queueTakeover } from "../../lib/terminal-takeover.ts";
import { resolveAgentTerminalSurface } from "../../lib/terminal-relay.ts";
import {
  resolveActiveSessionId,
  resolveSelectedSessionId,
  sessionEngage,
  sortSessionsByRecency,
} from "../../lib/session-catalog.ts";
import { timeAgo } from "../../lib/time.ts";
import { openContent } from "../../scout/slots/openContent.ts";
import { useScout } from "../../scout/Provider.tsx";
import type { Agent, Route, SessionCatalogWithResume } from "../../lib/types.ts";
import { pathLeaf } from "../agents/model.ts";
import { AgentsV2SessionDetail } from "./AgentsV2SessionDetail.tsx";

function shortSessionLabel(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)) {
    return id;
  }
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function AgentsV2SessionsPanel({
  agent,
  sessionCatalog,
  conversationId,
  navigate,
  route,
}: {
  agent: Agent;
  sessionCatalog: SessionCatalogWithResume | null;
  conversationId: string | null;
  navigate: (r: Route) => void;
  route: Extract<Route, { view: "agents-v2" }>;
}) {
  const { focusedSession, focusSession } = useScout();
  const activeSessionId = resolveActiveSessionId(agent, sessionCatalog);
  const sessions = useMemo(
    () => sortSessionsByRecency(sessionCatalog?.sessions ?? [], activeSessionId),
    [sessionCatalog?.sessions, activeSessionId],
  );
  const selectedSessionId = resolveSelectedSessionId(
    agent.id,
    focusedSession,
    activeSessionId,
    sessions,
  );
  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? null;
  const sessionActive = Boolean(
    selectedSession && activeSessionId && selectedSession.id === activeSessionId,
  );
  const engage = selectedSession
    ? sessionEngage(agent, sessionCatalog, selectedSession, sessionActive)
    : { canObserve: false, canTakeover: false };

  const agentRoute = (patch: Partial<Extract<Route, { view: "agents-v2" }>>): Route => ({
    ...route,
    ...patch,
    view: "agents-v2",
  });

  const openMessage = async () => {
    try {
      const chatId = await ensureAgentChat({ ...agent, conversationId });
      navigate(agentRoute({ agentId: agent.id, conversationId: chatId, tab: "message" }));
    } catch {
      /* surfaced elsewhere */
    }
  };

  const resumeSession = () => {
    if (!selectedSession) return;
    openContent(navigate, { view: "sessions", sessionId: selectedSession.id }, { returnTo: route });
  };

  const observeTerminal = () =>
    openContent(navigate, { view: "terminal", agentId: agent.id, mode: "observe" }, { returnTo: route });

  const takeoverTerminal = () =>
    openContent(navigate, { view: "terminal", agentId: agent.id, mode: "takeover" }, { returnTo: route });

  const runTakeover = () => {
    if (resolveAgentTerminalSurface(agent)) {
      takeoverTerminal();
      return;
    }
    const command = sessionCatalog?.resumeCommand;
    if (command) {
      void queueTakeover({ command, cwd: sessionCatalog?.resumeCwd, agentId: agent.id }).then(() =>
        takeoverTerminal(),
      );
      return;
    }
    takeoverTerminal();
  };

  return (
    <section className="av2-sessions" aria-label="Sessions">
      <header className="av2-sessionsHead">
        <span className="av2-sessionsTitle">Sessions</span>
        {sessions.length > 0 ? (
          <span className="av2-sessionsCount">{sessions.length}</span>
        ) : null}
      </header>

      {sessions.length === 0 ? (
        <div className="av2-sessionsEmpty">No sessions yet — start a new session from the header above.</div>
      ) : (
        <div className="av2-sessionsSplit">
          <nav className="av2-sessionsRail" aria-label="Session list">
            {sessions.map((s) => {
              const isActive = s.id === activeSessionId;
              const isSelected = s.id === selectedSessionId;
              const when = isActive
                ? "now"
                : s.endedAt
                  ? `ended · ${timeAgo(s.endedAt) || "recent"}`
                  : timeAgo(s.startedAt) || "recent";
              const label = s.cwd ? pathLeaf(s.cwd) : shortSessionLabel(s.id);
              const sHarness = s.harness ?? agent.harness ?? "session";
              const sModelRaw = s.model ?? agent.model;
              const sModel =
                sModelRaw && sModelRaw.startsWith(`${sHarness}-`)
                  ? sModelRaw.slice(sHarness.length + 1)
                  : sModelRaw;
              const engine = [sHarness, sModel].filter(Boolean).join(" · ");

              return (
                <button
                  key={s.id}
                  type="button"
                  className="av2-sessionsRailItem"
                  data-selected={isSelected || undefined}
                  data-tone={isActive ? "live" : "idle"}
                  onClick={() => focusSession(agent.id, s.id)}
                  aria-current={isSelected ? "true" : undefined}
                >
                  {isActive ? (
                    <span className="av2-dot" data-tone="live" aria-hidden />
                  ) : (
                    <span className="av2-sessionsRailDot" aria-hidden />
                  )}
                  <span className="av2-sessionsRailCopy">
                    <span className="av2-sessionsRailName" title={s.id}>
                      {label}
                    </span>
                    <span className="av2-sessionsRailEngine">{engine}</span>
                  </span>
                  <span className="av2-sessionsRailWhen">{when}</span>
                </button>
              );
            })}
          </nav>

          <div className="av2-sessionsPreview">
            {selectedSession ? (
              <AgentsV2SessionDetail
                agent={agent}
                session={selectedSession}
                active={sessionActive}
                onContinue={() => void openMessage()}
                onResume={resumeSession}
                onObserve={observeTerminal}
                onTakeover={runTakeover}
                onTrace={() => navigate(agentRoute({ agentId: agent.id, tab: "observe" }))}
                canObserve={engage.canObserve}
                canTakeover={engage.canTakeover}
              />
            ) : (
              <div className="av2-sessionsEmpty">Select a session to preview.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}