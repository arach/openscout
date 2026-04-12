import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { agentIdFromConversation } from "../lib/router.ts";
import type { Agent, Message, Route } from "../lib/types.ts";

export function ConversationScreen({
  conversationId,
  navigate,
}: {
  conversationId: string;
  navigate: (r: Route) => void;
}) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const agentId = agentIdFromConversation(conversationId);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [agents, allMessages] = await Promise.all([
        api<Agent[]>("/api/agents"),
        api<Message[]>("/api/messages"),
      ]);
      setAgent(agents.find((a) => a.id === agentId) ?? null);
      setMessages(
        allMessages
          .filter((m) => m.conversationId === conversationId)
          .sort((a, b) => a.createdAt - b.createdAt),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [agentId, conversationId]);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  // Scroll to bottom on new messages
  const prevCount = useRef(0);
  useEffect(() => {
    if (messages.length > prevCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCount.current = messages.length;
  }, [messages.length]);

  // Tick for timestamps
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const agentName = agent?.name ?? agentId ?? "Agent";

  return (
    <div className="s-conversation">
      {/* Header */}
      <div
        className="s-conv-header"
        onClick={() => navigate({ view: "agent-info", conversationId })}
      >
        <button
          type="button"
          className="s-back"
          onClick={(e) => { e.stopPropagation(); navigate({ view: "inbox" }); }}
        >
          &larr;
        </button>
        <div
          className="s-avatar s-avatar-sm"
          style={{ background: actorColor(agentName) }}
        >
          {agentName[0].toUpperCase()}
        </div>
        <div className="s-conv-header-info">
          <span className="s-conv-header-name">{agentName}</span>
          {agent?.state && (
            <span className="s-conv-header-state">
              <span className="s-dot s-dot-sm" style={{ background: stateColor(agent.state) }} />
              {agent.state}
            </span>
          )}
        </div>
        <span className="s-spacer" />
        {agent?.harness && <span className="s-badge">{agent.harness}</span>}
        <span className="s-chevron" />
      </div>

      {error && <p className="s-error">{error}</p>}

      {/* Messages */}
      <div className="s-messages">
        {messages.length === 0 ? (
          <div className="s-empty">
            <p>No messages yet</p>
            <p>Start a conversation with this agent</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isYou = msg.actorName === "operator" || msg.class === "operator";
            return (
              <div
                key={msg.id}
                className={`s-msg${isYou ? " s-msg-you" : ""}`}
              >
                <div className="s-msg-header">
                  <span className="s-msg-actor">{isYou ? "You" : msg.actorName}</span>
                  <span className="s-msg-time">{timeAgo(msg.createdAt)}</span>
                </div>
                <p className="s-msg-body">{msg.body}</p>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Compose bar (placeholder for Phase 3) */}
      <div className="s-compose">
        <input
          className="s-compose-input"
          type="text"
          placeholder={`Message ${agentName}...`}
          disabled
        />
        <button type="button" className="s-compose-send" disabled>
          &uarr;
        </button>
      </div>
    </div>
  );
}
