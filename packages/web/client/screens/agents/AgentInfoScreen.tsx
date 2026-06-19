import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import "./agents-detail-redesign.css";
import { agentStateCssToken, agentStateLabel } from "../../lib/agent-state.ts";
import {
  compactAgentId,
  minimalAgentHandle,
} from "../../lib/agent-labels.ts";
import { actorColor, stateColor } from "../../lib/colors.ts";
import { api } from "../../lib/api.ts";
import { agentIdFromConversation } from "../../lib/router.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { fullTimestamp, timeAgo } from "../../lib/time.ts";
import { formatLabel } from "../../lib/text.ts";
import { useScout } from "../../scout/Provider.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import { BackToPicker } from "../../scout/slots/BackToPicker.tsx";
import { AgentLiveActions } from "../../components/AgentLiveActions.tsx";
import { ObservedTopologyPanel } from "../../components/ObservedTopologyPanel.tsx";
import type { Agent, Route, SessionEntry } from "../../lib/types.ts";

type ProfileField = {
  label: string;
  value: ReactNode;
};

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

function CodeValue({ value }: { value: string }) {
  return <span className="s-agent-code-value">{value}</span>;
}

function protocolLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  return normalized.toLowerCase() === "a2a"
    ? "A2A"
    : formatLabel(normalized) ?? normalized;
}

