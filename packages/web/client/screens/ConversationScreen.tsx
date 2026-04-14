import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { agentIdFromConversation } from "../lib/router.ts";
import type { Agent, Message, Flight, Route } from "../lib/types.ts";

export function ConversationScreen({
  conversationId,
  navigate,
  flights = [],
}: {
  conversationId: string;
  navigate: (r: Route) => void;
  flights?: Flight[];
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
  useBrokerEvents(useCallback((event) => {
    if (event.kind === "message.posted") {
      const msg = (event.payload as { message?: { id: string; conversationId: string; actorId: string; body: string; createdAt: number; class: string } })?.message;
      if (msg && msg.conversationId === conversationId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, {
            id: msg.id,
            conversationId: msg.conversationId,
            actorName: msg.actorId,
            body: msg.body,
            createdAt: msg.createdAt,
            class: msg.class,
          }].sort((a, b) => a.createdAt - b.createdAt);
        });
        return;
      }
    }
    // For other events or messages in other conversations, do a full refresh
    void load();
  }, [conversationId, load]));

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

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [operatorName, setOperatorName] = useState("operator");

  useEffect(() => {
    api<{ name: string }>("/api/user").then((u) => setOperatorName(u.name)).catch(() => {});
  }, []);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    // Optimistic: add to local messages immediately
    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      conversationId,
      actorName: operatorName,
      body: text,
      createdAt: Date.now(),
      class: "operator",
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      await api("/api/send", {
        method: "POST",
        body: JSON.stringify({ body: text, conversationId }),
      });
    } catch {
      // On failure, remove optimistic message
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  };

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

      {/* Flight banner */}
      {(() => {
        const agentFlights = flights.filter((f) => f.agentId === agentId);
        if (agentFlights.length === 0) return null;
        const f = agentFlights[0];
        return (
          <div className="s-flight-banner">
            <span className="s-flight-banner-dot" />
            <span className="s-flight-banner-label">
              {f.state === "running" ? "Working" : f.state.charAt(0).toUpperCase() + f.state.slice(1)}
            </span>
            {f.summary && <span className="s-flight-banner-summary">{f.summary}</span>}
            {f.startedAt && <span className="s-time">{timeAgo(f.startedAt)}</span>}
          </div>
        );
      })()}

      {/* Messages */}
      <div className="s-messages">
        {messages.length === 0 ? (
          <div className="s-empty">
            <p>No messages yet</p>
            <p>Start a conversation with this agent</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isYou = msg.actorName === operatorName || msg.actorName === "operator" || msg.class === "operator";
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

      <form
        className="s-compose"
        onSubmit={(e) => { e.preventDefault(); void send(); }}
      >
        <input
          className="s-compose-input"
          type="text"
          placeholder={`Message ${agentName}...`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sending}
        />
        <button
          type="submit"
          className="s-compose-send"
          disabled={sending || !draft.trim()}
        >
          &uarr;
        </button>
      </form>
    </div>
  );
}
