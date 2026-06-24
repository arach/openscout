import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { AgentEssentialsGlyph } from "../agents/agent-essentials.tsx";
import { ensureAgentChat } from "../../lib/agent-chat.ts";
import { agentStateLabel, isAgentBusy } from "../../lib/agent-state.ts";
import { api } from "../../lib/api.ts";
import { resolveActiveSessionId, sortSessionsByRecency } from "../../lib/session-catalog.ts";
import { timeAgo } from "../../lib/time.ts";
import type { Agent, Route, SessionCatalogEntry, SessionCatalogWithResume, SessionEntry } from "../../lib/types.ts";
import {
  agentNowLine,
  conversationForCatalogSession,
  openAgentsV2Profile,
  peekSessionMeta,
  peekSessionTitle,
} from "./model.ts";
import type { RegistryAgentEntry } from "./model.ts";
import "./agents-v2-sheet.css";
import "./agents-v2.css";

type Navigate = (route: Route) => void;

const PEEK_SESSION_LIMIT = 4;

export function AgentsV2AgentPeek({
  agent,
  route,
  navigate,
  registryEntry,
  conversations = [],
}: {
  agent: Agent;
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
  registryEntry?: RegistryAgentEntry | null;
  conversations?: SessionEntry[];
}) {
  const [catalog, setCatalog] = useState<SessionCatalogWithResume | null>(null);
  const [phase, setPhase] = useState<"loading" | "loaded">("loading");

  const loadCatalog = useCallback(async () => {
    setPhase("loading");
    const payload = await api<SessionCatalogWithResume>(
      `/api/agents/${encodeURIComponent(agent.id)}/session-catalog`,
    ).catch(() => null);
    setCatalog(payload);
    setPhase("loaded");
  }, [agent.id]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const activeSessionId = resolveActiveSessionId(agent, catalog);
  const sessions = useMemo(
    () => sortSessionsByRecency(catalog?.sessions ?? [], activeSessionId),
    [catalog?.sessions, activeSessionId],
  );
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const sessionCount = sessions.length;

  const displayName = agent.name?.trim() || agent.handle?.trim().replace(/^@+/, "") || agent.id;
  const handle = agent.handle?.trim().replace(/^@+/, "") || null;
  const live = isAgentBusy(agent.state, agent) || Boolean(activeSessionId);
  const role =
    agent.agentClass && agent.agentClass !== "general" ? agent.agentClass : null;

  const nowLine = agentNowLine(registryEntry, conversations, activeSession);

  const openProfile = (sessionId?: string) =>
    navigate(
      sessionId
        ? { ...openAgentsV2Profile(route, agent.id), sessionId }
        : openAgentsV2Profile(route, agent.id),
    );

  const openMessage = async () => {
    try {
      const chatId = await ensureAgentChat({ ...agent, conversationId: agent.conversationId ?? null });
      navigate({
        ...openAgentsV2Profile(route, agent.id),
        conversationId: chatId,
        tab: "message",
      });
    } catch {
      /* surfaced elsewhere */
    }
  };

  if (phase === "loading") {
    return (
      <div className="av2-peekShell">
        <div className="av2-sheet-loading">Loading agent…</div>
      </div>
    );
  }

  return (
    <aside className="av2-sheet av2-peekSheet av2-agentPeek">
      <header className="av2-sheet-head av2-agentPeekHead">
        <span className="av2-agentPeekAvatar">
          <AgentAvatar agent={agent} size={46} tile presence={false} />
        </span>
        <div className="av2-agentPeekIdent">
          <div className="av2-agentPeekNameRow">
            <span className="av2-agentPeekName" title={displayName}>
              {displayName}
            </span>
            {handle ? (
              <span className="av2-agentPeekHandle" title={`@${handle}`}>
                @{handle}
              </span>
            ) : null}
          </div>
          <AgentEssentialsGlyph
            agent={agent}
            projectRoot={registryEntry?.projectRoot}
            className="av2-agentPeekGlyph"
          />
          <span className="av2-agentPeekStatus">
            {live ? <span className="av2-sheet-working-dot" aria-hidden /> : null}
            {agentStateLabel(agent.state, agent)}
            {role ? ` · ${role}` : ""}
            {agent.updatedAt ? ` · ${timeAgo(agent.updatedAt)}` : ""}
            {sessionCount > 0
              ? ` · ${activeSessionId ? "1 live · " : ""}${sessionCount} session${sessionCount === 1 ? "" : "s"}`
              : ""}
          </span>
        </div>
      </header>

      <div className="av2-sheet-scroll">
        {nowLine ? (
          <section className="av2-agentPeekNow">
            <span className="av2-agentPeekNowLabel">
              {live || activeSessionId ? "Right now" : "Last seen"}
            </span>
            <p className="av2-agentPeekNowText" title={nowLine}>
              {nowLine}
            </p>
          </section>
        ) : (
          <section className="av2-agentPeekNow av2-agentPeekNow--quiet">
            <span className="av2-agentPeekNowLabel">Status</span>
            <p className="av2-agentPeekNowText">
              {sessionCount > 0
                ? "No active task text — pick a session below or open profile."
                : "No sessions yet — start from profile or message."}
            </p>
          </section>
        )}

        <section className="av2-sheet-actions">
          <button type="button" className="av2-sheet-ghost av2-sheet-ghost--primary" onClick={() => openProfile()}>
            Open profile
          </button>
          <button type="button" className="av2-sheet-ghost" onClick={() => void openMessage()}>
            Message
          </button>
          <button
            type="button"
            className="av2-sheet-ghost"
            onClick={() => navigate({ view: "terminal", agentId: agent.id })}
          >
            Terminal
          </button>
        </section>

        <div className="av2-sheet-sechead av2-agentPeekSessionsHead">
          <span className="av2-sheet-sechead-label">Recent sessions</span>
          <span className="av2-sheet-sechead-count">
            {sessionCount === 0 ? "none" : `${sessionCount} total`}
          </span>
          <span className="av2-sheet-sechead-rule" />
        </div>

        {sessionCount === 0 ? (
          <div className="av2-sheet-empty av2-agentPeekSessionsEmpty">
            No sessions yet. Open profile to start or resume work.
          </div>
        ) : (
          <div className="av2-agentPeekSessions">
            {sessions.slice(0, PEEK_SESSION_LIMIT).map((session) => {
              const isLive = session.id === activeSessionId;
              const conversation = conversationForCatalogSession(session, conversations);
              const title = peekSessionTitle(session, conversation);
              const meta = peekSessionMeta(session, conversation, activeSessionId);
              return (
                <button
                  key={session.id}
                  type="button"
                  className="av2-agentPeekSession"
                  data-live={isLive || undefined}
                  onClick={() => openProfile(session.id)}
                >
                  <span className="av2-agentPeekSessionMain">
                    {isLive ? <span className="av2-dot" data-tone="live" aria-hidden /> : null}
                    <span className="av2-agentPeekSessionTitle" title={title}>
                      {title}
                    </span>
                  </span>
                  <span className="av2-agentPeekSessionMeta" title={session.id}>
                    {meta}
                  </span>
                </button>
              );
            })}
            {sessionCount > PEEK_SESSION_LIMIT ? (
              <button type="button" className="av2-agentPeekSessionsMore" onClick={() => openProfile()}>
                +{sessionCount - PEEK_SESSION_LIMIT} more in profile →
              </button>
            ) : null}
          </div>
        )}
      </div>

      <footer className="av2-peekFoot">
        <span className="av2-peekFootId" title={agent.id}>
          {agent.id}
        </span>
        <button type="button" className="av2-peekOpen" onClick={() => openProfile()}>
          Open full profile →
        </button>
      </footer>
    </aside>
  );
}