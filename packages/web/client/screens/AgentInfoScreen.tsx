import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import "./agents-detail-redesign.css";
import { agentStateLabel, normalizeAgentState } from "../lib/agent-state.ts";
import {
  compactAgentId,
  minimalAgentHandle,
} from "../lib/agent-labels.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { api } from "../lib/api.ts";
import { agentIdFromConversation } from "../lib/router.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { fullTimestamp, timeAgo } from "../lib/time.ts";
import { useScout } from "../scout/Provider.tsx";
import type { Route, SessionEntry } from "../lib/types.ts";

type ProfileField = {
  label: string;
  value: ReactNode;
};

function formatLabel(value: string | null | undefined): string | null {
  return value ? value.replace(/_/g, " ") : null;
}

function CapabilityTokens({ values }: { values: string[] }) {
  return (
    <span className="s-agent-token-list">
      {values.map((value) => (
        <span key={value} className="s-agent-token">
          {value}
        </span>
      ))}
    </span>
  );
}

function ProfileCard({
  title,
  items,
}: {
  title: string;
  items: ProfileField[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="s-agent-profile-card">
      <div className="s-agent-profile-card-header">
        <div className="s-agent-profile-card-title">{title}</div>
      </div>
      <div className="s-agent-meta-card-body">
        {items.map((item) => (
          <div key={item.label} className="s-agent-meta-row">
            <span className="s-agent-meta-label">{item.label}</span>
            <span className="s-agent-meta-value">{item.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AgentInfoScreen({
  conversationId,
  navigate,
}: {
  conversationId: string;
  navigate: (r: Route) => void;
}) {
  const { agents } = useScout();
  const [session, setSession] = useState<SessionEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const legacyAgentId = agentIdFromConversation(conversationId);

  const load = useCallback(async () => {
    setError(null);
    try {
      const sessionEntry = await api<SessionEntry>(
        `/api/session/${encodeURIComponent(conversationId)}`,
      ).catch(() => null);
      setSession(sessionEntry);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSession(null);
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerEvents(() => {
    void load();
  });

  const resolvedAgentId = session?.agentId ?? legacyAgentId;
  const agent = useMemo(
    () => (resolvedAgentId ? agents.find((candidate) => candidate.id === resolvedAgentId) ?? null : null),
    [agents, resolvedAgentId],
  );

  if (!agent) {
    return (
      <div>
        <button
          type="button"
          className="s-back"
          onClick={() => navigate({ view: "conversation", conversationId })}
        >
          &larr; Back
        </button>
        {error && <p className="s-error">{error}</p>}
        <div className="s-empty"><p>Agent not found</p></div>
      </div>
    );
  }

  const shortHandle = minimalAgentHandle(agent);
  const identityItems: ProfileField[] = [
    { label: "System ID", value: agent.id },
    { label: "Class", value: formatLabel(agent.agentClass) ?? "—" },
    ...(agent.role ? [{ label: "Role", value: agent.role }] : []),
    ...(agent.selector && agent.selector !== shortHandle
      ? [{ label: "Selector", value: agent.selector }]
      : []),
  ];
  const workspaceItems: ProfileField[] = [
    ...(agent.project ? [{ label: "Project", value: agent.project }] : []),
    ...(agent.branch ? [{ label: "Branch", value: agent.branch }] : []),
    ...(agent.projectRoot ? [{ label: "Path", value: agent.projectRoot }] : []),
    ...(agent.cwd ? [{ label: "Working dir", value: agent.cwd }] : []),
  ];
  const runtimeItems: ProfileField[] = [
    ...(agent.harness ? [{ label: "Harness", value: agent.harness }] : []),
    ...(agent.transport ? [{ label: "Transport", value: formatLabel(agent.transport) ?? agent.transport }] : []),
    ...(agent.wakePolicy ? [{ label: "Wake policy", value: formatLabel(agent.wakePolicy) ?? agent.wakePolicy }] : []),
    ...(agent.capabilities.length > 0 ? [{ label: "Capabilities", value: <CapabilityTokens values={agent.capabilities} /> }] : []),
  ];
  const conversationItems: ProfileField[] = [
    { label: "Thread ID", value: conversationId },
    ...(session?.workspaceRoot ? [{ label: "Workspace", value: session.workspaceRoot }] : []),
    ...(session?.currentBranch ? [{ label: "Session branch", value: session.currentBranch }] : []),
    ...(session?.messageCount != null ? [{ label: "Messages", value: String(session.messageCount) }] : []),
    ...(session?.lastMessageAt ? [{ label: "Last message", value: fullTimestamp(session.lastMessageAt) }] : []),
    ...(agent.harnessSessionId ? [{ label: "Harness session", value: agent.harnessSessionId }] : []),
    ...(agent.harnessLogPath ? [{ label: "Harness log", value: agent.harnessLogPath }] : []),
  ];

  return (
    <div className="s-agent-profile-page">
      <div className="s-agent-profile-page-topbar">
        <button
          type="button"
          className="s-back"
          onClick={() => navigate({ view: "conversation", conversationId })}
        >
          &larr; Conversation
        </button>
        <button
          type="button"
          className="s-btn"
          onClick={() => navigate({ view: "agents", agentId: agent.id })}
        >
          Open in Agents
        </button>
      </div>

      {error && <p className="s-error">{error}</p>}

      <section className="s-agent-profile-hero">
        <div className="s-agent-profile-hero-main">
          <div className="s-agent-profile-hero-title-row">
            <div
              className="s-avatar s-agent-profile-hero-avatar"
              style={{ background: actorColor(agent.name) }}
            >
              {agent.name[0].toUpperCase()}
            </div>
            <div className="s-agent-profile-hero-copy">
              <div className="s-agent-casefile-title-meta">
                <span className="s-agent-casefile-record">
                  {shortHandle ?? compactAgentId(agent.id) ?? agent.id}
                </span>
                <span className={`s-agent-state-chip s-agent-state-chip-${normalizeAgentState(agent.state)}`}>
                  <span className="s-dot" style={{ background: stateColor(agent.state) }} />
                  {agentStateLabel(agent.state)}
                </span>
              </div>
              <h1 className="s-agent-profile-hero-title">{agent.name}</h1>
              <p className="s-agent-profile-hero-context">
                {session?.title
                  ? `Conversation: ${session.title}.`
                  : "Attached to the current conversation."}
                {agent.updatedAt ? ` Updated ${timeAgo(agent.updatedAt)}.` : ""}
              </p>
            </div>
          </div>
        </div>
        <div className="s-agent-profile-hero-actions">
          <button
            type="button"
            className="s-btn s-btn-primary"
            onClick={() => navigate({ view: "conversation", conversationId })}
          >
            Open conversation
          </button>
        </div>
      </section>

      <div className="s-agent-profile-grid">
        <ProfileCard
          title="Identity"
          items={identityItems}
        />
        <ProfileCard
          title="Workspace"
          items={workspaceItems}
        />
        <ProfileCard
          title="Runtime"
          items={runtimeItems}
        />
        <ProfileCard
          title="Conversation context"
          items={conversationItems}
        />
      </div>
    </div>
  );
}