function ProviderValue({
  name,
  url,
}: {
  name: string;
  url?: string | null;
}) {
  if (!url) {
    return <>{name}</>;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {name}
    </a>
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
  const { agents, route } = useScout();
  const [session, setSession] = useState<SessionEntry | null>(null);
  const [agentDetail, setAgentDetail] = useState<Agent | null>(null);
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
  useEffect(() => {
    if (!resolvedAgentId || agents.some((candidate) => candidate.id === resolvedAgentId)) {
      setAgentDetail(null);
      return;
    }

    let cancelled = false;
    api<Agent>(`/api/agents/${encodeURIComponent(resolvedAgentId)}`)
      .then((next) => {
        if (!cancelled) setAgentDetail(next);
      })
      .catch(() => {
        if (!cancelled) setAgentDetail(null);
      });

    return () => {
      cancelled = true;
    };
  }, [agents, resolvedAgentId]);

  const agent = useMemo(
    () => (resolvedAgentId
      ? agents.find((candidate) => candidate.id === resolvedAgentId) ??
        (agentDetail?.id === resolvedAgentId ? agentDetail : null)
      : null),
    [agentDetail, agents, resolvedAgentId],
  );

  if (!agent) {
    return (
      <div>
        <BackToPicker
          slot="agent-info"
          fallback={{ view: "conversation", conversationId }}
          navigate={navigate}
        />
        {error && <p className="s-error">{error}</p>}
        <div className="s-empty"><p>Agent not found</p></div>
      </div>
    );
  }

  const shortHandle = minimalAgentHandle(agent);
  const displayHandle = agent.handle ? `@${agent.handle.replace(/^@+/, "")}` : null;
  const primarySelector = agent.selector ?? agent.defaultSelector ?? displayHandle;
  const stateLabel = agentStateLabel(agent.state);
  const nodeLabel = agent.authorityNodeName
    ? `${agent.authorityNodeName} (${agent.authorityNodeId ?? "unknown"})`
    : agent.authorityNodeId;
  const homeNodeLabel = agent.homeNodeName
    ? `${agent.homeNodeName} (${agent.homeNodeId ?? "unknown"})`
    : agent.homeNodeId;
  const skills = agent.skills ?? [];
  const protocol = protocolLabel(agent.protocol);
  const hasExternalCardIdentity = Boolean(agent.providerName || protocol || skills.length > 0);
  const identityItems: ProfileField[] = [
    { label: "Fully qualified ID", value: <CodeValue value={agent.id} /> },
    { label: "Definition", value: <CodeValue value={agent.definitionId} /> },
    ...(displayHandle ? [{ label: "Handle", value: <CodeValue value={displayHandle} /> }] : []),
    ...(agent.selector ? [{ label: "Selector", value: <CodeValue value={agent.selector} /> }] : []),
    ...(agent.defaultSelector && agent.defaultSelector !== agent.selector
      ? [{ label: "Default selector", value: <CodeValue value={agent.defaultSelector} /> }]
      : []),
    ...(agent.workspaceQualifier
      ? [{ label: "Workspace qualifier", value: <CodeValue value={agent.workspaceQualifier} /> }]
      : []),
    ...(agent.nodeQualifier ? [{ label: "Node qualifier", value: <CodeValue value={agent.nodeQualifier} /> }] : []),
    ...(agent.providerName
      ? [{ label: "Provider", value: <ProviderValue name={agent.providerName} url={agent.providerUrl} /> }]
      : []),
    ...(protocol ? [{ label: "Protocol", value: protocol }] : []),
    ...(skills.length > 0 ? [{ label: "Skills", value: <CapabilityTokens values={skills} /> }] : []),
    ...(!hasExternalCardIdentity ? [{ label: "Class", value: formatLabel(agent.agentClass) ?? "—" }] : []),
    ...(!hasExternalCardIdentity && agent.role ? [{ label: "Role", value: agent.role }] : []),
    ...(agent.staleLocalRegistration
      ? [{
        label: "Registration",
        value: agent.replacedByAgentId
          ? `Superseded by ${agent.replacedByAgentId}`
          : "Historical registration",
      }]
      : []),
    ...(agent.retiredFromFleet ? [{ label: "Fleet state", value: "Retired" }] : []),
  ];
  const topologyItems: ProfileField[] = [
    ...(nodeLabel ? [{ label: "Authority node", value: <CodeValue value={nodeLabel} /> }] : []),
    ...(homeNodeLabel ? [{ label: "Home node", value: <CodeValue value={homeNodeLabel} /> }] : []),
    ...(agent.ownerId ? [{ label: "Owner", value: agent.ownerName ? `${agent.ownerName} (${agent.ownerId})` : agent.ownerId }] : []),
    ...(agent.conversationId
      ? [{ label: "Direct conversation", value: <CodeValue value={agent.conversationId} /> }]
      : []),
  ];
  const workspaceItems: ProfileField[] = [
    ...(agent.project ? [{ label: "Project", value: agent.project }] : []),
    ...(agent.branch ? [{ label: "Branch", value: agent.branch }] : []),
    ...(agent.projectRoot ? [{ label: "Path", value: agent.projectRoot }] : []),
    ...(agent.cwd ? [{ label: "Working dir", value: agent.cwd }] : []),
  ];
  const runtimeItems: ProfileField[] = [
    ...(!hasExternalCardIdentity && agent.harness ? [{ label: "Harness", value: agent.harness }] : []),
    ...(agent.model ? [{ label: "Model", value: agent.model }] : []),
    ...(!hasExternalCardIdentity && agent.transport ? [{ label: "Transport", value: formatLabel(agent.transport) ?? agent.transport }] : []),
    ...(agent.wakePolicy ? [{ label: "Wake policy", value: formatLabel(agent.wakePolicy) ?? agent.wakePolicy }] : []),
    ...(agent.capabilities.length > 0 ? [{ label: "Capabilities", value: <CapabilityTokens values={agent.capabilities} /> }] : []),
  ];
  const conversationItems: ProfileField[] = [
    { label: "Conversation UID", value: conversationId },
    ...(session?.workspaceRoot ? [{ label: "Workspace", value: session.workspaceRoot }] : []),
    ...(session?.currentBranch ? [{ label: "Session branch", value: session.currentBranch }] : []),
    ...(session?.messageCount != null ? [{ label: "Messages", value: String(session.messageCount) }] : []),
    ...(session?.lastMessageAt ? [{ label: "Last message", value: fullTimestamp(session.lastMessageAt) }] : []),
    ...(agent.harnessSessionId ? [{ label: protocol ? `${protocol} context` : "Harness session", value: agent.harnessSessionId }] : []),
    ...(agent.harnessLogPath ? [{ label: "Harness log", value: agent.harnessLogPath }] : []),
  ];

  return (
    <div className="s-agent-profile-page">
      <div className="s-agent-profile-page-topbar">
        <BackToPicker
          slot="agent-info"
          fallback={{ view: "conversation", conversationId }}
          navigate={navigate}
        />
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
                  {primarySelector ?? shortHandle ?? compactAgentId(agent.id) ?? agent.id}
                </span>
                {stateLabel && (
                  <span className={`s-agent-state-chip s-agent-state-chip-${agentStateCssToken(agent.state)}`}>
                    <span className="s-dot" style={{ background: stateColor(agent.state) }} />
                    {stateLabel}
                  </span>
                )}
                {agent.staleLocalRegistration && (
                  <span className="s-agent-state-chip s-agent-state-chip-offline">
                    Superseded registration
                  </span>
                )}
              </div>
              <h1 className="s-agent-profile-hero-title">{agent.name}</h1>
              <div className="s-agent-profile-hero-tags">
                <CodeValue value={agent.id} />
                {agent.selector && <CodeValue value={agent.selector} />}
                {agent.defaultSelector && agent.defaultSelector !== agent.selector && (
                  <CodeValue value={agent.defaultSelector} />
                )}
              </div>
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
          <AgentLiveActions
            agent={agent}
            navigate={navigate}
            returnTo={route}
          />
          <button
            type="button"
            className="s-btn s-btn-primary"
            onClick={() => openContent(navigate, { view: "conversation", conversationId }, { returnTo: route })}
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
          title="Topology"
          items={topologyItems}
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

      <ObservedTopologyPanel
        title="Observed harness families"
        size="compact"
        maxAgents={8}
        maxTasks={4}
        showEmpty
      />
    </div>
  );
}
