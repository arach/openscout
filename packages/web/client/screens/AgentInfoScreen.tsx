import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { agentIdFromConversation } from "../lib/router.ts";
import type { Agent, Route } from "../lib/types.ts";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="s-detail-row">
      <span className="s-detail-label">{label}</span>
      <span className="s-detail-value">{value}</span>
    </div>
  );
}

export function AgentInfoScreen({
  conversationId,
  navigate,
}: {
  conversationId: string;
  navigate: (r: Route) => void;
}) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const agentId = agentIdFromConversation(conversationId);

  const load = useCallback(async () => {
    setError(null);
    try {
      const agents = await api<Agent[]>("/api/agents");
      setAgent(agents.find((a) => a.id === agentId) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [agentId]);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

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

      <div className="s-agent-profile">
        <div
          className="s-avatar s-avatar-lg"
          style={{ background: actorColor(agent.name) }}
        >
          {agent.name[0].toUpperCase()}
        </div>
        <div className="s-agent-profile-name">{agent.name}</div>
        {agent.handle && (
          <div className="s-agent-profile-handle">@{agent.handle}</div>
        )}
        <div className="s-agent-profile-state">
          <span className="s-dot" style={{ background: stateColor(agent.state) }} />
          <span>{agent.state ?? "offline"}</span>
        </div>
      </div>

      <div className="s-agent-details">
        {agent.project && <DetailRow label="Project" value={agent.project} />}
        {agent.branch && <DetailRow label="Branch" value={agent.branch} />}
        {agent.projectRoot && <DetailRow label="Path" value={agent.projectRoot} />}
        {agent.harness && <DetailRow label="Harness" value={agent.harness} />}
        {agent.transport && <DetailRow label="Transport" value={agent.transport.replace(/_/g, " ")} />}
        {agent.agentClass && <DetailRow label="Class" value={agent.agentClass} />}
        {agent.wakePolicy && <DetailRow label="Wake" value={agent.wakePolicy.replace(/_/g, " ")} />}
        {agent.capabilities?.length > 0 && (
          <DetailRow label="Capabilities" value={agent.capabilities.join(", ")} />
        )}
        {agent.role && <DetailRow label="Role" value={agent.role} />}
        {agent.selector && <DetailRow label="Selector" value={agent.selector} />}
      </div>
    </div>
  );
}
